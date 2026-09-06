-- Migration: 0017_consultant_v3_fixture_truth_relaxation.down.sql
-- Description: Revert fixture truth relaxation.

ALTER TABLE consultant_supplier_entity_v3
    DROP CONSTRAINT IF EXISTS consultant_supplier_entity_v3_identity_confidence_check,
    ADD CONSTRAINT consultant_supplier_entity_v3_identity_confidence_check
        CHECK (identity_confidence IN ('high', 'medium', 'low'));

ALTER TABLE consultant_supplier_entity_v3
    DROP CONSTRAINT IF EXISTS consultant_supplier_entity_v3_evidence_confidence_check,
    ADD CONSTRAINT consultant_supplier_entity_v3_evidence_confidence_check
        CHECK (evidence_confidence IN ('high', 'medium', 'low'));

ALTER TABLE consultant_supplier_entity_v3
    ALTER COLUMN website SET NOT NULL,
    ALTER COLUMN primary_domain SET NOT NULL;
