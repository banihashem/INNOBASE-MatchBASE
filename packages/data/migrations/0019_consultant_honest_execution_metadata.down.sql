-- Refuse rollback when truthful zero-loop/unassessed records still exist.
ALTER TABLE consultant_research_execution DROP CONSTRAINT consultant_research_execution_verification_loops_count_check;
ALTER TABLE consultant_research_execution ADD CONSTRAINT consultant_research_execution_verification_loops_count_check
  CHECK (verification_loops_count >= 1);
ALTER TABLE product_classification DROP CONSTRAINT product_classification_confidence_check;
ALTER TABLE product_classification ADD CONSTRAINT product_classification_confidence_check
  CHECK (confidence IN ('high', 'medium', 'low'));
