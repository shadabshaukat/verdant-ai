import { workerHealth } from "./lifecycle.mjs";
/** Console readiness requires its migrated store; worker health is reported independently. */
export async function readinessSnapshot(query, now = Date.now()) {
  try {
    const schema = (
      await query(
        "SELECT to_regclass('agent.policy') AS policy,to_regclass('agent.runtime') AS runtime,to_regclass('agent.search_document') AS search_document,to_regclass('agent.fleet_cluster') AS fleet_cluster,to_regclass('agent.model_profile') AS model_profile,to_regclass('agent.audit_log') AS audit_log",
      )
    ).rows[0];
    if (!schema?.policy || !schema.runtime || !schema.search_document || !schema.fleet_cluster || !schema.model_profile || !schema.audit_log)
      return {
        statusCode: 503,
        body: {
          status: "not_ready",
          service: "verdant-console",
          control: "schema_not_ready",
        },
      };
    const runtime = (
      await query(
        "SELECT heartbeat_at,state FROM agent.runtime WHERE singleton",
      )
    ).rows[0];
    if (!runtime)
      return {
        statusCode: 503,
        body: {
          status: "not_ready",
          service: "verdant-console",
          control: "runtime_not_initialized",
        },
      };
    return {
      statusCode: 200,
      body: {
        status: "ready",
        service: "verdant-console",
        control: "ready",
        worker: workerHealth(runtime, now),
      },
    };
  } catch {
    return {
      statusCode: 503,
      body: {
        status: "not_ready",
        service: "verdant-console",
        control: "unavailable",
      },
    };
  }
}
