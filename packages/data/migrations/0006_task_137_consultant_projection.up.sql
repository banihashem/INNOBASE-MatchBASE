CREATE TABLE consultant_projection_config_release (
    config_id uuid PRIMARY KEY,
    version text NOT NULL UNIQUE CHECK (length(btrim(version)) > 0),
    definition jsonb NOT NULL CHECK (
      jsonb_typeof(definition) = 'object' AND
      definition ?& ARRAY['schema_version','soft_cap'] AND
      definition - ARRAY['schema_version','soft_cap'] = '{}'::jsonb AND
      definition->>'schema_version' = 'consultant-projection-config.v1' AND
      jsonb_typeof(definition->'soft_cap') = 'number' AND
      definition->>'soft_cap' ~ '^[0-9]+$' AND
      (definition->>'soft_cap')::integer = soft_cap
    ),
    soft_cap integer NOT NULL CHECK (soft_cap >= 3),
    content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    released_at timestamptz NOT NULL,
    UNIQUE (config_id, version, soft_cap, content_sha256)
);

INSERT INTO consultant_projection_config_release
  (config_id,version,definition,soft_cap,content_sha256,released_at)
VALUES
  ('00000000-0000-4000-8000-000000000620',
   'consultant-soft-cap.default-20.v1',
   '{"schema_version":"consultant-projection-config.v1","soft_cap":20}'::jsonb,
   20,
   decode('3822131148bb2ff21d0cb81d7f1056a0a235c5d3aef58fca446a124a35e850f9','hex'),
   '2026-08-25T00:00:00.000Z');

CREATE TRIGGER consultant_projection_config_release_immutable
BEFORE UPDATE OR DELETE ON consultant_projection_config_release
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

CREATE TABLE consultant_result_projection_policy (
    account_id uuid NOT NULL REFERENCES account(account_id),
    run_id uuid NOT NULL,
    config_id uuid NOT NULL,
    config_version text NOT NULL,
    soft_cap integer NOT NULL CHECK (soft_cap >= 3),
    config_content_sha256 bytea NOT NULL CHECK (octet_length(config_content_sha256) = 32),
    bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (account_id, run_id),
    FOREIGN KEY (account_id, run_id) REFERENCES run_result(account_id, run_id),
    FOREIGN KEY (config_id, config_version, soft_cap, config_content_sha256)
      REFERENCES consultant_projection_config_release
        (config_id, version, soft_cap, content_sha256)
);

CREATE TRIGGER consultant_result_projection_policy_immutable
BEFORE UPDATE OR DELETE ON consultant_result_projection_policy
FOR EACH ROW EXECUTE FUNCTION matchbase_reject_mutation();

REVOKE UPDATE, DELETE ON
  consultant_projection_config_release, consultant_result_projection_policy
FROM PUBLIC;

COMMENT ON TABLE consultant_projection_config_release IS
  'Append-only released Consultant projection configuration. Definition bytes are canonicalized and bound by SHA-256.';

COMMENT ON TABLE consultant_result_projection_policy IS
  'Immutable result-production binding to a released Consultant display configuration. It never limits research or the persisted eligible set.';
