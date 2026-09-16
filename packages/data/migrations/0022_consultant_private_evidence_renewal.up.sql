-- MB-ARCH-IMPLEMENT-001 L02: private evidence and linked research renewal.
CREATE TABLE consultant_logical_request (
  logical_request_root_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  original_run_id uuid NOT NULL,
  latest_run_id uuid NOT NULL,
  generation integer NOT NULL DEFAULT 0 CHECK(generation >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(account_id,user_profile_id,original_run_id),
  UNIQUE(logical_request_root_id,account_id,user_profile_id)
);
CREATE TABLE consultant_research_lineage (
  run_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  user_profile_id uuid NOT NULL,
  logical_request_root_id uuid NOT NULL,
  renews_run_id uuid REFERENCES consultant_research_lineage(run_id),
  renewal_ordinal integer NOT NULL CHECK(renewal_ordinal >= 0),
  root_generation integer NOT NULL CHECK(root_generation=renewal_ordinal),
  idempotency_key uuid,
  command_sha256 text,
  adoption jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(logical_request_root_id,account_id,user_profile_id)
    REFERENCES consultant_logical_request(logical_request_root_id,account_id,user_profile_id) ON DELETE CASCADE,
  UNIQUE(logical_request_root_id,renewal_ordinal),
  UNIQUE(logical_request_root_id,idempotency_key),
  CHECK((renewal_ordinal=0 AND renews_run_id IS NULL AND adoption IS NULL)
    OR (renewal_ordinal>0 AND renews_run_id IS NOT NULL AND jsonb_typeof(adoption)='object'))
);
CREATE FUNCTION matchbase_private_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Private evidence and research lineage records are immutable'; END;
$$;
CREATE TRIGGER consultant_research_lineage_immutable BEFORE UPDATE ON consultant_research_lineage
 FOR EACH ROW EXECUTE FUNCTION matchbase_private_evidence_immutable();
CREATE FUNCTION matchbase_research_lineage_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.renews_run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM consultant_research_lineage p
    WHERE p.run_id=NEW.renews_run_id AND p.logical_request_root_id=NEW.logical_request_root_id
      AND p.account_id=NEW.account_id AND p.user_profile_id=NEW.user_profile_id AND p.renewal_ordinal+1=NEW.renewal_ordinal)
  THEN RAISE EXCEPTION 'Renewal parent must belong to the same immutable profile and logical request'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER consultant_research_lineage_parent_guard BEFORE INSERT ON consultant_research_lineage
 FOR EACH ROW EXECUTE FUNCTION matchbase_research_lineage_parent_guard();

CREATE TABLE consultant_private_source (
  source_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  source_url text NOT NULL,
  source_key text NOT NULL,
  rights_epoch integer NOT NULL DEFAULT 1 CHECK(rights_epoch > 0),
  rights_state text NOT NULL DEFAULT 'active' CHECK(rights_state IN ('active','withdrawn')),
  rights_basis text NOT NULL DEFAULT 'private_research_observation' CHECK(rights_basis='private_research_observation'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(account_id,user_profile_id,source_key)
);
CREATE TABLE consultant_private_source_version (
  source_version_id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES consultant_private_source(source_id) ON DELETE CASCADE,
  content_sha256 text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  published_at timestamptz,
  source_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(source_id,content_sha256,retrieved_at)
);
CREATE TRIGGER consultant_private_source_version_immutable BEFORE UPDATE ON consultant_private_source_version
 FOR EACH ROW EXECUTE FUNCTION matchbase_private_evidence_immutable();
CREATE TABLE consultant_private_entity (
  entity_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  entity_key text NOT NULL,
  resolution text NOT NULL CHECK(resolution IN ('registry_scoped','unresolved')),
  jurisdiction text,
  registry_scheme text,
  registry_number text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(account_id,user_profile_id,entity_key),
  CHECK(resolution='unresolved' OR (jurisdiction IS NOT NULL AND registry_scheme IS NOT NULL AND registry_number IS NOT NULL))
);
CREATE TABLE consultant_private_entity_version (
  entity_version_id uuid PRIMARY KEY,
  entity_id uuid NOT NULL REFERENCES consultant_private_entity(entity_id) ON DELETE CASCADE,
  source_version_id uuid REFERENCES consultant_private_source_version(source_version_id) ON DELETE CASCADE,
  payload_sha256 text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(entity_id,payload_sha256)
);
CREATE TRIGGER consultant_private_entity_version_immutable BEFORE UPDATE ON consultant_private_entity_version
 FOR EACH ROW EXECUTE FUNCTION matchbase_private_evidence_immutable();
CREATE TABLE consultant_private_observation (
  observation_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  run_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  classification_id uuid NOT NULL,
  category_key text NOT NULL,
  origin_key text NOT NULL,
  entity_id uuid REFERENCES consultant_private_entity(entity_id) ON DELETE CASCADE,
  entity_version_id uuid REFERENCES consultant_private_entity_version(entity_version_id) ON DELETE CASCADE,
  observation_version text NOT NULL,
  source_version_id uuid NOT NULL REFERENCES consultant_private_source_version(source_version_id) ON DELETE CASCADE,
  claim_kind text NOT NULL,
  claim_text text NOT NULL,
  payload jsonb NOT NULL,
  price_date timestamptz,
  valid_until timestamptz,
  event_invalidated_at timestamptz,
  event_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(account_id,user_profile_id,execution_id,origin_key,source_version_id)
);
CREATE INDEX consultant_private_observation_lookup ON consultant_private_observation(account_id,user_profile_id,category_key,claim_kind);
CREATE INDEX consultant_private_observation_text ON consultant_private_observation USING gin(to_tsvector('simple',claim_text));
CREATE FUNCTION matchbase_private_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['event_invalidated_at','event_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['event_invalidated_at','event_reason'])
    OR (OLD.event_invalidated_at IS NOT NULL AND NEW.event_invalidated_at IS NULL)
  THEN RAISE EXCEPTION 'Observation content and invalidation history are immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER consultant_private_observation_guard BEFORE UPDATE ON consultant_private_observation
 FOR EACH ROW EXECUTE FUNCTION matchbase_private_observation_guard();
CREATE TABLE consultant_private_evidence_use (
  manifest_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  run_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  classification_id uuid NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('discovery','identity','pricing','compliance')),
  expires_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE consultant_private_evidence_use_item (
  item_id uuid PRIMARY KEY,
  manifest_id uuid NOT NULL REFERENCES consultant_private_evidence_use(manifest_id) ON DELETE CASCADE,
  observation_id uuid REFERENCES consultant_private_observation(observation_id) ON DELETE SET NULL,
  source_id uuid NOT NULL REFERENCES consultant_private_source(source_id) ON DELETE CASCADE,
  source_version_id uuid,
  rights_epoch integer NOT NULL,
  UNIQUE(manifest_id,observation_id)
);
CREATE TABLE consultant_private_evidence_derivative (
  derivative_id uuid PRIMARY KEY,
  manifest_id uuid NOT NULL REFERENCES consultant_private_evidence_use(manifest_id) ON DELETE CASCADE,
  kind text NOT NULL,
  reference text NOT NULL,
  invalidated_at timestamptz,
  UNIQUE(manifest_id,kind,reference)
);
CREATE TABLE consultant_private_evidence_tombstone (
  source_id uuid PRIMARY KEY REFERENCES consultant_private_source(source_id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  user_profile_id uuid NOT NULL,
  rights_epoch integer NOT NULL,
  reason text NOT NULL,
  withdrawn_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE consultant_private_output_provenance (
  provenance_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  run_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  classification_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES consultant_private_source(source_id) ON DELETE CASCADE,
  source_version_id uuid NOT NULL,
  rights_epoch integer NOT NULL,
  event_invalidated_at timestamptz,
  event_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(account_id,user_profile_id,execution_id,source_version_id)
);
CREATE TRIGGER consultant_private_output_provenance_immutable BEFORE UPDATE ON consultant_private_output_provenance
 FOR EACH ROW EXECUTE FUNCTION matchbase_private_observation_guard();
-- Retained parent context remains a dependency even when omitted from displayed child sources.
CREATE TABLE consultant_research_parent_dependency (
  execution_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  run_id uuid NOT NULL,
  classification_id uuid NOT NULL,
  round_id uuid NOT NULL REFERENCES consultant_research_round(round_id) ON DELETE CASCADE,
  parent_round_id uuid NOT NULL REFERENCES consultant_research_round(round_id) ON DELETE CASCADE,
  parent_execution_id uuid NOT NULL,
  parent_output_sha256 text NOT NULL CHECK(parent_output_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(execution_id<>parent_execution_id),
  CHECK(round_id<>parent_round_id)
);
CREATE INDEX consultant_research_parent_dependency_scope
 ON consultant_research_parent_dependency(account_id,user_profile_id,run_id,classification_id,execution_id);
CREATE TRIGGER consultant_research_parent_dependency_immutable BEFORE UPDATE ON consultant_research_parent_dependency
 FOR EACH ROW EXECUTE FUNCTION matchbase_private_evidence_immutable();
CREATE FUNCTION matchbase_research_parent_dependency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM consultant_research_round c JOIN consultant_research_round p ON p.round_id=NEW.parent_round_id
    WHERE c.round_id=NEW.round_id AND c.execution_id=NEW.execution_id AND p.execution_id=NEW.parent_execution_id
      AND c.account_id=NEW.account_id AND p.account_id=NEW.account_id
      AND c.user_profile_id=NEW.user_profile_id AND p.user_profile_id=NEW.user_profile_id
      AND c.run_id=NEW.run_id AND p.run_id=NEW.run_id
      AND c.classification_id=NEW.classification_id AND p.classification_id=NEW.classification_id
      AND c.status='completed' AND p.status='completed' AND p.round_number+1=c.round_number
      AND c.plan->>'parent_round_id'=p.round_id::text)
  THEN RAISE EXCEPTION 'Research dependency must reference the exact completed owned parent'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER consultant_research_parent_dependency_guard BEFORE INSERT ON consultant_research_parent_dependency
 FOR EACH ROW EXECUTE FUNCTION matchbase_research_parent_dependency_guard();
CREATE TABLE consultant_private_negative_check (
  check_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  run_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  classification_id uuid NOT NULL,
  scope_sha256 text NOT NULL,
  scope jsonb NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('no_match','unavailable','denied','paywalled','not_executed')),
  checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX consultant_private_negative_scope ON consultant_private_negative_check(account_id,user_profile_id,scope_sha256,expires_at);
