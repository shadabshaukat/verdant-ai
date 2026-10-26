import { readinessSnapshot } from "./readiness.mjs";
import { shutdownController, drainWithin } from "./lifecycle.mjs";
import { pendingMemoryIndex } from "./memory-index.mjs";
import { searchMemory, memoryIndexStatus } from "./memory-search.mjs";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, changePolicy, requestCycle, submitReview } from "./store.mjs";
import { getState, getSchema } from "./state.mjs";
import { setFixture, closeFixtures } from "./fixtures.mjs";
import { closePools, errText, ENV } from "./config.mjs";
import { randomUUID } from "node:crypto";
import { authConfiguration, createAuthentication } from "./auth.mjs";
import { readJsonBody as body } from "./http-input.mjs";
const authentication = createAuthentication(authConfiguration());
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../web",
);
const json = (res, status, data) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
};
const server = http.createServer(async (req, res) => {
  const requestId = randomUUID();
  res.setHeader("x-request-id", requestId);
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  let auditId = null;
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz") {
      const ready = await readinessSnapshot((text) => db.query(text));
      json(res, ready.statusCode, ready.body);
      return;
    }
    if (url.pathname === "/api/session") {
      if (req.method === "GET") return json(res, 200, authentication.status(req));
      authentication.assertOrigin(req);
      if (req.method === "POST") {
        const b = await body(req);
        const identity = authentication.login(req, res, b.token);
        await db.query("INSERT INTO agent.audit_log(request_id,actor,operation,resource,status_code) VALUES($1,$2,'sign-in','/api/session',200)", [requestId, identity.role]);
        return json(res, 200, identity);
      }
      if (req.method === "DELETE") return json(res, 200, authentication.logout(res));
      return json(res, 405, { error: "Method not allowed" });
    }
    if (url.pathname.startsWith("/api/") || url.pathname === "/metrics") {
      const readOnly = ["GET", "HEAD"].includes(req.method) || (req.method === "POST" && url.pathname === "/api/memory/search");
      const management = /^\/api\/(clusters|model-profiles)(\/|$)/.test(url.pathname);
      const identity = authentication.authorize(req, readOnly ? "viewer" : management ? "admin" : "operator");
      req.identity = identity;
      if (!readOnly) {
        authentication.assertOrigin(req);
        if (req.method !== "DELETE" && !String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json"))
          throw Object.assign(new Error("Use application/json for API requests"), { statusCode: 415 });
        auditId = (await db.query("INSERT INTO agent.audit_log(request_id,actor,operation,resource,status_code) VALUES($1,$2,$3,$4,102) RETURNING audit_id", [requestId, identity.role, req.method, url.pathname.slice(0, 300)])).rows[0].audit_id;
        res.on("finish", () => void db.query("UPDATE agent.audit_log SET status_code=$2 WHERE audit_id=$1", [auditId, res.statusCode]).catch(error => console.error(JSON.stringify({ component: "audit", error: errText(error), requestId }))));
      }
      if (req.method === "GET" && url.pathname === "/api/fleet") {
        const fleet = await import("./fleet.mjs");
        return json(res, 200, await fleet.getFleetDashboard());
      }
      if (req.method === "GET" && url.pathname === "/api/audit") {
        authentication.authorize(req, "admin");
        return json(res, 200, { entries: (await db.query("SELECT * FROM agent.audit_log ORDER BY audit_id DESC LIMIT 100")).rows });
      }
      if (url.pathname === "/metrics" && req.method === "GET") {
        const { getFleetDashboard } = await import("./fleet.mjs");
        const fleet = await getFleetDashboard();
        const clusters = fleet.clusters || [];
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" });
        return res.end(`# HELP verdant_registered_clusters Registered PostgreSQL clusters including the demo.\n# TYPE verdant_registered_clusters gauge\nverdant_registered_clusters ${clusters.length}\n# HELP verdant_cluster_up Latest collection reports this cluster healthy.\n# TYPE verdant_cluster_up gauge\n${clusters.map(cluster => `verdant_cluster_up{cluster_id="${String(cluster.id).replace(/[^a-zA-Z0-9:_-]/g, "_")}"} ${cluster.status === "healthy" ? 1 : 0}`).join("\n")}\n`);
      }
      if (management) {
        const isClusters = url.pathname.startsWith("/api/clusters");
        const api = await import(isClusters ? "./fleet.mjs" : "./model-profiles.mjs");
        const base = isClusters ? "/api/clusters" : "/api/model-profiles";
        const suffix = url.pathname.slice(base.length);
        if (suffix === "" && req.method === "GET") return json(res, 200, isClusters ? await api.listClusters() : await api.listModelProfiles());
        if (suffix === "" && req.method === "POST") return json(res, 201, isClusters ? await api.saveCluster(await body(req)) : await api.saveModelProfile(await body(req)));
        if (suffix === "/test" && req.method === "POST") return json(res, 200, isClusters ? await api.testCluster(await body(req)) : await api.testModelProfile(await body(req)));
        if (isClusters && suffix === "/bootstrap" && req.method === "POST") return json(res, 200, await api.bootstrapSql(await body(req)));
        const match = suffix.match(/^\/([0-9a-f-]+|demo)(?:\/(test|activate|dashboard))?$/i);
        if (match) {
          const [, id, operation] = match;
          if (req.method === "GET" && isClusters && (!operation || operation === "dashboard")) {
            const dashboard = await api.getClusterDashboard(id);
            if (id !== "demo") dashboard.investigations = await (await import("./fleet-planner.mjs")).getFleetInvestigations(id);
            return json(res, 200, dashboard);
          }
          if (req.method === "POST" && operation === "test") return json(res, 200, isClusters ? await api.testCluster(id) : await api.testModelProfile(id));
          if (req.method === "POST" && operation === "activate" && !isClusters) return json(res, 200, await api.activateModelProfile(id));
          if (req.method === "PUT" && !operation) return json(res, 200, isClusters ? await api.saveCluster(await body(req), id) : await api.saveModelProfile(await body(req), id));
          if (req.method === "DELETE" && !operation) return json(res, 200, isClusters ? await api.deleteCluster(id) : await api.deleteModelProfile(id));
        }
        return json(res, 404, { error: "Endpoint not found" });
      }
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      json(res, 200, await getState());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/memory/status") {
      json(res, 200, await memoryIndexStatus());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/schema") {
      json(res, 200, await getSchema());
      return;
    }
    if (req.method === "POST") {
      const b = await body(req);
      if (url.pathname === "/api/memory/search") {
        json(res, 200, await searchMemory(b));
        return;
      }
      if (url.pathname === "/api/agent/control") {
        json(res, 200, { policy: await changePolicy(b) });
        return;
      }
      if (url.pathname === "/api/agent/cycle") {
        json(res, 202, await requestCycle());
        return;
      }
      let m = url.pathname.match(/^\/api\/reviews\/([0-9a-f-]+)$/i);
      if (m) {
        json(res, 200, await submitReview(m[1], b.decision, b.feedback || "", req.identity.role));
        return;
      }
      m = url.pathname.match(/^\/api\/demo\/scenarios\/([a-z-]+)$/);
      if (m) {
        json(res, 200, await setFixture(m[1], b.active !== false));
        return;
      }
      json(res, 404, { error: "Endpoint not found" });
      return;
    }
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Endpoint not found" });
    if (req.method !== "GET" && req.method !== "HEAD") {
      json(res, 405, { error: "Method not allowed" });
      return;
    }
    const relative =
      decodeURIComponent(url.pathname) === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname).slice(1);
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) {
      json(res, 403, { error: "Invalid path" });
      return;
    }
    let contents;
    try {
      contents = await fs.readFile(file);
    } catch {
      json(res, 404, { error: "File not found" });
      return;
    }
    const ext = path.extname(file);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".mjs": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ico": "image/x-icon",
    };
    res.writeHead(200, {
      "content-type": types[ext] || "application/octet-stream",
      "content-security-policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    res.end(req.method === "HEAD" ? undefined : contents);
  } catch (e) {
    console.error(errText(e));
    json(res, e.statusCode || 500, { error: errText(e) });
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;
let stopping = false;
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  shutdownController.abort(new Error("Service is stopping"));
  const closeHttp = new Promise((resolve) => server.close(() => resolve()));
  server.closeIdleConnections?.();
  const cleanup = (async () => {
    await closeHttp;
    await Promise.allSettled([closeFixtures(), ...pendingMemoryIndex()]);
    await closePools();
  })();
  const drained = await drainWithin([cleanup], ENV.shutdownTimeoutMs);
  if (!drained) {
    console.error(
      JSON.stringify({
        service: "verdant-console",
        error:
          "Shutdown deadline reached; interrupted requests must be retried.",
      }),
    );
    server.closeAllConnections?.();
  }
  process.exit(drained ? exitCode : 1);
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
server.on("error", (error) => {
  console.error(
    JSON.stringify({ service: "verdant-console", error: errText(error) }),
  );
  void stop(1);
});
server.listen(ENV.port, ENV.serverHost, () =>
  console.log(
    JSON.stringify({
      service: "verdant-console",
      host: ENV.serverHost,
      port: ENV.port,
    }),
  ),
);
