# Fleet monitoring and bounded maintenance

## Supported connection model

Add PostgreSQL 14 or later endpoints from Connections. Supported provider labels are self-managed, Amazon RDS, Aurora PostgreSQL, Azure, Google Cloud, OCI and generic PostgreSQL. These labels do not implement a provider control plane or certify a particular cloud service. Configure private routing, firewall rules, database credentials and certificate authorities separately.

A cluster has one declared primary and up to 19 additional endpoints, or a replica-only connection set. Verdant checks `pg_is_in_recovery()` and reports a discrepancy with the declared role. A managed writer/reader endpoint can behave differently from a direct physical-server endpoint. The same database exposed through multiple endpoints must be registered carefully to avoid double-counting it as independent clusters.

TLS certificate/hostname verification (`verify-full`) is the default. `require` encrypts without authenticating endpoint identity; `disable` is intended for explicit local testing. Both create a posture finding. Saved passwords and optional CA bundles are encrypted with the installation's credential key.

## Collected measurements

| Area | Measurements and evidence | Limits |
| --- | --- | --- |
| Availability | Successful basic probe, server version, recovery role, latest sample age | A stale successful sample does not imply current health |
| Sessions | Cluster-wide client connections/max_connections, blocked sessions, long/idle transactions, waits | Other-session details require monitoring privileges |
| Database | Size, cache hit ratio, commits/rollbacks and transaction-rate deltas, deadlock changes | First/reset/decreasing-counter samples produce unknown rates |
| Replication | Physical sender WAL distance/replay lag; receiver and local replay backlog when exposed | Replica local backlog excludes transport lag; no transaction-age substitute for latency |
| Statements | Optional top cumulative `pg_stat_statements` fingerprints | Not individual executions or proof of a recent latency regression |
| Tables/indexes | Estimated live/dead rows, modifications, analyze/vacuum timestamps, scans and index size | Estimates are not exact bloat measurements or safe index-drop instructions |
| Security | Login-role flags, monitoring-login posture, configured TLS mode | Authentication failures, attacks and audit logs are not ingested |
| Capabilities | Per-collector success, missing extension/permission reasons | Unsupported metrics remain unknown rather than zero |

Disable SQL text capture in a cluster's advanced settings if query text is sensitive. Future observations retain fingerprints/counters with text omitted. Previously retained evidence is preserved; a capture-policy change is not a historical erasure operation.

## Findings, reviews and memory

Fresh observations open or update incidents with cluster/endpoint-specific fingerprints. A successful contrary observation resolves them; failed collectors cannot establish recovery. Human review completion records feedback and keeps an unresolved condition open. An investigation review is queued once per recurrence generation, so repeatedly observing the same acknowledged condition does not recreate the same task every interval.

The selected chat provider can investigate a fresh external finding with bounded read tools for activity, queries, tables, replication, security and cluster-scoped memory. Run/step records retain the actual provider and model. Narrative and recommendations are labeled unverified. These tools grant no remote SQL write authority. Invalid model calls, timeout or provider changes end the investigation safely while SQL monitoring continues.

Memory search combines mandatory cluster/date/keyword filters with lexical and semantic ranking. Select All clusters to search across the fleet or select a cluster to restrict both structured and semantic results. SQL evidence comes from retained observations or linked receipts, with timestamps and provenance.

## Optional statistics maintenance

External clusters default to monitoring/review only. Optional `ANALYZE` requires all of:

- A separate non-administrative executor login.
- The exact supported `verdant_ops.analyze_table(text,text)` helper, owned by a non-superuser table owner, with a protected schema and allowlist.
- An explicit application table allowlist and successful helper/grant verification.
- Approval for the exact action, unless bounded automatic analyze is explicitly enabled for the cluster.
- A current lease, unchanged connection configuration, current policy/budget and fresh stale-statistics evidence immediately before dispatch.

The generated optional SQL section must run as the non-superuser owner of the allowlisted tables; the monitoring section can run as the platform's permitted login/grant administrator. Provider administrators may need to adapt supported role grants. Verdant does not grant itself superuser or install helpers automatically.

Receipts retain before/after evidence, actor, attempts and verification. Approval and post-action acknowledgement produce distinct feedback memories. A reported failure requires investigation. Crash recovery allows at most two bounded attempts and rechecks current evidence; control and target databases do not share a distributed transaction.

## Operating limits

- Up to 50 nondeleted clusters, 1–20 endpoints each. Test collection overhead against the intended fleet size.
- Four clusters collected concurrently; endpoints within each cluster are collected sequentially. Cadence is a scheduling target, not a guarantee under slow/unreachable endpoints.
- Per-cluster interval 10–300 seconds, default 30. Connect/query/server-statement limits are 4/5/4 seconds; an endpoint has a 15-second overall collection bound.
- Numeric history: 1–90 days, default 14, capped at 20,000 samples per endpoint. Charts show the latest 240 samples per endpoint from 24 hours. Raw detailed observations retain three days.
- Detailed snapshots are bounded to 100 tables, 100 indexes, 20 statements and 200 login roles.
- Maintenance: up to 25 allowlisted tables, 0–10 actions/hour per cluster, default 2; approval is the default and automatic analyze requires explicit opt-in.

The deployment is a single control plane, not a multi-tenant service. See [production deployment](PRODUCTION.md) for operational prerequisites and [validation](VALIDATION.md) for the actual tested environments.
