-- MB-ARCH-IMPLEMENT-001 L04. Default-deny, independently acquired public catalogue.
-- Capability roles and verified login bindings are provisioned separately by an administrator.
CREATE SCHEMA matchbase_public;
REVOKE ALL ON SCHEMA matchbase_public FROM PUBLIC;

CREATE TABLE matchbase_public.control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 restore_ready boolean NOT NULL DEFAULT false,
 tombstone_watermark bigint NOT NULL DEFAULT 0 CHECK(tombstone_watermark>=0)
);
INSERT INTO matchbase_public.control DEFAULT VALUES;
CREATE TABLE matchbase_public.principal (
 database_role name PRIMARY KEY,
 account_id uuid NOT NULL,
 profile_id uuid NOT NULL,
 capability text NOT NULL CHECK(capability IN ('reader','acquirer','releaser')),
 verified_identity_reference text NOT NULL CHECK(length(verified_identity_reference) BETWEEN 8 AND 200),
 enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE matchbase_public.authority (
 authority_id uuid PRIMARY KEY,
 catalogue_job_id uuid NOT NULL,
 acquisition_execution_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose='independent_public_catalogue'),
 acquisition_mode text NOT NULL CHECK(acquisition_mode='manual_unpaid'),
 source_url text NOT NULL,
 approved_by name NOT NULL,
 expires_at timestamptz NOT NULL,
 max_observations integer NOT NULL CHECK(max_observations BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE matchbase_public.source (
 source_url text PRIMARY KEY,
 rights_epoch integer NOT NULL DEFAULT 1 CHECK(rights_epoch>0),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','withdrawn'))
);
CREATE TABLE matchbase_public.observation (
 observation_id uuid PRIMARY KEY,
 authority_id uuid NOT NULL REFERENCES matchbase_public.authority,
 acquisition_profile_id uuid NOT NULL,
 acquisition_run_id uuid NOT NULL,
 acquisition_execution_id uuid NOT NULL,
 classification_id uuid NOT NULL,
 acquired_by name NOT NULL,
 source_url text NOT NULL REFERENCES matchbase_public.source,
 source_assertion_sha256 text NOT NULL CHECK(source_assertion_sha256 ~ '^[a-f0-9]{64}$'),
 source_published_at timestamptz,
 source_retrieved_at timestamptz NOT NULL,
 claim_kind text NOT NULL CHECK(claim_kind IN ('public_identity','product_capability','public_price','certification')),
 claim_text text NOT NULL CHECK(length(claim_text) BETWEEN 1 AND 4000),
 classification_scheme text NOT NULL CHECK(classification_scheme IN ('HS','CPC','ISIC')),
 classification_code text NOT NULL CHECK(classification_code ~ '^[A-Za-z0-9.-]{1,20}$'),
 classification_version text NOT NULL CHECK(length(classification_version) BETWEEN 1 AND 30),
 valid_until timestamptz NOT NULL,
 rights_basis text NOT NULL CHECK(rights_basis IN ('public_domain','explicit_redistribution_license')),
 rights_reference text NOT NULL CHECK(length(rights_reference) BETWEEN 8 AND 500),
 rights_epoch integer NOT NULL DEFAULT 1 CHECK(rights_epoch>0),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','released','withdrawn')),
 released_by name,
 released_at timestamptz,
 release_review_reference text,
 UNIQUE(authority_id,source_assertion_sha256),
 CHECK(source_published_at IS NULL OR source_published_at<=source_retrieved_at),
 CHECK(valid_until>source_retrieved_at)
);
CREATE TABLE matchbase_public.derivative (
 derivative_id uuid PRIMARY KEY,
 account_id uuid NOT NULL,
 profile_id uuid NOT NULL,
 created_by name NOT NULL,
 kind text NOT NULL CHECK(kind IN ('use_manifest','report','cache','index','summary')),
 artifact_reference text NOT NULL CHECK(length(artifact_reference) BETWEEN 1 AND 200),
 dependencies jsonb NOT NULL CHECK(jsonb_typeof(dependencies)='array' AND jsonb_array_length(dependencies)>0),
 valid boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE matchbase_public.tombstone (
 sequence bigint PRIMARY KEY,
 observation_id uuid NOT NULL,
 source_url text NOT NULL,
 rights_epoch integer NOT NULL,
 reason_code text NOT NULL CHECK(reason_code IN ('rights_withdrawn','source_correction','expiry_override')),
 withdrawn_by name NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(observation_id,rights_epoch)
);

-- Even an accidental SELECT grant must not expose unreleased observations or private use lineage.
DO $body$ DECLARE t text; BEGIN
 FOR t IN SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='matchbase_public' LOOP
  EXECUTE format('ALTER TABLE matchbase_public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE matchbase_public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY isolated_owner ON matchbase_public.%I USING (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass))) WITH CHECK (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass)))',t,'matchbase_public.'||t,'matchbase_public.'||t);
 END LOOP;
END $body$;

CREATE FUNCTION matchbase_public.actor(required_capability text) RETURNS matchbase_public.principal
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE p matchbase_public.principal; unsafe boolean;
BEGIN
 SELECT rolsuper OR rolbypassrls OR rolcreaterole
  OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname='matchbase_public' AND pg_has_role(session_user,n.nspowner,'MEMBER'))
  OR has_table_privilege(session_user,'public.consultant_private_observation','SELECT')
 INTO unsafe FROM pg_roles WHERE rolname=session_user;
 SELECT * INTO p FROM matchbase_public.principal WHERE database_role=session_user AND enabled;
 IF unsafe IS DISTINCT FROM false OR p.database_role IS NULL OR p.capability<>required_capability
 THEN RAISE EXCEPTION 'Public corpus capability is not authorized' USING ERRCODE='42501'; END IF;
 RETURN p;
END $body$;

-- Syntactic public origin boundary only; catalogue review still establishes public purpose/rights.
CREATE FUNCTION matchbase_public.public_source_url(url text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $body$
 SELECT coalesce(length(url)<=2048 AND length(split_part(url,'/',3))<=253
  AND url ~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(/[A-Za-z0-9._~/-]*)?$'
  AND split_part(url,'/',3) !~ '(^|\.)(localhost|local|localdomain|internal|test|invalid|example|onion|alt|home|lan|corp|intranet|arpa)$',false)
$body$;

CREATE FUNCTION matchbase_public.authorize_acquisition(
 id uuid, catalogue_id uuid, url text, expires timestamptz, observation_limit integer,
 explicit_manual_unpaid_approval boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
 PERFORM matchbase_public.actor('releaser');
 IF explicit_manual_unpaid_approval IS DISTINCT FROM true OR expires<=clock_timestamp()
  OR expires>clock_timestamp()+interval '7 days' OR NOT matchbase_public.public_source_url(url)
 THEN RAISE EXCEPTION 'Independent catalogue acquisition authority is invalid'; END IF;
 INSERT INTO matchbase_public.authority VALUES(id,catalogue_id,gen_random_uuid(),'independent_public_catalogue','manual_unpaid',url,session_user,expires,observation_limit,clock_timestamp());
 RETURN id;
END $body$;

CREATE FUNCTION matchbase_public.acquire(id uuid, authority_key uuid, evidence jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE a matchbase_public.authority; p matchbase_public.principal; n integer; retrieved timestamptz; published timestamptz; valid timestamptz; source_state text;
BEGIN
 p:=matchbase_public.actor('acquirer');
 SELECT * INTO a FROM matchbase_public.authority WHERE authority_id=authority_key FOR UPDATE;
 IF a.authority_id IS NULL OR a.expires_at<=clock_timestamp() OR a.approved_by=session_user
 OR NOT matchbase_public.public_source_url(a.source_url)
 THEN RAISE EXCEPTION 'Current independent acquisition authority is required'; END IF;
 INSERT INTO matchbase_public.source(source_url) VALUES(a.source_url) ON CONFLICT DO NOTHING;
 SELECT state INTO source_state FROM matchbase_public.source WHERE source_url=a.source_url FOR SHARE;
 IF source_state<>'active' THEN RAISE EXCEPTION 'Source rights were withdrawn; reacquisition is not authorized'; END IF;
 SELECT count(*) INTO n FROM matchbase_public.observation WHERE authority_id=authority_key;
 IF n>=a.max_observations THEN RAISE EXCEPTION 'Acquisition allowance is exhausted'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(evidence))<>12 OR NOT evidence ?& ARRAY[
 'source_assertion_sha256','published_at','retrieved_at','claim_kind','claim_text','classification_scheme',
 'classification_code','classification_version','valid_until','rights_basis','rights_reference','source_url']
 OR evidence->>'source_url'<>a.source_url THEN RAISE EXCEPTION 'Only independently sourced public observations are accepted'; END IF;
 retrieved:=(evidence->>'retrieved_at')::timestamptz;
 published:=(evidence->>'published_at')::timestamptz;
 valid:=(evidence->>'valid_until')::timestamptz;
 IF retrieved>clock_timestamp() OR retrieved<clock_timestamp()-interval '7 days' OR valid<=clock_timestamp()
  OR valid>retrieved+interval '30 days'
  OR (evidence->>'claim_kind'='public_price' AND (published IS NULL OR published<clock_timestamp()-interval '30 days' OR valid>published+interval '30 days'))
 THEN RAISE EXCEPTION 'Public observation freshness is not admissible'; END IF;
 INSERT INTO matchbase_public.observation(observation_id,authority_id,acquisition_profile_id,acquisition_run_id,acquisition_execution_id,classification_id,acquired_by,source_url,source_assertion_sha256,source_published_at,
 source_retrieved_at,claim_kind,claim_text,classification_scheme,classification_code,classification_version,valid_until,rights_basis,rights_reference)
 VALUES(id,authority_key,p.profile_id,a.catalogue_job_id,a.acquisition_execution_id,gen_random_uuid(),session_user,a.source_url,evidence->>'source_assertion_sha256',published,retrieved,evidence->>'claim_kind',evidence->>'claim_text',
 evidence->>'classification_scheme',evidence->>'classification_code',evidence->>'classification_version',valid,evidence->>'rights_basis',evidence->>'rights_reference');
 RETURN id;
END $body$;

CREATE FUNCTION matchbase_public.release(id uuid, expected_epoch integer, independent_review_reference text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE o matchbase_public.observation; s matchbase_public.source;
BEGIN
 PERFORM matchbase_public.actor('releaser');
 PERFORM 1 FROM matchbase_public.control WHERE restore_ready FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Restored corpus requires tombstone reconciliation'; END IF;
 SELECT * INTO o FROM matchbase_public.observation WHERE observation_id=id FOR UPDATE;
 SELECT * INTO s FROM matchbase_public.source WHERE source_url=o.source_url FOR SHARE;
 IF o.observation_id IS NULL OR o.acquired_by=session_user OR expected_epoch IS NULL OR o.rights_epoch<>expected_epoch OR o.state<>'pending'
 OR s.source_url IS NULL OR s.state<>'active' OR s.rights_epoch<>o.rights_epoch OR NOT matchbase_public.public_source_url(o.source_url)
 OR o.valid_until<=clock_timestamp() OR independent_review_reference IS NULL OR length(independent_review_reference) NOT BETWEEN 8 AND 500
 THEN RAISE EXCEPTION 'Independent public rights release is not authorized'; END IF;
 UPDATE matchbase_public.observation SET state='released',released_by=session_user,released_at=clock_timestamp(),release_review_reference=independent_review_reference WHERE observation_id=id;
END $body$;

CREATE FUNCTION matchbase_public.lookup(scheme text, code text, version text, query text)
RETURNS TABLE(observation_id uuid, rights_epoch integer, source_url text, source_assertion_sha256 text,
 published_at timestamptz, retrieved_at timestamptz, valid_until timestamptz, claim_kind text, claim_text text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
 PERFORM matchbase_public.actor('reader');
 PERFORM 1 FROM matchbase_public.control WHERE restore_ready FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Restored corpus requires tombstone reconciliation'; END IF;
 RETURN QUERY SELECT o.observation_id,o.rights_epoch,o.source_url,o.source_assertion_sha256,o.source_published_at,o.source_retrieved_at,o.valid_until,o.claim_kind,o.claim_text
 FROM matchbase_public.observation o JOIN matchbase_public.source s ON s.source_url=o.source_url
 WHERE o.state='released' AND o.valid_until>clock_timestamp() AND s.state='active' AND s.rights_epoch=o.rights_epoch
 AND matchbase_public.public_source_url(o.source_url)
 AND o.classification_scheme=scheme AND o.classification_code=code AND o.classification_version=version
 AND (length(query)=0 OR strpos(lower(o.claim_text),lower(left(query,200)))>0)
 ORDER BY o.source_retrieved_at DESC,o.observation_id LIMIT 50 FOR SHARE OF o,s;
END $body$;

CREATE FUNCTION matchbase_public.register_derivative(id uuid, derivative_kind text, reference text, refs jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE p matchbase_public.principal; ref jsonb; o matchbase_public.observation; s matchbase_public.source;
BEGIN
 p:=matchbase_public.actor('reader');
 PERFORM 1 FROM matchbase_public.control WHERE restore_ready FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Restored corpus requires tombstone reconciliation'; END IF;
 IF jsonb_typeof(refs)<>'array' OR jsonb_array_length(refs) NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION 'Bounded public evidence dependencies are required'; END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(refs) ORDER BY value->>'observation_id' LOOP
  IF (SELECT count(*) FROM jsonb_object_keys(ref))<>2 OR NOT ref ?& ARRAY['observation_id','rights_epoch']
   OR jsonb_typeof(ref->'observation_id') IS DISTINCT FROM 'string' OR jsonb_typeof(ref->'rights_epoch') IS DISTINCT FROM 'number'
   OR (ref->>'rights_epoch')::integer<1 THEN RAISE EXCEPTION 'Invalid dependency'; END IF;
  SELECT * INTO o FROM matchbase_public.observation WHERE observation_id=(ref->>'observation_id')::uuid FOR SHARE;
  SELECT * INTO s FROM matchbase_public.source WHERE source_url=o.source_url FOR SHARE;
  IF o.observation_id IS NULL OR o.state<>'released' OR o.rights_epoch<>(ref->>'rights_epoch')::integer OR o.valid_until<=clock_timestamp()
  OR s.source_url IS NULL OR s.state<>'active' OR s.rights_epoch<>o.rights_epoch OR NOT matchbase_public.public_source_url(o.source_url)
  THEN RAISE EXCEPTION 'Public evidence dependency is no longer eligible'; END IF;
 END LOOP;
 INSERT INTO matchbase_public.derivative VALUES(id,p.account_id,p.profile_id,session_user,derivative_kind,reference,refs,true,clock_timestamp());
 RETURN id;
END $body$;

CREATE FUNCTION matchbase_public.assert_derivative(id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE p matchbase_public.principal; d matchbase_public.derivative; ref jsonb; o matchbase_public.observation; s matchbase_public.source;
BEGIN
 p:=matchbase_public.actor('reader');
 SELECT * INTO d FROM matchbase_public.derivative WHERE derivative_id=id AND account_id=p.account_id AND profile_id=p.profile_id;
 IF d.derivative_id IS NULL OR NOT d.valid THEN RETURN false; END IF;
 PERFORM 1 FROM matchbase_public.control WHERE restore_ready FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(d.dependencies) ORDER BY value->>'observation_id' LOOP
  SELECT * INTO o FROM matchbase_public.observation WHERE observation_id=(ref->>'observation_id')::uuid FOR SHARE;
  SELECT * INTO s FROM matchbase_public.source WHERE source_url=o.source_url FOR SHARE;
  IF o.observation_id IS NULL OR o.state<>'released' OR o.rights_epoch<>(ref->>'rights_epoch')::integer OR o.valid_until<=clock_timestamp()
  OR s.source_url IS NULL OR s.state<>'active' OR s.rights_epoch<>o.rights_epoch OR NOT matchbase_public.public_source_url(o.source_url)
  THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $body$;

CREATE FUNCTION matchbase_public.withdraw(id uuid, reason text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE o matchbase_public.observation; seq bigint; url text; epoch integer;
BEGIN
 PERFORM matchbase_public.actor('releaser');
 PERFORM 1 FROM matchbase_public.control FOR UPDATE;
 SELECT source_url INTO url FROM matchbase_public.observation WHERE observation_id=id;
 IF url IS NULL THEN RAISE EXCEPTION 'Unknown public observation'; END IF;
 UPDATE matchbase_public.source SET rights_epoch=rights_epoch+1,state='withdrawn' WHERE source_url=url RETURNING rights_epoch INTO epoch;
 FOR o IN SELECT * FROM matchbase_public.observation WHERE source_url=url ORDER BY observation_id FOR UPDATE LOOP
  UPDATE matchbase_public.observation SET rights_epoch=epoch,state='withdrawn',claim_text='[withdrawn]' WHERE observation_id=o.observation_id;
  SELECT coalesce(max(sequence),0)+1 INTO seq FROM matchbase_public.tombstone;
  INSERT INTO matchbase_public.tombstone(sequence,observation_id,source_url,rights_epoch,reason_code,withdrawn_by) VALUES(seq,o.observation_id,url,epoch,reason,session_user);
  UPDATE matchbase_public.derivative SET valid=false WHERE dependencies @> jsonb_build_array(jsonb_build_object('observation_id',o.observation_id::text));
 END LOOP;
 RETURN seq;
END $body$;

CREATE FUNCTION matchbase_public.begin_restore() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
 PERFORM matchbase_public.actor('releaser');
 UPDATE matchbase_public.control SET restore_ready=false;
END $body$;

CREATE FUNCTION matchbase_public.reconcile_tombstones(expected_watermark bigint, records jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE current_watermark bigint; entry jsonb; expected_sequence bigint; observed bigint;
BEGIN
 PERFORM matchbase_public.actor('releaser');
 SELECT tombstone_watermark INTO current_watermark FROM matchbase_public.control FOR UPDATE;
 IF expected_watermark<current_watermark OR jsonb_typeof(records)<>'array'
  OR jsonb_array_length(records)<>expected_watermark-current_watermark
 THEN RAISE EXCEPTION 'Complete externally retained tombstone sequence is required'; END IF;
 expected_sequence:=current_watermark;
 FOR entry IN SELECT value FROM jsonb_array_elements(records) ORDER BY (value->>'sequence')::bigint LOOP
  expected_sequence:=expected_sequence+1;
  IF (SELECT count(*) FROM jsonb_object_keys(entry))<>5 OR NOT entry ?& ARRAY['sequence','observation_id','source_url','rights_epoch','reason_code']
   OR (entry->>'sequence')::bigint<>expected_sequence OR (entry->>'rights_epoch')::integer<2
  THEN RAISE EXCEPTION 'Invalid externally retained tombstone'; END IF;
  IF EXISTS(SELECT 1 FROM matchbase_public.tombstone t WHERE t.sequence=expected_sequence AND
   (t.observation_id<>(entry->>'observation_id')::uuid OR t.source_url<>entry->>'source_url' OR t.rights_epoch<>(entry->>'rights_epoch')::integer OR t.reason_code<>entry->>'reason_code'))
  THEN RAISE EXCEPTION 'Tombstone conflicts with immutable recorded withdrawal'; END IF;
  INSERT INTO matchbase_public.tombstone(sequence,observation_id,source_url,rights_epoch,reason_code,withdrawn_by)
   VALUES(expected_sequence,(entry->>'observation_id')::uuid,entry->>'source_url',(entry->>'rights_epoch')::integer,entry->>'reason_code',session_user)
   ON CONFLICT(sequence) DO NOTHING;
  INSERT INTO matchbase_public.source(source_url,rights_epoch,state) VALUES(entry->>'source_url',(entry->>'rights_epoch')::integer,'withdrawn')
   ON CONFLICT(source_url) DO UPDATE SET state='withdrawn',rights_epoch=greatest(matchbase_public.source.rights_epoch,excluded.rights_epoch);
  UPDATE matchbase_public.observation SET state='withdrawn',rights_epoch=greatest(rights_epoch,(entry->>'rights_epoch')::integer),claim_text='[withdrawn]'
   WHERE source_url=entry->>'source_url';
  UPDATE matchbase_public.derivative d SET valid=false WHERE EXISTS(
   SELECT 1 FROM matchbase_public.observation o WHERE o.source_url=entry->>'source_url'
    AND d.dependencies @> jsonb_build_array(jsonb_build_object('observation_id',o.observation_id::text)))
   OR d.dependencies @> jsonb_build_array(jsonb_build_object('observation_id',entry->>'observation_id'));
 END LOOP;
 SELECT coalesce(max(sequence),0) INTO observed FROM matchbase_public.tombstone;
 IF observed>expected_watermark THEN RAISE EXCEPTION 'External tombstone watermark is behind recorded withdrawals'; END IF;
 UPDATE matchbase_public.control SET tombstone_watermark=expected_watermark,restore_ready=true;
END $body$;

REVOKE ALL ON ALL TABLES IN SCHEMA matchbase_public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA matchbase_public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA matchbase_public FROM PUBLIC;
