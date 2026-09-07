-- MB-UX-LIVE-001 L01: durable Consultant progress, execution attempts and jobs.
ALTER TABLE consultant_workflow_session
  ADD COLUMN workflow_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE consultant_workflow_job (
  job_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  user_profile_id uuid NOT NULL,
  run_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  classification_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('prepare', 'research')),
  mode text NOT NULL CHECK (mode IN ('live', 'demonstration', 'hybrid')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  lease_token uuid,
  lease_until timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (execution_id, stage)
);
CREATE UNIQUE INDEX consultant_workflow_job_one_active
  ON consultant_workflow_job(account_id, run_id) WHERE status IN ('queued', 'running');
CREATE INDEX consultant_workflow_job_queue ON consultant_workflow_job(status, created_at);

CREATE TABLE consultant_workflow_event (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL,
  user_profile_id uuid NOT NULL,
  run_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  classification_id uuid NOT NULL,
  phase text NOT NULL,
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX consultant_workflow_event_execution
  ON consultant_workflow_event(account_id, execution_id, event_id);
