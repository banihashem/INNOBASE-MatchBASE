CREATE TABLE google_risc_event_receipt (
  receipt_id uuid PRIMARY KEY,
  event_id_sha256 bytea NOT NULL UNIQUE CHECK (octet_length(event_id_sha256) = 32),
  issuer text NOT NULL CHECK (issuer = 'https://accounts.google.com'),
  audience_sha256 bytea NOT NULL CHECK (octet_length(audience_sha256) = 32),
  event_type text NOT NULL CHECK (event_type IN (
    'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
    'https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked',
    'https://schemas.openid.net/secevent/oauth/event-type/token-revoked',
    'https://schemas.openid.net/secevent/risc/event-type/account-disabled',
    'https://schemas.openid.net/secevent/risc/event-type/account-enabled',
    'https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required',
    'https://schemas.openid.net/secevent/risc/event-type/verification'
  )),
  issued_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  subject_sha256 bytea CHECK (subject_sha256 IS NULL OR octet_length(subject_sha256) = 32),
  action text NOT NULL CHECK (action IN ('sessions_revoked','recorded')),
  affected_session_count integer NOT NULL CHECK (affected_session_count >= 0),
  reason_code text CHECK (reason_code IN ('hijacking','bulk-account','other')),
  verification_state_sha256 bytea CHECK (
    verification_state_sha256 IS NULL OR octet_length(verification_state_sha256) = 32
  ),
  request_correlation_id text NOT NULL CHECK (length(btrim(request_correlation_id)) > 0),
  deployment_id text NOT NULL CHECK (length(btrim(deployment_id)) > 0),
  CHECK (action <> 'sessions_revoked' OR subject_sha256 IS NOT NULL)
);

CREATE INDEX google_risc_event_received_idx
  ON google_risc_event_receipt (received_at DESC);

CREATE TRIGGER google_risc_event_receipt_append_only
BEFORE UPDATE OR DELETE ON google_risc_event_receipt
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

ALTER TABLE google_risc_event_receipt
  ENABLE ALWAYS TRIGGER google_risc_event_receipt_append_only;

REVOKE UPDATE, DELETE ON google_risc_event_receipt FROM PUBLIC, CURRENT_USER;

COMMENT ON TABLE google_risc_event_receipt IS
  'Data-minimized, append-only Google RISC replay and response evidence. Raw SETs, event IDs, Google subjects, audiences, and verification states are never persisted.';
