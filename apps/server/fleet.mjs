import { db, event, transaction, upsertIncident, mapReview } from "./store.mjs";
import { DEMO_ENABLED, errText } from "./config.mjs";
import { FLEET_ENV, fleetError, uuid } from "./fleet-validation.mjs";
import {
  listClusters,
  internalCluster,
  publicCluster,
  publicEndpoint,
  demoCluster,
} from "./fleet-registry.mjs";
import { collectEndpoint } from "./fleet-sensors.mjs";
import {
  probeMaintenance,
  queueAnalyze,
  executeFleetActions,
} from "./fleet-maintenance.mjs";
import { detectFleetFindings, hasPositiveRecovery } from "./fleet-findings.mjs";
export {
  listClusters,
  saveCluster,
  deleteCluster,
  testCluster,
} from "./fleet-registry.mjs";
export { bootstrapSql } from "./fleet-bootstrap.mjs";
const iso = (v) => (v ? new Date(v).toISOString() : null);
let collecting = false,
  lastCompletedAt = null,
  lastError = null;
export async function fleetMonitoringStatus() {
  const persisted =
    (
      await db.query(
        "SELECT state->'fleet' AS fleet FROM agent.runtime WHERE singleton",
      )
    ).rows[0]?.fleet || {};
  return {
    busy: false,
    lastCompletedAt: null,
    error: null,
    ...persisted,
    intervalSeconds: FLEET_ENV.monitorIntervalSeconds,
    historyDays: FLEET_ENV.historyDays,
    historyMaxSamplesPerEndpoint: 20000,
  };
}
async function monitoringPatch(patch) {
  await db.query(
    "UPDATE agent.runtime SET state=jsonb_set(state,'{fleet}',coalesce(state->'fleet','{}'::jsonb)||$1::jsonb) WHERE singleton",
    [patch],
  );
}
async function parallelMap(values, limit, fn) {
  let next = 0;
  const out = new Array(values.length);
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) {
        const i = next++;
        out[i] = await fn(values[i], i);
      }
    }),
  );
  return out;
}
async function queueFleetInvestigation(incident, reason) {
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "fleet-review:" + incident.incident_id + ":" + incident.generation,
    ]);
    const previous = (
      await c.query(
        "SELECT * FROM agent.review WHERE incident_id=$1 AND generation=$2 AND review_type='investigation' ORDER BY created_at LIMIT 1",
        [incident.incident_id, incident.generation],
      )
    ).rows[0];
    if (previous) return previous;
    const review = (
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
    if (review)
      await event(
        "review.queued",
        review.title,
        { reason, scope: "fleet" },
        { incidentId: incident.incident_id },
        c,
      );
    return review;
  });
}
async function persist(cluster, endpoint, snapshot) {
  const observations = {
    ...snapshot,
    clusterId: cluster.id,
    endpointId: endpoint.id,
    queries: { queries: snapshot.queries },
  };
  await transaction(async (c) => {
    await c.query(
      `UPDATE agent.fleet_endpoint SET snapshot=$2,last_checked_at=now(),last_success_at=CASE WHEN $3 THEN now() ELSE last_success_at END,last_error=$4 WHERE endpoint_id=$1`,
      [
        endpoint.id,
        snapshot,
        snapshot.status !== "unavailable",
        snapshot.error || null,
      ],
    );
    await c.query(
      "INSERT INTO agent.observation(target_id,payload) VALUES($1,$2)",
      [endpoint.targetId, observations],
    );
    if (snapshot.status !== "unavailable")
      await c.query(
        "INSERT INTO agent.fleet_metric_sample(cluster_id,endpoint_id,metrics) VALUES($1,$2,$3)",
        [cluster.id, endpoint.id, snapshot.metrics],
      );
  });
  const findings = detectFleetFindings(endpoint, snapshot),
    fingerprints = new Set(findings.map((f) => f.fingerprint));
  for (const finding of findings) {
    const incident = await upsertIncident(finding);
    await db.query(
      `INSERT INTO agent.memory(kind,title,content,incident_id,metadata) SELECT 'fleet_observation',$2,$3,$1,$4 WHERE NOT EXISTS(SELECT 1 FROM agent.memory WHERE incident_id=$1 AND kind='fleet_observation' AND metadata->>'generation'=$5)`,
      [
        incident.incident_id,
        finding.title,
        JSON.stringify(finding.evidence),
        {
          clusterId: cluster.id,
          endpointId: endpoint.id,
          incidentKind: incident.kind,
          generation: incident.generation,
          scope:
            "Detected monitoring concern; not model inference or proof of attack/latency regression.",
        },
        String(incident.generation),
      ],
    );
    const queued =
      finding.kind === "stale_statistics" &&
      (await queueAnalyze(
        cluster,
        { ...endpoint, previous: snapshot },
        incident,
        finding.evidence.table,
      ));
    if (!queued)
      await queueFleetInvestigation(
        incident,
        "External monitoring finding requires human investigation. No unrestricted SQL, session/role changes or failover are available.",
      );
  }
  const active = (
    await db.query(
      "SELECT * FROM agent.incident WHERE target_id=$1 AND status<>'resolved'",
      [endpoint.targetId],
    )
  ).rows;
  for (const incident of active) {
    const recovered =
      incident.kind === "tls_posture"
        ? snapshot.status !== "unavailable" &&
          endpoint.sslMode === "verify-full"
        : hasPositiveRecovery(incident, snapshot);
    if (!fingerprints.has(incident.fingerprint) && recovered) {
      const result = await db.query(
        "UPDATE agent.incident SET status='resolved',resolved_at=now() WHERE incident_id=$1 AND generation=$2 AND status<>'resolved' RETURNING incident_id",
        [incident.incident_id, incident.generation],
      );
      if (result.rowCount)
        await event(
          "fleet.incident_recovered",
          incident.title,
          {
            clusterId: cluster.id,
            generation: incident.generation,
            reason:
              "Fresh positive evidence no longer meets the detector condition.",
          },
          { incidentId: incident.incident_id },
        );
    }
  }
}
export async function collectFleet() {
  if (collecting) return { skipped: true };
  collecting = true;
  let lock = null;
  try {
    lock = await db.connect();
    if (
      !(await lock.query("SELECT pg_try_advisory_lock(723106,1) AS ok")).rows[0]
        .ok
    )
      return { skipped: true };
    await monitoringPatch({
      busy: true,
      lastStartedAt: new Date().toISOString(),
    });
    const due = (
      await db.query(
        `SELECT DISTINCT c.cluster_id FROM agent.fleet_cluster c JOIN agent.fleet_endpoint e ON e.cluster_id=c.cluster_id WHERE c.enabled AND c.deleted_at IS NULL AND e.enabled AND (e.last_checked_at IS NULL OR e.last_checked_at<now()-make_interval(secs=>coalesce((c.policy->>'monitorIntervalSeconds')::int,$1))) ORDER BY c.cluster_id LIMIT 50`,
        [FLEET_ENV.monitorIntervalSeconds],
      )
    ).rows;
    await parallelMap(due, 4, async ({ cluster_id }) => {
      try {
        const cluster = await internalCluster(cluster_id);
        if (!cluster.enabled) return;
        for (const endpoint of cluster.endpoints) {
          if (
            endpoint.previous?.at &&
            Date.now() - Date.parse(endpoint.previous.at) <
              cluster.policy.monitorIntervalSeconds * 1000
          )
            continue;
          const snapshot = await collectEndpoint(
            endpoint,
            endpoint.previous,
            cluster.policy,
          );
          snapshot.capabilities.maintenance =
            snapshot.status !== "unavailable" &&
            snapshot.actualRole === "primary"
              ? await probeMaintenance(cluster, endpoint)
              : {
                  available: false,
                  scope:
                    "Endpoint is unavailable or not a physical primary; no maintenance dispatch.",
                };
          endpoint.previous = snapshot;
          await persist(cluster, endpoint, snapshot);
        }
        await executeFleetActions(cluster);
      } catch (e) {
        await event(
          "fleet.monitor_error",
          "Cluster observation could not complete",
          { clusterId: cluster_id, error: errText(e) },
          { severity: "warning" },
        ).catch(() => {});
      }
    });
    // Approved work is not delayed until its endpoint's next observation.
    const pending = (
      await db.query(
        `SELECT DISTINCT c.cluster_id FROM agent.fleet_cluster c JOIN agent.fleet_action a ON a.cluster_id=c.cluster_id WHERE c.enabled AND c.deleted_at IS NULL AND a.status IN ('queued','pending_approval','running') LIMIT 50`,
      )
    ).rows;
    for (const { cluster_id } of pending)
      try {
        await executeFleetActions(await internalCluster(cluster_id));
      } catch (e) {
        console.error(
          JSON.stringify({ component: "fleet-maintenance", error: errText(e) }),
        );
      }
    await db.query(
      `DELETE FROM agent.fleet_metric_sample WHERE sample_id IN(SELECT sample_id FROM agent.fleet_metric_sample WHERE recorded_at<now()-make_interval(days=>$1) ORDER BY sample_id LIMIT 5000)`,
      [FLEET_ENV.historyDays],
    );
    await db.query(
      `DELETE FROM agent.fleet_metric_sample WHERE sample_id IN(SELECT sample_id FROM(SELECT sample_id,row_number() OVER(PARTITION BY endpoint_id ORDER BY recorded_at DESC,sample_id DESC) AS n FROM agent.fleet_metric_sample)x WHERE n>20000 LIMIT 5000)`,
    );
    await db.query(
      `DELETE FROM agent.observation WHERE observation_id IN(SELECT observation_id FROM agent.observation WHERE recorded_at<now()-interval '3 days' ORDER BY observation_id LIMIT 5000)`,
    );
    lastCompletedAt = new Date().toISOString();
    lastError = null;
    await monitoringPatch({ busy: false, lastCompletedAt, error: null });
    return { clusters: due.length, collectedAt: lastCompletedAt };
  } catch (e) {
    lastError = errText(e);
    await monitoringPatch({
      busy: false,
      error: lastError,
      lastErrorAt: new Date().toISOString(),
    }).catch(() => {});
    throw e;
  } finally {
    if (lock) {
      await lock.query("SELECT pg_advisory_unlock(723106,1)").catch(() => {});
      lock.release();
    }
    collecting = false;
  }
}
const incidentMap = (r) => ({
  id: r.incident_id,
  targetId: r.target_id,
  kind: r.kind,
  title: r.title,
  severity: r.severity,
  status: r.status,
  generation: r.generation,
  summary: r.summary,
  evidence: r.evidence,
  firstSeenAt: iso(r.first_seen_at),
  lastSeenAt: iso(r.last_seen_at),
  resolvedAt: iso(r.resolved_at),
});
const memoryMap = (r) => ({
  id: r.memory_id,
  kind: r.kind,
  title: r.title,
  content: r.content,
  incidentId: r.incident_id,
  reviewId: r.review_id,
  metadata: r.metadata,
  createdAt: iso(r.created_at),
});
function clusterStatus(cluster) {
  if (!cluster.enabled) return "disabled";
  const active = cluster.endpoints.filter((e) => e.enabled !== false);
  if (!active.length || active.every((e) => e.status === "unknown"))
    return "unknown";
  if (
    active.some(
      (e) =>
        !e.lastCheckedAt ||
        Date.now() - Date.parse(e.lastCheckedAt) >
          Math.max(90, 2 * (cluster.policy?.monitorIntervalSeconds || 30)) *
            1000,
    )
  )
    return "stale";
  if (active.every((e) => e.status === "unavailable")) return "unavailable";
  return active.every((e) => e.status === "healthy") ? "healthy" : "degraded";
}
export async function getFleetDashboard() {
  const [inventory, countsResult, snapshotsResult, monitoring, legacy] =
    await Promise.all([
      listClusters(),
      db.query(
        `SELECT t.metadata->>'clusterId' AS cluster_id,count(*)::int AS count FROM agent.incident i JOIN agent.target t USING(target_id) WHERE i.status<>'resolved' AND ((t.target_id IN ('primary','standby') AND $1) OR EXISTS(SELECT 1 FROM agent.fleet_cluster fc WHERE fc.cluster_id::text=t.metadata->>'clusterId' AND fc.enabled AND fc.deleted_at IS NULL)) GROUP BY t.metadata->>'clusterId'`,
        [DEMO_ENABLED],
      ),
      db.query(
        "SELECT endpoint_id,snapshot FROM agent.fleet_endpoint WHERE enabled",
      ),
      fleetMonitoringStatus(),
      DEMO_ENABLED
        ? db.query(
            "SELECT DISTINCT ON(target_id) target_id,recorded_at,payload FROM agent.observation WHERE target_id IN ('primary','standby') ORDER BY target_id,recorded_at DESC,observation_id DESC",
          )
        : Promise.resolve({ rows: [] }),
    ]);
  const counts = countsResult.rows,
    snapshots = snapshotsResult.rows;
  const clusters = inventory.clusters.map((original) => {
    let c = original;
    if (c.kind === "demo")
      c = {
        ...c,
        lastSeenAt: iso(
          legacy.rows.find((o) => o.target_id === "primary")?.recorded_at,
        ),
        collectedAt: iso(
          legacy.rows.find((o) => o.target_id === "primary")?.recorded_at,
        ),
        policy: { monitorIntervalSeconds: 15 },
        endpoints: c.endpoints.map((e) => {
          const o = legacy.rows.find((o) => o.target_id === e.id);
          return {
            ...e,
            enabled: true,
            status: o?.payload.status || "unknown",
            lastCheckedAt: iso(o?.recorded_at),
            lastSeenAt:
              o?.payload.status === "healthy" ? iso(o.recorded_at) : null,
          };
        }),
      };
    const primary =
      c.endpoints.find((e) => e.enabled !== false && e.role === "primary") ||
      c.endpoints.find((e) => e.enabled !== false);
    const p =
      c.kind === "demo"
        ? legacy.rows.find((o) => o.target_id === "primary")?.payload
        : null;
    const metrics =
      c.kind === "demo"
        ? {
            connections: p?.connections ?? null,
            maxConnections: p?.maxConnections ?? null,
            cacheHitPercent: p?.cacheHitPercent ?? null,
            databaseSizeBytes: p?.databaseSizeBytes ?? null,
            connectionUtilizationPercent:
              p?.maxConnections > 0
                ? (100 * p.connections) / p.maxConnections
                : null,
          }
        : snapshots.find((e) => e.endpoint_id === primary?.id)?.snapshot
            ?.metrics || {};
    const activeIncidents =
      counts.find((r) => r.cluster_id === (c.kind === "demo" ? null : c.id))
        ?.count || 0;
    let status = clusterStatus(c);
    if (status === "healthy" && activeIncidents > 0) status = "degraded";
    return { ...c, status, metrics, activeIncidents };
  });
  return {
    summary: {
      clusters: clusters.filter((c) => !c.deleted).length,
      enabled: clusters.filter((c) => c.enabled).length,
      healthy: clusters.filter((c) => c.status === "healthy").length,
      degraded: clusters.filter((c) => ["degraded", "stale"].includes(c.status))
        .length,
      unavailable: clusters.filter((c) => c.status === "unavailable").length,
      activeIncidents: counts.reduce((n, r) => n + r.count, 0),
    },
    clusters,
    collectedAt: monitoring.lastCompletedAt,
    monitoring,
  };
}
export async function getClusterDashboard(id) {
  if (id === "demo") {
    if (!DEMO_ENABLED) throw fleetError("Cluster not found", 404);
    return {
      cluster: demoCluster(),
      endpoints: demoCluster().endpoints,
      metrics: [],
      history: {
        connections: [],
        transactionsPerSecond: [],
        cacheHitPercent: [],
        databaseSizeBytes: [],
      },
      incidents: [],
      reviews: [],
      memories: [],
      queries: [],
      runs: [],
      steps: [],
      collectedAt: null,
      notes: [
        "Use the built-in demo dashboard for primary/standby actions and telemetry.",
      ],
    };
  }
  uuid(id);
  const row = (
    await db.query("SELECT * FROM agent.fleet_cluster WHERE cluster_id=$1", [
      id,
    ])
  ).rows[0];
  if (!row) throw fleetError("Cluster not found", 404);
  const endpoints = (
      await db.query(
        "SELECT * FROM agent.fleet_endpoint WHERE cluster_id=$1 ORDER BY created_at",
        [id],
      )
    ).rows,
    targetIds = endpoints.map((e) => e.target_id);
  const [incidents, reviews, memories, samples, actions] = await Promise.all([
    db.query(
      "SELECT * FROM agent.incident WHERE target_id=ANY($1::text[]) ORDER BY last_seen_at DESC LIMIT 200",
      [targetIds],
    ),
    db.query(
      "SELECT r.* FROM agent.review r JOIN agent.incident i USING(incident_id) WHERE i.target_id=ANY($1::text[]) ORDER BY r.created_at DESC LIMIT 200",
      [targetIds],
    ),
    db.query(
      "SELECT m.* FROM agent.memory m JOIN agent.incident i USING(incident_id) WHERE i.target_id=ANY($1::text[]) ORDER BY m.created_at DESC LIMIT 200",
      [targetIds],
    ),
    db.query(
      `SELECT endpoint_id,recorded_at,metrics FROM(SELECT *,row_number() OVER(PARTITION BY endpoint_id ORDER BY recorded_at DESC) n FROM agent.fleet_metric_sample WHERE cluster_id=$1 AND recorded_at>now()-interval '24 hours')x WHERE n<=240 ORDER BY recorded_at`,
      [id],
    ),
    db.query(
      "SELECT * FROM agent.fleet_action WHERE cluster_id=$1 ORDER BY created_at DESC LIMIT 100",
      [id],
    ),
  ]);
  const history = {
    connections: [],
    transactionsPerSecond: [],
    cacheHitPercent: [],
    databaseSizeBytes: [],
  };
  for (const s of samples.rows)
    for (const key of Object.keys(history))
      history[key].push({
        at: iso(s.recorded_at),
        value: s.metrics[key] ?? null,
        endpointId: s.endpoint_id,
      });
  const views = endpoints.map((e) => ({
    ...publicEndpoint(e),
    metrics: e.snapshot.metrics || {},
    capabilities: e.snapshot.capabilities || {},
    notes: e.snapshot.notes || [],
    details: e.snapshot.details || {},
    serverVersion: e.snapshot.serverVersion || null,
    actualRole: e.snapshot.actualRole || null,
    queries: e.snapshot.queries || [],
  }));
  const selected =
    views.find((e) => e.enabled && e.role === "primary") ||
    views.find((e) => e.enabled) ||
    views[0];
  let runs = [],
    steps = [];
  if (
    (
      await db.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema='agent' AND table_name='run' AND column_name='cluster_id'",
      )
    ).rowCount
  ) {
    runs = (
      await db.query(
        "SELECT * FROM agent.run WHERE cluster_id=$1 ORDER BY started_at DESC LIMIT 30",
        [id],
      )
    ).rows;
    if (runs.length)
      steps = (
        await db.query(
          "SELECT * FROM agent.step WHERE run_id=ANY($1::uuid[]) ORDER BY recorded_at DESC LIMIT 200",
          [runs.map((r) => r.run_id)],
        )
      ).rows;
  }
  return {
    cluster: publicCluster(row, endpoints),
    endpoints: views,
    metrics: Object.entries(selected?.metrics || {}).map(([name, value]) => ({
      name,
      value,
      unit: name.endsWith("Percent")
        ? "%"
        : name.endsWith("Bytes")
          ? "bytes"
          : name.endsWith("Second")
            ? "/s"
            : "",
      status: value === null ? "unknown" : "measured",
    })),
    history,
    incidents: incidents.rows.map(incidentMap),
    reviews: reviews.rows.map(mapReview),
    memories: memories.rows.map(memoryMap),
    queries: views.flatMap((e) =>
      e.queries.map((q) => ({ ...q, endpointId: e.id })),
    ),
    actions: actions.rows,
    runs,
    steps,
    collectedAt: iso(
      endpoints
        .map((e) => e.last_checked_at)
        .filter(Boolean)
        .sort((a, b) => +new Date(b) - +new Date(a))[0],
    ),
    historyPolicy: {
      days: FLEET_ENV.historyDays,
      maxSamplesPerEndpoint: 20000,
      chartScope:
        "Latest 240 samples per endpoint from the last 24 hours; latest snapshot details are bounded.",
    },
  };
}
