export const DEFAULT_POLICY = {
  paused: false,
  allowAutoAnalyze: true,
  allowAutoIndex: true,
  requireApprovalForResume: false,
  requireApprovalForCancel: false,
  requireApprovalForRole: false,
  requireApprovalForIndex: false,
  maxActionsPerHour: 12,
  monitorIntervalSeconds: 15,
  directive:
    "Maintain the PostgreSQL databases. Investigate before acting, verify each change and retain human feedback.",
};
export const ACTION_SPECS = {
  analyze_table: {
    title: "Refresh orders planner statistics",
    kind: "stale-statistics",
    target: "primary",
    risk: "low",
    inspection: "inspect_statistics",
    sql: "SELECT ops.analyze_demo_table();",
    auto: (p) => p.allowAutoAnalyze,
  },
  resume_replication: {
    title: "Resume paused standby replay",
    kind: "replication-paused",
    target: "standby",
    risk: "bounded",
    inspection: "inspect_replication",
    sql: "SELECT ops.resume_replication();",
    auto: (p) => !p.requireApprovalForResume,
  },
  cancel_demo_blocker: {
    title: "End the tagged demo blocker",
    kind: "blocked-query",
    target: "primary",
    risk: "bounded",
    inspection: "inspect_blockers",
    sql: "SELECT ops.cancel_demo_blocker();",
    auto: (p) => !p.requireApprovalForCancel,
  },
  restrict_demo_role: {
    title: "Remove CREATEROLE from the demo login",
    kind: "risky-role",
    target: "primary",
    risk: "bounded",
    inspection: "inspect_security",
    sql: "SELECT ops.restrict_demo_role();",
    auto: (p) => !p.requireApprovalForRole,
  },
  create_demo_index: {
    title: "Index the demo customer lookup",
    kind: "query-tuning",
    target: "primary",
    risk: "bounded",
    inspection: "inspect_queries",
    sql: "SELECT ops.create_demo_index();",
    auto: (p) => p.allowAutoIndex && !p.requireApprovalForIndex,
  },
};
export function normalizePolicy(input, current = DEFAULT_POLICY) {
  const p = { ...DEFAULT_POLICY, ...current };
  const allowedBools = [
    "paused",
    "allowAutoAnalyze",
    "allowAutoIndex",
    "requireApprovalForResume",
    "requireApprovalForCancel",
    "requireApprovalForRole",
    "requireApprovalForIndex",
  ];
  for (const k of allowedBools)
    if (k in input) {
      if (typeof input[k] !== "boolean")
        throw new Error(k + " must be boolean");
      p[k] = input[k];
    }
  if ("maxActionsPerHour" in input) {
    const n = Number(input.maxActionsPerHour);
    if (!Number.isInteger(n) || n < 0 || n > 60)
      throw new Error("maxActionsPerHour must be between 0 and 60");
    p.maxActionsPerHour = n;
  }
  if ("monitorIntervalSeconds" in input) {
    const n = Number(input.monitorIntervalSeconds);
    if (!Number.isInteger(n) || n < 5 || n > 300)
      throw new Error("monitorIntervalSeconds must be between 5 and 300");
    p.monitorIntervalSeconds = n;
  }
  if ("directive" in input) {
    if (typeof input.directive !== "string" || input.directive.length > 2000)
      throw new Error("Directive must be text up to 2000 characters");
    p.directive = input.directive.trim();
  }
  return p;
}
export function validateProposal({ tool, incident, inspected, policy }) {
  const s = ACTION_SPECS[tool];
  if (!s) throw new Error("Unknown action tool");
  if (!incident || incident.status === "resolved")
    throw new Error("Incident is no longer active");
  if (incident.kind !== s.kind || incident.target_id !== s.target)
    throw new Error("Action does not match the incident target and kind");
  if (!inspected.has(s.inspection))
    throw new Error("Inspect current evidence before proposing this action");
  if (policy.paused) throw new Error("Human paused autonomous actions");
  return s;
}
export function isStatsStale(row) {
  if (!row) return false;
  const changed = Number(row.n_mod_since_analyze || 0);
  return changed > Math.max(1000, Number(row.n_live_tup || 0) * 0.1);
}
export function replicationConcern(snapshot) {
  if (!snapshot || snapshot.status !== "healthy") return "unavailable";
  if (snapshot.replication?.replayPaused) return "replication-paused";
  if (snapshot.replication?.connected === false)
    return "replication-disconnected";
  if (Number(snapshot.replication?.lagBytes) > 1024 * 1024)
    return "replication-lag";
  return null;
}
export function safeQueryText(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, 2000);
}

export function needsApproval(tool, policy, reviewStatus) {
  const spec = ACTION_SPECS[tool];
  if (!spec) throw new Error("Unknown fixed action");
  return (
    reviewStatus !== "approved" && (!spec.auto(policy) || reviewStatus != null)
  );
}
