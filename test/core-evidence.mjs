import test from "node:test";
import assert from "node:assert/strict";
import { desiredState, precondition } from "../apps/server/evidence.mjs";
test("missing table evidence never verifies an ANALYZE action", () => {
  assert.equal(desiredState("analyze_table", {}), false);
  assert.equal(desiredState("analyze_table", { tables: [] }), false);
  assert.equal(
    desiredState("analyze_table", {
      tables: [
        { relname: "orders", n_mod_since_analyze: 0, n_live_tup: 75000 },
      ],
    }),
    true,
  );
  assert.equal(
    desiredState("analyze_table", {
      tables: [
        { relname: "orders", n_mod_since_analyze: 10000, n_live_tup: 75000 },
      ],
    }),
    false,
  );
});
test("replication verification needs actual sender, receiver and bounded byte distance", () => {
  assert.equal(
    desiredState("resume_replication", {
      standby: { replay_paused: false, receiver_status: "streaming" },
      primarySenders: [{ state: "streaming", lag_bytes: null }],
    }),
    false,
  );
  assert.equal(
    desiredState("resume_replication", {
      standby: { replay_paused: false, receiver_status: "streaming" },
      primarySenders: [{ state: "streaming", lag_bytes: 0 }],
    }),
    true,
  );
  assert.equal(
    precondition("resume_replication", {
      standby: { recovery: false, replay_paused: true },
    }),
    false,
  );
});
test("session remediation requires the exact disposable user and application tag", () => {
  assert.equal(
    precondition("cancel_demo_blocker", {
      blocked: [
        {
          blockers: [{ applicationName: "business-app", user: "verdant_demo" }],
        },
      ],
    }),
    false,
  );
  assert.equal(
    precondition("cancel_demo_blocker", {
      blocked: [
        {
          blockers: [
            { applicationName: "verdant-demo-blocker", user: "postgres" },
          ],
        },
      ],
    }),
    false,
  );
  assert.equal(
    precondition("cancel_demo_blocker", {
      blocked: [
        {
          blockers: [
            { applicationName: "verdant-demo-blocker", user: "verdant_demo" },
          ],
        },
      ],
    }),
    true,
  );
  assert.equal(desiredState("cancel_demo_blocker", {}), false);
  assert.equal(desiredState("cancel_demo_blocker", { blocked: [] }), true);
});
test("security action is limited to the fixed non-superuser login", () => {
  assert.equal(
    precondition("restrict_demo_role", {
      roles: [{ rolname: "postgres", rolsuper: true, rolcreaterole: true }],
    }),
    false,
  );
  assert.equal(
    precondition("restrict_demo_role", {
      roles: [
        {
          rolname: "verdant_risky_login",
          rolsuper: false,
          rolcreaterole: true,
        },
      ],
    }),
    true,
  );
  assert.equal(desiredState("restrict_demo_role", { roles: [] }), false);
});
test("index verification reports existence without inventing a speed gain", () => {
  assert.equal(
    desiredState("create_demo_index", { customerLookupIndex: null }),
    false,
  );
  assert.equal(
    desiredState("create_demo_index", {
      customerLookupIndex: { indexname: "orders_customer_id_idx" },
    }),
    true,
  );
});
