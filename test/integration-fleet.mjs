// Registers ONLY the local disposable primary as an external cluster; leaves target data untouched.
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { apiFetch } from "./api-client.mjs";
const base = process.env.BASE_URL || "http://127.0.0.1:8090";
const password = fs
  .readFileSync(
    fileURLToPath(new URL("../.secrets/monitor_password", import.meta.url)),
    "utf8",
  )
  .trim();
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
async function until(fn, timeout = 70000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Fleet condition timed out");
}
const ids = [];
try {
  const draft = {
    name: "Fleet integration " + Date.now(),
    provider: "self-managed",
    policy: { captureQueryText: false, monitorIntervalSeconds: 10 },
    endpoints: [
      {
        name: "Disposable primary",
        role: "primary",
        host: "primary",
        port: 5432,
        database: "workload",
        username: "verdant_monitor",
        password,
        sslMode: "disable",
      },
    ],
  };
  const probe = await api("/api/clusters/test", draft);
  assert.equal(probe.ok, true);
  assert.equal(probe.endpoints[0].role, "primary");
  const created = await api("/api/clusters", draft);
  ids.push(created.id);
  assert.equal(created.kind, "external");
  assert.equal(created.monitorOnly, true);
  assert.equal(created.actionCredentialsConfigured, false);
  assert.ok(!JSON.stringify(created).includes(password));
  assert.ok(!JSON.stringify(created).includes("monitor_secret"));
  const endpoint = created.endpoints[0];
  const editedDraft = {
    ...draft,
    id: created.id,
    endpoints: [{ ...endpoint, username: "verdant_monitor" }],
  };
  delete editedDraft.endpoints[0].hasPassword;
  delete editedDraft.endpoints[0].hasCaCertificate;
  assert.equal((await api("/api/clusters/test", editedDraft)).ok, true);
  const boot = await api("/api/clusters/bootstrap", { ...editedDraft });
  assert.match(boot.sql, /GRANT pg_monitor/);
  assert.ok(!boot.sql.includes(password));
  const dashboard = await until(async () => {
    const d = await api("/api/clusters/" + created.id + "/dashboard");
    return d.endpoints[0]?.metrics?.connections !== undefined ? d : null;
  });
  assert.equal(dashboard.cluster.id, created.id);
  assert.ok(dashboard.endpoints[0].capabilities.basic.available);
  assert.ok(dashboard.endpoints[0].capabilities.tables.available);
  assert.ok(
    dashboard.endpoints[0].details.tables.some((t) => t.table === "orders"),
  );
  assert.ok(
    dashboard.queries.every((q) => q.query === null),
    "SQL capture disabled must redact newly collected query texts",
  );
  assert.ok(
    dashboard.reviews.every((r) =>
      dashboard.incidents.some((i) => i.id === r.incidentId),
    ),
  );
  const other = await api("/api/clusters", {
    ...draft,
    name: "Unavailable fleet integration",
    endpoints: [{ ...draft.endpoints[0], host: "127.0.0.1", port: 1 }],
  });
  ids.push(other.id);
  const unavailable = await until(async () => {
    const d = await api("/api/clusters/" + other.id + "/dashboard");
    return d.endpoints[0]?.status === "unavailable" ? d : null;
  });
  assert.ok(
    unavailable.incidents.some((i) => i.kind === "endpoint_unavailable"),
  );
  assert.ok(unavailable.reviews.length > 0);
  assert.ok(unavailable.memories.length > 0);
  assert.ok(
    !unavailable.incidents.some((i) =>
      dashboard.incidents.some((j) => j.id === i.id),
    ),
    "Cluster evidence must remain isolated",
  );
  assert.equal(unavailable.endpoints[0].metrics.connections, null);
  const investigation = unavailable.reviews.find((r) => r.status === "pending");
  assert.ok(investigation);
  await api("/api/reviews/" + investigation.id, {
    decision: "complete",
    feedback:
      "Known unreachable test endpoint; acknowledge without resolving current evidence.",
  });
  const nextSample = await until(async () => {
    const d = await api("/api/clusters/" + other.id + "/dashboard");
    return d.endpoints[0].lastCheckedAt !==
      unavailable.endpoints[0].lastCheckedAt
      ? d
      : null;
  });
  assert.equal(
    nextSample.reviews.filter(
      (r) =>
        r.incidentId === investigation.incidentId &&
        r.generation === investigation.generation,
    ).length,
    1,
    "Completing a review must not create an identical review on every poll",
  );
  assert.ok(
    nextSample.incidents.some(
      (i) => i.id === investigation.incidentId && i.status !== "resolved",
    ),
    "Human completion must not resolve active evidence",
  );
  const healthyAgain = await api("/api/clusters/" + created.id + "/dashboard");
  assert.notEqual(
    healthyAgain.endpoints[0].status,
    "unavailable",
    "A failed external endpoint must not stop another cluster",
  );
  const fleet = await api("/api/fleet");
  assert.ok(fleet.clusters.some((c) => c.id === created.id));
  assert.ok(fleet.clusters.some((c) => c.id === other.id));
  assert.ok(fleet.summary.activeIncidents > 0);
  await api("/api/clusters/" + other.id, undefined, "DELETE");
  ids.splice(ids.indexOf(other.id), 1);
  const retained = await api("/api/clusters/" + other.id + "/dashboard");
  assert.equal(retained.cluster.enabled, false);
  assert.equal(retained.cluster.deleted, true);
  assert.ok(retained.incidents.length > 0);
  assert.ok(retained.memories.length > 0);
  console.log(
    "Fleet integration passed: encrypted registration/redaction, edit credential preservation, bootstrap, real telemetry, SQL-text policy, unavailable isolation, scoped reviews/memory, soft deletion/history.",
  );
} finally {
  for (const id of ids)
    await api("/api/clusters/" + id, undefined, "DELETE").catch(() => {});
}
