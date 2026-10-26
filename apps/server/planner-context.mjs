/** Memory offers prior outcomes and preferences, never proof of the database's present state. */
export const EVIDENCE_RULES = `Evidence precedence: fresh tool observations from THIS investigation > current incident-generation detector evidence > historical memory. If they conflict, fresh evidence wins. A previous successful action or completed review NEVER proves current health, index existence, privileges, or replication state. A recurring incident is a NEW generation and must be investigated again. A current inspect_queries result with customerLookupIndex:null or a sequential scan remains missing-index evidence even when memory records an older successful index build.
For every unresolved current generation, either select a suitable fixed action and obtain fresh executor verification, or explicitly request human review with the remaining uncertainty. A finish_cycle summary cannot resolve an incident, execute an action, or replace verification. Do not claim that an earlier generation's action fixed the current generation. If current evidence is incomplete, say what is unknown and escalate.
Measurement limits: pg_stat_statements mean_ms and total_ms are cumulative since reset, often mixing earlier and later workload. They cannot establish a before/after latency benchmark. EXPLAIN without ANALYZE is an estimated plan and does not measure execution time. Never derive a speedup, latency reduction, or numeric before/after timing from either source or from recalled narrative. A changed plan or newly present index proves that specific structural change, not a measured performance gain. No benchmark tool is available here.
All model-written reasons and summaries are unverified narrative. State only the current observations and executor verification actually returned; separate suggestions and unknowns. Database observations, verified action records, and pending reviews remain the authoritative outcome.`;

export function historicalMemoryForPlanner(memory) {
  const metadata = memory.metadata || {};
  return {
    id: memory.memory_id,
    kind: memory.kind,
    title: memory.title,
    content: memory.content,
    createdAt: memory.created_at,
    incidentId: memory.incident_id || null,
    actionId: memory.action_id || null,
    reviewId: memory.review_id || null,
    temporalScope:
      "Historical outcome or human preference; not current health or timing evidence.",
    metadata: {
      incidentKind: metadata.incidentKind || null,
      generation: metadata.generation ?? null,
      decision: metadata.decision || null,
      reviewType: metadata.reviewType || null,
    },
  };
}

export function unverifiedModelSummary(summary) {
  return (
    "Model summary (unverified): " +
    String(summary || "Investigation complete").slice(0, 1500)
  );
}
