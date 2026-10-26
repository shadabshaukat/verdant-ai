# Contributing to Verdant DBA

Thank you for helping improve PostgreSQL operations with transparent, supervised agents.

## Start here

- Use issues for reproducible defects and focused feature proposals.
- Read the [README](README.md), [operating guide](docs/OPERATIONS.md) and [security policy](SECURITY.md).
- Discuss new remediation tools or changes to the trust boundary before implementing them.
- Keep pull requests focused on one problem and describe the resulting behavior.

## Development environment

Use Node.js 22 or later and Docker with Compose v2 and Linux containers. The setup commands work in PowerShell, Command Prompt and POSIX shells:

```text
git clone https://github.com/shadabshaukat/verdant-ai.git
cd verdant-ai
npm ci
npm run setup
npm run check
npm test
```

Configure the ignored `.env` file before starting the stack. Keep generated `.secrets/` files with their matching database volumes. Do not commit credentials, database dumps, model weights or local `.env` files.

## Working on the application

- Server and worker: `apps/server/`.
- Browser application: `apps/web/`.
- Container deployment and launcher: `compose*.yaml`, `Dockerfile`, `scripts/`.
- Control-state schema: `db/control/`.
- Target database bootstrap and bounded helpers: `db/primary/`, `db/standby/`.
- Pure and local integration tests: `test/`.

Use platform-neutral Node APIs for host tooling, `fileURLToPath()` for file URLs and `path` utilities for filesystem paths. Container-only shell scripts run inside Linux images. Preserve LF line endings; `.gitattributes` handles Windows checkouts.

Follow the surrounding JavaScript style. Keep functions small enough to review, name operational states explicitly and prefer fixed parameterized SQL over dynamic query construction. Avoid formatting unrelated files in a functional change.

## Database migrations

Add a new numbered SQL file for each control-schema change. Never edit an applied migration: the deployment runner records a SHA-256 checksum and rejects changed history. Keep migrations forward-only, transactional and compatible with existing records. New application tables belong to `verdant_control`; administrator extension setup remains in the migration runner.

Verify a fresh control database and an upgrade against existing state. A normal stop/start must preserve observations, reviews, actions and memory. Include recovery instructions when a migration changes an operational invariant.

## Agent and retrieval invariants

- Models select typed tools; they never receive arbitrary SQL execution authority.
- Policy, target, incident generation and current evidence must gate each action.
- A successful historical action does not establish current health.
- Human approval and acknowledgement create distinct, idempotent memories.
- Unknown replication state is not zero lag.
- Search must apply mandatory dates and literal filters before semantic ranking.
- SQL evidence needs recorded provenance; shared incident identity alone cannot link a later repair to an older event.
- Missing embeddings stay unavailable, with an explicit fallback status.

## Validation

Run `npm run check` and `npm test` for every code change. For changes affecting the deployed application, start the stack and run the relevant integration test described in [VALIDATION.md](docs/VALIDATION.md). Workload scenarios mutate the reference databases; coordinate them with other users of that environment.

For UI changes, check desktop and mobile widths, keyboard navigation, empty and error states, long SQL text and preservation of forms during live polling. Prefer concise summaries with evidence available on demand.

## Pull requests

Explain the concrete problem, the resulting behavior and the checks you ran. Include screenshots for visible changes and migration notes for schema changes. Mark validation you could not run. Maintainers may request a narrower scope or additional evidence before merging.

Contributions are provided under the project's [Apache 2.0 license](LICENSE). Do not include material you lack permission to contribute.
