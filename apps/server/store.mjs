import { initialPolicySettings } from "./environment.mjs";
import { pools, timestamp, ENV } from "./config.mjs";
import { DEFAULT_POLICY, normalizePolicy } from "./policy.mjs";
export const db = pools.CONTROL;
export async function transaction(fn) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function event(type, title, detail = {}, refs = {}, client = db) {
  return (
    await client.query(
      `INSERT INTO agent.event(event_type,title,detail,severity,incident_id,run_id,action_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        type,
        title,
        detail,
        refs.severity || "info",
        refs.incidentId || null,
        refs.runId || null,
        refs.actionId || null,
      ],
    )
  ).rows[0];
}
export async function policy() {
  return {
    ...DEFAULT_POLICY,
    ...(await db.query("SELECT value FROM agent.policy WHERE singleton"))
      .rows[0]?.value,
  };
}
export async function runtime(patch) {
  await db.query(
    `UPDATE agent.runtime SET state=state||$1::jsonb,heartbeat_at=now() WHERE singleton`,
    [patch],
  );
}
export async function changePolicy(body) {
  return transaction(async (c) => {
    const current = (
      await c.query("SELECT value FROM agent.policy WHERE singleton FOR UPDATE")
    ).rows[0].value;
    const updates = {
      ...(body.policy || {}),
      ...("paused" in body ? { paused: body.paused } : {}),
      ...("directive" in body ? { directive: body.directive } : {}),
    };
    const next = normalizePolicy(updates, current);
    await c.query(
      "UPDATE agent.policy SET value=$1,updated_at=now() WHERE singleton",
      [next],
    );
    await c.query(
      "UPDATE agent.runtime SET cycle_requested_at=now() WHERE singleton",
    );
    await event(
      "human.steering",
      "Human updated the agent instructions",
      { policy: next },
      {},
      c,
    );
    if (next.directive !== current.directive) {
      await c.query(
        `INSERT INTO agent.memory(kind,title,content,metadata) VALUES('human_directive','Human steering instruction',$1,$2)`,
        [next.directive, { previous: current.directive }],
      );
    }
    return next;
  });
}
export async function initializePolicyDefaults() {
  return transaction(async (c) => {
    const current = (
      await c.query("SELECT value FROM agent.policy WHERE singleton FOR UPDATE")
    ).rows[0]?.value;
    if (!current)
      throw new Error(
        "Control policy is missing; apply schema migrations first",
      );
    const hasHistory = (
      await c.query(
        "SELECT EXISTS(SELECT 1 FROM agent.event) OR EXISTS(SELECT 1 FROM agent.observation) OR EXISTS(SELECT 1 FROM agent.action) AS present",
      )
    ).rows[0].present;
    const initial = initialPolicySettings(current, { hasHistory }, ENV);
    if (!hasHistory)
      await c.query(
        "UPDATE agent.policy SET value=$1,updated_at=now() WHERE singleton",
        [initial],
      );
    return initial;
  });
}
export async function requestCycle() {
  await db.query(
    "UPDATE agent.runtime SET cycle_requested_at=now() WHERE singleton",
  );
  return { queued: true };
}
export async function newRun(planner = "monitor") {
  return (
    await db.query("INSERT INTO agent.run(planner) VALUES($1) RETURNING *", [
      planner,
    ])
  ).rows[0];
}
export async function finishRun(
  id,
  status,
  summary,
  planner,
  model,
  error = null,
) {
  await db.query(
    "UPDATE agent.run SET status=$2,summary=$3,planner=$4,model=$5,error=$6,completed_at=now() WHERE run_id=$1",
    [id, status, summary, planner, model, error],
  );
}
export async function step(
  runId,
  seq,
  tool,
  source,
  reason,
  args,
  observation,
) {
  await db.query(
    "INSERT INTO agent.step(run_id,sequence,tool,source,reason,arguments,observation) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [runId, seq, tool, source, reason || null, args || {}, observation || {}],
  );
}
export async function remember(kind, title, content, refs = {}, metadata = {}) {
  return (
    await db.query(
      `INSERT INTO agent.memory(kind,title,content,incident_id,action_id,review_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *`,
      [
        kind,
        title,
        content,
        refs.incidentId || null,
        refs.actionId || null,
        refs.reviewId || null,
        metadata,
      ],
    )
  ).rows[0];
}
export async function recall(incidents, limit = 8) {
  const ids = incidents.map((x) => x.incident_id);
  const kinds = incidents.map((x) => x.kind);
  const r = await db.query(
    `SELECT m.* FROM agent.memory m LEFT JOIN agent.incident i USING(incident_id) WHERE (m.incident_id=ANY($1::uuid[]) OR m.metadata->>'incidentKind'=ANY($2::text[]) OR m.search @@ websearch_to_tsquery('english',$3) OR m.kind='human_directive') AND (i.target_id IN ('primary','standby') OR (m.incident_id IS NULL AND coalesce(m.metadata->>'scope','')<>'fleet')) ORDER BY CASE WHEN m.kind IN ('human_feedback','human_directive') THEN 0 ELSE 1 END,m.created_at DESC LIMIT $4`,
    [ids, kinds, kinds.join(" "), limit],
  );
  let semantic = [];
  try {
    const { semanticRecallMemories } = await import("./memory-search.mjs");
    semantic = await semanticRecallMemories(incidents, 4);
  } catch {
    /* Existing feedback/FTS recall is independent of pgvector or Ollama availability. */
  }
  const combined = [
    ...new Map([...r.rows, ...semantic].map((m) => [m.memory_id, m])).values(),
  ];
  if (combined.length)
    await db.query(
      "UPDATE agent.memory SET retrieved_count=retrieved_count+1 WHERE memory_id=ANY($1::uuid[])",
      [combined.map((x) => x.memory_id)],
    );
  return combined;
}
export async function activeIncidents() {
  return (
    await db.query(
      `SELECT * FROM agent.incident WHERE status<>'resolved' AND target_id IN ('primary','standby') ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,first_seen_at`,
    )
  ).rows;
}
export async function upsertIncident(d) {
  return transaction(async (c) => {
    const previous = (
      await c.query(
        "SELECT * FROM agent.incident WHERE fingerprint=$1 FOR UPDATE",
        [d.fingerprint],
      )
    ).rows[0];
    if (previous) {
      const reopened = previous.status === "resolved";
      const row = (
        await c.query(
          `UPDATE agent.incident SET title=$2,severity=$3,summary=$4,evidence=$5,last_seen_at=now(),status=CASE WHEN status='resolved' THEN 'open' ELSE status END,generation=generation+$6,resolved_at=NULL WHERE incident_id=$1 RETURNING *`,
          [
            previous.incident_id,
            d.title,
            d.severity,
            d.summary,
            d.evidence,
            reopened ? 1 : 0,
          ],
        )
      ).rows[0];
      if (reopened)
        await event(
          "incident.reopened",
          d.title,
          { kind: d.kind, evidence: d.evidence, generation: row.generation },
          { incidentId: row.incident_id, severity: d.severity },
          c,
        );
      return row;
    }
    const row = (
      await c.query(
        `INSERT INTO agent.incident(target_id,fingerprint,kind,title,severity,summary,evidence) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          d.target,
          d.fingerprint,
          d.kind,
          d.title,
          d.severity,
          d.summary,
          d.evidence,
        ],
      )
    ).rows[0];
    await event(
      "incident.detected",
      d.title,
      { kind: d.kind, evidence: d.evidence },
      { incidentId: row.incident_id, severity: d.severity },
      c,
    );
    return row;
  });
}
export async function resolveAbsent(currentFingerprints, healthyTargets) {
  const rows = (
    await db.query(
      `UPDATE agent.incident SET status='resolved',resolved_at=now() WHERE status<>'resolved' AND target_id=ANY($1::text[]) AND NOT(fingerprint=ANY($2::text[])) RETURNING *`,
      [healthyTargets, currentFingerprints],
    )
  ).rows;
  for (const row of rows)
    await event(
      "incident.recovered",
      row.title,
      { reason: "A fresh observation no longer meets the detector condition." },
      { incidentId: row.incident_id },
    );
}
export async function reviewIncident(incident, reason, runId) {
  return transaction(async (c) => {
    const existing = (
      await c.query(
        `SELECT * FROM agent.review WHERE incident_id=$1 AND generation=$2 AND review_type='investigation' AND status='pending'`,
        [incident.incident_id, incident.generation],
      )
    ).rows[0];
    if (existing) return existing;
    const r = (
      await c.query(
        `INSERT INTO agent.review(incident_id,generation,review_type,title,reason,evidence) VALUES($1,$2,'investigation',$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *`,
        [
          incident.incident_id,
          incident.generation,
          "Review: " + incident.title,
          reason,
          incident.evidence,
        ],
      )
    ).rows[0];
    if (r)
      await event(
        "review.queued",
        r.title,
        { reason },
        { incidentId: incident.incident_id, runId },
        c,
      );
    return r;
  });
}
export async function submitReview(id, decision, feedback, actor = "operator") {
  if (!["approve", "reject", "complete"].includes(decision))
    throw Object.assign(
      new Error("Decision must be approve, reject or complete"),
      { statusCode: 400 },
    );
  if (typeof feedback !== "string" || feedback.length > 4000)
    throw Object.assign(
      new Error("Feedback must be text up to 4000 characters"),
      { statusCode: 400 },
    );
  return transaction(async (c) => {
    const r = (
      await c.query(
        "SELECT * FROM agent.review WHERE review_id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!r)
      throw Object.assign(new Error("Review not found"), { statusCode: 404 });
    if (r.status !== "pending")
      return { review: mapReview(r), idempotent: true };
    if (r.review_type === "approval" && decision === "complete")
      throw Object.assign(
        new Error("An action approval requires approve or reject"),
        { statusCode: 400 },
      );
    if (r.review_type !== "approval" && decision !== "complete")
      throw Object.assign(
        new Error("An acknowledgement or investigation requires complete"),
        { statusCode: 400 },
      );
    const status =
      decision === "approve"
        ? "approved"
        : decision === "reject"
          ? "rejected"
          : "completed";
    const next = (
      await c.query(
        `UPDATE agent.review SET status=$2,feedback=$3,reviewed_by=$4,completed_at=now() WHERE review_id=$1 RETURNING *`,
        [id, status, feedback, actor],
      )
    ).rows[0];
    if (r.action_id && r.review_type === "approval")
      await c.query(
        `UPDATE agent.action SET status=$2 WHERE action_id=$1 AND status='pending_approval'`,
        [r.action_id, decision === "approve" ? "queued" : "rejected"],
      );
    const i = r.incident_id
      ? (
          await c.query(
            "SELECT kind FROM agent.incident WHERE incident_id=$1",
            [r.incident_id],
          )
        ).rows[0]
      : null;
    await c.query(
      `INSERT INTO agent.memory(kind,title,content,incident_id,action_id,review_id,metadata) VALUES('human_feedback',$1,$2,$3,$4,$5,$6) ON CONFLICT(review_id) DO NOTHING`,
      [
        r.title,
        `${status}: ${feedback || "Human reviewed the evidence."}`,
        r.incident_id,
        r.action_id,
        id,
        {
          incidentKind: i?.kind || null,
          decision: status,
          reviewType: r.review_type,
          generation: r.generation,
        },
      ],
    );
    await event(
      "human.reviewed",
      r.title,
      { decision: status, feedback, incidentConditionUnchanged: true },
      { incidentId: r.incident_id, actionId: r.action_id },
      c,
    );
    await c.query(
      "UPDATE agent.runtime SET cycle_requested_at=now() WHERE singleton",
    );
    return { review: mapReview(next), idempotent: false };
  });
}
export const mapReview = (r) => ({
  id: r.review_id,
  incidentId: r.incident_id,
  actionId: r.action_id,
  generation: r.generation,
  title: r.title,
  type: r.review_type === "investigation" ? "acknowledgement" : r.review_type,
  status: r.status,
  reason: r.reason,
  evidence: r.evidence,
  proposedAction: r.proposed_action,
  createdAt: timestamp(r.created_at),
  completedAt: timestamp(r.completed_at),
  feedback: r.feedback,
});
export async function lease(owner) {
  const r = await db.query(
    `INSERT INTO agent.lease(lease_key,owner,expires_at) VALUES('worker',$1,now()+interval '5 minutes') ON CONFLICT(lease_key) DO UPDATE SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at,fencing_token=agent.lease.fencing_token+1 WHERE agent.lease.owner=EXCLUDED.owner OR agent.lease.expires_at<now() RETURNING fencing_token`,
    [owner],
  );
  return r.rows[0]?.fencing_token || null;
}
