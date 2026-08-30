ALTER TABLE audit_event
  ADD CONSTRAINT audit_event_account_audit_uk UNIQUE (account_id, audit_id);

CREATE TABLE security_alert (
    security_alert_id uuid PRIMARY KEY,
    audit_id uuid NOT NULL UNIQUE,
    account_id uuid NOT NULL REFERENCES account(account_id),
    actor_user_id uuid NOT NULL,
    subject_user_id uuid NOT NULL,
    event_type text NOT NULL CHECK (event_type = 'security.self_elevation_attempted'),
    severity text NOT NULL CHECK (severity = 'high'),
    reason_code text NOT NULL CHECK (reason_code = 'self-mutation-refused'),
    entitlement_kind text NOT NULL CHECK (entitlement_kind IN ('tier','admin_sub_role')),
    entitlement_value text NOT NULL CHECK (
      (entitlement_kind = 'tier' AND entitlement_value IN ('demo','standard','consultant','admin')) OR
      (entitlement_kind = 'admin_sub_role' AND entitlement_value IN
        ('support','analyst','consultant_manager','product','security_audit','super_admin'))
    ),
    request_correlation_id text NOT NULL CHECK (length(btrim(request_correlation_id)) > 0),
    deployment_id text NOT NULL CHECK (length(btrim(deployment_id)) > 0),
    occurred_at timestamptz NOT NULL,
    CHECK (actor_user_id = subject_user_id),
    FOREIGN KEY (account_id, audit_id)
      REFERENCES audit_event(account_id, audit_id),
    FOREIGN KEY (account_id, actor_user_id)
      REFERENCES app_user(account_id, user_id),
    FOREIGN KEY (account_id, subject_user_id)
      REFERENCES app_user(account_id, user_id)
);

CREATE INDEX security_alert_account_time_idx
  ON security_alert (account_id, occurred_at DESC);

CREATE FUNCTION matchbase_validate_security_alert_link() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM audit_event linked
     WHERE linked.audit_id = NEW.audit_id
       AND linked.account_id = NEW.account_id
       AND linked.actor_user_id = NEW.actor_user_id
       AND linked.event_type = NEW.event_type
       AND linked.resource_kind = 'app_user'
       AND linked.resource_id = NEW.subject_user_id
       AND linked.outcome = 'deny'
       AND linked.request_correlation_id = NEW.request_correlation_id
       AND linked.deployment_id = NEW.deployment_id
       AND linked.occurred_at = NEW.occurred_at
       AND linked.detail ->> 'reasonCode' = NEW.reason_code
       AND linked.detail ->> 'entitlementKind' = NEW.entitlement_kind
       AND linked.detail ->> 'entitlementValue' = NEW.entitlement_value
  ) THEN
    RAISE EXCEPTION 'security alert must match its canonical deny audit event'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER security_alert_audit_link_guard
BEFORE INSERT ON security_alert
FOR EACH ROW EXECUTE FUNCTION matchbase_validate_security_alert_link();

CREATE TRIGGER security_alert_append_only
BEFORE UPDATE OR DELETE ON security_alert
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

ALTER TABLE security_alert ENABLE ALWAYS TRIGGER security_alert_append_only;

REVOKE UPDATE, DELETE ON security_alert FROM PUBLIC, CURRENT_USER;

COMMENT ON TABLE security_alert IS
  'Durable append-only self-elevation alert evidence. UPDATE/DELETE are rejected by an ALWAYS trigger because PostgreSQL owners retain implicit privileges. External notification and pager delivery are outside this table contract.';
