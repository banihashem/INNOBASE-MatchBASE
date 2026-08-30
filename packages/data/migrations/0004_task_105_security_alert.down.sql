DROP TRIGGER IF EXISTS security_alert_append_only ON security_alert;
DROP TRIGGER IF EXISTS security_alert_audit_link_guard ON security_alert;
DROP TABLE IF EXISTS security_alert;
DROP FUNCTION IF EXISTS matchbase_validate_security_alert_link();

ALTER TABLE audit_event
  DROP CONSTRAINT IF EXISTS audit_event_account_audit_uk;
