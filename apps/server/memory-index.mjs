import { db } from "./store.mjs";
import { EMBEDDING_MODEL, embedTexts } from "./embeddings.mjs";
import { sourceDocument } from "./memory-documents.mjs";
import { errText } from "./config.mjs";
const boundedEnv = (name, fallback, max) =>
  Math.max(
    1,
    Math.min(max, Number.parseInt(process.env[name], 10) || fallback),
  );
const BATCH = boundedEnv("MEMORY_INDEX_BATCH_SIZE", 100, 500),
  EMBED_BATCH = boundedEnv("MEMORY_EMBED_BATCH_SIZE", 8, 64);
const QUERY_ROWS = `SELECT o.observation_id,o.recorded_at,q.value AS query,q.ordinality FROM agent.observation o CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.payload->'queries'->'queries')='array' THEN o.payload->'queries'->'queries' ELSE '[]'::jsonb END) WITH ORDINALITY q(value,ordinality) WHERE o.target_id='primary' AND q.value->>'query' ILIKE '%app.orders%' AND q.value->>'query' NOT ILIKE '%EXPLAIN%' AND q.value->>'query' NOT ILIKE '%pg_stat_%'`;
const SOURCES = {
  memory: `SELECT m.*,i.kind AS incident_kind FROM agent.memory m LEFT JOIN agent.incident i USING(incident_id) LEFT JOIN agent.search_document d ON d.source_type='memory' AND d.source_id=m.memory_id::text WHERE d.id IS NULL OR d.metadata->>'indexVersion' IS DISTINCT FROM 'hybrid-full-1' ORDER BY m.created_at,m.memory_id LIMIT $1`,
  event: `SELECT e.*,i.kind AS incident_kind,a.tool AS action_tool,a.sql_template,a.incident_id AS linked_incident_id FROM agent.event e LEFT JOIN agent.action a USING(action_id) LEFT JOIN agent.incident i ON i.incident_id=coalesce(e.incident_id,a.incident_id) LEFT JOIN agent.search_document d ON d.source_type='event' AND d.source_id=e.event_id::text WHERE d.id IS NULL OR d.metadata->>'indexVersion' IS DISTINCT FROM 'hybrid-full-1' ORDER BY e.event_id LIMIT $1`,
  incident: `SELECT i.*,coalesce((SELECT min(e.recorded_at) FROM agent.event e WHERE e.incident_id=i.incident_id AND e.event_type='incident.reopened' AND e.detail->>'generation'=i.generation::text),i.first_seen_at) AS generation_seen_at,md5((to_jsonb(i)-'last_seen_at')::text) AS source_hash FROM agent.incident i LEFT JOIN agent.search_document d ON d.source_type='incident' AND d.source_id=i.incident_id::text||':'||i.generation::text WHERE d.id IS NULL OR d.metadata->>'indexVersion' IS DISTINCT FROM 'hybrid-full-1' OR d.metadata->>'sourceHash' IS DISTINCT FROM md5((to_jsonb(i)-'last_seen_at')::text) ORDER BY (d.id IS NULL) DESC,i.first_seen_at LIMIT $1`,
  action: `SELECT a.*,i.kind AS incident_kind,md5(to_jsonb(a)::text) AS source_hash FROM agent.action a JOIN agent.incident i USING(incident_id) LEFT JOIN agent.search_document d ON d.source_type='action' AND d.source_id=a.action_id::text WHERE d.id IS NULL OR d.metadata->>'indexVersion' IS DISTINCT FROM 'hybrid-full-1' OR d.metadata->>'sourceHash' IS DISTINCT FROM md5(to_jsonb(a)::text) ORDER BY (d.id IS NULL) DESC,a.created_at LIMIT $1`,
  query: `SELECT q.* FROM (${QUERY_ROWS}) q LEFT JOIN agent.search_document d ON d.source_type='query' AND d.source_id=q.observation_id::text||':'||q.ordinality::text WHERE d.id IS NULL OR d.metadata->>'indexVersion' IS DISTINCT FROM 'hybrid-full-1' ORDER BY q.observation_id,q.ordinality LIMIT $1`,
};
async function upsertDocument(c, doc) {
  await c.query(
    `INSERT INTO agent.search_document(source_type,source_id,occurred_at,title,content,incident_id,action_id,event_id,query_id,kind,category,metadata,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(source_type,source_id) DO UPDATE SET occurred_at=EXCLUDED.occurred_at,title=EXCLUDED.title,content=EXCLUDED.content,incident_id=EXCLUDED.incident_id,action_id=EXCLUDED.action_id,event_id=EXCLUDED.event_id,query_id=EXCLUDED.query_id,kind=EXCLUDED.kind,category=EXCLUDED.category,metadata=EXCLUDED.metadata,content_hash=EXCLUDED.content_hash,indexed_at=now(),embedding=CASE WHEN agent.search_document.content_hash=EXCLUDED.content_hash THEN agent.search_document.embedding ELSE NULL END,embedding_model=CASE WHEN agent.search_document.content_hash=EXCLUDED.content_hash THEN agent.search_document.embedding_model ELSE NULL END,embedded_at=CASE WHEN agent.search_document.content_hash=EXCLUDED.content_hash THEN agent.search_document.embedded_at ELSE NULL END`,
    [
      doc.sourceType,
      doc.sourceId,
      doc.at,
      doc.title,
      doc.content,
      doc.incidentId,
      doc.actionId,
      doc.eventId,
      doc.queryId,
      doc.kind,
      doc.category,
      doc.metadata,
      doc.contentHash,
    ],
  );
}
let busy = false;
export async function indexMemoryBatch({ embeddings = true } = {}) {
  if (busy) return { skipped: true };
  busy = true;
  let c,
    locked = false;
  const status = {
    lastRunAt: new Date().toISOString(),
    ingested: 0,
    embedded: 0,
    batchSize: BATCH,
    embeddingBatchSize: EMBED_BATCH,
    embeddingError: null,
    error: null,
  };
  try {
    c = await db.connect();
    locked = (
      await c.query(
        "SELECT pg_try_advisory_lock(hashtext('verdant-memory-index')) AS locked",
      )
    ).rows[0].locked;
    if (!locked) return { skipped: true };
    for (const [type, sql] of Object.entries(SOURCES)) {
      const rows = (await c.query(sql, [BATCH])).rows;
      for (const row of rows) {
        await upsertDocument(c, sourceDocument(type, row));
        status.ingested++;
      }
    }
    if (embeddings) {
      const pending = (
        await c.query(
          `SELECT id,title,content,content_hash FROM agent.search_document WHERE (embedding IS NULL OR embedding_model<>$1) AND coalesce((metadata->'embeddingFailure'->>'retryAfter')::timestamptz, '-infinity'::timestamptz)<=now() ORDER BY CASE WHEN source_type='memory' AND kind IN ('human_feedback','human_directive') THEN 0 WHEN source_type='event' THEN 1 ELSE 2 END,occurred_at,id LIMIT $2`,
          [EMBEDDING_MODEL, EMBED_BATCH],
        )
      ).rows;
      if (pending.length)
        try {
          const vectors = await embedTexts(
            pending.map((r) => r.title + "\n" + r.content),
          );
          for (let i = 0; i < pending.length; i++) {
            const r = await c.query(
              `UPDATE agent.search_document SET embedding=$2::public.vector,embedding_model=$3,embedded_at=now(),metadata=metadata-'embeddingFailure' WHERE id=$1 AND content_hash=$4`,
              [
                pending[i].id,
                JSON.stringify(vectors[i]),
                EMBEDDING_MODEL,
                pending[i].content_hash,
              ],
            );
            status.embedded += r.rowCount;
          }
        } catch (error) {
          status.embeddingError = errText(error);
          await c.query(
            `UPDATE agent.search_document SET metadata=jsonb_set(metadata,'{embeddingFailure}',$2::jsonb,true) WHERE id=ANY($1::uuid[])`,
            [
              pending.map((d) => d.id),
              {
                error: status.embeddingError,
                lastAttemptAt: new Date().toISOString(),
                retryAfter: new Date(Date.now() + 60000).toISOString(),
              },
            ],
          );
        }
    }
    status.lastSuccessAt = new Date().toISOString();
    return status;
  } catch (error) {
    status.error = errText(error);
    return status;
  } finally {
    if (c && locked) {
      await c
        .query(
          "UPDATE agent.runtime SET state=jsonb_set(state,'{memorySearch}',$1::jsonb,true) WHERE singleton",
          [status],
        )
        .catch(() => {});
      await c
        .query("SELECT pg_advisory_unlock(hashtext('verdant-memory-index'))")
        .catch(() => {});
    }
    c?.release();
    busy = false;
  }
}
export function startMemoryIndexer(shouldRun = () => true) {
  const run = () => {
    if (shouldRun()) void indexMemoryBatch();
  };
  const startup = setTimeout(run, 250);
  startup.unref();
  const timer = setInterval(run, 15000);
  timer.unref();
  return () => {
    clearTimeout(startup);
    clearInterval(timer);
  };
}
export async function memoryIndexStatus() {
  const [coverage, runtime] = await Promise.all([
    db.query(
      `SELECT count(*)::int AS total,count(*) FILTER(WHERE embedding IS NOT NULL AND embedding_model=$1)::int AS indexed,count(*) FILTER(WHERE embedding IS NULL OR embedding_model<>$1)::int AS pending,max(indexed_at) AS "lastIndexedAt" FROM agent.search_document`,
      [EMBEDDING_MODEL],
    ),
    db.query(
      "SELECT state->'memorySearch' AS status FROM agent.runtime WHERE singleton",
    ),
  ]);
  const sourceCoverage = {};
  for (const [type, sql] of Object.entries(SOURCES)) {
    const query = sql.replace(/ORDER BY[\s\S]*LIMIT \$1$/, "");
    sourceCoverage[type] = {
      pending: Number(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM (" + query + ") pending",
          )
        ).rows[0].count,
      ),
    };
  }
  return {
    ...coverage.rows[0],
    available: coverage.rows[0].indexed > 0,
    model: EMBEDDING_MODEL,
    dimensions: 768,
    sourceCoverage,
    indexing: runtime.rows[0]?.status || null,
    representation:
      "Document embeddings represent at most the first 1800 UTF-8 bytes including prefix from title/content and may be token-truncated by the provider. Full text remains available to mandatory filters and FTS.",
    querySnapshotScope:
      "Captured app.orders workload SQL only; excludes monitor/system sensors. Associated SQL on incidents/actions/events is extracted independently from those durable records.",
    scope:
      "Persisted search corpus. Source backfill is incremental; pending source rows and missing embeddings are reported separately. Query snapshots are cumulative statistics, not an execution audit.",
  };
}
