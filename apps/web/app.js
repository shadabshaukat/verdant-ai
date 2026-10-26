"use strict";
const paths = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  pulse: "M3 12h4l3-8 4 16 3-8h4",
  incident:
    "M10.3 3.9 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01",
  review:
    "M9 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4M9 2h6v5H9zM8 14l3 3 6-6",
  memory:
    "M9 3v18m6-18v18M3 9h18M3 15h18M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z",
  query: "m4 5 7 7-7 7m10 0h6",
  console: "M3 4h18v16H3zM7 9l3 3-3 3m7 0h3",
  policy: "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4ZM8 12l3 3 5-6",
  schema: "M3 3h6v6H3zM15 15h6v6h-6zM3 15h6v6H3zM6 9v6m3-9h9v9M9 18h6",
  demo: "M9 3h6M10 3v6l-6 10a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M8 14h8",
  db: "M20 6c0 2-4 4-8 4s-8-2-8-4 4-4 8-4 8 2 8 4ZM4 6v12c0 2 4 4 8 4s8-2 8-4V6M4 12c0 2 4 4 8 4s8-2 8-4",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  chevron: "m9 5 7 7-7 7",
  check: "m5 12 4 4L19 6",
  refresh: "M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6",
  pause: "M8 4v16M16 4v16",
  play: "m7 3 14 9-14 9V3Z",
  shield: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z",
  clock: "M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  tools:
    "M14 7a5 5 0 0 0-6-5l3 3-3 3-3-3a5 5 0 0 0 5 7L3 19a2 2 0 0 0 3 3l8-8a5 5 0 0 0 8-5l-3 3-3-3 3-3a5 5 0 0 0-5 1Z",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  close: "m6 6 12 12M6 18 18 6",
  menu: "M3 6h18M3 12h18M3 18h18",
  link: "m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  cpu: "M7 7h10v10H7zM9 1v6m6-6v6M9 17v6m6-6v6M1 9h6m-6 6h6m10-6h6m-6 6h6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  book: "M3 3h7a3 3 0 0 1 2 2 3 3 0 0 1 2-2h7v17h-7a3 3 0 0 0-2 2 3 3 0 0 0-2-2H3V3Zm9 2v17",
  lock: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4",
  trend: "m3 17 6-6 4 4 8-10m-6 0h6v6",
  bolt: "m13 2-9 12h7l-1 8 10-12h-8l1-8Z",
  info: "M12 11v6m0-10h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  fingerprint:
    "M4 12a8 8 0 0 1 16 0M8 12a4 4 0 0 1 8 0c0 4-1 7-3 10M12 12c0 6-1 8-3 10M4 16c0 3-1 4-1 4m17-4-1 6M8 12c0 3 0 5-2 8",
};
const icon = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.pulse}"/></svg>`;
const logo = `<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M5 12h8l7 20 7-20h8L24 36h-8L5 12Z" fill="#3ECF8E"/><path d="M17 4h18l-6 6H14l3-6Z" fill="#B2F5D2"/></svg>`;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const arr = (v) => (Array.isArray(v) ? v : []);
const text = (v) =>
  v == null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2);
const json = (v) => JSON.stringify(v ?? {}, null, 2);
const num = (v, dec = 0) =>
  v == null || v === "" || !Number.isFinite(Number(v))
    ? "—"
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: dec });
const bytes = (v) =>
  v == null || !Number.isFinite(Number(v))
    ? "—"
    : Number(v) < 1024
      ? `${num(v)} B`
      : Number(v) < 1048576
        ? `${num(Number(v) / 1024, 1)} KB`
        : Number(v) < 1073741824
          ? `${num(Number(v) / 1048576, 1)} MB`
          : `${num(Number(v) / 1073741824, 2)} GB`;
const date = (v) => {
  const d = new Date(v);
  return !v || !Number.isFinite(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
};
const time = (v) => {
  const d = new Date(v);
  return !v || !Number.isFinite(d.getTime())
    ? "—"
    : d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
};
const ago = (v) => {
  if (!v) return "not yet";
  const sec = Math.max(
    0,
    Math.floor((Date.now() - new Date(v).getTime()) / 1000),
  );
  if (!Number.isFinite(sec)) return "unknown";
  return sec < 60
    ? `${sec}s ago`
    : sec < 3600
      ? `${Math.floor(sec / 60)}m ago`
      : `${Math.floor(sec / 3600)}h ago`;
};
const short = (v) => (v ? String(v).slice(0, 8) : "—");
const human = (v) => String(v || "unknown").replace(/[_-]/g, " ");
const severityClass = (v) =>
  /critical|error|failed|high|blocked|unhealthy|unavailable|offline/.test(
    String(v),
  )
    ? "red"
    : /warning|medium|pending|approval|degraded|paused|investigating|stale|waiting/.test(
          String(v),
        )
      ? "amber"
      : /healthy|completed|resolved|verified|success|online|watching|streaming|approved|clear|running|active/.test(
            String(v),
          )
        ? "green"
        : "muted";
const badge = (v, label = v) =>
  `<span class="badge ${severityClass(v)}">${esc(human(label))}</span>`;
const empty = (title, body, small = false, name = "eye") =>
  `<div class="empty ${small ? "compact" : ""}">${icon(name)}<h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
const tabs = [
  ["overview", "Overview", "overview"],
  ["incidents", "Incidents", "incident"],
  ["reviews", "Review queue", "review"],
  ["memory", "Ask memory", "memory"],
  ["queries", "Queries", "query"],
  ["console", "Agent console", "console"],
  ["policies", "Controls", "policy"],
  ["schema", "Agent schema", "schema"],
  ["demo", "Demo scenarios", "demo"],
];
const headings = {
  overview: ["Database overview", "Live PostgreSQL operations."],
  incidents: ["Incidents", "What needs attention, and what changed."],
  reviews: ["Review queue", "Approve a proposal or check a completed action."],
  memory: ["Ask memory", "Find past events, actions and SQL."],
  queries: ["Queries", "Cumulative PostgreSQL statement statistics."],
  console: ["Agent console", "The agent’s recent investigations."],
  policies: ["Controls", "Set priorities and permitted actions."],
  schema: ["Agent schema", "The PostgreSQL records behind the agent."],
  demo: ["Demo scenarios", "Introduce a condition in the reference database."],
};
const disclosure = (key, label, body, cls = "") => `<details class="disclosure ${cls}" data-disclosure="${esc(key)}" ${drafts["open-" + key] ? "open" : ""}><summary>${esc(label)}</summary><div class="disclosure-body">${body}</div></details>`;
const excerpt = (value, max = 170) => {
  const v = typeof value === "string" ? value : value?.summary || value?.message || value?.reason || value?.feedback || "Saved database evidence.";
  return v.length > max ? v.slice(0, max).trimEnd() + "…" : v;
};
let memorySearch = {query: "", keyword: "", from: "", to: "", kind: "all", result: null, error: "", loading: false};
let state = null,
  view = location.hash.slice(1) || "overview",
  fetchError = "",
  lastFetched = null,
  polling = false,
  busy = new Set(),
  drawer = null,
  schema = null,
  selectedRun = null,
  mobileOpen = false;
let filters = {
    incidents: "active",
    reviews: "pending",
    memory: "all",
    queries: "mean",
    console: "all",
  },
  searches = { incidents: "", memory: "", queries: "" },
  drafts = {};
if (!tabs.some((t) => t[0] === view)) view = "overview";
const $ = (s) => document.querySelector(s);
function notify(message, error = false) {
  const t = $("#toast");
  t.textContent = message;
  t.className = `visible${error ? " error" : ""}`;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => (t.className = ""), 5000);
}
async function api(path, body) {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let p;
  try {
    p = await r.json();
  } catch {
    throw new Error(`Request failed (${r.status}).`);
  }
  if (!r.ok)
    throw new Error(p.error || p.message || `Request failed (${r.status}).`);
  return p;
}
function counts() {
  return {
    pending: arr(state?.reviews).filter((r) => r.status === "pending").length,
    active: arr(state?.incidents).filter(
      (i) => !["resolved", "closed"].includes(i.status),
    ).length,
    verified: arr(state?.actions).filter(
      (a) => a.verifiedAt || a.status === "verified",
    ).length,
  };
}
function preserve() {
  const e = document.activeElement;
  return {
    id: e?.id,
    start: e?.selectionStart,
    end: e?.selectionEnd,
    scrollY: window.scrollY,
    drawerScroll: $(".drawer-content")?.scrollTop,
  };
}
function restore(s) {
  if (s.id) {
    const el = document.getElementById(s.id);
    if (el) {
      el.focus({ preventScroll: true });
      if (
        typeof el.setSelectionRange === "function" &&
        Number.isInteger(s.start)
      )
        try {
          el.setSelectionRange(s.start, s.end);
        } catch {}
    }
  }
  window.scrollTo(0, s.scrollY);
  if ($(".drawer-content") && s.drawerScroll != null)
    $(".drawer-content").scrollTop = s.drawerScroll;
}
function navTo(next) {
  view = next;
  mobileOpen = false;
  location.hash = next;
  drawer = null;
  render();
  window.scrollTo(0, 0);
  if (next === "schema" && !schema) loadSchema();
}
function render() {
  if (!state) {
    renderBoot();
    return;
  }
  const focus = preserve(),
    c = counts(),
    a = state.agent || {};
  const status = a.status || "unknown";
  $("#app").innerHTML =
    `<div class="shell"><aside class="sidebar ${mobileOpen ? "open" : ""}"><div class="brand"><div class="brandmark">${logo}</div><div class="brandname">Verdant<span class="visually-hidden"> DBA</span><small>DATABASE AGENT</small></div></div><div class="nav-label">WORKSPACE</div><nav class="nav" aria-label="Main navigation">${tabs.map(([id, label, ic], i) => `${i === 6 ? '<div class="nav-label" style="padding-top:22px">MANAGE</div>' : ""}<button data-nav="${id}" class="${view === id ? "active" : ""}" ${view === id ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span>${id === "reviews" && c.pending ? `<span class="count">${c.pending}</span>` : id === "incidents" && c.active ? `<span class="count">${c.active}</span>` : ""}</button>`).join("")}</nav><div class="sidebar-bottom"><div class="sidebar-status"><span class="dot ${status === "paused" ? "gray" : status === "degraded" ? "amber" : ""}"></span>${esc(human(status))}</div><p>PostgreSQL operations</p></div></aside><div class="content"><header class="topbar"><div class="breadcrumb"><button class="btn ghost icon-only mobile-menu" data-command="menu" aria-label="Open navigation">${icon("menu")}</button><span>Workspace</span><span class="slash">/</span><strong>${esc(tabs.find((t) => t[0] === view)?.[1])}</strong></div><div class="topmeta"><div class="live-tag"><span class="dot ${fetchError ? "amber" : ""}"></span>${fetchError ? "Connection interrupted" : "Live connection"}</div></div></header><main class="main">${fetchError ? `<div class="banner error">${icon("incident")}<span>${esc(fetchError)} The last received data remains visible.</span><button class="btn small" data-command="refresh">Retry</button></div>` : ""}${a.status === "paused" ? `<div class="banner">${icon("pause")}<span>The agent is paused. Existing observations and reviews remain available.</span><button class="btn small" data-command="toggle-agent">Resume agent</button></div>` : ""}${a.error ? `<div class="banner">${icon("incident")}<span>Agent report: ${esc(a.error)}</span><button class="btn small" data-nav="console">Inspect console</button></div>` : ""}<div class="page-heading"><div><h1>${headings[view][0]}</h1><p>${headings[view][1]}</p></div><div class="heading-actions">${view === "overview" || view === "console" ? `<button class="btn" data-command="toggle-agent" ${busy.has("control") ? "disabled" : ""}>${icon(a.status === "paused" ? "play" : "pause")}${a.status === "paused" ? "Resume agent" : "Pause agent"}</button><button class="btn primary" data-command="cycle" ${busy.has("cycle") ? "disabled" : ""}>${icon("refresh")}${busy.has("cycle") ? "Cycle requested" : "Run check now"}</button>` : view === "reviews" ? `<span class="badge ${c.pending ? "amber" : "green"}">${c.pending} awaiting review</span>` : view === "demo" ? `<button class="btn" data-nav="overview">${icon("overview")}Open overview</button>` : ""}</div></div>${renderPage()}<footer class="footer"><span>${lastFetched ? "Updated " + time(lastFetched) : "Waiting for observations"}</span><span>Verdant DBA</span></footer></main></div></div>`;
  document
    .querySelectorAll(".nav [data-nav]")
    .forEach((e) => e.setAttribute("data-testid", "nav-" + e.dataset.nav));
  document
    .querySelectorAll("[data-command]")
    .forEach((e) => e.setAttribute("data-testid", e.dataset.command));
  document
    .querySelectorAll("[data-fixture]")
    .forEach((e) =>
      e.setAttribute("data-testid", "scenario-" + e.dataset.fixture),
    );
  document
    .querySelectorAll("[data-policy]")
    .forEach((e) =>
      e.setAttribute(
        "data-testid",
        "policy-" + e.dataset.policy + "-" + e.dataset.value,
      ),
    );
  document
    .querySelectorAll("[data-review-form]")
    .forEach((e) =>
      e.setAttribute("data-testid", "review-" + e.dataset.reviewForm),
    );
  renderDrawer();
  restore(focus);
}
function renderBoot() {
  if (fetchError) {
    $("#app").innerHTML =
      `<div class="boot"><span class="boot-logo">V</span><h1>Verdant DBA</h1><p>${esc(fetchError)}</p><button class="btn primary" data-command="refresh">Reconnect</button></div>`;
  }
}
function renderPage() {
  switch (view) {
    case "overview":
      return renderOverview();
    case "incidents":
      return renderIncidents();
    case "reviews":
      return renderReviews();
    case "memory":
      return renderMemory();
    case "queries":
      return renderQueries();
    case "console":
      return renderConsole();
    case "policies":
      return renderPolicies();
    case "schema":
      return renderSchema();
    case "demo":
      return renderDemo();
    default:
      return "";
  }
}
function spark(history) {
  const values = arr(history)
    .map((x) => Number(x.value))
    .filter(Number.isFinite);
  if (values.length < 2) return "";
  const lo = Math.min(...values),
    hi = Math.max(...values),
    range = hi - lo || 1;
  const pts = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * 100).toFixed(1)},${(30 - ((v - lo) / range) * 25).toFixed(1)}`,
    )
    .join(" ");
  return `<svg class="sparkline" viewBox="0 0 100 35" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="#3ECF8E" stroke-width="1.5"/></svg>`;
}
function metricCard(name, value, unit, note, ic, history) {
  return `<article class="metric-card"><div class="metric-top"><span>${esc(name)}</span>${icon(ic)}</div><div class="metric-value">${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ""}</div><div class="metric-note">${esc(note)}</div>${spark(history)}</article>`;
}
function renderTopology() {
  const nodes = arr(state.topology),
    p = nodes.find(n => n.id === "primary" || n.role === "primary"),
    s = nodes.find(n => n.id === "standby" || n.role === "standby"),
    rep = s?.replication || p?.replication || {};
  const node = (n, label) => `<div class="topology-node"><div class="node-icon">${icon("db")}</div><div class="node-main"><strong>${label}</strong><small>${esc(n?.name || "Awaiting observation")}</small></div>${badge(n?.status || "unknown")}</div>`;
  return `<section class="panel"><div class="panel-head"><h2>Primary & standby</h2></div><div class="topology-body">${node(p,"Primary")}<div class="replication-line ${rep.replayPaused || rep.connected === false ? "idle" : ""}"><span>${rep.replayPaused ? "Replay paused" : rep.connected ? "Streaming" : "Connection unknown"}</span><span class="rail"></span><strong>${rep.lagBytes == null ? "Lag unknown" : bytes(rep.lagBytes) + " behind"}</strong></div>${node(s,"Standby")}${disclosure("topology", "Connection details", `<div class="detail-pairs"><span>Replay delay<strong>${rep.lagSeconds == null ? "Unknown" : num(rep.lagSeconds, 2) + " s"}</strong></span><span>Primary connections<strong>${num(p?.connections)}</strong></span><span>Standby connections<strong>${num(s?.connections)}</strong></span></div>`)}</div></section>`;
}
function renderOverview() {
  const a = state.agent || {}, c = counts(), p = state.policy || {},
    reviews = arr(state.reviews).filter(r => r.status === "pending"),
    activity = arr(state.events).filter(e => e.type !== "monitor.cycle").slice(0,3),
    title = a.status === "paused" ? "Agent paused" : a.status === "investigating" ? "Investigating a finding" : a.status === "acting" ? "Checking a response" : a.status === "degraded" ? "Agent needs attention" : "Your DBA is on watch";
  return `<section class="status-hero"><div><div class="hero-status">${badge(a.status || "unknown")}</div><h2>${title}</h2><p>Last observation ${ago(a.lastCycleAt)} · ${esc(a.intervalSeconds || p.monitorIntervalSeconds || "—")}s cadence</p></div><button class="btn" data-nav="console">View activity ${icon("arrow")}</button></section><div class="metric-grid overview-metrics">${metricCard("Active incidents",num(c.active),"",c.active ? "Needs attention" : "All clear","incident")}${metricCard("To review",num(c.pending),"",c.pending ? "Your decision is needed" : "You’re up to date","review")}${metricCard("Verified actions",num(c.verified),"","Checked against PostgreSQL","check")}</div><div class="overview-top">${renderTopology()}<section class="panel"><div class="panel-head"><h2>Your review queue</h2>${reviews.length ? badge("pending",num(reviews.length) + " waiting") : ""}</div>${reviews.length ? `<div class="review-focus"><h3>${esc(reviews[0].title || "Review agent action")}</h3><p>${reviews[0].type === "approval" ? "Waiting for permission to act." : "Completed and verified. Ready for your check."}</p><button class="btn primary" data-review-open="${esc(reviews[0].id)}">${reviews[0].type === "approval" ? "Review proposal" : "Check outcome"}${icon("arrow")}</button></div>` : empty("Nothing waiting", "Completed actions will appear here for your review.",true,"check")}</section></div><section class="panel"><div class="panel-head"><h2>Recent activity</h2><button class="subtle-link" data-nav="console">View all ${icon("arrow")}</button></div>${activity.length ? `<div class="activity-list">${activity.map(renderActivity).join("")}</div>` : empty("Waiting for activity", "Agent events appear here as they happen.",true)}</section>${disclosure("agent-context", "Agent context", `<p>${esc(a.directive || "Watch the primary and standby, investigate findings and verify permitted repairs.")}</p><p class="muted">${a.planner === "ollama" ? "Model planner" : a.planner === "fallback" ? "Fallback planner" : human(a.planner || "Planner unknown")} · ${esc(a.model || "Model not reported")} · ${num(a.cycleCount)} observations</p>`, "section-gap")}`;
}
function renderActivity(e) {
  const kind = e.type || "observation",
    cl = severityClass(e.severity),
    ic = /action|remediat/i.test(kind)
      ? "tools"
      : /review|feedback/i.test(kind)
        ? "review"
        : /memory/i.test(kind)
          ? "memory"
          : /plan|decision|tool/i.test(kind)
            ? "cpu"
            : /incident|alert/i.test(kind)
              ? "incident"
              : "eye";
  return `<div class="activity-item"><div class="event-icon ${cl}">${icon(ic)}</div><div class="event-copy"><strong>${esc(e.title || human(kind))}</strong></div><span class="event-time">${ago(e.at)}</span></div>`;
}
function filterBar(type, options, placeholder) {
  return `<div class="toolbar"><div class="filters">${options.map(([id, label]) => `<button class="filter ${filters[type] === id ? "active" : ""}" data-filter-type="${type}" data-filter="${id}">${label}</button>`).join("")}</div>${placeholder ? `<div class="search-wrap">${icon("search")}<input class="input" id="search-${type}" data-search="${type}" value="${esc(searches[type] || "")}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"></div>` : ""}</div>`;
}
function renderIncidents() {
  let items = arr(state.incidents);
  if (filters.incidents === "active")
    items = items.filter((i) => !["resolved", "closed"].includes(i.status));
  if (filters.incidents === "resolved")
    items = items.filter((i) => ["resolved", "closed"].includes(i.status));
  if (searches.incidents)
    items = items.filter((i) =>
      JSON.stringify(i)
        .toLowerCase()
        .includes(searches.incidents.toLowerCase()),
    );
  return `${filterBar(
    "incidents",
    [
      ["active", "Active"],
      ["all", "All findings"],
      ["resolved", "Resolved"],
    ],
    "Search findings…",
  )}<section class="panel">${items.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>FINDING</th><th>SEVERITY</th><th>STATE</th><th>LAST OBSERVED</th><th></th></tr></thead><tbody>${items.map((i) => `<tr data-detail="incident" data-id="${esc(i.id)}" tabindex="0"><td><div class="item-name">${esc(i.title || human(i.kind))}</div></td><td>${badge(i.severity)}</td><td>${badge(i.status)}</td><td class="mono">${ago(i.lastSeenAt)}</td><td class="dim">${icon("chevron")}</td></tr>`).join("")}</tbody></table></div><div class="table-end"><span>${items.length} findings</span><span>Open a finding to inspect evidence and actions</span></div>` : empty("No matching findings", filters.incidents === "active" ? "The latest checks have no unresolved finding in this view." : "Findings matching this filter will appear here.", "", "shield")}</section>${arr(state.actions).length ? `${disclosure("action-history", "Action history · " + num(arr(state.actions).length), renderActionsTable(arr(state.actions).slice(0, 12)), "section-gap")}` : ""}`;
}
function renderActionsTable(actions) {
  return `<section class="panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>ACTION</th><th>RISK</th><th>OUTCOME</th><th>CREATED</th><th>VERIFICATION</th><th></th></tr></thead><tbody>${actions.map((a) => `<tr data-detail="action" data-id="${esc(a.id)}" tabindex="0"><td><div class="item-name">${esc(a.title || human(a.tool))}</div></td><td>${badge(a.risk || "bounded")}</td><td>${badge(a.status)}</td><td class="mono">${esc(date(a.createdAt))}</td><td class="mono">${a.verifiedAt ? esc(date(a.verifiedAt)) : "Pending post-check"}</td><td class="dim">${icon("chevron")}</td></tr>`).join("")}</tbody></table></div></section>`;
}
function renderReviews() {
  let items = arr(state.reviews);
  if (filters.reviews !== "all")
    items = items.filter((r) =>
      filters.reviews === "pending"
        ? r.status === "pending"
        : r.status !== "pending",
    );
  return `${filterBar("reviews", [
    ["pending", "Awaiting review"],
    ["completed", "Reviewed"],
    ["all", "All reviews"],
  ])}${items.length ? `<div class="review-grid">${items.map(renderReviewCard).join("")}</div>` : `<section class="panel">${empty("The review queue is clear", "Completed automatic actions arrive for acknowledgement. Proposed actions wait here when their policy requires approval.", false, "check")}</section>`}`;
}
function renderReviewCard(r) {
  const action = arr(state.actions).find((a) => a.id === r.actionId),
    pending = r.status === "pending",
    approval = r.type === "approval";
  return `<article class="review-card ${pending ? "pending" : ""}" id="review-card-${esc(r.id)}"><div class="review-card-top"><div class="review-meta"><div class="badge-row">${badge(pending ? "pending" : r.status, pending ? (approval ? "Approval required" : "Outcome acknowledgement") : r.status)}${action?.risk ? badge(action.risk) : ""}</div><span>${date(r.createdAt)}</span></div><h2>${esc(r.title || "Review database action")}</h2><p>${esc(excerpt(r.reason || "Review the saved outcome."))}</p></div>${disclosure("review-evidence-" + r.id, "View operation & evidence", `${r.proposedAction ? `<pre class="evidence">${esc(r.proposedAction.sql || r.proposedAction.tool || text(r.proposedAction))}</pre>` : ""}${r.evidence ? `<pre class="evidence">${esc(json(r.evidence))}</pre>` : "<p>No evidence recorded.</p>"}`, "review-details")}${pending ? `<form class="review-form" data-review-form="${esc(r.id)}"><label for="feedback-${esc(r.id)}">Feedback for the agent</label><textarea class="input" id="feedback-${esc(r.id)}" data-draft="feedback-${esc(r.id)}" placeholder="What should the agent remember?">${esc(drafts["feedback-" + r.id] || "")}</textarea><div class="feedback-hint">Saved to memory with your decision.</div><div class="review-buttons">${r.incidentId ? `<button class="btn ghost small" type="button" data-detail="incident" data-id="${esc(r.incidentId)}">Evidence</button>` : ""}${approval ? `<button class="btn danger small" type="submit" name="decision" value="reject" ${busy.has("review-" + r.id) ? "disabled" : ""}>Reject</button><button class="btn primary small" type="submit" name="decision" value="approve" ${busy.has("review-" + r.id) ? "disabled" : ""}>${icon("check")}Approve action</button>` : `<button class="btn primary small" type="submit" name="decision" value="complete" ${busy.has("review-" + r.id) ? "disabled" : ""}>${icon("check")}Mark checked / completed</button>`}</div></form>` : `<div class="review-outcome"><strong>${esc(human(r.status))} · ${esc(date(r.completedAt))}</strong>${esc(r.feedback || "No additional feedback recorded.")}</div>`}</article>`;
}
function memoryResultCard(m, index) {
  const source = m.sourceType || "memory", content = m.content,
    sql = arr(m.evidence?.sqlQueries), events = arr(m.evidence?.events),
    actions = arr(m.evidence?.actions), incident = m.evidence?.incident,
    related = m.incidentId || incident?.id || incident?.incidentId;
  const snapshot = m.evidence?.sourceSnapshot || m.metadata?.snapshot || {},
    toolTitles = {
      inspect_statistics: "Inspect statistics", inspect_replication: "Inspect replication",
      inspect_queries: "Inspect query performance", inspect_security: "Inspect role security",
      inspect_blockers: "Inspect blocking queries", recall_memory: "Recall memory",
      propose_action: "Propose an action", request_human_review: "Request human review",
      finish_cycle: "Complete investigation", analyze_table: "Refresh table statistics",
      resume_replication: "Resume standby replay", create_demo_index: "Create lookup index",
      cancel_demo_blocker: "Cancel demo blocker", restrict_demo_role: "Repair demo role"
    },
    readable = value => String(value || "").replace(/\b(inspect_statistics|inspect_replication|inspect_queries|inspect_security|inspect_blockers|recall_memory|propose_action|request_human_review|finish_cycle|analyze_table|resume_replication|create_demo_index|cancel_demo_blocker|restrict_demo_role)\b/g, token => toolTitles[token]),
    plain = value => {
      if (typeof value !== "string") return "";
      // Search documents concatenate prose and indexed JSON. Only preview prose.
      const clean = value.split(/[\[{]/, 1)[0].trim();
      return clean ? readable(clean) : "";
    },
    candidates = [snapshot.summary, snapshot.reason, snapshot.detail?.summary,
      snapshot.detail?.reason, snapshot.detail?.message, snapshot.content,
      m.summary, m.reason, typeof content === "object" ? content?.summary || content?.reason || content?.message || content?.feedback : source === "memory" ? content : ""],
    summary = candidates.map(plain).find(Boolean),
    fallback = [snapshot.status ? human(snapshot.status) : human(m.kind || source).replace(/\./g," "),
      sql.length ? sql.length + " associated SQL " + (sql.length === 1 ? "statement" : "statements") : "",
      events.length ? events.length + " linked " + (events.length === 1 ? "event" : "events") : ""].filter(Boolean).join(" · "),
    preview = summary || fallback || "Saved operational record.",
    title = plain(m.title) || toolTitles[m.kind] || "Saved memory";
  const evidence = `${m.evidence?.truncated ? `<p class="muted">Linked evidence is limited to 20 events/actions and 100 SQL entries.</p>` : ""}<div class="memory-full">${typeof content === "string" ? `<p>${esc(content)}</p>` : `<pre class="evidence">${esc(json(content))}</pre>`}</div>${sql.length ? `<h3>Associated SQL</h3>${sql.map(q => `<div class="memory-sql"><pre class="evidence">${esc(q.query || q.sql || text(q))}</pre>${q.provenance ? `<small>${esc(q.provenance)}${q.at ? " · " + date(q.at) : ""}</small>` : ""}${q.scope ? `<small>${esc(q.scope)}</small>` : ""}</div>`).join("")}` : ""}${events.length ? `<h3>Linked events</h3><div class="linked-events">${events.map(e => `<div><strong>${esc(e.title || human(e.type || e.event_type))}</strong><small>${date(e.at || e.recordedAt || e.recorded_at)}</small>${e.detail ? disclosure("memory-event-" + index + "-" + (e.id || e.event_id), "Event evidence", `<pre class="evidence">${esc(json(e.detail))}</pre>`) : ""}</div>`).join("")}</div>` : ""}${actions.length ? disclosure("memory-actions-" + index, "Linked actions · " + actions.length, `<pre class="evidence">${esc(json(actions))}</pre>`) : ""}${incident ? disclosure("memory-incident-" + index, "Incident evidence", `<pre class="evidence">${esc(json(incident))}</pre>`) : ""}${related && arr(state.incidents).some(i => i.id === related) ? `<button class="btn" data-detail="incident" data-id="${esc(related)}">Open incident ${icon("arrow")}</button>` : ""}`;
  return `<article class="memory-card"><div class="memory-kind">${badge("muted",human(m.category || m.kind || source))}<time>${date(m.at || m.createdAt)}</time></div><h2>${esc(title)}</h2><p>${esc(excerpt(preview))}</p>${disclosure("memory-result-" + (m.id || index), "Details, SQL & events", evidence)}</article>`;
}
function renderMemory() {
  const q = memorySearch, result = q.result;
  let items = arr(state.memories);
  if (searches.memory) items = items.filter(m => JSON.stringify(m).toLowerCase().includes(searches.memory.toLowerCase()));
  const choices = [["all","All records"],["memory","Memory"],["event","Events"],["incident","Incidents"],["action","Actions"],["query","SQL queries"]];
  const queryForm = `<form id="memory-search-form" class="memory-search panel"><label for="memory-question">What would you like to find?</label><div class="ask-row"><input class="input" id="memory-question" data-memory-field="query" value="${esc(q.query)}" placeholder="List performance events and their SQL from the last 2 days" autocomplete="off"><button class="btn primary" data-testid="ask-memory" ${q.loading ? "disabled" : ""}>${icon("search")}${q.loading ? "Searching…" : "Search memory"}</button></div>${disclosure("memory-filters", "Filters", `<div class="memory-filters"><label>Record type<select class="input" id="memory-source" data-memory-field="kind">${choices.map(([value,label]) => `<option value="${value}" ${q.kind === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>From<input class="input" type="date" id="memory-from" data-memory-field="from" value="${esc(q.from)}"></label><label>Through<input class="input" type="date" id="memory-to" data-memory-field="to" value="${esc(q.to)}"></label><label class="keyword-field">Keyword<input class="input" id="search-memory" data-memory-field="keyword" data-search="memory" value="${esc(q.keyword)}" placeholder="Optional exact text"></label></div>`, "memory-filter-disclosure")}</form>`;
  let body = "";
  if (q.error) body = `<div class="banner error" role="alert">${esc(q.error)}</div>`;
  if (q.loading && !result) return queryForm + `<section class="panel">${empty("Searching saved records…", "",false,"search")}</section>`;
  if (result) {
    const intent = result.intent || {}, embedding = result.embedding || {}, matches = arr(result.results);
    const total = result.total ?? matches.length,
      stamp = v => !v ? "" : /^\d{4}-\d{2}-\d{2}$/.test(v)
        ? new Date(v + "T00:00:00").toLocaleDateString(undefined, {day:"numeric",month:"short",year:"numeric"})
        : new Date(v).toLocaleString(undefined, {day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}),
      chips = [intent.sourceType && intent.sourceType !== "all" ? human(intent.sourceType) : "", ...arr(intent.categories).map(human), intent.from ? "From " + stamp(intent.from) : "", intent.to ? "Before " + stamp(intent.to) : "", intent.keywordFilter ? 'Contains “' + intent.keywordFilter + '”' : ""].filter(Boolean),
      readiness = result.mode === "hybrid" ? "Semantic + keyword search" : "Keyword search";
    body += `<div class="memory-results-head"><h2>${num(total)} matching ${total === 1 ? "record" : "records"}</h2><div class="search-actions"><button class="subtle-link" data-command="clear-memory-search">Recent memory</button>${result.hasMore ? `<button class="btn" data-command="more-memory" ${q.loading ? "disabled" : ""}>Load more</button>` : ""}</div></div><div class="memory-search-context"><div class="search-chips">${chips.map(c => `<span class="search-chip">${esc(c)}</span>`).join("")}</div><span class="search-readiness">${readiness}${embedding.total != null ? " · " + num(embedding.indexed) + "/" + num(embedding.total) + " indexed" : ""}</span></div>${disclosure("memory-search-method", arr(result.warnings).length ? "Search details · " + arr(result.warnings).length + " notes" : "Search details", `<p>${esc(intent.explanation || (result.mode === "hybrid" ? "Keyword and semantic retrieval over saved records." : "Keyword and structured filters over saved records."))}</p>${arr(result.warnings).length ? `<p class="search-warning">${arr(result.warnings).map(w => esc(typeof w === "string" ? w : w.message || text(w))).join(" · ")}</p>` : ""}<p class="muted">${result.mode === "hybrid" ? "Hybrid search" : "Keyword & structured search"}${embedding.model ? " · " + esc(embedding.model) : ""}${embedding.total != null ? " · " + num(embedding.indexed) + " of " + num(embedding.total) + " records indexed" : ""}</p>${intent.from || intent.to ? `<p class="muted">${intent.from ? "From " + esc(date(intent.from)) : ""}${intent.to ? " · Before " + esc(date(intent.to)) : ""}</p>` : ""}`)}${matches.length ? `<div class="memory-grid search-results">${matches.map(memoryResultCard).join("")}</div>` : `<section class="panel">${empty("No matching records", "Try a shorter question or a wider date range.",false,"search")}</section>`}`;
  } else {
    body += `<div class="memory-results-head"><h2>Recent memory</h2><span class="muted">${num(items.length)} records · ${Math.min(items.length,6)} shown</span></div>${items.length ? `<div class="memory-grid">${items.slice(0,6).map(memoryResultCard).join("")}</div><div class="view-all-memory"><button class="btn" data-command="all-memory" data-testid="all-memory">View all memory ${icon("arrow")}</button></div>` : `<section class="panel">${empty("No saved memory yet", "Observations and human feedback will appear here.",false,"memory")}</section>`}`;
  }
  return queryForm + body;
}
async function searchMemory(append = false) {
  if (memorySearch.loading) return;
  const q = memorySearch;
  if (q.from && q.to && q.from > q.to) { q.error = "The end date must be on or after the start date."; render(); return; }
  q.loading = true; q.error = "";
  const offset = append ? arr(q.result?.results).length : 0;
  if (!append) q.result = null;
  render();
  try {
    const to = q.to ? new Date(q.to + "T00:00:00") : null;
    if (to) to.setDate(to.getDate() + 1);
    const request = append && q.request ? {...q.request, offset} : {query: q.query.trim(), keyword: q.keyword.trim(), kind: q.kind, ...(q.from ? {from: new Date(q.from + "T00:00:00").toISOString()} : {}), ...(to ? {to: to.toISOString()} : {}), limit: 25, offset};
    q.request = request;
    const response = await api("/api/memory/search", request);
    q.request = {...request, ...(response.intent?.from ? {from: response.intent.from} : {}), ...(response.intent?.to ? {to: response.intent.to} : {})};
    q.result = append && q.result ? {...response, results: [...arr(q.result.results), ...arr(response.results)]} : response;
  } catch (e) { q.error = e.message; }
  finally { q.loading = false; if (view === "memory") render(); }
}
function renderQueries() {
  let items = arr(state.queries);
  if (searches.queries)
    items = items.filter((q) =>
      String(q.query).toLowerCase().includes(searches.queries.toLowerCase()),
    );
  items = [...items].sort(
    (a, b) =>
      Number(
        b[
          filters.queries === "total"
            ? "totalMs"
            : filters.queries === "calls"
              ? "calls"
              : "meanMs"
        ] || 0,
      ) -
      Number(
        a[
          filters.queries === "total"
            ? "totalMs"
            : filters.queries === "calls"
              ? "calls"
              : "meanMs"
        ] || 0,
      ),
  );
  return `${filterBar(
    "queries",
    [
      ["mean", "Highest mean time"],
      ["total", "Highest total time"],
      ["calls", "Most calls"],
    ],
    "Search normalized SQL…",
  )}<div class="query-note">${icon("info")}Since the last statistics reset. Mean time is not tail latency.</div><section class="panel">${items.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>QUERY FINGERPRINT</th><th class="table-number">CALLS</th><th class="table-number">MEAN TIME</th><th class="table-number">TOTAL TIME</th><th class="table-number">ROWS</th><th></th></tr></thead><tbody>${items.map((q, i) => `<tr data-detail="query" data-id="${esc(q.queryid || i)}" tabindex="0"><td><div class="query-sql mono" title="${esc(q.query)}">${esc(q.query)}</div></td><td class="table-number">${num(q.calls)}</td><td class="table-number ${Number(q.meanMs) > 100 ? "green-text" : ""}">${num(q.meanMs, 2)} ms</td><td class="table-number">${num(q.totalMs, 1)} ms</td><td class="table-number">${num(q.rows)}</td><td class="dim">${icon("chevron")}</td></tr>`).join("")}</tbody></table></div><div class="table-end"><span>${items.length} statement fingerprints</span><span>Normalized query text · monitored workload database</span></div>` : empty("Waiting for statement statistics", "Run the slow-query scenario or send workload traffic. The agent will inspect actual query statistics.", false, "query")}</section>`;
}
function renderConsole() {
  const runs = arr(state.runs);
  if (!selectedRun || !runs.some((r) => r.id === selectedRun))
    selectedRun = runs[0]?.id || null;
  const run = runs.find((r) => r.id === selectedRun);
  return `<div class="console-grid"><section class="panel"><div class="panel-head"><div class="panel-title">${icon("clock")}<h2>Investigation runs</h2></div><span class="numeric-pill">${runs.length}</span></div><div class="run-list">${runs.length ? runs.slice(0, 12).map((r) => `<button class="run-button ${r.id === selectedRun ? "active" : ""}" data-run="${esc(r.id)}"><div class="run-top"><strong>Run ${esc(short(r.id))}</strong>${badge(r.status)}</div><p>${esc(excerpt(r.summary || "Investigation in progress.", 105))}</p><small>${date(r.startedAt)} · ${esc(human(r.planner || "unknown"))}</small></button>`).join("") : empty("No runs yet", "An investigation starts when the agent has a finding to evaluate.", true, "console")}</div></section><section class="panel">${
    run
      ? `<div class="run-detail-head"><div class="space-between"><div class="badge-row">${badge(run.status)}${badge(run.planner === "ollama" ? "green" : "info", run.planner === "ollama" ? "Model-directed" : "Planner: " + human(run.planner || "unknown"))}</div><span class="short-id">${esc(run.id)}</span></div><h2>${esc(excerpt(run.summary || "Database investigation", 200))}</h2><p>${date(run.startedAt)}${run.completedAt ? " · completed " + time(run.completedAt) : " · investigation is in progress"}</p></div>${
          arr(run.steps).length
            ? `<div class="step-list">${arr(run.steps)
                .map(
                  (s, i) =>
                    `<article class="step" data-step="${i + 1}"><div class="step-heading"><h3 class="mono">${esc(s.tool || "observation")}</h3><time>${time(s.at)}</time></div><p>${esc(s.reason || "The agent selected this step from its currently permitted tools.")}</p><details data-step-detail="${esc(run.id)}-${i}" ${drafts["detail-" + run.id + "-" + i] ? "open" : ""}><summary>View tool evidence${s.source ? " · " + esc(human(s.source)) : ""}</summary><pre>${esc(json({ arguments: s.arguments ?? {}, observation: s.observation }))}</pre></details></article>`,
                )
                .join("")}</div>`
            : empty(
                "Waiting for the next tool result",
                "The agent’s selected tool and its checked observation will appear here.",
                true,
                "cpu",
              )
        }`
      : `<div class="console-empty">${empty("Every decision has a trace", "The agent records its selected tool, reason and observation for each investigation.", false, "console")}</div>`
  }</section></div>${disclosure("event-stream", "Event stream · " + num(arr(state.events).length), `<div class="log-panel">${
    arr(state.events).length
      ? arr(state.events)
          .slice(0, 25)
          .map(
            (e) =>
              `<div class="log-row"><time>${time(e.at)}</time><span class="log-type">${esc(e.type || "event")}</span><div class="log-message">${esc(e.title || human(e.type))}${e.detail ? `<p>${esc(typeof e.detail === "string" ? e.detail : e.detail?.message || e.detail?.reason || e.detail?.summary || "")}</p>` : ""}</div></div>`,
          )
          .join("")
      : empty(
          "No events received",
          "The persisted journal will appear after the first observation.",
          true,
        )
  }</div>`, "section-gap")}`;
}
function renderPolicies() {
  const p = state.policy || {},
    a = state.agent || {};
  const policyRows = [
    [
      "allowAutoAnalyze",
      "Refresh table statistics",
      "ANALYZE only the allowlisted demo table.",
    ],
    [
      "allowAutoIndex",
      "Create the demo index",
      "Build only the fixed app.orders customer lookup index.",
    ],
    [
      "requireApprovalForIndex",
      "Index creation needs approval",
      "Human approval before the fixed index build on the reference workload.",
    ],
    [
      "requireApprovalForResume",
      "Replay recovery needs approval",
      "Human approval before changing standby replay.",
    ],
    [
      "requireApprovalForCancel",
      "Blocker cancellation needs approval",
      "Cancellation is restricted to the tagged demo blocker.",
    ],
    [
      "requireApprovalForRole",
      "Role repair needs approval",
      "Only the fixed demo role’s CREATEROLE attribute can change.",
    ],
  ];
  return `<div class="policy-grid"><section class="panel"><div class="panel-head"><div class="panel-title">${icon("cpu")}<h2>Operating intent</h2></div>${badge(a.status || "unknown")}</div><div class="policy-content"><form class="directive-form" id="directive-form"><label class="form-label" for="directive">Agent priorities</label><textarea class="input" id="directive" data-draft="directive" placeholder="What should the agent prioritise?">${esc(drafts.directive ?? a.directive ?? "")}</textarea><p class="field-help">Guides planning within the permitted actions.</p><button class="btn primary" ${busy.has("directive") ? "disabled" : ""}>${icon("check")}Save direction</button></form></div></section><section class="panel"><div class="panel-head"><div class="panel-title">${icon("shield")}<h2>Permitted actions</h2></div><span class="badge green">Reference scope</span></div><div class="policy-content">${policyRows.map(([key, title, desc]) => `<div class="policy-row"><div><strong style="font-weight:500">${title}</strong></div><div class="segmented" aria-label="${title}"><button data-policy="${key}" data-value="true" class="${p[key] === true ? "active" : ""}" ${busy.has("policy") ? "disabled" : ""}>On</button><button data-policy="${key}" data-value="false" class="${p[key] === false ? "active" : ""}" ${busy.has("policy") ? "disabled" : ""}>Off</button></div></div>`).join("")}<div class="policy-row"><div>Action budget<p>Maximum permitted attempts per hour</p></div><span class="policy-value">${num(p.maxActionsPerHour)} / hour</span></div><div class="policy-row"><div>Observation cadence<p>Background worker interval</p></div><span class="policy-value">${num(p.monitorIntervalSeconds || a.intervalSeconds)} seconds</span></div></div></section></div>${disclosure("tool-scope", "Permitted scope", `<p>Managed databases only. No failover, promotion or arbitrary SQL.</p><ul>${policyRows.map(([,title,desc]) => `<li><strong>${title}:</strong> ${desc}</li>`).join("")}</ul>`, "section-gap")}`;
}
function renderSchema() {
  const tables = arr(schema?.tables);
  return `${tables.length ? `<div class="toolbar schema-toolbar"><span class="muted">${num(schema.tableCount ?? tables.length)} tables · ${num(schema.columnCount ?? tables.reduce((count, t) => count + arr(t.columns).length, 0))} columns</span><div class="schema-toolbar-actions"><button class="btn small" id="schema-expand-all" data-command="schema-expand-all">Expand all columns</button><button class="btn small" id="schema-collapse-all" data-command="schema-collapse-all">Collapse all columns</button></div></div>` : ""}${
    tables.length
      ? `<div class="schema-grid">${tables
          .map(
            (t) =>
              `<article class="schema-card"><h2>${esc(t.name)}</h2><p>${esc(t.purpose || "Durable agent state.")}</p>${disclosure("schema-" + t.name, "View all columns · " + arr(t.columns).length, `<div class="schema-columns">${arr(
                t.columns,
              )
                .map(
                  (c) =>
                    `<div class="schema-column"><span>${esc(c.name)}</span><small>${esc(c.type)}</small></div>`,
                )
                .join(
                  "",
                )}</div>`)}</article>`,
          )
          .join("")}</div>`
      : `<section class="panel">${empty(schema?.error ? "Schema inspection unavailable" : "Loading schema", "The API exposes the actual control-plane tables when schema inspection is available.", false, "schema")}</section>`
  }`;
}
function renderDemo() {
  const fixtures = arr(state.demo?.fixtures);
  const info = {
    "stale-statistics": [
      "trend",
      "Stale table statistics",
      "Change table rows. Let the agent refresh stale statistics.",
    ],
    "replication-pause": [
      "db",
      "Paused standby replay",
      "Pause WAL replay and watch the agent restore replication.",
    ],
    "blocked-query": [
      "lock",
      "Blocked workload query",
      "Hold a temporary lock so the agent can find the blocker.",
    ],
    "risky-role": [
      "shield",
      "Excess role privilege",
      "Elevate the demo login and let the agent repair its privilege.",
    ],
    "slow-query": [
      "query",
      "Slow query workload",
      "Remove the fixed lookup index and investigate the query plan.",
    ],
  };
  return `${
    state.demo?.enabled === false
      ? `<section class="panel">${empty("Demo injections are disabled", "This deployment does not expose fixture controls.", false, "lock")}</section>`
      : fixtures.length
        ? `<div class="demo-grid">${fixtures
            .map((f) => {
              const [ic, fallback, desc] = info[f.id] || [
                "demo",
                f.title,
                f.description,
              ];
              return `<article class="demo-card"><div class="space-between"><div class="demo-icon">${icon(ic)}</div>${badge(f.active ? "warning" : "muted", f.active ? "Condition active" : "Ready")}</div><h2>${esc(f.title || fallback)}</h2><p>${esc(desc || f.description)}</p><div class="demo-card-footer"><button class="btn ${f.active ? "" : "primary"} small" data-fixture="${esc(f.id)}" data-active="${!f.active}" ${busy.has("fixture-" + f.id) ? "disabled" : ""}>${busy.has("fixture-" + f.id) ? "Applying…" : f.active ? "Clear condition" : "Inject scenario"} ${icon(f.active ? "check" : "bolt")}</button></div></article>`;
            })
            .join("")}</div>`
        : `<section class="panel">${empty("Waiting for scenario controls", "The API will report the available reference database scenarios.", false, "demo")}</section>`
  }<p class="watch-note">${icon("info")}Real faults, isolated demo database.</p>`;
}
function renderDrawer() {
  const root = $("#drawer-root");
  if (!drawer) {
    root.innerHTML = "";
    return;
  }
  const { type, id } = drawer;
  let item,
    title,
    body,
    meta = "";
  if (type === "incident") {
    item = arr(state.incidents).find((i) => String(i.id) === String(id));
    if (!item) {
      root.innerHTML = "";
      return;
    }
    title = item.title || human(item.kind);
    const actions = arr(state.actions).filter((a) => a.incidentId === item.id),
      reviews = arr(state.reviews).filter((r) => r.incidentId === item.id);
    meta = `<div class="badge-row">${badge(item.severity)}${badge(item.status)}</div>`;
    body = `<div class="drawer-meta"><div>First noticed<strong>${date(item.firstSeenAt)}</strong></div><div>Last observed<strong>${date(item.lastSeenAt)}</strong></div><div>Finding kind<strong>${esc(human(item.kind))}</strong></div><div>Resolution time<strong>${date(item.resolvedAt)}</strong></div></div><div class="drawer-section"><h3>Assessment</h3><p>${esc(item.summary || "See the saved observation below.")}</p></div>${disclosure("incident-evidence-" + item.id, "PostgreSQL evidence", `<pre class="evidence">${esc(json(item.evidence))}</pre>`, "drawer-section")}<div class="drawer-section"><h3>Related action attempts</h3>${actions.length ? actions.map((a) => `<button class="cell-btn detail-action" data-detail="action" data-id="${esc(a.id)}"><span><strong>${esc(a.title || human(a.tool))}</strong><small>${date(a.createdAt)}</small></span>${badge(a.status)}</button>`).join("") : "<p>No action has been attempted for this finding.</p>"}</div>${reviews.length ? `<div class="drawer-section"><h3>Human reviews</h3>${reviews.map((r) => `<button class="cell-btn detail-action" data-review-open="${esc(r.id)}"><span><strong>${esc(r.title || human(r.type))}</strong><small>${esc(r.feedback || r.reason || "")}</small></span>${badge(r.status)}</button>`).join("")}</div>` : ""}`;
  } else if (type === "action") {
    item = arr(state.actions).find((a) => String(a.id) === String(id));
    if (!item) {
      root.innerHTML = "";
      return;
    }
    title = item.title || human(item.tool);
    meta = `<div class="badge-row">${badge(item.status)}${badge(item.risk || "bounded")}</div>`;
    body = `<div class="drawer-meta"><div>Tool<strong class="mono">${esc(item.tool)}</strong></div><div>Created<strong>${date(item.createdAt)}</strong></div><div>Verified<strong>${date(item.verifiedAt)}</strong></div><div>Incident<strong>${esc(short(item.incidentId))}</strong></div></div><div class="drawer-section"><h3>Agent reason</h3><p>${esc(item.reason || "No reason recorded.")}</p></div>${item.sql ? disclosure("action-sql-" + item.id, "Database operation", `<pre class="evidence">${esc(item.sql)}</pre>`, "drawer-section") : ""}${disclosure("action-before-" + item.id, "Before the action", `<pre class="evidence">${esc(json(item.before))}</pre>`, "drawer-section")}${disclosure("action-after-" + item.id, "Verification after the action", `<pre class="evidence">${esc(json(item.after))}</pre>`, "drawer-section")}${item.incidentId ? `<button class="btn" data-detail="incident" data-id="${esc(item.incidentId)}">Related incident ${icon("arrow")}</button>` : ""}`;
  } else if (type === "query") {
    item = arr(state.queries).find(
      (q, i) => String(q.queryid || i) === String(id),
    );
    if (!item) {
      root.innerHTML = "";
      return;
    }
    title = "Query fingerprint";
    meta = badge("info", "Cumulative statement statistics");
    body = `<div class="drawer-section"><h3>Normalized SQL</h3><pre class="evidence">${esc(item.query)}</pre></div><div class="drawer-meta"><div>Query ID<strong class="mono">${esc(item.queryid)}</strong></div><div>Calls<strong>${num(item.calls)}</strong></div><div>Mean execution<strong>${num(item.meanMs, 2)} ms</strong></div><div>Total execution<strong>${num(item.totalMs, 2)} ms</strong></div><div>Rows returned / changed<strong>${num(item.rows)}</strong></div><div>Shared blocks read<strong>${num(item.sharedReadBlocks)}</strong></div></div><div class="drawer-section"><h3>Interpretation</h3><p>Counters accumulate since statistics reset. Mean time does not describe tail latency.</p></div>`;
  }
  root.innerHTML = `<div class="drawer-shade" data-command="close-drawer"></div><section class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="drawer-head"><div>${meta}<h2>${esc(title)}</h2></div><button class="drawer-close" data-command="close-drawer" aria-label="Close detail">${icon("close")}</button></header><div class="drawer-content">${body || ""}</div></section>`;
}
async function load() {
  if (polling) return;
  polling = true;
  try {
    const p = await api("/api/state");
    state = p;
    fetchError = "";
    lastFetched = new Date().toISOString();
    render();
    if (view === "schema" && !schema) loadSchema();
  } catch (e) {
    fetchError = e.message;
    render();
  } finally {
    polling = false;
  }
}
async function loadSchema() {
  try {
    schema = await api("/api/schema");
  } catch (e) {
    schema = { error: e.message };
  }
  if (view === "schema") render();
}
async function perform(key, path, body, message) {
  if (busy.has(key)) return;
  busy.add(key);
  render();
  try {
    const result = await api(path, body);
    notify(message || result.message || "Saved.");
    await load();
    return result;
  } catch (e) {
    notify(e.message, true);
  } finally {
    busy.delete(key);
    render();
  }
}
document.addEventListener("click", async (e) => {
  const button = e.target.closest("button,[data-detail],[data-command]");
  if (!button) return;
  if (button.matches(":disabled")) return;
  if (button.dataset.nav) {
    navTo(button.dataset.nav);
    return;
  }
  if (button.dataset.filterType) {
    filters[button.dataset.filterType] = button.dataset.filter;
    render();
    return;
  }
  if (button.dataset.run) {
    selectedRun = button.dataset.run;
    render();
    return;
  }
  if (button.dataset.detail) {
    drawer = { type: button.dataset.detail, id: button.dataset.id };
    renderDrawer();
    $(".drawer-close")?.focus();
    return;
  }
  if (button.dataset.reviewOpen) {
    view = "reviews";
    location.hash = "reviews";
    filters.reviews = "all";
    drawer = null;
    render();
    document
      .getElementById("review-card-" + button.dataset.reviewOpen)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (button.dataset.policy) {
    await perform(
      "policy",
      "/api/agent/control",
      { policy: { [button.dataset.policy]: button.dataset.value === "true" } },
      "Policy saved. Future actions use the updated boundary.",
    );
    return;
  }
  if (button.dataset.fixture) {
    await perform(
      "fixture-" + button.dataset.fixture,
      "/api/demo/scenarios/" + encodeURIComponent(button.dataset.fixture),
      { active: button.dataset.active === "true" },
      button.dataset.active === "true"
        ? "Scenario applied to the demo workload."
        : "Demo condition cleared.",
    );
    return;
  }
  const command = button.dataset.command;
  if (command === "schema-expand-all" || command === "schema-collapse-all") {
    for (const table of arr(schema?.tables))
      drafts["open-schema-" + table.name] = command === "schema-expand-all";
    render();
    return;
  }
  if (command === "clear-memory-search") {
    memorySearch = {query:"",keyword:"",from:"",to:"",kind:"all",result:null,error:"",loading:false}; searches.memory = ""; render(); return;
  }
  if (command === "all-memory") {
    memorySearch = {query:"",keyword:"",from:"",to:"",kind:"memory",result:null,error:"",loading:false}; searches.memory = ""; await searchMemory(); return;
  }
  if (command === "more-memory") { await searchMemory(true); return; }
  if (command === "refresh") load();
  if (command === "menu") {
    mobileOpen = !mobileOpen;
    render();
  }
  if (command === "close-drawer") {
    drawer = null;
    renderDrawer();
  }
  if (command === "toggle-agent") {
    const paused = !(
      state?.policy?.paused || state?.agent?.status === "paused"
    );
    await perform(
      "control",
      "/api/agent/control",
      { paused },
      paused ? "Agent paused." : "Agent resumed.",
    );
  }
  if (command === "cycle")
    await perform(
      "cycle",
      "/api/agent/cycle",
      {},
      "A check cycle has been requested.",
    );
});
document.addEventListener("input", (e) => {
  if (e.target.dataset.memoryField) {
    memorySearch[e.target.dataset.memoryField] = e.target.value;
    if (e.target.dataset.memoryField === "keyword") searches.memory = e.target.value;
    return;
  }
  if (e.target.dataset.draft) drafts[e.target.dataset.draft] = e.target.value;
  if (e.target.dataset.search) {
    searches[e.target.dataset.search] = e.target.value;
    render();
  }
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.memoryField) memorySearch[e.target.dataset.memoryField] = e.target.value;
});
document.addEventListener("submit", async (e) => {
  if (e.target.id === "memory-search-form") { e.preventDefault(); await searchMemory(); return; }
  if (e.target.id === "directive-form") {
    e.preventDefault();
    const directive = $("#directive").value.trim();
    await perform(
      "directive",
      "/api/agent/control",
      { directive },
      "Operating direction saved to the agent’s memory.",
    );
    return;
  }
  const id = e.target.dataset.reviewForm;
  if (id) {
    e.preventDefault();
    const decision = e.submitter?.value;
    if (!["approve", "reject", "complete"].includes(decision)) return;
    const feedback =
      document.getElementById("feedback-" + id)?.value?.trim() || "";
    await perform(
      "review-" + id,
      "/api/reviews/" + encodeURIComponent(id),
      { decision, feedback },
      decision === "approve"
        ? "Approval recorded. The agent will recheck before acting."
        : decision === "reject"
          ? "Proposal rejected. Your feedback is stored in memory."
          : "Review completed. Your feedback is stored in memory.",
    );
  }
});
document.addEventListener(
  "toggle",
  (e) => {
    if (e.target.dataset?.disclosure) drafts["open-" + e.target.dataset.disclosure] = e.target.open;
    if (e.target.dataset?.stepDetail)
      drafts["detail-" + e.target.dataset.stepDetail] = e.target.open;
  },
  true,
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drawer) {
    drawer = null;
    renderDrawer();
  }
  if (e.key === "Escape" && mobileOpen) {
    mobileOpen = false;
    render();
  }
  if (
    (e.key === "Enter" || e.key === " ") &&
    e.target.matches("tr[data-detail]")
  ) {
    e.preventDefault();
    drawer = { type: e.target.dataset.detail, id: e.target.dataset.id };
    renderDrawer();
  }
  if (e.key === "Tab" && drawer) {
    const items = [
      ...document.querySelectorAll(
        ".drawer button,.drawer textarea,.drawer input,.drawer a",
      ),
    ].filter((x) => !x.disabled);
    if (!items.length) return;
    const first = items[0],
      last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
window.addEventListener("hashchange", () => {
  const n = location.hash.slice(1);
  if (tabs.some((t) => t[0] === n) && n !== view) {
    view = n;
    drawer = null;
    render();
    if (n === "schema" && !schema) loadSchema();
  }
});
load();
setInterval(load, 4000);
