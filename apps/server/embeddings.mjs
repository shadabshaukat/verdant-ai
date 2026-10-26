import { validateEmbedding, embeddingInput } from "./memory-vectors.mjs";
export { validateEmbedding, EMBEDDING_DIMENSIONS } from "./memory-vectors.mjs";
import { ENV } from "./config.mjs";
import { requestSignal } from "./lifecycle.mjs";
export const EMBEDDING_MODEL = ENV.embeddingModel;
export async function embedTexts(
  texts,
  { query = false, timeoutMs = ENV.embeddingTimeoutMs } = {},
) {
  const response = await fetch(ENV.embeddingUrl + "/api/embed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts.map((s) => embeddingInput(s, query)),
      truncate: true,
      keep_alive: ENV.ollamaKeepAlive,
    }),
    signal: requestSignal(timeoutMs),
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
export async function embedSearchQuery(
  query,
  { timeoutMs = ENV.embeddingQueryTimeoutMs } = {},
) {
  const key = EMBEDDING_MODEL + ":" + query;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.vector;
  const [vector] = await embedTexts([query], { query: true, timeoutMs });
  if (cache.size >= 100) cache.delete(cache.keys().next().value);
  cache.set(key, { vector, until: Date.now() + 600000 });
  return vector;
}
