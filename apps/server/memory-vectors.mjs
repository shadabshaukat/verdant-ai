export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_INPUT_BYTES = 1800;
export function validateEmbedding(vector) {
  if (
    !Array.isArray(vector) ||
    vector.length !== EMBEDDING_DIMENSIONS ||
    vector.some((n) => typeof n !== "number" || !Number.isFinite(n)) ||
    vector.reduce((sum, n) => sum + n * n, 0) < 1e-12
  )
    throw new Error("Embedding must contain 768 finite, nonzero coordinates");
  return vector;
}
export function embeddingInput(text, query = false) {
  const bytes = new TextEncoder().encode(
    (query ? "search_query: " : "search_document: ") + String(text),
  );
  // Streaming decode omits an incomplete final UTF-8 sequence rather than inventing a replacement character.
  return new TextDecoder().decode(bytes.subarray(0, EMBEDDING_INPUT_BYTES), {
    stream: true,
  });
}
