-- Migration: 0015_consultant_v3_workflow_persistence.up.sql
-- Description: Schema support for persistent Consultant v3 workflow sessions, Human approval revision lineage, and resume capabilities.

CREATE TABLE IF NOT EXISTS consultant_workflow_session (
    session_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    user_profile_id uuid NOT NULL,
    current_state text NOT NULL,
    original_intake jsonb NOT NULL,
    draft_revision jsonb,
    approved_request_revision jsonb,
    advisory_output jsonb,
    advisory_loop_records jsonb,
    deep_prompt_revision jsonb,
    approvals jsonb NOT NULL DEFAULT '[]'::jsonb,
    classification jsonb,
    execution_id uuid,
    last_checkpoint text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (account_id, run_id)
);

CREATE INDEX IF NOT EXISTS consultant_workflow_session_run_idx
    ON consultant_workflow_session (account_id, run_id, current_state);

CREATE INDEX IF NOT EXISTS consultant_workflow_session_updated_idx
    ON consultant_workflow_session (account_id, updated_at DESC);
