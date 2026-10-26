import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { parseEnv } from "node:util";
import { loadEnvironment } from "../apps/server/environment.mjs";

export const SECRET_NAMES = [
  "postgres_password",
  "control_password",
  "monitor_password",
  "executor_password",
  "demo_password",
  "replicator_password",
];

export function loadDeploymentConfig(
  root,
  environment = process.env,
  platform = process.platform,
) {
  const file = path.join(root, ".env");
  const values = {
    ...(fs.existsSync(file) ? parseEnv(fs.readFileSync(file, "utf8")) : {}),
    ...environment,
  };
  const mode = values.OLLAMA_MODE || "bundled";
  if (!["bundled", "external"].includes(mode))
    throw new Error("OLLAMA_MODE must be bundled or external");
  const deployment = values.DEPLOYMENT_MODE || "demo";
  if (!["demo", "production"].includes(deployment)) throw new Error("DEPLOYMENT_MODE must be demo or production");
  const modelSetup = values.MODEL_SETUP || "ensure";
  if (!["ensure", "skip"].includes(modelSetup)) throw new Error("MODEL_SETUP must be ensure or skip");
  const project = values.COMPOSE_PROJECT_NAME || "verdant-dba";
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project))
    throw new Error(
      "COMPOSE_PROJECT_NAME must use lowercase letters, numbers, hyphens or underscores",
    );
  const host = values.APP_HOST || "127.0.0.1";
  if (!isIP(host)) throw new Error("APP_HOST must be an IPv4 or IPv6 address");
  const result = {
    ...values,
    COMPOSE_PROJECT_NAME: project,
    OLLAMA_MODE: mode,
    APP_HOST: host,
    DEPLOYMENT_MODE: deployment,
    MODEL_SETUP: modelSetup,
  };
  const port = values.APP_PORT || "8090";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("APP_PORT must be an integer from 1 to 65535");
  result.APP_PORT = String(Number(port));
  result.OLLAMA_URL =
    values.OLLAMA_URL ||
    (mode === "bundled"
      ? "http://ollama:11434"
      : "http://host.docker.internal:11434");
  // Reuse the runtime's pure validator so CLI and container settings cannot drift.
  const runtime = loadEnvironment({
    ...result,
    PORT: "8090",
    SERVER_HOST: "0.0.0.0",
  });
  result.OLLAMA_URL = runtime.ollamaUrl;
  result.OLLAMA_CHAT_URL = values.OLLAMA_CHAT_URL || "";
  result.OLLAMA_EMBED_URL = values.OLLAMA_EMBED_URL || "";
  result.OLLAMA_MODEL = runtime.chatModel;
  result.OLLAMA_EMBED_MODEL = runtime.embeddingModel;
  result.DEMO_ENABLED = String(deployment === "production" ? false : runtime.demoEnabled);
  for (const key of ["APP_UID", "APP_GID"]) {
    const automatic =
      platform === "linux"
        ? String(
            key === "APP_UID"
              ? (process.getuid?.() ?? 1000)
              : (process.getgid?.() ?? 1000),
          )
        : "1000";
    const raw = values[key] || automatic;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      throw new Error(`${key} must be a numeric Linux user/group ID`);
    result[key] = raw;
  }
  return result;
}

export function composeArguments(config, command = []) {
  return [
    "compose",
    "--project-name",
    config.COMPOSE_PROJECT_NAME,
    "-f",
    "compose.yaml",
    ...(config.DEPLOYMENT_MODE === "production" ? ["-f", "compose.production.yaml"] : []),
    ...(config.OLLAMA_MODE === "bundled"
      ? ["-f", "compose.ollama.yaml", "--profile", "ollama"]
      : []),
    ...command,
  ];
}
