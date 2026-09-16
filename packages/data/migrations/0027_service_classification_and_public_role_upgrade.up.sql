-- MB-ARCH-IMPLEMENT-001 L06: persist official service classifications and reconcile upgraded corpus functions.
ALTER TABLE product_classification
  DROP CONSTRAINT product_classification_scheme_check;
ALTER TABLE product_classification
  ADD CONSTRAINT product_classification_scheme_check
  CHECK (scheme IN ('HS','CPC','ISIC','GS1_GPC','UNSPSC','ECLASS','ETIM','CUSTOM_MATCHBASE'));

DO $body$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname='matchbase_public_owner' AND NOT rolcanlogin
  ) AND EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname='matchbase_public_reader' AND NOT rolcanlogin
  ) THEN
    ALTER FUNCTION matchbase_public.reader_ready(uuid,uuid) OWNER TO matchbase_public_owner;
    ALTER FUNCTION matchbase_public.lookup_refs(jsonb) OWNER TO matchbase_public_owner;
    REVOKE ALL ON FUNCTION matchbase_public.reader_ready(uuid,uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION matchbase_public.lookup_refs(jsonb) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION matchbase_public.reader_ready(uuid,uuid) TO matchbase_public_reader;
    GRANT EXECUTE ON FUNCTION matchbase_public.lookup_refs(jsonb) TO matchbase_public_reader;
  END IF;
END $body$;
