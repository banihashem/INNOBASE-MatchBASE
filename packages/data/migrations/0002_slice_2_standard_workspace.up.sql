-- Slice 2 is additive. It retains the accepted Slice 1 schema and data.

CREATE TABLE domain_pack (
    domain_pack_id uuid PRIMARY KEY,
    pack_key text NOT NULL UNIQUE CHECK (pack_key ~ '^[a-z][a-z0-9_]*$'),
    display_name_english text NOT NULL CHECK (length(btrim(display_name_english)) > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE domain_pack_version (
    domain_pack_version_id uuid PRIMARY KEY,
    domain_pack_id uuid NOT NULL REFERENCES domain_pack(domain_pack_id),
    version integer NOT NULL CHECK (version > 0),
    category_code text NOT NULL CHECK (category_code ~ '^[a-z][a-z0-9_]*$'),
    category_confidence_threshold numeric(4,3) NOT NULL
      CHECK (category_confidence_threshold BETWEEN 0 AND 1),
    definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
    content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('active','retired')),
    released_at timestamptz NOT NULL,
    UNIQUE (domain_pack_id, version),
    UNIQUE (domain_pack_version_id, category_code)
);

CREATE TABLE domain_pack_field (
    domain_pack_version_id uuid NOT NULL REFERENCES domain_pack_version(domain_pack_version_id),
    field_key text NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_.]*$'),
    macro_parameter text NOT NULL CHECK (macro_parameter IN
      ('product_specification','supplier_producer_profile','trade_structure_commercial_execution')),
    canonical_order integer NOT NULL CHECK (canonical_order > 0),
    value_type text NOT NULL CHECK (value_type IN
      ('text','integer','decimal','boolean','date','country_code','currency','quantity','range','enum','string_list')),
    required boolean NOT NULL DEFAULT false,
    definition jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(definition) = 'object'),
    PRIMARY KEY (domain_pack_version_id, field_key),
    UNIQUE (domain_pack_version_id, canonical_order)
);

CREATE TABLE request_domain_pack_activation (
    activation_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    owner_user_id uuid NOT NULL,
    canonical_request_version_id uuid NOT NULL,
    domain_pack_version_id uuid NOT NULL REFERENCES domain_pack_version(domain_pack_version_id),
    resolved_category_code text NOT NULL,
    category_confidence numeric(4,3) NOT NULL CHECK (category_confidence BETWEEN 0 AND 1),
    category_confirmed boolean NOT NULL,
    activation_token_hash bytea NOT NULL CHECK (octet_length(activation_token_hash) = 32),
    activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, owner_user_id) REFERENCES app_user(account_id, user_id),
    FOREIGN KEY (account_id, canonical_request_version_id)
      REFERENCES canonical_request_version(account_id, canonical_request_version_id),
    FOREIGN KEY (domain_pack_version_id, resolved_category_code)
      REFERENCES domain_pack_version(domain_pack_version_id, category_code),
    UNIQUE (account_id, owner_user_id, canonical_request_version_id),
    CHECK (expires_at > activated_at)
);

CREATE FUNCTION matchbase_validate_domain_pack_activation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE activation_threshold numeric(4,3);
BEGIN
  SELECT category_confidence_threshold INTO activation_threshold
    FROM domain_pack_version
   WHERE domain_pack_version_id = NEW.domain_pack_version_id;
  IF activation_threshold IS NULL THEN
    RAISE EXCEPTION 'domain-pack version is unavailable' USING ERRCODE = '23503';
  END IF;
  IF NOT NEW.category_confirmed AND NEW.category_confidence < activation_threshold THEN
    RAISE EXCEPTION 'low-confidence category requires explicit confirmation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER request_domain_pack_activation_threshold_guard
AFTER INSERT OR UPDATE ON request_domain_pack_activation
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION matchbase_validate_domain_pack_activation();

ALTER TABLE request_field
  DROP CONSTRAINT request_field_value_state_check,
  ADD CONSTRAINT request_field_value_state_check CHECK
    (value_state IN ('provided','explicitly_unknown','not_asked','empty','not_applicable')),
  ADD COLUMN value_type text,
  ADD COLUMN canonical_unit text,
  ADD COLUMN canonical_raw_value text,
  ADD COLUMN not_applicable_reason text,
  ADD COLUMN confidence numeric(4,3),
  ADD COLUMN translated boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT request_field_value_type_check CHECK
    (value_type IS NULL OR value_type IN
      ('text','integer','decimal','boolean','date','country_code','currency','quantity','range','enum','string_list')),
  ADD CONSTRAINT request_field_confidence_check CHECK
    (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  ADD CONSTRAINT request_field_not_applicable_check CHECK
    ((value_state = 'not_applicable' AND canonical_value IS NULL
       AND length(btrim(COALESCE(not_applicable_reason, ''))) > 0)
     OR (value_state <> 'not_applicable' AND not_applicable_reason IS NULL));

ALTER TABLE constraint_item
  ADD COLUMN relaxation_direction text,
  ADD COLUMN relaxation_tolerance numeric(20,6),
  ADD COLUMN relaxation_unit text,
  ADD CONSTRAINT constraint_relaxation_direction_check CHECK
    (relaxation_direction IS NULL OR relaxation_direction IN
      ('increase','decrease','either','exact_alternative')),
  ADD CONSTRAINT constraint_relaxation_check CHECK (
    (relaxable = false AND relaxation_direction IS NULL
      AND relaxation_tolerance IS NULL AND relaxation_unit IS NULL)
    OR
    (relaxable = true AND relaxation_direction IS NOT NULL
      AND relaxation_tolerance IS NOT NULL AND relaxation_tolerance >= 0)
  );

CREATE TABLE conditional_requirement (
    conditional_requirement_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    owner_user_id uuid NOT NULL,
    canonical_request_version_id uuid NOT NULL,
    condition_english text NOT NULL CHECK (length(btrim(condition_english)) > 0),
    required_result_english text NOT NULL CHECK (length(btrim(required_result_english)) > 0),
    requirement_level text NOT NULL CHECK (requirement_level IN ('mandatory','recommended','optional')),
    validation_locator text NOT NULL CHECK (length(btrim(validation_locator)) > 0),
    validation_digest_hmac_sha256 bytea NOT NULL
      CHECK (octet_length(validation_digest_hmac_sha256) = 32),
    validation_key_id text NOT NULL CHECK (length(btrim(validation_key_id)) > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (account_id, owner_user_id) REFERENCES app_user(account_id, user_id),
    FOREIGN KEY (account_id, canonical_request_version_id)
      REFERENCES canonical_request_version(account_id, canonical_request_version_id),
    UNIQUE (account_id, conditional_requirement_id)
);

ALTER TABLE canonical_contradiction
  ADD COLUMN contradiction_class text,
  ADD COLUMN left_canonical_value jsonb,
  ADD COLUMN left_canonical_locator text,
  ADD COLUMN right_canonical_value jsonb,
  ADD COLUMN right_canonical_locator text;

CREATE UNIQUE INDEX canonical_contradiction_account_id_idx
  ON canonical_contradiction (account_id, contradiction_id);

CREATE TABLE canonical_contradiction_resolution (
    contradiction_resolution_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    contradiction_id uuid NOT NULL,
    resolved_by_user_id uuid NOT NULL,
    resolving_canonical_request_version_id uuid NOT NULL,
    selected_alternative jsonb NOT NULL,
    resolution_reason_english text NOT NULL
      CHECK (length(btrim(resolution_reason_english)) > 0),
    resolved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (account_id, contradiction_id)
      REFERENCES canonical_contradiction(account_id, contradiction_id),
    FOREIGN KEY (account_id, resolved_by_user_id)
      REFERENCES app_user(account_id, user_id),
    FOREIGN KEY (account_id, resolving_canonical_request_version_id)
      REFERENCES canonical_request_version(account_id, canonical_request_version_id),
    UNIQUE (account_id, contradiction_id)
);

ALTER TABLE evidence_item
  ADD COLUMN published_at timestamptz,
  ADD COLUMN effective_from timestamptz,
  ADD COLUMN effective_to timestamptz,
  ADD COLUMN accessed_at timestamptz,
  ADD COLUMN source_tier text,
  ADD COLUMN extracted_support text,
  ADD COLUMN extracted_support_locator jsonb,
  ADD COLUMN freshness_policy_version text,
  ADD COLUMN volatility_class text,
  ADD COLUMN required_corroboration smallint,
  ADD CONSTRAINT evidence_item_source_tier_check CHECK
    (source_tier IS NULL OR source_tier IN ('primary','authoritative_secondary','secondary','fixture')),
  ADD CONSTRAINT evidence_item_volatility_check CHECK
    (volatility_class IS NULL OR volatility_class IN ('low','medium','high','event_driven')),
  ADD CONSTRAINT evidence_item_corroboration_check CHECK
    (required_corroboration IS NULL OR required_corroboration BETWEEN 1 AND 9),
  ADD CONSTRAINT evidence_item_effective_period_check CHECK
    (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from),
  ADD CONSTRAINT evidence_item_extract_pair_check CHECK
    ((extracted_support IS NULL) = (extracted_support_locator IS NULL));

CREATE TABLE evidence_support (
    evidence_support_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    evidence_item_id uuid NOT NULL,
    verification_status text NOT NULL CHECK (verification_status IN
      ('verified','unsupported','conflicting','stale','unknown','blocked','unreachable')),
    freshness_status text NOT NULL CHECK (freshness_status IN ('fresh','stale','unknown')),
    corroboration_status text NOT NULL CHECK (corroboration_status IN
      ('not_required','satisfied','insufficient','conflicting')),
    extracted_support_start integer,
    extracted_support_end integer,
    assessed_at timestamptz NOT NULL,
    policy_version text NOT NULL CHECK (length(btrim(policy_version)) > 0),
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, evidence_item_id)
      REFERENCES evidence_item(account_id, evidence_item_id),
    UNIQUE (account_id, evidence_support_id),
    CHECK ((extracted_support_start IS NULL AND extracted_support_end IS NULL) OR
           (extracted_support_start >= 0 AND extracted_support_end > extracted_support_start))
);

CREATE TABLE candidate_score (
    candidate_score_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    compatibility_score smallint NOT NULL CHECK (compatibility_score BETWEEN 0 AND 100),
    fit_band text NOT NULL CHECK (fit_band IN ('strong','potential','low')),
    displayed_band text NOT NULL CHECK (displayed_band IN ('strong','potential','low')),
    band_ceiling text CHECK (band_ceiling IN ('potential','low')),
    band_ceiling_reason text,
    evidence_confidence text NOT NULL CHECK (evidence_confidence IN ('high','medium','low','insufficient')),
    scoring_config_version_id uuid NOT NULL REFERENCES scoring_config_version(scoring_config_version_id),
    scored_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, candidate_id) REFERENCES candidate(account_id, candidate_id),
    UNIQUE (account_id, candidate_score_id),
    UNIQUE (account_id, run_id, candidate_id),
    CHECK ((band_ceiling IS NULL AND band_ceiling_reason IS NULL) OR
           (band_ceiling IS NOT NULL AND length(btrim(band_ceiling_reason)) > 0))
);

CREATE TABLE candidate_dimension_score (
    candidate_score_id uuid NOT NULL,
    account_id uuid NOT NULL REFERENCES account(account_id),
    dimension text NOT NULL CHECK (dimension IN
      ('category_product_fit','compliance_certification_fit','volume_capacity_fit',
       'price_tier_fit','positioning_brand_fit','geographic_reach_fit')),
    score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
    weight_percent smallint NOT NULL CHECK (weight_percent BETWEEN 1 AND 100),
    critical boolean NOT NULL DEFAULT false,
    rationale_english text NOT NULL CHECK (length(btrim(rationale_english)) > 0),
    PRIMARY KEY (candidate_score_id, dimension),
    FOREIGN KEY (account_id, candidate_score_id)
      REFERENCES candidate_score(account_id, candidate_score_id),
    CHECK (
      (dimension = 'category_product_fit' AND weight_percent = 25) OR
      (dimension = 'compliance_certification_fit' AND weight_percent = 20) OR
      (dimension = 'volume_capacity_fit' AND weight_percent = 15) OR
      (dimension = 'price_tier_fit' AND weight_percent = 15) OR
      (dimension = 'positioning_brand_fit' AND weight_percent = 15) OR
      (dimension = 'geographic_reach_fit' AND weight_percent = 10)
    )
);

CREATE TABLE candidate_explanation (
    candidate_explanation_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    explanation_kind text NOT NULL CHECK (explanation_kind IN ('positive_driver','limiting_gap')),
    rank integer NOT NULL CHECK (rank > 0),
    explanation_english text NOT NULL CHECK (length(btrim(explanation_english)) > 0),
    claim_id uuid,
    evidence_support_id uuid,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, candidate_id) REFERENCES candidate(account_id, candidate_id),
    FOREIGN KEY (account_id, claim_id) REFERENCES claim(account_id, claim_id),
    FOREIGN KEY (account_id, evidence_support_id)
      REFERENCES evidence_support(account_id, evidence_support_id),
    UNIQUE (account_id, candidate_id, explanation_kind, rank),
    CHECK ((claim_id IS NULL) = (evidence_support_id IS NULL))
);

CREATE TABLE candidate_evidenced_value (
    candidate_evidenced_value_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    value_kind text NOT NULL CHECK (value_kind IN
      ('contact_details','plant_identifiers','approval_identifiers','capacity_figures')),
    typed_value jsonb NOT NULL CHECK (jsonb_typeof(typed_value) = 'object'),
    organization_contact boolean NOT NULL DEFAULT false,
    evidence_support_id uuid NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, candidate_id) REFERENCES candidate(account_id, candidate_id),
    FOREIGN KEY (account_id, evidence_support_id)
      REFERENCES evidence_support(account_id, evidence_support_id),
    UNIQUE (account_id, candidate_evidenced_value_id),
    CHECK (value_kind <> 'contact_details' OR organization_contact = true),
    CHECK (NOT (typed_value ?| ARRAY['named_person','person_name','contact_person']))
);

CREATE TABLE result_limitation (
    result_limitation_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    limitation_kind text NOT NULL CHECK (limitation_kind IN
      ('unknown_field','not_asked_field','low_confidence_dimension','stale_evidence',
       'conflicting_evidence','degraded_stage','display_cap','screening_not_performed','advisory_boundary')),
    affected_dimension text,
    notice_english text NOT NULL CHECK (length(btrim(notice_english)) > 0),
    canonical_order integer NOT NULL CHECK (canonical_order > 0),
    FOREIGN KEY (account_id, run_id) REFERENCES run_result(account_id, run_id),
    UNIQUE (account_id, run_id, canonical_order)
);

CREATE TABLE scarcity_analysis (
    scarcity_analysis_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('scarcity','no_responsible_match')),
    unmet_constraints jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(unmet_constraints) = 'array'),
    permitted_relaxations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(permitted_relaxations) = 'array'),
    analysis_english text NOT NULL CHECK (length(btrim(analysis_english)) > 0),
    FOREIGN KEY (account_id, run_id) REFERENCES run_result(account_id, run_id),
    UNIQUE (account_id, run_id)
);

ALTER TABLE projection_serving
  ADD COLUMN request_id uuid,
  ADD COLUMN run_id uuid,
  ADD CONSTRAINT projection_serving_request_fk FOREIGN KEY (account_id, request_id)
    REFERENCES sourcing_request(account_id, request_id),
  ADD CONSTRAINT projection_serving_run_fk FOREIGN KEY (account_id, run_id)
    REFERENCES research_run(account_id, run_id),
  ADD CONSTRAINT projection_serving_subject_check CHECK
    (request_id IS NOT NULL OR run_id IS NOT NULL OR tier = 'demo') NOT VALID;

ALTER TABLE canonical_language_record
  ADD CONSTRAINT canonical_language_record_tenant_fk
  FOREIGN KEY (account_id, canonical_request_version_id)
  REFERENCES canonical_request_version(account_id, canonical_request_version_id);
ALTER TABLE transformation_provenance
  ADD CONSTRAINT transformation_provenance_tenant_fk
  FOREIGN KEY (account_id, canonical_request_version_id)
  REFERENCES canonical_request_version(account_id, canonical_request_version_id);
ALTER TABLE request_field
  ADD CONSTRAINT request_field_tenant_fk
  FOREIGN KEY (account_id, canonical_request_version_id)
  REFERENCES canonical_request_version(account_id, canonical_request_version_id);
ALTER TABLE original_text_digest
  ADD CONSTRAINT original_text_digest_tenant_fk
  FOREIGN KEY (account_id, canonical_request_version_id)
  REFERENCES canonical_request_version(account_id, canonical_request_version_id);
ALTER TABLE canonical_confirmation
  ADD CONSTRAINT canonical_confirmation_tenant_fk
  FOREIGN KEY (account_id, canonical_request_version_id)
  REFERENCES canonical_request_version(account_id, canonical_request_version_id);
ALTER TABLE constraint_item
  ADD CONSTRAINT constraint_item_tenant_fk
  FOREIGN KEY (account_id, canonical_request_version_id)
  REFERENCES canonical_request_version(account_id, canonical_request_version_id);
ALTER TABLE canonical_contradiction
  ADD CONSTRAINT canonical_contradiction_tenant_fk
  FOREIGN KEY (account_id, canonical_request_version_id)
  REFERENCES canonical_request_version(account_id, canonical_request_version_id);

CREATE INDEX sourcing_request_owner_history_idx
  ON sourcing_request (account_id, created_by_user_id, created_at DESC, request_id DESC);
CREATE INDEX canonical_request_owner_history_idx
  ON canonical_request_version (account_id, created_by_user_id, created_at DESC, canonical_request_version_id DESC);
CREATE INDEX research_run_owner_history_idx
  ON research_run (account_id, requested_by_user_id, queued_at DESC, run_id DESC);
CREATE INDEX projection_serving_owner_history_idx
  ON projection_serving (account_id, subject_user_id, served_at DESC, projection_serving_id DESC);
CREATE INDEX evidence_item_run_access_idx
  ON evidence_item (account_id, run_id, accessed_at DESC, evidence_item_id DESC);

CREATE TRIGGER domain_pack_immutable
BEFORE UPDATE OR DELETE ON domain_pack
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER domain_pack_version_immutable
BEFORE UPDATE OR DELETE ON domain_pack_version
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER domain_pack_field_immutable
BEFORE UPDATE OR DELETE ON domain_pack_field
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER request_domain_pack_activation_immutable
BEFORE UPDATE OR DELETE ON request_domain_pack_activation
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER conditional_requirement_immutable
BEFORE UPDATE OR DELETE ON conditional_requirement
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER canonical_contradiction_resolution_immutable
BEFORE UPDATE OR DELETE ON canonical_contradiction_resolution
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER evidence_support_immutable
BEFORE UPDATE OR DELETE ON evidence_support
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER candidate_score_immutable
BEFORE UPDATE OR DELETE ON candidate_score
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER candidate_dimension_score_immutable
BEFORE UPDATE OR DELETE ON candidate_dimension_score
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER candidate_explanation_immutable
BEFORE UPDATE OR DELETE ON candidate_explanation
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER candidate_evidenced_value_immutable
BEFORE UPDATE OR DELETE ON candidate_evidenced_value
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER result_limitation_immutable
BEFORE UPDATE OR DELETE ON result_limitation
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER scarcity_analysis_immutable
BEFORE UPDATE OR DELETE ON scarcity_analysis
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER projection_serving_immutable
BEFORE UPDATE OR DELETE ON projection_serving
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

CREATE FUNCTION matchbase_assert_six_score_dimensions() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target_score uuid;
BEGIN
  target_score := CASE
    WHEN TG_TABLE_NAME = 'candidate_score' THEN NEW.candidate_score_id
    ELSE COALESCE(NEW.candidate_score_id, OLD.candidate_score_id)
  END;
  IF EXISTS (SELECT 1 FROM candidate_score WHERE candidate_score_id = target_score)
     AND (SELECT count(*) FROM candidate_dimension_score
           WHERE candidate_score_id = target_score) <> 6 THEN
    RAISE EXCEPTION 'candidate score % requires exactly six dimensions', target_score
      USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER candidate_score_requires_six_dimensions
AFTER INSERT ON candidate_score
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION matchbase_assert_six_score_dimensions();

CREATE CONSTRAINT TRIGGER candidate_dimension_score_count_guard
AFTER INSERT OR UPDATE OR DELETE ON candidate_dimension_score
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION matchbase_assert_six_score_dimensions();

CREATE OR REPLACE FUNCTION matchbase_validate_run_submission() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM canonical_request_version v
     WHERE v.canonical_request_version_id = NEW.canonical_request_version_id
       AND v.account_id = NEW.account_id
       AND v.match_readiness IN ('ready', 'partially_ready')
  ) THEN
    RAISE EXCEPTION 'run requires a ready or partially ready canonical request version' USING ERRCODE = '23514';
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
       AND c.blocking = true
       AND c.resolved_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM canonical_contradiction_resolution r
          WHERE r.account_id = c.account_id
            AND r.contradiction_id = c.contradiction_id
            AND r.resolving_canonical_request_version_id = NEW.canonical_request_version_id
       )
  ) THEN
    RAISE EXCEPTION 'run has an unresolved blocking contradiction' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE UPDATE, DELETE ON
  domain_pack, domain_pack_version, domain_pack_field, request_domain_pack_activation,
  conditional_requirement, canonical_contradiction_resolution, evidence_support,
  candidate_score, candidate_dimension_score, candidate_explanation,
  candidate_evidenced_value, result_limitation, scarcity_analysis, projection_serving
FROM PUBLIC;

COMMENT ON TABLE conditional_requirement IS
  'Persists English condition/result and non-reconstructive substring-validation evidence only; submitted source-language text is prohibited.';
COMMENT ON TABLE canonical_contradiction_resolution IS
  'Append-only resolution lineage. A resolution creates a new canonical version and never mutates the contradiction baseline.';
COMMENT ON TABLE projection_serving IS
  'Append-only projection-serving ledger. Reads append; no upsert, update, or delete is permitted.';
COMMENT ON COLUMN request_field.canonical_raw_value IS
  'Optional English canonical raw value. Original-language request text is prohibited.';
