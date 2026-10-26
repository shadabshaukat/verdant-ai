import { staleTable } from "./fleet-maintenance.mjs";
export function detectFleetFindings(endpoint, snapshot) {
  const target = endpoint.targetId,
    base = { target },
    items = [];
  const add = (key, kind, title, summary, evidence, severity = "warning") =>
    items.push({
      ...base,
      key,
      fingerprint: target + ":" + key,
      kind,
      title,
      severity,
      summary,
      evidence: { ...evidence, observedAt: snapshot.at, scope: "fleet" },
    });
  if (snapshot.status === "unavailable") {
    add(
      "unavailable",
      "endpoint_unavailable",
      "Database endpoint unavailable",
      "Connection or basic read-only probe failed. Health and all unavailable measurements remain unknown.",
      { error: snapshot.error },
      "critical",
    );
    return items;
  }
  const m = snapshot.metrics,
    c = snapshot.capabilities,
    d = snapshot.details;
  if (m.connectionUtilizationPercent >= 85)
    add(
      "connections",
      "connection_pressure",
      "Connection capacity is under pressure",
      "Cluster-wide client connections exceed 85% of max_connections.",
      {
        connections: m.connections,
        maxConnections: m.maxConnections,
        utilizationPercent: m.connectionUtilizationPercent,
      },
    );
  if (m.blockedSessions > 0)
    add(
      "blocked",
      "blocked_queries",
      "Queries are waiting for blockers",
      "Fresh activity contains blocked sessions. External session cancellation is not supported.",
      { blockedSessions: m.blockedSessions, blockers: d.blockers },
    );
  if (m.longTransactions > 0)
    add(
      "long-transactions",
      "long_transaction",
      "Long-running transactions observed",
      "Transactions older than 60 seconds can retain locks and prevent cleanup.",
      { longTransactions: d.longTransactions },
    );
  if (m.idleTransactions > 0)
    add(
      "idle-transactions",
      "idle_transaction",
      "Idle transactions observed",
      "Open idle transactions require application/operator investigation.",
      {
        longTransactions: d.longTransactions.filter(
          (t) => t.state === "idle in transaction",
        ),
      },
    );
  if (c.tables?.available)
    for (const t of d.tables)
      if (staleTable(t))
        add(
          "stats:" + t.schema + "." + t.table,
          "stale_statistics",
          "Statistics may be stale: " + t.schema + "." + t.table,
          "Estimated modifications exceed max(1000, 10% of live rows). This is a maintenance concern, not proof of query latency regression.",
          { table: t },
        );
  if (m.replicationReplayPaused === true)
    add(
      "replay-paused",
      "replication_paused",
      "Physical WAL replay is paused",
      "The connected replica reports paused physical replay. Managed-service control-plane behavior may differ.",
      { replication: d.replication },
    );
  if (m.replicationLagBytes > 1048576)
    add(
      "replication-backlog",
      "replication_backlog",
      "Observed WAL backlog exceeds 1 MiB",
      "Measured physical sender or local received-WAL backlog; NULL measurements are never treated as zero lag.",
      { lagBytes: m.replicationLagBytes, replication: d.replication },
    );
  if (m.deadlocksSinceLastSample > 0)
    add(
      "deadlocks",
      "deadlocks",
      "New deadlocks detected",
      "Database deadlock counter increased between comparable samples. SQL attribution requires application/server logs.",
      { delta: m.deadlocksSinceLastSample, total: m.deadlocksTotal },
    );
  const monitor = d.security.roles.find((r) => r.name === snapshot.monitorUser);
  if (
    monitor &&
    (monitor.superuser ||
      monitor.createRole ||
      monitor.createDatabase ||
      monitor.replication ||
      monitor.bypassRls)
  )
    add(
      "monitor-privilege",
      "security_posture",
      "Monitoring login has elevated privileges",
      "Dedicated monitoring credentials should not have administrative flags. This is role posture, not evidence of an attack.",
      { role: monitor },
    );
  if (endpoint.sslMode !== "verify-full")
    add(
      "tls",
      "tls_posture",
      "Endpoint identity verification is disabled",
      "Configured TLS mode does not authenticate both the CA chain and hostname. Use verify-full for remote deployments.",
      { sslMode: endpoint.sslMode },
      "info",
    );
  if (c.queries?.available)
    for (const q of snapshot.queries)
      if (q.calls >= 3 && q.meanMs >= 1000)
        add(
          "query:" + q.queryId,
          "query_performance_concern",
          "Cumulative expensive query fingerprint",
          "This fingerprint has cumulative mean execution time above one second. It is not a measured recent regression or individual execution.",
          { query: q, scope: q.scope },
        );
  return items;
}
export function hasPositiveRecovery(incident, snapshot) {
  if (snapshot.status === "unavailable") return false;
  const m = snapshot.metrics;
  switch (incident.kind) {
    case "endpoint_unavailable":
      return snapshot.capabilities.basic?.available === true;
    case "connection_pressure":
      return (
        m.connectionUtilizationPercent !== null &&
        m.connectionUtilizationPercent < 85
      );
    case "blocked_queries":
      return m.blockedSessions === 0;
    case "long_transaction":
      return m.longTransactions === 0;
    case "idle_transaction":
      return m.idleTransactions === 0;
    case "stale_statistics": {
      const old = incident.evidence?.table,
        t = snapshot.details.tables.find(
          (t) => t.schema === old?.schema && t.table === old?.table,
        );
      return (
        snapshot.capabilities.tables?.available === true &&
        !!t &&
        !staleTable(t)
      );
    }
    case "replication_paused":
      return m.replicationReplayPaused === false;
    case "replication_backlog":
      return m.replicationLagBytes !== null && m.replicationLagBytes <= 1048576;
    case "deadlocks":
      return m.deadlocksSinceLastSample === 0;
    case "security_posture": {
      const r = snapshot.details.security.roles.find(
        (r) => r.name === snapshot.monitorUser,
      );
      return (
        !!r &&
        !r.superuser &&
        !r.createRole &&
        !r.createDatabase &&
        !r.replication &&
        !r.bypassRls
      );
    }
    case "tls_posture":
      return false; // Configuration changes clear only after an explicit fresh identity-verified observation in collector.
    case "query_performance_concern": {
      const q = snapshot.queries.find(
        (q) => q.queryId === incident.evidence?.query?.queryId,
      );
      return !!q && q.calls >= 3 && q.meanMs < 1000;
    }
    default:
      return false;
  }
}
