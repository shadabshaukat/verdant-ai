import pg from "pg";
import {
  fleetConnection,
  counterDeltas,
  sqlIdentifier,
} from "./fleet-validation.mjs";
import { errText } from "./config.mjs";
const { Client } = pg;
const clients = new Set();
const n = (v) => (v == null ? null : Number(v));
const iso = (v) => (v ? new Date(v).toISOString() : null);
export const FLEET_METRIC_KEYS = [
  "connections",
  "databaseConnections",
  "maxConnections",
  "connectionUtilizationPercent",
  "cacheHitPercent",
  "databaseSizeBytes",
  "transactionsPerSecond",
  "commitsPerSecond",
  "rollbacksPerSecond",
  "deadlocksTotal",
  "deadlocksSinceLastSample",
  "blockedSessions",
  "longTransactions",
  "idleTransactions",
  "replicationLagBytes",
  "replicationLagSeconds",
  "replicationReplayPaused",
];
export async function closeFleetConnections() {
  await Promise.allSettled([...clients].map((client) => client.end()));
}
export async function collectEndpoint(
  endpoint,
  previous = {},
  policy = { captureQueryText: true },
) {
  const client = new Client(fleetConnection(endpoint));
  clients.add(client);
  const at = new Date().toISOString(),
    metrics = Object.fromEntries(FLEET_METRIC_KEYS.map((key) => [key, null]));
  const result = {
    at,
    status: "unavailable",
    serverVersion: null,
    actualRole: null,
    metrics,
    counters: null,
    capabilities: {},
    details: {
      waits: [],
      blockers: [],
      longTransactions: [],
      tables: [],
      indexes: [],
      replication: { inRecovery: null, senders: [], receivers: [], notes: [] },
      security: {
        roles: [],
        scope:
          "Role posture only; authentication/audit attack logs are not ingested.",
      },
      settings: [],
      extensions: [],
    },
    queries: [],
    notes: [],
  };
  const timer = setTimeout(() => void client.end().catch(() => {}), 15000);
  timer.unref();
  async function read(key, sql, args = [], scope = "") {
    try {
      const rows = (await client.query(sql, args)).rows;
      result.capabilities[key] = { available: true, scope };
      return rows;
    } catch (error) {
      result.capabilities[key] = {
        available: false,
        scope,
        reason: errText(error),
      };
      result.notes.push(key + ": " + errText(error));
      return null;
    }
  }
  try {
    await client.connect();
    const b = (
      await client.query(
        `SELECT version(),current_setting('server_version_num')::int AS version_num,pg_is_in_recovery() AS recovery,clock_timestamp() AS observed_at,current_setting('max_connections')::int AS max_connections,current_setting('track_counts') AS track_counts,pg_has_role(current_user,'pg_read_all_stats','member') AS full_stats,current_user AS monitor_user`,
      )
    ).rows[0];
    result.at = iso(b.observed_at);
    result.serverVersion = b.version;
    result.serverVersionNum = b.version_num;
    result.actualRole = b.recovery ? "replica" : "primary";
    result.monitorUser = b.monitor_user;
    result.capabilities.basic = {
      available: true,
      scope: "Connected database identity and server configuration.",
    };
    metrics.maxConnections = b.max_connections;
    if (b.version_num < 140000) {
      result.status = "degraded";
      result.notes.push(
        "Only basic connectivity is supported below PostgreSQL 14.",
      );
      return result;
    }
    if (!b.full_stats)
      result.notes.push(
        "Monitor lacks pg_read_all_stats/pg_monitor; other sessions may be redacted. Grant only the dedicated monitoring role.",
      );
    if (endpoint.sslMode !== "verify-full")
      result.notes.push(
        endpoint.sslMode === "disable"
          ? "TLS is disabled for this endpoint by explicit configuration."
          : "TLS encryption is enabled without certificate/hostname verification by explicit configuration.",
      );
    if (endpoint.role !== result.actualRole)
      result.notes.push(
        "Declared endpoint role differs from pg_is_in_recovery(); managed writer/reader labels do not always imply physical recovery.",
      );
    const stats = (
      await read(
        "statistics",
        `SELECT numbackends,xact_commit,xact_rollback,deadlocks,blks_hit,blks_read,stats_reset,pg_database_size(datname)::float8 AS size_bytes FROM pg_stat_database WHERE datname=current_database()`,
        [],
        "Database-wide cumulative counters since stats_reset; transaction deltas include observer traffic.",
      )
    )?.[0];
    if (stats && b.track_counts === "on") {
      metrics.databaseConnections = n(stats.numbackends);
      metrics.databaseSizeBytes = n(stats.size_bytes);
      metrics.deadlocksTotal = n(stats.deadlocks);
      const hits = n(stats.blks_hit),
        reads = n(stats.blks_read);
      metrics.cacheHitPercent =
        hits + reads > 0 ? (100 * hits) / (hits + reads) : null;
      result.counters = {
        commits: n(stats.xact_commit),
        rollbacks: n(stats.xact_rollback),
        deadlocks: n(stats.deadlocks),
        statsReset: iso(stats.stats_reset),
      };
      const delta = counterDeltas(
        previous.counters,
        result.counters,
        previous.at,
        result.at,
      );
      Object.assign(metrics, delta);
      delete metrics.scope;
      result.notes.push(delta.scope);
    } else if (stats) {
      result.capabilities.statistics = {
        available: false,
        scope:
          "track_counts is off; cumulative counters and derived rates are unknown.",
      };
      result.notes.push(
        "track_counts is disabled; rates/cache/table activity must not be read as measured zero.",
      );
    }
    const activity = await read(
      "activity",
      `SELECT count(*) FILTER(WHERE backend_type='client backend')::int AS connections,count(*) FILTER(WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0)::int AS blocked,count(*) FILTER(WHERE datname=current_database() AND xact_start IS NOT NULL AND clock_timestamp()-xact_start>interval '60 seconds' AND pid<>pg_backend_pid())::int AS long_transactions,count(*) FILTER(WHERE datname=current_database() AND state='idle in transaction' AND pid<>pg_backend_pid())::int AS idle_transactions FROM pg_stat_activity`,
      [],
      b.full_stats
        ? "Full statistics visibility; connection utilization uses cluster-wide client backends/max_connections."
        : "Limited session visibility; SQL and some session fields may be redacted.",
    );
    if (activity) {
      metrics.connections = n(activity[0]?.connections);
      metrics.connectionUtilizationPercent =
        metrics.maxConnections > 0
          ? (100 * metrics.connections) / metrics.maxConnections
          : null;
      if (b.full_stats) {
        metrics.blockedSessions = n(activity[0]?.blocked);
        metrics.longTransactions = n(activity[0]?.long_transactions);
        metrics.idleTransactions = n(activity[0]?.idle_transactions);
      }
    }
    result.details.waits =
      (await read(
        "waits",
        `SELECT wait_event_type AS "waitEventType",wait_event AS "waitEvent",count(*)::int AS sessions FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' AND wait_event IS NOT NULL GROUP BY wait_event_type,wait_event ORDER BY sessions DESC LIMIT 30`,
        [],
        "Current active wait groups, at most 30.",
      )) || [];
    result.details.blockers =
      (await read(
        "blockers",
        `SELECT pid,pg_blocking_pids(pid) AS "blockingPids",state,extract(epoch FROM clock_timestamp()-query_start)::float8 AS "waitSeconds",CASE WHEN $1 THEN left(query,2000) ELSE NULL END AS query FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0 ORDER BY query_start LIMIT 100`,
        [policy.captureQueryText !== false],
        "Current blocking relationships, at most 100; no session cancellation is available for external clusters.",
      )) || [];
    result.details.longTransactions =
      (await read(
        "longTransactions",
        `SELECT pid,state,extract(epoch FROM clock_timestamp()-xact_start)::float8 AS "ageSeconds",CASE WHEN $1 THEN left(query,2000) ELSE NULL END AS query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL AND (clock_timestamp()-xact_start>interval '60 seconds' OR state='idle in transaction') ORDER BY xact_start LIMIT 100`,
        [policy.captureQueryText !== false],
        "Current long/idle transactions, at most 100.",
      )) || [];
    result.details.tables =
      (await read(
        "tables",
        `SELECT schemaname AS "schema",relname AS "table",n_live_tup::float8 AS "liveRows",n_dead_tup::float8 AS "deadRows",n_mod_since_analyze::float8 AS "modificationsSinceAnalyze",last_analyze AS "lastAnalyze",last_autoanalyze AS "lastAutoAnalyze",last_vacuum AS "lastVacuum",last_autovacuum AS "lastAutoVacuum",seq_scan::float8 AS "sequentialScans",idx_scan::float8 AS "indexScans" FROM pg_stat_user_tables ORDER BY n_mod_since_analyze DESC,n_dead_tup DESC LIMIT 100`,
        [],
        "Estimated table statistics for at most 100 user tables ordered by modifications/dead tuples.",
      )) || [];
    if (b.track_counts !== "on")
      result.capabilities.tables = {
        available: false,
        scope:
          "track_counts is disabled; table estimates are not used for findings or maintenance.",
      };
    result.details.indexes =
      (await read(
        "indexes",
        `SELECT schemaname AS "schema",relname AS "table",indexrelname AS "index",idx_scan::float8 AS scans,pg_relation_size(indexrelid)::float8 AS "sizeBytes",idx_tup_read::float8 AS "tuplesRead" FROM pg_stat_user_indexes ORDER BY pg_relation_size(indexrelid) DESC LIMIT 100`,
        [],
        "At most 100 largest user indexes; zero scans alone is not a safe DROP recommendation.",
      )) || [];
    result.details.extensions =
      (await read(
        "extensions",
        `SELECT e.extname AS name,e.extversion AS version,n.nspname AS "schema" FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname`,
        [],
        "Installed extensions only; the collector does not install or enable extensions.",
      )) || [];
    const pgss = result.details.extensions.find(
      (e) => e.name === "pg_stat_statements",
    );
    if (pgss) {
      const rows = await read(
        "queries",
        `SELECT queryid::text AS "queryId",CASE WHEN $1 THEN left(query,2000) ELSE NULL END AS query,calls::float8,mean_exec_time AS "meanMs",total_exec_time AS "totalMs",rows::float8 FROM ${sqlIdentifier(pgss.schema)}.pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) ORDER BY total_exec_time DESC LIMIT 20`,
        [policy.captureQueryText !== false],
        "Top 20 cumulative statement fingerprints by total execution time since reset, not individual execution history or a before/after benchmark.",
      );
      result.queries = (rows || []).map((q) => ({
        ...q,
        scope: result.capabilities.queries.scope,
      }));
    } else
      result.capabilities.queries = {
        available: false,
        scope:
          "pg_stat_statements is optional and not installed in this database. Managed-provider preload/parameter setup may also be required.",
      };
    result.details.security.roles =
      (await read(
        "security",
        `SELECT rolname AS name,rolsuper AS superuser,rolcreaterole AS "createRole",rolcreatedb AS "createDatabase",rolreplication AS replication,rolbypassrls AS "bypassRls",rolcanlogin AS login FROM pg_roles WHERE rolcanlogin ORDER BY rolname LIMIT 200`,
        [],
        "Login role privilege posture, at most 200 roles; no password hashes or authentication/audit logs are read.",
      )) || [];
    result.details.settings =
      (await read(
        "settings",
        `SELECT name,setting,unit,source,pending_restart AS "pendingRestart" FROM pg_settings WHERE name=ANY($1::text[]) ORDER BY name`,
        [
          [
            "max_connections",
            "shared_buffers",
            "effective_cache_size",
            "work_mem",
            "maintenance_work_mem",
            "max_wal_size",
            "autovacuum",
            "track_counts",
            "shared_preload_libraries",
            "ssl",
            "log_min_duration_statement",
            "password_encryption",
          ],
        ],
        "Selected non-secret configuration; provider-controlled settings may not be changeable.",
      )) || [];
    const replication = result.details.replication;
    replication.inRecovery = b.recovery;
    if (b.recovery) {
      const local = (
        await read(
          "replication",
          `SELECT pg_is_wal_replay_paused() AS paused,pg_last_wal_receive_lsn()::text AS "receiveLsn",pg_last_wal_replay_lsn()::text AS "replayLsn",CASE WHEN pg_last_wal_receive_lsn() IS NOT NULL AND pg_last_wal_replay_lsn() IS NOT NULL THEN greatest(0,pg_wal_lsn_diff(pg_last_wal_receive_lsn(),pg_last_wal_replay_lsn()))::float8 ELSE NULL END AS "localReplayBacklogBytes"`,
          [],
          "Local received-WAL minus replayed-WAL backlog; excludes transport lag from the primary.",
        )
      )?.[0];
      if (local) {
        Object.assign(replication, local);
        metrics.replicationReplayPaused = local.paused;
        metrics.replicationLagBytes = n(local.localReplayBacklogBytes);
      }
      replication.receivers =
        (
          await read(
            "replicationReceiver",
            "SELECT to_jsonb(r)-'conninfo' AS receiver FROM pg_stat_wal_receiver r LIMIT 5",
            [],
            "Physical receiver view when exposed; conninfo is deliberately omitted.",
          )
        )?.map((r) => r.receiver) || [];
      replication.notes.push(
        "No transaction-age value is substituted for replication latency. Transport lag is unknown without a primary comparison.",
      );
    } else {
      replication.senders =
        (await read(
          "replication",
          `SELECT application_name AS "applicationName",state,sync_state AS "syncState",replay_lsn::text AS "replayLsn",CASE WHEN replay_lsn IS NULL THEN NULL ELSE greatest(0,pg_wal_lsn_diff(pg_current_wal_lsn(),replay_lsn))::float8 END AS "lagBytes",extract(epoch FROM replay_lag)::float8 AS "lagSeconds" FROM pg_stat_replication ORDER BY application_name LIMIT 30`,
          [],
          "Primary physical sender measurements when exposed; NULL replay lag remains unknown.",
        )) || [];
      const bytes = replication.senders
          .map((r) => n(r.lagBytes))
          .filter((v) => v !== null),
        seconds = replication.senders
          .map((r) => n(r.lagSeconds))
          .filter((v) => v !== null);
      metrics.replicationLagBytes = bytes.length ? Math.max(...bytes) : null;
      metrics.replicationLagSeconds = seconds.length
        ? Math.max(...seconds)
        : null;
      if (!replication.senders.length)
        replication.notes.push(
          "No physical sender rows were visible. This does not prove that a managed replica is absent or healthy.",
        );
    }
    if (policy.captureQueryText === false)
      result.notes.push(
        "SQL text capture is disabled for future observations; query fingerprints/counters remain. Existing retained history is not erased.",
      );
    result.status =
      b.full_stats && result.capabilities.statistics?.available
        ? "healthy"
        : "degraded";
    return result;
  } catch (error) {
    result.error = errText(error);
    result.capabilities.basic = {
      available: false,
      scope: "Connection/basic probe failed",
      reason: result.error,
    };
    return result;
  } finally {
    clearTimeout(timer);
    clients.delete(client);
    await client.end().catch(() => {});
  }
}
