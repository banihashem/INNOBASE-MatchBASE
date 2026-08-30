DROP TRIGGER IF EXISTS artifact_access_grant_use_append_only ON artifact_access_grant_use;
DROP TRIGGER IF EXISTS artifact_access_grant_revocation_append_only ON artifact_access_grant_revocation;
DROP TRIGGER IF EXISTS artifact_access_grant_append_only ON artifact_access_grant;
DROP TRIGGER IF EXISTS artifact_qa_check_append_only ON artifact_qa_check;
DROP TRIGGER IF EXISTS artifact_version_immutable_guard ON artifact_version;
DROP FUNCTION IF EXISTS matchbase_guard_artifact_version_mutation();
DROP TRIGGER IF EXISTS artifact_release_gate ON artifact_version;
DROP FUNCTION IF EXISTS matchbase_assert_artifact_release();
DROP TABLE IF EXISTS artifact_access_grant_use;
DROP TABLE IF EXISTS artifact_access_grant_revocation;
DROP TABLE IF EXISTS artifact_access_grant;
DROP TABLE IF EXISTS artifact_qa_check;
DROP TABLE IF EXISTS artifact_version;
DROP TABLE IF EXISTS artifact;

DROP TRIGGER IF EXISTS audit_integrity_verification_append_only ON audit_integrity_verification;
DROP TRIGGER IF EXISTS audit_integrity_checkpoint_append_only ON audit_integrity_checkpoint;
DROP TABLE IF EXISTS audit_integrity_verification;
DROP TABLE IF EXISTS audit_integrity_checkpoint;

ALTER TABLE audit_event DISABLE TRIGGER audit_event_append_only;
ALTER TABLE audit_event ENABLE TRIGGER audit_event_append_only;
ALTER TABLE audit_event DROP COLUMN IF EXISTS event_schema_version;
