import pg from "pg";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import {
  loadEnvironment,
  databaseConfig,
  redactError,
  DATABASE_DEFAULTS,
} from "./environment.mjs";
const { Pool } = pg;
export const ENV = loadEnvironment(process.env, {
  defaultRole:
    basename(process.argv[1] || "") === "worker.mjs" ? "worker" : "server",
});
export const MODEL = ENV.chatModel;
export const OLLAMA_URL = ENV.ollamaUrl;
export const DEMO_ENABLED = ENV.demoEnabled;
export const WORKER_ID =
  ENV.workerId || `worker-${process.pid}-${randomUUID()}`;
export const poolConfig = (name) =>
  databaseConfig(name, process.env, { config: ENV });
export const pools = Object.fromEntries(
  Object.keys(DATABASE_DEFAULTS).map((name) => [
    name,
    new Pool(poolConfig(name)),
  ]),
);
for (const [name, pool] of Object.entries(pools))
  pool.on("error", (error) =>
    console.error(
      JSON.stringify({
        level: "error",
        component: name,
        message: redactError(error),
      }),
    ),
  );
export async function closePools() {
  await Promise.allSettled(Object.values(pools).map((pool) => pool.end()));
}
export const asNumber = (value) => (value == null ? null : Number(value));
export const timestamp = (value) =>
  value ? new Date(value).toISOString() : null;
export const errText = redactError;
