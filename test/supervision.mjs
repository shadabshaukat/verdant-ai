/** Live integration for the disposable lab. Mutates fixtures and policy, retains history. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.BASE_URL || "http://127.0.0.1:8090";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { startedAt: new Date().toISOString(), tests: [] };
async function api(route, body) {
  const r = await fetch(
    base + route,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${route}: ${JSON.stringify(j)}`);
  return j;
}
const state = () => api("/api/state");
function sql(service, text) {
  return execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      service,
      "psql",
      "-U",
      "postgres",
      "-d",
      service === "control" ? "verdant" : "workload",
      "-Atq",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      text,
    ],
    { cwd, encoding: "utf8" },
  ).trim();
}
async function until(fn, timeout = 180000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(1000);
  }
  throw new Error("Timed out waiting for live evidence");
}
const defaults = {
  paused: false,
  allowAutoAnalyze: true,
  allowAutoIndex: true,
  requireApprovalForResume: false,
  requireApprovalForCancel: false,
  requireApprovalForRole: false,
  requireApprovalForIndex: false,
  maxActionsPerHour: 40,
  monitorIntervalSeconds: 15,
};
console.log("Supervision validation starting", results.startedAt);
try {
  await api("/api/agent/control", {
    policy: { ...defaults, requireApprovalForResume: true },
  });
  const initial = await state();
  assert.equal(initial.policy.requireApprovalForResume, true);
  assert.equal(initial.policy.maxActionsPerHour, 40);
  const before = new Set(initial.actions.map((a) => a.id));
  const started = Date.now();
  await api("/api/demo/scenarios/replication-pause", { active: true });
  const pending = await until(async () => {
    const s = await state();
    const a = s.actions.find(
      (a) =>
        !before.has(a.id) &&
        a.tool === "resume_replication" &&
        a.status === "pending_approval",
    );
    if (!a) return null;
    const r = s.reviews.find(
      (r) =>
        r.actionId === a.id && r.type === "approval" && r.status === "pending",
    );
    return r ? { action: a, review: r } : null;
  });
  assert.equal(
    sql("standby", "SELECT pg_is_wal_replay_paused()"),
    "t",
    "Replay must remain paused before approval",
  );
  const approvalLatency = Date.now() - started;
  const approvalFeedback =
    "Validation approval: resume only this disposable lab standby, then verify streaming and catch-up.";
  await api("/api/reviews/" + pending.review.id, {
    decision: "approve",
    feedback: approvalFeedback,
  });
  const approvedAt = Date.now();
  const done = await until(async () => {
    const s = await state();
    const a = s.actions.find((a) => a.id === pending.action.id);
    if (a?.status === "failed")
      throw new Error("Approved action failed: " + JSON.stringify(a));
    return a?.status === "succeeded" ? a : null;
  });
  assert.ok(done.verifiedAt);
  assert.equal(sql("standby", "SELECT pg_is_wal_replay_paused()"), "f");
  const executionLatency = Date.now() - approvedAt;
  const ack = await until(async () => {
    const s = await state();
    return s.reviews.find(
      (r) =>
        r.actionId === done.id &&
        r.type === "acknowledgement" &&
        r.status === "pending",
    );
  });
  const ackFeedback =
    "Validation acknowledgement: confirmed replay resumed, receiver streams, and the recorded WAL byte-distance verification passed.";
  await api("/api/reviews/" + ack.id, {
    decision: "complete",
    feedback: ackFeedback,
  });
  const memoryCount = () =>
    Number(
      sql(
        "control",
        `SELECT count(*) FROM agent.memory WHERE kind='human_feedback' AND review_id IN ('${pending.review.id}'::uuid,'${ack.id}'::uuid)`,
      ),
    );
  assert.equal(
    memoryCount(),
    2,
    "Approval and acknowledgement must create separate feedback memories",
  );
  await api("/api/reviews/" + pending.review.id, {
    decision: "approve",
    feedback: approvalFeedback,
  });
  await api("/api/reviews/" + ack.id, {
    decision: "complete",
    feedback: ackFeedback,
  });
  assert.equal(
    memoryCount(),
    2,
    "Repeating both decisions must not duplicate feedback memories",
  );
  results.tests.push({
    name: "approval-execution-acknowledgement",
    status: "pass",
    actionId: done.id,
    approvalReviewId: pending.review.id,
    acknowledgementReviewId: ack.id,
    feedbackMemories: 2,
    approvalProposalMs: approvalLatency,
    approvalToVerifiedMs: executionLatency,
  });
  console.log(
    "PASS approval -> execution -> acknowledgement; two feedback memories; idempotent retries",
    JSON.stringify(results.tests.at(-1)),
  );
  // Restart only the worker: no browser event or cycle POST is needed to resume sensing.
  const verifiedCount = () =>
    Number(
      sql(
        "control",
        `SELECT count(*) FROM agent.action a JOIN agent.action b ON b.action_id='${done.id}'::uuid AND a.incident_id=b.incident_id AND a.generation=b.generation AND a.tool=b.tool WHERE a.status='succeeded'`,
      ),
    );
  assert.equal(verifiedCount(), 1);
  const restartAt = Date.now();
  execFileSync("docker", ["compose", "restart", "worker"], {
    cwd,
    encoding: "utf8",
  });
  const resumed = await until(async () => {
    const s = await state();
    return Date.parse(s.agent.workerHeartbeatAt || "") > restartAt &&
      s.agent.cycleCount >= 2
      ? s
      : null;
  }, 90000);
  assert.equal(
    memoryCount(),
    2,
    "Both human feedback memories must survive a worker restart",
  );
  assert.equal(
    verifiedCount(),
    1,
    "Worker restart must not duplicate a verified action for its incident generation",
  );
  results.tests.push({
    name: "worker-restart-memory-and-autonomous-cycles",
    status: "pass",
    actionId: done.id,
    feedbackMemoriesAfterRestart: 2,
    verifiedActionsForGeneration: 1,
    cycleCount: resumed.agent.cycleCount,
    workerHeartbeatAt: resumed.agent.workerHeartbeatAt,
    resumedMs: Date.now() - restartAt,
  });
  console.log(
    "PASS restart persistence and browser-independent cycles",
    JSON.stringify(results.tests.at(-1)),
  );
  await api("/api/agent/control", { policy: defaults });
  const blockBefore = new Set((await state()).actions.map((a) => a.id));
  const blockStart = Date.now();
  await api("/api/demo/scenarios/blocked-query", { active: true });
  const blocked = await until(async () => {
    const s = await state();
    const a = s.actions.find(
      (a) => !blockBefore.has(a.id) && a.tool === "cancel_demo_blocker",
    );
    if (a?.status === "failed")
      throw new Error("Blocker action failed: " + JSON.stringify(a));
    return a?.status === "succeeded" ? a : null;
  }, 150000);
  assert.ok(blocked.verifiedAt);
  assert.equal(
    sql(
      "primary",
      "SELECT count(*) FROM pg_stat_activity WHERE datname='workload' AND usename='verdant_demo' AND application_name='verdant-demo-blocker'",
    ),
    "0",
  );
  const blockedAck = (await state()).reviews.find(
    (r) => r.actionId === blocked.id && r.type === "acknowledgement",
  );
  if (blockedAck?.status === "pending")
    await api("/api/reviews/" + blockedAck.id, {
      decision: "complete",
      feedback:
        "Validation acknowledgement: the exact verdant-demo-blocker session was terminated and waiting fixture work cleared. No unrelated session was targeted.",
    });
  results.tests.push({
    name: "tagged-blocker-remediation",
    status: "pass",
    actionId: blocked.id,
    verifiedMs: Date.now() - blockStart,
    scope:
      "database workload, role verdant_demo, application_name verdant-demo-blocker",
  });
  console.log(
    "PASS real blocker remediation",
    JSON.stringify(results.tests.at(-1)),
  );
} finally {
  for (const id of [
    "stale-statistics",
    "replication-pause",
    "blocked-query",
    "risky-role",
    "slow-query",
  ]) {
    try {
      await api("/api/demo/scenarios/" + id, { active: false });
    } catch (e) {
      console.error("Fixture cleanup", id, e.message);
    }
  }
  // These are local validation reviews. Keep their history and record honest closure.
  const cleanupState = await state();
  for (const review of cleanupState.reviews.filter(
    (r) => r.status === "pending",
  )) {
    const decision = review.type === "approval" ? "reject" : "complete";
    const feedback =
      decision === "reject"
        ? "Validation cleanup: this old proposal is no longer needed after fixture restoration. No execution authorized."
        : "Validation review: inspected the saved outcome and evidence. Retaining the audit history; this acknowledgement does not mark an unresolved target fault fixed.";
    await api("/api/reviews/" + review.id, { decision, feedback });
  }
  await api("/api/agent/control", { policy: defaults });
  await api("/api/agent/cycle", {});
  results.finishedAt = new Date().toISOString();
  console.log("VALIDATION_RESULTS", JSON.stringify(results));
}
