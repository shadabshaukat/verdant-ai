import test from "node:test";
import assert from "node:assert/strict";
import {
  loadEnvironment,
  databaseConfig,
  redactError,
  initialPolicySettings,
} from "../apps/server/environment.mjs";

test("central defaults preserve Docker service names and distinguish service role from publication host", () => {
  const c = loadEnvironment(
    { APP_HOST: "127.0.0.1", APP_PORT: "9999" },
    { defaultRole: "worker" },
  );
  assert.equal(c.serverHost, "0.0.0.0");
  assert.equal(c.port, 8090);
  assert.equal(c.chatModel, "qwen3:4b-instruct-2507-q4_K_M");
  assert.equal(c.embeddingModel, "nomic-embed-text:v1.5");
  const db = databaseConfig("PRIMARY_ACTION", {}, { config: c });
  assert.equal(db.host, "primary");
  assert.equal(db.user, "verdant_executor");
  assert.equal(db.application_name, "verdant-worker-primary_action");
});
test("explicit Ollama provider URLs/models override shared defaults without URL concatenation bugs", () => {
  const c = loadEnvironment({
    OLLAMA_URL: "http://ollama:11434/",
    OLLAMA_CHAT_URL: "https://chat.example/prefix/",
    OLLAMA_EMBED_URL: "http://localhost:1234",
    OLLAMA_CHAT_MODEL: "custom:chat",
    OLLAMA_MODEL: "ignored model",
    DEMO_ENABLED: "FALSE",
  });
  assert.equal(c.chatUrl, "https://chat.example/prefix");
  assert.equal(c.embeddingUrl, "http://localhost:1234");
  assert.equal(c.chatModel, "custom:chat");
  assert.equal(c.demoEnabled, false);
});
test("invalid numeric, boolean, URL and timeout combinations fail clearly instead of clamping", () => {
  for (const env of [
    { PORT: "8090oops" },
    { PORT: "0" },
    { MEMORY_EMBED_BATCH_SIZE: "65" },
    { MEMORY_INDEX_BATCH_SIZE: "1.5" },
    { MEMORY_INDEX_INTERVAL_MS: "0" },
    { DEMO_ENABLED: "yes" },
    { OLLAMA_URL: "file:///private" },
    { OLLAMA_URL: "http://user:secret@host" },
    { DB_QUERY_TIMEOUT_MS: "8000" },
    { SEMANTIC_RECALL_TIMEOUT_MS: "5000", EMBEDDING_QUERY_TIMEOUT_MS: "1000" },
    { OLLAMA_KEEP_ALIVE: "999h" },
  ])
    assert.throws(() => loadEnvironment(env));
});
test("secret-file credentials preserve punctuation and platform paths without shell expansion", () => {
  const file = "C:\\Verdant Files\\executor password.txt",
    password = "p@ss:/?#% $`quotes\"'";
  const c = databaseConfig(
    "PRIMARY_ACTION",
    {
      PRIMARY_ACTION_URL:
        "postgresql://worker@db.example/workload?sslmode=require",
      PRIMARY_ACTION_PASSWORD_FILE: file,
    },
    {
      readFile: (seen) => {
        assert.equal(seen, file);
        return password + "\n";
      },
    },
  );
  const url = new URL(c.connectionString);
  assert.equal(decodeURIComponent(url.password), password);
  assert.equal(url.searchParams.get("sslmode"), "require");
});
test("explicit URL credentials win over default files and individual host fields", () => {
  const env = {
    CONTROL_DATABASE_URL:
      "postgresql://user:literal%40password@external:5433/custom",
    CONTROL_HOST: "ignored",
    CONTROL_PASSWORD_FILE: "missing-file",
  };
  const c = databaseConfig("CONTROL", env, {
    readFile: () => {
      throw new Error("must not read an overridden file");
    },
  });
  const u = new URL(c.connectionString);
  assert.equal(u.hostname, "external");
  assert.equal(u.port, "5433");
  assert.equal(u.pathname, "/custom");
  assert.equal(decodeURIComponent(u.password), "literal@password");
});
test("complete URL files and the legacy password alias remain supported", () => {
  const c = databaseConfig(
    "STANDBY",
    {
      STANDBY_DATABASE_URL_FILE: "connection.txt",
      STANDBY_DB_PASSWORD_FILE: "password.txt",
    },
    {
      readFile: (file) =>
        file === "connection.txt"
          ? "postgresql://monitor@standby.example/workload\n"
          : "secret\n",
    },
  );
  assert.equal(new URL(c.connectionString).hostname, "standby.example");
  assert.equal(new URL(c.connectionString).password, "secret");
});
test("secret read and configuration errors never repeat credential material", () => {
  assert.throws(
    () =>
      databaseConfig(
        "CONTROL",
        { CONTROL_PASSWORD_FILE: "private" },
        {
          readFile: () => {
            throw new Error("password=hiddenvalue");
          },
        },
      ),
    (e) => e.message === "CONTROL_PASSWORD_FILE could not be read",
  );
  const message = redactError(
    new Error(
      "connect postgresql://admin:leaked@db/test password='secret with spaces'",
    ),
  );
  for (const word of ["leaked", "admin", "secret with spaces"])
    assert.equal(message.includes(word), false);
});
test("monitor environment seeds only a fresh policy and never replaces operator history", () => {
  const current = {
      monitorIntervalSeconds: 45,
      paused: true,
      maxActionsPerHour: 3,
    },
    config = loadEnvironment({ MONITOR_INTERVAL_SECONDS: "17" });
  assert.equal(
    initialPolicySettings(current, { hasHistory: false }, config)
      .monitorIntervalSeconds,
    17,
  );
  assert.deepEqual(
    initialPolicySettings(current, { hasHistory: true }, config),
    current,
  );
  assert.equal(current.monitorIntervalSeconds, 45);
});
