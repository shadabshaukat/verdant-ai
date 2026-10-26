import { collectReplicationEvidence } from "./control-flow.mjs";
import { pools, asNumber, errText, timestamp } from "./config.mjs";
import { db, upsertIncident, resolveAbsent, event } from "./store.mjs";
import { isStatsStale, replicationConcern, safeQueryText } from "./policy.mjs";
const query = async (pool, sql, args = []) =>
  (await pool.query(sql, args)).rows;
export async function inspectStatistics() {
  return {
    tables: await query(
      pools.PRIMARY,
      `SELECT schemaname,relname,n_live_tup,n_dead_tup,n_mod_since_analyze,last_analyze,last_autoanalyze FROM pg_stat_user_tables WHERE schemaname='app' AND relname='orders'`,
    ),
  };
}
export async function inspectSecurity() {
  const roles = await query(
    pools.PRIMARY,
    `SELECT rolname,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolcanlogin ORDER BY rolname`,
  );
  return {
    scope:
      "Role and grant posture. Authentication and security event logs are not ingested.",
    roles,
  };
}
export async function inspectBlockers() {
  const rows = await query(
    pools.PRIMARY,
    `SELECT a.pid,a.usename,a.application_name,a.state,a.wait_event_type,a.wait_event,left(a.query,1000) AS query,extract(epoch FROM clock_timestamp()-a.query_start)::float8 AS age_seconds,pg_blocking_pids(a.pid) AS blocking_pids,coalesce((SELECT jsonb_agg(jsonb_build_object('pid',b.pid,'user',b.usename,'applicationName',b.application_name,'state',b.state,'query',left(b.query,500))) FROM pg_stat_activity b WHERE b.pid=ANY(pg_blocking_pids(a.pid))),'[]'::jsonb) AS blockers FROM pg_stat_activity a WHERE a.datname=current_database() AND cardinality(pg_blocking_pids(a.pid))>0 ORDER BY a.query_start`,
  );
  return { blocked: rows };
}
export async function inspectQueries() {
  const queries = await query(
    pools.PRIMARY,
    `SELECT queryid::text,left(query,1500) AS query,calls,mean_exec_time AS mean_ms,total_exec_time AS total_ms,rows,shared_blks_read FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND query NOT ILIKE '%pg_stat_statements%' ORDER BY total_exec_time DESC LIMIT 12`,
  );
  const plan = await query(
    pools.PRIMARY,
    "EXPLAIN (FORMAT JSON) SELECT * FROM app.orders WHERE customer_id=42",
  );
  const index = await query(
    pools.PRIMARY,
    `SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='app' AND tablename='orders' AND indexname='orders_customer_id_idx'`,
  );
  return {
    scope:
      "Cumulative query statistics since last reset. EXPLAIN describes the current plan and does not execute the workload query.",
    queries: queries.map((r) => ({ ...r, query: safeQueryText(r.query) })),
    customerLookupPlan: plan[0]?.["QUERY PLAN"],
    customerLookupIndex: index[0] || null,
  };
}
async function targetBase(pool, id) {
  const row = (
    await query(
      pool,
      `SELECT version(),pg_is_in_recovery() AS recovery,current_setting('max_connections')::int AS max_connections,pg_database_size(current_database())::float8 AS database_size_bytes,(SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS connections,(SELECT blks_hit::float8 FROM pg_stat_database WHERE datname=current_database()) AS blks_hit,(SELECT blks_read::float8 FROM pg_stat_database WHERE datname=current_database()) AS blks_read`,
    )
  )[0];
  return {
    id,
    name: id === "primary" ? "Workload primary" : "Physical standby",
    role: row.recovery ? "standby" : "primary",
    status: "healthy",
    version: row.version.match(/PostgreSQL ([^ ]+)/)?.[1] || row.version,
    connections: row.connections,
    maxConnections: row.max_connections,
    databaseSizeBytes: row.database_size_bytes,
    cacheHitPercent:
      row.blks_hit + row.blks_read > 0
        ? (100 * row.blks_hit) / (row.blks_hit + row.blks_read)
        : null,
  };
}
export async function inspectReplication() {
  return collectReplicationEvidence(
    () =>
      query(
        pools.PRIMARY,
        `SELECT application_name,state,sync_state,sent_lsn::text,write_lsn::text,flush_lsn::text,replay_lsn::text,CASE WHEN replay_lsn IS NULL THEN NULL ELSE greatest(0,pg_wal_lsn_diff(pg_current_wal_lsn(),replay_lsn))::float8 END AS lag_bytes,extract(epoch FROM replay_lag)::float8 AS lag_seconds FROM pg_stat_replication ORDER BY application_name`,
      ),
    async () => {
      const s = (
        await query(
          pools.STANDBY,
          `SELECT pg_is_in_recovery() AS recovery,pg_is_wal_replay_paused() AS replay_paused,pg_last_wal_receive_lsn()::text AS receive_lsn,pg_last_wal_replay_lsn()::text AS replay_lsn,(SELECT status FROM pg_stat_wal_receiver LIMIT 1) AS receiver_status`,
        )
      )[0];
      const heartbeat = (
        await query(
          pools.STANDBY,
          "SELECT updated_at,sequence FROM ops.heartbeat WHERE id=1",
        )
      )[0];
      return { ...s, heartbeat };
    },
  );
}
export async function collect() {
  const at = new Date().toISOString();
  let heartbeatError = null;
  try {
    await pools.PRIMARY_ACTION.query("SELECT ops.touch_heartbeat()");
  } catch (e) {
    heartbeatError = errText(e);
  }
  const [pr, sr] = await Promise.allSettled([
    targetBase(pools.PRIMARY, "primary"),
    targetBase(pools.STANDBY, "standby"),
  ]);
  const primary =
    pr.status === "fulfilled"
      ? pr.value
      : {
          id: "primary",
          name: "Workload primary",
          role: "primary",
          status: "unavailable",
          error: errText(pr.reason),
        };
  const standby =
    sr.status === "fulfilled"
      ? sr.value
      : {
          id: "standby",
          name: "Physical standby",
          role: "standby",
          status: "unavailable",
          error: errText(sr.reason),
        };
  const result = { at, primary, standby, heartbeatError };
  const collectors = {
    replication: inspectReplication,
    statistics: inspectStatistics,
    security: inspectSecurity,
    blockers: inspectBlockers,
    queries: inspectQueries,
    fixtures: () =>
      query(pools.PRIMARY, "SELECT name,active FROM ops.demo_fixture"),
  };
  const reads = await Promise.allSettled(
    Object.values(collectors).map((f) => f()),
  );
  for (const [i, k] of Object.keys(collectors).entries())
    result[k] =
      reads[i].status === "fulfilled"
        ? reads[i].value
        : { error: errText(reads[i].reason) };
  const sender =
    result.replication?.primarySenders?.find(
      (s) => s.application_name === "verdant-standby",
    ) || result.replication?.primarySenders?.[0];
  const si = result.replication?.standby;
  standby.replication = {
    state: sender?.state || si?.receiver_status || "unknown",
    lagBytes: asNumber(sender?.lag_bytes),
    lagSeconds: asNumber(sender?.lag_seconds),
    replayPaused: si?.replay_paused ?? null,
    connected:
      si?.error || !si
        ? null
        : standby.status === "healthy" && si.receiver_status === "streaming",
    heartbeatSequence: si?.heartbeat?.sequence ?? null,
    heartbeatAt: timestamp(si?.heartbeat?.updated_at),
    note: result.replication?.note,
  };
  primary.replication = {
    state: result.replication?.primaryError
      ? "unknown"
      : sender?.state || "disconnected",
    lagBytes: asNumber(sender?.lag_bytes),
    lagSeconds: asNumber(sender?.lag_seconds),
    replayPaused: si?.replay_paused ?? null,
    connected: result.replication?.primaryError ? null : !!sender,
  };
  if (Array.isArray(result.fixtures)) {
    for (const f of result.fixtures) {
      const active =
        f.name === "replication-pause"
          ? standby.replication.replayPaused
          : f.active;
      if (active != null)
        await db.query(
          "UPDATE agent.demo_fixture SET active=$2 WHERE fixture_id=$1",
          [f.name, active],
        );
    }
  }
  await Promise.all([
    db.query("INSERT INTO agent.observation(target_id,payload) VALUES($1,$2)", [
      "primary",
      {
        ...primary,
        statistics: result.statistics,
        security: result.security,
        blockers: result.blockers,
        queries: result.queries,
      },
    ]),
    db.query("INSERT INTO agent.observation(target_id,payload) VALUES($1,$2)", [
      "standby",
      { ...standby, replicationDetail: result.replication },
    ]),
  ]);
  return result;
}
export function detect(s) {
  const out = [];
  const add = (target, kind, title, severity, summary, evidence, key = kind) =>
    out.push({
      target,
      kind,
      title,
      severity,
      summary,
      evidence,
      fingerprint: target + ":" + key,
    });
  for (const t of [s.primary, s.standby])
    if (t.status !== "healthy")
      add(
        t.id,
        "target-unavailable",
        t.name + " is unreachable",
        "critical",
        "The monitor could not read this database. The other target continues to be checked.",
        { error: t.error },
        "target-unavailable",
      );
  if (s.standby.status === "healthy" && !s.replication?.standby?.error) {
    const concern = replicationConcern(s.standby);
    if (concern === "replication-paused")
      add(
        "standby",
        concern,
        "Standby WAL replay is paused",
        "critical",
        "The standby receives WAL but cannot apply it while replay is paused.",
        s.replication,
      );
    else if (concern === "replication-disconnected")
      add(
        "standby",
        concern,
        "Standby receiver is disconnected",
        "critical",
        "The standby WAL receiver is not streaming. Reconnection needs investigation.",
        s.replication,
      );
    else if (concern === "replication-lag")
      add(
        "standby",
        concern,
        "Standby has unapplied WAL",
        "warning",
        "WAL byte distance exceeds the demo threshold of 1 MiB.",
        s.replication,
      );
  }
  const stats = s.statistics?.tables?.[0];
  if (isStatsStale(stats))
    add(
      "primary",
      "stale-statistics",
      "Orders planner statistics need refresh",
      "warning",
      `${stats.n_mod_since_analyze} row modifications since the last statistics refresh.`,
      stats,
    );
  const risky = s.security?.roles?.find(
    (r) => r.rolname === "verdant_risky_login" && r.rolcreaterole,
  );
  if (risky)
    add(
      "primary",
      "risky-role",
      "Demo login has CREATEROLE",
      "critical",
      "Role posture scan found elevated role-creation capability on the fixed demo login. This is configuration evidence, not an attack log.",
      risky,
    );
  const blocked = s.blockers?.blocked || [];
  if (blocked.length)
    add(
      "primary",
      "blocked-query",
      "A query is waiting on a lock",
      "warning",
      `${blocked.length} session(s) have blocking backends. Only the tagged demo blocker can be ended automatically.`,
      { blocked },
    );
  const lookup = s.queries?.queries?.filter(
    (q) =>
      /app\.orders/i.test(q.query) &&
      /customer_id/i.test(q.query) &&
      !/^EXPLAIN/i.test(q.query),
  );
  if (
    !s.queries?.error &&
    !s.queries.customerLookupIndex &&
    lookup?.some((q) => Number(q.calls) >= 3)
  )
    add(
      "primary",
      "query-tuning",
      "Customer lookup has no supporting index",
      "warning",
      "Repeated customer lookups have no customer_id index. The saved EXPLAIN plan is available for investigation.",
      {
        queries: lookup,
        plan: s.queries.customerLookupPlan,
        indexExists: false,
      },
    );
  return out;
}
export async function persistDetections(s) {
  const detections = detect(s);
  for (const d of detections) await upsertIncident(d);
  const healthy = [];
  if (
    s.primary.status === "healthy" &&
    !["statistics", "security", "blockers", "queries"].some((k) => s[k]?.error)
  )
    healthy.push("primary");
  if (
    s.standby.status === "healthy" &&
    !s.replication?.error &&
    !s.replication?.standby?.error
  )
    healthy.push("standby");
  await resolveAbsent(
    [
      ...detections.map((d) => d.fingerprint),
      // A missing primary measurement cannot prove an existing byte-lag incident recovered.
      ...(s.replication?.primaryError ? ["standby:replication-lag"] : []),
    ],
    healthy,
  );
  return detections;
}
