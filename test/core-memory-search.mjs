import test from "node:test";
import assert from "node:assert/strict";
import { parseMemoryIntent } from "../apps/server/memory-intent.mjs";
import { buildMemorySearchQuery } from "../apps/server/memory-query.mjs";
import {
  sourceDocument,
  extractSqlEvidence,
  actionDirectlyLinked,
  eventDirectlyLinked,
} from "../apps/server/memory-documents.mjs";
import {
  embeddingInput,
  validateEmbedding,
} from "../apps/server/memory-vectors.mjs";
const NOW = Date.parse("2026-10-26T12:00:00Z");
test("the requested last-two-days performance event question has hard dates and category", () => {
  const i = parseMemoryIntent(
    {
      query:
        "Give me a list of all events and SQL queries associated with it in last 2 days where performance degraded",
    },
    NOW,
  );
  assert.equal(i.from, "2026-10-24T12:00:00.000Z");
  assert.equal(i.to, "2026-10-26T12:00:00.000Z");
  assert.equal(i.sourceType, "event");
  assert.deepEqual(i.categories, ["performance"]);
  assert.equal(i.ordering, "chronological");
  assert.match(i.explanation, /does not prove a measured latency regression/);
});
test("explicit dates override natural language and literal keyword remains independent", () => {
  const i = parseMemoryIntent(
    {
      query: "all performance events last 2 days app.orders",
      from: "2026-10-01",
      to: "2026-10-03",
      keyword: "customer_id",
      kind: "action",
    },
    NOW,
  );
  assert.equal(i.from, "2026-10-01T00:00:00.000Z");
  assert.equal(i.to, "2026-10-03T00:00:00.000Z");
  assert.equal(i.sourceType, "action");
  assert.deepEqual(i.keywords, ["app.orders", "customer_id"]);
});
test("invalid dates, unexpected fields, type tricks and oversized pagination are rejected", () => {
  for (const b of [
    { from: "2026-02-30" },
    { from: false },
    { kind: false },
    { from: "2026-02-30T00:00:00Z" },
    { from: "2026-10-26", to: "2026-10-25" },
    { kind: "event;DROP TABLE x" },
    { limit: "25" },
    { offset: 10001 },
    { sql: "SELECT 1" },
    { query: ["text"] },
  ])
    assert.throws(
      () => parseMemoryIntent(b, NOW),
      (e) => e.statusCode === 400,
    );
});
test("hard filter values are bound parameters and cannot modify the SQL query structure", () => {
  const marker = "'; DROP TABLE agent.memory; --";
  const q = buildMemorySearchQuery(
    parseMemoryIntent({ query: "all events", keyword: marker }),
    null,
    "model-one",
  );
  assert.equal(q.text.includes(marker), false);
  assert.ok(q.values[4].includes(marker));
  assert.match(q.text, /filtered AS MATERIALIZED/);
  assert.match(q.text, /occurred_at >=/);
  assert.match(q.text, /occurred_at </);
  assert.match(q.text, /count\(\*\).*FROM scored/);
  assert.equal(q.text.includes("LIMIT 200"), false);
});

test("cluster scope is a mandatory bound filter for structured and semantic memory search", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const intent = parseMemoryIntent({ query: "all performance events", clusterId: id });
  const query = buildMemorySearchQuery(intent, null, "model-one");
  assert.equal(query.values[12], id);
  assert.equal(query.text.includes(id), false);
  assert.match(query.text, /clusterId/);
  assert.throws(() => parseMemoryIntent({ clusterId: "primary OR true" }), /clusterId/);
});
test("an old event without a known generation cannot inherit SQL from later actions", () => {
  const doc = {
    source_type: "event",
    incident_id: "incident-one",
    action_id: null,
    event_id: "1",
    metadata: { generation: null },
  };
  const action = {
    action_id: "later-action",
    incident_id: "incident-one",
    generation: 2,
    created_at: "2026-10-26T01:00:00Z",
  };
  assert.equal(actionDirectlyLinked(doc, action), false);
  assert.equal(
    actionDirectlyLinked({ ...doc, metadata: { generation: 1 } }, action),
    false,
  );
  assert.equal(
    actionDirectlyLinked({ ...doc, action_id: "later-action" }, action),
    true,
  );
  assert.equal(
    eventDirectlyLinked(doc, {
      event_id: "2",
      incident_id: "incident-one",
      recorded_at: action.created_at,
      detail: { generation: 2 },
    }),
    false,
  );
});
test("linked SQL/event context obeys the same half-open time window", () => {
  const doc = { incident_id: "i", metadata: { generation: 2 } };
  const intent = { from: "2026-10-25T00:00:00Z", to: "2026-10-26T00:00:00Z" };
  assert.equal(
    actionDirectlyLinked(
      doc,
      { incident_id: "i", generation: 2, created_at: intent.from },
      intent,
    ),
    true,
  );
  assert.equal(
    actionDirectlyLinked(
      doc,
      { incident_id: "i", generation: 2, created_at: intent.to },
      intent,
    ),
    false,
  );
  assert.equal(
    eventDirectlyLinked(
      doc,
      { incident_id: "i", detail: { generation: 2 }, recorded_at: intent.to },
      intent,
    ),
    false,
  );
});
test("recurring incident documents use the generation onset instead of the original first-seen date", () => {
  const row = {
    incident_id: "11111111-1111-1111-1111-111111111111",
    generation: 3,
    first_seen_at: "2026-10-01T00:00:00Z",
    generation_seen_at: "2026-10-26T00:00:00Z",
    kind: "query-tuning",
    title: "Missing index",
    summary: "Concern",
    status: "open",
    evidence: {},
  };
  const d = sourceDocument("incident", row);
  assert.equal(d.at, row.generation_seen_at);
  assert.equal(d.sourceId, row.incident_id + ":3");
});
test("SQL evidence contains only stored SQL and describes cumulative snapshots honestly", () => {
  const sql = extractSqlEvidence(
    {
      queries: [
        {
          query: "SELECT sum(amount) FROM app.orders",
          queryid: "q1",
          calls: 4,
          mean_ms: 40,
        },
      ],
      unrelated: "nothing",
    },
    "event:1",
    "2026-10-25T00:00:00Z",
  );
  assert.equal(sql.length, 1);
  assert.equal(sql[0].queryId, "q1");
  assert.match(sql[0].provenance, /event:1/);
  assert.match(sql[0].scope, /not an execution log or a latency benchmark/);
  assert.deepEqual(
    extractSqlEvidence({ message: "No SQL captured" }, "event:2", null),
    [],
  );
});
test("embedding excerpts include the correct prefix and stay within 1800 UTF-8 bytes", () => {
  for (const text of ["x".repeat(9999), "数据库🙂".repeat(999)]) {
    const input = embeddingInput(text);
    assert.ok(new TextEncoder().encode(input).length <= 1800);
    assert.ok(input.startsWith("search_document: "));
    assert.equal(input.includes("�"), false);
  }
  assert.ok(embeddingInput("slow query", true).startsWith("search_query: "));
});
test("wrong dimensions, nonfinite coordinates and cosine-undefined zero vectors are rejected", () => {
  for (const v of [
    [],
    Array(767).fill(1),
    Array(768).fill(0),
    [NaN, ...Array(767).fill(1)],
    [Infinity, ...Array(767).fill(1)],
  ])
    assert.throws(() => validateEmbedding(v));
  assert.equal(validateEmbedding(Array(768).fill(0.01)).length, 768);
});

test("chronological semantic paraphrases still require a lexical or vector match", () => {
  const semantic = parseMemoryIntent({
    query: "list events where requests became sluggish",
    from: "2026-10-25",
    to: "2026-10-26",
  });
  assert.equal(semantic.ordering, "chronological");
  assert.equal(semantic.matchAllFiltered, false);
  assert.equal(
    buildMemorySearchQuery(semantic, null, "model").values[8],
    false,
  );
  const structured = parseMemoryIntent(
    { query: "list all performance events last 2 days" },
    NOW,
  );
  assert.equal(structured.matchAllFiltered, true);
});

test("full stored SQL text remains in the FTS document beyond the semantic excerpt", () => {
  const query = "SELECT " + "x".repeat(19000) + " AS retained_tail_identifier";
  const d = sourceDocument("event", {
    event_id: "1",
    recorded_at: "2026-10-25T00:00:00Z",
    event_type: "agent.tool",
    title: "inspect_queries",
    detail: { queries: [{ query }] },
  });
  assert.ok(d.content.includes("retained_tail_identifier"));
});
