import { randomUUID } from "node:crypto";
import { db, transaction, event } from "./store.mjs";
import { DEMO_ENABLED, poolConfig, errText } from "./config.mjs";
import { sealSecret, openSecret } from "./credential-vault.mjs";
import {
  validateCluster,
  uuid,
  fleetError,
  FLEET_POLICY,
} from "./fleet-validation.mjs";
import { collectEndpoint } from "./fleet-sensors.mjs";
import { probeMaintenance } from "./fleet-maintenance.mjs";
const iso = (v) => (v ? new Date(v).toISOString() : null);
export function publicEndpoint(row) {
  return {
    id: row.endpoint_id,
    name: row.name,
    role: row.role,
    host: row.host,
    port: row.port,
    database: row.database_name,
    username: row.username,
    sslMode: row.ssl_mode,
    hasPassword: !!row.monitor_secret,
    hasCaCertificate: row.has_ca,
    enabled: row.enabled,
    status: row.snapshot?.status || "unknown",
    lastSeenAt: iso(row.last_success_at),
    lastCheckedAt: iso(row.last_checked_at),
    lastError: row.last_error || null,
  };
}
export function publicCluster(row, endpoints = []) {
  const policy = { ...FLEET_POLICY, ...row.policy },
    ready = !!endpoints.find(
      (e) =>
        e.enabled &&
        e.role === "primary" &&
        e.snapshot?.capabilities?.maintenance?.available,
    );
  return {
    id: row.cluster_id,
    name: row.name,
    provider: row.provider,
    kind: "external",
    enabled: row.enabled,
    deleted: !!row.deleted_at,
    monitorOnly: !policy.allowAnalyze || !ready,
    policy,
    actionCredentialsConfigured: !!row.action_secret,
    remediation: {
      mode: !policy.allowAnalyze
        ? "review_only"
        : !ready
          ? "setup_required"
          : policy.autoAnalyze
            ? "bounded_auto_analyze"
            : "approval_required",
      supportedTools: policy.allowAnalyze && ready ? ["analyze_table"] : [],
      reason: !policy.allowAnalyze
        ? "External monitoring findings are queued for human review. No external writes are enabled."
        : !ready
          ? "The approved helper and separate executor grants must be verified before maintenance can run."
          : "Only the exact bootstrap-installed ANALYZE helper and current per-cluster table allowlist are executable; all other duties require human review.",
    },
    endpoints: endpoints.map(publicEndpoint),
    lastSeenAt: iso(
      endpoints
        .map((e) => e.last_success_at)
        .filter(Boolean)
        .sort((a, b) => +new Date(b) - +new Date(a))[0],
    ),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function demoConnection(name) {
  const c = poolConfig(name);
  if (c.connectionString) {
    const u = new URL(c.connectionString);
    return {
      host: u.hostname,
      port: Number(u.port || 5432),
      database: decodeURIComponent(u.pathname.slice(1)),
      username: decodeURIComponent(u.username),
    };
  }
  return { host: c.host, port: c.port, database: c.database, username: c.user };
}
export function demoCluster() {
  return {
    id: "demo",
    name: "Built-in PostgreSQL",
    provider: "self-managed",
    kind: "demo",
    enabled: true,
    monitorOnly: false,
    actionCredentialsConfigured: true,
    remediation: {
      mode: "demo_policy",
      supportedTools: [
        "analyze_table",
        "resume_replication",
        "cancel_demo_blocker",
        "restrict_demo_role",
        "create_demo_index",
      ],
      reason: "Existing bounded disposable demo policy.",
    },
    endpoints: [
      {
        id: "primary",
        name: "Workload primary",
        role: "primary",
        ...demoConnection("PRIMARY"),
        sslMode: "disable",
        hasPassword: true,
        hasCaCertificate: false,
      },
      {
        id: "standby",
        name: "Physical standby",
        role: "replica",
        ...demoConnection("STANDBY"),
        sslMode: "disable",
        hasPassword: true,
        hasCaCertificate: false,
      },
    ],
  };
}
export async function listClusters() {
  const [clusters, endpoints] = await Promise.all([
    db.query("SELECT * FROM agent.fleet_cluster ORDER BY created_at"),
    db.query("SELECT * FROM agent.fleet_endpoint ORDER BY created_at"),
  ]);
  return {
    clusters: [
      ...(DEMO_ENABLED ? [demoCluster()] : []),
      ...clusters.rows.map((row) =>
        publicCluster(
          row,
          endpoints.rows.filter((e) => e.cluster_id === row.cluster_id),
        ),
      ),
    ],
  };
}
export async function internalCluster(id) {
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
  ).rows;
  const decoded = endpoints.map((e) => {
    const secret = openSecret(e.monitor_secret);
    return {
      id: e.endpoint_id,
      enabled: e.enabled,
      name: e.name,
      role: e.role,
      host: e.host,
      port: e.port,
      database: e.database_name,
      username: e.username,
      sslMode: e.ssl_mode,
      password: secret.password,
      caCertificate: secret.caCertificate || null,
      targetId: e.target_id,
      configurationVersion: e.updated_at,
      previous: e.snapshot || {},
    };
  });
  return {
    id: row.cluster_id,
    name: row.name,
    provider: row.provider,
    enabled: row.enabled && !row.deleted_at,
    policy: { ...FLEET_POLICY, ...row.policy },
    endpoints: decoded.filter((e) => e.enabled),
    allEndpoints: decoded,
    actionCredentials: row.action_secret ? openSecret(row.action_secret) : null,
    row,
  };
}
export async function saveCluster(body, id = null) {
  if (id === "demo")
    throw fleetError(
      "The built-in demo connection is configured through deployment settings",
    );
  const existing = id ? await internalCluster(id) : null,
    normalized = validateCluster(body, existing),
    clusterId = id || randomUUID();
  if (
    !existing &&
    (
      await db.query(
        "SELECT count(*)::int AS count FROM agent.fleet_cluster WHERE deleted_at IS NULL",
      )
    ).rows[0].count >= 50
  )
    throw fleetError(
      "This deployment supports at most 50 registered clusters",
      409,
    );
  const actionSecret = normalized.actionCredentials
    ? sealSecret(normalized.actionCredentials)
    : null;
  const secrets = new Map(
    normalized.endpoints.map((e) => [
      e.id,
      sealSecret({ password: e.password, caCertificate: e.caCertificate }),
    ]),
  );
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(723105,1)");
    if (
      !existing &&
      (
        await c.query(
          "SELECT count(*)::int AS count FROM agent.fleet_cluster WHERE deleted_at IS NULL",
        )
      ).rows[0].count >= 50
    )
      throw fleetError(
        "This deployment supports at most 50 registered clusters",
        409,
      );
    await c.query(
      `INSERT INTO agent.fleet_cluster(cluster_id,name,provider,enabled,policy,action_secret) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(cluster_id) DO UPDATE SET name=EXCLUDED.name,provider=EXCLUDED.provider,enabled=EXCLUDED.enabled,policy=EXCLUDED.policy,action_secret=EXCLUDED.action_secret,updated_at=now(),deleted_at=NULL`,
      [
        clusterId,
        normalized.name,
        normalized.provider,
        normalized.enabled,
        normalized.policy,
        actionSecret,
      ],
    );
    await c.query(
      "UPDATE agent.fleet_endpoint SET enabled=false WHERE cluster_id=$1",
      [clusterId],
    );
    await c.query(
      "UPDATE agent.target SET enabled=false WHERE metadata->>'clusterId'=$1",
      [clusterId],
    );
    for (const e of normalized.endpoints) {
      const targetId = `fleet:${clusterId}:${e.id}`;
      await c.query(
        `INSERT INTO agent.target(target_id,name,role,enabled,metadata) VALUES($1,$2,$3,$4,$5) ON CONFLICT(target_id) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,enabled=EXCLUDED.enabled,metadata=EXCLUDED.metadata`,
        [
          targetId,
          normalized.name + " / " + e.name,
          e.role === "replica" ? "standby" : "primary",
          normalized.enabled,
          {
            clusterId,
            endpointId: e.id,
            scope: "fleet",
            provider: normalized.provider,
          },
        ],
      );
      await c.query(
        `INSERT INTO agent.fleet_endpoint(endpoint_id,cluster_id,target_id,name,role,host,port,database_name,username,ssl_mode,has_ca,monitor_secret,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) ON CONFLICT(endpoint_id) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,host=EXCLUDED.host,port=EXCLUDED.port,database_name=EXCLUDED.database_name,username=EXCLUDED.username,ssl_mode=EXCLUDED.ssl_mode,has_ca=EXCLUDED.has_ca,monitor_secret=EXCLUDED.monitor_secret,enabled=true,snapshot='{}'::jsonb,last_checked_at=NULL,last_error=NULL,updated_at=now()`,
        [
          e.id,
          clusterId,
          targetId,
          e.name,
          e.role,
          e.host,
          e.port,
          e.database,
          e.username,
          e.sslMode,
          !!e.caCertificate,
          secrets.get(e.id),
        ],
      );
    }
    await event(
      "fleet.registry_saved",
      "Cluster connection settings saved",
      {
        clusterId,
        name: normalized.name,
        provider: normalized.provider,
        endpoints: normalized.endpoints.length,
        monitorOnly: !normalized.policy.allowAnalyze,
      },
      {},
      c,
    );
  });
  return (await listClusters()).clusters.find((c) => c.id === clusterId);
}
export async function deleteCluster(id) {
  uuid(id);
  const result = await transaction(async (c) => {
    const row = (
      await c.query(
        "UPDATE agent.fleet_cluster SET enabled=false,deleted_at=coalesce(deleted_at,now()),updated_at=now() WHERE cluster_id=$1 RETURNING name",
        [id],
      )
    ).rows[0];
    if (!row) throw fleetError("Cluster not found", 404);
    await c.query(
      "UPDATE agent.fleet_endpoint SET enabled=false WHERE cluster_id=$1",
      [id],
    );
    await c.query(
      "UPDATE agent.target SET enabled=false WHERE metadata->>'clusterId'=$1",
      [id],
    );
    await event(
      "fleet.registry_disabled",
      "Cluster monitoring disabled",
      { clusterId: id, name: row.name, historyRetained: true },
      {},
      c,
    );
    return { id, enabled: false, historyRetained: true };
  });
  return result;
}
export async function testCluster(bodyOrId) {
  const cluster =
    typeof bodyOrId === "string"
      ? await internalCluster(bodyOrId)
      : bodyOrId?.id && !bodyOrId.endpoints
        ? await internalCluster(bodyOrId.id)
        : validateCluster(
            bodyOrId,
            bodyOrId?.id ? await internalCluster(bodyOrId.id) : null,
          );
  const results = await Promise.all(
    cluster.endpoints.map(async (e) => {
      const s = await collectEndpoint(e, {}, cluster.policy);
      s.capabilities.maintenance =
        s.status !== "unavailable" && s.actualRole === "primary"
          ? await probeMaintenance(cluster, e)
          : { available: false, scope: "No writable primary capability." };
      return {
        id: e.id,
        name: e.name,
        ok: s.status !== "unavailable",
        status: s.status,
        serverVersion: s.serverVersion,
        role: s.actualRole,
        capabilities: s.capabilities,
        notes: s.notes,
        error: s.error || null,
      };
    }),
  );
  return {
    ok: results.every((e) => e.ok),
    checkedAt: new Date().toISOString(),
    endpoints: results,
    scope:
      "Read-only connection/capability checks; no helper is installed and no maintenance action executes.",
  };
}
