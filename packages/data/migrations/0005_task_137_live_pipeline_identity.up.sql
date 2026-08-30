ALTER TABLE research_route_policy
  ADD COLUMN content_sha256 bytea;

ALTER TABLE research_route_policy
  ADD CONSTRAINT qualified_route_policy_content_digest
  CHECK (activation_state <> 'qualified' OR
         (content_sha256 IS NOT NULL AND octet_length(content_sha256) = 32))
  NOT VALID;

ALTER TABLE live_research_execution_reservation
  ADD COLUMN pipeline_identity_record jsonb;

ALTER TABLE live_research_execution_reservation
  ADD CONSTRAINT live_research_pipeline_identity_closed
  CHECK (
    pipeline_identity_record IS NULL OR (
      jsonb_typeof(pipeline_identity_record) = 'object' AND
      pipeline_identity_record ?& ARRAY[
        'schemaVersion','outputSchemaIdentifier','outputSchemaCanonicalSha256',
        'researchRoutePolicyId','routePolicyVersion','routePolicyCanonicalSha256',
        'modelPolicyVersionId','modelPolicyVersion','modelPolicyContentSha256',
        'scoringConfigVersionId','scoringConfigVersion','scoringConfigContentSha256',
        'extractionVersion'
      ] AND
      pipeline_identity_record - ARRAY[
        'schemaVersion','outputSchemaIdentifier','outputSchemaCanonicalSha256',
        'researchRoutePolicyId','routePolicyVersion','routePolicyCanonicalSha256',
        'modelPolicyVersionId','modelPolicyVersion','modelPolicyContentSha256',
        'scoringConfigVersionId','scoringConfigVersion','scoringConfigContentSha256',
        'extractionVersion'
      ] = '{}'::jsonb AND
      jsonb_typeof(pipeline_identity_record->'schemaVersion') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'outputSchemaIdentifier') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'outputSchemaCanonicalSha256') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'researchRoutePolicyId') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'routePolicyVersion') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'routePolicyCanonicalSha256') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'modelPolicyVersionId') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'modelPolicyVersion') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'modelPolicyContentSha256') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'scoringConfigVersionId') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'scoringConfigVersion') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'scoringConfigContentSha256') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'extractionVersion') = 'string' AND
      pipeline_identity_record->>'schemaVersion' = 'live-research-pipeline-identity.v1' AND
      pipeline_identity_record->>'outputSchemaIdentifier' = 'evidence-graph.v1' AND
      pipeline_identity_record->>'outputSchemaCanonicalSha256' = 'c56bb23f7aae6a8e7352d7dbf9563595cd606b4a246339d1a345c842f5553788' AND
      pipeline_identity_record->>'extractionVersion' = 'untrusted-source-boundary.v1' AND
      pipeline_identity_record->>'outputSchemaCanonicalSha256' ~ '^[0-9a-f]{64}$' AND
      pipeline_identity_record->>'routePolicyCanonicalSha256' ~ '^[0-9a-f]{64}$' AND
      pipeline_identity_record->>'modelPolicyContentSha256' ~ '^[0-9a-f]{64}$' AND
      pipeline_identity_record->>'scoringConfigContentSha256' ~ '^[0-9a-f]{64}$' AND
      pipeline_identity_record->>'researchRoutePolicyId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND
      pipeline_identity_record->>'modelPolicyVersionId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND
      pipeline_identity_record->>'scoringConfigVersionId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND
      length(btrim(pipeline_identity_record->>'routePolicyVersion')) BETWEEN 1 AND 128 AND
      length(btrim(pipeline_identity_record->>'modelPolicyVersion')) BETWEEN 1 AND 128 AND
      length(btrim(pipeline_identity_record->>'scoringConfigVersion')) BETWEEN 1 AND 128
    )
  );

CREATE FUNCTION matchbase_preserve_live_pipeline_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.pipeline_identity_record IS NOT NULL THEN
      RAISE EXCEPTION 'Live research pipeline identity is immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.pipeline_identity_record IS NOT NULL AND
     NEW.pipeline_identity_record IS DISTINCT FROM OLD.pipeline_identity_record THEN
    RAISE EXCEPTION 'Live research pipeline identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER live_research_pipeline_identity_immutable
BEFORE UPDATE OF pipeline_identity_record ON live_research_execution_reservation
FOR EACH ROW EXECUTE FUNCTION matchbase_preserve_live_pipeline_identity();

CREATE TRIGGER live_research_pipeline_identity_delete_guard
BEFORE DELETE ON live_research_execution_reservation
FOR EACH ROW EXECUTE FUNCTION matchbase_preserve_live_pipeline_identity();

CREATE FUNCTION matchbase_preserve_run_pipeline_versions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.model_policy_version_id IS DISTINCT FROM OLD.model_policy_version_id OR
      NEW.scoring_config_version_id IS DISTINCT FROM OLD.scoring_config_version_id) AND
     EXISTS (
       SELECT 1
         FROM live_research_execution_reservation r
        WHERE r.account_id=OLD.account_id AND r.run_id=OLD.run_id
          AND r.pipeline_identity_record IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Run-bound live pipeline versions are immutable after identity pin';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER research_run_live_pipeline_versions_immutable
BEFORE UPDATE OF model_policy_version_id,scoring_config_version_id ON research_run
FOR EACH ROW EXECUTE FUNCTION matchbase_preserve_run_pipeline_versions();

CREATE FUNCTION matchbase_preserve_sme_approved_scoring_config() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NULLIF(btrim(OLD.sme_approval_ref), '') IS NOT NULL THEN
    RAISE EXCEPTION 'SME-approved scoring configuration is immutable';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER sme_approved_scoring_config_immutable
BEFORE UPDATE OR DELETE ON scoring_config_version
FOR EACH ROW EXECUTE FUNCTION matchbase_preserve_sme_approved_scoring_config();

CREATE FUNCTION matchbase_preserve_pinned_pipeline_material() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pinned_id text;
BEGIN
  pinned_id := to_jsonb(OLD)->>TG_ARGV[1];
  IF EXISTS (
    SELECT 1
      FROM live_research_execution_reservation r
     WHERE r.pipeline_identity_record->>TG_ARGV[0] = pinned_id
  ) THEN
    RAISE EXCEPTION 'Pinned live pipeline material is immutable';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER model_policy_pinned_material_immutable
BEFORE UPDATE OR DELETE ON model_policy_version
FOR EACH ROW EXECUTE FUNCTION matchbase_preserve_pinned_pipeline_material(
  'modelPolicyVersionId','model_policy_version_id');

CREATE TRIGGER scoring_config_pinned_material_immutable
BEFORE UPDATE OR DELETE ON scoring_config_version
FOR EACH ROW EXECUTE FUNCTION matchbase_preserve_pinned_pipeline_material(
  'scoringConfigVersionId','scoring_config_version_id');

CREATE TRIGGER route_policy_pinned_material_immutable
BEFORE UPDATE OR DELETE ON research_route_policy
FOR EACH ROW EXECUTE FUNCTION matchbase_preserve_pinned_pipeline_material(
  'researchRoutePolicyId','research_route_policy_id');

COMMENT ON COLUMN live_research_execution_reservation.pipeline_identity_record IS
  'Closed, secret-free live pipeline identity pinned before the first provider call; historical NULL is rejected by the application on resume.';
