# PostgreSQL hybrid retrieval

Verdant's derived retrieval corpus lives in `agent.search_document` in the control database. Each row keeps its original source type/ID, source time, category and provenance IDs alongside text and an optional real 768-dimensional embedding. The original memory, incident, action, event and query evidence remains separate from this search representation.

## Models and RAG boundary

The deployed configuration and Ollama runtime were verified on 26 October 2026:

| Role | Component | What it does |
| --- | --- | --- |
| Document and question embeddings | `nomic-embed-text:v1.5` through Ollama `/api/embed` | Produces real 768-dimensional vectors. The installed model is a 137M-parameter Nomic BERT embedding model; the running adapter reports a 2,048-token context. It does not write answers or SQL. |
| Search interpretation and retrieval | Deterministic application parser plus PostgreSQL | Applies validated dates, source/category and literal filters, then English full-text search, exact pgvector cosine search and reciprocal rank fusion. It returns source records and linked evidence. |
| Autonomous DBA planning | `qwen3:4b-instruct-2507-q4_K_M` through Ollama `/api/chat` | The 4B Qwen3 model selects bounded investigation/action tools. Its context can include retrieved historical memories and human feedback; current observations, policy gates and action verification retain authority. The running planner uses a 12,288-token context. |

**The Memory search currently has no answer-generation LLM and no LLM query-to-SQL translation.** Natural-language dates/categories/keywords use the bounded deterministic parser; semantic paraphrases use Nomic vectors. The returned list is grounded retrieval, not a generated RAG answer. Retrieval augments the separate Qwen DBA planner, which can reason about recalled context and produce explicitly unverified narrative. Human feedback is durable recallable data, not model fine-tuning.

Compose selects the planner with `OLLAMA_MODEL` and passes it into the container as `OLLAMA_CHAT_MODEL`. `OLLAMA_EMBED_MODEL` selects the embedding model. Both models were available and loaded when checked; configuration and runtime availability can change independently. Changing the embedding model requires compatible document re-embedding, even when dimensions remain equal.

## Retrieval ingredients

PostgreSQL maintains an English `tsvector` over the document's title and content, indexed with GIN. This branch finds lexical matches such as `CREATEROLE`, a tool name or a query term. A separate semantic branch uses local Ollama embeddings stored in pgvector's `vector(768)` column. Documents are embedded with the Nomic `search_document:` prefix; questions use `search_query:`. These are the model author's retrieval instructions, not text added to the displayed source. [Nomic model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)

Semantic distance uses pgvector's cosine operator `<=>`. This small lab deliberately uses exact search over the eligible rows, with ordinary indexes supporting date/category/source filters. It does not create HNSW or IVFFlat indexes. That choice avoids losing date-filtered candidates through a global approximate-neighbour candidate list; at larger scale, measure the workload and consider partitioning or filtered/iterative approximate search. [pgvector querying and filtering](https://github.com/pgvector/pgvector#filtering)

## Ask a question

In the Memory console, try “List all performance events in the last two days with associated queries”, “Find standby replay recovery”, or “Show security events containing CREATEROLE”. The application uses a bounded deterministic intent parser for recognized source types, categories, dates and literal terms; it does not ask a model to generate executable SQL. Inspect the returned intent and warnings when a phrase is ambiguous, or use explicit filters.

The same search is available through the local API:

```sh
curl -fsS http://127.0.0.1:8090/api/memory/status

curl -fsS http://127.0.0.1:8090/api/memory/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"List all performance events in the last two days with associated queries","limit":25,"offset":0}'

curl -fsS http://127.0.0.1:8090/api/memory/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"standby replay recovery","from":"2026-10-24","to":"2026-10-27","kind":"event","keyword":"replication","limit":25,"offset":0}'
```

`kind` is the source type: `memory`, `event`, `incident`, `action`, `query`, or `all`. Explicit `from`/`to` values override parsed dates; `from` is inclusive and `to` is exclusive. Dates without a time use UTC midnight. “Last two days” is a rolling 48-hour interval; “today”, “yesterday” and named calendar dates use UTC boundaries. An explicit closed interval is limited to 365 days. Literal keyword filters, including quoted phrases, remain mandatory even when semantic matches exist.

When text relevance is required, the matching set includes full-text matches or cosine similarity of at least `0.60`, after mandatory filters. This cutoff was tuned against the retained lab corpus because a lower value admitted too many unrelated records. It is a retrieval setting, not confidence or a general relevance guarantee. Reciprocal rank fusion combines the lexical and semantic ranks with equal weights and constant `60`. There is no hidden nearest-neighbour top-k cutoff before filtering.

“List”, “all”, “timeline”, and event-list questions select chronological ordering. Exhaustive structured matching is a separate intent field, `matchAllFiltered`: recognized category/literal filters or a plain event/date listing return every corpus row satisfying the mandatory filters. An unrecognized paraphrase such as “list events where requests became sluggish” still requires a full-text match or cosine similarity of at least `0.60`, then sorts the results chronologically. Inspect the interpreted intent and matching rule rather than assuming that ordering determines membership.

The API returns `total`, `returned`, `hasMore`, `offset`, `limit`, its interpreted intent and ranking/matching rules. Pages contain at most 100 rows, with offsets through 10,000; narrow a broad request to navigate beyond that window. “All” refers to the persisted corpus, with pending source indexing reported separately.

## Follow the provenance

Each result includes its source ID/time and snapshot, plus available incident/action/event context. SQL is shown only when retained in that snapshot or explicit action/same-generation links within the requested interval; a shared incident ID alone does not associate an older event with a later repair. A cumulative query-statistics snapshot is not an execution log; an allowlisted SQL template does not prove execution; a related event does not prove that every linked query ran at its timestamp. The current incident row is labelled separately from historical evidence. Detail is bounded to 20 actions, 20 events and 100 SQL entries per result, with truncation reported.

Incident generation documents use a matching `incident.reopened` event time for recurrence onset when available. The source metadata identifies fallback timing if no matching onset event exists. Query documents represent timestamped retained workload-statistics observations, not every SQL execution in PostgreSQL.

## Coverage and degraded operation

The worker backfills the corpus incrementally. Coverage distinguishes source rows awaiting ingestion/refresh from corpus rows awaiting embeddings for the selected model. Embeddings are processed in bounded batches; a newly created source record can be available for full-text/structured search before semantic retrieval. Failed documents receive a 60-second retry delay so later pending documents can progress. Status and response warnings expose indexing lag and provider errors.

If query embeddings are unavailable or there are no matching-model vectors, the response mode is `keyword_structured`, with a warning. It is not labelled hybrid. Missing document embeddings remain eligible for lexical/structured matching. Semantic suggestions also supplement the planner's existing exact memory recall; they do not replace relevant human directives or authorize actions.

## Inspect the stored evidence

Run these read-only SQL statements in the control database. Container-local administrator access is for operator inspection, not an agent tool:

```sh
docker compose exec control psql -U postgres -d verdant
```

```sql
SELECT extversion FROM pg_extension WHERE extname = 'vector';

SELECT source_type, count(*) AS documents,
       count(embedding) AS embedded_documents
FROM agent.search_document
GROUP BY source_type ORDER BY source_type;

SELECT embedding_model, vector_dims(embedding) AS dimensions, count(*)
FROM agent.search_document
WHERE embedding IS NOT NULL
GROUP BY embedding_model, vector_dims(embedding);

SELECT source_type, source_id, occurred_at, category, title,
       ts_rank_cd(search_vector,
                  websearch_to_tsquery('english', 'standby replay')) AS lexical_rank
FROM agent.search_document
WHERE occurred_at >= current_timestamp - interval '7 days'
  AND search_vector @@ websearch_to_tsquery('english', 'standby replay')
ORDER BY lexical_rank DESC, occurred_at DESC
LIMIT 10;
```

Source timestamps (`occurred_at`) and indexing timestamps (`indexed_at`, `embedded_at`) answer different questions. Filtering by source time prevents a recently re-indexed historical item from masquerading as a recent event. Provenance IDs intentionally have no foreign keys: derived historical text can remain after source retention, so a missing original row must be shown honestly.

## Model and data limits

The corpus stores embeddings only after a real embedding request succeeds. `NULL` means pending or unavailable; it must never be replaced with a random or hash-derived vector and represented as semantic search. The application records the embedding model and invalidates old vectors when indexed text changes. The database requires the vector, model and embedding timestamp to be present together, and enforces 768 dimensions.

Ollama's current `/api/embed` endpoint accepts one text or a batch. This lab caps the entire prefixed input at 1,800 UTF-8 bytes, ending at a valid character boundary, and keeps provider truncation enabled as a further safeguard. The semantic vector therefore represents a short excerpt of title/content or the question, not the full source. This semantic bound is not applied to stored document content: full stored text remains available for full-text/literal matching. Index version `hybrid-full-1` refreshes older derived documents to that representation. Source snapshots and original durable records carry their own evidence. Status exposes the semantic excerpt scope. [Ollama embedding API](https://docs.ollama.com/api/embed)

Model changes require re-embedding with the same model for documents and questions; equal vector dimensions alone do not establish a compatible embedding space. No chunk aggregation or long-document semantic coverage is claimed.

Retrieved text is contextual evidence. A similar historical repair, human acknowledgement or model summary cannot prove that a current fault is resolved. Exact nearest-neighbour search means exact vector-distance ranking, not perfect relevance or correct diagnosis. Current database observations, policy checks and verified action receipts retain authority. Search output is not permission to execute SQL.
