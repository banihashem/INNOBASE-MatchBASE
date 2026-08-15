ALTER TABLE capability_attempt
  ADD CONSTRAINT capability_attempt_account_run_attempt_uk
  UNIQUE (account_id, run_id, capability_attempt_id);
ALTER TABLE evidence_item
  ADD CONSTRAINT evidence_item_account_run_item_uk
  UNIQUE (account_id, run_id, evidence_item_id);
ALTER TABLE candidate
  ADD CONSTRAINT candidate_account_run_candidate_uk
  UNIQUE (account_id, run_id, candidate_id);
ALTER TABLE claim
  ADD CONSTRAINT claim_account_run_claim_uk
  UNIQUE (account_id, run_id, claim_id);
ALTER TABLE claim
  ADD CONSTRAINT claim_account_run_claim_candidate_uk
  UNIQUE (account_id, run_id, claim_id, candidate_id);

ALTER TABLE claim_evidence ADD COLUMN run_id uuid;
UPDATE claim_evidence ce
   SET run_id=c.run_id
  FROM claim c
 WHERE c.account_id=ce.account_id AND c.claim_id=ce.claim_id;
ALTER TABLE claim_evidence ALTER COLUMN run_id SET NOT NULL;
ALTER TABLE claim_evidence
  ADD CONSTRAINT claim_evidence_account_run_claim_evidence_uk
  UNIQUE (account_id, run_id, claim_id, evidence_item_id);
ALTER TABLE claim_evidence
  ADD CONSTRAINT claim_evidence_account_run_claim_fk
  FOREIGN KEY (account_id, run_id, claim_id)
  REFERENCES claim(account_id, run_id, claim_id);

CREATE FUNCTION matchbase_scope_claim_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE scoped_run_id uuid;
BEGIN
  SELECT run_id INTO scoped_run_id
    FROM claim
   WHERE account_id=NEW.account_id AND claim_id=NEW.claim_id;
  IF scoped_run_id IS NULL THEN
    RAISE EXCEPTION 'Claim evidence scope is unavailable';
  END IF;
  IF NEW.run_id IS NULL THEN
    NEW.run_id := scoped_run_id;
  ELSIF NEW.run_id <> scoped_run_id THEN
    RAISE EXCEPTION 'Claim evidence crosses run scope';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER claim_evidence_scope
BEFORE INSERT ON claim_evidence
FOR EACH ROW EXECUTE FUNCTION matchbase_scope_claim_evidence();

ALTER TABLE research_run
  ADD COLUMN research_mode text NOT NULL DEFAULT 'synthetic_reference'
  CHECK (research_mode IN ('synthetic_reference','qualified_live_research'));

CREATE TABLE provider_route_capability (
    provider_route_id uuid NOT NULL REFERENCES provider_route(provider_route_id),
    capability text NOT NULL CHECK (capability IN ('CAP-SEARCH','CAP-STRUCTURED-GENERATION')),
    PRIMARY KEY (provider_route_id, capability)
);

CREATE TABLE research_route_policy (
    research_route_policy_id uuid PRIMARY KEY,
    schema_version text NOT NULL CHECK (schema_version = 'research-route-policy.v1'),
    policy_version text NOT NULL UNIQUE CHECK (length(btrim(policy_version)) > 0),
    environment text NOT NULL CHECK (environment IN ('local','test','staging','production')),
    activation_state text NOT NULL CHECK (activation_state IN ('disabled','blocked','qualified')),
    official_evidence jsonb NOT NULL CHECK (jsonb_typeof(official_evidence) = 'array'),
    qualification_budget jsonb NOT NULL CHECK (jsonb_typeof(qualification_budget) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (activation_state <> 'qualified' OR jsonb_array_length(official_evidence) >= 2)
);

CREATE TABLE research_route_snapshot (
    research_route_snapshot_id text PRIMARY KEY CHECK (length(btrim(research_route_snapshot_id)) BETWEEN 1 AND 512),
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    research_route_policy_id uuid NOT NULL REFERENCES research_route_policy(research_route_policy_id),
    snapshot_version text NOT NULL CHECK (snapshot_version = 'research-route-snapshot.v1'),
    adapter_version text NOT NULL,
    route_id text NOT NULL,
    route_path text NOT NULL CHECK (route_path IN ('gemini_direct','openrouter')),
    requested_provider text NOT NULL,
    requested_model text NOT NULL,
    expected_served_provider text NOT NULL,
    expected_served_model text NOT NULL,
    served_provider text,
    served_model text,
    terminal_disposition text NOT NULL CHECK (terminal_disposition IN ('ok','failed','cancelled')),
    capability_policy_version text NOT NULL,
    parameter_policy_sha256 bytea NOT NULL CHECK (octet_length(parameter_policy_sha256) = 32),
    data_handling_evidence_version text NOT NULL,
    fallback_position smallint NOT NULL CHECK (fallback_position BETWEEN 0 AND 9),
    qualification_state text NOT NULL CHECK (qualification_state IN ('fixture_only','blocked','qualified')),
    captured_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    UNIQUE (account_id, research_route_snapshot_id),
    UNIQUE (account_id, run_id, research_route_snapshot_id),
    CHECK (requested_model !~* '(^|/)auto$'),
    CHECK (requested_model !~ '[*?]'),
    CHECK (expected_served_model = requested_model),
    CHECK (expected_served_provider = requested_provider),
    CHECK ((terminal_disposition = 'ok' AND served_model = expected_served_model AND served_provider = expected_served_provider) OR
           (terminal_disposition <> 'ok' AND served_model IS NULL AND served_provider IS NULL))
);

CREATE TABLE provider_attempt (
    provider_attempt_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    research_route_snapshot_id text NOT NULL,
    capability_attempt_id uuid NOT NULL UNIQUE,
    attempt_number smallint NOT NULL CHECK (attempt_number BETWEEN 1 AND 10),
    outcome text NOT NULL CHECK (outcome IN ('ok','schema_violation','provider_error','timeout','cancelled','identity_mismatch','cost_unknown')),
    requested_provider text NOT NULL,
    requested_model text NOT NULL,
    served_provider text,
    served_model text,
    response_sha256 bytea CHECK (response_sha256 IS NULL OR octet_length(response_sha256) = 32),
    started_at timestamptz NOT NULL,
    completed_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, run_id, research_route_snapshot_id)
      REFERENCES research_route_snapshot(account_id, run_id, research_route_snapshot_id),
    FOREIGN KEY (account_id, run_id, capability_attempt_id)
      REFERENCES capability_attempt(account_id, run_id, capability_attempt_id),
    UNIQUE (account_id, run_id, provider_attempt_id),
    UNIQUE (research_route_snapshot_id, attempt_number),
    CHECK (completed_at >= started_at),
    CHECK (outcome = 'identity_mismatch' OR (served_provider IS NULL OR served_provider = requested_provider)),
    CHECK (outcome = 'identity_mismatch' OR (served_model IS NULL OR served_model = requested_model))
);

CREATE TABLE search_attempt (
    search_attempt_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    provider_attempt_id uuid NOT NULL,
    query_digest_hmac_sha256 bytea NOT NULL CHECK (octet_length(query_digest_hmac_sha256) = 32),
    search_capability text NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('ok','empty','provider_error','timeout','cancelled','blocked')),
    result_count integer NOT NULL CHECK (result_count >= 0),
    cost_state text NOT NULL CHECK (cost_state IN ('priced','estimated','unknown','not_incurred')),
    started_at timestamptz NOT NULL,
    completed_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, run_id, provider_attempt_id)
      REFERENCES provider_attempt(account_id, run_id, provider_attempt_id),
    UNIQUE (account_id, run_id, search_attempt_id),
    UNIQUE (provider_attempt_id, search_attempt_id),
    CHECK (completed_at >= started_at),
    CHECK (cost_state <> 'unknown' OR outcome = 'blocked')
);

CREATE TABLE fetch_attempt (
    fetch_attempt_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    search_attempt_id uuid NOT NULL,
    source_request_url text NOT NULL,
    policy_version text NOT NULL CHECK (policy_version = 'secure-fetch-policy.v1'),
    canonical_url text NOT NULL,
    publisher_domain text NOT NULL,
    resolved_address_hashes jsonb NOT NULL CHECK (jsonb_typeof(resolved_address_hashes) = 'array'),
    redirect_hop smallint NOT NULL CHECK (redirect_hop BETWEEN 0 AND 3),
    decision text NOT NULL CHECK (decision IN ('accepted','denied')),
    reason_code text NOT NULL,
    http_status integer CHECK (http_status BETWEEN 100 AND 599),
    content_type text,
    compressed_bytes bigint NOT NULL CHECK (compressed_bytes >= 0),
    decompressed_bytes bigint NOT NULL CHECK (decompressed_bytes >= 0),
    content_sha256 bytea CHECK (content_sha256 IS NULL OR octet_length(content_sha256) = 32),
    robots_disposition text NOT NULL CHECK (robots_disposition IN ('allowed','disallowed','unavailable','not_evaluated')),
    started_at timestamptz NOT NULL,
    completed_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, run_id, search_attempt_id)
      REFERENCES search_attempt(account_id, run_id, search_attempt_id),
    UNIQUE (account_id, run_id, fetch_attempt_id),
    UNIQUE (search_attempt_id, source_request_url, canonical_url, redirect_hop),
    CHECK (completed_at >= started_at),
    CHECK (
      (decision = 'accepted' AND (
        content_sha256 IS NOT NULL OR http_status IN (301,302,303,307,308)
      )) OR decision = 'denied'
    )
);

CREATE TABLE source_document (
    source_document_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    fetch_attempt_id uuid NOT NULL UNIQUE,
    canonical_url text NOT NULL,
    normalized_domain text NOT NULL,
    content_type text NOT NULL,
    content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    bounded_extract text NOT NULL CHECK (octet_length(bounded_extract) BETWEEN 1 AND 16384),
    bounded_extract_sha256 bytea NOT NULL CHECK (octet_length(bounded_extract_sha256) = 32),
    extraction_version text NOT NULL,
    active_content_removed boolean NOT NULL CHECK (active_content_removed),
    untrusted_data_only boolean NOT NULL CHECK (untrusted_data_only),
    retrieved_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, run_id, fetch_attempt_id)
      REFERENCES fetch_attempt(account_id, run_id, fetch_attempt_id),
    UNIQUE (account_id, source_document_id),
    UNIQUE (account_id, run_id, source_document_id)
);

CREATE TABLE live_source_provenance (
    live_source_provenance_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    evidence_item_id uuid NOT NULL UNIQUE,
    fetch_attempt_id uuid NOT NULL UNIQUE,
    source_document_id uuid NOT NULL UNIQUE,
    canonical_url text NOT NULL,
    normalized_domain text NOT NULL,
    extraction_method text NOT NULL,
    extraction_version text NOT NULL,
    bounded_excerpt_sha256 bytea NOT NULL CHECK (octet_length(bounded_excerpt_sha256) = 32),
    source_disposition text NOT NULL CHECK (source_disposition IN ('accepted','unsupported','blocked','conflicting')),
    created_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, run_id, evidence_item_id)
      REFERENCES evidence_item(account_id, run_id, evidence_item_id),
    FOREIGN KEY (account_id, run_id, fetch_attempt_id)
      REFERENCES fetch_attempt(account_id, run_id, fetch_attempt_id),
    FOREIGN KEY (account_id, run_id, source_document_id)
      REFERENCES source_document(account_id, run_id, source_document_id),
    UNIQUE (account_id, live_source_provenance_id)
);

CREATE TABLE candidate_identity_resolution (
    candidate_identity_resolution_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    canonical_identity text,
    canonical_identity_sha256 bytea NOT NULL CHECK (octet_length(canonical_identity_sha256) = 32),
    duplicate_of_candidate_id uuid,
    disposition text NOT NULL CHECK (disposition IN ('distinct','duplicate','rejected_ambiguous')),
    resolver_version text NOT NULL CHECK (resolver_version = 'candidate-identity-resolver.v1'),
    reason_code text NOT NULL CHECK (reason_code IN ('unique_canonical_identity','duplicate_canonical_identity','insufficient_identity')),
    resolved_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, run_id, candidate_id)
      REFERENCES candidate(account_id, run_id, candidate_id),
    FOREIGN KEY (account_id, run_id, duplicate_of_candidate_id)
      REFERENCES candidate(account_id, run_id, candidate_id),
    UNIQUE (account_id, candidate_identity_resolution_id),
    UNIQUE (account_id, run_id, candidate_id),
    CHECK ((disposition = 'duplicate') = (duplicate_of_candidate_id IS NOT NULL)),
    CHECK (duplicate_of_candidate_id IS NULL OR duplicate_of_candidate_id <> candidate_id),
    CHECK ((disposition = 'distinct' AND reason_code = 'unique_canonical_identity' AND canonical_identity IS NOT NULL) OR
           (disposition = 'duplicate' AND reason_code = 'duplicate_canonical_identity' AND canonical_identity IS NOT NULL) OR
           (disposition = 'rejected_ambiguous' AND reason_code = 'insufficient_identity' AND canonical_identity IS NULL))
);

CREATE TABLE evidence_value (
    evidence_value_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    claim_id uuid NOT NULL,
    evidence_item_id uuid NOT NULL,
    field_id text NOT NULL CHECK (length(btrim(field_id)) BETWEEN 1 AND 128),
    value_sha256 bytea NOT NULL CHECK (octet_length(value_sha256) = 32),
    created_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, run_id, candidate_id)
      REFERENCES candidate(account_id, run_id, candidate_id),
    FOREIGN KEY (account_id, run_id, claim_id, candidate_id)
      REFERENCES claim(account_id, run_id, claim_id, candidate_id),
    FOREIGN KEY (account_id, run_id, evidence_item_id)
      REFERENCES evidence_item(account_id, run_id, evidence_item_id),
    FOREIGN KEY (account_id, run_id, claim_id, evidence_item_id)
      REFERENCES claim_evidence(account_id, run_id, claim_id, evidence_item_id),
    UNIQUE (account_id, run_id, evidence_value_id),
    UNIQUE (account_id, run_id, evidence_value_id, candidate_id, claim_id, evidence_item_id),
    UNIQUE (account_id, run_id, candidate_id, claim_id, evidence_item_id, field_id)
);

CREATE TABLE evidence_driver (
    evidence_driver_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    claim_id uuid NOT NULL,
    evidence_value_id uuid NOT NULL,
    evidence_item_id uuid NOT NULL,
    dimension_id text NOT NULL CHECK (length(btrim(dimension_id)) BETWEEN 1 AND 128),
    direction text NOT NULL CHECK (direction IN ('supports','contradicts','limits')),
    created_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, run_id, candidate_id)
      REFERENCES candidate(account_id, run_id, candidate_id),
    FOREIGN KEY (account_id, run_id, claim_id)
      REFERENCES claim(account_id, run_id, claim_id),
    FOREIGN KEY (account_id, run_id, evidence_item_id)
      REFERENCES evidence_item(account_id, run_id, evidence_item_id),
    FOREIGN KEY (account_id, run_id, evidence_value_id, candidate_id, claim_id, evidence_item_id)
      REFERENCES evidence_value(account_id, run_id, evidence_value_id, candidate_id, claim_id, evidence_item_id),
    UNIQUE (account_id, run_id, evidence_driver_id),
    UNIQUE (account_id, run_id, evidence_value_id, dimension_id, direction)
);

CREATE TABLE live_cost_reconciliation (
    live_cost_reconciliation_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    expected_provider_attempts integer NOT NULL CHECK (expected_provider_attempts >= 0),
    recorded_provider_attempts integer NOT NULL CHECK (recorded_provider_attempts >= 0),
    recorded_cost_events integer NOT NULL CHECK (recorded_cost_events >= 0),
    amount numeric(20,8),
    currency_code char(3),
    pricing_version text,
    reconciliation_state text NOT NULL CHECK (reconciliation_state IN ('closed','blocked_unknown','blocked_mismatch')),
    reconciled_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    UNIQUE (account_id, run_id),
    CHECK ((reconciliation_state = 'closed' AND expected_provider_attempts = recorded_provider_attempts AND recorded_provider_attempts = recorded_cost_events AND amount IS NOT NULL AND amount >= 0 AND currency_code IS NOT NULL AND pricing_version IS NOT NULL) OR
           (reconciliation_state <> 'closed' AND amount IS NULL AND currency_code IS NULL))
);

CREATE TABLE live_research_terminal (
    live_research_terminal_id uuid PRIMARY KEY,
    execution_id text NOT NULL UNIQUE,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    disposition text NOT NULL CHECK (disposition IN ('complete','failed_retryable','failed','cancelled')),
    reason_code text NOT NULL,
    route_count integer NOT NULL CHECK (route_count >= 0),
    terminal_record jsonb NOT NULL CHECK (jsonb_typeof(terminal_record) = 'object'),
    sanitized_result jsonb,
    result_sha256 bytea CHECK (result_sha256 IS NULL OR octet_length(result_sha256) = 32),
    completed_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, run_id) REFERENCES live_cost_reconciliation(account_id, run_id),
    UNIQUE (account_id, run_id, live_research_terminal_id),
    UNIQUE (account_id, run_id),
    CHECK ((disposition = 'complete' AND sanitized_result IS NOT NULL AND result_sha256 IS NOT NULL) OR
           (disposition <> 'complete' AND sanitized_result IS NULL AND result_sha256 IS NULL))
);

CREATE TABLE live_research_execution_reservation (
    execution_id text PRIMARY KEY CHECK (length(btrim(execution_id)) BETWEEN 1 AND 256),
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    generation bigint NOT NULL CHECK (generation >= 1),
    ownership_token_sha256 bytea NOT NULL CHECK (octet_length(ownership_token_sha256) = 32),
    state text NOT NULL CHECK (state IN ('in_progress','terminal')),
    checkpoint_stage text NOT NULL DEFAULT 'reserved'
      CHECK (checkpoint_stage IN ('reserved','source_discovered','terminal','terminal_no_source')),
    source_discovery_record jsonb,
    search_attempt_id uuid,
    execution_lease_slot smallint NOT NULL,
    execution_lease_generation integer NOT NULL CHECK (execution_lease_generation >= 1),
    lease_expires_at timestamptz NOT NULL,
    terminal_id uuid UNIQUE,
    claimed_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, run_id, terminal_id)
      REFERENCES live_research_terminal(account_id, run_id, live_research_terminal_id),
    FOREIGN KEY (account_id, run_id, search_attempt_id)
      REFERENCES search_attempt(account_id, run_id, search_attempt_id),
    FOREIGN KEY (execution_lease_slot) REFERENCES execution_lease(slot_no),
    UNIQUE (account_id, run_id),
    UNIQUE (execution_id, account_id, run_id),
    CHECK ((state = 'terminal') = (terminal_id IS NOT NULL)),
    CHECK ((checkpoint_stage IN ('reserved','terminal_no_source') AND source_discovery_record IS NULL AND search_attempt_id IS NULL) OR
           (checkpoint_stage IN ('source_discovered','terminal') AND source_discovery_record IS NOT NULL AND search_attempt_id IS NOT NULL)),
    CHECK ((state = 'terminal') = (checkpoint_stage IN ('terminal','terminal_no_source')))
);

CREATE TABLE live_research_execution_reservation_event (
    reservation_event_id uuid PRIMARY KEY,
    execution_id text NOT NULL,
    account_id uuid NOT NULL,
    run_id uuid NOT NULL,
    event_type text NOT NULL CHECK (event_type IN ('claimed','reclaimed_after_expiry','terminal_committed')),
    generation bigint NOT NULL CHECK (generation >= 1),
    ownership_token_sha256 bytea NOT NULL CHECK (octet_length(ownership_token_sha256) = 32),
    recorded_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (execution_id, account_id, run_id)
      REFERENCES live_research_execution_reservation(execution_id, account_id, run_id)
);

CREATE TABLE research_route_health_observation (
    research_route_health_observation_id uuid PRIMARY KEY,
    route_id text NOT NULL,
    environment text NOT NULL CHECK (environment IN ('local','test','staging','production')),
    observation text NOT NULL CHECK (observation IN ('success','transient_failure','permanent_failure','timeout','cancelled','probe_eligible')),
    consecutive_failures integer NOT NULL CHECK (consecutive_failures >= 0),
    circuit_disposition text NOT NULL CHECK (circuit_disposition IN ('closed','open','half_open')),
    source_attempt_id uuid REFERENCES provider_attempt(provider_attempt_id),
    observed_at timestamptz NOT NULL,
    CHECK ((observation = 'success' AND consecutive_failures = 0) OR observation <> 'success'),
    CHECK ((circuit_disposition = 'half_open') = (observation = 'probe_eligible'))
);

CREATE TABLE live_qualification_evidence (
    live_qualification_evidence_id uuid PRIMARY KEY,
    research_route_policy_id uuid NOT NULL REFERENCES research_route_policy(research_route_policy_id),
    route_id text NOT NULL,
    qualification_state text NOT NULL CHECK (qualification_state IN ('blocked','passed','failed')),
    requested_provider text NOT NULL,
    requested_model text NOT NULL,
    served_provider text,
    served_model text,
    benign_fixture_id text NOT NULL,
    sanitized_evidence jsonb NOT NULL CHECK (jsonb_typeof(sanitized_evidence) = 'object'),
    evidence_sha256 bytea NOT NULL CHECK (octet_length(evidence_sha256) = 32),
    cost_state text NOT NULL CHECK (cost_state IN ('priced','estimated','unknown')),
    recorded_at timestamptz NOT NULL,
    UNIQUE (research_route_policy_id, route_id),
    CHECK (qualification_state <> 'passed' OR cost_state <> 'unknown'),
    CHECK (qualification_state <> 'passed' OR served_provider = requested_provider),
    CHECK (qualification_state <> 'passed' OR served_model = requested_model),
    CHECK (sanitized_evidence ? 'secret_free' AND sanitized_evidence ->> 'secret_free' = 'true')
);

CREATE INDEX provider_attempt_run_idx ON provider_attempt (account_id, run_id, started_at);
CREATE INDEX search_attempt_run_idx ON search_attempt (account_id, run_id, started_at);
CREATE INDEX fetch_attempt_run_idx ON fetch_attempt (account_id, run_id, started_at);
CREATE INDEX live_source_provenance_run_idx ON live_source_provenance (account_id, run_id, created_at);
CREATE INDEX source_document_run_idx ON source_document (account_id, run_id, retrieved_at);
CREATE INDEX candidate_identity_resolution_run_idx ON candidate_identity_resolution (account_id, run_id, resolved_at);
CREATE INDEX evidence_value_run_idx ON evidence_value (account_id, run_id, created_at);
CREATE INDEX evidence_driver_run_idx ON evidence_driver (account_id, run_id, created_at);
CREATE INDEX research_route_health_idx ON research_route_health_observation (route_id, environment, observed_at);
CREATE INDEX live_research_reservation_lease_idx ON live_research_execution_reservation (state, lease_expires_at);
CREATE INDEX research_run_live_claimable_idx ON research_run (research_mode, state, queued_at)
  WHERE research_mode = 'qualified_live_research'
    AND state IN ('queued','failed_retryable');

CREATE FUNCTION matchbase_reject_candidate_identity_hash_collision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM candidate_identity_resolution existing
     WHERE existing.account_id = NEW.account_id
       AND existing.run_id = NEW.run_id
       AND existing.canonical_identity_sha256 = NEW.canonical_identity_sha256
       AND existing.canonical_identity IS DISTINCT FROM NEW.canonical_identity
  ) THEN
    RAISE EXCEPTION 'candidate identity hash collision rejected';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER research_route_policy_immutable
BEFORE UPDATE OR DELETE ON research_route_policy
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER research_route_snapshot_immutable
BEFORE UPDATE OR DELETE ON research_route_snapshot
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER provider_attempt_immutable
BEFORE UPDATE OR DELETE ON provider_attempt
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER search_attempt_immutable
BEFORE UPDATE OR DELETE ON search_attempt
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER fetch_attempt_immutable
BEFORE UPDATE OR DELETE ON fetch_attempt
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER live_source_provenance_immutable
BEFORE UPDATE OR DELETE ON live_source_provenance
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER source_document_immutable
BEFORE UPDATE OR DELETE ON source_document
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER candidate_identity_resolution_immutable
BEFORE UPDATE OR DELETE ON candidate_identity_resolution
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER candidate_identity_hash_collision_guard
BEFORE INSERT ON candidate_identity_resolution
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_candidate_identity_hash_collision();
CREATE TRIGGER evidence_value_immutable
BEFORE UPDATE OR DELETE ON evidence_value
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER evidence_driver_immutable
BEFORE UPDATE OR DELETE ON evidence_driver
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER live_cost_reconciliation_immutable
BEFORE UPDATE OR DELETE ON live_cost_reconciliation
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER live_research_terminal_immutable
BEFORE UPDATE OR DELETE ON live_research_terminal
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER live_research_execution_reservation_event_immutable
BEFORE UPDATE OR DELETE ON live_research_execution_reservation_event
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER research_route_health_observation_immutable
BEFORE UPDATE OR DELETE ON research_route_health_observation
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
CREATE TRIGGER live_qualification_evidence_immutable
BEFORE UPDATE OR DELETE ON live_qualification_evidence
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

REVOKE UPDATE, DELETE ON
  research_route_policy, research_route_snapshot, provider_attempt, search_attempt,
  fetch_attempt, live_source_provenance, live_qualification_evidence
  , source_document, candidate_identity_resolution, evidence_value,
  evidence_driver, live_cost_reconciliation,
  live_research_terminal, live_research_execution_reservation_event,
  research_route_health_observation
FROM PUBLIC;

COMMENT ON TABLE research_route_policy IS
  'Versioned fail-closed Slice 3 route activation policy; credentials and raw provider payloads are prohibited.';
COMMENT ON TABLE research_route_snapshot IS
  'Immutable requested/served provider route identity captured per run; exact identity mismatch is rejected.';
COMMENT ON TABLE live_qualification_evidence IS
  'Sanitized benign-fixture qualification evidence only; secrets and unrestricted provider payloads are prohibited.';
