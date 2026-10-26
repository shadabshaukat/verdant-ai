import { randomBytes } from "node:crypto";
import {
  fleetError,
  normalizeFleetPolicy,
  sqlIdentifier,
  sqlLiteral,
} from "./fleet-validation.mjs";
export const ANALYZE_BODY = `DECLARE started timestamptz := clock_timestamp();
BEGIN
 IF NOT EXISTS (SELECT 1 FROM verdant_ops.analyze_allowlist WHERE schema_name=p_schema AND table_name=p_table) THEN
  RAISE EXCEPTION 'Table is not in the DBA-managed ANALYZE allowlist';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=p_schema AND c.relname=p_table AND c.relkind IN ('r','p') AND c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)) THEN
  RAISE EXCEPTION 'Helper owner must own the allowlisted table';
 END IF;
 EXECUTE pg_catalog.format('ANALYZE %I.%I',p_schema,p_table);
 RETURN pg_catalog.jsonb_build_object('schema',p_schema,'table',p_table,'startedAt',started,'completedAt',clock_timestamp());
END`;
function name(value, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 128 ||
    /[\0\r\n]/.test(value)
  )
    throw fleetError(label + " is required");
  return value.trim();
}
function dollarDelimiter(inputs) {
  let delimiter;
  do {
    delimiter = "$verdant_" + randomBytes(12).toString("hex") + "$";
  } while (inputs.some((value) => String(value).includes(delimiter)));
  return delimiter;
}
export function bootstrapSql(body = {}) {
  const endpoint = body.endpoints?.[0] || body,
    username = name(endpoint.username, "Monitor username"),
    database = name(endpoint.database, "Database"),
    role = sqlIdentifier(username),
    db = sqlIdentifier(database);
  const policy = normalizeFleetPolicy(body.policy || {});
  const roleDelimiter = dollarDelimiter([username, database]),
    ownerDelimiter = dollarDelimiter([JSON.stringify(body)]);
  let sql = `SET standard_conforming_strings=on;
-- Review and run the monitoring section as a role permitted to manage logins/grants.\n-- Set a strong password separately (for example with psql \\password); no password is included here.\nDO ${roleDelimiter} BEGIN\n IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${sqlLiteral(username)} AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) THEN\n  RAISE EXCEPTION 'Use a new dedicated non-administrative monitoring login';\n END IF;\n IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${sqlLiteral(username)}) THEN\n  CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;\n END IF;\nEND ${roleDelimiter};\nGRANT CONNECT ON DATABASE ${db} TO ${role};\nGRANT pg_monitor TO ${role};\nALTER ROLE ${role} SET default_transaction_read_only=on;\nALTER ROLE ${role} SET statement_timeout='5s';\nALTER ROLE ${role} SET lock_timeout='2s';\n`;
  const notes = [
    "pg_monitor can expose other sessions and SQL text. Use a dedicated login and review data access requirements.",
    "Provider administrators may need to apply supported grants or enable pg_stat_statements separately. The application never changes provider configuration.",
    "The monitor is read-only by connection settings; read-only defaults are not a substitute for least-privilege grants.",
  ];
  if (policy.allowAnalyze) {
    const executor = name(
      body.actionCredentials?.username,
      "Executor username",
    );
    if (executor === username)
      throw fleetError("Use a separate executor login");
    const er = sqlIdentifier(executor);
    sql += `\n-- OPTIONAL MAINTENANCE SECTION: run separately AS THE NON-SUPERUSER OWNER of every allowlisted table.\n-- This section deliberately refuses a superuser owner. Create/set the separate executor password out of band.\nDO ${ownerDelimiter} BEGIN\n IF (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN RAISE EXCEPTION 'Run optional maintenance section as the non-superuser table owner'; END IF;\n IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${sqlLiteral(executor)} AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'Executor must be a dedicated non-administrative login'; END IF;\nEND ${ownerDelimiter};\n-- A login administrator must create ${er} first if it does not exist; this section grants no role-management rights.\nCREATE SCHEMA IF NOT EXISTS verdant_ops;\nREVOKE ALL ON SCHEMA verdant_ops FROM PUBLIC;\nCREATE TABLE IF NOT EXISTS verdant_ops.analyze_allowlist(schema_name text NOT NULL,table_name text NOT NULL,PRIMARY KEY(schema_name,table_name));\nREVOKE ALL ON verdant_ops.analyze_allowlist FROM PUBLIC;\nDELETE FROM verdant_ops.analyze_allowlist;\nINSERT INTO verdant_ops.analyze_allowlist(schema_name,table_name) VALUES ${policy.tableAllowlist.map((t) => "(" + sqlLiteral(t.schema) + "," + sqlLiteral(t.table) + ")").join(",")};\nCREATE OR REPLACE FUNCTION verdant_ops.analyze_table(p_schema text,p_table text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,verdant_ops,pg_temp SET lock_timeout='2s' SET statement_timeout='10s' AS $verdant_analyze$\n${ANALYZE_BODY}\n$verdant_analyze$;\nREVOKE ALL ON FUNCTION verdant_ops.analyze_table(text,text) FROM PUBLIC;\nREVOKE ALL ON FUNCTION verdant_ops.analyze_table(text,text) FROM ${role};\nGRANT CONNECT ON DATABASE ${db} TO ${er};\nGRANT USAGE ON SCHEMA verdant_ops TO ${er};\nGRANT EXECUTE ON FUNCTION verdant_ops.analyze_table(text,text) TO ${er};\n`;
    notes.push(
      "Optional maintenance requires a separately created non-administrative executor login, a non-superuser table owner, and DBA-managed helper/allowlist ownership. The application verifies the fixed helper before executing. Only allowlisted ANALYZE is supported; VACUUM, index/role/session changes and failover remain human duties.",
    );
  }
  return {
    sql,
    scope: policy.allowAnalyze
      ? "Read-only monitor bootstrap plus separately reviewed optional bounded ANALYZE helper."
      : "Dedicated read-only monitoring grants; no maintenance helper or executor grants.",
    notes,
  };
}
