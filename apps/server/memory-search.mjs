import { db } from "./store.mjs";
import { timestamp, errText } from "./config.mjs";
import { parseMemoryIntent } from "./memory-intent.mjs";
import { buildMemorySearchQuery, SEMANTIC_THRESHOLD } from "./memory-query.mjs";
import { EMBEDDING_MODEL, embedSearchQuery } from "./embeddings.mjs";
import { indexMemoryBatch, memoryIndexStatus } from "./memory-index.mjs";
import {
  extractSqlEvidence,
  actionDirectlyLinked,
  eventDirectlyLinked,
} from "./memory-documents.mjs";
export { memoryIndexStatus };
const slimAction = (r) => ({
  id: r.action_id,
  incidentId: r.incident_id,
  generation: r.generation,
  tool: r.tool,
  title: r.title,
  status: r.status,
  sql: r.sql_template,
  reason: r.reason,
  at: timestamp(r.verified_at || r.started_at || r.created_at),
  verifiedAt: timestamp(r.verified_at),
  before: r.before_evidence,
  after: r.after_evidence,
  error: r.error,
});
const slimEvent = (r) => ({
  id: String(r.event_id),
  incidentId: r.incident_id,
  actionId: r.action_id,
  at: timestamp(r.recorded_at),
  type: r.event_type,
  title: r.title,
  severity: r.severity,
  detail: r.detail,
});
async function enrichResults(rows, intent) {
  if (!rows.length) return [];
  const incidentIds = [
    ...new Set(rows.map((r) => r.incident_id).filter(Boolean)),
  ];
  const actionIds = [...new Set(rows.map((r) => r.action_id).filter(Boolean))];
  const eventIds = [...new Set(rows.map((r) => r.event_id).filter(Boolean))];
  const [incidents, actions, events] = await Promise.all([
    db.query("SELECT * FROM agent.incident WHERE incident_id=ANY($1::uuid[])", [
      incidentIds,
    ]),
    db.query(
      "SELECT *,count(*) OVER()::int AS available_count FROM agent.action WHERE (incident_id=ANY($1::uuid[]) OR action_id=ANY($2::uuid[])) AND ($3::timestamptz IS NULL OR coalesce(verified_at,started_at,created_at)>=$3) AND ($4::timestamptz IS NULL OR coalesce(verified_at,started_at,created_at)<$4) ORDER BY created_at LIMIT 500",
      [incidentIds, actionIds, intent.from, intent.to],
    ),
    db.query(
      "SELECT e.*,a.generation AS action_generation,count(*) OVER()::int AS available_count FROM agent.event e LEFT JOIN agent.action a ON a.action_id=e.action_id WHERE (e.incident_id=ANY($1::uuid[]) OR e.action_id=ANY($2::uuid[]) OR e.event_id=ANY($3::bigint[])) AND ($4::timestamptz IS NULL OR e.recorded_at>=$4) AND ($5::timestamptz IS NULL OR e.recorded_at<$5) ORDER BY e.recorded_at LIMIT 500",
      [incidentIds, actionIds, eventIds, intent.from, intent.to],
    ),
  ]);
  return rows.map((row) => {
    const linkedActions = actions.rows.filter((a) =>
      actionDirectlyLinked(row, a, intent),
    );
    const linkedEvents = events.rows.filter((e) =>
      eventDirectlyLinked(row, e, intent),
    );
    const incident = incidents.rows.find(
      (i) => i.incident_id === row.incident_id,
    );
    const sql = [];
    extractSqlEvidence(
      row.metadata?.snapshot,
      row.source_type + ":" + row.source_id,
      row.occurred_at,
      "snapshot.",
      sql,
    );
    for (const action of linkedActions.slice(0, 20))
      extractSqlEvidence(
        {
          sql: action.sql_template,
          before: action.before_evidence,
          after: action.after_evidence,
        },
        "action:" + action.action_id,
        timestamp(action.verified_at || action.created_at),
        "",
        sql,
      );
    // The incident snapshot embedded in this source is historical. A current row is displayed separately, never substituted as historical SQL evidence.
    const uniqueSql = [
      ...new Map(
        sql.map((entry) => [entry.query + "|" + entry.provenance, entry]),
      ).values(),
    ];
    const availableActions = actions.rows[0]?.available_count || 0,
      availableEvents = events.rows[0]?.available_count || 0;
    return {
      id: row.id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      at: timestamp(row.occurred_at),
      kind: row.kind,
      category: row.category,
      title: row.title,
      content: row.content,
      score: Number(row.score),
      match: {
        keyword: Number(row.keyword_score) > 0,
        semantic:
          row.semantic_similarity != null &&
          Number(row.semantic_similarity) >= SEMANTIC_THRESHOLD,
        semanticSimilarity:
          row.semantic_similarity == null
            ? null
            : Number(row.semantic_similarity),
        structured: true,
      },
      incidentId: row.incident_id,
      actionId: row.action_id,
      eventId: row.event_id == null ? null : String(row.event_id),
      queryId: row.query_id,
      metadata: row.metadata,
      evidence: {
        incident: incident
          ? {
              id: incident.incident_id,
              title: incident.title,
              kind: incident.kind,
              status: incident.status,
              generation: incident.generation,
              summary: incident.summary,
              scope:
                "Current durable incident row; source snapshot above retains the indexed historical evidence.",
            }
          : null,
        actions: linkedActions.slice(0, 20).map(slimAction),
        events: linkedEvents.slice(0, 20).map(slimEvent),
        sqlQueries: uniqueSql.slice(0, 100),
        sourceSnapshot: row.metadata?.snapshot || null,
        truncated:
          linkedActions.length > 20 ||
          linkedEvents.length > 20 ||
          uniqueSql.length > 100 ||
          availableActions > 500 ||
          availableEvents > 500,
        scope:
          "SQL appears only when stored in this source snapshot or its directly linked actions. Only explicit action or same-generation links are included, within the requested time interval; shared incident identity alone cannot attribute historical SQL. Evidence detail is bounded to 20 actions/events and 100 SQL entries per result.",
      },
    };
  });
}
export async function searchMemory(body) {
  const intent = parseMemoryIntent(body);
  const warnings = [];
  let vector = null,
    embeddingError = null;
  const status = await memoryIndexStatus();
  if (intent.query && status.indexed > 0)
    try {
      vector = await embedSearchQuery(intent.query);
    } catch (error) {
      embeddingError = errText(error);
    }
  if (!vector)
    warnings.push(
      intent.query
        ? "Semantic query embedding is unavailable or the matching-model index is not ready; keyword and mandatory structured filters remain active."
        : "No semantic query was supplied; this is a structured chronological listing.",
    );
  const pendingSources = Object.values(status.sourceCoverage).reduce(
    (sum, x) => sum + x.pending,
    0,
  );
  if (pendingSources)
    warnings.push(
      `${pendingSources} retained source records still await indexing or refresh. Totals below describe the persisted corpus, not unindexed records.`,
    );
  if (status.pending)
    warnings.push(
      `${status.pending} corpus documents have no embedding for ${EMBEDDING_MODEL}; their keyword/structured matches remain searchable.`,
    );
  if (intent.categories.includes("performance"))
    warnings.push(
      "Performance retrieval covers recorded concerns and outcomes; cumulative query means and estimated EXPLAIN plans do not prove a measured latency regression.",
    );
  const result = (
    await db.query(buildMemorySearchQuery(intent, vector, EMBEDDING_MODEL))
  ).rows[0];
  const results = await enrichResults(result.results, intent);
  if (result.total > 10100)
    warnings.push(
      "Offset is bounded to 10000. Narrow dates, category, or keyword to navigate beyond this window; total is not capped.",
    );
  void indexMemoryBatch({ embeddings: false });
  return {
    query: intent.query,
    intent,
    mode: vector ? "hybrid" : "keyword_structured",
    embedding: {
      ...status,
      queryEmbedded: !!vector,
      error: embeddingError || status.indexing?.embeddingError || null,
    },
    total: result.total,
    totalScope:
      "All corpus rows satisfying mandatory filters and the stated matching rule; not a top-k estimate.",
    matchingRule: intent.matchAllFiltered
      ? "All rows within mandatory date/source/category/literal filters; semantic and keyword ranks annotate rather than exclude the list."
      : `Full-text matches or cosine similarity >= ${SEMANTIC_THRESHOLD}, after all mandatory filters. Cosine similarity and RRF scores are retrieval signals, not confidence or operational truth.`,
    returned: results.length,
    offset: intent.offset,
    limit: intent.limit,
    hasMore: intent.offset + results.length < result.total,
    ranking: {
      method: "reciprocal_rank_fusion",
      constant: 60,
      keywordWeight: 1,
      semanticWeight: 1,
      candidateLimit: null,
      scope:
        "Exact ranking over all filtered matching corpus rows; no ANN or hidden top-k cutoff.",
    },
    results,
    warnings,
  };
}
/** Optional semantic supplement. Exact relevant human preferences from the existing recall path always remain. */
export async function semanticRecallMemories(incidents, limit = 4) {
  if (!incidents.length) return [];
  try {
    const vector = await Promise.race([
      embedSearchQuery(incidents.map((i) => i.kind + " " + i.title).join("; ")),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Semantic recall budget exceeded")),
          1200,
        ),
      ),
    ]);
    return (
      await db.query(
        `SELECT m.* FROM agent.search_document d JOIN agent.memory m ON m.memory_id::text=d.source_id WHERE d.source_type='memory' AND d.embedding_model=$1 AND d.embedding IS NOT NULL AND (1-(d.embedding<=>$2::public.vector))>=$3 ORDER BY CASE WHEN m.kind IN ('human_feedback','human_directive') THEN 0 ELSE 1 END,d.embedding<=>$2::public.vector LIMIT $4`,
        [EMBEDDING_MODEL, JSON.stringify(vector), SEMANTIC_THRESHOLD, limit],
      )
    ).rows;
  } catch {
    return [];
  }
}
