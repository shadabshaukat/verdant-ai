import { startMemoryIndexer } from "./memory-index.mjs";
import { exclusiveTask } from "./control-flow.mjs";
process.env.SERVICE_ROLE = "worker";
import { randomUUID } from "node:crypto";
import { MODEL, closePools, errText } from "./config.mjs";
import {
  db,
  policy,
  runtime,
  event,
  lease,
  newRun,
  finishRun,
} from "./store.mjs";
import { collect, persistDetections } from "./monitor.mjs";
import { executeQueued } from "./actions.mjs";
import { investigate } from "./planner.mjs";
const owner = process.env.HOSTNAME || "worker-" + randomUUID();
process.env.HOSTNAME = owner;
let stopping = false,
  leader = false,
  monitorBusy = false,
  plannerBusy = false,
  actionBusy = false;
let monitorDue = 0,
  leaseDue = 0,
  lastPlan = 0,
  cycleCount = 0,
  lastHandledRequest = 0,
  lastPlanner = "monitor",
  forcePlanPending = false;
const startedAt = new Date().toISOString();
async function monitorCycle() {
  if (monitorBusy || !leader || stopping) return;
  monitorBusy = true;
  try {
    const p = await policy();
    const s = await collect();
    await persistDetections(s);
    cycleCount++;
    const now = new Date();
    await runtime({
      lastCycleAt: now.toISOString(),
      nextCycleAt: new Date(
        +now + p.monitorIntervalSeconds * 1000,
      ).toISOString(),
      cycleCount,
      startedAt,
      status: p.paused
        ? "paused"
        : plannerBusy
          ? "investigating"
          : s.primary.status === "healthy"
            ? "watching"
            : "degraded",
      planner: lastPlanner,
      model: MODEL,
      error: s.primary.error || null,
    });
    monitorDue = Date.now() + p.monitorIntervalSeconds * 1000;
    if (cycleCount % 20 === 0)
      await db.query(
        `DELETE FROM agent.observation WHERE observation_id IN(SELECT observation_id FROM agent.observation WHERE recorded_at<now()-interval '3 days' ORDER BY observation_id LIMIT 5000)`,
      );
    if (cycleCount === 1 || cycleCount % 20 === 0)
      await event("monitor.cycle", "Database observation completed", {
        cycleCount,
        targets: [s.primary.status, s.standby.status],
        replication: s.standby.replication,
      });
  } catch (e) {
    console.error(JSON.stringify({ component: "monitor", error: errText(e) }));
    await runtime({ status: "degraded", error: errText(e) }).catch(() => {});
    monitorDue = Date.now() + 10000;
  } finally {
    monitorBusy = false;
  }
}
const plannerCycle = exclusiveTask(
  async (force = false) => {
    if (!leader || stopping || Date.now() - lastPlan < 5000) return;
    plannerBusy = true;
    let run = null;
    let attempted = false;
    try {
      const p = await policy();
      if (p.paused) return;
      const candidates = (
        await db.query(
          `SELECT i.incident_id FROM agent.incident i WHERE i.status='open' AND NOT EXISTS(SELECT 1 FROM agent.action a WHERE a.incident_id=i.incident_id AND a.generation=i.generation) AND NOT EXISTS(SELECT 1 FROM agent.review r WHERE r.incident_id=i.incident_id AND r.generation=i.generation AND r.review_type='investigation' AND r.status='pending') LIMIT 1`,
        )
      ).rows;
      if (!candidates.length && !force) return;
      forcePlanPending = false;
      attempted = true;
      lastPlan = Date.now();
      run = await newRun("ollama");
      const result = await investigate(run.run_id);
      lastPlanner = result.planner;
      await finishRun(
        run.run_id,
        result.error
          ? "degraded"
          : result.restartRequested
            ? "steered"
            : "completed",
        result.summary,
        result.planner,
        result.model || MODEL,
        result.error,
      );
      if (result.restartRequested) forcePlanPending = true;
      await runtime({
        status: result.error ? "degraded" : "watching",
        planner: result.planner,
        lastPlanAt: new Date().toISOString(),
        error: result.error || null,
      });
    } catch (error) {
      lastPlanner = "fallback";
      console.error(
        JSON.stringify({ component: "planner", error: errText(error) }),
      );
      await Promise.allSettled([
        ...(run
          ? [
              finishRun(
                run.run_id,
                "failed",
                "Investigation failed. Monitoring continues.",
                "fallback",
                MODEL,
                errText(error),
              ),
            ]
          : []),
        runtime({
          status: "degraded",
          planner: "fallback",
          error: errText(error),
        }),
      ]);
    } finally {
      plannerBusy = false;
      if (attempted) lastPlan = Date.now();
    }
  },
  (error) =>
    console.error(
      JSON.stringify({ component: "planner-dispatch", error: errText(error) }),
    ),
);
async function actionCycle() {
  if (actionBusy || plannerBusy || !leader || stopping) return;
  actionBusy = true;
  try {
    await executeQueued();
  } catch (e) {
    console.error(
      JSON.stringify({ component: "action-queue", error: errText(e) }),
    );
  } finally {
    actionBusy = false;
  }
}
async function tick() {
  if (stopping) return;
  try {
    if (Date.now() > leaseDue) {
      leader = !!(await lease(owner));
      leaseDue = Date.now() + 30000;
      if (!leader) return;
    }
    if (!leader) return;
    const rt = (
      await db.query(
        "SELECT cycle_requested_at FROM agent.runtime WHERE singleton",
      )
    ).rows[0];
    const request = rt?.cycle_requested_at
      ? +new Date(rt.cycle_requested_at)
      : 0;
    const requested = request > lastHandledRequest;
    if (requested) {
      lastHandledRequest = request;
      monitorDue = 0;
      forcePlanPending = true;
    }
    if (Date.now() > monitorDue) void monitorCycle();
    void actionCycle();
    if (!monitorBusy) void plannerCycle(forcePlanPending);
  } catch (e) {
    console.error(
      JSON.stringify({ component: "scheduler", error: errText(e) }),
    );
  }
}
leader = !!(await lease(owner));
leaseDue = Date.now() + 30000;
if (leader) {
  await db.query(
    `UPDATE agent.run SET status='interrupted',completed_at=now(),summary='Worker restarted; durable action attempts remain eligible for guarded recovery.' WHERE status='running'`,
  );
  await event("agent.started", "Verdant worker started", {
    owner,
    model: MODEL,
    monitoringIndependentOfPlanner: true,
  });
  await runtime({ status: "watching", startedAt, model: MODEL });
}
const stopMemoryIndexer = startMemoryIndexer(() => leader && !stopping);
const timer = setInterval(tick, 1000);
await tick();
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  stopMemoryIndexer();
  await db
    .query(
      `UPDATE agent.lease SET expires_at=now() WHERE lease_key='worker' AND owner=$1`,
      [owner],
    )
    .catch(() => {});
  await closePools();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
