CREATE OR REPLACE FUNCTION matchbase_validate_run_submission() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM canonical_request_version v
     WHERE v.canonical_request_version_id = NEW.canonical_request_version_id
       AND v.account_id = NEW.account_id
       AND v.match_readiness = 'ready'
  ) THEN
    RAISE EXCEPTION 'run requires a ready canonical request version' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM canonical_confirmation c
     WHERE c.canonical_request_version_id = NEW.canonical_request_version_id
       AND c.accepted = true
  ) THEN
    RAISE EXCEPTION 'run requires an accepted canonical confirmation' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM canonical_contradiction c
     WHERE c.canonical_request_version_id = NEW.canonical_request_version_id
       AND c.blocking = true AND c.resolved_at IS NULL
  ) THEN
    RAISE EXCEPTION 'run has an unresolved blocking contradiction' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projection_serving_immutable ON projection_serving;
DROP TRIGGER IF EXISTS candidate_dimension_score_count_guard ON candidate_dimension_score;
DROP TRIGGER IF EXISTS candidate_score_requires_six_dimensions ON candidate_score;
DROP FUNCTION IF EXISTS matchbase_assert_six_score_dimensions();

DROP TABLE IF EXISTS scarcity_analysis;
DROP TABLE IF EXISTS result_limitation;
DROP TABLE IF EXISTS candidate_evidenced_value;
DROP TABLE IF EXISTS candidate_explanation;
DROP TABLE IF EXISTS candidate_dimension_score;
DROP TABLE IF EXISTS candidate_score;
DROP TABLE IF EXISTS evidence_support;
DROP TABLE IF EXISTS canonical_contradiction_resolution;
DROP TABLE IF EXISTS conditional_requirement;
DROP TABLE IF EXISTS request_domain_pack_activation;
DROP FUNCTION IF EXISTS matchbase_validate_domain_pack_activation();
DROP TABLE IF EXISTS domain_pack_field;
DROP TABLE IF EXISTS domain_pack_version;
DROP TABLE IF EXISTS domain_pack;

DROP INDEX IF EXISTS evidence_item_run_access_idx;
DROP INDEX IF EXISTS projection_serving_owner_history_idx;
DROP INDEX IF EXISTS research_run_owner_history_idx;
DROP INDEX IF EXISTS canonical_request_owner_history_idx;
DROP INDEX IF EXISTS sourcing_request_owner_history_idx;
DROP INDEX IF EXISTS canonical_contradiction_account_id_idx;

ALTER TABLE canonical_contradiction
  DROP CONSTRAINT IF EXISTS canonical_contradiction_tenant_fk,
  DROP COLUMN IF EXISTS contradiction_class,
  DROP COLUMN IF EXISTS left_canonical_value,
  DROP COLUMN IF EXISTS left_canonical_locator,
  DROP COLUMN IF EXISTS right_canonical_value,
  DROP COLUMN IF EXISTS right_canonical_locator;
ALTER TABLE constraint_item
  DROP CONSTRAINT IF EXISTS constraint_item_tenant_fk,
  DROP CONSTRAINT IF EXISTS constraint_relaxation_check,
  DROP CONSTRAINT IF EXISTS constraint_relaxation_direction_check,
  DROP COLUMN IF EXISTS relaxation_direction,
  DROP COLUMN IF EXISTS relaxation_tolerance,
  DROP COLUMN IF EXISTS relaxation_unit;
ALTER TABLE canonical_confirmation
  DROP CONSTRAINT IF EXISTS canonical_confirmation_tenant_fk;
ALTER TABLE original_text_digest
  DROP CONSTRAINT IF EXISTS original_text_digest_tenant_fk;
UPDATE request_field
   SET value_state = 'explicitly_unknown', canonical_value = NULL,
       not_applicable_reason = NULL
 WHERE value_state = 'not_applicable';
ALTER TABLE request_field
  DROP CONSTRAINT IF EXISTS request_field_tenant_fk,
  DROP CONSTRAINT IF EXISTS request_field_not_applicable_check,
  DROP CONSTRAINT IF EXISTS request_field_confidence_check,
  DROP CONSTRAINT IF EXISTS request_field_value_type_check,
  DROP CONSTRAINT request_field_value_state_check,
  DROP COLUMN IF EXISTS value_type,
  DROP COLUMN IF EXISTS canonical_unit,
  DROP COLUMN IF EXISTS canonical_raw_value,
  DROP COLUMN IF EXISTS not_applicable_reason,
  DROP COLUMN IF EXISTS confidence,
  DROP COLUMN IF EXISTS translated,
  ADD CONSTRAINT request_field_value_state_check CHECK
    (value_state IN ('provided','explicitly_unknown','not_asked','empty'));
ALTER TABLE transformation_provenance
  DROP CONSTRAINT IF EXISTS transformation_provenance_tenant_fk;
ALTER TABLE canonical_language_record
  DROP CONSTRAINT IF EXISTS canonical_language_record_tenant_fk;

ALTER TABLE evidence_item
  DROP CONSTRAINT IF EXISTS evidence_item_extract_pair_check,
  DROP CONSTRAINT IF EXISTS evidence_item_effective_period_check,
  DROP CONSTRAINT IF EXISTS evidence_item_corroboration_check,
  DROP CONSTRAINT IF EXISTS evidence_item_volatility_check,
  DROP CONSTRAINT IF EXISTS evidence_item_source_tier_check,
  DROP COLUMN IF EXISTS published_at,
  DROP COLUMN IF EXISTS effective_from,
  DROP COLUMN IF EXISTS effective_to,
  DROP COLUMN IF EXISTS accessed_at,
  DROP COLUMN IF EXISTS source_tier,
  DROP COLUMN IF EXISTS extracted_support,
  DROP COLUMN IF EXISTS extracted_support_locator,
  DROP COLUMN IF EXISTS freshness_policy_version,
  DROP COLUMN IF EXISTS volatility_class,
  DROP COLUMN IF EXISTS required_corroboration;

ALTER TABLE projection_serving
  DROP CONSTRAINT IF EXISTS projection_serving_subject_check,
  DROP CONSTRAINT IF EXISTS projection_serving_run_fk,
  DROP CONSTRAINT IF EXISTS projection_serving_request_fk,
  DROP COLUMN IF EXISTS request_id,
  DROP COLUMN IF EXISTS run_id;

COMMENT ON TABLE projection_serving IS NULL;
