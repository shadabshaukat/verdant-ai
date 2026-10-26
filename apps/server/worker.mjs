import {
  createTaskTracker,
  drainWithin,
  shutdownController,
} from "./lifecycle.mjs";
import { startMemoryIndexer, pendingMemoryIndex } from "./memory-index.mjs";
import { exclusiveTask } from "./control-flow.mjs";
import {
  MODEL,
  closePools,
  errText,
  ENV,
  WORKER_ID,
  DEMO_ENABLED,
} from "./config.mjs";
import {
  db,
  policy,
  runtime,
  event,
  lease,
  newRun,
  finishRun,
  initializePolicyDefaults,
} from "./store.mjs";
import { collect, persistDetections } from "./monitor.mjs";
import { executeQueued } from "./actions.mjs";
import { investigate } from "./planner.mjs";
import { collectFleet } from "./fleet.mjs";
import { closeFleetConnections } from "./fleet-sensors.mjs";
import { investigateFleetFindings } from "./fleet-planner.mjs";
const owner = WORKER_ID;
const tasks = createTaskTracker();
let timer = null,
  stopMemoryIndexer = () => {},
  heartbeatDue = 0;
let stopping = false,
  leader = false,
  monitorBusy = false,
  plannerBusy = false,
  actionBusy = false,
  fleetBusy = false,
  fleetPlannerBusy = false;
let fleetDue = 0,
  fleetPlannerDue = 0,
  monitorDue = 0,
  leaseDue = 0,
  lastPlan = 0,
  cycleCount = 0,
  lastHandledRequest = 0,
  lastPlanner = "monitor",
  forcePlanPending = false;
const startedAt = new Date().toISOString();
async function monitorCycle() {
  if (!DEMO_ENABLED || monitorBusy || !leader || stopping) return;
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
    if (!DEMO_ENABLED || !leader || stopping || Date.now() - lastPlan < 5000)
      return;
    plannerBusy = true;
    let run = null;
    let attempted = false;
    try {
      const p = await policy();
      if (p.paused) return;
      const candidates = (
        await db.query(
          `SELECT i.incident_id FROM agent.incident i WHERE i.target_id IN ('primary','standby') AND i.status='open' AND NOT EXISTS(SELECT 1 FROM agent.action a WHERE a.incident_id=i.incident_id AND a.generation=i.generation) AND NOT EXISTS(SELECT 1 FROM agent.review r WHERE r.incident_id=i.incident_id AND r.generation=i.generation AND r.review_type='investigation' AND r.status='pending') LIMIT 1`,
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
        result.interrupted
          ? "interrupted"
          : result.error
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
  if (!DEMO_ENABLED || actionBusy || plannerBusy || !leader || stopping) return;
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
async function fleetCycle() {
  if (fleetBusy || !leader || stopping) return;
  fleetBusy = true;
  try {
    await collectFleet();
  } catch (error) {
    console.error(
      JSON.stringify({ component: "fleet-monitor", error: errText(error) }),
    );
  } finally {
    fleetBusy = false;
    fleetDue = Date.now() + 5000;
  }
}
async function fleetPlannerCycle() {
  if (fleetPlannerBusy || !leader || stopping) return;
  fleetPlannerBusy = true;
  try {
    const p = await policy();
    if (!p.paused) await investigateFleetFindings();
  } catch (error) {
    console.error(
      JSON.stringify({ component: "fleet-planner", error: errText(error) }),
    );
  } finally {
    fleetPlannerBusy = false;
    fleetPlannerDue = Date.now() + 15000;
  }
}
async function tick() {
  if (stopping) return;
  try {
    if (Date.now() > leaseDue) {
      const wasLeader = leader;
      leader = !!(await lease(owner));
      leaseDue = Date.now() + 30000;
      if (leader && !wasLeader) await activateLeader();
      if (!leader) return;
    }
    if (!leader) return;
    if (Date.now() > heartbeatDue) {
      await db.query(
        "UPDATE agent.runtime SET heartbeat_at=now() WHERE singleton AND state->>'workerId'=$1 AND EXISTS(SELECT 1 FROM agent.lease WHERE lease_key='worker' AND owner=$1 AND expires_at>now())",
        [owner],
      );
      heartbeatDue = Date.now() + 10000;
    }
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
    if (Date.now() > fleetDue) void tasks.run(fleetCycle);
    if (Date.now() > fleetPlannerDue) void tasks.run(fleetPlannerCycle);
    if (DEMO_ENABLED) {
      if (Date.now() > monitorDue) void tasks.run(monitorCycle);
      void tasks.run(actionCycle);
      if (!monitorBusy) void tasks.run(() => plannerCycle(forcePlanPending));
    }
  } catch (e) {
    console.error(
      JSON.stringify({ component: "scheduler", error: errText(e) }),
    );
  }
}
async function activateLeader() {
  if (stopping) return;
  await initializePolicyDefaults();
  if (stopping) return;
  await db.query(
    `UPDATE agent.run SET status='interrupted',completed_at=now(),summary='Worker restarted; durable action attempts remain eligible for guarded recovery.' WHERE status='running'`,
  );
  await event("agent.started", "Verdant worker started", {
    owner,
    model: MODEL,
    monitoringIndependentOfPlanner: true,
  });
  await runtime({
    status: "watching",
    workerStatus: "running",
    workerId: owner,
    startedAt,
    model: MODEL,
  });
}
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  leader = false;
  clearInterval(timer);
  stopMemoryIndexer();
  void closeFleetConnections();
  shutdownController.abort(new Error("Worker is stopping"));
  const cleanup = (async () => {
    await Promise.allSettled([...tasks.pending(), ...pendingMemoryIndex()]);
    await db
      .query(
        `UPDATE agent.runtime SET state=state||'{"workerStatus":"stopped","status":"stopped"}'::jsonb,heartbeat_at=now() WHERE singleton AND state->>'workerId'=$1`,
        [owner],
      )
      .catch(() => {});
    await db
      .query(
        "UPDATE agent.lease SET expires_at=now() WHERE lease_key='worker' AND owner=$1",
        [owner],
      )
      .catch(() => {});
    await closePools();
  })();
  const drained = await drainWithin([cleanup], ENV.shutdownTimeoutMs);
  if (!drained)
    console.error(
      JSON.stringify({
        component: "worker",
        error:
          "Shutdown deadline reached. Durable in-flight attempts remain eligible for guarded recovery.",
      }),
    );
  process.exit(drained ? exitCode : 1);
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
const scheduler = exclusiveTask(tick, (error) =>
  console.error(
    JSON.stringify({ component: "scheduler", error: errText(error) }),
  ),
);
try {
  await tasks.run(async () => {
    leader = !!(await lease(owner));
    leaseDue = Date.now() + 30000;
    if (leader) await activateLeader();
    if (!stopping) {
      stopMemoryIndexer = startMemoryIndexer(() => leader && !stopping);
      timer = setInterval(() => void tasks.run(scheduler), 1000);
      await tasks.run(scheduler);
    }
  });
} catch (error) {
  if (!stopping) {
    console.error(
      JSON.stringify({ component: "worker-startup", error: errText(error) }),
    );
    await stop(1);
  }
}
