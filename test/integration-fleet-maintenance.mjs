// Opt-in test: creates an isolated database and dedicated roles on the disposable local primary.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { apiFetch } from "./api-client.mjs";
const cwd = fileURLToPath(new URL("..", import.meta.url)),
  base = process.env.BASE_URL || "http://127.0.0.1:8090";
const suffix = randomBytes(4).toString("hex"),
  database = "verdant_fleet_" + suffix,
  owner = "v_owner_" + suffix,
  monitor = "v_monitor_" + suffix,
  executor = "v_exec_" + suffix;
const monitorPassword = randomBytes(24).toString("hex"),
  executorPassword = randomBytes(24).toString("hex");
const qi = (s) => '"' + s.replaceAll('"', '""') + '"',
  ql = (s) => "'" + s.replaceAll("'", "''") + "'";
function sql(text, db = "postgres") {
  return execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "primary",
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      db,
      "-Atq",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { cwd, encoding: "utf8", input: text, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const r = await apiFetch(base + path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const result = await r.json();
  if (!r.ok)
    throw new Error(r.status + " " + path + ": " + JSON.stringify(result));
  return result;
}
async function until(fn, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Maintenance verification timed out");
}
let clusterId = null,
  dbCreated = false,
  rolesCreated = false;
try {
  sql(
    `CREATE ROLE ${qi(owner)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;CREATE ROLE ${qi(monitor)} LOGIN PASSWORD ${ql(monitorPassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;CREATE ROLE ${qi(executor)} LOGIN PASSWORD ${ql(executorPassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;GRANT pg_monitor TO ${qi(monitor)};ALTER ROLE ${qi(monitor)} SET default_transaction_read_only=on;`,
  );
  rolesCreated = true;
  sql(`CREATE DATABASE ${qi(database)} OWNER ${qi(owner)};`);
  dbCreated = true;
  sql(
    `SET ROLE ${qi(owner)};CREATE TABLE public.maintenance_probe(id bigint PRIMARY KEY,payload text) WITH(autovacuum_enabled=false);INSERT INTO public.maintenance_probe SELECT n,repeat('x',100) FROM generate_series(1,30000)n;ANALYZE public.maintenance_probe;`,
    database,
  );
  const draft = {
    name: "Isolated maintenance test " + suffix,
    provider: "self-managed",
    policy: {
      allowAnalyze: true,
      autoAnalyze: false,
      tableAllowlist: [{ schema: "public", table: "maintenance_probe" }],
      monitorIntervalSeconds: 10,
      maxActionsPerHour: 2,
      captureQueryText: false,
    },
    actionCredentials: { username: executor, password: executorPassword },
    endpoints: [
      {
        name: "Isolated database",
        role: "primary",
        host: "primary",
        port: 5432,
        database,
        username: monitor,
        password: monitorPassword,
        sslMode: "disable",
      },
    ],
  };
  const generated = await api("/api/clusters/bootstrap", draft);
  const optional = generated.sql.slice(
    generated.sql.indexOf("-- OPTIONAL MAINTENANCE SECTION"),
  );
  assert.ok(optional.startsWith("-- OPTIONAL"));
  sql(`SET ROLE ${qi(owner)};\n${optional}`, database);
  const denied = () =>
    sql(
      `SET ROLE ${qi(executor)};SELECT verdant_ops.analyze_table('public','unlisted');`,
      database,
    );
  assert.throws(
    denied,
    /Command failed/,
    "Helper must refuse non-allowlisted names",
  );
  const created = await api("/api/clusters", draft);
  clusterId = created.id;
  await until(async () => {
    const d = await api("/api/clusters/" + clusterId + "/dashboard");
    if (d.endpoints[0]?.capabilities?.maintenance?.available) return d;
    return null;
  });
  sql(
    `SET ROLE ${qi(owner)};UPDATE public.maintenance_probe SET payload=payload||'u' WHERE id<=10000;SELECT pg_stat_force_next_flush();`,
    database,
  );
  const waiting = await until(async () => {
    const d = await api("/api/clusters/" + clusterId + "/dashboard");
    return d.actions.find((a) => a.status === "pending_approval") ? d : null;
  });
  const action = waiting.actions.find((a) => a.status === "pending_approval"),
    review = waiting.reviews.find((r) => r.id === action.review_id);
  assert.ok(review);
  assert.equal(review.proposedAction.fleetActionId, action.fleet_action_id);
  assert.ok(
    Number(
      sql(
        "SELECT n_mod_since_analyze FROM pg_stat_user_tables WHERE relname='maintenance_probe'",
        database,
      ),
    ) > 1000,
    "Before approval target statistics must remain stale",
  );
  await api("/api/reviews/" + review.id, {
    decision: "approve",
    feedback:
      "Approve this exact allowlisted statistics action in the isolated disposable database.",
  });
  const verified = await until(async () => {
    const d = await api("/api/clusters/" + clusterId + "/dashboard");
    return d.actions.find(
      (a) =>
        a.fleet_action_id === action.fleet_action_id &&
        a.status === "succeeded",
    )
      ? d
      : null;
  });
  const receipt = verified.actions.find(
    (a) => a.fleet_action_id === action.fleet_action_id,
  );
  assert.ok(receipt.verified_at);
  assert.ok(receipt.after_evidence.lastAnalyze);
  assert.ok(receipt.after_evidence.modificationsSinceAnalyze <= 1000);
  assert.ok(
    verified.memories.some(
      (m) =>
        m.kind === "fleet_verified_action" &&
        m.metadata.fleetActionId === action.fleet_action_id,
    ),
  );
  const ack = verified.reviews.find(
    (r) =>
      r.type === "acknowledgement" &&
      r.proposedAction?.fleetActionId === action.fleet_action_id &&
      r.status === "pending",
  );
  assert.ok(ack);
  await api("/api/reviews/" + ack.id, {
    decision: "complete",
    feedback:
      "Reviewed verified statistics evidence; keep this outcome in cluster memory.",
  });
  await api("/api/reviews/" + ack.id, {
    decision: "complete",
    feedback: "Idempotent retry",
  });
  const final = await api("/api/clusters/" + clusterId + "/dashboard");
  assert.equal(
    final.memories.filter(
      (m) =>
        m.kind === "human_feedback" && [review.id, ack.id].includes(m.reviewId),
    ).length,
    2,
  );
  assert.equal(
    final.actions.filter((a) => a.fleet_action_id === action.fleet_action_id)
      .length,
    1,
  );
  console.log(
    "Fleet maintenance integration passed: non-superuser helper, protected explicit allowlist, fresh evidence, approval gate, real ANALYZE, verified statistics, durable outcome plus distinct approval/acknowledgement feedback, idempotent review retry.",
  );
} finally {
  if (clusterId)
    await api("/api/clusters/" + clusterId, undefined, "DELETE").catch(
      () => {},
    );
  if (dbCreated) sql(`DROP DATABASE ${qi(database)} WITH(FORCE);`);
  if (rolesCreated)
    sql(`DROP ROLE IF EXISTS ${qi(executor)},${qi(monitor)},${qi(owner)};`);
}
