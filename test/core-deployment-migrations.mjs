import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readMigrations, pendingMigrations } from "../scripts/migrations.mjs";

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verdant migrations "));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("migration checksums and ordering are stable across Windows/Unix line endings", (t) => {
  const dir = directory(t);
  fs.writeFileSync(path.join(dir, "002-next.sql"), "SELECT 2;\r\n");
  fs.writeFileSync(path.join(dir, "001-initial.sql"), "SELECT 1;\r\n");
  const windows = readMigrations(dir);
  fs.writeFileSync(path.join(dir, "001-initial.sql"), "SELECT 1;\n");
  assert.deepEqual(readMigrations(dir), windows);
  assert.deepEqual(
    windows.map((m) => m.version),
    [1, 2],
  );
  assert.equal(pendingMigrations(windows, windows).length, 0);
  assert.deepEqual(
    pendingMigrations(windows, windows.slice(0, 1)).map((m) => m.version),
    [2],
  );
});

test("applied SQL drift, missing history and out-of-order upgrades fail closed", (t) => {
  const dir = directory(t);
  fs.writeFileSync(path.join(dir, "001-initial.sql"), "SELECT 1;\n");
  fs.writeFileSync(path.join(dir, "002-next.sql"), "SELECT 2;\n");
  const migrations = readMigrations(dir);
  assert.throws(
    () =>
      pendingMigrations(migrations, [
        { ...migrations[0], checksum: "0".repeat(64) },
      ]),
    /has changed/,
  );
  assert.throws(
    () =>
      pendingMigrations(migrations, [
        { version: 3, filename: "003-missing.sql" },
      ]),
    /missing/,
  );
  assert.throws(
    () => pendingMigrations(migrations, [migrations[1]]),
    /out-of-order/,
  );
});

test("duplicate numeric versions and unnumbered SQL are rejected", (t) => {
  const dir = directory(t);
  fs.writeFileSync(path.join(dir, "001-one.sql"), "SELECT 1;");
  fs.writeFileSync(path.join(dir, "001-two.sql"), "SELECT 2;");
  assert.throws(() => readMigrations(dir), /Duplicate/);
  fs.rmSync(path.join(dir, "001-two.sql"));
  fs.writeFileSync(path.join(dir, "untracked.sql"), "SELECT 3;");
  assert.throws(() => readMigrations(dir), /numeric prefix/);
});
