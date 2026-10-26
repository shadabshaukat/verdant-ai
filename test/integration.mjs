import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiFetch as fetch } from "./api-client.mjs";
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.BASE_URL || "http://127.0.0.1:8090";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(route, body) {
  const r = await fetch(
    base + route,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const type = r.headers.get("content-type") || "";
  const j = type.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error(`${r.status} ${route}: ${JSON.stringify(j)}`);
  return j;
}
function sql(service, text) {
  return execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      service,
      "psql",
      "-U",
      "postgres",
      "-d",
      service === "control" ? "verdant" : "workload",
      "-Atq",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      text,
    ],
    { cwd, encoding: "utf8" },
  ).trim();
}
async function until(fn, timeout = 20000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(1000);
  }
  throw new Error("Condition did not become true within " + timeout + " ms");
}
console.log("Checking", base);
const readiness = await api("/healthz");
assert.equal(readiness.status, "ready");
assert.equal(readiness.control, "ready");
assert.ok(
  readiness.worker?.status,
  "Readiness should report worker health separately",
);
for (const invalid of ["null", "[]", "1"]) {
  const rejected = await fetch(base + "/api/agent/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: invalid,
  });
  assert.equal(rejected.status, 400, "Mutation requests must be JSON objects");
}
assert.equal(sql("primary", "SELECT pg_is_in_recovery()"), "f");
assert.equal(sql("standby", "SELECT pg_is_in_recovery()"), "t");
assert.equal(
  sql(
    "primary",
    "SELECT count(*) FROM pg_stat_replication WHERE application_name='verdant_standby' AND state='streaming'",
  ),
  "1",
);
assert.equal(
  sql(
    "control",
    "SELECT usesuper FROM pg_user WHERE usename='verdant_control'",
  ),
  "f",
);
assert.equal(
  sql(
    "primary",
    "SELECT has_function_privilege('verdant_monitor','ops.analyze_demo_table()','EXECUTE')",
  ),
  "f",
);
assert.equal(
  sql(
    "primary",
    "SELECT has_table_privilege('verdant_executor','app.orders','UPDATE')",
  ),
  "f",
);
assert.equal(
  sql(
    "primary",
    "SELECT has_function_privilege('verdant_executor','ops.analyze_demo_table()','EXECUTE')",
  ),
  "t",
);
let state = await until(async () => {
  const s = await api("/api/state");
  return s.topology?.length === 2 ? s : null;
}, 30000);
for (const name of [
  "agent",
  "topology",
  "metrics",
  "incidents",
  "actions",
  "reviews",
  "events",
  "memories",
  "runs",
  "policy",
  "queries",
  "demo",
])
  assert.ok(name in state, `Missing state.${name}`);
assert.ok(
  state.topology.some((t) => t.id === "standby" && t.role === "standby"),
);
const oldPaused = !!state.policy.paused;
try {
  await api("/api/agent/control", { paused: true });
  state = await api("/api/state");
  assert.equal(state.policy.paused, true);
  await api("/api/agent/control", { paused: false });
  state = await api("/api/state");
  assert.equal(state.policy.paused, false);
} finally {
  if (oldPaused) await api("/api/agent/control", { paused: true });
}
const bad = await fetch(base + "/api/demo/scenarios/not-a-fixture", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
assert.ok(
  bad.status >= 400 && bad.status < 500,
  "Unknown fixture must be rejected",
);
console.log(
  "PASS: primary/standby streaming, separated non-superuser roles, state contract, pause controls, unknown fixture rejection",
);

if (process.argv.includes("--full")) {
  const before = new Set((await api("/api/state")).actions.map((a) => a.id));
  await api("/api/agent/control", { paused: false });
  await api("/api/demo/scenarios/stale-statistics", { active: true });
  await api("/api/agent/cycle", {});
  const action = await until(async () => {
    const s = await api("/api/state");
    const a = s.actions.find(
      (a) =>
        !before.has(a.id) &&
        a.tool === "analyze_table" &&
        a.status === "succeeded",
    );
    return a || null;
  }, 300000);
  assert.ok(
    action.verifiedAt,
    "Successful remediation must have verification timestamp",
  );
  state = await api("/api/state");
  const review = state.reviews.find(
    (r) => r.actionId === action.id && r.type === "acknowledgement",
  );
  assert.ok(review, "Verified action needs a human acknowledgement review");
  const feedback =
    "Integration check: verified statistics refresh and retained feedback.";
  await api("/api/reviews/" + review.id, { decision: "complete", feedback });
  state = await api("/api/state");
  assert.ok(
    state.memories.some((m) => JSON.stringify(m).includes(feedback)),
    "Feedback must appear in durable memory",
  );
  const countBefore = sql("control", "SELECT count(*) FROM agent.memory");
  await api("/api/reviews/" + review.id, { decision: "complete", feedback });
  assert.equal(
    sql("control", "SELECT count(*) FROM agent.memory"),
    countBefore,
    "Review completion retry must be idempotent",
  );
  console.log(
    "PASS: autonomous ANALYZE, verification, human acknowledgement, durable memory and idempotent completion",
  );
}
