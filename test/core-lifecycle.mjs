import test from "node:test";
import assert from "node:assert/strict";
import {
  createTaskTracker,
  drainWithin,
  workerHealth,
  requestSignal,
  shutdownController,
} from "../apps/server/lifecycle.mjs";
import { readinessSnapshot } from "../apps/server/readiness.mjs";

test("in-flight work remains tracked until its receipt settles, with a bounded drain", async () => {
  const tracker = createTaskTracker();
  let commit;
  const receipt = tracker.run(
    () =>
      new Promise((resolve) => {
        commit = resolve;
      }),
  );
  assert.equal(tracker.pending().length, 1);
  assert.equal(await drainWithin(tracker.pending(), 5), false);
  commit("receipt committed");
  assert.equal(await receipt, "receipt committed");
  assert.equal(await drainWithin(tracker.pending(), 50), true);
  assert.equal(tracker.pending().length, 0);
});
test("failed background work is removed from the drain set", async () => {
  const tracker = createTaskTracker();
  await assert.rejects(
    tracker.run(() => {
      throw new Error("test failure");
    }),
  );
  assert.equal(tracker.pending().length, 0);
});
test("worker health distinguishes never-started, healthy, stale and gracefully stopped states", () => {
  const now = Date.parse("2026-10-26T00:02:00Z");
  assert.equal(
    workerHealth(
      { heartbeat_at: new Date(now), state: { status: "starting" } },
      now,
    ).status,
    "starting",
  );
  assert.equal(
    workerHealth(
      { heartbeat_at: new Date(now), state: { workerStatus: "running" } },
      now,
    ).status,
    "healthy",
  );
  assert.equal(
    workerHealth(
      {
        heartbeat_at: new Date(now - 61000),
        state: { workerStatus: "running" },
      },
      now,
    ).status,
    "stale",
  );
  assert.equal(
    workerHealth(
      { heartbeat_at: new Date(now), state: { workerStatus: "stopped" } },
      now,
    ).status,
    "stopped",
  );
});
test("readiness rejects an unmigrated store and reports a stopped worker independently", async () => {
  assert.equal(
    (
      await readinessSnapshot(async () => ({
        rows: [
          {
            policy: "agent.policy",
            runtime: "agent.runtime",
            search_document: null,
          },
        ],
      }))
    ).statusCode,
    503,
  );
  assert.equal(
    (
      await readinessSnapshot(async () => {
        throw new Error("postgresql://user:secret@db");
      })
    ).body.control,
    "unavailable",
  );
  let calls = 0;
  const result = await readinessSnapshot(async () => ({
    rows: [
      ++calls === 1
        ? {
            policy: "agent.policy",
            runtime: "agent.runtime",
            search_document: "agent.search_document",
            fleet_cluster: "agent.fleet_cluster",
            model_profile: "agent.model_profile",
            audit_log: "agent.audit_log",
          }
        : { heartbeat_at: new Date(), state: { workerStatus: "stopped" } },
    ],
  }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.worker.status, "stopped");
});

test("shutdown cancels outstanding provider request signals without waiting for their model timeout", () => {
  const signal = requestSignal(45000);
  assert.equal(signal.aborted, false);
  shutdownController.abort(new Error("Service is stopping"));
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.message, "Service is stopping");
});
