import test from "node:test";
import assert from "node:assert/strict";
import {
  collectReplicationEvidence,
  exclusiveTask,
  shouldEscalateExpiredAction,
  steeringChanged,
} from "../apps/server/control-flow.mjs";

test("planner reservation prevents overlap even while asynchronous setup is unresolved", async () => {
  let release;
  let calls = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const work = exclusiveTask(async () => {
    calls++;
    await gate;
    return "done";
  });
  const first = work();
  assert.equal(work.busy, true);
  assert.deepEqual(await work(), { skipped: true });
  assert.equal(calls, 1);
  release();
  assert.equal(await first, "done");
  assert.equal(work.busy, false);
  assert.equal(await work(), "done");
  assert.equal(calls, 2);
});

test("setup and reporting failures release the reservation without an unhandled rejection", async () => {
  let reports = 0;
  const work = exclusiveTask(
    async () => {
      throw new Error("setup failed");
    },
    async () => {
      reports++;
      throw new Error("reporting also unavailable");
    },
  );
  assert.deepEqual(await work(), { error: "setup failed" });
  assert.equal(work.busy, false);
  assert.deepEqual(await work(), { error: "setup failed" });
  assert.equal(reports, 2);
});

test("primary failure retains independent standby recovery and receiver evidence", async () => {
  const standby = {
    recovery: true,
    replay_paused: true,
    receiver_status: "streaming",
  };
  const evidence = await collectReplicationEvidence(
    () => {
      throw new Error("primary unreachable");
    },
    async () => standby,
  );
  assert.equal(evidence.primaryError, "primary unreachable");
  assert.deepEqual(evidence.primarySenders, []);
  assert.deepEqual(evidence.standby, standby);
});

test("standby failure retains primary WAL evidence without inventing receiver state", async () => {
  const senders = [{ lag_bytes: 512, lag_seconds: null }];
  const evidence = await collectReplicationEvidence(
    async () => senders,
    async () => {
      throw new Error("standby unreachable");
    },
  );
  assert.deepEqual(evidence.primarySenders, senders);
  assert.equal(evidence.standby.error, "standby unreachable");
  assert.equal(evidence.standby.receiver_status, undefined);
  assert.equal(evidence.primarySenders[0].lag_seconds, null);
});

test("changed steering restarts planning while unchanged directives remain valid", () => {
  assert.equal(
    steeringChanged(
      { directive: "Diagnose only" },
      { directive: "Repair demo" },
    ),
    true,
  );
  assert.equal(
    steeringChanged(
      { directive: "Diagnose only" },
      { directive: "Diagnose only" },
    ),
    false,
  );
  assert.equal(steeringChanged({}, { directive: "" }), false);
});

test("only an expired final bounded attempt becomes an uncertain-outcome investigation", () => {
  const now = Date.now();
  const action = {
    status: "running",
    attempts: 2,
    claimed_until: new Date(now - 1000),
  };
  assert.equal(shouldEscalateExpiredAction(action, now), true);
  assert.equal(
    shouldEscalateExpiredAction({ ...action, attempts: 1 }, now),
    false,
  );
  assert.equal(
    shouldEscalateExpiredAction(
      { ...action, claimed_until: new Date(now + 1000) },
      now,
    ),
    false,
  );
  assert.equal(
    shouldEscalateExpiredAction({ ...action, claimed_until: "invalid" }, now),
    false,
  );
  assert.equal(
    shouldEscalateExpiredAction({ ...action, claimed_until: null }, now),
    false,
  );
  assert.equal(
    shouldEscalateExpiredAction({ ...action, status: "succeeded" }, now),
    false,
  );
});
