import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function readMigrations(directory) {
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".sql"));
  const migrations = files
    .map((filename) => {
      const match = filename.match(/^(\d{3,})-[a-z0-9-]+\.sql$/);
      if (!match)
        throw new Error(
          `Migration filename must have a numeric prefix: ${filename}`,
        );
      const version = Number(match[1]);
      if (!Number.isSafeInteger(version) || version < 1)
        throw new Error(`Invalid migration version: ${filename}`);
      // Canonical LF keeps the same immutable migration checksum on Windows and Unix.
      const sql = fs
        .readFileSync(path.join(directory, filename), "utf8")
        .replace(/^\uFEFF/, "")
        .replace(/\r\n/g, "\n");
      return {
        version,
        filename,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    })
    .sort((a, b) => a.version - b.version);
  if (!migrations.length) throw new Error("No SQL migrations were found");
  if (new Set(migrations.map((m) => m.version)).size !== migrations.length)
    throw new Error("Duplicate migration version");
  return migrations;
}

export function pendingMigrations(migrations, applied) {
  const byVersion = new Map(
    migrations.map((migration) => [migration.version, migration]),
  );
  const appliedVersions = new Set();
  let highest = 0;
  for (const row of applied) {
    const version = Number(row.version);
    const current = byVersion.get(version);
    if (!current)
      throw new Error(
        `Applied migration ${row.filename} is missing from this checkout`,
      );
    if (current.filename !== row.filename || current.checksum !== row.checksum)
      throw new Error(
        `Applied migration ${current.filename} has changed. Restore it and add a new numbered migration instead.`,
      );
    appliedVersions.add(version);
    highest = Math.max(highest, version);
  }
  const pending = migrations.filter(
    (migration) => !appliedVersions.has(migration.version),
  );
  if (pending.some((migration) => migration.version < highest))
    throw new Error(
      "A pending migration precedes an applied version; out-of-order upgrades are refused",
    );
  return pending;
}
