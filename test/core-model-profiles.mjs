import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { db } from "../apps/server/store.mjs";
import { closePools } from "../apps/server/config.mjs";
import { sealSecret, openSecret } from "../apps/server/credential-vault.mjs";
import {
  publicModelProfile,
  saveModelProfile,
  selectedChatProfile,
  testModelProfile,
  activateModelProfile,
} from "../apps/server/model-profiles.mjs";

after(closePools);
const id = "22c02b22-3c6e-4d90-af41-f29c464faec7";
const credential = "test-only-api-key-never-public";
function withKey(t) {
  const before = process.env.VERDANT_CREDENTIAL_KEY;
  process.env.VERDANT_CREDENTIAL_KEY = randomBytes(32).toString("base64");
  t.after(() => {
    if (before === undefined) delete process.env.VERDANT_CREDENTIAL_KEY;
    else process.env.VERDANT_CREDENTIAL_KEY = before;
  });
}
function row(overrides = {}) {
  return {
    profile_id: id,
    name: "Remote planner",
    provider: "openai",
    purpose: "chat",
    base_url: "https://models.example.test/v1",
    model: "tool-capable-model",
    region: "",
    compartment_id: "",
    auth_type: "apiKey",
    credentials_sealed: null,
    active: false,
    revision: 1,
    last_test_revision: null,
    last_test_status: "untested",
    last_test_at: null,
    last_test_message: null,
    capabilities: {},
    created_at: new Date(0),
    updated_at: new Date(0),
    ...overrides,
  };
}
function mockTransaction(t, query) {
  const client = {
    query: async (sql, values) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql))
        return { rows: [], rowCount: 0 };
      return query(sql, values);
    },
    release() {},
  };
  t.mock.method(db, "connect", async () => client);
}
const successfulInference = async () =>
  Response.json({
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_probe",
              type: "function",
              function: { name: "verdant_probe", arguments: '{"ok":true}' },
            },
          ],
        },
      },
    ],
  });

test("public model profiles redact credentials and encryption envelopes", (t) => {
  withKey(t);
  const sealed = sealSecret({ apiKey: credential });
  const exposed = publicModelProfile(row({ credentials_sealed: sealed }));
  assert.equal(exposed.authConfigured, true);
  assert.ok(!JSON.stringify(exposed).includes(credential));
  assert.ok(!JSON.stringify(exposed).includes(sealed));
  assert.ok(!("credentials" in exposed));
  assert.ok(!("credentials_sealed" in exposed));
});

test("saving a profile encrypts credentials, records no secret in its audit event, and returns a public projection", async (t) => {
  withKey(t);
  const calls = [];
  mockTransaction(t, async (sql, values) => {
    calls.push({ sql, values });
    if (sql.startsWith("INSERT INTO agent.model_profile"))
      return { rows: [row({ credentials_sealed: values[8] })] };
    if (sql.startsWith("INSERT INTO agent.event"))
      return { rows: [{ event_id: 1 }] };
    throw new Error("Unexpected query");
  });
  const result = await saveModelProfile({
    name: "Remote planner",
    provider: "openai",
    model: "tool-capable-model",
    credentials: { apiKey: credential },
  });
  const insert = calls.find((call) =>
    call.sql.startsWith("INSERT INTO agent.model_profile"),
  );
  assert.deepEqual(openSecret(insert.values[8]), { apiKey: credential });
  assert.ok(!insert.values[8].includes(credential));
  assert.ok(
    !JSON.stringify(
      calls.filter((call) => call.sql.startsWith("INSERT INTO agent.event")),
    ).includes(credential),
  );
  assert.ok(!JSON.stringify(result).includes(credential));
  assert.equal(result.profile.active, false);
});

test("an edit preserves an omitted credential and invalidates the tested active revision", async (t) => {
  withKey(t);
  const existing = row({
    credentials_sealed: sealSecret({ apiKey: credential }),
    active: true,
    revision: 4,
    last_test_status: "passed",
    last_test_revision: 4,
    capabilities: { nativeTools: true },
  });
  let update;
  mockTransaction(t, async (sql, values) => {
    if (sql.startsWith("SELECT * FROM agent.model_profile"))
      return { rows: [existing] };
    if (sql.startsWith("UPDATE agent.model_profile")) {
      update = { sql, values };
      return {
        rows: [
          row({ name: values[0], credentials_sealed: values[8], revision: 5 }),
        ],
      };
    }
    if (sql.startsWith("INSERT INTO agent.event"))
      return { rows: [{ event_id: 1 }] };
    throw new Error("Unexpected query");
  });
  const result = await saveModelProfile({ name: "Renamed" }, id);
  assert.deepEqual(openSecret(update.values[8]), { apiKey: credential });
  assert.match(
    update.sql,
    /active=false,revision=revision\+1,last_test_revision=NULL/,
  );
  assert.equal(result.profile.active, false);
  assert.equal(result.profile.lastTestStatus, "untested");
  assert.equal(result.profile.revision, 5);
});

test("explicit credential clearing stores no key and leaves the profile untested", async (t) => {
  withKey(t);
  const existing = row({
    credentials_sealed: sealSecret({ apiKey: credential }),
  });
  let stored;
  mockTransaction(t, async (sql, values) => {
    if (sql.startsWith("SELECT * FROM agent.model_profile"))
      return { rows: [existing] };
    if (sql.startsWith("UPDATE agent.model_profile")) {
      stored = values[8];
      return { rows: [row({ revision: 2 })] };
    }
    if (sql.startsWith("INSERT INTO agent.event"))
      return { rows: [{ event_id: 1 }] };
    throw new Error("Unexpected query");
  });
  const result = await saveModelProfile({ clearCredentials: true }, id);
  assert.equal(stored, null);
  assert.equal(result.profile.authConfigured, false);
  assert.equal(result.profile.active, false);
});

test("selected chat profile decrypts only server-side and otherwise retains the environment Ollama fallback", async (t) => {
  withKey(t);
  let current = row({
    credentials_sealed: sealSecret({ apiKey: credential }),
    active: true,
  });
  t.mock.method(db, "query", async () => ({ rows: current ? [current] : [] }));
  assert.equal((await selectedChatProfile()).credentials.apiKey, credential);
  current = null;
  const fallback = await selectedChatProfile();
  assert.equal(fallback.source, "environment");
  assert.equal(fallback.provider, "ollama");
  assert.equal(fallback.id, null);
  assert.deepEqual(fallback.credentials, {});
});

test("a successful test of a stale saved revision cannot authorize activation", async (t) => {
  withKey(t);
  const existing = row({
    credentials_sealed: sealSecret({ apiKey: credential }),
  });
  t.mock.method(db, "query", async (sql) => {
    if (sql.startsWith("SELECT")) return { rows: [existing] };
    return { rows: [], rowCount: 0 };
  });
  const outcome = await testModelProfile(id, {
    fetchImpl: successfulInference,
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /changed or was deleted/);
});

test("activation rejects untested and mismatched revisions before changing the selected profile", async (t) => {
  let current = row();
  let writes = 0;
  mockTransaction(t, async (sql) => {
    if (sql.startsWith("SELECT pg_advisory")) return { rows: [] };
    if (sql.startsWith("SELECT * FROM agent.model_profile"))
      return { rows: [current] };
    writes++;
    throw new Error("Must reject before any mutation");
  });
  await assert.rejects(
    activateModelProfile(id),
    /Test this saved profile revision/,
  );
  current = row({
    revision: 3,
    last_test_revision: 2,
    last_test_status: "passed",
    capabilities: { nativeTools: true },
  });
  await assert.rejects(
    activateModelProfile(id),
    /Test this saved profile revision/,
  );
  assert.equal(writes, 0);
});
