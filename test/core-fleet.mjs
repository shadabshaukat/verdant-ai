import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  validateCluster,
  normalizeFleetPolicy,
  fleetConnection,
  counterDeltas,
  loadFleetEnvironment,
  sqlIdentifier,
  sqlLiteral,
} from "../apps/server/fleet-validation.mjs";
import { readMaintenanceStats } from "../apps/server/fleet-maintenance.mjs";
import { bootstrapSql, ANALYZE_BODY } from "../apps/server/fleet-bootstrap.mjs";
import {
  detectFleetFindings,
  hasPositiveRecovery,
} from "../apps/server/fleet-findings.mjs";
import {
  publicCluster,
  publicEndpoint,
} from "../apps/server/fleet-registry.mjs";
const body = () => ({
  name: "Production test",
  provider: "generic",
  endpoints: [
    {
      role: "primary",
      host: "db.example.test",
      database: "workload",
      username: "monitor",
      password: "secret value",
    },
  ],
});
test("fleet TLS verifies CA and the configured hostname by default; URLs and caller-owned IDs rejected", () => {
  assert.throws(
    () => validateCluster({ ...body(), endpoints: [null] }),
    (error) => error.statusCode === 400,
  );
  const cluster = validateCluster(body()),
    c = fleetConnection(cluster.endpoints[0]);
  assert.equal(c.ssl.rejectUnauthorized, true);
  assert.equal(typeof c.ssl.checkServerIdentity, "function");
  assert.match(c.options, /default_transaction_read_only=on/);
  assert.throws(
    () =>
      validateCluster({
        ...body(),
        endpoints: [{ ...body().endpoints[0], id: randomUUID() }],
      }),
    /assigned/,
  );
  assert.throws(
    () =>
      validateCluster({
        ...body(),
        endpoints: [{ ...body().endpoints[0], host: "postgres://host" }],
      }),
    /Host/,
  );
});
test("fleet edit preserves omitted encrypted credential fields and rejects foreign endpoint IDs", () => {
  const c = validateCluster(body()),
    e = c.endpoints[0];
  e.caCertificate =
    "-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----";
  const edited = validateCluster(
    { ...body(), endpoints: [{ id: e.id, name: "Updated" }] },
    c,
  );
  assert.equal(edited.endpoints[0].password, e.password);
  assert.equal(edited.endpoints[0].caCertificate, e.caCertificate);
  assert.throws(
    () =>
      validateCluster(
        {
          ...body(),
          endpoints: [{ ...body().endpoints[0], id: randomUUID() }],
        },
        c,
      ),
    /belong/,
  );
});
test("fleet maintenance is opt-in with separate executor, explicit allowlist, and bounded knobs", () => {
  assert.throws(() => normalizeFleetPolicy({ autoAnalyze: true }), /requires/);
  assert.throws(
    () => normalizeFleetPolicy({ allowAnalyze: true }),
    /allowlist/,
  );
  assert.throws(
    () => normalizeFleetPolicy({ monitorIntervalSeconds: 1 }),
    /interval/,
  );
  const b = body();
  b.policy = {
    allowAnalyze: true,
    tableAllowlist: [{ schema: "app", table: "orders" }],
  };
  assert.throws(() => validateCluster(b), /separate executor/);
  b.actionCredentials = { username: "monitor", password: "secret" };
  assert.throws(() => validateCluster(b), /separate/);
  b.actionCredentials.username = "executor";
  const c = validateCluster(b);
  assert.equal(c.policy.autoAnalyze, false);
  assert.throws(
    () => loadFleetEnvironment({ FLEET_HISTORY_DAYS: "91" }),
    /between/,
  );
});
test("counter deltas reject reset/decrease/unknown baseline instead of inventing zero", () => {
  const a = {
      commits: 10,
      rollbacks: 1,
      deadlocks: 0,
      statsReset: "2026-01-01",
    },
    b = { ...a, commits: 30, rollbacks: 3, deadlocks: 1 };
  const result = counterDeltas(
    a,
    b,
    "2026-01-02T00:00:00Z",
    "2026-01-02T00:00:10Z",
  );
  assert.equal(result.transactionsPerSecond, 2.2);
  assert.equal(result.deadlocksSinceLastSample, 1);
  for (const next of [
    { ...b, statsReset: "reset" },
    { ...b, commits: 0 },
    { ...b, commits: null },
    null,
  ])
    assert.equal(
      counterDeltas(a, next, "2026-01-02", "2026-01-03").transactionsPerSecond,
      null,
    );
});
test("bootstrap quotes identifiers and literals and never emits supplied passwords", () => {
  assert.equal(sqlIdentifier('a"b'), '"a""b"');
  assert.equal(sqlLiteral("a'b"), "'a''b'");
  const b = body();
  b.endpoints[0].username = 'monitor"x';
  b.endpoints[0].password = "DO-NOT-PRINT";
  const result = bootstrapSql(b);
  assert.match(result.sql, /GRANT pg_monitor TO "monitor""x"/);
  assert.ok(!result.sql.includes("DO-NOT-PRINT"));
  b.policy = {
    allowAnalyze: true,
    tableAllowlist: [{ schema: "app", table: "order's" }],
  };
  b.actionCredentials = { username: "executor", password: "ANOTHER-SECRET" };
  const helper = bootstrapSql(b);
  assert.ok(helper.sql.includes(ANALYZE_BODY));
  assert.ok(helper.sql.includes("'order''s'"));
  assert.ok(!helper.sql.includes("ANOTHER-SECRET"));
  assert.match(ANALYZE_BODY, /ANALYZE %I\.%I/);
  assert.match(helper.sql, /REVOKE ALL ON FUNCTION/);
});
function snapshot() {
  return {
    at: "2026-10-26T00:00:00Z",
    status: "healthy",
    monitorUser: "monitor",
    metrics: {
      connectionUtilizationPercent: 10,
      blockedSessions: 0,
      longTransactions: 0,
      idleTransactions: 0,
      replicationLagBytes: null,
      replicationLagSeconds: null,
      replicationReplayPaused: null,
      deadlocksSinceLastSample: null,
    },
    capabilities: {
      basic: { available: true },
      tables: { available: true },
      queries: { available: true },
    },
    details: {
      tables: [],
      blockers: [],
      longTransactions: [],
      replication: { senders: [] },
      security: { roles: [] },
    },
    queries: [],
  };
}
test("unknown replication and missing bounded table rows do not prove recovery", () => {
  const s = snapshot();
  assert.equal(hasPositiveRecovery({ kind: "replication_backlog" }, s), false);
  assert.equal(hasPositiveRecovery({ kind: "replication_paused" }, s), false);
  assert.equal(
    hasPositiveRecovery(
      {
        kind: "stale_statistics",
        evidence: { table: { schema: "old", table: "omitted" } },
      },
      s,
    ),
    false,
  );
  assert.equal(
    detectFleetFindings({ targetId: "fleet:test", sslMode: "verify-full" }, s)
      .length,
    0,
  );
});
test("performance findings retain directly associated SQL and label cumulative scope", () => {
  const s = snapshot();
  s.queries = [
    {
      queryId: "q1",
      query: "SELECT 1",
      meanMs: 1500,
      calls: 4,
      scope: "Cumulative since reset",
    },
  ];
  const findings = detectFleetFindings(
    { targetId: "fleet:test", sslMode: "verify-full" },
    s,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].evidence.query.query, "SELECT 1");
  assert.match(findings[0].summary, /not a measured recent regression/);
  s.status = "unavailable";
  assert.equal(
    detectFleetFindings({ targetId: "fleet:test" }, s)[0].kind,
    "endpoint_unavailable",
  );
});
test("public fleet responses expose configuration flags without ciphertext or secret material", () => {
  const e = {
    endpoint_id: randomUUID(),
    name: "Primary",
    role: "primary",
    monitor_secret: "CIPHERTEXT",
    has_ca: true,
    enabled: true,
    snapshot: { status: "healthy" },
    password: "plaintext",
  };
  const endpoint = publicEndpoint(e);
  const cluster = publicCluster(
    {
      cluster_id: randomUUID(),
      name: "Prod",
      provider: "generic",
      enabled: true,
      action_secret: "OTHER-CIPHERTEXT",
    },
    [e],
  );
  for (const result of [endpoint, cluster]) {
    assert.ok(!JSON.stringify(result).includes("CIPHERTEXT"));
    assert.ok(!JSON.stringify(result).includes("plaintext"));
  }
  assert.equal(endpoint.hasPassword, true);
  assert.equal(cluster.monitorOnly, true);
});

test("bootstrap dollar-quoted blocks cannot be closed by caller-controlled role names", () => {
  const b = body();
  b.endpoints[0].username = "x$verdant_role$; SELECT 'injection'; --";
  b.policy = {
    allowAnalyze: true,
    tableAllowlist: [{ schema: "public", table: "safe" }],
  };
  b.actionCredentials = {
    username: "exec$verdant_owner$; SELECT 'injection'; --",
    password: "secret",
  };
  const generated = bootstrapSql(b).sql;
  assert.ok(generated.startsWith("SET standard_conforming_strings=on;"));
  const tags = [...generated.matchAll(/DO (\$verdant_[a-f0-9]+\$) BEGIN/g)].map(
    (m) => m[1],
  );
  assert.equal(tags.length, 2);
  for (const tag of tags) {
    assert.ok(!JSON.stringify(b).includes(tag));
    assert.equal(generated.split(tag).length - 1, 2);
  }
});

test("maintenance rejects fresh-counter proof when collection is off or endpoint became replica", async () => {
  const row = {
    trackCounts: "on",
    inRecovery: false,
    modificationsSinceAnalyze: 0,
  };
  const c = {
    query: async (sql, parameters) => {
      assert.match(sql, /WHERE schemaname=\$1 AND relname=\$2/);
      assert.deepEqual(parameters, ["public", "table"]);
      return { rows: [row] };
    },
  };
  assert.equal(
    (await readMaintenanceStats(c, "public", "table"))
      .modificationsSinceAnalyze,
    0,
  );
  row.trackCounts = "off";
  await assert.rejects(
    () => readMaintenanceStats(c, "public", "table"),
    /unavailable/,
  );
  row.trackCounts = "on";
  row.inRecovery = true;
  await assert.rejects(
    () => readMaintenanceStats(c, "public", "table"),
    /recovery/,
  );
});
