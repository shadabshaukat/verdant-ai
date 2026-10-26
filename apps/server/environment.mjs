import fs from "node:fs";
export const DATABASE_DEFAULTS = Object.freeze({
  CONTROL: { host: "control", database: "verdant", user: "verdant_control" },
  PRIMARY: { host: "primary", database: "workload", user: "verdant_monitor" },
  STANDBY: { host: "standby", database: "workload", user: "verdant_monitor" },
  PRIMARY_ACTION: {
    host: "primary",
    database: "workload",
    user: "verdant_executor",
  },
  STANDBY_ACTION: {
    host: "standby",
    database: "workload",
    user: "verdant_executor",
  },
  PRIMARY_DEMO: { host: "primary", database: "workload", user: "verdant_demo" },
  STANDBY_DEMO: { host: "standby", database: "workload", user: "verdant_demo" },
});
const invalid = (key, expected) => {
  throw new Error(`${key} ${expected}`);
};
function text(env, key, fallback, max = 1024) {
  const raw = env[key];
  if (raw == null || raw === "") return fallback;
  if (
    typeof raw !== "string" ||
    !raw.trim() ||
    raw.length > max ||
    /[\r\n\0]/.test(raw)
  )
    invalid(key, "must be a non-empty single-line string");
  return raw.trim();
}
function integer(env, key, fallback, min, max) {
  const value = text(env, key, String(fallback), 20);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    invalid(key, `must be an integer between ${min} and ${max}`);
  return Number(value);
}
function boolean(env, key, fallback) {
  const value = text(env, key, String(fallback), 5).toLowerCase();
  if (!["true", "false", "1", "0"].includes(value))
    invalid(key, "must be true, false, 1 or 0");
  return value === "true" || value === "1";
}
function httpUrl(env, key, fallback) {
  const value = text(env, key, fallback, 2048);
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid(key, "must be an HTTP(S) base URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    invalid(
      key,
      "must be an HTTP(S) base URL without credentials, query or fragment",
    );
  return url.toString().replace(/\/+$/, "");
}
function model(env, key, fallback) {
  const value = text(env, key, fallback, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+\-]*$/.test(value))
    invalid(
      key,
      "must be a model name without whitespace or control characters",
    );
  return value;
}
export function loadEnvironment(
  env = process.env,
  { defaultRole = "server" } = {},
) {
  const sharedUrl = httpUrl(
    env,
    "OLLAMA_URL",
    "http://host.docker.internal:11434",
  );
  const serviceRole = text(env, "SERVICE_ROLE", defaultRole, 32);
  if (!/^[a-z][a-z0-9-]*$/.test(serviceRole))
    invalid("SERVICE_ROLE", "must be a lowercase service label");
  const host = text(env, "SERVER_HOST", "0.0.0.0", 253);
  if (/[\s/\\]/.test(host))
    invalid("SERVER_HOST", "must be a listen hostname or IP address");
  const keepAlive = text(env, "OLLAMA_KEEP_ALIVE", "30m", 10);
  const duration = keepAlive.match(/^(0|[1-9]\d{0,4})([smh])?$/);
  if (
    !duration ||
    (keepAlive !== "0" && !duration[2]) ||
    Number(duration[1]) * ({ s: 1, m: 60, h: 3600 }[duration?.[2]] || 1) > 86400
  )
    invalid(
      "OLLAMA_KEEP_ALIVE",
      "must be 0 or a duration in s/m/h of at most 24 hours",
    );
  const chatModelKey = text(env, "OLLAMA_CHAT_MODEL", null, 200)
    ? "OLLAMA_CHAT_MODEL"
    : "OLLAMA_MODEL";
  const config = {
    serviceRole,
    serverHost: host,
    port: integer(env, "PORT", 8090, 1, 65535),
    ollamaUrl: sharedUrl,
    chatUrl: httpUrl(env, "OLLAMA_CHAT_URL", sharedUrl),
    embeddingUrl: httpUrl(env, "OLLAMA_EMBED_URL", sharedUrl),
    chatModel: model(env, chatModelKey, "qwen3:4b-instruct-2507-q4_K_M"),
    embeddingModel: model(env, "OLLAMA_EMBED_MODEL", "nomic-embed-text:v1.5"),
    ollamaKeepAlive: keepAlive,
    plannerTimeoutMs: integer(env, "PLANNER_TIMEOUT_MS", 45000, 1000, 180000),
    plannerContextTokens: integer(
      env,
      "PLANNER_CONTEXT_TOKENS",
      12288,
      2048,
      32768,
    ),
    plannerMaxTokens: integer(env, "PLANNER_MAX_TOKENS", 300, 64, 2048),
    embeddingTimeoutMs: integer(env, "EMBEDDING_TIMEOUT_MS", 12000, 500, 60000),
    embeddingQueryTimeoutMs: integer(
      env,
      "EMBEDDING_QUERY_TIMEOUT_MS",
      5000,
      100,
      30000,
    ),
    semanticRecallTimeoutMs: integer(
      env,
      "SEMANTIC_RECALL_TIMEOUT_MS",
      1200,
      100,
      5000,
    ),
    memoryIndexIntervalMs: integer(
      env,
      "MEMORY_INDEX_INTERVAL_MS",
      15000,
      1000,
      300000,
    ),
    memoryIndexBatchSize: integer(env, "MEMORY_INDEX_BATCH_SIZE", 100, 1, 500),
    memoryEmbedBatchSize: integer(env, "MEMORY_EMBED_BATCH_SIZE", 8, 1, 64),
    monitorIntervalSeconds: integer(
      env,
      "MONITOR_INTERVAL_SECONDS",
      15,
      5,
      300,
    ),
    demoEnabled: boolean(env, "DEMO_ENABLED", true),
    dbConnectTimeoutMs: integer(env, "DB_CONNECT_TIMEOUT_MS", 5000, 100, 30000),
    dbQueryTimeoutMs: integer(env, "DB_QUERY_TIMEOUT_MS", 10000, 200, 60000),
    dbStatementTimeoutMs: integer(
      env,
      "DB_STATEMENT_TIMEOUT_MS",
      8000,
      100,
      30000,
    ),
    controlPoolMax: integer(env, "CONTROL_POOL_MAX", 8, 2, 32),
    targetPoolMax: integer(env, "TARGET_POOL_MAX", 4, 1, 16),
    shutdownTimeoutMs: integer(env, "SHUTDOWN_TIMEOUT_MS", 10000, 1000, 30000),
    workerId: text(env, "WORKER_ID", null, 128),
  };
  if (config.dbQueryTimeoutMs <= config.dbStatementTimeoutMs)
    invalid("DB_QUERY_TIMEOUT_MS", "must exceed DB_STATEMENT_TIMEOUT_MS");
  if (config.semanticRecallTimeoutMs > config.embeddingQueryTimeoutMs)
    invalid(
      "SEMANTIC_RECALL_TIMEOUT_MS",
      "must not exceed EMBEDDING_QUERY_TIMEOUT_MS",
    );
  return Object.freeze(config);
}
function readSecret(env, keys, readFile) {
  for (const key of keys) {
    const file = text(env, key, null, 4096);
    if (file) {
      let value;
      try {
        value = readFile(file, "utf8").trim();
      } catch {
        invalid(key, "could not be read");
      }
      if (!value || /[\r\n\0]/.test(value))
        invalid(key, "must contain one non-empty secret");
      return value;
    }
  }
  return undefined;
}
export function databaseConfig(
  name,
  env = process.env,
  { config = loadEnvironment(env), readFile = fs.readFileSync } = {},
) {
  const defaults = DATABASE_DEFAULTS[name];
  if (!defaults) throw new Error("Unknown database connection role");
  let raw =
    text(env, name + "_DATABASE_URL", null, 16384) ||
    text(env, name + "_URL", null, 16384) ||
    readSecret(
      env,
      [name + "_DATABASE_URL_FILE", name + "_URL_FILE"],
      readFile,
    );
  let connection;
  if (raw) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      invalid(name + "_DATABASE_URL", "must be a PostgreSQL connection URL");
    }
    if (!["postgres:", "postgresql:"].includes(url.protocol))
      invalid(name + "_DATABASE_URL", "must be a PostgreSQL connection URL");
    if (!url.password) {
      const password =
        readSecret(
          env,
          [name + "_PASSWORD_FILE", name + "_DB_PASSWORD_FILE"],
          readFile,
        ) || text(env, name + "_PASSWORD", null, 4096);
      if (password) url.password = encodeURIComponent(password);
    }
    connection = { connectionString: url.toString() };
  } else {
    const password =
      readSecret(
        env,
        [name + "_PASSWORD_FILE", name + "_DB_PASSWORD_FILE"],
        readFile,
      ) || text(env, name + "_PASSWORD", null, 4096);
    connection = {
      host: text(env, name + "_HOST", defaults.host),
      port: integer(env, name + "_PORT", 5432, 1, 65535),
      database: text(env, name + "_DATABASE", defaults.database),
      user: text(env, name + "_USER", defaults.user),
      ...(password ? { password } : {}),
    };
  }
  return {
    ...connection,
    max: name === "CONTROL" ? config.controlPoolMax : config.targetPoolMax,
    connectionTimeoutMillis: config.dbConnectTimeoutMs,
    query_timeout: config.dbQueryTimeoutMs,
    statement_timeout: config.dbStatementTimeoutMs,
    application_name: `verdant-${config.serviceRole}-${name.toLowerCase()}`,
  };
}
export function redactError(error) {
  return String(error?.message || error)
    .replace(/\b(postgres(?:ql)?|https?):\/\/[^\s'"<>]+/gi, "$1://[redacted]")
    .replace(
      /\b(password|passwd|pwd)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[redacted]",
    )
    .slice(0, 1000);
}
export function initialPolicySettings(current, { hasHistory }, config) {
  return hasHistory
    ? { ...current }
    : { ...current, monitorIntervalSeconds: config.monitorIntervalSeconds };
}
