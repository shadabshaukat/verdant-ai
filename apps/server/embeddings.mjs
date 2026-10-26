import { validateEmbedding, embeddingInput } from "./memory-vectors.mjs";
export { validateEmbedding, EMBEDDING_DIMENSIONS } from "./memory-vectors.mjs";
import { OLLAMA_URL } from "./config.mjs";
export const EMBEDDING_MODEL =
  process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text:v1.5";
export async function embedTexts(
  texts,
  { query = false, timeoutMs = 12000 } = {},
) {
  const response = await fetch(OLLAMA_URL + "/api/embed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts.map((s) => embeddingInput(s, query)),
      truncate: true,
      keep_alive: "30m",
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok)
    throw new Error("Embedding provider HTTP " + response.status);
  const data = await response.json();
  if (
    !Array.isArray(data.embeddings) ||
    data.embeddings.length !== texts.length
  )
    throw new Error("Embedding provider returned an unexpected batch size");
  return data.embeddings.map(validateEmbedding);
}
const cache = new Map();
export async function embedSearchQuery(query) {
  const key = EMBEDDING_MODEL + ":" + query;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.vector;
  const [vector] = await embedTexts([query], { query: true, timeoutMs: 5000 });
  if (cache.size >= 100) cache.delete(cache.keys().next().value);
  cache.set(key, { vector, until: Date.now() + 600000 });
  return vector;
}
