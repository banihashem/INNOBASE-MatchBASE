-- MB-SEARCH-DIMENSIONS-002 L01: private catalogue with immutable definition revisions.
CREATE TABLE consultant_search_dimension_revision (
  account_id uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  user_profile_id uuid NOT NULL,
  category_key text NOT NULL CHECK (length(btrim(category_key)) > 0 AND octet_length(category_key) <= 256),
  dimension_id text NOT NULL CHECK (dimension_id ~ '^custom\.[a-z][a-z0-9_.-]{0,79}$'),
  revision integer NOT NULL CHECK (revision > 0),
  run_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  classification_id uuid NOT NULL,
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition)='object' AND octet_length(definition::text) <= 8192),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id,user_profile_id,category_key,dimension_id,revision),
  CHECK ((definition->>'id') IS NOT DISTINCT FROM dimension_id),
  CHECK ((definition->>'revision')::integer IS NOT DISTINCT FROM revision),
  CHECK ((definition->'owner_scope'->>'account_id') IS NOT DISTINCT FROM account_id::text),
  CHECK ((definition->'owner_scope'->>'user_profile_id') IS NOT DISTINCT FROM user_profile_id::text)
);
CREATE FUNCTION matchbase_search_dimension_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_revision integer;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Search dimension revisions are immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM consultant_workflow_session s WHERE s.account_id=NEW.account_id
    AND s.user_profile_id=NEW.user_profile_id AND s.run_id=NEW.run_id AND s.execution_id=NEW.execution_id
    AND COALESCE(s.classification->>'classification_id',s.workflow_metadata->>'classification_id')=NEW.classification_id::text
    AND NOT s.is_invalidated)
  THEN RAISE EXCEPTION 'Search dimension creation provenance does not match its owned session'; END IF;
  -- Also serialize direct inserts; callers take the same catalogue lock before reading revisions.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    '["search-dimensions","' || NEW.account_id::text || '","' || NEW.user_profile_id::text || '",'
      || to_json(NEW.category_key)::text || ']', 0));
  SELECT max(revision) INTO previous_revision FROM consultant_search_dimension_revision
    WHERE account_id=NEW.account_id AND user_profile_id=NEW.user_profile_id
      AND category_key=NEW.category_key AND dimension_id=NEW.dimension_id;
  IF NEW.revision <> COALESCE(previous_revision,0)+1
  THEN RAISE EXCEPTION 'Search dimension revisions must append in sequence'; END IF;
  IF previous_revision IS NULL AND (SELECT count(DISTINCT dimension_id) FROM consultant_search_dimension_revision
    WHERE account_id=NEW.account_id AND user_profile_id=NEW.user_profile_id AND category_key=NEW.category_key) >= 16
  THEN RAISE EXCEPTION 'Private category catalogue is full'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER consultant_search_dimension_revision_guard BEFORE INSERT OR UPDATE ON consultant_search_dimension_revision
 FOR EACH ROW EXECUTE FUNCTION matchbase_search_dimension_revision_guard();
