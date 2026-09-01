DROP TABLE IF EXISTS artifact_render_job;
DROP INDEX IF EXISTS artifact_one_consultant_pdf_per_run_idx;
ALTER TABLE artifact_version
  DROP CONSTRAINT IF EXISTS artifact_released_qualification_check,
  DROP COLUMN IF EXISTS qualification_sha256,
  DROP COLUMN IF EXISTS qualification_evidence,
  DROP COLUMN IF EXISTS qualification_contract_version;
