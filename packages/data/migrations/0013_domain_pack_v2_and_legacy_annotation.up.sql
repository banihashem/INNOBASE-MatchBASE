BEGIN;

CREATE TABLE request_governed_annotation (
  annotation_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(account_id),
  request_id uuid NOT NULL REFERENCES sourcing_request(request_id),
  annotation_type text NOT NULL CHECK (annotation_type IN ('legacy_misclassified_domain_pack')),
  annotation_version integer NOT NULL CHECK (annotation_version = 1),
  annotation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by text NOT NULL CHECK (created_by = 'server'),
  UNIQUE (account_id, request_id, annotation_type, annotation_version),
  CHECK (jsonb_typeof(annotation) = 'object'),
  CHECK (
    annotation ?& ARRAY['schema_version','observed_category','corrected_category','reason_code']
    AND annotation - ARRAY['schema_version','observed_category','corrected_category','reason_code'] = '{}'::jsonb
    AND annotation->>'schema_version' = 'legacy-misclassified-domain-pack.v1'
    AND annotation->>'reason_code' = 'historical_domain_pack_resolver_misclassification'
    AND length(btrim(annotation->>'observed_category')) > 0
    AND length(btrim(annotation->>'corrected_category')) > 0
    AND annotation->>'observed_category' <> annotation->>'corrected_category'
  )
);

ALTER TABLE request_governed_annotation ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_governed_annotation_account_isolation
  ON request_governed_annotation
  USING (account_id = current_setting('app.account_id', true)::uuid)
  WITH CHECK (account_id = current_setting('app.account_id', true)::uuid);

COMMENT ON TABLE request_governed_annotation IS
  'Additive server-owned annotations outside immutable canonical and result bytes; historical rows remain untouched.';

COMMIT;
