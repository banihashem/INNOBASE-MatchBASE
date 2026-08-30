ALTER TABLE audit_event
  ADD COLUMN event_schema_version integer NOT NULL DEFAULT 1
  CHECK (event_schema_version = 1);

ALTER TABLE audit_event ENABLE ALWAYS TRIGGER audit_event_append_only;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM PUBLIC;

CREATE TABLE audit_integrity_checkpoint (
  checkpoint_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id),
  range_start_at timestamptz NOT NULL,
  range_start_audit_id uuid NOT NULL REFERENCES audit_event(audit_id),
  range_end_at timestamptz NOT NULL,
  range_end_audit_id uuid NOT NULL REFERENCES audit_event(audit_id),
  row_count integer NOT NULL CHECK (row_count > 0),
  canonical_sha256 bytea NOT NULL CHECK (octet_length(canonical_sha256) = 32),
  previous_checkpoint_sha256 bytea CHECK (previous_checkpoint_sha256 IS NULL OR octet_length(previous_checkpoint_sha256) = 32),
  checkpoint_sha256 bytea NOT NULL UNIQUE CHECK (octet_length(checkpoint_sha256) = 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((range_start_at, range_start_audit_id) <= (range_end_at, range_end_audit_id))
);

CREATE TABLE audit_integrity_verification (
  verification_id uuid PRIMARY KEY,
  checkpoint_id uuid NOT NULL REFERENCES audit_integrity_checkpoint(checkpoint_id),
  observed_sha256 bytea NOT NULL CHECK (octet_length(observed_sha256) = 32),
  consistent boolean NOT NULL,
  affected_from_at timestamptz,
  affected_from_audit_id uuid,
  affected_to_at timestamptz,
  affected_to_audit_id uuid,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (consistent AND affected_from_at IS NULL AND affected_from_audit_id IS NULL AND affected_to_at IS NULL AND affected_to_audit_id IS NULL)
    OR
    (NOT consistent AND affected_from_at IS NOT NULL AND affected_from_audit_id IS NOT NULL AND affected_to_at IS NOT NULL AND affected_to_audit_id IS NOT NULL)
  )
);

CREATE TRIGGER audit_integrity_checkpoint_append_only
BEFORE UPDATE OR DELETE ON audit_integrity_checkpoint
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
ALTER TABLE audit_integrity_checkpoint ENABLE ALWAYS TRIGGER audit_integrity_checkpoint_append_only;

CREATE TRIGGER audit_integrity_verification_append_only
BEFORE UPDATE OR DELETE ON audit_integrity_verification
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
ALTER TABLE audit_integrity_verification ENABLE ALWAYS TRIGGER audit_integrity_verification_append_only;

REVOKE UPDATE, DELETE, TRUNCATE ON audit_integrity_checkpoint, audit_integrity_verification FROM PUBLIC;

CREATE TABLE artifact (
  artifact_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id),
  run_id uuid NOT NULL,
  artifact_kind text NOT NULL CHECK (artifact_kind = 'consultant_pdf'),
  current_version integer NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (account_id, run_id) REFERENCES run_result(account_id, run_id),
  UNIQUE (account_id, artifact_id)
);

CREATE TABLE artifact_version (
  artifact_version_id uuid PRIMARY KEY,
  artifact_id uuid NOT NULL,
  account_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL CHECK (state IN ('rendering','render_failed','qa_failed','released','withdrawn')),
  result_version text NOT NULL CHECK (length(btrim(result_version)) > 0),
  result_sha256 bytea NOT NULL CHECK (octet_length(result_sha256) = 32),
  canonical_request_version_id uuid NOT NULL,
  projection_version_id uuid NOT NULL REFERENCES projection_version(projection_version_id),
  analyst_decision_set_id text NOT NULL CHECK (length(btrim(analyst_decision_set_id)) > 0),
  scoring_config_version_id uuid NOT NULL REFERENCES scoring_config_version(scoring_config_version_id),
  model_policy_version_id uuid NOT NULL REFERENCES model_policy_version(model_policy_version_id),
  template_version text NOT NULL CHECK (length(btrim(template_version)) > 0),
  renderer text NOT NULL CHECK (length(btrim(renderer)) > 0),
  renderer_version text NOT NULL CHECK (length(btrim(renderer_version)) > 0),
  page_geometry text NOT NULL CHECK (page_geometry IN ('a4','letter')),
  storage_uri text,
  file_sha256 bytea CHECK (file_sha256 IS NULL OR octet_length(file_sha256) = 32),
  byte_size bigint CHECK (byte_size IS NULL OR byte_size > 0),
  page_count integer CHECK (page_count IS NULL OR page_count > 0),
  rendered_at timestamptz,
  released_at timestamptz,
  failure_class text CHECK (failure_class IN ('render_failure','qa_failure')),
  failure_detail jsonb,
  generated_by_subject_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (account_id, artifact_id) REFERENCES artifact(account_id, artifact_id),
  FOREIGN KEY (account_id, canonical_request_version_id) REFERENCES canonical_request_version(account_id, canonical_request_version_id),
  FOREIGN KEY (account_id, generated_by_subject_id) REFERENCES app_user(account_id, user_id),
  UNIQUE (artifact_id, version),
  UNIQUE (account_id, artifact_version_id),
  CHECK (
    state <> 'released' OR
    (storage_uri IS NOT NULL AND file_sha256 IS NOT NULL AND byte_size IS NOT NULL AND page_count IS NOT NULL AND rendered_at IS NOT NULL AND released_at IS NOT NULL)
  ),
  CHECK (state <> 'withdrawn' OR storage_uri IS NULL),
  CHECK (
    (state IN ('render_failed','qa_failed') AND failure_class IS NOT NULL AND failure_detail IS NOT NULL
      AND storage_uri IS NULL AND file_sha256 IS NULL AND byte_size IS NULL AND page_count IS NULL
      AND rendered_at IS NULL AND released_at IS NULL)
    OR
    (state NOT IN ('render_failed','qa_failed') AND failure_class IS NULL AND failure_detail IS NULL)
  )
);

CREATE TABLE artifact_qa_check (
  qa_check_id uuid PRIMARY KEY,
  artifact_version_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES account(account_id),
  check_key text NOT NULL CHECK (check_key IN (
    'band_label_equals_render_band','wave_separated_from_band','overflow_collision',
    'citation_completeness','prohibited_phrase_scan','weight_fidelity',
    'required_sections_present','template_content_leakage','truncation_disclosure',
    'contradiction_declaration','tagged_structure','doc_title_flag','veraPDF',
    'contrast_ratio','page_geometry_both','hash_and_lineage'
  )),
  outcome text NOT NULL CHECK (outcome IN ('pass','fail','warn')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  tool text,
  tool_version text,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (account_id, artifact_version_id)
    REFERENCES artifact_version(account_id, artifact_version_id),
  UNIQUE (artifact_version_id, check_key)
);

CREATE TABLE artifact_access_grant (
  grant_id uuid PRIMARY KEY,
  artifact_version_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES account(account_id),
  subject_user_id uuid NOT NULL,
  subject_tier text NOT NULL CHECK (subject_tier IN ('consultant','admin')),
  justification text,
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  url_sha256 bytea NOT NULL CHECK (octet_length(url_sha256) = 32),
  FOREIGN KEY (account_id, subject_user_id) REFERENCES app_user(account_id, user_id),
  FOREIGN KEY (account_id, artifact_version_id)
    REFERENCES artifact_version(account_id, artifact_version_id),
  UNIQUE (account_id, grant_id),
  CHECK (expires_at > issued_at),
  CHECK (subject_tier <> 'admin' OR length(btrim(justification)) > 0)
);

CREATE TABLE artifact_access_grant_revocation (
  revocation_id uuid PRIMARY KEY,
  grant_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES account(account_id),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (account_id, grant_id) REFERENCES artifact_access_grant(account_id, grant_id),
  UNIQUE (grant_id)
);

CREATE TABLE artifact_access_grant_use (
  use_id uuid PRIMARY KEY,
  grant_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES account(account_id),
  audit_id uuid NOT NULL UNIQUE REFERENCES audit_event(audit_id),
  used_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (account_id, grant_id) REFERENCES artifact_access_grant(account_id, grant_id)
);

CREATE FUNCTION matchbase_assert_artifact_release() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pass_count integer;
BEGIN
  IF NEW.state = 'released' AND (TG_OP = 'INSERT' OR OLD.state <> 'released') THEN
    SELECT count(*) INTO pass_count
      FROM artifact_qa_check
     WHERE artifact_version_id = NEW.artifact_version_id
       AND outcome = 'pass';
    IF pass_count <> 16 OR EXISTS (
      SELECT 1 FROM artifact_qa_check
       WHERE artifact_version_id = NEW.artifact_version_id
         AND outcome <> 'pass'
    ) THEN
      RAISE EXCEPTION 'artifact release requires all sixteen blocking QA checks to pass' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER artifact_release_gate
BEFORE INSERT OR UPDATE OF state ON artifact_version
FOR EACH ROW EXECUTE FUNCTION matchbase_assert_artifact_release();

CREATE FUNCTION matchbase_guard_artifact_version_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Artifact versions are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.state <> 'rendering' THEN
    RAISE EXCEPTION 'Terminal artifact versions are immutable' USING ERRCODE = '55000';
  END IF;
  IF ROW(
      OLD.artifact_version_id, OLD.artifact_id, OLD.account_id, OLD.version,
      OLD.result_version, OLD.result_sha256, OLD.canonical_request_version_id,
      OLD.projection_version_id, OLD.analyst_decision_set_id,
      OLD.scoring_config_version_id, OLD.model_policy_version_id,
      OLD.template_version, OLD.renderer, OLD.renderer_version,
      OLD.page_geometry, OLD.generated_by_subject_id, OLD.created_at
    ) IS DISTINCT FROM ROW(
      NEW.artifact_version_id, NEW.artifact_id, NEW.account_id, NEW.version,
      NEW.result_version, NEW.result_sha256, NEW.canonical_request_version_id,
      NEW.projection_version_id, NEW.analyst_decision_set_id,
      NEW.scoring_config_version_id, NEW.model_policy_version_id,
      NEW.template_version, NEW.renderer, NEW.renderer_version,
      NEW.page_geometry, NEW.generated_by_subject_id, NEW.created_at
    ) THEN
    RAISE EXCEPTION 'Artifact lineage is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.state NOT IN ('render_failed','qa_failed','released','withdrawn') THEN
    RAISE EXCEPTION 'Invalid artifact terminal transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER artifact_version_immutable_guard
BEFORE UPDATE OR DELETE ON artifact_version
FOR EACH ROW EXECUTE FUNCTION matchbase_guard_artifact_version_mutation();

CREATE TRIGGER artifact_qa_check_append_only
BEFORE UPDATE OR DELETE ON artifact_qa_check
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
ALTER TABLE artifact_qa_check ENABLE ALWAYS TRIGGER artifact_qa_check_append_only;

CREATE TRIGGER artifact_access_grant_append_only
BEFORE UPDATE OR DELETE ON artifact_access_grant
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
ALTER TABLE artifact_access_grant ENABLE ALWAYS TRIGGER artifact_access_grant_append_only;

CREATE TRIGGER artifact_access_grant_revocation_append_only
BEFORE UPDATE OR DELETE ON artifact_access_grant_revocation
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
ALTER TABLE artifact_access_grant_revocation ENABLE ALWAYS TRIGGER artifact_access_grant_revocation_append_only;

CREATE TRIGGER artifact_access_grant_use_append_only
BEFORE UPDATE OR DELETE ON artifact_access_grant_use
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
ALTER TABLE artifact_access_grant_use ENABLE ALWAYS TRIGGER artifact_access_grant_use_append_only;

REVOKE UPDATE, DELETE, TRUNCATE ON
  artifact_qa_check, artifact_access_grant,
  artifact_access_grant_revocation, artifact_access_grant_use
FROM PUBLIC;

COMMENT ON TABLE audit_integrity_checkpoint IS
  'Append-only SHA-256 checkpoint over a canonical bounded audit-event range. Verification rows identify an affected range on mismatch.';
COMMENT ON TABLE artifact_version IS
  'Immutable artifact lineage. Release is fail-closed on the complete sixteen-check G1-G14 gate set.';
