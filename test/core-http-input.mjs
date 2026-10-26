import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readJsonBody } from "../apps/server/http-input.mjs";
test("HTTP JSON parsing preserves Unicode credentials split between network chunks", async () => {
  const value = { name: "データベース", password: "päss🔑word" }, bytes = Buffer.from(JSON.stringify(value));
  assert.deepEqual(await readJsonBody(Readable.from([...bytes].map(byte => Buffer.from([byte])))), value);
  await assert.rejects(readJsonBody(Readable.from([bytes]), 10), error => error.statusCode === 413);
  for (const text of ["null", "[]", "true", "{invalid}"]) await assert.rejects(readJsonBody(Readable.from([Buffer.from(text)])), error => error.statusCode === 400);
});
