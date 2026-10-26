import { db, transaction, event } from "./store.mjs";
import { ENV, MODEL } from "./config.mjs";
import { sealSecret, openSecret } from "./credential-vault.mjs";
import {
  MODEL_PROVIDERS,
  normalizeProfileInput,
  probeModel,
} from "./model-providers.mjs";

const bad = (message, statusCode = 400) => {
  throw Object.assign(new Error(message), { statusCode });
};
const validId = (id) => {
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    bad("Invalid model profile ID");
  return id;
};
export function publicModelProfile(row) {
  return {
    id: row.profile_id,
    name: row.name,
    provider: row.provider,
    purpose: row.purpose,
    baseURL: row.base_url,
    model: row.model,
    region: row.region,
    compartmentId: row.compartment_id,
    authType: row.auth_type,
    authConfigured:
      ["none", "awsDefault"].includes(row.auth_type) ||
      !!row.credentials_sealed,
    active: row.active,
    revision: row.revision,
    lastTestAt: row.last_test_at,
    lastTestStatus: row.last_test_status,
    lastTestMessage: row.last_test_message,
    capabilities: row.capabilities,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function privateProfile(row) {
  return {
    ...publicModelProfile(row),
    credentials: row.credentials_sealed
      ? openSecret(row.credentials_sealed)
      : {},
    source: "profile",
  };
}
async function getRow(id, client = db, lock = false) {
  const row = (
    await client.query(
      "SELECT * FROM agent.model_profile WHERE profile_id=$1" +
        (lock ? " FOR UPDATE" : ""),
      [validId(id)],
    )
  ).rows[0];
  if (!row) bad("Model profile was not found", 404);
  return row;
}
export async function listModelProfiles() {
  const profiles = (
    await db.query(
      "SELECT * FROM agent.model_profile ORDER BY lower(name),created_at",
    )
  ).rows.map(publicModelProfile);
  return {
    profiles,
    providers: MODEL_PROVIDERS,
    activeProfileId: profiles.find((p) => p.active)?.id || null,
    embedding: {
      configuredSeparately: true,
      model: ENV.embeddingModel,
      dimensions: 768,
      scope: "Chat profiles do not change the stored embedding space.",
    },
  };
}
export async function saveModelProfile(body, id = null) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    bad("Model profile must be an object");
  try {
    const profile = await transaction(async (client) => {
      const existing = id
        ? privateProfile(await getRow(id, client, true))
        : null;
      // Clearing a previously stored credential is permitted, but invalidates activation until retested.
      const input = normalizeProfileInput(
        body.clearCredentials && existing
          ? { ...body, clearCredentials: false }
          : body,
        { existing },
      );
      if (body.clearCredentials) input.credentials = {};
      const sealed = Object.keys(input.credentials).length
        ? sealSecret(input.credentials)
        : null;
      const values = [
        input.name,
        input.provider,
        input.purpose,
        input.baseURL,
        input.model,
        input.region,
        input.compartmentId,
        input.authType,
        sealed,
      ];
      const row = id
        ? (
            await client.query(
              `UPDATE agent.model_profile SET name=$1,provider=$2,purpose=$3,base_url=$4,model=$5,region=$6,compartment_id=$7,auth_type=$8,credentials_sealed=$9,active=false,revision=revision+1,last_test_revision=NULL,last_test_at=NULL,last_test_status='untested',last_test_message=NULL,capabilities='{}'::jsonb,updated_at=now() WHERE profile_id=$10 RETURNING *`,
              [...values, id],
            )
          ).rows[0]
        : (
            await client.query(
              `INSERT INTO agent.model_profile(name,provider,purpose,base_url,model,region,compartment_id,auth_type,credentials_sealed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
              values,
            )
          ).rows[0];
      await event(
        "model.profile.saved",
        "Saved model connection profile",
        {
          profileId: row.profile_id,
          provider: row.provider,
          model: row.model,
          active: false,
        },
        {},
        client,
      );
      return publicModelProfile(row);
    });
    return { profile };
  } catch (error) {
    if (error.code === "23505")
      bad("A model profile with this name already exists");
    throw error;
  }
}
export async function deleteModelProfile(id) {
  return transaction(async (client) => {
    const row = await getRow(id, client, true);
    await client.query("DELETE FROM agent.model_profile WHERE profile_id=$1", [
      id,
    ]);
    await event(
      "model.profile.deleted",
      "Deleted model connection profile",
      {
        profileId: id,
        provider: row.provider,
        environmentDefaultRestored: row.active,
      },
      {},
      client,
    );
    return { ok: true };
  });
}
export async function testModelProfile(value, options = {}) {
  const saved = typeof value === "string";
  const row = saved
    ? await getRow(value)
    : value?.id
      ? await getRow(value.id)
      : null;
  const existing = row ? privateProfile(row) : null;
  const input = normalizeProfileInput(saved ? {} : value, { existing });
  const result = await probeModel(input, options);
  if (saved) {
    const stored = await db.query(
      `UPDATE agent.model_profile SET last_test_at=now(),last_test_status=$2,last_test_message=$3,last_test_revision=$4,capabilities=$5,active=CASE WHEN $2='passed' THEN active ELSE false END,updated_at=now() WHERE profile_id=$1 AND revision=$4`,
      [
        row.profile_id,
        result.ok ? "passed" : "failed",
        result.message,
        row.revision,
        { nativeTools: result.nativeTools, purpose: "chat", embedding: false },
      ],
    );
    if (!stored.rowCount)
      return {
        ok: false,
        nativeTools: false,
        latencyMs: result.latencyMs,
        message:
          "This profile changed or was deleted during the test. Test the current saved revision before activation.",
      };
  }
  return result;
}
export async function activateModelProfile(id) {
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('verdant-model-profile-activation'))",
    );
    const row = await getRow(id, client, true);
    if (
      row.last_test_status !== "passed" ||
      row.last_test_revision !== row.revision ||
      !row.capabilities?.nativeTools
    )
      bad("Test this saved profile revision successfully before activation");
    await client.query(
      "UPDATE agent.model_profile SET active=false WHERE purpose='chat' AND active",
    );
    const activated = (
      await client.query(
        "UPDATE agent.model_profile SET active=true,updated_at=now() WHERE profile_id=$1 RETURNING *",
        [id],
      )
    ).rows[0];
    await event(
      "model.profile.activated",
      "Changed the chat planner profile",
      {
        profileId: id,
        provider: row.provider,
        model: row.model,
        embeddingUnchanged: true,
      },
      {},
      client,
    );
    return { profile: publicModelProfile(activated) };
  });
}
export async function selectedChatProfile() {
  const row = (
    await db.query(
      "SELECT * FROM agent.model_profile WHERE purpose='chat' AND active",
    )
  ).rows[0];
  if (row) return privateProfile(row);
  return {
    id: null,
    revision: 0,
    name: "Environment default",
    provider: "ollama",
    purpose: "chat",
    baseURL: ENV.chatUrl,
    model: MODEL,
    region: "",
    compartmentId: "",
    authType: "none",
    credentials: {},
    source: "environment",
  };
}
