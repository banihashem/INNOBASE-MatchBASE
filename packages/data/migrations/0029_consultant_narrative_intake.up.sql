-- MB-UX-LOGISTICS-001 L01: preparation has no research/classification identity.
CREATE TABLE consultant_narrative_intake (
  operation_id uuid PRIMARY KEY,
  draft_id uuid NOT NULL UNIQUE REFERENCES consultant_draft_session(draft_id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  reserved_version integer NOT NULL CHECK (reserved_version > 0),
  industry text NOT NULL CHECK (industry='logistics'),
  narrative text NOT NULL CHECK (length(btrim(narrative)) > 0 AND length(narrative) <= 12000),
  status text NOT NULL CHECK (status IN ('reserved','running','completed','failed')),
  proposal jsonb,
  receipts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX consultant_narrative_intake_run ON consultant_narrative_intake(account_id,user_profile_id,run_id);
CREATE FUNCTION matchbase_narrative_intake_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM consultant_draft_session d WHERE d.draft_id=NEW.draft_id AND d.account_id=NEW.account_id AND d.user_profile_id=NEW.user_profile_id AND d.status='active' AND d.draft_version=NEW.reserved_version)
    THEN RAISE EXCEPTION 'Narrative operation requires the current owned active draft'; END IF;
  ELSE
    IF ROW(NEW.operation_id,NEW.draft_id,NEW.account_id,NEW.user_profile_id,NEW.reserved_version,NEW.industry,NEW.narrative,NEW.created_at) IS DISTINCT FROM ROW(OLD.operation_id,OLD.draft_id,OLD.account_id,OLD.user_profile_id,OLD.reserved_version,OLD.industry,OLD.narrative,OLD.created_at)
    OR (OLD.proposal IS NOT NULL AND NEW.proposal IS DISTINCT FROM OLD.proposal)
    OR (OLD.run_id IS NOT NULL AND NEW.run_id IS DISTINCT FROM OLD.run_id)
    THEN RAISE EXCEPTION 'Narrative provenance is immutable'; END IF;
    IF NEW.run_id IS DISTINCT FROM OLD.run_id AND NOT EXISTS(SELECT 1 FROM consultant_draft_session d WHERE d.draft_id=NEW.draft_id AND d.account_id=NEW.account_id AND d.user_profile_id=NEW.user_profile_id AND d.current_run_id=NEW.run_id AND d.status='submitted')
    THEN RAISE EXCEPTION 'Narrative run lineage requires its submitted owned draft'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_each(OLD.receipts) r WHERE NOT NEW.receipts ? r.key OR (r.value->>'state' IN ('completed','failed') AND NEW.receipts->r.key IS DISTINCT FROM r.value))
    THEN RAISE EXCEPTION 'Recorded terminal preparation receipts are immutable'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER consultant_narrative_intake_guard BEFORE INSERT OR UPDATE ON consultant_narrative_intake FOR EACH ROW EXECUTE FUNCTION matchbase_narrative_intake_guard();
