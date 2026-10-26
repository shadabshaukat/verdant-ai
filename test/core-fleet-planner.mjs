import test from "node:test";
import assert from "node:assert/strict";
import { fleetInvestigationTools, validateFleetToolCall } from "../apps/server/fleet-planner.mjs";

const response = (name, args = {}) => ({ tool_calls: [{ id: "call_1", function: { name, arguments: args } }] });
test("fleet investigation tools expose bounded reads and a narrative close with no SQL executor", () => {
  const names = fleetInvestigationTools().map(tool => tool.function.name);
  assert.ok(names.includes("inspect_queries"));
  assert.ok(names.includes("recall_memory"));
  assert.ok(!names.some(name => /execute|analyze|cancel|failover/.test(name)));
  assert.equal(validateFleetToolCall(response("inspect_tables")).name, "inspect_tables");
  assert.throws(() => validateFleetToolCall(response("execute_sql", { sql: "DROP TABLE x" })), /unavailable/);
  assert.throws(() => validateFleetToolCall(response("inspect_queries", { sql: "SELECT 1" })), /do not accept/);
  assert.throws(() => validateFleetToolCall({ content: "I ran ANALYZE" }), /native tool/);
  assert.throws(() => validateFleetToolCall({ tool_calls: [response("inspect_tables").tool_calls[0], response("inspect_queries").tool_calls[0]] }), /exactly one/);
  assert.equal(validateFleetToolCall(response("close_investigation", { summary: "A stored snapshot shows a blocker.", recommendations: "Inspect the transaction owner before making changes." })).name, "close_investigation");
  assert.throws(() => validateFleetToolCall(response("close_investigation", { summary: "ok", recommendations: "review", sql: "SELECT 1" })), /Invalid/);
});
