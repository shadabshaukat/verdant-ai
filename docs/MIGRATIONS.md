# Database migrations

Numbered SQL files under `db/control` are the authoritative schema history. `npm start` applies pending migrations before starting the console and worker. `npm run migrate` applies them explicitly.

## Upgrade an existing installation

1. Back up the control database and its matching `.secrets` directory. Preserve model and workload volumes if their contents matter.
2. Review the changelog and `.env.example`. Keep your local `.env` and existing credentials.
3. Run `npm run setup` to add new platform access files without replacing existing database credentials.
4. Run `npm run migrate`, then `npm start`.
5. Verify `/healthz`, worker heartbeat, cluster freshness and a read-only connection test. Existing incidents, outcomes, reviews and memory must remain present.

The migration runner obtains a PostgreSQL advisory lock and records each filename and SHA-256 checksum in an administrator-owned ledger. Each new migration executes in a transaction as the non-superuser control role. A changed applied migration, missing applied file or out-of-order migration is rejected. Add a new numbered migration instead of editing one already deployed.

## First adoption of an older database

Earlier Verdant versions used repeatable initialization scripts. On an unversioned database, migrations 001–003 are idempotent and are adopted once into the checksum ledger. Existing rows use their original identifiers. Later migrations add fleet inventory, model profiles and audit records. Credential values in retained PostgreSQL roles are never silently rotated.

PostgreSQL's image initializes only the database. A separate Node migration service manages application schema evolution on both new and retained volumes. A TCP health check waits for the permanent server rather than mistaking the image's temporary initialization server for a ready database.

## Recovery

Do not edit the ledger to bypass a mismatch or rerun a partial manual deployment. Restore the expected migration source, or restore the database and matching credential files from backup. Automatic down migrations are intentionally absent; schema rollback is a restore operation. A control-store backup without its original credential encryption key cannot recover saved remote passwords or model credentials.

See [operations](OPERATIONS.md) for backup commands and [contributing](../CONTRIBUTING.md) for migration review requirements.
