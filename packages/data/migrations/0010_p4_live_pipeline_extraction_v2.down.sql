ALTER TABLE live_research_execution_reservation
  DROP CONSTRAINT live_research_pipeline_identity_closed;

ALTER TABLE live_research_execution_reservation
  ADD CONSTRAINT live_research_pipeline_identity_closed
  CHECK (
    pipeline_identity_record IS NULL OR (
      jsonb_typeof(pipeline_identity_record) = 'object' AND
      pipeline_identity_record ?& ARRAY[
        'schemaVersion','outputSchemaIdentifier','outputSchemaCanonicalSha256',
        'researchRoutePolicyId','routePolicyVersion','routePolicyCanonicalSha256',
        'modelPolicyVersionId','modelPolicyVersion','modelPolicyContentSha256',
        'scoringConfigVersionId','scoringConfigVersion','scoringConfigContentSha256',
        'extractionVersion'
      ] AND
      pipeline_identity_record - ARRAY[
        'schemaVersion','outputSchemaIdentifier','outputSchemaCanonicalSha256',
        'researchRoutePolicyId','routePolicyVersion','routePolicyCanonicalSha256',
        'modelPolicyVersionId','modelPolicyVersion','modelPolicyContentSha256',
        'scoringConfigVersionId','scoringConfigVersion','scoringConfigContentSha256',
        'extractionVersion'
      ] = '{}'::jsonb AND
      jsonb_typeof(pipeline_identity_record->'schemaVersion') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'outputSchemaIdentifier') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'outputSchemaCanonicalSha256') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'researchRoutePolicyId') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'routePolicyVersion') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'routePolicyCanonicalSha256') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'modelPolicyVersionId') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'modelPolicyVersion') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'modelPolicyContentSha256') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'scoringConfigVersionId') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'scoringConfigVersion') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'scoringConfigContentSha256') = 'string' AND
      jsonb_typeof(pipeline_identity_record->'extractionVersion') = 'string' AND
      pipeline_identity_record->>'schemaVersion' = 'live-research-pipeline-identity.v1' AND
      pipeline_identity_record->>'outputSchemaIdentifier' = 'evidence-graph.v1' AND
      pipeline_identity_record->>'outputSchemaCanonicalSha256' = 'c56bb23f7aae6a8e7352d7dbf9563595cd606b4a246339d1a345c842f5553788' AND
      pipeline_identity_record->>'extractionVersion' = 'untrusted-source-boundary.v1' AND
      pipeline_identity_record->>'outputSchemaCanonicalSha256' ~ '^[0-9a-f]{64}$' AND
      pipeline_identity_record->>'routePolicyCanonicalSha256' ~ '^[0-9a-f]{64}$' AND
      pipeline_identity_record->>'modelPolicyContentSha256' ~ '^[0-9a-f]{64}$' AND
      pipeline_identity_record->>'scoringConfigContentSha256' ~ '^[0-9a-f]{64}$' AND
      pipeline_identity_record->>'researchRoutePolicyId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND
      pipeline_identity_record->>'modelPolicyVersionId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND
      pipeline_identity_record->>'scoringConfigVersionId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND
      length(btrim(pipeline_identity_record->>'routePolicyVersion')) BETWEEN 1 AND 128 AND
      length(btrim(pipeline_identity_record->>'modelPolicyVersion')) BETWEEN 1 AND 128 AND
      length(btrim(pipeline_identity_record->>'scoringConfigVersion')) BETWEEN 1 AND 128
    )
  )
  NOT VALID;

COMMENT ON CONSTRAINT live_research_pipeline_identity_closed
  ON live_research_execution_reservation IS
  'Closed live pipeline identity restored to the v1 admission contract; existing historical rows remain immutable.';
