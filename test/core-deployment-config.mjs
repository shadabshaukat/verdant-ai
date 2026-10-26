import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SECRET_NAMES,
  loadDeploymentConfig,
  composeArguments,
} from "../scripts/deployment-config.mjs";
import {
  main,
  prepareEnvironment,
  prepareSecrets,
} from "../scripts/verdant.mjs";

const example = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.env.example",
);
function workspace(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "verdant setup with spaces "),
  );
  fs.copyFileSync(example, path.join(root, ".env.example"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const missingDocker = async () => {
  throw new Error("Docker unavailable");
};
const freshDocker = async (_command, args) =>
  args[0] === "volume"
    ? { code: 1, output: "Error: no such volume" }
    : { code: 0, output: "" };

test("setup is portable offline, creates config, and defers private credentials", async (t) => {
  const root = workspace(t);
  await main(["setup", "--ollama=bundled"], root, { run: missingDocker });
  assert.ok(fs.existsSync(path.join(root, ".env")));
  assert.equal(fs.existsSync(path.join(root, ".secrets")), false);
});

test("setup refuses fresh credentials when any retained project volume exists", async (t) => {
  const root = workspace(t);
  const run = async (_command, args) =>
    args[0] === "volume" && args[2].endsWith("primary_data")
      ? { code: 0, output: "retained" }
      : freshDocker(_command, args);
  await assert.rejects(
    main(["setup"], root, { run }),
    /matching .secrets files are missing/,
  );
  assert.equal(fs.existsSync(path.join(root, ".secrets")), false);
});

test("setup fails closed if Docker cannot verify volume access", async (t) => {
  const root = workspace(t);
  const run = async (_command, args) =>
    args[0] === "volume"
      ? { code: 1, output: "Access denied" }
      : { code: 0, output: "" };
  await assert.rejects(
    main(["setup"], root, { run }),
    /Credential generation was refused/,
  );
  assert.equal(fs.existsSync(path.join(root, ".secrets")), false);
});

test("fresh setup creates private cryptographic secrets and preserves them on repeat", async (t) => {
  const root = workspace(t);
  await main(["setup"], root, { run: freshDocker });
  const before = SECRET_NAMES.map((name) =>
    fs.readFileSync(path.join(root, ".secrets", name), "utf8"),
  );
  assert.ok(before.every((value) => /^[a-f0-9]{48}\n$/.test(value)));
  assert.equal(new Set(before).size, SECRET_NAMES.length);
  await main(["setup"], root, { run: freshDocker });
  assert.deepEqual(
    SECRET_NAMES.map((name) =>
      fs.readFileSync(path.join(root, ".secrets", name), "utf8"),
    ),
    before,
  );
  if (process.platform !== "win32")
    assert.equal(
      fs.statSync(path.join(root, ".secrets", SECRET_NAMES[0])).mode & 0o777,
      0o600,
    );
});

test("partial secret sets are not silently repaired or overwritten", (t) => {
  const root = workspace(t);
  fs.mkdirSync(path.join(root, ".secrets"));
  fs.writeFileSync(path.join(root, ".secrets", SECRET_NAMES[0]), "preserve-me");
  assert.throws(() => prepareSecrets(root), /incomplete/);
  assert.equal(
    fs.readFileSync(path.join(root, ".secrets", SECRET_NAMES[0]), "utf8"),
    "preserve-me",
  );
});

test("mode selects Compose profile and endpoints without rewriting remote URLs", (t) => {
  const root = workspace(t);
  prepareEnvironment(root);
  const bundled = loadDeploymentConfig(root, {}, "win32");
  assert.equal(bundled.OLLAMA_URL, "http://ollama:11434");
  assert.ok(composeArguments(bundled).includes("compose.ollama.yaml"));
  const external = loadDeploymentConfig(
    root,
    { OLLAMA_MODE: "external", OLLAMA_URL: "https://models.example.test/api/" },
    "darwin",
  );
  assert.equal(external.OLLAMA_URL, "https://models.example.test/api");
  assert.ok(!composeArguments(external).includes("--profile"));
});

test("deployment validation reuses runtime ranges and preserves shell precedence", (t) => {
  const root = workspace(t);
  prepareEnvironment(root);
  for (const invalid of [
    { OLLAMA_MODE: "automatic" },
    { APP_PORT: "0" },
    { APP_HOST: "localhost" },
    { MEMORY_EMBED_BATCH_SIZE: "65" },
    { OLLAMA_KEEP_ALIVE: "25h" },
    { DB_QUERY_TIMEOUT_MS: "8000" },
  ])
    assert.throws(() => loadDeploymentConfig(root, invalid), /must/);
  const config = loadDeploymentConfig(root, {
    APP_HOST: "::1",
    APP_PORT: "8091",
    OLLAMA_MODE: "external",
    OLLAMA_CHAT_MODEL: "custom:tag",
  });
  assert.equal(config.APP_PORT, "8091");
  assert.equal(config.APP_HOST, "::1");
  assert.equal(config.OLLAMA_MODEL, "custom:tag");
});

test("production mode excludes scenario dependencies and supports remote-first bootstrap", t => {
  const root = workspace(t); prepareEnvironment(root);
  const config = loadDeploymentConfig(root, { DEPLOYMENT_MODE: "production", MODEL_SETUP: "skip", DEMO_ENABLED: "true" });
  assert.equal(config.DEMO_ENABLED, "false");
  assert.equal(config.MODEL_SETUP, "skip");
  assert.ok(composeArguments(config).includes("compose.production.yaml"));
  assert.throws(() => loadDeploymentConfig(root, { DEPLOYMENT_MODE: "all" }), /DEPLOYMENT_MODE/);
});

test("vault secret upgrade preserves existing database credentials and refuses a lost initialized key", t => {
  const root = workspace(t); prepareSecrets(root);
  const dir = path.join(root, ".secrets"), key = path.join(dir, "credential_key");
  const original = fs.readFileSync(key, "utf8");
  assert.equal(Buffer.from(original.trim(), "base64").length, 32);
  const password = fs.readFileSync(path.join(dir, SECRET_NAMES[0]), "utf8");
  prepareSecrets(root);
  assert.equal(fs.readFileSync(key, "utf8"), original);
  fs.unlinkSync(key);
  assert.throws(() => prepareSecrets(root), /vault key is missing/);
  assert.equal(fs.readFileSync(path.join(dir, SECRET_NAMES[0]), "utf8"), password);
});
