/** Control-only regressions. Never injects a target fault or executes a target tool. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
const moduleUrl = (file) => pathToFileURL(path.resolve("apps/server", file));
const { db, transaction, submitReview, reviewIncident } = await import(
  moduleUrl("store.mjs")
);
const { escalateExhaustedActions } = await import(moduleUrl("actions.mjs"));
const { closePools } = await import(moduleUrl("config.mjs"));
const key = "regression-control-" + randomUUID();
let incidentId, actionId, exhaustedId, approvalId, ackId;
try {
  await transaction(async (c) => {
    incidentId = (
      await c.query(
        `INSERT INTO agent.incident(target_id,fingerprint,kind,title,severity,status,summary) VALUES('primary',$1,'risky-role','Control-only reliability regression','info','resolved','A temporary test record, not a measured target finding') RETURNING incident_id`,
        [key],
      )
    ).rows[0].incident_id;
    actionId = (
      await c.query(
        `INSERT INTO agent.action(incident_id,generation,target_id,idempotency_key,tool,title,status,risk,reason) VALUES($1,1,'primary',$2,'restrict_demo_role','Control-only terminal action','succeeded','bounded','No target execution; validates approval and acknowledgement feedback') RETURNING action_id`,
        [incidentId, key],
      )
    ).rows[0].action_id;
    approvalId = (
      await c.query(
        `INSERT INTO agent.review(incident_id,action_id,review_type,title,reason) VALUES($1,$2,'approval','Regression approval','Tests feedback memory linkage') RETURNING review_id`,
        [incidentId, actionId],
      )
    ).rows[0].review_id;
    ackId = (
      await c.query(
        `INSERT INTO agent.review(incident_id,action_id,review_type,title,reason) VALUES($1,$2,'acknowledgement','Regression acknowledgement','Tests feedback memory linkage') RETURNING review_id`,
        [incidentId, actionId],
      )
    ).rows[0].review_id;
  });
  assert.equal(
    (await submitReview(approvalId, "approve", "Approval feedback")).review
      .status,
    "approved",
  );
  assert.equal(
    (await submitReview(ackId, "complete", "Acknowledgement feedback")).review
      .status,
    "completed",
  );
  assert.equal(
    (
      await submitReview(
        ackId,
        "complete",
        "Repeated feedback must not add memory",
      )
    ).idempotent,
    true,
  );
  const memories = (
    await db.query(
      `SELECT review_id,content FROM agent.memory WHERE action_id=$1 AND kind='human_feedback' ORDER BY created_at`,
      [actionId],
    )
  ).rows;
  assert.equal(memories.length, 2);
  assert.deepEqual(
    new Set(memories.map((m) => m.review_id)),
    new Set([approvalId, ackId]),
  );
  assert.ok(memories.some((m) => m.content.includes("Approval feedback")));
  assert.ok(
    memories.some((m) => m.content.includes("Acknowledgement feedback")),
  );
  assert.equal(
    (
      await db.query("SELECT status FROM agent.action WHERE action_id=$1", [
        actionId,
      ])
    ).rows[0].status,
    "succeeded",
  );
  console.log(
    "PASS: one action retains separate approval and acknowledgement feedback; repeated completion is idempotent.",
  );

  let incident = (
    await db.query("SELECT * FROM agent.incident WHERE incident_id=$1", [
      incidentId,
    ])
  ).rows[0];
  const oldReview = await reviewIncident(
    incident,
    "Generation one still awaits acknowledgement",
  );
  incident = (
    await db.query(
      "UPDATE agent.incident SET generation=2 WHERE incident_id=$1 RETURNING *",
      [incidentId],
    )
  ).rows[0];
  const newReview = await reviewIncident(
    incident,
    "Generation two needs a fresh investigation",
  );
  assert.notEqual(oldReview.review_id, newReview.review_id);
  assert.equal(newReview.generation, 2);
  assert.equal(
    (await reviewIncident(incident, "Do not duplicate generation two"))
      .review_id,
    newReview.review_id,
  );
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int AS count FROM agent.review WHERE incident_id=$1 AND review_type='investigation' AND status='pending'`,
        [incidentId],
      )
    ).rows[0].count,
    2,
  );
  console.log(
    "PASS: a pending investigation from generation one does not block generation two; each generation deduplicates.",
  );

  exhaustedId = (
    await db.query(
      `INSERT INTO agent.action(incident_id,generation,target_id,idempotency_key,tool,title,status,risk,reason,attempts,claimed_until,before_evidence) VALUES($1,2,'primary',$2,'restrict_demo_role','Control-only uncertain outcome','running','bounded','No target execution; validates exhausted recovery',2,now()-interval '1 second','{"retainedEvidence":true}') RETURNING action_id`,
      [incidentId, key + "-exhausted"],
    )
  ).rows[0].action_id;
  await escalateExhaustedActions();
  const exhausted = (
    await db.query("SELECT * FROM agent.action WHERE action_id=$1", [
      exhaustedId,
    ])
  ).rows[0];
  assert.equal(exhausted.status, "failed");
  assert.equal(exhausted.attempts, 2);
  assert.equal(exhausted.before_evidence.retainedEvidence, true);
  assert.match(exhausted.error, /No third target write/);
  assert.ok(
    (
      await db.query(
        `SELECT 1 FROM agent.review WHERE incident_id=$1 AND generation=2 AND review_type='investigation' AND status='pending' AND reason LIKE '%No third target write%'`,
        [incidentId],
      )
    ).rowCount,
  );
  assert.equal(
    (
      await db.query("SELECT status FROM agent.incident WHERE incident_id=$1", [
        incidentId,
      ])
    ).rows[0].status,
    "resolved",
  );
  console.log(
    "PASS: an expired final attempt becomes a human investigation without attempt three or reopening resolved evidence.",
  );
} finally {
  if (incidentId)
    await transaction(async (c) => {
      await c.query("DELETE FROM agent.memory WHERE incident_id=$1", [
        incidentId,
      ]);
      await c.query("DELETE FROM agent.event WHERE incident_id=$1", [
        incidentId,
      ]);
      await c.query("DELETE FROM agent.review WHERE incident_id=$1", [
        incidentId,
      ]);
      await c.query("DELETE FROM agent.action WHERE incident_id=$1", [
        incidentId,
      ]);
      await c.query("DELETE FROM agent.incident WHERE incident_id=$1", [
        incidentId,
      ]);
    });
  await closePools();
}
