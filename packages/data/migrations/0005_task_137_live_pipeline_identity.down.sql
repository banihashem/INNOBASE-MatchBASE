DROP TRIGGER IF EXISTS route_policy_pinned_material_immutable ON research_route_policy;
DROP TRIGGER IF EXISTS scoring_config_pinned_material_immutable ON scoring_config_version;
DROP TRIGGER IF EXISTS model_policy_pinned_material_immutable ON model_policy_version;
DROP FUNCTION IF EXISTS matchbase_preserve_pinned_pipeline_material();

DROP TRIGGER IF EXISTS sme_approved_scoring_config_immutable
  ON scoring_config_version;
DROP FUNCTION IF EXISTS matchbase_preserve_sme_approved_scoring_config();

DROP TRIGGER IF EXISTS research_run_live_pipeline_versions_immutable ON research_run;
DROP FUNCTION IF EXISTS matchbase_preserve_run_pipeline_versions();

DROP TRIGGER IF EXISTS live_research_pipeline_identity_delete_guard
  ON live_research_execution_reservation;
DROP TRIGGER IF EXISTS live_research_pipeline_identity_immutable
  ON live_research_execution_reservation;
DROP FUNCTION IF EXISTS matchbase_preserve_live_pipeline_identity();

ALTER TABLE live_research_execution_reservation
  DROP CONSTRAINT IF EXISTS live_research_pipeline_identity_closed;

ALTER TABLE live_research_execution_reservation
  DROP COLUMN IF EXISTS pipeline_identity_record;

ALTER TABLE research_route_policy
  DROP CONSTRAINT IF EXISTS qualified_route_policy_content_digest;

ALTER TABLE research_route_policy
  DROP COLUMN IF EXISTS content_sha256;
