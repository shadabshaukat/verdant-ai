import { isStatsStale } from "./policy.mjs";
export function desiredState(tool, evidence) {
  switch (tool) {
    case "analyze_table":
      return !!evidence.tables?.[0] && !isStatsStale(evidence.tables[0]);
    case "resume_replication":
      return (
        evidence.standby?.replay_paused === false &&
        evidence.standby?.receiver_status === "streaming" &&
        evidence.primarySenders?.some(
          (r) =>
            r.state === "streaming" &&
            r.lag_bytes != null &&
            Number(r.lag_bytes) <= 65536,
        )
      );
    case "create_demo_index":
      return !!evidence.customerLookupIndex;
    case "restrict_demo_role":
      return evidence.roles?.some(
        (r) => r.rolname === "verdant_risky_login" && !r.rolcreaterole,
      );
    case "cancel_demo_blocker":
      return (
        Array.isArray(evidence.blocked) &&
        !evidence.blocked.some((r) =>
          r.blockers?.some((b) => b.applicationName === "verdant-demo-blocker"),
        )
      );
    default:
      return false;
  }
}
export function precondition(tool, evidence) {
  switch (tool) {
    case "analyze_table":
      return isStatsStale(evidence.tables?.[0]);
    case "resume_replication":
      return (
        evidence.standby?.recovery === true &&
        evidence.standby?.replay_paused === true
      );
    case "create_demo_index":
      return !evidence.customerLookupIndex;
    case "restrict_demo_role":
      return evidence.roles?.some(
        (r) =>
          r.rolname === "verdant_risky_login" && r.rolcreaterole && !r.rolsuper,
      );
    case "cancel_demo_blocker":
      return evidence.blocked?.some((r) =>
        r.blockers?.some(
          (b) =>
            b.applicationName === "verdant-demo-blocker" &&
            b.user === "verdant_demo",
        ),
      );
    default:
      return false;
  }
}
