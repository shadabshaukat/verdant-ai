ALTER TABLE agent.run ADD COLUMN IF NOT EXISTS cluster_id uuid REFERENCES agent.fleet_cluster;
CREATE INDEX IF NOT EXISTS run_cluster_time ON agent.run(cluster_id,started_at DESC);
CREATE TABLE IF NOT EXISTS agent.fleet_investigation (
 incident_id uuid NOT NULL REFERENCES agent.incident,
 generation integer NOT NULL,
 cluster_id uuid NOT NULL REFERENCES agent.fleet_cluster,
 run_id uuid REFERENCES agent.run,
 status text NOT NULL CHECK(status IN ('running','completed','failed')),
 attempts integer NOT NULL DEFAULT 1,
 retry_after timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
 summary text,
 recommendations text,
 provider text,
 model text,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(incident_id,generation)
);
COMMENT ON TABLE agent.fleet_investigation IS 'Bounded native-tool LLM investigation of recorded fleet evidence. Narrative is unverified; it grants no SQL execution authority.';
