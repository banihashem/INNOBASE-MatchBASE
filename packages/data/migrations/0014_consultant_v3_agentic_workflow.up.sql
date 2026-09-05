-- Migration: 0014_consultant_v3_agentic_workflow.up.sql
-- Description: Schema support for Consultant-tier v3 agentic research workflow, four-ID traceability, 20-supplier entities, and publication-grade PDF ledger.

CREATE TABLE IF NOT EXISTS product_classification (
    classification_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    scheme text NOT NULL CHECK (scheme IN ('HS', 'GS1_GPC', 'UNSPSC', 'ECLASS', 'ETIM', 'CUSTOM_MATCHBASE')),
    code text NOT NULL,
    version text NOT NULL,
    jurisdiction text,
    level text NOT NULL,
    label text NOT NULL,
    description text NOT NULL,
    confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
    assigned_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS product_classification_code_idx
    ON product_classification (account_id, scheme, code);

CREATE TABLE IF NOT EXISTS consultant_research_execution (
    execution_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    user_profile_id uuid NOT NULL,
    classification_id uuid NOT NULL REFERENCES product_classification(classification_id),
    lanes_executed text[] NOT NULL,
    verification_loops_count integer NOT NULL CHECK (verification_loops_count >= 1),
    total_input_tokens integer NOT NULL DEFAULT 0,
    total_output_tokens integer NOT NULL DEFAULT 0,
    total_cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
    execution_latency_ms integer NOT NULL DEFAULT 0,
    synthesis_model_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS consultant_execution_run_idx
    ON consultant_research_execution (account_id, run_id, status);

CREATE TABLE IF NOT EXISTS consultant_output_v3 (
    output_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    execution_id uuid NOT NULL REFERENCES consultant_research_execution(execution_id),
    classification_id uuid NOT NULL REFERENCES product_classification(classification_id),
    user_profile_id uuid NOT NULL,
    schema_version text NOT NULL DEFAULT 'consultant-research-output.v3',
    schema_contract_version integer NOT NULL DEFAULT 1,
    title text NOT NULL,
    subtitle text,
    generated_at timestamptz NOT NULL,
    as_of_date date NOT NULL,
    research_mode text NOT NULL CHECK (research_mode IN ('live', 'hybrid', 'fixture')),
    research_status text NOT NULL CHECK (research_status IN ('complete', 'partial', 'insufficient_evidence', 'no_strong_match', 'out_of_scope', 'failed')),
    target_candidates_count integer NOT NULL DEFAULT 20 CHECK (target_candidates_count = 20),
    total_candidates_found integer NOT NULL DEFAULT 0 CHECK (total_candidates_found >= 0),
    document_payload jsonb NOT NULL,
    document_sha256 bytea NOT NULL CHECK (octet_length(document_sha256) = 32),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (account_id, run_id)
);

CREATE INDEX IF NOT EXISTS consultant_output_v3_date_idx
    ON consultant_output_v3 (account_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS consultant_supplier_entity_v3 (
    entity_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    candidate_id text NOT NULL,
    legal_name text NOT NULL,
    trading_name text,
    brand_names text[] NOT NULL DEFAULT '{}',
    aliases text[] NOT NULL DEFAULT '{}',
    parent_entity_id uuid,
    supplier_type text NOT NULL,
    manufacturer_status text NOT NULL,
    country_of_registration text NOT NULL,
    headquarters_address text NOT NULL,
    website text NOT NULL,
    primary_domain text NOT NULL,
    rank integer NOT NULL CHECK (rank > 0),
    compatibility_score numeric(5, 2) NOT NULL CHECK (compatibility_score >= 0 AND compatibility_score <= 100),
    fit_band text NOT NULL CHECK (fit_band IN ('Strong Fit', 'Potential Fit', 'Low Fit')),
    evidence_confidence text NOT NULL CHECK (evidence_confidence IN ('high', 'medium', 'low')),
    identity_confidence text NOT NULL CHECK (identity_confidence IN ('high', 'medium', 'low')),
    data_completeness numeric(5, 2) NOT NULL CHECK (data_completeness >= 0 AND data_completeness <= 100),
    raw_entity_json jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (account_id, run_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS consultant_supplier_entity_v3_rank_idx
    ON consultant_supplier_entity_v3 (account_id, run_id, rank);

CREATE TABLE IF NOT EXISTS consultant_pdf_report_ledger (
    report_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    output_id uuid NOT NULL REFERENCES consultant_output_v3(output_id),
    filename text NOT NULL,
    pdf_sha256 bytea NOT NULL CHECK (octet_length(pdf_sha256) = 32),
    file_size_bytes integer NOT NULL CHECK (file_size_bytes > 0),
    page_count integer NOT NULL CHECK (page_count > 0),
    landscape_orientation boolean NOT NULL DEFAULT true,
    generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (account_id, run_id)
);
