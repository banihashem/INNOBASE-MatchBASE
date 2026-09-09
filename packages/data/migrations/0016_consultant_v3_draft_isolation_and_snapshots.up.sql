-- Migration: 0016_consultant_v3_draft_isolation_and_snapshots.up.sql
-- Description: Server-side draft storage, atomic intake snapshots, and invalidation tracking for Consultant v3 workflow.

CREATE TABLE IF NOT EXISTS consultant_intake_snapshot (
    snapshot_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    user_profile_id uuid NOT NULL,
    run_id uuid NOT NULL,
    revision_number integer NOT NULL DEFAULT 1,
    product_requirement text NOT NULL,
    technical_compliance text NOT NULL,
    order_profile text NOT NULL,
    content_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_consultant_intake_snapshot_run
    ON consultant_intake_snapshot (account_id, run_id, revision_number);

CREATE TABLE IF NOT EXISTS consultant_draft_session (
    draft_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(account_id),
    user_profile_id uuid NOT NULL,
    tier text NOT NULL CHECK (tier = 'consultant'),
    current_run_id uuid,
    snapshot_id uuid REFERENCES consultant_intake_snapshot(snapshot_id),
    draft_version integer NOT NULL DEFAULT 1,
    status text NOT NULL CHECK (status IN ('active', 'submitted', 'abandoned')),
    draft_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_consultant_draft_session_user
    ON consultant_draft_session (account_id, user_profile_id, status);

ALTER TABLE consultant_output_v3
    ADD COLUMN IF NOT EXISTS is_invalidated boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS invalidation_reason text;

ALTER TABLE consultant_workflow_session
    ADD COLUMN IF NOT EXISTS is_invalidated boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS invalidation_reason text;
