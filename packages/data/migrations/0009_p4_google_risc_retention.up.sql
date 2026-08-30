CREATE TABLE google_risc_receipt_purge_audit (
  purge_batch_id uuid PRIMARY KEY,
  cutoff_at timestamptz NOT NULL,
  purged_count integer NOT NULL CHECK (purged_count >= 0),
  oldest_received_at timestamptz,
  newest_received_at timestamptz,
  event_type_counts jsonb NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('retention_expired','privacy_request')),
  request_correlation_id text NOT NULL CHECK (length(btrim(request_correlation_id)) > 0),
  deployment_id text NOT NULL CHECK (length(btrim(deployment_id)) > 0),
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (purged_count = 0 AND oldest_received_at IS NULL AND newest_received_at IS NULL)
    OR
    (purged_count > 0 AND oldest_received_at IS NOT NULL AND newest_received_at IS NOT NULL
      AND oldest_received_at <= newest_received_at AND newest_received_at < cutoff_at)
  )
);

CREATE TRIGGER google_risc_receipt_purge_audit_append_only
BEFORE UPDATE OR DELETE ON google_risc_receipt_purge_audit
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();
ALTER TABLE google_risc_receipt_purge_audit
  ENABLE ALWAYS TRIGGER google_risc_receipt_purge_audit_append_only;
REVOKE UPDATE, DELETE, TRUNCATE ON google_risc_receipt_purge_audit FROM PUBLIC;

CREATE FUNCTION matchbase_google_risc_receipt_retention_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  batch_id_text text;
BEGIN
  batch_id_text := current_setting('matchbase.google_risc_purge_batch_id', true);
  IF TG_OP = 'DELETE' AND batch_id_text IS NOT NULL AND EXISTS (
    SELECT 1
      FROM google_risc_receipt_purge_audit audit
     WHERE audit.purge_batch_id::text = batch_id_text
       AND OLD.received_at < audit.cutoff_at
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'google_risc_event_receipt is retention-governed' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER google_risc_event_receipt_append_only ON google_risc_event_receipt;
CREATE TRIGGER google_risc_event_receipt_retention_governed
BEFORE UPDATE OR DELETE ON google_risc_event_receipt
FOR EACH ROW EXECUTE FUNCTION matchbase_google_risc_receipt_retention_guard();
ALTER TABLE google_risc_event_receipt
  ENABLE ALWAYS TRIGGER google_risc_event_receipt_retention_governed;

CREATE FUNCTION matchbase_purge_google_risc_receipts(
  p_purge_batch_id uuid,
  p_cutoff_at timestamptz,
  p_reason_code text,
  p_request_correlation_id text,
  p_deployment_id text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  selected_count integer;
  oldest_at timestamptz;
  newest_at timestamptz;
  type_counts jsonb;
  deleted_count integer;
BEGIN
  IF p_cutoff_at > clock_timestamp() - interval '30 days'
     OR p_reason_code NOT IN ('retention_expired','privacy_request')
     OR length(btrim(p_request_correlation_id)) = 0
     OR length(btrim(p_deployment_id)) = 0 THEN
    RAISE EXCEPTION 'Google RISC purge request is outside retention policy' USING ERRCODE = '22023';
  END IF;

  LOCK TABLE google_risc_event_receipt IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*)::integer, min(received_at), max(received_at)
    INTO selected_count, oldest_at, newest_at
    FROM google_risc_event_receipt
   WHERE received_at < p_cutoff_at;
  SELECT coalesce(jsonb_object_agg(event_type, count), '{}'::jsonb)
    INTO type_counts
    FROM (
      SELECT event_type, count(*)::integer AS count
        FROM google_risc_event_receipt
       WHERE received_at < p_cutoff_at
       GROUP BY event_type
       ORDER BY event_type
    ) counts;

  INSERT INTO google_risc_receipt_purge_audit
    (purge_batch_id,cutoff_at,purged_count,oldest_received_at,newest_received_at,
     event_type_counts,reason_code,request_correlation_id,deployment_id)
  VALUES
    (p_purge_batch_id,p_cutoff_at,selected_count,oldest_at,newest_at,type_counts,
     p_reason_code,p_request_correlation_id,p_deployment_id);

  PERFORM set_config('matchbase.google_risc_purge_batch_id', p_purge_batch_id::text, true);
  DELETE FROM google_risc_event_receipt WHERE received_at < p_cutoff_at;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> selected_count THEN
    RAISE EXCEPTION 'Google RISC retention purge count changed during execution' USING ERRCODE = '40001';
  END IF;
  RETURN deleted_count;
END;
$$;
REVOKE ALL ON FUNCTION matchbase_purge_google_risc_receipts(uuid,timestamptz,text,text,text) FROM PUBLIC;

COMMENT ON TABLE google_risc_receipt_purge_audit IS
  'Append-only retention evidence preserving the cutoff, exact count, time range, and coarse event-type distribution after data-minimized RISC receipts are purged.';
