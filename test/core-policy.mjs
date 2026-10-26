import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_POLICY,
  ACTION_SPECS,
  normalizePolicy,
  validateProposal,
  needsApproval,
  isStatsStale,
  replicationConcern,
  safeQueryText,
} from "../apps/server/policy.mjs";
test("human policy changes are typed and bounded", () => {
  assert.equal(
    normalizePolicy({ requireApprovalForResume: true })
      .requireApprovalForResume,
    true,
  );
  assert.throws(() => normalizePolicy({ paused: "false" }));
  assert.throws(() => normalizePolicy({ maxActionsPerHour: 61 }));
  assert.throws(() => normalizePolicy({ monitorIntervalSeconds: 0 }));
  assert.throws(() => normalizePolicy({ directive: "x".repeat(2001) }));
});
test("fixed action registry cannot accept arbitrary SQL or identifiers", () => {
  assert.equal(Object.keys(ACTION_SPECS).length, 5);
  for (const s of Object.values(ACTION_SPECS))
    assert.match(s.sql, /^SELECT ops\.[a-z_]+\(\);$/);
  assert.throws(() =>
    validateProposal({
      tool: "DROP TABLE",
      incident: {},
      inspected: new Set(),
      policy: DEFAULT_POLICY,
    }),
  );
});
test("inspection, incident kind and target all gate the proposed action", () => {
  const i = {
    kind: "replication-paused",
    target_id: "standby",
    status: "open",
  };
  assert.throws(() =>
    validateProposal({
      tool: "resume_replication",
      incident: i,
      inspected: new Set(),
      policy: DEFAULT_POLICY,
    }),
  );
  assert.equal(
    validateProposal({
      tool: "resume_replication",
      incident: i,
      inspected: new Set(["inspect_replication"]),
      policy: DEFAULT_POLICY,
    }).target,
    "standby",
  );
  assert.throws(() =>
    validateProposal({
      tool: "resume_replication",
      incident: { ...i, target_id: "primary" },
      inspected: new Set(["inspect_replication"]),
      policy: DEFAULT_POLICY,
    }),
  );
  assert.throws(() =>
    validateProposal({
      tool: "resume_replication",
      incident: { ...i, status: "resolved" },
      inspected: new Set(["inspect_replication"]),
      policy: DEFAULT_POLICY,
    }),
  );
  assert.throws(() =>
    validateProposal({
      tool: "resume_replication",
      incident: i,
      inspected: new Set(["inspect_replication"]),
      policy: { ...DEFAULT_POLICY, paused: true },
    }),
  );
});
test("current policy can require approval after an automatic proposal", () => {
  assert.equal(
    needsApproval("resume_replication", DEFAULT_POLICY, undefined),
    false,
  );
  assert.equal(
    needsApproval(
      "resume_replication",
      { ...DEFAULT_POLICY, requireApprovalForResume: true },
      undefined,
    ),
    true,
  );
  assert.equal(
    needsApproval(
      "resume_replication",
      { ...DEFAULT_POLICY, requireApprovalForResume: true },
      "approved",
    ),
    false,
  );
  assert.equal(
    needsApproval("resume_replication", DEFAULT_POLICY, "pending"),
    true,
  );
  assert.equal(
    needsApproval("resume_replication", DEFAULT_POLICY, "rejected"),
    true,
  );
});
test("unknown and idle replication lag are not represented as zero-lag incidents", () => {
  assert.equal(
    replicationConcern({
      status: "healthy",
      replication: {
        lagBytes: null,
        lagSeconds: null,
        connected: true,
        replayPaused: false,
      },
    }),
    null,
  );
  assert.equal(
    replicationConcern({
      status: "healthy",
      replication: { lagBytes: 0, connected: true, replayPaused: true },
    }),
    "replication-paused",
  );
  assert.equal(
    replicationConcern({
      status: "healthy",
      replication: { connected: false },
    }),
    "replication-disconnected",
  );
  assert.equal(replicationConcern({ status: "unavailable" }), "unavailable");
});
test("stale statistics require measured row modifications", () => {
  assert.equal(isStatsStale(undefined), false);
  assert.equal(
    isStatsStale({ n_live_tup: 75000, n_mod_since_analyze: 10000 }),
    true,
  );
  assert.equal(
    isStatsStale({ n_live_tup: 75000, n_mod_since_analyze: 100 }),
    false,
  );
});
test("untrusted query text is bounded display data", () => {
  assert.equal(safeQueryText("a\u0000b"), "ab");
  assert.equal(safeQueryText("x".repeat(4000)).length, 2000);
});
