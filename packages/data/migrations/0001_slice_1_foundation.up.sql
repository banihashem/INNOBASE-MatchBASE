CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE account (
    account_id uuid PRIMARY KEY,
    display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
    status text NOT NULL CHECK (status IN ('active','suspended','closed')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    closed_at timestamptz,
    UNIQUE (account_id, status)
);

CREATE TABLE app_user (
    user_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    google_sub text NOT NULL UNIQUE CHECK (length(btrim(google_sub)) > 0),
    email citext,
    email_verified boolean NOT NULL DEFAULT false,
    hosted_domain text,
    display_name text,
    status text NOT NULL CHECK (status IN ('active','disabled','deleted')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_seen_at timestamptz,
    deleted_at timestamptz,
    UNIQUE (account_id, user_id)
);

CREATE INDEX app_user_active_account_idx ON app_user (account_id, user_id)
    WHERE status = 'active';

CREATE TABLE entitlement_grant (
    grant_id uuid PRIMARY KEY,
    account_id uuid NOT NULL,
    user_id uuid NOT NULL,
    tier text NOT NULL CHECK (tier IN ('demo','standard','consultant','admin')),
    grant_actor_kind text NOT NULL CHECK (grant_actor_kind IN ('system','user')),
    granted_by_user_id uuid,
    justification text NOT NULL CHECK (length(btrim(justification)) > 0),
    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    revoked_at timestamptz,
    revoked_by_user_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (account_id, user_id) REFERENCES app_user(account_id, user_id),
    FOREIGN KEY (account_id, granted_by_user_id) REFERENCES app_user(account_id, user_id),
    FOREIGN KEY (account_id, revoked_by_user_id) REFERENCES app_user(account_id, user_id),
    CHECK (effective_to IS NULL OR effective_to > effective_from),
    CHECK (
      (grant_actor_kind = 'system' AND granted_by_user_id IS NULL AND tier = 'demo') OR
      (grant_actor_kind = 'user' AND granted_by_user_id IS NOT NULL AND granted_by_user_id <> user_id)
    )
);

CREATE INDEX entitlement_effective_idx
    ON entitlement_grant (account_id, user_id, effective_from DESC, created_at DESC)
    WHERE revoked_at IS NULL;

CREATE TABLE admin_role_grant (
    admin_grant_id uuid PRIMARY KEY,
    account_id uuid NOT NULL,
    user_id uuid NOT NULL,
    sub_role text NOT NULL CHECK (sub_role IN
      ('support','analyst','consultant_manager','product','security_audit','super_admin')),
    granted_by_user_id uuid NOT NULL,
    justification text NOT NULL CHECK (length(btrim(justification)) > 0),
    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    revoked_at timestamptz,
    revoked_by_user_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (account_id, user_id) REFERENCES app_user(account_id, user_id),
    FOREIGN KEY (account_id, granted_by_user_id) REFERENCES app_user(account_id, user_id),
    FOREIGN KEY (account_id, revoked_by_user_id) REFERENCES app_user(account_id, user_id),
    CHECK (granted_by_user_id <> user_id),
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE oauth_transaction (
    oauth_transaction_id uuid PRIMARY KEY,
    state_hash bytea NOT NULL UNIQUE,
    nonce_hash bytea NOT NULL,
    pkce_verifier_hash bytea NOT NULL,
    redirect_uri text NOT NULL,
    environment text NOT NULL CHECK (environment IN ('local','test','staging','production')),
    simulator boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CHECK (expires_at > created_at),
    CHECK (environment <> 'production' OR simulator = false)
);

CREATE TABLE user_session (
    session_id uuid PRIMARY KEY,
    account_id uuid NOT NULL,
    user_id uuid NOT NULL,
    handle_hash bytea NOT NULL UNIQUE,
    csrf_token_hash bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_used_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    absolute_expires_at timestamptz NOT NULL,
    idle_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    revoked_reason text,
    ip_hash bytea,
    user_agent_hash bytea,
    FOREIGN KEY (account_id, user_id) REFERENCES app_user(account_id, user_id),
    CHECK (absolute_expires_at > created_at),
    CHECK (idle_expires_at > created_at)
);

CREATE INDEX user_session_active_idx ON user_session (account_id, user_id, idle_expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE prompt_version (
    prompt_version_id uuid PRIMARY KEY,
    prompt_key text NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    output_schema_id text,
    released_at timestamptz NOT NULL,
    released_by_user_id uuid,
    approved_by_user_id uuid,
    notes text,
    UNIQUE (prompt_key, version),
    CHECK (released_by_user_id IS NULL OR approved_by_user_id IS NULL OR released_by_user_id <> approved_by_user_id)
);

CREATE TABLE model_policy_version (
    model_policy_version_id uuid PRIMARY KEY,
    version integer NOT NULL UNIQUE CHECK (version > 0),
    capability_map jsonb NOT NULL,
    content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    released_at timestamptz NOT NULL,
    released_by_user_id uuid,
    approved_by_user_id uuid,
    CHECK (released_by_user_id IS NULL OR approved_by_user_id IS NULL OR released_by_user_id <> approved_by_user_id)
);

CREATE TABLE scoring_config_version (
    scoring_config_version_id uuid PRIMARY KEY,
    version integer NOT NULL UNIQUE CHECK (version > 0),
    weights_bp jsonb NOT NULL,
    gate_definitions jsonb NOT NULL,
    content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    released_at timestamptz NOT NULL,
    product_owner_approval_ref text NOT NULL,
    sme_approval_ref text NOT NULL,
    evaluation_run_ref text NOT NULL
);

CREATE TABLE projection_version (
    projection_version_id uuid PRIMARY KEY,
    version integer NOT NULL UNIQUE CHECK (version > 0),
    definition jsonb NOT NULL,
    content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    released_at timestamptz NOT NULL
);

CREATE TABLE canonicalization_execution_run (
    canonicalization_run_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    user_id uuid NOT NULL,
    subject_request_id uuid NOT NULL,
    request_correlation_id text NOT NULL CHECK (length(btrim(request_correlation_id)) > 0),
    started_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, user_id) REFERENCES app_user(account_id, user_id),
    UNIQUE (account_id, canonicalization_run_id),
    UNIQUE (account_id, subject_request_id, canonicalization_run_id)
);

CREATE TABLE sourcing_request (
    request_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    created_by_user_id uuid NOT NULL,
    canonicalization_run_id uuid NOT NULL,
    current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
    lifecycle_state text NOT NULL DEFAULT 'draft' CHECK (lifecycle_state IN ('draft','canonicalised','confirmed','closed')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (account_id, created_by_user_id) REFERENCES app_user(account_id, user_id),
    CONSTRAINT sourcing_request_canonicalization_execution_fk
    FOREIGN KEY (account_id, request_id, canonicalization_run_id)
      REFERENCES canonicalization_execution_run(account_id, subject_request_id, canonicalization_run_id),
    UNIQUE (account_id, request_id)
);

CREATE TABLE canonical_request_version (
    canonical_request_version_id uuid PRIMARY KEY,
    request_id uuid NOT NULL,
    account_id uuid NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    canonical_language text NOT NULL DEFAULT 'en' CHECK (canonical_language = 'en'),
    canonical_document jsonb NOT NULL,
    protected_spans jsonb NOT NULL DEFAULT '[]'::jsonb,
    match_readiness text NOT NULL CHECK (match_readiness IN ('ready','partially_ready','not_ready')),
    parent_version_id uuid,
    created_by_user_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (account_id, request_id) REFERENCES sourcing_request(account_id, request_id),
    FOREIGN KEY (parent_version_id) REFERENCES canonical_request_version(canonical_request_version_id),
    FOREIGN KEY (account_id, created_by_user_id) REFERENCES app_user(account_id, user_id),
    UNIQUE (request_id, version),
    UNIQUE (account_id, canonical_request_version_id)
);

CREATE TABLE canonical_language_record (
    canonical_request_version_id uuid PRIMARY KEY REFERENCES canonical_request_version(canonical_request_version_id),
    account_id uuid NOT NULL REFERENCES account(account_id),
    source_language_tag text NOT NULL CHECK (source_language_tag ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$'),
    source_language_confidence numeric(4,3) NOT NULL CHECK (source_language_confidence BETWEEN 0 AND 1),
    canonical_language_tag text NOT NULL DEFAULT 'en' CHECK (canonical_language_tag = 'en'),
    detected_at timestamptz NOT NULL
);

CREATE TABLE transformation_provenance (
    transformation_provenance_id uuid PRIMARY KEY,
    canonical_request_version_id uuid NOT NULL REFERENCES canonical_request_version(canonical_request_version_id),
    account_id uuid NOT NULL REFERENCES account(account_id),
    capability_attempt_id uuid,
    stage text NOT NULL,
    capability text NOT NULL,
    provider text NOT NULL,
    model_id text NOT NULL,
    route_id text NOT NULL,
    prompt_version_id uuid REFERENCES prompt_version(prompt_version_id),
    config_version text NOT NULL,
    data_handling_posture text NOT NULL CHECK (data_handling_posture IN ('synthetic_fixture','zdr_verified','paid_no_training','unknown')),
    output_sha256 bytea NOT NULL CHECK (octet_length(output_sha256) = 32),
    transformed_at timestamptz NOT NULL
);

CREATE TABLE request_field (
    field_id uuid PRIMARY KEY,
    canonical_request_version_id uuid NOT NULL REFERENCES canonical_request_version(canonical_request_version_id),
    account_id uuid NOT NULL REFERENCES account(account_id),
    macro_parameter text NOT NULL CHECK (macro_parameter IN
      ('product_specification','supplier_producer_profile','trade_structure_commercial_execution')),
    field_key text NOT NULL,
    value_state text NOT NULL CHECK (value_state IN ('provided','explicitly_unknown','not_asked','empty')),
    canonical_value jsonb,
    canonical_locator text NOT NULL,
    UNIQUE (canonical_request_version_id, field_key),
    UNIQUE (account_id, field_id)
);

CREATE TABLE canonical_field_provenance (
    field_id uuid PRIMARY KEY REFERENCES request_field(field_id),
    account_id uuid NOT NULL REFERENCES account(account_id),
    origin text NOT NULL CHECK (origin IN ('entered_english','translated','user_corrected')),
    source_language_tag text NOT NULL,
    transformation_provenance_id uuid REFERENCES transformation_provenance(transformation_provenance_id),
    recorded_at timestamptz NOT NULL
);

CREATE TABLE original_text_digest (
    canonical_request_version_id uuid PRIMARY KEY REFERENCES canonical_request_version(canonical_request_version_id),
    account_id uuid NOT NULL REFERENCES account(account_id),
    digest_hmac_sha256 bytea NOT NULL CHECK (octet_length(digest_hmac_sha256) = 32),
    key_id text NOT NULL CHECK (length(btrim(key_id)) > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE canonical_confirmation (
    confirmation_id uuid PRIMARY KEY,
    canonical_request_version_id uuid NOT NULL REFERENCES canonical_request_version(canonical_request_version_id),
    account_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    accepted boolean NOT NULL,
    confirmed_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, actor_user_id) REFERENCES app_user(account_id, user_id),
    UNIQUE (canonical_request_version_id, actor_user_id, confirmed_at)
);

CREATE TABLE constraint_item (
    constraint_id uuid PRIMARY KEY,
    canonical_request_version_id uuid NOT NULL REFERENCES canonical_request_version(canonical_request_version_id),
    account_id uuid NOT NULL REFERENCES account(account_id),
    constraint_kind text NOT NULL CHECK (constraint_kind IN ('hard_constraint','soft_preference','conditional_requirement','exclusion')),
    subject_field_key text NOT NULL,
    operator text NOT NULL,
    canonical_comparand jsonb,
    requirement_level text CHECK (requirement_level IN ('mandatory','recommended','optional')),
    canonical_source_locator text NOT NULL,
    relaxable boolean NOT NULL DEFAULT false,
    relaxation_priority integer
);

CREATE TABLE canonical_contradiction (
    contradiction_id uuid PRIMARY KEY,
    canonical_request_version_id uuid NOT NULL REFERENCES canonical_request_version(canonical_request_version_id),
    account_id uuid NOT NULL REFERENCES account(account_id),
    blocking boolean NOT NULL DEFAULT true,
    alternatives jsonb NOT NULL,
    resolution jsonb,
    resolved_by_user_id uuid,
    resolved_at timestamptz,
    CHECK ((resolution IS NULL AND resolved_at IS NULL AND resolved_by_user_id IS NULL) OR
           (resolution IS NOT NULL AND resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL))
);

CREATE TABLE idempotency_record (
    idempotency_record_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    subject_user_id uuid NOT NULL,
    route text NOT NULL,
    key_hash bytea NOT NULL,
    request_hash bytea NOT NULL,
    response_status integer NOT NULL CHECK (response_status BETWEEN 100 AND 599),
    response_body jsonb NOT NULL,
    result_resource_id uuid,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, subject_user_id) REFERENCES app_user(account_id, user_id),
    UNIQUE (account_id, subject_user_id, route, key_hash),
    CHECK (expires_at > created_at)
);

CREATE TABLE research_run (
    run_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    canonical_request_version_id uuid NOT NULL,
    requested_by_user_id uuid NOT NULL,
    tier_at_submission text NOT NULL CHECK (tier_at_submission IN ('demo','standard','consultant')),
    state text NOT NULL CHECK (state IN
      ('queued','researching','escalated','restricted','scoring','cancelling','failed_retryable',
       'complete','no_responsible_match','failed','cancelled','superseded')),
    state_reason text,
    model_policy_version_id uuid NOT NULL REFERENCES model_policy_version(model_policy_version_id),
    scoring_config_version_id uuid NOT NULL REFERENCES scoring_config_version(scoring_config_version_id),
    idempotency_key_hash bytea NOT NULL,
    queued_at timestamptz NOT NULL,
    started_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz,
    FOREIGN KEY (account_id, canonical_request_version_id)
      REFERENCES canonical_request_version(account_id, canonical_request_version_id),
    FOREIGN KEY (account_id, requested_by_user_id) REFERENCES app_user(account_id, user_id),
    UNIQUE (account_id, run_id),
    UNIQUE (account_id, requested_by_user_id, idempotency_key_hash)
);

CREATE INDEX research_run_claimable_idx ON research_run (state, queued_at)
    WHERE state IN ('queued','researching','scoring','failed_retryable','cancelling');

CREATE TABLE quota_ledger (
    quota_entry_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    user_id uuid NOT NULL,
    run_id uuid NOT NULL,
    entry_kind text NOT NULL CHECK (entry_kind IN ('charge','compensation')),
    units smallint NOT NULL,
    charged_at timestamptz NOT NULL,
    reason_code text NOT NULL,
    compensates_entry_id uuid REFERENCES quota_ledger(quota_entry_id),
    FOREIGN KEY (account_id, user_id) REFERENCES app_user(account_id, user_id),
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    CHECK ((entry_kind = 'charge' AND units = 1 AND compensates_entry_id IS NULL) OR
           (entry_kind = 'compensation' AND units = -1 AND compensates_entry_id IS NOT NULL))
);

CREATE UNIQUE INDEX quota_one_charge_per_run_idx ON quota_ledger (run_id)
    WHERE entry_kind = 'charge';
CREATE UNIQUE INDEX quota_one_compensation_per_charge_idx ON quota_ledger (compensates_entry_id)
    WHERE entry_kind = 'compensation';
CREATE INDEX quota_window_idx ON quota_ledger (account_id, charged_at)
    WHERE entry_kind = 'charge';

CREATE TABLE execution_lease (
    slot_no smallint PRIMARY KEY CHECK (slot_no BETWEEN 1 AND 3),
    run_id uuid,
    account_id uuid,
    owner_token_hash bytea,
    generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
    acquired_at timestamptz,
    renewed_at timestamptz,
    expires_at timestamptz,
    released_at timestamptz,
    release_reason text,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    CHECK (
      (run_id IS NULL AND account_id IS NULL AND owner_token_hash IS NULL AND acquired_at IS NULL AND expires_at IS NULL) OR
      (run_id IS NOT NULL AND account_id IS NOT NULL AND owner_token_hash IS NOT NULL AND acquired_at IS NOT NULL AND expires_at > acquired_at)
    )
);

INSERT INTO execution_lease (slot_no) VALUES (1), (2), (3);
CREATE UNIQUE INDEX execution_lease_one_active_per_run_idx ON execution_lease (run_id)
    WHERE run_id IS NOT NULL AND released_at IS NULL;

CREATE TABLE provider_route (
    provider_route_id uuid PRIMARY KEY,
    route_id text NOT NULL,
    capability text NOT NULL,
    provider text NOT NULL CHECK (provider IN ('gemini_direct','openrouter','synthetic_fixture')),
    model_id text NOT NULL,
    environment text NOT NULL CHECK (environment IN ('local','test','staging','production')),
    route_kind text NOT NULL CHECK (route_kind IN ('real_data','synthetic_fixture')),
    data_handling_posture text NOT NULL CHECK (data_handling_posture IN ('synthetic_fixture','zdr_verified','paid_no_training','unknown')),
    timeout_ms integer NOT NULL CHECK (timeout_ms > 0),
    max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
    retry_policy jsonb NOT NULL,
    config_version text NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (route_id, config_version),
    CHECK (model_id <> 'openrouter/auto'),
    CHECK (model_id !~ '[*?]'),
    CHECK (route_kind <> 'real_data' OR data_handling_posture <> 'unknown'),
    CHECK (route_kind <> 'synthetic_fixture' OR
           (provider = 'synthetic_fixture' AND environment IN ('local','test') AND data_handling_posture = 'synthetic_fixture')),
    CHECK (environment <> 'production' OR route_kind <> 'synthetic_fixture')
);

CREATE TABLE capability_attempt (
    capability_attempt_id uuid PRIMARY KEY,
    run_id uuid,
    canonicalization_run_id uuid,
    account_id uuid NOT NULL REFERENCES account(account_id),
    user_id uuid NOT NULL,
    capability text NOT NULL,
    provider text NOT NULL,
    model_id text NOT NULL,
    environment text NOT NULL CHECK (environment IN ('local','test','staging','production')),
    provider_route_id uuid NOT NULL REFERENCES provider_route(provider_route_id),
    outcome text NOT NULL CHECK (outcome IN ('ok','schema_violation','refusal','provider_error','timeout','circuit_open','cancelled')),
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    FOREIGN KEY (account_id, user_id) REFERENCES app_user(account_id, user_id),
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, canonicalization_run_id)
      REFERENCES canonicalization_execution_run(account_id, canonicalization_run_id),
    CHECK ((run_id IS NULL) <> (canonicalization_run_id IS NULL)),
    UNIQUE (account_id, capability_attempt_id)
);

CREATE TABLE provider_call (
    provider_call_id uuid PRIMARY KEY,
    capability_attempt_id uuid NOT NULL UNIQUE REFERENCES capability_attempt(capability_attempt_id),
    run_id uuid,
    canonicalization_run_id uuid,
    account_id uuid NOT NULL REFERENCES account(account_id),
    user_id uuid NOT NULL,
    capability text NOT NULL,
    step_key text,
    provider text NOT NULL,
    model_id text NOT NULL,
    environment text NOT NULL CHECK (environment IN ('local','test','staging','production')),
    route_id text NOT NULL,
    prompt_version_id uuid REFERENCES prompt_version(prompt_version_id),
    request_parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
    input_tokens integer CHECK (input_tokens >= 0),
    output_tokens integer CHECK (output_tokens >= 0),
    cached_input_tokens integer CHECK (cached_input_tokens >= 0),
    latency_ms integer CHECK (latency_ms >= 0),
    request_identifier_hash bytea,
    called_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, user_id) REFERENCES app_user(account_id, user_id),
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, canonicalization_run_id)
      REFERENCES canonicalization_execution_run(account_id, canonicalization_run_id),
    CHECK ((run_id IS NULL) <> (canonicalization_run_id IS NULL))
);

CREATE TABLE cost_event (
    cost_event_id uuid PRIMARY KEY,
    capability_attempt_id uuid NOT NULL UNIQUE REFERENCES capability_attempt(capability_attempt_id),
    run_id uuid,
    canonicalization_run_id uuid,
    account_id uuid NOT NULL REFERENCES account(account_id),
    user_id uuid NOT NULL,
    capability text NOT NULL,
    provider text NOT NULL,
    model_id text NOT NULL,
    environment text NOT NULL CHECK (environment IN ('local','test','staging','production')),
    quantity numeric(20,6) NOT NULL CHECK (quantity >= 0),
    unit text NOT NULL,
    amount numeric(20,8),
    currency_code char(3),
    pricing_basis text NOT NULL,
    pricing_version text NOT NULL,
    pricing_state text NOT NULL CHECK (pricing_state IN ('priced','explicit_zero','unknown','unpriced')),
    measurement_kind text NOT NULL CHECK (measurement_kind IN ('measured','estimated')),
    occurred_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, user_id) REFERENCES app_user(account_id, user_id),
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, canonicalization_run_id)
      REFERENCES canonicalization_execution_run(account_id, canonicalization_run_id),
    CHECK ((run_id IS NULL) <> (canonicalization_run_id IS NULL)),
    CHECK ((pricing_state = 'priced' AND amount IS NOT NULL AND amount >= 0 AND currency_code IS NOT NULL) OR
           (pricing_state = 'explicit_zero' AND amount = 0 AND currency_code IS NOT NULL AND pricing_basis IN ('synthetic_fixture','free_contract')) OR
           (pricing_state IN ('unknown','unpriced') AND amount IS NULL))
);

ALTER TABLE transformation_provenance
  ADD CONSTRAINT transformation_provenance_capability_attempt_fk
  FOREIGN KEY (account_id, capability_attempt_id)
  REFERENCES capability_attempt(account_id, capability_attempt_id);

CREATE TABLE evidence_item (
    evidence_item_id uuid PRIMARY KEY,
    run_id uuid NOT NULL,
    account_id uuid NOT NULL REFERENCES account(account_id),
    source_kind text NOT NULL CHECK (source_kind IN ('synthetic_fixture','external_url','local_fixture')),
    url text,
    local_fixture_id text,
    title text NOT NULL,
    publisher_domain text NOT NULL,
    retrieved_at timestamptz NOT NULL,
    content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    verification_disposition text NOT NULL CHECK (verification_disposition IN ('synthetic','verified','unsupported','conflicting','stale')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    CHECK ((source_kind = 'external_url' AND url IS NOT NULL AND local_fixture_id IS NULL) OR
           (source_kind <> 'external_url' AND url IS NULL AND local_fixture_id IS NOT NULL)),
    UNIQUE (account_id, evidence_item_id)
);

CREATE TABLE candidate (
    candidate_id uuid PRIMARY KEY,
    run_id uuid NOT NULL,
    account_id uuid NOT NULL REFERENCES account(account_id),
    canonical_name text NOT NULL,
    country_code char(2),
    deterministic_rank integer CHECK (deterministic_rank > 0),
    eligible boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    UNIQUE (account_id, candidate_id),
    UNIQUE (run_id, deterministic_rank)
);

CREATE TABLE claim (
    claim_id uuid PRIMARY KEY,
    run_id uuid NOT NULL,
    account_id uuid NOT NULL REFERENCES account(account_id),
    candidate_id uuid NOT NULL,
    assertion_text text NOT NULL,
    decision_bearing boolean NOT NULL,
    verification_status text NOT NULL CHECK (verification_status IN ('claimed','externally_verified','inferred','stale','conflicting','unknown','synthetic')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    FOREIGN KEY (account_id, candidate_id) REFERENCES candidate(account_id, candidate_id),
    UNIQUE (account_id, claim_id)
);

CREATE TABLE claim_evidence (
    claim_id uuid NOT NULL,
    evidence_item_id uuid NOT NULL,
    account_id uuid NOT NULL REFERENCES account(account_id),
    relation text NOT NULL CHECK (relation IN ('supports','contradicts','context')),
    support_locator jsonb NOT NULL,
    PRIMARY KEY (claim_id, evidence_item_id, relation),
    FOREIGN KEY (account_id, claim_id) REFERENCES claim(account_id, claim_id),
    FOREIGN KEY (account_id, evidence_item_id) REFERENCES evidence_item(account_id, evidence_item_id)
);

CREATE TABLE run_result (
    run_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    outcome text NOT NULL CHECK (outcome IN ('candidates','scarcity','no_responsible_match')),
    eligible_count integer NOT NULL CHECK (eligible_count >= 0),
    considered_count integer NOT NULL CHECK (considered_count >= eligible_count),
    scarcity jsonb,
    limitations_text text NOT NULL,
    complete_result_document jsonb NOT NULL,
    result_sha256 bytea NOT NULL CHECK (octet_length(result_sha256) = 32),
    assembled_at timestamptz NOT NULL,
    FOREIGN KEY (account_id, run_id) REFERENCES research_run(account_id, run_id),
    UNIQUE (account_id, run_id)
);

CREATE TABLE result_candidate (
    run_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    account_id uuid NOT NULL REFERENCES account(account_id),
    rank integer NOT NULL CHECK (rank > 0),
    eligible boolean NOT NULL,
    rationale_short text,
    exclusion_reason_code text,
    PRIMARY KEY (run_id, candidate_id),
    FOREIGN KEY (account_id, run_id) REFERENCES run_result(account_id, run_id),
    FOREIGN KEY (account_id, candidate_id) REFERENCES candidate(account_id, candidate_id),
    UNIQUE (run_id, rank)
);

CREATE TABLE projection_serving (
    projection_serving_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    subject_user_id uuid NOT NULL,
    tier text NOT NULL CHECK (tier IN ('demo','standard','consultant','admin')),
    resource_kind text NOT NULL,
    resource_id uuid NOT NULL,
    projection_version_id uuid NOT NULL REFERENCES projection_version(projection_version_id),
    fields_released text[] NOT NULL,
    item_count integer NOT NULL CHECK (item_count >= 0),
    served_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    request_correlation_id text NOT NULL,
    FOREIGN KEY (account_id, subject_user_id) REFERENCES app_user(account_id, user_id)
);

CREATE TABLE audit_event (
    audit_id uuid PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    account_id uuid,
    actor_user_id uuid,
    actor_tier text CHECK (actor_tier IN ('demo','standard','consultant','admin')),
    actor_admin_sub_role text,
    on_behalf_of_user_id uuid,
    event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
    resource_kind text,
    resource_id uuid,
    outcome text NOT NULL CHECK (outcome IN ('allow','deny','error')),
    projection_version_id uuid REFERENCES projection_version(projection_version_id),
    fields_released text[],
    justification text,
    request_correlation_id text NOT NULL,
    deployment_id text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (account_id, actor_user_id) REFERENCES app_user(account_id, user_id),
    FOREIGN KEY (account_id, on_behalf_of_user_id) REFERENCES app_user(account_id, user_id),
    CHECK (justification IS NULL OR length(btrim(justification)) > 0)
);

CREATE INDEX audit_event_account_time_idx ON audit_event (account_id, occurred_at DESC);

CREATE FUNCTION matchbase_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER quota_ledger_append_only
BEFORE UPDATE OR DELETE ON quota_ledger
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

CREATE TRIGGER audit_event_append_only
BEFORE UPDATE OR DELETE ON audit_event
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

CREATE TRIGGER canonical_request_version_immutable
BEFORE UPDATE OR DELETE ON canonical_request_version
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

CREATE TRIGGER canonical_language_record_immutable
BEFORE UPDATE OR DELETE ON canonical_language_record
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

CREATE TRIGGER transformation_provenance_immutable
BEFORE UPDATE OR DELETE ON transformation_provenance
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

CREATE TRIGGER original_text_digest_immutable
BEFORE UPDATE OR DELETE ON original_text_digest
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

CREATE TRIGGER canonical_confirmation_immutable
BEFORE UPDATE OR DELETE ON canonical_confirmation
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

CREATE TRIGGER canonicalization_execution_run_immutable
BEFORE UPDATE OR DELETE ON canonicalization_execution_run
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

CREATE TRIGGER sourcing_request_canonicalization_link_immutable
BEFORE UPDATE OF canonicalization_run_id ON sourcing_request
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

CREATE TRIGGER capability_attempt_immutable
BEFORE UPDATE OR DELETE ON capability_attempt
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

CREATE TRIGGER provider_call_immutable
BEFORE UPDATE OR DELETE ON provider_call
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

CREATE TRIGGER cost_event_immutable
BEFORE UPDATE OR DELETE ON cost_event
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

CREATE FUNCTION matchbase_validate_run_submission() RETURNS trigger
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

CREATE TRIGGER research_run_submission_guard
BEFORE INSERT ON research_run
FOR EACH ROW EXECUTE FUNCTION matchbase_validate_run_submission();

CREATE FUNCTION matchbase_release_terminal_lease() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('complete','no_responsible_match','failed','cancelled','superseded')
     AND OLD.state IS DISTINCT FROM NEW.state THEN
    UPDATE execution_lease
       SET released_at = COALESCE(released_at, clock_timestamp()),
           release_reason = COALESCE(release_reason, 'terminal_state:' || NEW.state)
     WHERE run_id = NEW.run_id AND released_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER research_run_terminal_lease_release
AFTER UPDATE OF state ON research_run
FOR EACH ROW EXECUTE FUNCTION matchbase_release_terminal_lease();

CREATE FUNCTION matchbase_assert_decision_claim_has_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target_claim uuid;
BEGIN
  target_claim := CASE WHEN TG_TABLE_NAME = 'claim' THEN NEW.claim_id ELSE COALESCE(NEW.claim_id, OLD.claim_id) END;
  IF EXISTS (SELECT 1 FROM claim WHERE claim_id = target_claim AND decision_bearing = true)
     AND NOT EXISTS (
       SELECT 1 FROM claim_evidence ce
        WHERE ce.claim_id = target_claim AND ce.relation = 'supports'
     ) THEN
    RAISE EXCEPTION 'decision-bearing claim % has no supporting evidence', target_claim USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER claim_requires_evidence
AFTER INSERT OR UPDATE OF decision_bearing ON claim
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION matchbase_assert_decision_claim_has_evidence();

CREATE CONSTRAINT TRIGGER claim_evidence_delete_guard
AFTER DELETE OR UPDATE ON claim_evidence
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION matchbase_assert_decision_claim_has_evidence();

CREATE FUNCTION matchbase_assert_attempt_ledger_closed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM provider_call p
      JOIN provider_route r ON r.provider_route_id = NEW.provider_route_id
     WHERE p.capability_attempt_id = NEW.capability_attempt_id
       AND p.account_id = NEW.account_id
       AND p.user_id = NEW.user_id
       AND p.run_id IS NOT DISTINCT FROM NEW.run_id
       AND p.canonicalization_run_id IS NOT DISTINCT FROM NEW.canonicalization_run_id
       AND p.capability = NEW.capability
       AND p.provider = NEW.provider
       AND p.model_id = NEW.model_id
       AND p.environment = NEW.environment
       AND p.route_id = r.route_id
  ) THEN
    RAISE EXCEPTION 'capability attempt % has no dimension-matched provider call', NEW.capability_attempt_id USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM cost_event c
     WHERE c.capability_attempt_id = NEW.capability_attempt_id
       AND c.account_id = NEW.account_id
       AND c.user_id = NEW.user_id
       AND c.run_id IS NOT DISTINCT FROM NEW.run_id
       AND c.canonicalization_run_id IS NOT DISTINCT FROM NEW.canonicalization_run_id
       AND c.capability = NEW.capability
       AND c.provider = NEW.provider
       AND c.model_id = NEW.model_id
       AND c.environment = NEW.environment
  ) THEN
    RAISE EXCEPTION 'capability attempt % has no dimension-matched cost event', NEW.capability_attempt_id USING ERRCODE = '23514';
  END IF;
  IF NEW.canonicalization_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM canonicalization_execution_run x
     WHERE x.canonicalization_run_id = NEW.canonicalization_run_id
       AND x.account_id = NEW.account_id
       AND x.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'capability attempt % has mismatched canonicalization-run attribution', NEW.capability_attempt_id USING ERRCODE = '23514';
  END IF;
  IF NEW.run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM research_run r
     WHERE r.run_id = NEW.run_id
       AND r.account_id = NEW.account_id
       AND r.requested_by_user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'capability attempt % has mismatched research-run attribution', NEW.capability_attempt_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER capability_attempt_requires_closed_ledger
AFTER INSERT ON capability_attempt
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION matchbase_assert_attempt_ledger_closed();

REVOKE UPDATE, DELETE ON quota_ledger FROM PUBLIC;
REVOKE UPDATE, DELETE ON audit_event FROM PUBLIC;
REVOKE UPDATE, DELETE ON canonicalization_execution_run FROM PUBLIC;
REVOKE UPDATE, DELETE ON capability_attempt, provider_call, cost_event FROM PUBLIC;

COMMENT ON TABLE original_text_digest IS
  'HMAC-SHA-256 change detector only. Original-language source text is prohibited from every table.';
COMMENT ON TABLE execution_lease IS
  'Exactly three preallocated global execution slots; queue depth is independent of active leases.';
COMMENT ON TABLE cost_event IS
  'Attribution ledger only. No monetary hard-stop policy is activated by this schema.';
COMMENT ON TABLE canonicalization_execution_run IS
  'Pre-request execution identity for canonicalization. It preserves run/user/account correlation without fabricating a research_run; a successful sourcing_request links it to later research runs through the canonical version.';
