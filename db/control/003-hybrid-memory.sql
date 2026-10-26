-- Run as verdant_control after the administrator has installed the vector extension.
-- This additive migration preserves existing agent state and is safe to repeat.
DO $prerequisite$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION 'The vector extension must be created by the control database administrator before applying 003-hybrid-memory.sql';
  END IF;
END
$prerequisite$;

CREATE TABLE IF NOT EXISTS agent.search_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL
    CHECK (source_type IN ('memory', 'event', 'incident', 'action', 'query')),
  source_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  incident_id uuid,
  action_id uuid,
  event_id bigint,
  query_id text,
  kind text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'operations'
    CHECK (category IN ('performance', 'replication', 'security', 'availability', 'operations', 'human_feedback')),
  title text NOT NULL DEFAULT '',
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  embedding public.vector(768),
  embedding_model text,
  embedded_at timestamptz,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || content)
  ) STORED,
  CONSTRAINT search_document_source_unique UNIQUE (source_type, source_id),
  CONSTRAINT search_document_embedding_complete CHECK (
    (embedding IS NULL AND embedding_model IS NULL AND embedded_at IS NULL)
    OR
    (embedding IS NOT NULL AND embedding_model IS NOT NULL AND embedded_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS search_document_search_gin
  ON agent.search_document USING gin (search_vector);
CREATE INDEX IF NOT EXISTS search_document_occurred_at
  ON agent.search_document (occurred_at DESC);
CREATE INDEX IF NOT EXISTS search_document_category_time
  ON agent.search_document (category, occurred_at DESC);
CREATE INDEX IF NOT EXISTS search_document_source_type
  ON agent.search_document (source_type);
CREATE INDEX IF NOT EXISTS search_document_content_hash
  ON agent.search_document (content_hash);

REVOKE ALL ON TABLE agent.search_document FROM PUBLIC;

COMMENT ON TABLE agent.search_document IS
  'Derived retrieval corpus with original-source provenance. Search relevance and model summaries do not establish operational truth.';
COMMENT ON COLUMN agent.search_document.embedding IS
  'Real 768-dimensional document embedding; NULL while unavailable or awaiting indexing. Exact cosine search is intentional for this small filtered corpus.';
COMMENT ON COLUMN agent.search_document.content_hash IS
  'Application-computed hash of the indexed text used to detect changes and invalidate stale embeddings.';
COMMENT ON COLUMN agent.search_document.search_vector IS
  'PostgreSQL English full-text document over title and content, maintained by a generated column and GIN index.';
COMMENT ON COLUMN agent.search_document.occurred_at IS
  'Original source event time used for date filtering, distinct from retrieval indexing time.';
