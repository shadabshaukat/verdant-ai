# Research and design evidence

Reviewed 24 October 2026. This implementation uses community PostgreSQL 18 and local Ollama. It is a new implementation; it does not copy D-Bot or DB-GPT code, and their reported results are not results for Verdant.

## What makes this an autonomous DBA agent

A scheduled SQL threshold check is a monitor. An agent adds a model-directed loop that chooses its next investigation, consumes the returned observation, selects a bounded action or escalation, then checks the actual outcome. Verdant keeps those steps in PostgreSQL and retrieves earlier action outcomes and human feedback on later runs.

The [D-Bot research paper](https://arxiv.org/abs/2312.01454) describes database diagnosis using knowledge extraction, tool retrieval, root-cause analysis and search over possible diagnoses. It is evidence that tool-grounded LLM diagnosis is a real research direction, not evidence that unrestricted production remediation is solved. [DB-GPT](https://github.com/eosphoros-ai/DB-GPT) provides an open-source data-agent framework; Verdant uses a deliberately small custom runtime to keep its choices and database contracts visible in a conference demo.

[Anthropic's agent architecture discussion](https://www.anthropic.com/research/building-effective-agents) distinguishes predefined workflows from agents that dynamically direct their process and tool use. Verdant combines deterministic sensing and enforcement with model-selected investigation. The model is not the source of replication metrics, permissions or committed action results.

## PostgreSQL facts that change the design

| Topic | Design decision and source |
| --- | --- |
| Replication freshness | Read primary `pg_stat_replication`, standby recovery/WAL positions, and a replicated heartbeat together. A standby with no new transactions can have a `NULL` replay delay, so elapsed time since the last replayed transaction alone is not a lag alarm. [Statistics documentation](https://www.postgresql.org/docs/18/monitoring-stats.html) |
| Physical standby | Clone the target primary with `pg_basebackup`, run in recovery and stream actual WAL. Replication is asynchronous; zero byte lag at one sample is not a guarantee of zero future lag or zero data loss. [Standby documentation](https://www.postgresql.org/docs/18/warm-standby.html) |
| Query performance | `pg_stat_statements` aggregates planning/execution statistics by normalized query and user/database. The UI labels cumulative mean and total time; these values are not a p95 latency or a measurement for the last 15-second interval. [Extension documentation](https://www.postgresql.org/docs/18/pgstatstatements.html) |
| Stale statistics | `ANALYZE` refreshes planner statistics. The demo deliberately disables autovacuum on its fixture table so the agent has a reproducible maintenance condition. Disabling autovacuum is not a production recommendation. [ANALYZE](https://www.postgresql.org/docs/18/sql-analyze.html) |
| Query plans | Compare the actual `EXPLAIN (FORMAT JSON)` plan before and after creating one fixed index on the disposable `app.orders(customer_id)` table. A changed plan is evidence of changed access path, not a universal latency improvement claim. [EXPLAIN](https://www.postgresql.org/docs/18/sql-explain.html) |
| Index build | The fixed helper performs an ordinary index build on a small local fixture. Ordinary index creation blocks writes while building. `CREATE INDEX CONCURRENTLY` cannot run inside the helper's transaction, so this demonstration does not claim zero-lock online tuning. [CREATE INDEX](https://www.postgresql.org/docs/18/sql-createindex.html) |
| Restricted tools | Monitor and executor accounts are separate non-superuser roles. Narrow `SECURITY DEFINER` functions have a fixed search path and no caller-supplied SQL/object identifiers. Public execution is revoked. [Function security](https://www.postgresql.org/docs/18/sql-createfunction.html) |
| Session cancellation | Cancelling a query and terminating a session are different operations. The demo remediation terminates only sessions owned by the fixture account with the exact `verdant-demo-blocker` tag; it cannot terminate arbitrary application sessions. [Server signalling](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL) |
| Security posture | The implemented scan identifies privileged login-role posture. It is not failed-login, exfiltration or attack detection. Those require an authenticated audit/log pipeline and a threat model. [Roles and privileges](https://www.postgresql.org/docs/18/user-manag.html) |

## Scope and limits

The user-selected broad autonomy applies only to these disposable demo databases. The allowlisted changes are statistics refresh, standby replay resume, termination of the tagged demo blocker, revocation of `CREATEROLE` from one fixed fixture role, and a fixed index build. The application still records review acknowledgements and can require approval through policy.

A human marking a review completed adds memory and audit evidence. It must not erase an active observed fault or claim that an unverified repair succeeded. The agent must separately observe and verify the target state.

The services restart under Docker and persist their data in named volumes. This is an executable local reference, not an HA control plane or evidence of long-term production reliability. The host must remain awake with Docker and Ollama running. Multi-cluster identity, SSO/RBAC, secure remote connectivity, alert delivery channels, audit-log ingestion, backup/PITR drills, failover orchestration, retention/partition maintenance and production evals remain deployment work.

## Hybrid retrieval addition — 26 October 2026

[pgvector's official installation guide](https://github.com/pgvector/pgvector#installation) supports PostgreSQL 13 and later, including PostgreSQL 18. The control image builds the pinned `v0.8.7` source release on the existing PostgreSQL 18.4 base; the administrator enables the extension only in the control database. Existing database volumes and role passwords are preserved. The extension adds storage/distance operators; Ollama produces the embeddings.

The retrieval design combines PostgreSQL English full-text search with 768-dimensional Nomic embeddings. The [Nomic model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) specifies different document/query prefixes and supports 768-dimensional output. The [Ollama API](https://docs.ollama.com/api/embed) supplies real vectors locally. This design intentionally makes no claim based on the model author's benchmark scores.

For the small date-filtered lab corpus, semantic retrieval uses exact cosine distance. Approximate vector indexes can apply filters after candidate selection and return too few eligible rows; pgvector documents iterative scans and other scaling options. [Filtering guidance](https://github.com/pgvector/pgvector#filtering) explains that tradeoff. See [HYBRID-SEARCH.md](HYBRID-SEARCH.md) for schema inspection and practical limits.
