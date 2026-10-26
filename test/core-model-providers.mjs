import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { Readable } from "node:stream";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import {
  validateModelEndpoint,
  normalizeProfileInput,
  normalizeToolMessage,
  openAIHistory,
  bedrockHistory,
  ociHistory,
  chatCompletion,
  probeModel,
} from "../apps/server/model-providers.mjs";

const profile = {
  name: "Test",
  provider: "openai",
  purpose: "chat",
  baseURL: "https://models.example.test/v1",
  model: "tool-capable-model",
  region: "",
  authType: "apiKey",
  credentials: { apiKey: "test-key-not-a-real-credential" },
};
const call = {
  id: "call_probe",
  type: "function",
  function: { name: "verdant_probe", arguments: { ok: true } },
};
const result = { role: "assistant", content: "", tool_calls: [call] };
const messages = [
  { role: "system", content: "Use the declared tool" },
  { role: "user", content: "Probe" },
  result,
  {
    role: "tool",
    tool_call_id: "call_probe",
    tool_name: "verdant_probe",
    content: '{"ok":true}',
  },
];
const tools = [
  {
    type: "function",
    function: {
      name: "verdant_probe",
      description: "Probe",
      parameters: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
  },
];

test("remote model URL policy never embeds credentials or permits public cleartext", () => {
  for (const url of [
    "http://models.example.test",
    "https://user:password@example.test",
    "https://models.example.test/?key=secret",
    "http://169.254.169.254",
  ])
    assert.throws(() => validateModelEndpoint(url, { allowInsecure: true }));
  assert.throws(
    () =>
      validateModelEndpoint("http://ollama:11434", { allowInsecure: false }),
    /HTTPS/,
  );
  assert.equal(
    validateModelEndpoint("http://127.0.0.1:11434/", { allowInsecure: true }),
    "http://127.0.0.1:11434",
  );
  assert.equal(
    validateModelEndpoint("https://models.example.test/v1"),
    profile.baseURL,
  );
});

test("credential omission preserves only the same endpoint identity and embeddings cannot be repurposed", () => {
  assert.equal(
    normalizeProfileInput({ name: "Renamed" }, { existing: profile })
      .credentials.apiKey,
    profile.credentials.apiKey,
  );
  assert.throws(
    () =>
      normalizeProfileInput(
        { baseURL: "https://different.example.test/v1" },
        { existing: profile },
      ),
    /API key is required/,
  );
  assert.throws(
    () => normalizeProfileInput({ ...profile, purpose: "embedding" }),
    /chat only/,
  );
  assert.throws(
    () =>
      normalizeProfileInput({
        ...profile,
        credentials: { apiKey: "invalid\nheader" },
      }),
    /Invalid credential/,
  );
});

test("known local Ollama HTTP works without weakening generic or private LAN URL rules", () => {
  for (const host of [
    "localhost",
    "127.0.0.1",
    "127.10.20.30",
    "[::1]",
    "ollama",
    "host.docker.internal",
  ])
    assert.equal(
      normalizeProfileInput(
        {
          ...profile,
          provider: "ollama",
          baseURL: `http://${host}:11434`,
          authType: "none",
          credentials: {},
        },
        { allowInsecure: false },
      ).baseURL,
      `http://${host}:11434`,
    );
  assert.throws(
    () =>
      normalizeProfileInput(
        {
          ...profile,
          provider: "ollama",
          baseURL: "http://192.168.1.20:11434",
          authType: "none",
          credentials: {},
        },
        { allowInsecure: false },
      ),
    /HTTPS/,
  );
  assert.equal(
    normalizeProfileInput(
      {
        ...profile,
        provider: "ollama",
        baseURL: "http://192.168.1.20:11434",
        authType: "none",
        credentials: {},
      },
      { allowInsecure: true },
    ).baseURL,
    "http://192.168.1.20:11434",
  );
  assert.throws(
    () =>
      normalizeProfileInput(
        { ...profile, baseURL: "http://localhost:8000/v1" },
        { allowInsecure: false },
      ),
    /HTTPS/,
  );
});

test("native history retains tool correlation for OpenAI, AWS and OCI", () => {
  const openai = openAIHistory(messages);
  assert.equal(openai[2].tool_calls[0].function.arguments, '{"ok":true}');
  assert.equal(openai[3].tool_call_id, "call_probe");
  const bedrock = bedrockHistory(messages);
  assert.equal(bedrock[1].content[0].toolUse.toolUseId, "call_probe");
  assert.equal(bedrock[2].content[0].toolResult.toolUseId, "call_probe");
  const oci = ociHistory(messages);
  assert.equal(oci[2].content, null);
  assert.equal(oci[2].toolCalls[0].type, "FUNCTION");
  assert.equal(oci[3].toolCallId, "call_probe");
});

test("HTTP 200 prose is not a successful native-tool capability test", async () => {
  const outcome = await probeModel(profile, {
    fetchImpl: async () =>
      Response.json({
        choices: [
          { message: { role: "assistant", content: "Connection works!" } },
        ],
      }),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.nativeTools, false);
});

test("OpenAI-compatible inference uses real request shape, bounded tokens and no redirects", async () => {
  let captured;
  const outcome = await probeModel(profile, {
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return Response.json({
        choices: [
          {
            message: {
              ...result,
              tool_calls: [
                {
                  ...call,
                  function: { ...call.function, arguments: '{"ok":true}' },
                },
              ],
            },
          },
        ],
      });
    },
  });
  assert.equal(outcome.ok, true);
  assert.equal(captured.url, profile.baseURL + "/chat/completions");
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.body.max_completion_tokens, 96);
  assert.equal(captured.body.tool_choice, "required");
  assert.ok(
    !JSON.stringify(captured.body).includes(profile.credentials.apiKey),
  );
});

test("provider diagnostics never repeat upstream response bodies or API credentials", async () => {
  const outcome = await probeModel(profile, {
    fetchImpl: async () =>
      new Response("upstream says apiKey=secret-password", { status: 401 }),
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /HTTP 401/);
  assert.ok(!outcome.message.includes("secret-password"));
  assert.ok(!outcome.message.includes(profile.credentials.apiKey));
});

test("official AWS SDK signs Converse and normalizes a native tool response without network access", async () => {
  let captured;
  const aws = {
    ...profile,
    provider: "bedrock",
    baseURL: "",
    region: "us-east-1",
    authType: "awsKeys",
    credentials: {
      accessKeyId: "AKIATESTONLYNOTREAL",
      secretAccessKey: "test-secret-not-real",
    },
  };
  const responseBody = JSON.stringify({
    output: {
      message: {
        role: "assistant",
        content: [
          {
            toolUse: {
              toolUseId: "call_probe",
              name: "verdant_probe",
              input: { ok: true },
            },
          },
        ],
      },
    },
    stopReason: "tool_use",
  });
  const outcome = await probeModel(aws, {
    bedrockFactory: () =>
      new BedrockRuntimeClient({
        region: aws.region,
        credentials: aws.credentials,
        maxAttempts: 1,
        requestHandler: {
          handle: async (request) => {
            captured = request;
            return {
              response: {
                statusCode: 200,
                headers: { "content-type": "application/json" },
                body: Readable.from([responseBody]),
              },
            };
          },
        },
      }),
  });
  assert.equal(outcome.ok, true);
  assert.match(captured.headers.authorization, /AWS4-HMAC-SHA256/);
  const requestBody = new TextDecoder().decode(captured.body);
  assert.ok(
    JSON.parse(requestBody).toolConfig.tools[0].toolSpec.inputSchema.json,
  );
  assert.ok(!requestBody.includes(aws.credentials.secretAccessKey));
});

test("official OCI SDK signs GENERIC native-tool requests and never sends the PEM private key", async (t) => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const oci = {
    ...profile,
    provider: "oci",
    baseURL: "https://inference.example.test",
    region: "us-chicago-1",
    compartmentId: "ocid1.compartment.oc1..test",
    authType: "ociApiKey",
    credentials: {
      tenancyId: "ocid1.tenancy.oc1..test",
      userId: "ocid1.user.oc1..test",
      fingerprint: "00:11:22:33",
      privateKey,
    },
  };
  let captured;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    captured = { url: String(url), options, body: JSON.parse(options.body) };
    return Response.json({
      modelId: "test",
      modelVersion: "test",
      chatResponse: {
        apiFormat: "GENERIC",
        choices: [
          {
            index: 0,
            finishReason: "tool_calls",
            message: {
              role: "ASSISTANT",
              content: null,
              toolCalls: [
                {
                  id: "call_probe",
                  type: "FUNCTION",
                  name: "verdant_probe",
                  arguments: '{"ok":true}',
                },
              ],
            },
          },
        ],
      },
    });
  });
  const outcome = await probeModel(oci);
  assert.equal(outcome.ok, true, outcome.message);
  assert.equal(
    captured.url,
    "https://inference.example.test/20231130/actions/chat",
  );
  assert.match(captured.options.headers.get("authorization"), /Signature/);
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.body.chatRequest.apiFormat, "GENERIC");
  assert.ok(!JSON.stringify(captured.body).includes("PRIVATE KEY"));
});

test("aborted cloud model work is bounded even when a transport fails to settle", async () => {
  const controller = new AbortController();
  const pending = chatCompletion(
    {
      ...profile,
      provider: "bedrock",
      baseURL: "",
      region: "us-east-1",
      authType: "awsDefault",
    },
    {
      messages,
      tools,
      signal: controller.signal,
      bedrockFactory: () => ({
        send: () => new Promise(() => {}),
        destroy() {},
      }),
    },
  );
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, /cancelled/);
});

test("model-generated SQL prose and malformed tool arguments never become executable calls", () => {
  assert.equal(
    normalizeToolMessage({ content: "DROP TABLE app.orders" }).tool_calls
      .length,
    0,
  );
  assert.throws(() =>
    normalizeToolMessage({
      tool_calls: [{ function: { name: "probe", arguments: "not json" } }],
    }),
  );
  assert.throws(() =>
    normalizeToolMessage({
      tool_calls: [{ function: { name: "DROP TABLE", arguments: {} } }],
    }),
  );
});
