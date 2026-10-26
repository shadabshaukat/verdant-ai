import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { readMigrations, pendingMigrations } from "./migrations.mjs";

const defaultDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../db/control",
);
const lockKey = "verdant-control-schema-migration";

function password(file) {
  let value;
  try {
    value = fs.readFileSync(file, "utf8").trim();
  } catch {
    throw new Error("Required migration credential file is unreadable");
  }
  if (!value) throw new Error("Required migration credential file is empty");
  return value;
}

async function bootstrap(client, controlPassword) {
  const role = (
    await client.query(
      "SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='verdant_control'",
    )
  ).rows[0];
  if (!role) {
    const statement = (
      await client.query(
        "SELECT format('CREATE ROLE verdant_control LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text) AS sql",
        [controlPassword],
      )
    ).rows[0].sql;
    await client.query(statement);
  } else if (Object.values(role).some(Boolean))
    throw new Error(
      "Existing verdant_control role has unexpected administrative privileges",
    );
  await client.query(
    "GRANT CONNECT, CREATE ON DATABASE verdant TO verdant_control",
  );
  await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await client.query(
    "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public",
  );
  await client.query(`CREATE TABLE IF NOT EXISTS public.verdant_schema_migration (
    version integer PRIMARY KEY,
    filename text NOT NULL UNIQUE,
    checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    execution_ms integer NOT NULL CHECK (execution_ms >= 0)
  )`);
  const owner = (
    await client.query(
      "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='public.verdant_schema_migration'::regclass",
    )
  ).rows[0].owner;
  if (owner !== "postgres")
    throw new Error("The schema migration ledger must be owned by postgres");
  await client.query(
    "REVOKE ALL ON public.verdant_schema_migration FROM PUBLIC, verdant_control",
  );
}

export async function migrate({
  directory = defaultDirectory,
  env = process.env,
  log = console.log,
} = {}) {
  const migrations = readMigrations(directory);
  const client = new pg.Client({
    host: env.CONTROL_HOST || "control",
    port: Number(env.CONTROL_PORT || 5432),
    database: "verdant",
    user: "postgres",
    password: password(
      env.POSTGRES_PASSWORD_FILE || "/run/secrets/postgres_password",
    ),
    connectionTimeoutMillis: 10000,
    application_name: "verdant-migrate",
  });
  const controlPassword = password(
    env.CONTROL_PASSWORD_FILE || "/run/secrets/control_password",
  );
  let locked = false;
  try {
    await client.connect();
    await client.query("SET lock_timeout='60s'");
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
      lockKey,
    ]);
    locked = true;
    await bootstrap(client, controlPassword);
    const applied = (
      await client.query(
        "SELECT version,filename,checksum FROM public.verdant_schema_migration ORDER BY version",
      )
    ).rows;
    const pending = pendingMigrations(migrations, applied);
    for (const migration of pending) {
      const started = Date.now();
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL ROLE verdant_control");
        await client.query(migration.sql);
        await client.query("RESET ROLE");
        await client.query(
          "INSERT INTO public.verdant_schema_migration(version,filename,checksum,execution_ms) VALUES($1,$2,$3,$4)",
          [
            migration.version,
            migration.filename,
            migration.checksum,
            Date.now() - started,
          ],
        );
        await client.query("COMMIT");
        log(`Applied ${migration.filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration ${migration.filename} rolled back: ${error.message}`,
        );
      }
    }
    log(
      pending.length
        ? `Schema ready; ${pending.length} migration(s) applied.`
        : "Schema ready; no pending migrations.",
    );
    return pending.map((migration) => migration.filename);
  } finally {
    if (locked)
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lockKey])
        .catch(() => {});
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  migrate().catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
  });
