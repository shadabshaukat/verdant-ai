import pg from "pg";
import { pools, poolConfig, DEMO_ENABLED, errText } from "./config.mjs";
import { db, event, requestCycle } from "./store.mjs";
const { Client } = pg;
const sessions = new Map();
export const fixtureInfo = [
  {
    id: "stale-statistics",
    title: "Stale planner statistics",
    description:
      "Modify 10,000 demo rows. The agent can inspect and ANALYZE app.orders.",
  },
  {
    id: "replication-pause",
    title: "Pause standby replay",
    description:
      "Pause real physical WAL replay. Monitoring detects the pause and WAL backlog.",
  },
  {
    id: "blocked-query",
    title: "Blocking transaction",
    description:
      "Hold a demo row lock for up to 90 seconds and start a waiting update. Only this tagged blocker is eligible for automatic termination.",
  },
  {
    id: "risky-role",
    title: "Elevated demo login",
    description:
      "Grant CREATEROLE to the fixed demo login. The agent can remove it after inspecting role posture.",
  },
  {
    id: "slow-query",
    title: "Customer lookup without index",
    description:
      "Remove only the demo customer index and execute repeated customer lookups. The agent can inspect EXPLAIN and build that fixed index.",
  },
];
export async function setFixture(id, active = true) {
  if (!DEMO_ENABLED)
    throw Object.assign(new Error("Demo fault injection is disabled"), {
      statusCode: 403,
    });
  if (!fixtureInfo.some((f) => f.id === id))
    throw Object.assign(new Error("Unknown demo scenario"), {
      statusCode: 404,
    });
  const detail = { disposableDemo: true };
  switch (id) {
    case "stale-statistics":
      detail.result = (
        await pools.PRIMARY_DEMO.query("SELECT ops.set_stale_statistics($1)", [
          active,
        ])
      ).rows;
      break;
    case "replication-pause":
      detail.result = (
        await pools.STANDBY_DEMO.query(
          active
            ? "SELECT ops.pause_replication()"
            : "SELECT ops.resume_replication()",
        )
      ).rows;
      break;
    case "risky-role":
      detail.result = (
        await pools.PRIMARY_DEMO.query("SELECT ops.set_risky_role($1)", [
          active,
        ])
      ).rows;
      break;
    case "slow-query":
      if (active) {
        await pools.PRIMARY_DEMO.query("SELECT ops.drop_demo_index()");
        for (let i = 0; i < 12; i++)
          await pools.PRIMARY_DEMO.query(
            "SELECT sum(amount) FROM app.orders WHERE customer_id=42",
          );
      }
      await pools.PRIMARY_DEMO.query("SELECT ops.set_fixture_flag($1,$2)", [
        "slow-query",
        active,
      ]);
      break;
    case "blocked-query":
      if (active) {
        if (sessions.has(id)) return { active: true, alreadyActive: true };
        const blocker = new Client({
          ...poolConfig("PRIMARY_DEMO"),
          application_name: "verdant-demo-blocker",
          statement_timeout: 100000,
          query_timeout: 100000,
        });
        const victim = new Client({
          ...poolConfig("PRIMARY_DEMO"),
          application_name: "verdant-demo-victim",
          statement_timeout: 95000,
          query_timeout: 100000,
        });
        blocker.on("error", () => {});
        victim.on("error", () => {});
        await blocker.connect();
        await victim.connect();
        await blocker.query("BEGIN");
        await blocker.query(
          "UPDATE app.orders SET updated_at=updated_at WHERE id=1",
        );
        const close = async () => {
          sessions.delete(id);
          await Promise.allSettled([blocker.end(), victim.end()]);
          await db.query(
            `UPDATE agent.demo_fixture SET active=false,expires_at=NULL WHERE fixture_id=$1`,
            [id],
          );
        };
        sessions.set(id, { close });
        void blocker
          .query("SELECT pg_sleep(90)")
          .then(() => blocker.query("COMMIT"))
          .catch(() => {});
        void victim
          .query("UPDATE app.orders SET updated_at=updated_at WHERE id=1")
          .then(() => close())
          .catch(() => close());
        const timer = setTimeout(close, 91000);
        timer.unref();
        await pools.PRIMARY_DEMO.query("SELECT ops.set_fixture_flag($1,true)", [
          "blocked-query",
        ]);
        detail.timeoutSeconds = 90;
      } else {
        await sessions.get(id)?.close();
        await pools.PRIMARY_DEMO.query(
          "SELECT ops.set_fixture_flag($1,false)",
          ["blocked-query"],
        );
      }
      break;
  }
  await db.query(
    `INSERT INTO agent.demo_fixture(fixture_id,active,expires_at,detail) VALUES($1,$2,CASE WHEN $1='blocked-query' AND $2 THEN now()+interval '90 seconds' ELSE NULL END,$3) ON CONFLICT(fixture_id) DO UPDATE SET active=EXCLUDED.active,expires_at=EXCLUDED.expires_at,updated_at=now(),detail=EXCLUDED.detail`,
    [id, active, detail],
  );
  await event(
    "demo.injected",
    (active ? "Injected: " : "Cleared: ") +
      fixtureInfo.find((f) => f.id === id).title,
    { fixtureId: id, active, ...detail },
  );
  await requestCycle();
  return { id, active, ...detail };
}
export async function closeFixtures() {
  await Promise.allSettled([...sessions.values()].map((s) => s.close()));
}
