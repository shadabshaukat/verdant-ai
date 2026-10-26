# Verdant DBA

An autonomous PostgreSQL monitoring and remediation lab with a green operator console, a real primary/standby pair, model-directed tools and durable PostgreSQL memory.

Verdant observes database health continuously. Its local Ollama planner chooses investigations and bounded repairs, checks the resulting database state and records evidence. A human can steer its directive, pause work, review actions, require approvals and leave feedback that later runs recall.

## Run

Requirements: Docker Engine/Desktop with Compose v2, native Ollama, Node.js 22+ for host tests, OpenSSL and curl.

```sh
ollama pull qwen3:4b-instruct-2507-q4_K_M
ollama pull nomic-embed-text:v1.5
./scripts/demo.sh start
```

Open **http://127.0.0.1:8090**. On macOS, native Ollama uses the host's available CPU/GPU. Docker reaches it at `host.docker.internal:11434`. The first build needs registry access; subsequent starts use cached images and the local model.

```sh
./scripts/demo.sh status
./scripts/demo.sh logs
./scripts/demo.sh stop
```

Stop preserves monitoring history and all target data. The lab has its own Compose project and named volumes.

## What runs

| Component | Purpose |
| --- | --- |
| `control` | Dedicated PostgreSQL `agent` schema for observations, incidents, plans, actions, human reviews and memory |
| `primary` | Monitored PostgreSQL 18.4 workload with `pg_stat_statements` and synthetic data |
| `standby` | Actual asynchronous physical streaming replica |
| `worker` | Continuous monitor, local model tool loop, bounded executor and verifier |
| `app` | Live dashboard, incident/evidence console, human review queue and steering controls |

The control image includes pgvector 0.8.7, built on the same PostgreSQL 18.4 base. A one-shot migration service enables the extension and applies the numbered schema files before the API and worker start. The workload primary and standby do not need pgvector.

The default conference policy permits broader autonomy only inside the disposable fixture database: refresh statistics, resume paused replay, terminate the fixed-tag demo blocker, revoke `CREATEROLE` from one fixture role, and create one fixed demo index. Actions produce review acknowledgements. Policies can require approvals instead.

## PostgreSQL owns the evidence

The model cannot execute arbitrary SQL. Separate monitoring and execution roles are non-superusers. Fixed `SECURITY DEFINER` helpers have trusted search paths, no arbitrary SQL arguments, and explicit grants. The index example uses an ordinary build on a small fixture; it is not a zero-lock production tuning claim.

The demo performs real SQL and streaming replication. Sensor thresholds are deterministic. The model chooses tools from a bounded set and consumes their actual results. When the model is unavailable, the system must label degradation, continue monitoring and queue human investigation rather than claim a model-directed repair.

The security view reports role/privilege posture. It does not ingest authentication logs or claim attack detection. Query averages are cumulative `pg_stat_statements` values, not p95 or per-cycle latency.

## Hybrid search

The control database stores searchable source text and real local `nomic-embed-text:v1.5` vectors in `agent.search_document`. Retrieval combines PostgreSQL English full-text matching with exact cosine similarity, with source/date/category filters and provenance links. Missing embeddings remain visibly unavailable; they are not replaced with fabricated vectors. Search relevance does not prove a diagnosis or authorize a repair.

See [HYBRID-SEARCH.md](docs/HYBRID-SEARCH.md) for practical examples, schema inspection and limits. `OLLAMA_EMBED_MODEL` selects the embedding model; the current schema requires 768-dimensional vectors. Changing to a different embedding space requires a consistent re-embedding of the corpus.

## Demonstrate

Inject one scenario from the console, follow the agent's investigation and verified action, then complete its human review with a note. Inspect the durable memory and the next planning run's recalled feedback. Scenarios cover stale statistics, paused standby replay, a tagged blocker, risky fixture-role privileges and a fixed missing index.

See [OPERATIONS.md](docs/OPERATIONS.md) for the exact scenarios, shutdown, direct inspection and production expansion. See [RESEARCH.md](docs/RESEARCH.md) for primary-source research and design limits.

## Tests

```sh
npm ci
npm test
npm run integration
```

Integration tests require the stack running. They inspect actual database health and exercise dashboard controls/review persistence; they do not pretend to benchmark 24/7 production reliability.

## Scope

A working local reference for a conference, with persistent services and state. The host must remain awake with Docker and Ollama available. Production fleet onboarding, SSO, TLS across hosts, failover orchestration, backup/PITR drills, disk alerts, audit-log ingestion, alert channels and long-term retention require additional adapters and operational validation.

The local API and worker share the lab's Compose secret mounts. Typed model tools are scoped, but the processes are not isolated from fixture credentials. See the process-boundary note in [OPERATIONS.md](docs/OPERATIONS.md) before adapting this to a production fleet.
