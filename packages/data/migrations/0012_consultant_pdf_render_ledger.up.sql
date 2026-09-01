CREATE UNIQUE INDEX artifact_one_consultant_pdf_per_run_idx
  ON artifact (account_id, run_id, artifact_kind);

ALTER TABLE artifact_version
  ADD COLUMN qualification_contract_version text CHECK (qualification_contract_version IS NULL OR qualification_contract_version='consultant-pdf-qualification.v1'),
  ADD COLUMN qualification_evidence jsonb,
  ADD COLUMN qualification_sha256 bytea CHECK (qualification_sha256 IS NULL OR octet_length(qualification_sha256)=32),
  ADD CONSTRAINT artifact_released_qualification_check CHECK (
    qualification_contract_version IS NULL OR
    (state <> 'released' OR (qualification_evidence IS NOT NULL AND qualification_sha256 IS NOT NULL))
  );

CREATE TABLE artifact_render_job (
  artifact_render_job_id uuid PRIMARY KEY,
  artifact_version_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES account(account_id),
  run_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','claimed','completed','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 2),
  requested_by_user_id uuid NOT NULL,
  idempotency_key_sha256 bytea NOT NULL CHECK (octet_length(idempotency_key_sha256)=32),
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  failure_detail jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (account_id,artifact_version_id) REFERENCES artifact_version(account_id,artifact_version_id),
  FOREIGN KEY (account_id,run_id) REFERENCES run_result(account_id,run_id),
  FOREIGN KEY (account_id,requested_by_user_id) REFERENCES app_user(account_id,user_id),
  UNIQUE (artifact_version_id),
  UNIQUE (account_id,run_id,idempotency_key_sha256),
  CHECK ((state='queued' AND claimed_at IS NULL AND lease_expires_at IS NULL AND completed_at IS NULL) OR
         (state='claimed' AND claimed_at IS NOT NULL AND lease_expires_at > claimed_at AND completed_at IS NULL) OR
         (state IN ('completed','failed') AND claimed_at IS NOT NULL AND lease_expires_at IS NULL AND completed_at IS NOT NULL))
);
CREATE INDEX artifact_render_job_claim_idx ON artifact_render_job(created_at,artifact_render_job_id) WHERE state IN ('queued','claimed');
