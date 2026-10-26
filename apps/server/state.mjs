import { workerHealth } from "./lifecycle.mjs";
import { db, policy, mapReview } from "./store.mjs";
import { timestamp, asNumber, MODEL, DEMO_ENABLED } from "./config.mjs";
import { fixtureInfo } from "./fixtures.mjs";
export async function getState() {
  const [p, rt, obs, inc, act, rev, ev, mem, runs, steps, hist, fixtures] =
    await Promise.all([
      policy(),
      db.query("SELECT * FROM agent.runtime WHERE singleton"),
      db.query(
        `SELECT DISTINCT ON(target_id) target_id,recorded_at,payload FROM agent.observation ORDER BY target_id,recorded_at DESC`,
      ),
      db.query(
        "SELECT * FROM agent.incident WHERE target_id IN ('primary','standby') ORDER BY last_seen_at DESC LIMIT 60",
      ),
      db.query("SELECT * FROM agent.action WHERE target_id IN ('primary','standby') ORDER BY created_at DESC LIMIT 60"),
      db.query("SELECT r.* FROM agent.review r LEFT JOIN agent.incident i USING(incident_id) WHERE (i.target_id IN ('primary','standby') OR r.incident_id IS NULL) AND coalesce(r.proposed_action->>'scope','')<>'fleet' ORDER BY r.created_at DESC LIMIT 80"),
      db.query("SELECT e.* FROM agent.event e LEFT JOIN agent.incident i USING(incident_id) WHERE (i.target_id IN ('primary','standby') OR e.incident_id IS NULL) AND NOT(e.event_type LIKE 'fleet.%') ORDER BY e.event_id DESC LIMIT 120"),
      db.query("SELECT m.* FROM agent.memory m LEFT JOIN agent.incident i USING(incident_id) WHERE (i.target_id IN ('primary','standby') OR m.incident_id IS NULL) AND coalesce(m.metadata->>'scope','')<>'fleet' ORDER BY m.created_at DESC LIMIT 60"),
      db.query("SELECT * FROM agent.run WHERE cluster_id IS NULL ORDER BY started_at DESC LIMIT 20"),
      db.query(
        `SELECT s.* FROM agent.step s JOIN (SELECT run_id FROM agent.run WHERE cluster_id IS NULL ORDER BY started_at DESC LIMIT 20) r USING(run_id) ORDER BY s.sequence`,
      ),
      db.query(
        `SELECT target_id,recorded_at,payload FROM (SELECT *,row_number() OVER(PARTITION BY target_id ORDER BY recorded_at DESC) AS rn FROM agent.observation) o WHERE rn<=60 ORDER BY recorded_at`,
      ),
      db.query("SELECT * FROM agent.demo_fixture"),
    ]);
  const runtime = rt.rows[0] || {};
  const activeProfile = (await db.query("SELECT provider,model FROM agent.model_profile WHERE active AND purpose='chat' LIMIT 1")).rows[0];
  const rs = runtime.state || {};
  const health = workerHealth(runtime);
  const stale = health.status !== "healthy";
  const topology = ["primary", "standby"].map(
    (id) =>
      obs.rows.find((o) => o.target_id === id)?.payload || {
        id,
        name: id === "primary" ? "Workload primary" : "Physical standby",
        role: id,
        status: "unknown",
        replication: {
          lagBytes: null,
          lagSeconds: null,
          connected: null,
          replayPaused: null,
        },
      },
  );
  const primary = topology[0],
    standby = topology[1];
  const history = (id, path) =>
    hist.rows
      .filter((r) => r.target_id === id)
      .map((r) => ({ at: timestamp(r.recorded_at), value: path(r.payload) }))
      .filter((r) => r.value != null);
  const metrics = [
    {
      name: "Connections",
      value: primary.connections ?? null,
      unit: "sessions",
      status: primary.status === "healthy" ? "healthy" : "unknown",
      history: history("primary", (o) => o.connections),
    },
    {
      name: "Replication lag",
      value: standby.replication?.lagBytes ?? null,
      unit: "bytes",
      status: standby.replication?.replayPaused
        ? "critical"
        : standby.replication?.connected
          ? "healthy"
          : "warning",
      history: history("standby", (o) => o.replication?.lagBytes),
    },
    {
      name: "Buffer cache hits",
      value: primary.cacheHitPercent ?? null,
      unit: "%",
      status: "healthy",
      history: history("primary", (o) => o.cacheHitPercent),
    },
    {
      name: "Active incidents",
      value: inc.rows.filter((i) => i.status !== "resolved").length,
      unit: "findings",
      status: inc.rows.some(
        (i) => i.status !== "resolved" && i.severity === "critical",
      )
        ? "critical"
        : "healthy",
      history: [],
    },
  ];
  const q = primary.queries?.queries || [];
  return {
    agent: {
      name: "Verdant",
      status: stale
        ? "degraded"
        : p.paused
          ? "paused"
          : rs.status || "watching",
      mode: "guarded",
      planner: rs.planner || "monitor",
      model: activeProfile?.model || MODEL,
      provider: activeProfile?.provider || "ollama",
      intervalSeconds: p.monitorIntervalSeconds,
      lastCycleAt: rs.lastCycleAt || null,
      nextCycleAt: rs.nextCycleAt || null,
      directive: p.directive,
      cycleCount: rs.cycleCount || 0,
      uptimeSeconds: rs.startedAt
        ? Math.floor((Date.now() - new Date(rs.startedAt)) / 1000)
        : 0,
      workerHeartbeatAt: health.heartbeatAt,
      workerStatus: health.status,
      error: rs.error || null,
    },
    topology,
    metrics,
    incidents: inc.rows.map((r) => ({
      id: r.incident_id,
      targetId: r.target_id,
      kind: r.kind,
      title: r.title,
      severity: r.severity,
      status: r.status,
      summary: r.summary,
      evidence: r.evidence,
      generation: r.generation,
      firstSeenAt: timestamp(r.first_seen_at),
      lastSeenAt: timestamp(r.last_seen_at),
      resolvedAt: timestamp(r.resolved_at),
    })),
    actions: act.rows.map((r) => ({
      id: r.action_id,
      incidentId: r.incident_id,
      targetId: r.target_id,
      tool: r.tool,
      title: r.title,
      status: r.status,
      risk: r.risk,
      reason: r.reason,
      before: r.before_evidence,
      after: r.after_evidence,
      createdAt: timestamp(r.created_at),
      verifiedAt: timestamp(r.verified_at),
      sql: r.sql_template,
      error: r.error,
      attempts: r.attempts,
    })),
    reviews: rev.rows.map(mapReview),
    events: ev.rows.map((r) => ({
      id: String(r.event_id),
      at: timestamp(r.recorded_at),
      type: r.event_type,
      severity: r.severity,
      title: r.title,
      detail: r.detail,
      incidentId: r.incident_id,
      runId: r.run_id,
      actionId: r.action_id,
    })),
    memories: mem.rows.map((r) => ({
      id: r.memory_id,
      kind: r.kind,
      title: r.title,
      content: r.content,
      incidentId: r.incident_id,
      actionId: r.action_id,
      reviewId: r.review_id,
      createdAt: timestamp(r.created_at),
      retrievedCount: r.retrieved_count,
      metadata: r.metadata,
    })),
    runs: runs.rows.map((r) => ({
      id: r.run_id,
      status: r.status,
      startedAt: timestamp(r.started_at),
      completedAt: timestamp(r.completed_at),
      planner: r.planner,
      model: r.model,
      steps: steps.rows
        .filter((s) => s.run_id === r.run_id)
        .map((s) => ({
          tool: s.tool,
          reason: s.reason,
          source: s.source,
          arguments: s.arguments,
          observation: s.observation,
          at: timestamp(s.recorded_at),
        })),
      summary: r.summary,
      recalledMemoryIds: r.recalled_memory_ids,
      error: r.error,
    })),
    policy: p,
    queries: q.map((r) => ({
      queryid: r.queryid,
      query: r.query,
      calls: asNumber(r.calls),
      meanMs: asNumber(r.mean_ms),
      totalMs: asNumber(r.total_ms),
      rows: asNumber(r.rows),
      sharedReadBlocks: asNumber(r.shared_blks_read),
      scope: "Since pg_stat_statements reset",
    })),
    demo: {
      enabled: DEMO_ENABLED,
      fixtures: fixtureInfo.map((f) => ({
        ...f,
        active:
          fixtures.rows.find((r) => r.fixture_id === f.id)?.active || false,
        updatedAt: timestamp(
          fixtures.rows.find((r) => r.fixture_id === f.id)?.updated_at,
        ),
      })),
    },
  };
}
export async function getSchema() {
  const [columns, constraints] = await Promise.all([
    db.query(`SELECT c.relname AS table_name,a.attname AS column_name,
      pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
      NOT a.attnotnull AS nullable,a.attidentity AS identity_kind,a.attgenerated AS generated_kind,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression,
      EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND i.indisprimary AND a.attnum=ANY(i.indkey)) AS primary_key,
      col_description(c.oid,a.attnum) AS description,obj_description(c.oid,'pg_class') AS table_description
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE n.nspname='agent' AND c.relkind IN ('r','p') ORDER BY c.relname,a.attnum`),
    db.query(`SELECT c.relname AS table_name,k.conname AS name,
      rn.nspname||'.'||r.relname AS target_table,pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_class r ON r.oid=k.confrelid JOIN pg_namespace rn ON rn.oid=r.relnamespace
      WHERE n.nspname='agent' AND k.contype='f' ORDER BY c.relname,k.conname`),
  ]);
  const cols = columns.rows;
  const purposes = {
    target: "Monitored database inventory without credentials",
    policy: "Human steering and bounded autonomy policy",
    runtime: "Worker heartbeat and scheduler state",
    observation: "Timestamped measured database observations",
    incident: "Deduplicated findings with recurrence generations",
    run: "A durable model investigation cycle",
    step: "Named tool selections and checked observations",
    action: "Guarded action attempts with before and after evidence",
    review: "Human approval and acknowledgement queue",
    event: "Append-only operational event timeline",
    memory: "Searchable outcomes and human feedback recalled in later cycles",
    lease: "Single-worker lease and fencing generation",
    demo_fixture: "Scenario injection state",
    search_document:
      "Hybrid search over events, outcomes, SQL evidence and memory",
  };
  const tableNames = [...new Set(cols.map((c) => c.table_name))];
  return {
    schema: "agent",
    tableCount: tableNames.length,
    columnCount: cols.length,
    tables: tableNames.map((name) => ({
      name: "agent." + name,
      purpose:
        purposes[name] ||
        cols.find((c) => c.table_name === name)?.table_description ||
        "Durable agent state",
      columns: cols
        .filter((c) => c.table_name === name)
        .map((c) => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.nullable,
          primaryKey: c.primary_key,
          default: c.generated_kind ? null : c.default_expression,
          generatedExpression: c.generated_kind ? c.default_expression : null,
          identity:
            c.identity_kind === "a"
              ? "always"
              : c.identity_kind === "d"
                ? "by default"
                : null,
          generated:
            c.generated_kind === "s"
              ? "stored"
              : c.generated_kind === "v"
                ? "virtual"
                : null,
          description: c.description,
        })),
      relations: constraints.rows
        .filter((r) => r.table_name === name)
        .map((r) => ({
          name: r.name,
          targetTable: r.target_table,
          definition: r.definition,
        })),
    })),
  };
}
