-- MB-ARCH-IMPLEMENT-001 L06: verified profile-bound reader admission.
CREATE FUNCTION matchbase_public.reader_ready(expected_account uuid,expected_profile uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE p matchbase_public.principal;
BEGIN
 p:=matchbase_public.actor('reader');
 RETURN p.account_id=expected_account AND p.profile_id=expected_profile;
END $body$;

CREATE FUNCTION matchbase_public.lookup_refs(refs jsonb)
RETURNS TABLE(observation_id uuid,rights_epoch integer,source_url text,source_assertion_sha256 text,
 published_at timestamptz,retrieved_at timestamptz,valid_until timestamptz,claim_kind text,claim_text text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE ref jsonb;
BEGIN
 PERFORM matchbase_public.actor('reader');
 PERFORM 1 FROM matchbase_public.control WHERE restore_ready FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Restored corpus requires tombstone reconciliation'; END IF;
 IF jsonb_typeof(refs)<>'array' OR jsonb_array_length(refs)>50
 THEN RAISE EXCEPTION 'Invalid public evidence references'; END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(refs) ORDER BY value->>'observation_id' LOOP
  IF (SELECT count(*) FROM jsonb_object_keys(ref))<>2 OR NOT ref ?& ARRAY['observation_id','rights_epoch']
  THEN RAISE EXCEPTION 'Invalid public evidence reference'; END IF;
 END LOOP;
 RETURN QUERY SELECT o.observation_id,o.rights_epoch,o.source_url,o.source_assertion_sha256,
  o.source_published_at,o.source_retrieved_at,o.valid_until,o.claim_kind,o.claim_text
 FROM matchbase_public.observation o JOIN matchbase_public.source s ON s.source_url=o.source_url
 JOIN jsonb_array_elements(refs) r ON o.observation_id=(r->>'observation_id')::uuid AND o.rights_epoch=(r->>'rights_epoch')::integer
 WHERE o.state='released' AND o.valid_until>clock_timestamp() AND s.state='active' AND s.rights_epoch=o.rights_epoch
   AND matchbase_public.public_source_url(o.source_url)
 ORDER BY o.observation_id FOR SHARE OF o,s;
END $body$;

REVOKE ALL ON FUNCTION matchbase_public.reader_ready(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION matchbase_public.lookup_refs(jsonb) FROM PUBLIC;

