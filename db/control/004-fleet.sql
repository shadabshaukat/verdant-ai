-- Additive fleet registry. Legacy primary/standby targets and all their history remain valid.
ALTER TABLE agent.target DROP CONSTRAINT IF EXISTS target_target_id_check;
CREATE TABLE IF NOT EXISTS agent.fleet_cluster (
 cluster_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,
 provider text NOT NULL CHECK(provider IN ('self-managed','aws-rds','aws-aurora','azure','gcp','oci','generic')),
 enabled boolean NOT NULL DEFAULT true,policy jsonb NOT NULL DEFAULT '{}'::jsonb,
 action_secret text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS agent.fleet_endpoint (
 endpoint_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cluster_id uuid NOT NULL REFERENCES agent.fleet_cluster,
 target_id text NOT NULL UNIQUE REFERENCES agent.target,name text NOT NULL,role text NOT NULL CHECK(role IN ('primary','replica')),
 host text NOT NULL,port integer NOT NULL CHECK(port BETWEEN 1 AND 65535),database_name text NOT NULL,username text NOT NULL,
 ssl_mode text NOT NULL CHECK(ssl_mode IN ('verify-full','require','disable')),has_ca boolean NOT NULL DEFAULT false,
 monitor_secret text NOT NULL,enabled boolean NOT NULL DEFAULT true,snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 last_checked_at timestamptz,last_success_at timestamptz,last_error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fleet_endpoint_cluster ON agent.fleet_endpoint(cluster_id,enabled);
CREATE TABLE IF NOT EXISTS agent.fleet_metric_sample (
 sample_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,cluster_id uuid NOT NULL REFERENCES agent.fleet_cluster,
 endpoint_id uuid NOT NULL REFERENCES agent.fleet_endpoint,recorded_at timestamptz NOT NULL DEFAULT now(),metrics jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS fleet_sample_endpoint_time ON agent.fleet_metric_sample(endpoint_id,recorded_at DESC);
CREATE TABLE IF NOT EXISTS agent.fleet_action (
 fleet_action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cluster_id uuid NOT NULL REFERENCES agent.fleet_cluster,
 endpoint_id uuid NOT NULL REFERENCES agent.fleet_endpoint,incident_id uuid NOT NULL REFERENCES agent.incident,generation integer NOT NULL,
 review_id uuid REFERENCES agent.review,tool text NOT NULL CHECK(tool='analyze_table'),schema_name text NOT NULL,table_name text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending_approval','queued','running','succeeded','failed','rejected')),
 reason text NOT NULL,before_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,after_evidence jsonb,error text,actor text,
 attempts integer NOT NULL DEFAULT 0,claimed_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,verified_at timestamptz,
 UNIQUE(incident_id,generation,tool,schema_name,table_name)
);
CREATE INDEX IF NOT EXISTS fleet_action_work ON agent.fleet_action(status,created_at);
REVOKE ALL ON agent.fleet_cluster,agent.fleet_endpoint,agent.fleet_metric_sample,agent.fleet_action FROM PUBLIC;
COMMENT ON TABLE agent.fleet_cluster IS 'Encrypted remote cluster credentials and explicit per-cluster maintenance policy; deletion disables monitoring without removing history.';
COMMENT ON TABLE agent.fleet_endpoint IS 'Connection metadata and latest capability-aware remote observation. monitor_secret is application-encrypted.';
COMMENT ON TABLE agent.fleet_metric_sample IS 'Bounded numeric monitoring history, independent from latest detailed evidence and durable incident/action audit.';
COMMENT ON TABLE agent.fleet_action IS 'Separate approved/opt-in allowlisted ANALYZE executor; never consumed by the disposable demo tool registry.';
