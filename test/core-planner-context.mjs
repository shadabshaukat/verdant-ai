import test from "node:test";
import assert from "node:assert/strict";
import {
  historicalMemoryForPlanner,
  unverifiedModelSummary,
} from "../apps/server/planner-context.mjs";

test("historical action context cannot reintroduce stale plans or timing counters as current evidence", () => {
  const view = historicalMemoryForPlanner({
    memory_id: "old-memory",
    kind: "verified_action",
    title: "Index created in generation one",
    content: "A previous index build passed verification.",
    incident_id: "recurring-incident",
    metadata: {
      incidentKind: "query-tuning",
      generation: 1,
      before: { mean_ms: 40, customerLookupIndex: null },
      after: {
        mean_ms: 26.6,
        customerLookupIndex: { indexname: "orders_customer_id_idx" },
      },
    },
  });
  assert.equal(view.metadata.generation, 1);
  assert.equal(view.incidentId, "recurring-incident");
  assert.equal(view.metadata.before, undefined);
  assert.equal(view.metadata.after, undefined);
  assert.match(view.temporalScope, /not current health or timing evidence/);
});

test("human preferences remain recallable with their historical review provenance", () => {
  const view = historicalMemoryForPlanner({
    kind: "human_feedback",
    content: "Inspect the plan before proposing this fixed index.",
    review_id: "review-one",
    metadata: {
      decision: "completed",
      reviewType: "acknowledgement",
      generation: 2,
    },
  });
  assert.equal(view.reviewId, "review-one");
  assert.match(view.content, /Inspect the plan/);
  assert.equal(view.metadata.decision, "completed");
});

test("model completion prose is explicitly unverified and bounded", () => {
  assert.match(
    unverifiedModelSummary("Index exists because memory says so"),
    /^Model summary \(unverified\):/,
  );
  assert.ok(unverifiedModelSummary("x".repeat(5000)).length < 1600);
});
