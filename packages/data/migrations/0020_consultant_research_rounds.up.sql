-- MB-UX-COST-001 L01. Quotes and immutable round outputs preserve prior evidence.
CREATE TABLE consultant_research_round (
  round_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  run_id uuid NOT NULL,
  classification_id uuid NOT NULL,
  round_number integer NOT NULL CHECK (round_number BETWEEN 1 AND 5),
  plan jsonb NOT NULL,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','completed','failed','cancelled')),
  execution_id uuid UNIQUE,
  approved_at timestamptz,
  completed_at timestamptz,
  output jsonb,
  continuation jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX consultant_research_round_run ON consultant_research_round(account_id,run_id,created_at);
CREATE UNIQUE INDEX consultant_research_round_active ON consultant_research_round(account_id,run_id) WHERE status='approved';
CREATE TABLE consultant_provider_call (
  request_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  run_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  classification_id uuid NOT NULL,
  phase text NOT NULL,
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX consultant_provider_call_run ON consultant_provider_call(account_id,run_id);
