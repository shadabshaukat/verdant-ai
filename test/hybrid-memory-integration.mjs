/** Isolated control-DB regression. Uses real Nomic vectors; never calls a workload action or target fixture. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
const url = (file) => pathToFileURL(path.resolve("apps/server", file));
const { db } = await import(url("store.mjs"));
const { closePools } = await import(url("config.mjs"));
const { EMBEDDING_MODEL, embedTexts } = await import(url("embeddings.mjs"));
const { parseMemoryIntent } = await import(url("memory-intent.mjs"));
const { buildMemorySearchQuery } = await import(url("memory-query.mjs"));
const { searchMemory } = await import(url("memory-search.mjs"));
const { sourceDocument } = await import(url("memory-documents.mjs"));
const tag = "hybridregression" + randomUUID().replaceAll("-", "");
const from = "2026-10-25T00:00:00.000Z",
  to = "2026-10-26T00:00:00.000Z";
const docs = [
  {
    at: "2026-10-24T23:59:59.999Z",
    category: "performance",
    title: "Outside earlier boundary",
  },
  { at: from, category: "performance", title: "Included at lower boundary" },
  {
    at: "2026-10-25T23:59:59.999Z",
    category: "performance",
    title: "Included before upper boundary",
  },
  {
    at: to,
    category: "performance",
    title: "Outside at exclusive upper boundary",
  },
  { at: from, category: "security", title: "Wrong mandatory category" },
  {
    at: from,
    category: "performance",
    title: "Wrong literal keyword",
    wrongKeyword: true,
  },
];
let lock, incidentId, eventId, actionId;
try {
  lock = await db.connect();
  await lock.query("SELECT pg_advisory_lock(hashtext('verdant-memory-index'))");
  const texts = docs.map(
    (d) =>
      `${d.title}. Database performance degraded because work waited on a lock. ${d.wrongKeyword ? "different-keyword" : tag}`,
  );
  const vectors = await embedTexts(texts);
  for (let i = 0; i < docs.length; i++)
    await db.query(
      `INSERT INTO agent.search_document(source_type,source_id,occurred_at,title,content,kind,category,content_hash,embedding,embedding_model,embedded_at) VALUES('event',$1,$2,$3,$4,'integration-test',$5,$6,$7::public.vector,$8,now())`,
      [
        tag + ":" + i,
        docs[i].at,
        docs[i].title,
        texts[i],
        docs[i].category,
        tag + ":" + i,
        JSON.stringify(vectors[i]),
        EMBEDDING_MODEL,
      ],
    );
  const intent = parseMemoryIntent({
    query: "list all performance events",
    from,
    to,
    keyword: tag,
    limit: 1,
  });
  const [queryVector] = await embedTexts(
    ["database delay caused by waiting on locks"],
    { query: true },
  );
  const first = (
    await db.query(buildMemorySearchQuery(intent, queryVector, EMBEDDING_MODEL))
  ).rows[0];
  assert.equal(first.total, 2);
  assert.equal(first.results.length, 1);
  assert.equal(first.results[0].title, docs[1].title);
  assert.ok(Number.isFinite(first.results[0].semantic_similarity));
  const second = (
    await db.query(
      buildMemorySearchQuery(
        { ...intent, offset: 1 },
        queryVector,
        EMBEDDING_MODEL,
      ),
    )
  ).rows[0];
  assert.equal(second.total, 2);
  assert.equal(second.results[0].title, docs[2].title);
  const after = (
    await db.query(
      buildMemorySearchQuery(
        { ...intent, offset: 2 },
        queryVector,
        EMBEDDING_MODEL,
      ),
    )
  ).rows[0];
  assert.equal(after.total, 2);
  assert.deepEqual(after.results, []);
  const fallback = (
    await db.query(
      buildMemorySearchQuery({ ...intent, limit: 100 }, null, EMBEDDING_MODEL),
    )
  ).rows[0];
  assert.equal(fallback.total, 2);
  assert.ok(fallback.results.every((r) => r.semantic_similarity === null));
  console.log(
    "PASS: real 768-dimensional vectors cannot escape date/category/literal filters; exact totals and chronological pagination include both half-open boundaries correctly; keyword/structured fallback works.",
  );

  incidentId = (
    await db.query(
      `INSERT INTO agent.incident(target_id,fingerprint,kind,title,severity,status,generation,summary) VALUES('primary',$1,'query-tuning','Control-only historical provenance test','info','resolved',2,'No target finding; regression only') RETURNING incident_id`,
      [tag],
    )
  ).rows[0].incident_id;
  eventId = (
    await db.query(
      `INSERT INTO agent.event(recorded_at,event_type,title,detail,incident_id) VALUES($1,'incident.detected',$2,$3,$4) RETURNING event_id`,
      [
        from,
        tag + " old event with unknown generation",
        { query: "SELECT 1 /* original captured SQL */" },
        incidentId,
      ],
    )
  ).rows[0].event_id;
  actionId = (
    await db.query(
      `INSERT INTO agent.action(incident_id,generation,target_id,idempotency_key,tool,title,status,risk,reason,sql_template,created_at,verified_at) VALUES($1,2,'primary',$2,'create_demo_index','Control-only later action','succeeded','bounded','Never executed on a target','SELECT ops.create_demo_index()',$3,$3) RETURNING action_id`,
      [incidentId, tag, "2026-10-25T12:00:00Z"],
    )
  ).rows[0].action_id;
  const doc = sourceDocument("event", {
    event_id: eventId,
    recorded_at: from,
    event_type: "incident.detected",
    title: tag + " provenance",
    detail: { query: "SELECT 1 /* original captured SQL */" },
    incident_id: incidentId,
    incident_kind: "query-tuning",
  });
  await db.query(
    `INSERT INTO agent.search_document(source_type,source_id,occurred_at,title,content,incident_id,event_id,kind,category,content_hash,metadata) VALUES('event',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      tag + ":provenance",
      doc.at,
      doc.title,
      doc.content,
      incidentId,
      eventId,
      doc.kind,
      doc.category,
      doc.contentHash,
      doc.metadata,
    ],
  );
  const found = await searchMemory({
    query: "all events",
    from,
    to,
    keyword: tag + " provenance",
    limit: 10,
  });
  assert.equal(found.total, 1);
  assert.deepEqual(found.results[0].evidence.actions, []);
  assert.ok(
    found.results[0].evidence.sqlQueries.some((q) =>
      q.query.includes("original captured SQL"),
    ),
  );
  assert.ok(
    found.results[0].evidence.sqlQueries.every(
      (q) => !q.query.includes("ops.create_demo_index"),
    ),
  );
  console.log(
    "PASS: historical event with shared incident but unknown generation does not inherit later action SQL; its own captured SQL remains available.",
  );
} finally {
  await db.query(
    "DELETE FROM agent.search_document WHERE source_id LIKE $1 OR incident_id=$2",
    [tag + "%", incidentId || null],
  );
  if (incidentId) {
    await db.query("DELETE FROM agent.event WHERE incident_id=$1", [
      incidentId,
    ]);
    await db.query("DELETE FROM agent.action WHERE incident_id=$1", [
      incidentId,
    ]);
    await db.query("DELETE FROM agent.incident WHERE incident_id=$1", [
      incidentId,
    ]);
  }
  if (lock) {
    await lock.query(
      "SELECT pg_advisory_unlock(hashtext('verdant-memory-index'))",
    );
    lock.release();
  }
  await closePools();
}
