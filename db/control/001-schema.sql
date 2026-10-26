CREATE SCHEMA IF NOT EXISTS agent;
CREATE TABLE IF NOT EXISTS agent.target (
 target_id text PRIMARY KEY CHECK(target_id IN ('primary','standby')),
 name text NOT NULL, role text NOT NULL, enabled boolean NOT NULL DEFAULT true,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO agent.target(target_id,name,role) VALUES ('primary','Workload primary','primary'),('standby','Physical standby','standby') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS agent.policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), value jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO agent.policy(singleton,value) VALUES(true,'{"paused":false,"allowAutoAnalyze":true,"allowAutoIndex":true,"requireApprovalForResume":false,"requireApprovalForCancel":false,"requireApprovalForRole":false,"requireApprovalForIndex":false,"maxActionsPerHour":12,"monitorIntervalSeconds":15,"directive":"Maintain the PostgreSQL databases. Investigate before acting, verify each change and retain human feedback."}') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS agent.runtime (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), state jsonb NOT NULL DEFAULT '{}'::jsonb,
 heartbeat_at timestamptz NOT NULL DEFAULT now(), cycle_requested_at timestamptz
);
INSERT INTO agent.runtime(singleton,state) VALUES(true,'{"status":"starting","cycleCount":0}') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS agent.observation (
 observation_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 target_id text NOT NULL REFERENCES agent.target,
 recorded_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS observation_target_time ON agent.observation(target_id,recorded_at DESC);
CREATE TABLE IF NOT EXISTS agent.incident (
 incident_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 target_id text NOT NULL REFERENCES agent.target,
 fingerprint text NOT NULL UNIQUE, kind text NOT NULL, title text NOT NULL,
 severity text NOT NULL CHECK(severity IN ('info','warning','critical')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','awaiting_approval','remediating','resolved')),
 generation integer NOT NULL DEFAULT 1 CHECK(generation>0), summary text NOT NULL,
 evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 first_seen_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS incident_active ON agent.incident(status,last_seen_at DESC);
CREATE TABLE IF NOT EXISTS agent.run (
 run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text NOT NULL DEFAULT 'running',
 started_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 planner text NOT NULL DEFAULT 'monitor',model text,summary text,
 recalled_memory_ids uuid[] NOT NULL DEFAULT '{}', error text
);
CREATE TABLE IF NOT EXISTS agent.step (
 step_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES agent.run ON DELETE CASCADE,
 sequence integer NOT NULL, tool text NOT NULL, source text NOT NULL,
 reason text,arguments jsonb NOT NULL DEFAULT '{}'::jsonb,observation jsonb,
 recorded_at timestamptz NOT NULL DEFAULT now(),UNIQUE(run_id,sequence)
);
CREATE TABLE IF NOT EXISTS agent.action (
 action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 incident_id uuid NOT NULL REFERENCES agent.incident,
 generation integer NOT NULL,target_id text NOT NULL REFERENCES agent.target,
 idempotency_key text NOT NULL UNIQUE,tool text NOT NULL,title text NOT NULL,
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','pending_approval','queued','running','succeeded','failed','rejected','expired')),
 risk text NOT NULL CHECK(risk IN ('low','bounded','review')),
 reason text NOT NULL,parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
 before_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,after_evidence jsonb,
 proposed_by text NOT NULL DEFAULT 'ollama',sql_template text,
 created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,verified_at timestamptz,
 claimed_by text,claimed_until timestamptz,attempts integer NOT NULL DEFAULT 0,
 error text,UNIQUE(incident_id,generation,tool)
);
CREATE INDEX IF NOT EXISTS action_work ON agent.action(status,created_at);
CREATE TABLE IF NOT EXISTS agent.review (
 review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 incident_id uuid REFERENCES agent.incident,action_id uuid REFERENCES agent.action,
 generation integer NOT NULL DEFAULT 1 CHECK(generation>0),
 review_type text NOT NULL CHECK(review_type IN ('approval','acknowledgement','investigation')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','completed')),
 title text NOT NULL,reason text NOT NULL,evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 proposed_action jsonb,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 feedback text,reviewed_by text,UNIQUE(action_id,review_type)
);
CREATE UNIQUE INDEX IF NOT EXISTS review_one_investigation ON agent.review(incident_id,generation,review_type) WHERE review_type='investigation' AND status='pending';
CREATE TABLE IF NOT EXISTS agent.event (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 recorded_at timestamptz NOT NULL DEFAULT now(),event_type text NOT NULL,
 severity text NOT NULL DEFAULT 'info',title text NOT NULL,detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 incident_id uuid REFERENCES agent.incident,run_id uuid REFERENCES agent.run,action_id uuid REFERENCES agent.action
);
CREATE INDEX IF NOT EXISTS event_recent ON agent.event(recorded_at DESC);
CREATE TABLE IF NOT EXISTS agent.memory (
 memory_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL,title text NOT NULL,content text NOT NULL,
 incident_id uuid REFERENCES agent.incident,action_id uuid REFERENCES agent.action,review_id uuid REFERENCES agent.review,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),retrieved_count integer NOT NULL DEFAULT 0,
 search tsvector GENERATED ALWAYS AS (to_tsvector('english',coalesce(title,'')||' '||coalesce(content,''))) STORED,
 UNIQUE(review_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS memory_verified_action_once ON agent.memory(action_id) WHERE kind='verified_action';
CREATE INDEX IF NOT EXISTS memory_search ON agent.memory USING gin(search);
CREATE TABLE IF NOT EXISTS agent.lease (
 lease_key text PRIMARY KEY,owner text NOT NULL,expires_at timestamptz NOT NULL,fencing_token bigint NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS agent.demo_fixture (
 fixture_id text PRIMARY KEY,active boolean NOT NULL DEFAULT false,
 expires_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO agent.demo_fixture(fixture_id) VALUES ('stale-statistics'),('replication-pause'),('blocked-query'),('risky-role'),('slow-query') ON CONFLICT DO NOTHING;
COMMENT ON SCHEMA agent IS 'Durable state for Verdant DBA: observations, bounded decisions, actions, reviews and recalled human feedback.';
COMMENT ON TABLE agent.memory IS 'Outcome and review memory. Human feedback is durable application data, not model training.';
