export async function readJsonBody(request, limit = 262144) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
    chunks.push(buffer);
  }
  try {
    const text = Buffer.concat(chunks).toString("utf8");
    const parsed = text ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw Object.assign(new Error("Invalid JSON body"), { statusCode: 400 }); }
}
