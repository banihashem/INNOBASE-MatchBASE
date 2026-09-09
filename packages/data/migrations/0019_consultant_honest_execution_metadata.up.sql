-- MB-UX-LIVE-001 L01: unknown classification and zero-call fixtures are explicit.
ALTER TABLE product_classification DROP CONSTRAINT product_classification_confidence_check;
ALTER TABLE product_classification ADD CONSTRAINT product_classification_confidence_check
  CHECK (confidence IN ('high', 'medium', 'low', 'not_assessed'));
ALTER TABLE consultant_research_execution DROP CONSTRAINT consultant_research_execution_verification_loops_count_check;
ALTER TABLE consultant_research_execution ADD CONSTRAINT consultant_research_execution_verification_loops_count_check
  CHECK (verification_loops_count >= 0);
