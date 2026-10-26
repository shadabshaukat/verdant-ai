import { shouldEscalateExpiredAction } from "./control-flow.mjs";
import { desiredState, precondition } from "./evidence.mjs";
import { pools, errText } from "./config.mjs";
import { db, transaction, event, policy as readPolicy } from "./store.mjs";
import { ACTION_SPECS, validateProposal, needsApproval } from "./policy.mjs";
import {
  inspectStatistics,
  inspectReplication,
  inspectQueries,
  inspectSecurity,
  inspectBlockers,
} from "./monitor.mjs";
export async function inspectForAction(tool) {
  switch (tool) {
    case "analyze_table":
      return inspectStatistics();
    case "resume_replication":
      return inspectReplication();
    case "create_demo_index":
      return inspectQueries();
    case "restrict_demo_role":
      return inspectSecurity();
    case "cancel_demo_blocker":
      return inspectBlockers();
    default:
      throw new Error("Unsupported fixed action");
  }
}
export async function proposeAction({
  tool,
  incident,
  reason,
  inspected,
  runId,
}) {
  const p = await readPolicy();
  const spec = validateProposal({ tool, incident, inspected, policy: p });
  if (typeof reason !== "string" || reason.length < 5 || reason.length > 1000)
    throw new Error("Provide a concise evidence-based reason");
  const currentEvidence = await inspectForAction(tool);
  if (!precondition(tool, currentEvidence))
    return {
      status: "condition_changed",
      message: "Fresh evidence no longer permits this action.",
      evidence: currentEvidence,
    };
  const result = await transaction(async (c) => {
    await c.query(
      "SELECT incident_id FROM agent.incident WHERE incident_id=$1 FOR UPDATE",
      [incident.incident_id],
    );
    const key = incident.incident_id + ":" + incident.generation + ":" + tool;
    let row = (
      await c.query(
        `INSERT INTO agent.action(incident_id,generation,target_id,idempotency_key,tool,title,status,risk,reason,before_evidence,proposed_by,sql_template) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ollama',$11) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`,
        [
          incident.incident_id,
          incident.generation,
          spec.target,
          key,
          tool,
          spec.title,
          spec.auto(p) ? "queued" : "pending_approval",
          spec.risk,
          reason,
          currentEvidence,
          spec.sql,
        ],
      )
    ).rows[0];
    if (!row)
      return {
        action: (
          await c.query("SELECT * FROM agent.action WHERE idempotency_key=$1", [
            key,
          ])
        ).rows[0],
        existing: true,
      };
    if (row.status === "pending_approval") {
      await c.query(
        `INSERT INTO agent.review(incident_id,action_id,generation,review_type,title,reason,evidence,proposed_action) VALUES($1,$2,$3,'approval',$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [
          incident.incident_id,
          row.action_id,
          row.generation,
          spec.title,
          reason,
          currentEvidence,
          { tool, sql: spec.sql, target: spec.target },
        ],
      );
      await c.query(
        `UPDATE agent.incident SET status='awaiting_approval' WHERE incident_id=$1`,
        [incident.incident_id],
      );
    }
    await event(
      row.status === "queued" ? "action.proposed" : "review.approval_requested",
      spec.title,
      { tool, reason, policyDecision: row.status },
      { incidentId: incident.incident_id, actionId: row.action_id, runId },
      c,
    );
    return { action: row, existing: false };
  });
  if (result.action.status === "queued")
    return executeAction(result.action.action_id, runId);
  return {
    status: result.action.status,
    actionId: result.action.action_id,
    existing: result.existing,
    title: spec.title,
  };
}
export async function executeAction(id, runId = null) {
  const p = await readPolicy();
  if (p.paused) return { status: "paused", actionId: id };
  const owner = process.env.HOSTNAME || "local-worker";
  const action = await transaction(async (c) => {
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtext('verdant-action-budget'))",
    );
    const budget = (
      await c.query(
        `SELECT count(*)::int AS count FROM agent.action WHERE started_at>now()-interval '1 hour' AND status IN ('running','succeeded','failed')`,
      )
    ).rows[0].count;
    if (budget >= p.maxActionsPerHour) return null;
    return (
      await c.query(
        `UPDATE agent.action SET status='running',claimed_by=$2,claimed_until=now()+interval '90 seconds',started_at=coalesce(started_at,now()),attempts=attempts+1 WHERE action_id=$1 AND attempts<2 AND (status='queued' OR (status='running' AND claimed_until<now())) RETURNING *`,
        [id, owner],
      )
    ).rows[0];
  });
  if (!action) return { status: "not_claimed", actionId: id };
  const spec = ACTION_SPECS[action.tool];
  try {
    if (!spec) throw new Error("Saved action is outside the fixed registry");
    const incident = (
      await db.query("SELECT * FROM agent.incident WHERE incident_id=$1", [
        action.incident_id,
      ])
    ).rows[0];
    if (!incident || incident.generation !== action.generation)
      throw new Error("Incident generation changed; saved proposal is stale");
    const before = await inspectForAction(action.tool);
    let execution = { recovered: false };
    if (!precondition(action.tool, before)) {
      if (!desiredState(action.tool, before))
        throw new Error(
          "Fresh evidence does not satisfy the guarded action precondition",
        );
      execution = {
        recovered: true,
        message: "Desired state already observed. No second target write.",
      };
    } else {
      const freshPolicy = await readPolicy();
      if (freshPolicy.paused)
        throw new Error("Operator paused actions before execution");
      const approving = (
        await db.query(
          `SELECT status FROM agent.review WHERE action_id=$1 AND review_type='approval'`,
          [id],
        )
      ).rows[0];
      if (needsApproval(action.tool, freshPolicy, approving?.status)) {
        await transaction(async (c) => {
          await c.query(
            `UPDATE agent.action SET status='pending_approval',claimed_until=NULL,attempts=greatest(0,attempts-1) WHERE action_id=$1`,
            [id],
          );
          await c.query(
            `INSERT INTO agent.review(incident_id,action_id,generation,review_type,title,reason,evidence,proposed_action) VALUES($1,$2,$3,'approval',$4,$5,$6,$7) ON CONFLICT(action_id,review_type) DO NOTHING`,
            [
              action.incident_id,
              id,
              action.generation,
              spec.title,
              "Current human policy requires approval before this exact action.",
              before,
              { tool: action.tool, sql: spec.sql, target: spec.target },
            ],
          );
          await c.query(
            `UPDATE agent.incident SET status='awaiting_approval' WHERE incident_id=$1`,
            [action.incident_id],
          );
          await event(
            "review.policy_gate",
            spec.title,
            {
              reason:
                "The policy changed after the proposal. No target write executed.",
            },
            { incidentId: action.incident_id, actionId: id, runId },
            c,
          );
        });
        return { status: "pending_approval", actionId: id };
      }
      const leaseRow = (
        await db.query(
          `SELECT owner FROM agent.lease WHERE lease_key='worker' AND owner=$1 AND expires_at>now()`,
          [owner],
        )
      ).rows[0];
      if (!leaseRow)
        throw new Error("Worker lease is no longer held; target write refused");
      await db.query(
        `UPDATE agent.incident SET status='remediating' WHERE incident_id=$1`,
        [action.incident_id],
      );
      await db.query(
        `UPDATE agent.action SET before_evidence=$2 WHERE action_id=$1`,
        [id, before],
      );
      action.before_evidence = before;
      await event(
        "action.started",
        spec.title,
        { tool: action.tool, sql: spec.sql, before },
        { incidentId: action.incident_id, actionId: id, runId },
      );
      const pool =
        spec.target === "standby" ? pools.STANDBY_ACTION : pools.PRIMARY_ACTION;
      execution = { result: (await pool.query(spec.sql)).rows };
    }
    let after;
    let verified = false;
    for (let i = 0; i < 10; i++) {
      after = await inspectForAction(action.tool);
      if (desiredState(action.tool, after)) {
        verified = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    if (!verified)
      throw Object.assign(
        new Error("The target change did not pass a fresh verification"),
        { after },
      );
    await transaction(async (c) => {
      await c.query(
        `UPDATE agent.action SET status='succeeded',after_evidence=$2,verified_at=now(),claimed_until=NULL,error=NULL WHERE action_id=$1`,
        [id, { execution, verification: after }],
      );
      await c.query(
        `UPDATE agent.incident SET status='resolved',resolved_at=now() WHERE incident_id=$1 AND generation=$2`,
        [action.incident_id, action.generation],
      );
      await c.query(
        `INSERT INTO agent.review(incident_id,action_id,generation,review_type,title,reason,evidence,proposed_action) VALUES($1,$2,$3,'acknowledgement',$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [
          action.incident_id,
          id,
          action.generation,
          "Check completed action: " + spec.title,
          "The action passed database verification. Review the evidence and leave feedback for later cycles.",
          { before: action.before_evidence, after },
          { tool: action.tool, sql: spec.sql },
        ],
      );
      await event(
        "action.verified",
        spec.title,
        { verification: after, recovered: execution.recovered },
        { incidentId: action.incident_id, actionId: id, runId },
        c,
      );
      await c.query(
        `INSERT INTO agent.memory(kind,title,content,incident_id,action_id,metadata) VALUES('verified_action',$1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [
          spec.title,
          "Verified " + action.tool + ". " + action.reason,
          action.incident_id,
          id,
          {
            incidentKind: incident.kind,
            before: action.before_evidence,
            after,
          },
        ],
      );
    });
    return {
      status: "succeeded",
      actionId: id,
      tool: action.tool,
      title: spec.title,
      verified: true,
      after,
    };
  } catch (e) {
    await db.query(
      `UPDATE agent.action SET status='failed',error=$2,after_evidence=$3,claimed_until=NULL WHERE action_id=$1`,
      [id, errText(e), e.after || {}],
    );
    await db.query(
      `UPDATE agent.incident SET status='open' WHERE incident_id=$1 AND status<>'resolved'`,
      [action.incident_id],
    );
    await event(
      "action.failed",
      spec?.title || action.tool,
      { error: errText(e) },
      {
        severity: "warning",
        incidentId: action.incident_id,
        actionId: id,
        runId,
      },
    );
    await db.query(
      `INSERT INTO agent.review(incident_id,action_id,generation,review_type,title,reason,evidence) VALUES($1,$2,$3,'acknowledgement',$4,$5,$6) ON CONFLICT DO NOTHING`,
      [
        action.incident_id,
        id,
        action.generation,
        "Inspect failed action: " + action.tool,
        errText(e),
        { before: action.before_evidence, after: e.after || null },
      ],
    );
    return { status: "failed", actionId: id, error: errText(e) };
  }
}
/** A stopped final attempt has an uncertain target outcome; never issue a third write. */
export async function escalateExhaustedActions(runId = null) {
  return transaction(async (c) => {
    const rows = (
      await c.query(
        `SELECT * FROM agent.action WHERE status='running' AND attempts>=2 AND claimed_until<now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 10`,
      )
    ).rows;
    const escalated = [];
    for (const action of rows) {
      if (!shouldEscalateExpiredAction(action)) continue;
      const reason =
        "The worker stopped during its final bounded attempt. The target outcome is uncertain. No third target write will be issued; inspect the database and saved evidence.";
      await c.query(
        `UPDATE agent.action SET status='failed',error=$2,claimed_until=NULL WHERE action_id=$1`,
        [action.action_id, reason],
      );
      await c.query(
        `UPDATE agent.incident SET status='open' WHERE incident_id=$1 AND generation=$2 AND status<>'resolved'`,
        [action.incident_id, action.generation],
      );
      await c.query(
        `INSERT INTO agent.review(incident_id,action_id,generation,review_type,title,reason,evidence) VALUES($1,$2,$3,'investigation',$4,$5,$6) ON CONFLICT (incident_id,generation,review_type) WHERE review_type='investigation' AND status='pending' DO UPDATE SET title=EXCLUDED.title,reason=EXCLUDED.reason,evidence=EXCLUDED.evidence,action_id=coalesce(agent.review.action_id,EXCLUDED.action_id)`,
        [
          action.incident_id,
          action.action_id,
          action.generation,
          "Investigate uncertain outcome: " + action.title,
          reason,
          {
            before: action.before_evidence,
            after: action.after_evidence,
            attempts: action.attempts,
            targetWriteExecutedByRecovery: false,
          },
        ],
      );
      await event(
        "action.uncertain",
        action.title,
        {
          reason,
          attempts: action.attempts,
          targetWriteExecutedByRecovery: false,
        },
        {
          incidentId: action.incident_id,
          actionId: action.action_id,
          runId,
          severity: "warning",
        },
        c,
      );
      escalated.push(action.action_id);
    }
    return escalated;
  });
}
export async function executeQueued(runId) {
  await escalateExhaustedActions(runId);
  const rows = (
    await db.query(
      `SELECT action_id FROM agent.action WHERE (status='queued' OR (status='running' AND claimed_until<now())) AND attempts<2 ORDER BY created_at LIMIT 3`,
    )
  ).rows;
  const out = [];
  for (const r of rows) out.push(await executeAction(r.action_id, runId));
  return out;
}
