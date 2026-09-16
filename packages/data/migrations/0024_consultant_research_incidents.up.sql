-- MB-ARCH-IMPLEMENT-001 L05: operational incidents retain ownership, never raw provider text.
CREATE TABLE consultant_research_incident (
  incident_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  run_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  classification_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('prepare','research')),
  disposition text NOT NULL CHECK (disposition IN ('cancelled','blocked_by_authority','outcome_unknown','bounded_retry','bounded_content_repair','incident_required')),
  fault_code text NOT NULL CHECK (length(fault_code) BETWEEN 1 AND 80),
  playbook_version text NOT NULL DEFAULT 'research-recovery.v1',
  occurrences integer NOT NULL DEFAULT 1 CHECK (occurrences > 0),
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(account_id,user_profile_id,run_id,execution_id,classification_id,stage,fault_code,disposition)
);
REVOKE ALL ON consultant_research_incident FROM PUBLIC;
CREATE INDEX consultant_research_incident_owner ON consultant_research_incident(account_id,user_profile_id,last_seen_at DESC);
