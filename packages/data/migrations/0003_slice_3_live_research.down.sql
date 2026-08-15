DROP TRIGGER IF EXISTS live_qualification_evidence_immutable ON live_qualification_evidence;
DROP TRIGGER IF EXISTS research_route_health_observation_immutable ON research_route_health_observation;
DROP TRIGGER IF EXISTS live_research_terminal_immutable ON live_research_terminal;
DROP TRIGGER IF EXISTS live_research_execution_reservation_event_immutable ON live_research_execution_reservation_event;
DROP TRIGGER IF EXISTS live_cost_reconciliation_immutable ON live_cost_reconciliation;
DROP TRIGGER IF EXISTS candidate_identity_resolution_immutable ON candidate_identity_resolution;
DROP TRIGGER IF EXISTS candidate_identity_hash_collision_guard ON candidate_identity_resolution;
DROP TRIGGER IF EXISTS evidence_driver_immutable ON evidence_driver;
DROP TRIGGER IF EXISTS evidence_value_immutable ON evidence_value;
DROP TRIGGER IF EXISTS live_source_provenance_immutable ON live_source_provenance;
DROP TRIGGER IF EXISTS source_document_immutable ON source_document;
DROP TRIGGER IF EXISTS fetch_attempt_immutable ON fetch_attempt;
DROP TRIGGER IF EXISTS search_attempt_immutable ON search_attempt;
DROP TRIGGER IF EXISTS provider_attempt_immutable ON provider_attempt;
DROP TRIGGER IF EXISTS research_route_snapshot_immutable ON research_route_snapshot;
DROP TRIGGER IF EXISTS research_route_policy_immutable ON research_route_policy;

DROP TABLE IF EXISTS live_qualification_evidence;
DROP TABLE IF EXISTS research_route_health_observation;
DROP TABLE IF EXISTS live_research_execution_reservation_event;
DROP TABLE IF EXISTS live_research_execution_reservation;
DROP TABLE IF EXISTS live_research_terminal;
DROP TABLE IF EXISTS live_cost_reconciliation;
DROP TABLE IF EXISTS candidate_identity_resolution;
DROP TABLE IF EXISTS evidence_driver;
DROP TABLE IF EXISTS evidence_value;
DROP TABLE IF EXISTS live_source_provenance;
DROP TABLE IF EXISTS source_document;
DROP TABLE IF EXISTS fetch_attempt;
DROP TABLE IF EXISTS search_attempt;
DROP TABLE IF EXISTS provider_attempt;
DROP TABLE IF EXISTS research_route_snapshot;
DROP TABLE IF EXISTS research_route_policy;
DROP TABLE IF EXISTS provider_route_capability;

DROP FUNCTION IF EXISTS matchbase_reject_candidate_identity_hash_collision();

DROP TRIGGER IF EXISTS claim_evidence_scope ON claim_evidence;
DROP FUNCTION IF EXISTS matchbase_scope_claim_evidence();
ALTER TABLE claim_evidence
  DROP CONSTRAINT IF EXISTS claim_evidence_account_run_claim_fk;
ALTER TABLE claim_evidence
  DROP CONSTRAINT IF EXISTS claim_evidence_account_run_claim_evidence_uk;
ALTER TABLE claim_evidence
  DROP COLUMN IF EXISTS run_id;

ALTER TABLE research_run
  DROP COLUMN IF EXISTS research_mode;

ALTER TABLE candidate
  DROP CONSTRAINT IF EXISTS candidate_account_run_candidate_uk;
ALTER TABLE claim
  DROP CONSTRAINT IF EXISTS claim_account_run_claim_candidate_uk;
ALTER TABLE claim
  DROP CONSTRAINT IF EXISTS claim_account_run_claim_uk;
ALTER TABLE evidence_item
  DROP CONSTRAINT IF EXISTS evidence_item_account_run_item_uk;
ALTER TABLE capability_attempt
  DROP CONSTRAINT IF EXISTS capability_attempt_account_run_attempt_uk;
