-- Migration: 0016_consultant_v3_draft_isolation_and_snapshots.down.sql
-- Description: Rollback of draft isolation, intake snapshots, and invalidation tracking.

ALTER TABLE consultant_workflow_session
    DROP COLUMN IF EXISTS invalidation_reason,
    DROP COLUMN IF EXISTS is_invalidated;

ALTER TABLE consultant_output_v3
    DROP COLUMN IF EXISTS invalidation_reason,
    DROP COLUMN IF EXISTS is_invalidated;

DROP TABLE IF EXISTS consultant_draft_session;
DROP TABLE IF EXISTS consultant_intake_snapshot;
