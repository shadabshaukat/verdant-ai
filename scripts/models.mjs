import { pathToFileURL } from "node:url";
import path from "node:path";

async function request(base, route, options = {}) {
  const response = await fetch(base.replace(/\/+$/, "") + route, {
    ...options,
    signal: AbortSignal.timeout(options.method ? 3600000 : 15000),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
  return await response.json();
}

export async function ensureModels(action = "check", env = process.env) {
  const shared = env.OLLAMA_URL || "http://host.docker.internal:11434";
  const requested = [
    [
      env.OLLAMA_CHAT_URL || shared,
      env.OLLAMA_CHAT_MODEL ||
        env.OLLAMA_MODEL ||
        "qwen3:4b-instruct-2507-q4_K_M",
    ],
    [
      env.OLLAMA_EMBED_URL || shared,
      env.OLLAMA_EMBED_MODEL || "nomic-embed-text:v1.5",
    ],
  ];
  for (const [endpoint, model] of requested) {
    let data;
    try {
      data = await request(endpoint, "/api/tags");
    } catch {
      throw new Error(
        "The configured Ollama endpoint is unreachable from the app container. For Linux host Ollama, configure a container-reachable bind address, or use bundled mode.",
      );
    }
    const names = (data.models || []).map((entry) => entry.name || entry.model);
    if (
      names.includes(model) ||
      (!model.includes(":") && names.includes(model + ":latest"))
    ) {
      console.log(`Available: ${model}`);
      continue;
    }
    if (action !== "ensure")
      throw new Error(
        `Configured Ollama model is missing: ${model}. Run node scripts/verdant.mjs models.`,
      );
    console.log(`Downloading configured model: ${model}`);
    const result = await request(endpoint, "/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: false }),
    });
    if (result.error || result.status !== "success")
      throw new Error(`Ollama could not download configured model ${model}`);
    console.log(`Ready: ${model}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  ensureModels(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
