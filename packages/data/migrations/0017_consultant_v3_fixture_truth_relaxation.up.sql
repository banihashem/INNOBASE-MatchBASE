-- Migration: 0017_consultant_v3_fixture_truth_relaxation.up.sql
-- Description: Allow nullable website/domain and not_assessed confidence levels for synthetic demonstration truthfulness.

ALTER TABLE consultant_supplier_entity_v3
    ALTER COLUMN website DROP NOT NULL,
    ALTER COLUMN primary_domain DROP NOT NULL;

ALTER TABLE consultant_supplier_entity_v3
    DROP CONSTRAINT IF EXISTS consultant_supplier_entity_v3_evidence_confidence_check,
    ADD CONSTRAINT consultant_supplier_entity_v3_evidence_confidence_check
        CHECK (evidence_confidence IN ('high', 'medium', 'low', 'not_assessed'));

ALTER TABLE consultant_supplier_entity_v3
    DROP CONSTRAINT IF EXISTS consultant_supplier_entity_v3_identity_confidence_check,
    ADD CONSTRAINT consultant_supplier_entity_v3_identity_confidence_check
        CHECK (identity_confidence IN ('high', 'medium', 'low', 'not_assessed'));
