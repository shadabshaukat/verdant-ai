import { isIP } from "node:net";
import { randomUUID, createPrivateKey } from "node:crypto";

export const MODEL_PROVIDERS = Object.freeze([
  {
    id: "ollama",
    name: "Ollama",
    authTypes: ["none", "apiKey"],
    api: "Native /api/chat with function tools",
  },
  {
    id: "openai",
    name: "OpenAI-compatible",
    authTypes: ["apiKey", "none"],
    api: "Chat Completions with native function tools",
  },
  {
    id: "bedrock",
    name: "Amazon Bedrock",
    authTypes: ["awsDefault", "awsKeys"],
    api: "Official AWS SDK Converse; tool-capable models only",
  },
  {
    id: "oci",
    name: "OCI Generative AI",
    authTypes: ["ociApiKey"],
    api: "Official OCI SDK signed GENERIC chat API; tool-capable models only",
  },
]);
const fail = (message) => {
  throw Object.assign(new Error(message), { statusCode: 400 });
};
const text = (value, name, max = 512, required = false) => {
  if (value == null || value === "") {
    if (required) fail(`${name} is required`);
    return "";
  }
  if (typeof value !== "string" || value.length > max || /[\r\n\0]/.test(value))
    fail(`${name} must be bounded single-line text`);
  return value.trim();
};
function localOllamaEndpoint(value, provider) {
  if (provider !== "ollama") return false;
  try {
    const host = new URL(value).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (
      ["localhost", "host.docker.internal", "ollama", "::1"].includes(host) ||
      (isIP(host) === 4 && host.split(".")[0] === "127")
    );
  } catch {
    return false;
  }
}
function privateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (["localhost", "host.docker.internal", "ollama", "::1"].includes(host))
    return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return (
      a === 127 ||
      a === 10 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31)
    );
  }
  return isIP(host) === 6 && /^(fc|fd)/.test(host);
}
export function validateModelEndpoint(
  value,
  {
    allowInsecure = process.env.VERDANT_ALLOW_INSECURE_ENDPOINTS === "true",
  } = {},
) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Model endpoint must be a valid HTTP(S) base URL");
  }
  if (url.username || url.password || url.search || url.hash)
    fail("Model endpoint cannot contain credentials, query or fragment");
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && allowInsecure && privateHost(url.hostname))
  )
    fail(
      "Remote model endpoints require HTTPS; explicitly enabled HTTP is limited to local/private endpoints",
    );
  if (
    /^(169\.254\.|0\.0\.0\.0$)/.test(url.hostname) ||
    url.hostname === "metadata.google.internal"
  )
    fail("Metadata and unspecified addresses cannot be model endpoints");
  return url.toString().replace(/\/+$/, "");
}

export function normalizeProfileInput(
  body,
  { existing = null, allowInsecure } = {},
) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail("Model profile must be an object");
  const allowed = new Set([
    "id",
    "name",
    "provider",
    "purpose",
    "baseURL",
    "model",
    "region",
    "compartmentId",
    "authType",
    "credentials",
    "clearCredentials",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key)))
    fail("Unsupported model profile field");
  const input = { ...existing, ...body };
  const provider = MODEL_PROVIDERS.find((entry) => entry.id === input.provider);
  if (!provider) fail("Unknown model provider");
  if (input.purpose && input.purpose !== "chat")
    fail(
      "GUI model profiles currently support chat only; the 768-dimensional embedding pipeline is configured separately",
    );
  const authType = input.authType || provider.authTypes[0];
  if (!provider.authTypes.includes(authType))
    fail("Authentication type does not match the provider");
  const region = text(input.region, "region", 64);
  if (
    ["bedrock", "oci"].includes(provider.id) &&
    !/^[a-z][a-z0-9-]{2,63}$/.test(region)
  )
    fail("A valid provider region is required");
  let baseURL = text(input.baseURL, "baseURL", 2048);
  if (!baseURL && provider.id === "openai")
    baseURL = "https://api.openai.com/v1";
  if (!baseURL && provider.id === "ollama")
    baseURL =
      process.env.OLLAMA_CHAT_URL ||
      process.env.OLLAMA_URL ||
      "http://host.docker.internal:11434";
  if (baseURL)
    baseURL = validateModelEndpoint(baseURL, {
      allowInsecure: localOllamaEndpoint(baseURL, provider.id) || allowInsecure,
    });
  if (baseURL && provider.id === "oci" && new URL(baseURL).pathname !== "/")
    fail(
      "OCI baseURL must be an endpoint origin without an API path; the SDK adds its versioned path",
    );
  if (
    body.clearCredentials != null &&
    typeof body.clearCredentials !== "boolean"
  )
    fail("clearCredentials must be boolean");
  const changedIdentity =
    existing &&
    (existing.provider !== provider.id ||
      existing.authType !== authType ||
      existing.baseURL !== baseURL);
  let credentials =
    body.clearCredentials || changedIdentity ? {} : existing?.credentials || {};
  if (body.credentials != null) {
    if (typeof body.credentials !== "object" || Array.isArray(body.credentials))
      fail("credentials must be an object");
    const keys = {
      none: [],
      apiKey: ["apiKey"],
      awsDefault: [],
      awsKeys: ["accessKeyId", "secretAccessKey", "sessionToken"],
      ociApiKey: [
        "tenancyId",
        "userId",
        "fingerprint",
        "privateKey",
        "passphrase",
      ],
    }[authType];
    if (Object.keys(body.credentials).some((key) => !keys.includes(key)))
      fail("Unsupported credential field");
    credentials = {};
    for (const [key, value] of Object.entries(body.credentials)) {
      if (
        typeof value !== "string" ||
        value.length > (key === "privateKey" ? 32768 : 8192) ||
        value.includes("\0") ||
        (key !== "privateKey" && /[\r\n]/.test(value))
      )
        fail("Invalid credential value");
      if (value) credentials[key] = key === "privateKey" ? value.trim() : value;
    }
  }
  if (authType === "none" || authType === "awsDefault") credentials = {};
  if (authType === "apiKey" && !credentials.apiKey)
    fail("API key is required for the selected authentication type");
  if (
    authType === "awsKeys" &&
    (!credentials.accessKeyId || !credentials.secretAccessKey)
  )
    fail("AWS access key ID and secret access key are required");
  if (authType === "ociApiKey") {
    if (
      !["tenancyId", "userId", "fingerprint", "privateKey"].every(
        (key) => credentials[key],
      )
    )
      fail("OCI tenancy, user, fingerprint and PEM private key are required");
    try {
      const key = createPrivateKey({
        key: credentials.privateKey,
        passphrase: credentials.passphrase || undefined,
      });
      if (key.asymmetricKeyType !== "rsa")
        fail("OCI request signing requires an RSA PEM private key");
    } catch (error) {
      if (error.statusCode === 400) throw error;
      fail(
        "OCI private key must be a valid RSA PEM key with the matching passphrase",
      );
    }
  }
  return {
    name: text(input.name, "name", 120, true),
    provider: provider.id,
    purpose: "chat",
    baseURL,
    model: text(input.model, "model", 512, true),
    region,
    compartmentId: text(
      input.compartmentId,
      "compartmentId",
      512,
      provider.id === "oci",
    ),
    authType,
    credentials,
  };
}

export function normalizeToolMessage(message) {
  const calls = message?.tool_calls || [];
  if (!Array.isArray(calls) || calls.length > 8)
    throw new Error("Model returned an invalid tool-call envelope");
  return {
    role: "assistant",
    content:
      typeof message?.content === "string"
        ? message.content.slice(0, 8000)
        : "",
    tool_calls: calls.map((call) => {
      const name = call.function?.name;
      if (typeof name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(name))
        throw new Error("Model returned an invalid tool name");
      let args = call.function.arguments ?? {};
      if (typeof args === "string") {
        if (args.length > 16000)
          throw new Error("Model tool arguments are too large");
        args = JSON.parse(args);
      }
      if (
        !args ||
        typeof args !== "object" ||
        Array.isArray(args) ||
        JSON.stringify(args).length > 16000
      )
        throw new Error("Model returned invalid tool arguments");
      return {
        id:
          typeof call.id === "string" && /^[\w-]{1,128}$/.test(call.id)
            ? call.id
            : "call_" + randomUUID().replaceAll("-", ""),
        type: "function",
        function: { name, arguments: args },
      };
    }),
  };
}
export function openAIHistory(messages) {
  return messages.map((message) =>
    message.role === "tool"
      ? {
          role: "tool",
          tool_call_id: message.tool_call_id,
          content: message.content,
        }
      : {
          role: message.role,
          content: message.content || (message.tool_calls?.length ? null : ""),
          ...(message.tool_calls?.length
            ? {
                tool_calls: message.tool_calls.map((call) => ({
                  ...call,
                  function: {
                    ...call.function,
                    arguments: JSON.stringify(call.function.arguments),
                  },
                })),
              }
            : {}),
        },
  );
}
export function bedrockHistory(messages) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (message.role === "tool")
        return {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: message.tool_call_id,
                content: [{ text: message.content }],
                status: "success",
              },
            },
          ],
        };
      return {
        role: message.role,
        content: [
          ...(message.content ? [{ text: message.content }] : []),
          ...(message.tool_calls || []).map((call) => ({
            toolUse: {
              toolUseId: call.id,
              name: call.function.name,
              input: call.function.arguments,
            },
          })),
        ],
      };
    });
}
export function ociHistory(messages) {
  return messages.map((message) => ({
    role: message.role.toUpperCase(),
    content:
      message.role === "assistant" && message.tool_calls?.length
        ? null
        : [{ type: "TEXT", text: message.content || "" }],
    ...(message.role === "tool" ? { toolCallId: message.tool_call_id } : {}),
    ...(message.tool_calls?.length
      ? {
          toolCalls: message.tool_calls.map((call) => ({
            id: call.id,
            type: "FUNCTION",
            name: call.function.name,
            arguments: JSON.stringify(call.function.arguments),
          })),
        }
      : {}),
  }));
}

async function responseJSON(response) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw Object.assign(new Error("Provider HTTP failure"), {
      status: response.status,
    });
  }
  let total = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > 2097152)
      throw new Error("Provider response exceeded its limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function safeFailure(error, provider) {
  if (error?.providerDiagnostic === true) return error;
  const status = Number(
    error?.$metadata?.httpStatusCode || error?.statusCode || error?.status || 0,
  );
  const message =
    error?.name === "AbortError" || error?.name === "TimeoutError"
      ? `${provider} request timed out or was cancelled`
      : `${provider} inference failed${status ? ` (HTTP ${status})` : ""}; check endpoint, model access, native-tool support and credentials`;
  return Object.assign(new Error(message), { providerDiagnostic: true });
}
async function withAbort(work, signal) {
  signal.throwIfAborted();
  let interrupted;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        interrupted = () =>
          reject(signal.reason || new DOMException("Cancelled", "AbortError"));
        signal.addEventListener("abort", interrupted, { once: true });
      }),
    ]);
  } finally {
    if (interrupted) signal.removeEventListener("abort", interrupted);
  }
}

export async function chatCompletion(
  profile,
  {
    messages,
    tools,
    signal,
    timeoutMs = 45000,
    maxTokens = 300,
    contextTokens = 12288,
    keepAlive = "30m",
    fetchImpl = fetch,
    bedrockFactory,
    ociFactory,
  } = {},
) {
  const timeout = Math.min(180000, Math.max(1000, timeoutMs));
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
    : AbortSignal.timeout(timeout);
  const allowInsecure =
    localOllamaEndpoint(profile.baseURL, profile.provider) ||
    process.env.VERDANT_ALLOW_INSECURE_ENDPOINTS === "true";
  const baseURL = profile.baseURL
    ? validateModelEndpoint(profile.baseURL, { allowInsecure })
    : "";
  const credentials = profile.credentials || {};
  try {
    if (profile.provider === "ollama" || profile.provider === "openai") {
      const isOllama = profile.provider === "ollama";
      const payload = isOllama
        ? {
            model: profile.model,
            stream: false,
            messages,
            tools,
            options: {
              temperature: 0,
              num_ctx: contextTokens,
              num_predict: maxTokens,
            },
            keep_alive: keepAlive,
          }
        : {
            model: profile.model,
            stream: false,
            messages: openAIHistory(messages),
            tools,
            tool_choice: "required",
            parallel_tool_calls: false,
            max_completion_tokens: maxTokens,
          };
      const response = await withAbort(
        () =>
          fetchImpl(baseURL + (isOllama ? "/api/chat" : "/chat/completions"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(credentials.apiKey
                ? { Authorization: "Bearer " + credentials.apiKey }
                : {}),
            },
            body: JSON.stringify(payload),
            redirect: "error",
            signal: requestSignal,
          }),
        requestSignal,
      );
      const data = await withAbort(() => responseJSON(response), requestSignal);
      return normalizeToolMessage(
        isOllama ? data.message : data.choices?.[0]?.message,
      );
    }
    if (profile.provider === "bedrock") {
      const { BedrockRuntimeClient, ConverseCommand } = await import(
        "@aws-sdk/client-bedrock-runtime"
      );
      const client = bedrockFactory
        ? bedrockFactory(profile)
        : new BedrockRuntimeClient({
            region: profile.region,
            maxAttempts: 1,
            ...(baseURL ? { endpoint: baseURL } : {}),
            ...(profile.authType === "awsKeys"
              ? {
                  credentials: {
                    accessKeyId: credentials.accessKeyId,
                    secretAccessKey: credentials.secretAccessKey,
                    ...(credentials.sessionToken
                      ? { sessionToken: credentials.sessionToken }
                      : {}),
                  },
                }
              : {}),
          });
      try {
        const result = await withAbort(
          () =>
            client.send(
              new ConverseCommand({
                modelId: profile.model,
                system: messages
                  .filter((m) => m.role === "system")
                  .map((m) => ({ text: m.content })),
                messages: bedrockHistory(messages),
                inferenceConfig: { maxTokens, temperature: 0 },
                toolConfig: {
                  tools: tools.map((t) => ({
                    toolSpec: {
                      name: t.function.name,
                      description: t.function.description,
                      inputSchema: { json: t.function.parameters },
                    },
                  })),
                  toolChoice: { auto: {} },
                },
              }),
              { abortSignal: requestSignal },
            ),
          requestSignal,
        );
        return normalizeToolMessage({
          content:
            result.output?.message?.content
              ?.filter((x) => x.text)
              .map((x) => x.text)
              .join("") || "",
          tool_calls:
            result.output?.message?.content
              ?.filter((x) => x.toolUse)
              .map((x) => ({
                id: x.toolUse.toolUseId,
                function: { name: x.toolUse.name, arguments: x.toolUse.input },
              })) || [],
        });
      } finally {
        client.destroy?.();
      }
    }
    if (profile.provider === "oci") {
      const [sdkModule, commonModule] = await Promise.all([
        import("oci-generativeaiinference"),
        import("oci-common"),
      ]);
      const sdk = sdkModule.default || sdkModule,
        common = commonModule.default || commonModule;
      const auth = new common.SimpleAuthenticationDetailsProvider(
        credentials.tenancyId,
        credentials.userId,
        credentials.fingerprint,
        credentials.privateKey,
        credentials.passphrase || null,
      );
      const client = ociFactory
        ? ociFactory(profile)
        : new sdk.GenerativeAiInferenceClient(
            { authenticationDetailsProvider: auth },
            {
              retryConfiguration: common.NoRetryConfigurationDetails,
              httpOptions: { redirect: "error", signal: requestSignal },
            },
          );
      client.regionId = profile.region;
      if (baseURL) client.endpoint = baseURL;
      try {
        const result = await withAbort(
          () =>
            client.chat({
              chatDetails: {
                compartmentId: profile.compartmentId,
                servingMode: {
                  servingType: "ON_DEMAND",
                  modelId: profile.model,
                },
                chatRequest: {
                  apiFormat: "GENERIC",
                  messages: ociHistory(messages),
                  isStream: false,
                  maxTokens,
                  temperature: 0,
                  isParallelToolCalls: false,
                  tools: tools.map((t) => ({
                    type: "FUNCTION",
                    name: t.function.name,
                    description: t.function.description,
                    parameters: t.function.parameters,
                  })),
                  toolChoice: { type: "AUTO" },
                },
              },
            }),
          requestSignal,
        );
        const message = result?.chatResult?.chatResponse?.choices?.[0]?.message;
        return normalizeToolMessage({
          content:
            message?.content
              ?.filter((x) => x.type === "TEXT")
              .map((x) => x.text)
              .join("") || "",
          tool_calls:
            message?.toolCalls?.map((call) => ({
              id: call.id,
              function: { name: call.name, arguments: call.arguments },
            })) || [],
        });
      } finally {
        client.close?.();
      }
    }
    throw new Error("Unknown model provider");
  } catch (error) {
    throw safeFailure(error, profile.provider);
  }
}

export async function probeModel(profile, options = {}) {
  const started = Date.now();
  const tools = [
    {
      type: "function",
      function: {
        name: "verdant_probe",
        description:
          "Harmless connection and native-tool capability probe. No database operation occurs.",
        parameters: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
      },
    },
  ];
  try {
    const message = await chatCompletion(profile, {
      messages: [
        {
          role: "system",
          content:
            "Call verdant_probe exactly once with ok=true. This is a harmless capability test. Do not write prose.",
        },
        { role: "user", content: "Call the probe now." },
      ],
      tools,
      maxTokens: 96,
      timeoutMs: 30000,
      ...options,
    });
    if (
      message.tool_calls.length !== 1 ||
      message.tool_calls[0].function.name !== "verdant_probe" ||
      message.tool_calls[0].function.arguments.ok !== true ||
      Object.keys(message.tool_calls[0].function.arguments).length !== 1
    )
      throw new Error("Model did not return the expected native tool call");
    return {
      ok: true,
      nativeTools: true,
      latencyMs: Date.now() - started,
      message:
        "Model returned a valid native tool call. No database action was executed.",
    };
  } catch (error) {
    return {
      ok: false,
      nativeTools: false,
      latencyMs: Date.now() - started,
      message: error.message.startsWith("Model did not")
        ? error.message
        : safeFailure(error, profile.provider).message,
    };
  }
}
