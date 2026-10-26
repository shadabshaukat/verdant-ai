import { createHash } from "node:crypto";
const stringify = (value) => JSON.stringify(value ?? {});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validUuid = (v) =>
  typeof v === "string" && UUID.test(v) ? v : null;
export function categoryFor(kind = "", relatedKind = "") {
  if (
    /human_feedback|human_directive|human\.reviewed|human\.steering/.test(kind)
  )
    return "human_feedback";
  const text = kind + " " + relatedKind;
  if (
    /stale-statistics|query-tuning|blocked-query|analyze_table|create_demo_index|cancel_demo_blocker|inspect_queries|inspect_statistics|inspect_blockers/.test(
      text,
    )
  )
    return "performance";
  if (/replicat|standby|resume_replication|inspect_replication/.test(text))
    return "replication";
  if (/risky-role|restrict_demo_role|inspect_security/.test(text))
    return "security";
  if (/target-unavailable/.test(text)) return "availability";
  if (
    /human_feedback|human_directive|human\.reviewed|human\.steering/.test(kind)
  )
    return "human_feedback";
  return "operations";
}
/** Extracts only SQL actually present in the linked durable record; never adds current global queries. */
export function extractSqlEvidence(
  value,
  reference,
  at,
  path = "",
  output = [],
  depth = 0,
) {
  if (!value || typeof value !== "object" || depth > 9 || output.length >= 100)
    return output;
  if (typeof value.query === "string" && value.query.trim())
    output.push({
      query: value.query.slice(0, 4000),
      queryId: value.queryid ?? value.queryId ?? null,
      at,
      provenance: reference + (path ? ":" + path : ""),
      scope:
        "calls" in value || "mean_ms" in value
          ? "Timestamped cumulative pg_stat_statements snapshot; not an execution log or a latency benchmark."
          : "SQL text stored in this linked record; activity/evidence snapshot, not proof of execution.",
      ...(value.calls != null
        ? {
            calls: value.calls,
            meanMs: value.mean_ms ?? null,
            totalMs: value.total_ms ?? null,
          }
        : {}),
    });
  for (const [key, child] of Object.entries(value)) {
    if (
      ["sql", "sql_template"].includes(key) &&
      typeof child === "string" &&
      child.trim()
    )
      output.push({
        query: child.slice(0, 4000),
        queryId: null,
        at,
        provenance: reference + ":" + path + key,
        scope:
          "Allowlisted SQL template recorded with this event/action; inspect execution evidence to determine whether it ran.",
      });
    else if (child && typeof child === "object")
      extractSqlEvidence(
        child,
        reference,
        at,
        path + key + ".",
        output,
        depth + 1,
      );
    if (output.length >= 100) break;
  }
  return output;
}
export function sourceDocument(type, row) {
  let sourceId,
    at,
    title,
    content,
    kind,
    incidentId,
    actionId,
    eventId = null,
    queryId = null,
    snapshot;
  if (type === "memory") {
    sourceId = row.memory_id;
    at = row.created_at;
    title = row.title;
    kind = row.kind;
    incidentId = row.incident_id;
    actionId = row.action_id;
    snapshot = {
      kind: row.kind,
      content: row.content,
      metadata: row.metadata,
      reviewId: row.review_id,
    };
    content = row.content + " " + stringify(row.metadata);
  } else if (type === "event") {
    sourceId = String(row.event_id);
    eventId = sourceId;
    at = row.recorded_at;
    title = row.title;
    kind = row.event_type;
    incidentId =
      row.incident_id ||
      row.linked_incident_id ||
      validUuid(row.detail?.arguments?.incidentId);
    actionId = row.action_id || validUuid(row.detail?.observation?.actionId);
    snapshot = {
      eventType: kind,
      severity: row.severity,
      detail: row.detail,
      generation: row.detail?.generation ?? null,
    };
    content = [
      kind,
      row.title,
      row.incident_kind,
      row.sql_template,
      stringify(row.detail),
    ]
      .filter(Boolean)
      .join(" ");
  } else if (type === "incident") {
    sourceId = row.incident_id + ":" + row.generation;
    at = row.generation_seen_at || row.first_seen_at;
    title = row.title;
    kind = row.kind;
    incidentId = row.incident_id;
    snapshot = {
      generation: row.generation,
      status: row.status,
      summary: row.summary,
      evidence: row.evidence,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      resolvedAt: row.resolved_at,
    };
    content = [row.kind, row.summary, row.status, stringify(row.evidence)].join(
      " ",
    );
  } else if (type === "action") {
    sourceId = row.action_id;
    at = row.verified_at || row.started_at || row.created_at;
    title = row.title;
    kind = row.tool;
    incidentId = row.incident_id;
    actionId = row.action_id;
    snapshot = {
      generation: row.generation,
      status: row.status,
      reason: row.reason,
      sql: row.sql_template,
      before: row.before_evidence,
      after: row.after_evidence,
      error: row.error,
      verifiedAt: row.verified_at,
    };
    content = [
      row.tool,
      row.status,
      row.reason,
      row.sql_template,
      stringify(row.before_evidence),
      stringify(row.after_evidence),
    ]
      .filter(Boolean)
      .join(" ");
  } else if (type === "query") {
    sourceId = row.observation_id + ":" + row.ordinality;
    at = row.recorded_at;
    kind = "query-statistics-snapshot";
    queryId = String(row.query.queryid || "");
    title = "Observed SQL fingerprint " + (queryId || "without identifier");
    snapshot = { query: row.query, observationId: String(row.observation_id) };
    content =
      "Performance query observation. Cumulative statistics snapshot, not individual execution or measured regression. " +
      stringify(row.query);
  } else throw new Error("Unknown index source type");
  const category =
    type === "query"
      ? "performance"
      : categoryFor(
          type === "event" ? kind + " " + title : kind,
          row.incident_kind || row.action_tool || row.metadata?.incidentKind,
        );
  const doc = {
    sourceType: type,
    sourceId: String(sourceId),
    at,
    title,
    content,
    kind,
    category,
    incidentId: validUuid(incidentId),
    actionId: validUuid(actionId),
    eventId,
    queryId,
    metadata: {
      indexVersion: "hybrid-full-1",
      snapshot,
      relatedCategory: categoryFor(
        "",
        row.incident_kind || row.metadata?.incidentKind,
      ),
      generationTimeScope:
        type === "incident"
          ? row.generation_seen_at
            ? "Generation onset from durable recurrence event (initial generation uses first seen)."
            : "Initial incident first-seen timestamp; no separate recurrence onset was supplied."
          : null,
      sourceHash: row.source_hash || null,
      generation:
        row.generation ??
        row.metadata?.generation ??
        row.detail?.generation ??
        null,
      scope:
        type === "query"
          ? "Timestamped cumulative query observation; not an execution log."
          : "Durable " +
            type +
            " record. Linked evidence is identified by source; model narrative is not verified fact.",
    },
  };
  doc.contentHash = createHash("sha256")
    .update(stringify([doc.title, doc.content, doc.category]))
    .digest("hex");
  return doc;
}
export function withinSearchInterval(at, intent = {}) {
  const time = Date.parse(at);
  return (
    Number.isFinite(time) &&
    (!intent.from || time >= Date.parse(intent.from)) &&
    (!intent.to || time < Date.parse(intent.to))
  );
}
export function actionDirectlyLinked(document, action, intent = {}) {
  if (
    !withinSearchInterval(
      action.verified_at || action.started_at || action.created_at,
      intent,
    )
  )
    return false;
  if (document.action_id) return action.action_id === document.action_id;
  const generation = document.metadata?.generation;
  return (
    generation != null &&
    document.incident_id != null &&
    action.incident_id === document.incident_id &&
    action.generation === Number(generation)
  );
}
export function eventDirectlyLinked(document, event, intent = {}) {
  if (!withinSearchInterval(event.recorded_at, intent)) return false;
  if (
    document.event_id != null &&
    String(event.event_id) === String(document.event_id)
  )
    return true;
  if (document.action_id && event.action_id === document.action_id) return true;
  const generation = document.metadata?.generation,
    eventGeneration = event.detail?.generation ?? event.action_generation;
  return (
    generation != null &&
    eventGeneration != null &&
    document.incident_id != null &&
    event.incident_id === document.incident_id &&
    Number(generation) === Number(eventGeneration)
  );
}
