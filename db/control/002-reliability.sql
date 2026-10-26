-- Forward-only control-state upgrade. Safe both on first initialization and existing demo volumes.
DO $upgrade$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='agent' AND table_name='review' AND column_name='generation'
  ) THEN
    ALTER TABLE agent.review ADD COLUMN generation integer NOT NULL DEFAULT 1 CHECK (generation>0);
    UPDATE agent.review r SET generation=a.generation FROM agent.action a WHERE r.action_id=a.action_id;
    UPDATE agent.review r SET generation=i.generation FROM agent.incident i
      WHERE r.incident_id=i.incident_id AND r.action_id IS NULL;
  END IF;
END
$upgrade$;
DROP INDEX IF EXISTS agent.review_one_investigation;
CREATE UNIQUE INDEX review_one_investigation ON agent.review(incident_id,generation,review_type)
  WHERE review_type='investigation' AND status='pending';
ALTER TABLE agent.memory DROP CONSTRAINT IF EXISTS memory_action_id_kind_key;
ALTER TABLE agent.memory DROP CONSTRAINT IF EXISTS memory_action_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS memory_verified_action_once ON agent.memory(action_id) WHERE kind='verified_action';
