import { searchMemory, memoryIndexStatus } from "./memory-search.mjs";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, changePolicy, requestCycle, submitReview } from "./store.mjs";
import { getState, getSchema } from "./state.mjs";
import { setFixture, closeFixtures } from "./fixtures.mjs";
import { closePools, errText } from "./config.mjs";
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
async function body(req) {
  let s = "";
  for await (const c of req) {
    s += c;
    if (s.length > 32768)
      throw Object.assign(new Error("Request body too large"), {
        statusCode: 413,
      });
  }
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { statusCode: 400 });
  }
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz") {
      await db.query("SELECT 1");
      json(res, 200, { status: "ready", service: "verdant-console" });
      return;
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
      const origin = req.headers.origin;
      if (origin) {
        let hostname;
        try {
          hostname = new URL(origin).hostname;
        } catch {}
        if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
          json(res, 403, {
            error: "This local demo accepts same-machine console requests only",
          });
          return;
        }
      }
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
        json(res, 200, await submitReview(m[1], b.decision, b.feedback || ""));
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
const port = Number(process.env.PORT || 8090);
server.listen(port, "0.0.0.0", () =>
  console.log(JSON.stringify({ service: "verdant-console", port })),
);
async function stop() {
  server.close();
  await closeFixtures();
  await closePools();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
