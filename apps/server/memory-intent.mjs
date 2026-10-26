export const SOURCE_TYPES = ["memory", "event", "incident", "action", "query"];
export const CATEGORIES = [
  "performance",
  "replication",
  "security",
  "availability",
  "operations",
  "human_feedback",
];
const fail = (message) => {
  throw Object.assign(new Error(message), { statusCode: 400 });
};
const DAY = 86400000;
function isoDate(value, field) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      value,
    )
  )
    fail(field + " must be an ISO date or timestamp with timezone");
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (
    new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !==
    value.slice(0, 10)
  )
    fail("Invalid " + field);
  const time = Date.parse(value);
  if (
    !Number.isFinite(time) ||
    (new Date(time).toISOString().slice(0, 10) !== value.slice(0, 10) &&
      value.length === 10)
  )
    fail("Invalid " + field);
  return new Date(time).toISOString();
}
export function parseMemoryIntent(body = {}, now = Date.now()) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail("Search request must be an object");
  const allowed = new Set([
    "query",
    "from",
    "to",
    "kind",
    "keyword",
    "limit",
    "offset",
  ]);
  if (Object.keys(body).some((k) => !allowed.has(k)))
    fail("Unsupported search field");
  if (body.query != null && typeof body.query !== "string")
    fail("Query must be text");
  const query = (body.query || "").trim();
  if (query.length > 2000) fail("Query is limited to 2000 characters");
  if (
    body.keyword != null &&
    (typeof body.keyword !== "string" || body.keyword.length > 300)
  )
    fail("Keyword must be text up to 300 characters");
  if (
    body.kind != null &&
    body.kind !== "" &&
    body.kind !== "all" &&
    !SOURCE_TYPES.includes(body.kind)
  )
    fail("Unknown source type");
  const limit = body.limit ?? 25,
    offset = body.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    fail("Limit must be an integer from 1 to 100");
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
    fail("Offset must be an integer from 0 to 10000");
  const text = query.toLowerCase();
  let from =
    body.from != null && body.from !== "" ? isoDate(body.from, "from") : null;
  let to = body.to != null && body.to !== "" ? isoDate(body.to, "to") : null;
  let dateExplanation = "No date restriction.";
  const relative = text.match(
    /\b(?:last|past|previous)\s+(\d{1,3}|one|two|three|seven)\s+(hours?|days?|weeks?)\b/,
  );
  if (!from && !to && relative) {
    const words = { one: 1, two: 2, three: 3, seven: 7 };
    const n = words[relative[1]] || Number(relative[1]);
    if (!n || n > 365) fail("Relative time range is limited to 365 units");
    const unit = relative[2].startsWith("hour")
      ? 3600000
      : relative[2].startsWith("week")
        ? DAY * 7
        : DAY;
    if (n * unit > DAY * 365) fail("Search range is limited to 365 days");
    from = new Date(now - n * unit).toISOString();
    to = new Date(now).toISOString();
    dateExplanation =
      "Rolling relative interval ending at request time, expressed in UTC.";
  } else if (!from && !to && /\byesterday\b/.test(text)) {
    const midnight = Date.parse(new Date(now).toISOString().slice(0, 10));
    from = new Date(midnight - DAY).toISOString();
    to = new Date(midnight).toISOString();
    dateExplanation =
      "Yesterday uses UTC calendar boundaries; explicit console dates override this.";
  } else if (!from && !to && /\btoday\b/.test(text)) {
    from = new Date(
      Date.parse(new Date(now).toISOString().slice(0, 10)),
    ).toISOString();
    to = new Date(now).toISOString();
    dateExplanation =
      "Today uses UTC calendar boundaries; explicit console dates override this.";
  } else if (!from && !to) {
    const between = text.match(
      /\b(?:between|from)\s+(\d{4}-\d{2}-\d{2})\s+(?:and|to|through)\s+(\d{4}-\d{2}-\d{2})\b/,
    );
    const on = text.match(/\bon\s+(\d{4}-\d{2}-\d{2})\b/);
    if (between) {
      from = isoDate(between[1], "from");
      to = new Date(Date.parse(isoDate(between[2], "to")) + DAY).toISOString();
      dateExplanation =
        "Both named calendar dates are included using UTC day boundaries.";
    } else if (on) {
      from = isoDate(on[1], "from");
      to = new Date(Date.parse(from) + DAY).toISOString();
      dateExplanation = "Named date uses UTC calendar boundaries.";
    }
  }
  if (body.from || body.to)
    dateExplanation =
      "Explicit console dates override natural-language dates; from is inclusive and to is exclusive.";
  if (from && to && Date.parse(from) >= Date.parse(to))
    fail("from must be earlier than to");
  if (from && to && Date.parse(to) - Date.parse(from) > DAY * 365)
    fail("Search range is limited to 365 days");
  const categories = [];
  if (
    /\b(performance|slow|slower|latency|degrad\w*|regress\w*|tuning|statistics|blocked|blocking|bottleneck)\b/.test(
      text,
    )
  )
    categories.push("performance");
  if (/\b(replica\w*|standby|wal|replay|replication)\b/.test(text))
    categories.push("replication");
  if (
    /\b(security|privilege\w*|createrole|login|permission\w*|violation\w*)\b/.test(
      text,
    )
  )
    categories.push("security");
  if (
    /\b(outage|unavailable|unreachable|offline|disconnect\w*)\b/.test(text) &&
    !categories.includes("replication")
  )
    categories.push("availability");
  if (
    /\b(feedback|human review|operator preference|human steering)\b/.test(
      text,
    ) &&
    !categories.length
  )
    categories.push("human_feedback");
  let sourceType = body.kind && body.kind !== "all" ? body.kind : null;
  if (!sourceType && /\bevents?\b/.test(text)) sourceType = "event";
  else if (
    !sourceType &&
    /\bactions?\b/.test(text) &&
    !/\bevents?\b/.test(text)
  )
    sourceType = "action";
  else if (!sourceType && /\bmemories|memory\b/.test(text))
    sourceType = "memory";
  const keywords = [...query.matchAll(/["“]([^"”]{1,120})["”]/g)].map(
    (m) => m[1],
  );
  for (const match of query.matchAll(
    /\b[a-zA-Z][a-zA-Z0-9]*[._][a-zA-Z0-9_.]+\b/g,
  )) {
    if (!/^\d/.test(match[0])) keywords.push(match[0]);
  }
  const containing = query.match(
    /\b(?:containing|keyword|matching)\s+([\w.]+)\b/i,
  );
  if (containing) keywords.push(containing[1]);
  if (keywords.length > 8)
    fail("At most eight literal search terms are supported");
  const keywordFilter = (body.keyword || "").trim();
  if (keywordFilter) keywords.push(keywordFilter);
  const lexicalText = query
    .replace(
      /\b(?:give|me|a|an|the|list|of|all|show|find|with|and|its|it|associated|queries|query|sql|events?|in|last|past|previous|days?|hours?|weeks?|where|to|for|please|two|one|three|seven)\b/gi,
      " ",
    )
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const ordering =
    !query || /\b(list|all|chronological|timeline|events?)\b/.test(text)
      ? "chronological"
      : "relevance";
  const matchAllFiltered =
    ordering === "chronological" &&
    (categories.length > 0 || keywords.length > 0 || !lexicalText);
  return {
    query,
    from,
    to,
    keywords: [...new Set(keywords)],
    keywordFilter,
    categories,
    sourceType,
    ordering,
    matchAllFiltered,
    lexicalText,
    limit,
    offset,
    parser: "deterministic",
    dateSemantics: "from inclusive; to exclusive; timestamps UTC",
    explanation:
      dateExplanation +
      (categories.includes("performance")
        ? " Performance means recorded statistics, tuning, or blocking concerns and their outcomes; it does not prove a measured latency regression."
        : ""),
  };
}
