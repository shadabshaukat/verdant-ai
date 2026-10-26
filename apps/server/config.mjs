import fs from "node:fs";
import pg from "pg";
const { Pool } = pg;
export const MODEL =
  process.env.OLLAMA_CHAT_MODEL ||
  process.env.OLLAMA_MODEL ||
  "qwen3:4b-instruct-2507-q4_K_M";
export const OLLAMA_URL =
  process.env.OLLAMA_URL || "http://host.docker.internal:11434";
export const DEMO_ENABLED = process.env.DEMO_ENABLED !== "false";
const names = {
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
};
const secret = (file) =>
  file ? fs.readFileSync(file, "utf8").trim() : undefined;
export function poolConfig(name) {
  const d = names[name];
  const raw = process.env[name + "_DATABASE_URL"] || process.env[name + "_URL"];
  const password =
    secret(process.env[name + "_PASSWORD_FILE"]) ||
    secret(process.env[name + "_DB_PASSWORD_FILE"]) ||
    process.env[name + "_PASSWORD"];
  return {
    ...(raw
      ? { connectionString: raw }
      : {
          host: process.env[name + "_HOST"] || d.host,
          port: Number(process.env[name + "_PORT"] || 5432),
          database: process.env[name + "_DATABASE"] || d.database,
          user: process.env[name + "_USER"] || d.user,
        }),
    ...(password ? { password } : {}),
    max: name === "CONTROL" ? 8 : 4,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    statement_timeout: 8000,
    application_name:
      "verdant-" +
      (process.env.SERVICE_ROLE || "server") +
      "-" +
      name.toLowerCase(),
  };
}
export const pools = Object.fromEntries(
  Object.keys(names).map((n) => [n, new Pool(poolConfig(n))]),
);
for (const [name, pool] of Object.entries(pools))
  pool.on("error", (e) =>
    console.error(
      JSON.stringify({ level: "error", component: name, message: e.message }),
    ),
  );
export async function closePools() {
  await Promise.allSettled(Object.values(pools).map((p) => p.end()));
}
export const asNumber = (v) => (v == null ? null : Number(v));
export const timestamp = (v) => (v ? new Date(v).toISOString() : null);
export const errText = (e) => String(e?.message || e).slice(0, 1000);
