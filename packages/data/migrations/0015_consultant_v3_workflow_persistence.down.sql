-- Migration: 0015_consultant_v3_workflow_persistence.down.sql
-- Description: Clean reversal of Consultant v3 workflow session persistence.

DROP TABLE IF EXISTS consultant_workflow_session CASCADE;
