export const SEMANTIC_THRESHOLD = 0.6;
/** Only values are supplied by the user/model; SQL structure is a fixed allowlisted query. */
export function buildMemorySearchQuery(intent, vector, model) {
  const order =
    intent.ordering === "chronological"
      ? "occurred_at ASC,id ASC"
      : "score DESC,occurred_at DESC,id ASC";
  return {
    text: `WITH filtered AS MATERIALIZED (
    SELECT d.*,CASE WHEN $6::text<>'' THEN ts_rank_cd(d.search_vector,websearch_to_tsquery('english',$6)) ELSE 0 END AS keyword_score,
      CASE WHEN $7::text IS NOT NULL AND d.embedding_model=$8 THEN 1-(d.embedding <=> $7::public.vector) ELSE NULL END AS semantic_similarity
    FROM agent.search_document d
    WHERE ($1::timestamptz IS NULL OR d.occurred_at >= $1::timestamptz)
      AND ($2::timestamptz IS NULL OR d.occurred_at < $2::timestamptz)
      AND ($3::text IS NULL OR d.source_type=$3)
      AND (cardinality($4::text[])=0 OR d.category=ANY($4::text[]) OR d.metadata->>'relatedCategory'=ANY($4::text[]))
      AND NOT EXISTS(SELECT 1 FROM unnest($5::text[]) term WHERE strpos(lower(d.title||' '||d.content),lower(term))=0)
      AND ($13::text IS NULL OR
        ($13='demo' AND coalesce(d.metadata->>'clusterId','demo')='demo' AND NOT EXISTS(SELECT 1 FROM agent.incident ci WHERE ci.incident_id=d.incident_id AND ci.target_id NOT IN ('primary','standby'))) OR
        d.metadata->>'clusterId'=$13 OR EXISTS(SELECT 1 FROM agent.incident ci JOIN agent.target ct USING(target_id) WHERE ci.incident_id=d.incident_id AND ct.metadata->>'clusterId'=$13))
  ), matching AS MATERIALIZED (
    SELECT * FROM filtered WHERE $9::boolean OR keyword_score>0 OR semantic_similarity >= $12 OR ($6::text='' AND $7::text IS NULL)
  ), ranked AS (
    SELECT *,CASE WHEN keyword_score>0 THEN row_number() OVER(ORDER BY keyword_score DESC,id) END AS keyword_rank,
      CASE WHEN semantic_similarity >= $12 THEN row_number() OVER(ORDER BY semantic_similarity DESC NULLS LAST,id) END AS semantic_rank FROM matching
  ), scored AS (
    SELECT id,source_type,source_id,occurred_at,incident_id,action_id,event_id,query_id,kind,category,title,content,metadata,keyword_score,semantic_similarity,
      coalesce(1.0/(60+keyword_rank),0)+coalesce(1.0/(60+semantic_rank),0) AS score FROM ranked
  ) SELECT (SELECT count(*)::int FROM scored) AS total,
    coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM(SELECT * FROM scored ORDER BY ${order} LIMIT $10 OFFSET $11)page),'[]'::jsonb) AS results`,
    values: [
      intent.from,
      intent.to,
      intent.sourceType,
      intent.categories,
      intent.keywords,
      intent.lexicalText,
      vector ? JSON.stringify(vector) : null,
      model,
      intent.matchAllFiltered,
      intent.limit,
      intent.offset,
      SEMANTIC_THRESHOLD,
      intent.clusterId || null,
    ],
  };
}
