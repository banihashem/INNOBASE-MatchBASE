DROP INDEX consultant_private_observation_scopes;
ALTER TABLE consultant_private_observation DROP CONSTRAINT consultant_private_observation_scope_contains_exact;
ALTER TABLE consultant_private_observation DROP COLUMN category_scope_keys;
CREATE OR REPLACE FUNCTION matchbase_private_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['event_invalidated_at','event_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['event_invalidated_at','event_reason'])
    OR (OLD.event_invalidated_at IS NOT NULL AND NEW.event_invalidated_at IS NULL)
  THEN RAISE EXCEPTION 'Observation content and invalidation history are immutable'; END IF;
  RETURN NEW;
END; $$;
