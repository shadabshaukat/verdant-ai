CREATE TABLE IF NOT EXISTS agent.model_profile (
  profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  provider text NOT NULL CHECK (provider IN ('ollama','openai','bedrock','oci')),
  purpose text NOT NULL DEFAULT 'chat' CHECK (purpose='chat'),
  base_url text NOT NULL DEFAULT '',
  model text NOT NULL,
  region text NOT NULL DEFAULT '',
  compartment_id text NOT NULL DEFAULT '',
  auth_type text NOT NULL CHECK (auth_type IN ('none','apiKey','awsDefault','awsKeys','ociApiKey')),
  credentials_sealed text,
  active boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  last_test_revision integer,
  last_test_at timestamptz,
  last_test_status text NOT NULL DEFAULT 'untested' CHECK (last_test_status IN ('untested','passed','failed')),
  last_test_message text,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (provider IN ('ollama','openai') AND auth_type IN ('none','apiKey')) OR
    (provider='bedrock' AND auth_type IN ('awsDefault','awsKeys')) OR
    (provider='oci' AND auth_type='ociApiKey')
  ),
  CHECK (NOT active OR (last_test_revision IS NOT NULL AND last_test_status='passed' AND last_test_revision=revision))
);
CREATE UNIQUE INDEX IF NOT EXISTS model_profile_name ON agent.model_profile(lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS model_profile_one_active_chat ON agent.model_profile(purpose) WHERE active;
REVOKE ALL ON agent.model_profile FROM PUBLIC;
COMMENT ON TABLE agent.model_profile IS 'Server-side chat model connection profiles. Secrets are application-encrypted; only a successfully tested revision can be active. Embedding space is separately configured.';
COMMENT ON COLUMN agent.model_profile.credentials_sealed IS 'Opaque authenticated-encryption envelope; never returned by the model profile API.';
