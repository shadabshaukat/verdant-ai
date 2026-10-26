# Verdant operating guide

## Start and stop

Pull both local models, then run from the repository root:

```sh
ollama pull qwen3:4b-instruct-2507-q4_K_M
ollama pull nomic-embed-text:v1.5
./scripts/demo.sh doctor
./scripts/demo.sh start
./scripts/demo.sh status
```

Open `http://127.0.0.1:8090`. The browser, local models, control database and target databases do not require any hosted service.

`OLLAMA_MODEL` selects the chat/planning model and `OLLAMA_EMBED_MODEL` selects the embedding model. The search schema currently requires 768-dimensional embeddings from a consistent model space. See [HYBRID-SEARCH.md](HYBRID-SEARCH.md).

`./scripts/demo.sh stop` stops this Compose project and preserves all three named database volumes. It does not stop Ollama or remove previous conference demos. Avoid `docker compose down -v` unless intentionally discarding this lab's monitoring history and target data.

## Deployment topology

- `primary`: PostgreSQL 18.4, database `workload`, 75,000 synthetic orders.
- `standby`: an actual physical streaming replica made with `pg_basebackup`.
- `control`: PostgreSQL 18.4 plus pgvector 0.8.7, database `verdant`, schema `agent`, owned by a non-superuser role.
- `migrate`: one-shot administrator extension setup and schema migrations; the API/worker wait for successful completion.
- `app`: dashboard/API, bound only to localhost port 8090.
- `worker`: independent background observation and model-directed investigation/remediation loop.

Only the web port is published. PostgreSQL stays on the internal Compose network. Secrets are generated into ignored `.secrets/` files and are never included in source archives. The runtime reads the secret mounts to construct internal database connection URLs; the browser receives no database credentials.

## Conference scenarios

Use one fixture at a time so the audience can follow the incident:

1. **Stale statistics:** mutate 10,000 rows of `app.orders`. The monitor records the changed-row evidence, the model can inspect it, and the bounded executor can `ANALYZE` that one table. Open the resulting action and before/after evidence.
2. **Standby replay paused:** pause WAL replay on the actual standby. The heartbeat continues on the primary. The model can inspect replay status/WAL evidence, resume the known standby, then verify catch-up. This is not promotion or a failover test.
3. **Blocked query:** open a fixture transaction as `verdant_demo` with `application_name=verdant-demo-blocker`, hold the known order-row lock and create a waiting query. The allowed remediation can terminate only those tagged fixture sessions. The fixture also has a timeout.
4. **Risky role:** grant `CREATEROLE` to the fixed fixture login `verdant_risky_login`. The bounded repair revokes only that privilege on that exact role. No real user role is changed.
5. **Missing demo index:** drop only `app.orders_customer_id_idx`, run a bounded lookup workload, and inspect its query plan. The index tool creates that one index with an ordinary build. Show the measured before/after access paths, and distinguish them from cumulative query averages.

Complete a review with a concrete note, for example “Verified the standby caught up. Investigate connectivity before resuming if this recurs.” The review and memory should both show the note. Later planning runs retrieve durable feedback; this is contextual memory, not model weight training.

## Continuous operation

The worker has an independent polling loop and a durable control store. It continues while the page is closed. `restart: unless-stopped` brings services back after Docker restarts, subject to the host being on and Docker/Ollama running. Pause agent actions with the dashboard before maintenance; observe the policy/event history. Approval settings and the action budget apply at execution time, not just when a model proposes work.

Use `docker compose logs --tail=100 worker` to inspect planner degradation or failed connections. The agent must label model unavailability and retain monitoring evidence rather than inventing a model decision. A target being unavailable should produce an incident; it should not erase the last good sample or turn an unknown lag into zero.

The control database is separate from the monitored workload so target replay pause, blocking and tuning do not prevent the human console from storing reviews. All services are on one host in this lab, so it does not survive host loss.

## Inspect the database directly

These commands use the container's local administrator account for operator inspection. They are not the agent's credentials:

```sh
docker compose exec primary psql -U postgres -d workload -c "SELECT application_name,state,sync_state,replay_lag FROM pg_stat_replication"
docker compose exec standby psql -U postgres -d workload -c "SELECT pg_is_in_recovery(),pg_is_wal_replay_paused(),pg_last_wal_replay_lsn()"
docker compose exec control psql -U postgres -d verdant -c "SELECT * FROM agent.review ORDER BY created_at DESC LIMIT 10"
docker compose exec control psql -U postgres -d verdant -c "SELECT * FROM agent.memory ORDER BY created_at DESC LIMIT 10"
```

## Production expansion

Before using a production fleet, add authenticated operator identity, per-target policy/allowlists, TLS and network access controls, external alerting, audited change windows, a rollback strategy and evals against representative incidents. Add bounded adapters for backup freshness/PITR testing, disk/headroom metrics and authenticated PostgreSQL/security logs. Failover and global parameter changes need an external topology manager and explicit operational policy. This demo deliberately exposes none of those as arbitrary model tools.

## Process boundary in this lab

The database accounts are distinct and each target executor function has a fixed scope. The current Compose service wrapper mounts the same lab role secret files into both the API and worker containers, however. Each process can therefore construct the fixture-controller connection as well as its normal monitor/action pools. The model only sees the typed tool registry, but a compromised application process would have broader fixture authority. This is a deliberate local-lab packaging convenience, not production process-level least privilege. A production deployment should separate the fixture controller, remove its credentials from the worker entirely, give each process only its required secrets, and add authenticated operator identity.

## Live supervision regression

`node test/supervision.mjs` runs a real standby approval, target execution, acknowledgement and two separate feedback-memory checks, then a real tagged blocker repair. It mutates only disposable lab fixtures, retains history, closes validation reviews with explicit notes and restores broader lab autonomy. Its final hourly budget is 40 so a conference recording can repeat the scenarios; the fresh-install default remains 12. Reduce the live budget after the recent validation-attempt window expires. Do not run it while recording or operating other fixtures.

## Upgrade an existing lab volume

Fresh initialization reads all numbered control-schema SQL files. When reusing existing database volumes, preserve their matching `.secrets/` files: extracting this credential-free source archive and generating new passwords does not rotate roles in already-initialized databases. Use the normal start command for this additive upgrade:

```sh
./scripts/demo.sh start
```

This builds the pgvector-capable control image without changing the PostgreSQL major/minor base or deleting named volumes. The `migrate` service creates the extension as `postgres`, then applies each schema file in a transaction using `SET LOCAL ROLE verdant_control`. Application tables remain owned by the non-superuser role. Existing observations, actions, reviews and memory are retained; migration 003 adds the derived search corpus and indexes. The extension is enabled only in the control database. `docker compose logs migrate` shows the migration result.
