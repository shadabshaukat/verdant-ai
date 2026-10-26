# Operating Verdant

## Start, sign in and stop

Run from the repository root on macOS, Linux or Windows:

```text
npm run setup
npm start
npm run status
```

Open `http://127.0.0.1:8090` and enter the access token from `.secrets/admin_token`. Do not paste that token into issue reports or logs. `npm stop` stops this Compose project while preserving database and model volumes. Bundled Ollama stops with the project; an external native Ollama process is managed separately.

The default scenario deployment contains a workload primary, real physical standby, separate PostgreSQL/pgvector control store, migration service, console and worker. Only the console port is published. See [configuration](CONFIGURATION.md) for external Ollama and [production deployment](PRODUCTION.md) for a control plane without scenario databases.

## Add and inspect a cluster

1. Sign in as an administrator and open Connections.
2. Add a cluster with its provider label and primary/replica endpoints. An endpoint is a PostgreSQL database connection, not cloud control-plane credentials.
3. Open the generated SQL dialog. Review and run it as the appropriate database administrator, then set the monitoring password and TLS CA as required.
4. Test the connection and inspect its capability results. Save the cluster.
5. Select it from the context selector. View connections, activity, waits, replication, SQL, table/vacuum statistics and security posture. Expand details when needed.
6. Return to Fleet for aggregate health. Watch latest sample age: a missing or failed sample is never proof of a healthy database.

The worker discovers saved connections without a restart. Disabling or deleting a cluster stops its future monitoring; it retains historical incidents and evidence. Start with monitoring only. Add the optional bounded maintenance helper, separate executor credentials and explicit table allowlist only after reviewing their scope.

## Configure a chat model

Open Models and choose Ollama, OpenAI-compatible API, Amazon Bedrock or OCI Generative AI. Supply the provider-specific model, endpoint/region and authentication. Save the profile, test that exact saved revision, and activate it. Editing a profile invalidates its earlier test. A provider that responds with prose but cannot return native tool calls cannot pass the planner capability test.

The active profile affects agent planning. It does not change the embedding model or stored vector dimension. SQL evidence and selected memories may be sent to the active provider; choose the endpoint according to your data handling requirements.

## Conference scenarios

Select the built-in Demo context. Use one scenario at a time:

| Scenario | Injected condition | Bounded response |
| --- | --- | --- |
| Stale statistics | Changes to 10,000 synthetic order rows | Analyze the fixed demo table, then check fresh statistics |
| Replay paused | Pauses WAL replay on the physical standby | Resume that standby and verify receiver/replay/WAL evidence |
| Blocked query | Tagged fixture session holds a known row lock | End only the tagged fixture blocker and verify the wait clears |
| Risky role | Adds CREATEROLE to the fixed fixture login | Revoke that privilege on the fixed role |
| Missing index | Removes the fixed customer lookup index | Inspect the saved plan, create the fixed index and check its existence |

The scenario executor cannot target registered external clusters. Replay resume is not promotion/failover. A changed access path is not a measured latency improvement. Complete a review with a specific note; show that the feedback is present in memory and recalled in later investigations.

## Health and diagnostics

```text
npm run doctor
npm run logs
npm run models -- --check
npm run migrate
```

`/healthz` reports console/control-store readiness and worker heartbeat independently. Protected `/metrics` exposes fleet liveness for an authenticated scraper. The GUI shows per-endpoint capabilities and sample freshness. Model errors do not stop independent SQL monitoring; unavailable semantic embeddings leave keyword/structured search available.

The worker uses a durable lease and bounded pools. A graceful stop aborts outstanding model calls and drains active tasks before releasing the lease. Evidence, review decisions and action outcomes live in PostgreSQL, independent of the browser.

## Backups and upgrades

Back up both the control database and matching secret directory. The following POSIX example creates a PostgreSQL custom-format backup; use your platform's secure backup tooling for unattended operation:

```sh
docker compose exec -T control pg_dump -U postgres -d verdant -Fc > control.dump
```

Copy `.secrets/` securely alongside it, especially `credential_key`, and restrict access to both. Include workload/model volumes only when their contents are required. Do not add backups to Git. Test restoration into an isolated project before relying on a recovery plan.

Upgrade with `git pull --ff-only`, `npm run setup`, `npm run migrate`, and `npm start`. Setup preserves existing database credentials; it refuses to replace partial credential sets or invent passwords for retained volumes. Migrations verify checksums and preserve history. See [migrations](MIGRATIONS.md).

Never use `docker compose down --volumes` for routine stops. It removes the selected project's database history.

## Validation commands

`npm run integration` checks actual replication, separated roles, readiness, authenticated state and operator controls. `npm run integration:full` also injects the statistics scenario and checks a verified action, acknowledgement, durable feedback and idempotent review retry. Run scenario tests only against the bundled scenario databases. Fleet and model contract tests use isolated records and explicitly configured test endpoints.
