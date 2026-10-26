import pg from "pg";
import { db, transaction, event } from "./store.mjs";
import { errText, WORKER_ID } from "./config.mjs";
import { shutdownController } from "./lifecycle.mjs";
import { fleetConnection } from "./fleet-validation.mjs";
import { ANALYZE_BODY } from "./fleet-bootstrap.mjs";
const { Client } = pg;
export const staleTable = (t) =>
  !!t &&
  Number.isFinite(Number(t.modificationsSinceAnalyze)) &&
  Number(t.modificationsSinceAnalyze) >
    Math.max(1000, Number(t.liveRows || 0) * 0.1);
export const allowedTable = (p, schema, table) =>
  p.allowAnalyze &&
  p.tableAllowlist.some((t) => t.schema === schema && t.table === table);
async function withExecutor(cluster, endpoint, fn) {
  const c = new Client(
    fleetConnection(endpoint, cluster.actionCredentials, { action: true }),
  );
  try {
    await c.connect();
    return await fn(c);
  } finally {
    await c.end().catch(() => {});
  }
}
async function inspectHelper(c, monitorUser) {
  const row = (
    await c.query(
      `SELECT p.prosrc,p.prosecdef,p.proconfig,r.rolname AS owner,r.rolsuper AS owner_super,r.rolcreaterole AS owner_createrole,r.rolcreatedb AS owner_createdb,r.rolbypassrls AS owner_bypass,
 n.nspowner=p.proowner AS owns_schema,t.relowner=p.proowner AS owns_allowlist,
 has_function_privilege(current_user,p.oid,'EXECUTE') AS executable,has_function_privilege($1,p.oid,'EXECUTE') AS monitor_executable,
 pg_has_role(current_user,p.proowner,'MEMBER') AS executor_owner_member,
 EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x WHERE x.grantee=0 AND x.privilege_type='EXECUTE') AS public_execute,
 me.rolsuper OR me.rolcreaterole OR me.rolcreatedb OR me.rolreplication OR me.rolbypassrls AS elevated_executor,
 has_schema_privilege(current_user,n.oid,'CREATE') AS executor_schema_create,
 has_table_privilege(current_user,t.oid,'INSERT,UPDATE,DELETE,TRUNCATE') AS executor_allowlist_write
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner JOIN pg_roles me ON me.rolname=current_user
 JOIN pg_class t ON t.relnamespace=n.oid AND t.relname='analyze_allowlist'
 WHERE n.nspname='verdant_ops' AND p.proname='analyze_table' AND p.oid=to_regprocedure('verdant_ops.analyze_table(text,text)')`,
      [monitorUser],
    )
  ).rows[0];
  const config = row?.proconfig || [];
  const safe =
    !!row &&
    row.prosrc.trim() === ANALYZE_BODY.trim() &&
    row.prosecdef &&
    !row.owner_super &&
    !row.owner_createrole &&
    !row.owner_createdb &&
    !row.owner_bypass &&
    row.owns_schema &&
    row.owns_allowlist &&
    row.executable &&
    !row.monitor_executable &&
    !row.executor_owner_member &&
    !row.public_execute &&
    !row.elevated_executor &&
    !row.executor_schema_create &&
    !row.executor_allowlist_write &&
    config.includes("search_path=pg_catalog, verdant_ops, pg_temp") &&
    config.includes("lock_timeout=2s") &&
    config.includes("statement_timeout=10s");
  return {
    available: safe,
    scope:
      "Exact fixed ANALYZE helper body, protected owner/schema/allowlist, separate non-administrative executor and explicit grants.",
    ...(safe
      ? {}
      : {
          reason:
            "Helper ownership, grants, fixed body or hardened settings do not match the supported bootstrap.",
        }),
  };
}
export async function probeMaintenance(cluster, endpoint) {
  if (
    !cluster.policy.allowAnalyze ||
    endpoint.role !== "primary" ||
    !cluster.actionCredentials
  )
    return {
      available: false,
      scope: "No external writes enabled.",
      reason:
        "Enable the explicit table allowlist, separate executor and verified bootstrap helper to opt in.",
    };
  try {
    return await withExecutor(cluster, endpoint, (c) =>
      inspectHelper(c, endpoint.username),
    );
  } catch (e) {
    return {
      available: false,
      scope: "Optional bounded ANALYZE helper.",
      reason: errText(e),
    };
  }
}
export async function queueAnalyze(cluster, endpoint, incident, table) {
  if (
    !allowedTable(cluster.policy, table.schema, table.table) ||
    !endpoint.previous?.capabilities?.maintenance?.available
  )
    return false;
  return transaction(async (c) => {
    const action = (
      await c.query(
        `INSERT INTO agent.fleet_action(cluster_id,endpoint_id,incident_id,generation,tool,schema_name,table_name,status,reason,before_evidence) VALUES($1,$2,$3,$4,'analyze_table',$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING *`,
        [
          cluster.id,
          endpoint.id,
          incident.incident_id,
          incident.generation,
          table.schema,
          table.table,
          cluster.policy.autoAnalyze ? "queued" : "pending_approval",
          "Fresh table statistics exceed the modification threshold; bounded allowlisted ANALYZE only.",
          table,
        ],
      )
    ).rows[0];
    if (!action) return true;
    if (!cluster.policy.autoAnalyze) {
      const r = (
        await c.query(
          `INSERT INTO agent.review(incident_id,generation,review_type,title,reason,evidence,proposed_action) VALUES($1,$2,'approval',$3,$4,$5,$6) RETURNING review_id`,
          [
            incident.incident_id,
            incident.generation,
            "Approve allowlisted ANALYZE: " + table.schema + "." + table.table,
            action.reason,
            table,
            {
              scope: "fleet",
              clusterId: cluster.id,
              fleetActionId: action.fleet_action_id,
              tool: "analyze_table",
              schema: table.schema,
              table: table.table,
            },
          ],
        )
      ).rows[0];
      await c.query(
        "UPDATE agent.fleet_action SET review_id=$2 WHERE fleet_action_id=$1",
        [action.fleet_action_id, r.review_id],
      );
    }
    await event(
      "fleet.action_queued",
      "Allowlisted ANALYZE " +
        (cluster.policy.autoAnalyze
          ? "queued by explicit policy"
          : "requires approval"),
      {
        clusterId: cluster.id,
        fleetActionId: action.fleet_action_id,
        generation: incident.generation,
        table,
      },
      { incidentId: incident.incident_id },
      c,
    );
    return true;
  });
}
export async function readMaintenanceStats(c, schema, table) {
  const row = (
    await c.query(
      `SELECT schemaname AS schema,relname AS "table",n_live_tup::float8 AS "liveRows",n_mod_since_analyze::float8 AS "modificationsSinceAnalyze",last_analyze AS "lastAnalyze",current_setting('track_counts') AS "trackCounts",pg_is_in_recovery() AS "inRecovery" FROM pg_stat_user_tables WHERE schemaname=$1 AND relname=$2`,
      [schema, table],
    )
  ).rows[0];
  if (row && (row.trackCounts !== "on" || row.inRecovery !== false))
    throw new Error(
      "Fresh table statistics are unavailable or this endpoint is in recovery; no maintenance goal is verified.",
    );
  return row;
}
async function succeed(action, before, after, executed) {
  await transaction(async (c) => {
    const updated = (
      await c.query(
        `UPDATE agent.fleet_action SET status='succeeded',before_evidence=$2,after_evidence=$3,verified_at=now(),claimed_until=NULL,error=NULL WHERE fleet_action_id=$1 AND status='running' RETURNING *`,
        [action.fleet_action_id, before, after],
      )
    ).rows[0];
    if (!updated) return;
    await c.query(
      `UPDATE agent.incident SET status='resolved',resolved_at=now() WHERE incident_id=$1 AND generation=$2 AND status<>'resolved'`,
      [action.incident_id, action.generation],
    );
    const detail = {
      clusterId: action.cluster_id,
      fleetActionId: action.fleet_action_id,
      generation: action.generation,
      schema: action.schema_name,
      table: action.table_name,
      before,
      after,
      executed,
      sqlTemplate: executed ? "SELECT verdant_ops.analyze_table($1,$2)" : null,
      parameters: executed ? [action.schema_name, action.table_name] : [],
      scope:
        "Statistics maintenance verification; no query latency improvement is inferred.",
    };
    await c.query(
      `INSERT INTO agent.memory(kind,title,content,incident_id,metadata) VALUES('fleet_verified_action',$1,$2,$3,$4)`,
      [
        "Verified allowlisted ANALYZE: " +
          action.schema_name +
          "." +
          action.table_name,
        JSON.stringify(detail),
        action.incident_id,
        detail,
      ],
    );
    await c.query(
      `INSERT INTO agent.review(incident_id,generation,review_type,title,reason,evidence,proposed_action) VALUES($1,$2,'acknowledgement',$3,$4,$5,$6)`,
      [
        action.incident_id,
        action.generation,
        "Acknowledge verified external statistics maintenance",
        "Review the before/after evidence. Completion adds feedback to memory and does not itself alter monitoring evidence.",
        detail,
        {
          scope: "fleet",
          clusterId: action.cluster_id,
          fleetActionId: action.fleet_action_id,
          tool: "analyze_table",
        },
      ],
    );
    await event(
      "fleet.action_verified",
      "External statistics maintenance verified",
      detail,
      { incidentId: action.incident_id },
      c,
    );
  });
}
async function failure(action, error) {
  await transaction(async (c) => {
    await c.query(
      `UPDATE agent.fleet_action SET status='failed',error=$2,claimed_until=NULL WHERE fleet_action_id=$1 AND status='running'`,
      [action.fleet_action_id, errText(error)],
    );
    await c.query(
      `INSERT INTO agent.review(incident_id,generation,review_type,title,reason,evidence,proposed_action) SELECT $1,$2,'investigation','Investigate external maintenance outcome',$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM agent.review WHERE incident_id=$1 AND generation=$2 AND review_type='investigation' AND status='pending')`,
      [
        action.incident_id,
        action.generation,
        "Maintenance was not verified. No automatic retry is made after a reported failure; check the target and the audit evidence.",
        { error: errText(error), fleetActionId: action.fleet_action_id },
        {
          scope: "fleet",
          clusterId: action.cluster_id,
          fleetActionId: action.fleet_action_id,
        },
      ],
    );
    await event(
      "fleet.action_failed",
      "External maintenance requires investigation",
      {
        clusterId: action.cluster_id,
        fleetActionId: action.fleet_action_id,
        error: errText(error),
      },
      { incidentId: action.incident_id, severity: "warning" },
      c,
    );
  });
}
export async function executeFleetActions(cluster) {
  if (!cluster.enabled || shutdownController.signal.aborted) return;
  if (
    (
      await db.query(
        "SELECT coalesce((value->>'paused')::boolean,false) AS paused FROM agent.policy WHERE singleton",
      )
    ).rows[0]?.paused
  )
    return;
  const actions = (
    await db.query(
      `SELECT * FROM agent.fleet_action WHERE cluster_id=$1 AND (status IN ('pending_approval','queued') OR (status='running' AND claimed_until<now())) ORDER BY created_at LIMIT 5`,
      [cluster.id],
    )
  ).rows;
  for (const a of actions) {
    if (shutdownController.signal.aborted) break;
    const endpoint = cluster.endpoints.find(
      (e) => e.id === a.endpoint_id && e.role === "primary",
    );
    if (
      !endpoint ||
      !cluster.actionCredentials ||
      !allowedTable(cluster.policy, a.schema_name, a.table_name)
    )
      continue;
    const action = await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "fleet-action:" + cluster.id,
      ]);
      const current = (
        await c.query(
          "SELECT * FROM agent.fleet_action WHERE fleet_action_id=$1 FOR UPDATE",
          [a.fleet_action_id],
        )
      ).rows[0];
      if (
        !current ||
        !["pending_approval", "queued", "running"].includes(current.status) ||
        (current.status === "running" &&
          +new Date(current.claimed_until) > Date.now())
      )
        return null;
      if (current.attempts >= 2) {
        await c.query(
          `UPDATE agent.fleet_action SET status='failed',error='Recovery attempt limit reached; investigate without a third target write',claimed_until=NULL WHERE fleet_action_id=$1`,
          [a.fleet_action_id],
        );
        return { ...current, exhausted: true };
      }
      const review = current.review_id
        ? (
            await c.query("SELECT * FROM agent.review WHERE review_id=$1", [
              current.review_id,
            ])
          ).rows[0]
        : null;
      if (review?.status === "rejected") {
        await c.query(
          "UPDATE agent.fleet_action SET status='rejected' WHERE fleet_action_id=$1",
          [a.fleet_action_id],
        );
        return null;
      }
      const latest = (
        await c.query(
          "SELECT enabled,policy FROM agent.fleet_cluster WHERE cluster_id=$1 AND deleted_at IS NULL",
          [cluster.id],
        )
      ).rows[0];
      if (
        !latest?.enabled ||
        !allowedTable(latest.policy, a.schema_name, a.table_name)
      )
        return null;
      if (!latest.policy.autoAnalyze && review?.status !== "approved") {
        if (!review) {
          const r = (
            await c.query(
              `INSERT INTO agent.review(incident_id,generation,review_type,title,reason,evidence,proposed_action) VALUES($1,$2,'approval',$3,$4,$5,$6) RETURNING review_id`,
              [
                a.incident_id,
                a.generation,
                "Approve allowlisted ANALYZE: " +
                  a.schema_name +
                  "." +
                  a.table_name,
                "Current cluster policy requires exact-action approval.",
                a.before_evidence,
                {
                  scope: "fleet",
                  clusterId: cluster.id,
                  fleetActionId: a.fleet_action_id,
                  tool: "analyze_table",
                  schema: a.schema_name,
                  table: a.table_name,
                },
              ],
            )
          ).rows[0];
          await c.query(
            "UPDATE agent.fleet_action SET status='pending_approval',review_id=$2 WHERE fleet_action_id=$1",
            [a.fleet_action_id, r.review_id],
          );
        }
        return null;
      }
      const paused = (
        await c.query(
          "SELECT coalesce((value->>'paused')::boolean,false) AS paused FROM agent.policy WHERE singleton",
        )
      ).rows[0]?.paused;
      if (paused) return null;
      const live = (
        await c.query(
          "SELECT EXISTS(SELECT 1 FROM agent.lease WHERE lease_key='worker' AND owner=$1 AND expires_at>now()) AS ok",
          [WORKER_ID],
        )
      ).rows[0].ok;
      if (!live) return null;
      const incident = (
        await c.query(
          "SELECT status,generation FROM agent.incident WHERE incident_id=$1",
          [a.incident_id],
        )
      ).rows[0];
      if (
        !incident ||
        incident.generation !== a.generation ||
        incident.status === "resolved"
      )
        return null;
      const budget = (
        await c.query(
          "SELECT count(*)::int AS n FROM agent.fleet_action WHERE cluster_id=$1 AND started_at>now()-interval '1 hour' AND fleet_action_id<>$2",
          [cluster.id, a.fleet_action_id],
        )
      ).rows[0].n;
      if (budget >= latest.policy.maxActionsPerHour) return null;
      return (
        await c.query(
          `UPDATE agent.fleet_action SET status='running',attempts=attempts+1,started_at=coalesce(started_at,now()),claimed_until=now()+interval '90 seconds',actor=$2 WHERE fleet_action_id=$1 RETURNING *`,
          [
            a.fleet_action_id,
            review?.reviewed_by || "explicit-cluster-auto-policy",
          ],
        )
      ).rows[0];
    });
    if (!action) continue;
    if (action.exhausted) {
      await failure(
        { ...action, status: "running" },
        new Error(
          "Expired attempt limit reached; no third target write was dispatched.",
        ),
      );
      continue;
    }
    try {
      await withExecutor(cluster, endpoint, async (c) => {
        const helper = await inspectHelper(c, endpoint.username);
        if (!helper.available) throw new Error(helper.reason);
        const before = await readMaintenanceStats(
          c,
          a.schema_name,
          a.table_name,
        );
        if (!before)
          throw new Error("Allowlisted table evidence is unavailable.");
        if (!staleTable(before)) {
          await succeed(action, before, before, false);
          return;
        }
        if (shutdownController.signal.aborted)
          throw new Error("Worker stopped before target dispatch.");
        // Control and target transactions are separate. Restart recovery rechecks fresh evidence before any bounded retry.
        await db.query(
          "UPDATE agent.fleet_action SET before_evidence=$2 WHERE fleet_action_id=$1",
          [action.fleet_action_id, before],
        );
        const gate = (
          await db.query(
            `SELECT fc.enabled,fc.deleted_at,fc.policy,fc.action_secret,fc.updated_at,fe.enabled AS endpoint_enabled,fe.updated_at AS endpoint_updated_at,fr.status AS review_status,i.generation,i.status AS incident_status,coalesce((p.value->>'paused')::boolean,false) AS paused,EXISTS(SELECT 1 FROM agent.lease WHERE lease_key='worker' AND owner=$3 AND expires_at>now()) AS leased FROM agent.fleet_cluster fc JOIN agent.fleet_endpoint fe ON fe.cluster_id=fc.cluster_id JOIN agent.incident i ON i.incident_id=$4 CROSS JOIN agent.policy p LEFT JOIN agent.review fr ON fr.review_id=$5 WHERE fc.cluster_id=$1 AND fe.endpoint_id=$2 AND p.singleton`,
            [
              cluster.id,
              endpoint.id,
              WORKER_ID,
              action.incident_id,
              action.review_id,
            ],
          )
        ).rows[0];
        if (
          !gate?.enabled ||
          gate.deleted_at ||
          !gate.endpoint_enabled ||
          gate.paused ||
          !gate.leased ||
          gate.generation !== action.generation ||
          gate.incident_status === "resolved" ||
          !allowedTable(gate.policy, a.schema_name, a.table_name) ||
          (!gate.policy.autoAnalyze && gate.review_status !== "approved") ||
          gate.action_secret !== cluster.row.action_secret ||
          +new Date(gate.updated_at) !== +new Date(cluster.row.updated_at) ||
          +new Date(gate.endpoint_updated_at) !==
            +new Date(endpoint.configurationVersion)
        )
          throw new Error(
            "Current policy, connection configuration, approval or worker lease changed before dispatch; no target write was made.",
          );
        await c.query("SELECT verdant_ops.analyze_table($1,$2) AS receipt", [
          a.schema_name,
          a.table_name,
        ]);
        let after = null;
        for (let i = 0; i < 10; i++) {
          await c.query("SELECT pg_stat_clear_snapshot()");
          after = await readMaintenanceStats(c, a.schema_name, a.table_name);
          if (
            after &&
            !staleTable(after) &&
            after.lastAnalyze &&
            +new Date(after.lastAnalyze) > (+new Date(before.lastAnalyze) || 0)
          )
            break;
          await new Promise((r) => setTimeout(r, 500));
        }
        if (
          !after ||
          staleTable(after) ||
          !after.lastAnalyze ||
          !(+new Date(after.lastAnalyze) > (+new Date(before.lastAnalyze) || 0))
        )
          throw new Error(
            "ANALYZE dispatched but fresh statistics verification is inconclusive; inspect before retry.",
          );
        await succeed(action, before, after, true);
      });
    } catch (e) {
      await failure(action, e);
    }
  }
}
