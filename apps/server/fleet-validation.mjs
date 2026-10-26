import { randomUUID } from "node:crypto";
import { checkServerIdentity } from "node:tls";
export const FLEET_PROVIDERS = [
  "self-managed",
  "aws-rds",
  "aws-aurora",
  "azure",
  "gcp",
  "oci",
  "generic",
];
export function loadFleetEnvironment(env = process.env) {
  const read = (key, fallback, min, max) => {
    const raw = env[key] ?? String(fallback);
    if (
      typeof raw !== "string" ||
      !/^\d+$/.test(raw) ||
      Number(raw) < min ||
      Number(raw) > max
    )
      throw new Error(
        key + " must be an integer between " + min + " and " + max,
      );
    return Number(raw);
  };
  return Object.freeze({
    monitorIntervalSeconds: read("FLEET_MONITOR_INTERVAL_SECONDS", 30, 10, 300),
    historyDays: read("FLEET_HISTORY_DAYS", 14, 1, 90),
  });
}
export const FLEET_ENV = loadFleetEnvironment();
export const FLEET_POLICY = Object.freeze({
  allowAnalyze: false,
  autoAnalyze: false,
  tableAllowlist: [],
  captureQueryText: true,
  monitorIntervalSeconds: FLEET_ENV.monitorIntervalSeconds,
  maxActionsPerHour: 2,
});
export const fleetError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
export function uuid(value, label = "Cluster ID") {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw fleetError(label + " must be a UUID");
  return value;
}
function text(value, label, max = 200) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\0\r\n]/.test(value)
  )
    throw fleetError(
      label + " must be non-empty text of at most " + max + " characters",
    );
  return value.trim();
}
function integer(value, fallback, min, max, label) {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < min || n > max)
    throw fleetError(
      label + " must be an integer between " + min + " and " + max,
    );
  return n;
}
function secret(value, label, max = 8192) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max ||
    value.includes("\0")
  )
    throw fleetError(
      label + " is required and must be at most " + max + " characters",
    );
  return value;
}
export function normalizeFleetPolicy(input = {}, current = FLEET_POLICY) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw fleetError("Policy must be an object");
  const p = { ...FLEET_POLICY, ...current };
  for (const key of Object.keys(input))
    if (!Object.hasOwn(FLEET_POLICY, key))
      throw fleetError("Unknown fleet policy field");
  for (const key of ["allowAnalyze", "autoAnalyze", "captureQueryText"])
    if (key in input) {
      if (typeof input[key] !== "boolean")
        throw fleetError(key + " must be boolean");
      p[key] = input[key];
    }
  p.monitorIntervalSeconds = integer(
    input.monitorIntervalSeconds ?? p.monitorIntervalSeconds,
    30,
    10,
    300,
    "Monitoring interval",
  );
  p.maxActionsPerHour = integer(
    input.maxActionsPerHour ?? p.maxActionsPerHour,
    2,
    0,
    10,
    "Maintenance budget",
  );
  if ("tableAllowlist" in input) {
    if (
      !Array.isArray(input.tableAllowlist) ||
      input.tableAllowlist.length > 25
    )
      throw fleetError("Allowlist must contain at most 25 tables");
    p.tableAllowlist = input.tableAllowlist.map((v) => ({
      schema: text(v?.schema, "Table schema", 63),
      table: text(v?.table, "Table name", 63),
    }));
  }
  if (p.autoAnalyze && !p.allowAnalyze)
    throw fleetError("autoAnalyze requires allowAnalyze");
  if (p.allowAnalyze && !p.tableAllowlist.length)
    throw fleetError("ANALYZE requires an explicit table allowlist");
  return p;
}
export function validateCluster(body, existing = null) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw fleetError("Cluster must be an object");
  const name = text(body.name ?? existing?.name, "Cluster name", 120),
    provider = body.provider ?? existing?.provider ?? "generic";
  if (!FLEET_PROVIDERS.includes(provider))
    throw fleetError("Unsupported provider label");
  const enabled = body.enabled ?? existing?.enabled ?? true;
  if (typeof enabled !== "boolean") throw fleetError("enabled must be boolean");
  const policy = normalizeFleetPolicy(
    body.policy || {},
    existing?.policy || FLEET_POLICY,
  );
  if (
    !Array.isArray(body.endpoints) ||
    body.endpoints.length < 1 ||
    body.endpoints.length > 20
  )
    throw fleetError("Provide 1 to 20 endpoints");
  const ids = new Set();
  let primaries = 0;
  const endpoints = body.endpoints.map((v, index) => {
    if (!v || typeof v !== "object" || Array.isArray(v))
      throw fleetError("Each endpoint must be an object");
    if (v.id && !existing)
      throw fleetError("Endpoint IDs are assigned by the registry on creation");
    const id = v.id ? uuid(v.id, "Endpoint ID") : randomUUID();
    if (ids.has(id)) throw fleetError("Endpoint IDs must be unique");
    ids.add(id);
    const previous = (existing?.allEndpoints || existing?.endpoints)?.find(
      (e) => e.id === id,
    );
    if (v.id && existing && !previous)
      throw fleetError("Endpoint does not belong to this cluster");
    const role =
      v.role ?? previous?.role ?? (index === 0 ? "primary" : "replica");
    if (!["primary", "replica"].includes(role))
      throw fleetError("Endpoint role must be primary or replica");
    if (role === "primary") primaries++;
    const host = text(v.host ?? previous?.host, "Endpoint host", 253);
    if (/[\s/@\\]/.test(host))
      throw fleetError("Host must be a hostname or IP address, not a URL");
    const sslMode = v.sslMode ?? previous?.sslMode ?? "verify-full";
    if (!["verify-full", "require", "disable"].includes(sslMode))
      throw fleetError("Invalid TLS mode");
    const caCertificate =
      v.caCertificate === undefined
        ? previous?.caCertificate || null
        : v.caCertificate || null;
    if (
      caCertificate &&
      (typeof caCertificate !== "string" ||
        caCertificate.length > 131072 ||
        !caCertificate.includes("-----BEGIN CERTIFICATE-----") ||
        !caCertificate.includes("-----END CERTIFICATE-----"))
    )
      throw fleetError("CA certificate must contain PEM certificates");
    const password =
      v.password === undefined
        ? previous?.password
        : secret(v.password, "Monitor password");
    if (!password)
      throw fleetError("Monitor password is required for a new connection");
    return {
      id,
      name: text(
        v.name ?? previous?.name ?? `${role} ${index + 1}`,
        "Endpoint name",
        100,
      ),
      role,
      host,
      port: integer(v.port ?? previous?.port, 5432, 1, 65535, "Port"),
      database: text(v.database ?? previous?.database, "Database", 128),
      username: text(v.username ?? previous?.username, "Monitor username", 128),
      password,
      sslMode,
      caCertificate,
    };
  });
  if (primaries > 1)
    throw fleetError("Only one endpoint may be declared primary");
  let actionCredentials = existing?.actionCredentials || null;
  if (body.actionCredentials === null) actionCredentials = null;
  else if (body.actionCredentials !== undefined)
    actionCredentials = {
      username: text(body.actionCredentials.username, "Executor username", 128),
      password:
        body.actionCredentials.password === undefined
          ? existing?.actionCredentials?.password
          : secret(body.actionCredentials.password, "Executor password"),
    };
  if (actionCredentials && !actionCredentials.password)
    throw fleetError("Executor password is required");
  if (policy.allowAnalyze && (!actionCredentials || primaries !== 1))
    throw fleetError(
      "ANALYZE requires separate executor credentials and one declared primary",
    );
  if (
    actionCredentials &&
    endpoints.some((e) => e.username === actionCredentials.username)
  )
    throw fleetError("Executor and monitor logins must be separate");
  return { name, provider, enabled, policy, endpoints, actionCredentials };
}
export function fleetConnection(
  endpoint,
  credentials = { username: endpoint.username, password: endpoint.password },
  { action = false } = {},
) {
  const ssl =
    endpoint.sslMode === "disable"
      ? false
      : {
          rejectUnauthorized: endpoint.sslMode === "verify-full",
          ...(endpoint.caCertificate ? { ca: endpoint.caCertificate } : {}),
          ...(endpoint.sslMode === "verify-full"
            ? {
                checkServerIdentity: (_host, cert) =>
                  checkServerIdentity(endpoint.host, cert),
              }
            : {}),
        };
  return {
    host: endpoint.host,
    port: endpoint.port,
    database: endpoint.database,
    user: credentials.username,
    password: credentials.password,
    ssl,
    connectionTimeoutMillis: 4000,
    query_timeout: 5000,
    statement_timeout: 4000,
    application_name: action
      ? "verdant-fleet-executor"
      : "verdant-fleet-monitor",
    options: action
      ? "-c lock_timeout=2000"
      : "-c default_transaction_read_only=on -c lock_timeout=1000",
  };
}
export function counterDeltas(previous, next, previousAt, nextAt) {
  const seconds = (Date.parse(nextAt) - Date.parse(previousAt)) / 1000;
  const keys = ["commits", "rollbacks", "deadlocks"];
  if (
    !previous ||
    !next ||
    !(seconds > 0) ||
    previous.statsReset !== next.statsReset ||
    keys.some(
      (k) =>
        previous[k] == null ||
        next[k] == null ||
        !Number.isFinite(Number(previous[k])) ||
        !Number.isFinite(Number(next[k])) ||
        Number(next[k]) < Number(previous[k]),
    )
  )
    return {
      transactionsPerSecond: null,
      commitsPerSecond: null,
      rollbacksPerSecond: null,
      deadlocksSinceLastSample: null,
      scope:
        "No comparable prior sample; first sample, reset, decreasing counters or invalid interval.",
    };
  const commits = Number(next.commits) - Number(previous.commits),
    rollbacks = Number(next.rollbacks) - Number(previous.rollbacks);
  return {
    transactionsPerSecond: (commits + rollbacks) / seconds,
    commitsPerSecond: commits / seconds,
    rollbacksPerSecond: rollbacks / seconds,
    deadlocksSinceLastSample:
      Number(next.deadlocks) - Number(previous.deadlocks),
    scope:
      "Delta between comparable database-wide samples; includes observer transactions.",
  };
}
export const sqlIdentifier = (value) => '"' + value.replaceAll('"', '""') + '"';
export const sqlLiteral = (value) => "'" + value.replaceAll("'", "''") + "'";
