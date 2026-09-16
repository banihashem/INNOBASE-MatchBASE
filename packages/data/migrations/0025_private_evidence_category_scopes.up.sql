-- MB-ARCH-IMPLEMENT-001 L06: exact, parent and controlled industry retrieval scopes.
ALTER TABLE consultant_private_observation ADD COLUMN category_scope_keys text[];
ALTER TABLE consultant_private_observation DISABLE TRIGGER consultant_private_observation_guard;
UPDATE consultant_private_observation SET category_scope_keys=ARRAY[category_key];
ALTER TABLE consultant_private_observation ENABLE TRIGGER consultant_private_observation_guard;
ALTER TABLE consultant_private_observation ALTER COLUMN category_scope_keys SET NOT NULL;
ALTER TABLE consultant_private_observation ADD CONSTRAINT consultant_private_observation_scope_contains_exact
  CHECK(category_key=ANY(category_scope_keys));
CREATE INDEX consultant_private_observation_scopes ON consultant_private_observation USING gin(category_scope_keys);
CREATE OR REPLACE FUNCTION matchbase_private_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='consultant_private_observation' THEN
    IF (to_jsonb(NEW)-ARRAY['event_invalidated_at','event_reason','category_scope_keys']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['event_invalidated_at','event_reason','category_scope_keys'])
      OR (OLD.event_invalidated_at IS NOT NULL AND NEW.event_invalidated_at IS NULL)
      OR NOT (to_jsonb(NEW)->'category_scope_keys') @> (to_jsonb(OLD)->'category_scope_keys')
    THEN RAISE EXCEPTION 'Observation content and invalidation history are immutable'; END IF;
  ELSIF (to_jsonb(NEW)-ARRAY['event_invalidated_at','event_reason']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['event_invalidated_at','event_reason'])
    OR (OLD.event_invalidated_at IS NOT NULL AND NEW.event_invalidated_at IS NULL)
  THEN RAISE EXCEPTION 'Observation content and invalidation history are immutable'; END IF;
  RETURN NEW;
END; $$;
