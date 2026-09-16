-- MB-ARCH-IMPLEMENT-001 L01: additive attempt accounting and immutable stage receipts.
-- Estimates describe exposure; they are not a retroactive monetary spending cap.
ALTER TABLE consultant_workflow_job ADD COLUMN resume_count integer NOT NULL DEFAULT 0 CHECK(resume_count >= 0);
CREATE TABLE consultant_research_attempt (
  request_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  run_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  classification_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES consultant_workflow_job(job_id) ON DELETE CASCADE,
  lease_token uuid NOT NULL,
  round_id uuid NOT NULL REFERENCES consultant_research_round(round_id) ON DELETE CASCADE,
  operation_key text NOT NULL,
  stage_key text NOT NULL CHECK (stage_key ~ '^[a-f0-9]{64}$'),
  phase text NOT NULL,
  model text NOT NULL,
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  approval_sha256 text NOT NULL CHECK (approval_sha256 ~ '^[a-f0-9]{64}$'),
  estimated_exposure_usd numeric CHECK (estimated_exposure_usd >= 0),
  outcome text NOT NULL DEFAULT 'dispatch_intent' CHECK (outcome IN ('dispatch_intent','completed','failed','not_dispatched')),
  provider_outcome text NOT NULL DEFAULT 'unknown' CHECK (provider_outcome IN ('unknown','received','rejected','not_dispatched')),
  receipt jsonb,
  confirmed_cost_usd numeric CHECK (confirmed_cost_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX consultant_research_attempt_execution ON consultant_research_attempt(account_id,execution_id);
CREATE INDEX consultant_research_attempt_stage ON consultant_research_attempt(account_id,execution_id,stage_key);

CREATE TABLE consultant_research_stage (
  stage_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  run_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  classification_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES consultant_workflow_job(job_id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES consultant_research_round(round_id) ON DELETE CASCADE,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object'),
  result jsonb NOT NULL,
  result_sha256 text NOT NULL CHECK (result_sha256 ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(account_id,run_id,execution_id,manifest_sha256)
);
CREATE INDEX consultant_research_stage_execution ON consultant_research_stage(account_id,execution_id,expires_at);
CREATE FUNCTION matchbase_immutable_research_stage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Research stage receipts are immutable';
END;
$$;
CREATE TRIGGER consultant_research_stage_immutable BEFORE UPDATE ON consultant_research_stage
  FOR EACH ROW EXECUTE FUNCTION matchbase_immutable_research_stage();
