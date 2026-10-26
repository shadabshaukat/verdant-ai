CREATE TABLE IF NOT EXISTS agent.audit_log (
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 request_id uuid NOT NULL,
 actor text NOT NULL,
 operation text NOT NULL,
 resource text NOT NULL,
 status_code integer NOT NULL CHECK(status_code BETWEEN 100 AND 599)
);
CREATE INDEX IF NOT EXISTS audit_log_time ON agent.audit_log(recorded_at DESC);
COMMENT ON TABLE agent.audit_log IS 'Authenticated console mutations and authentication events. Bodies and credentials are never logged.';
