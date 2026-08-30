import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION,
  COMPLETE_RESULT_FOUNDATION_V2_SCHEMA_VERSION,
  DEMO_LOW_CONFIDENCE_CAUTION_TEXT,
  CONSULTANT_REQUIRED_SOURCE_IDS,
  CONSULTANT_UNAVAILABLE_SOURCE_IDS,
} from "../src/index.js";
import { generateContractSchemas } from "../src/schema.js";

test("publishes one closed versioned complete-result foundation schema", () => {
  const bundle = generateContractSchemas() as {
    schemas: Record<string, unknown>;
  };
  const foundation = bundle.schemas.completeResultFoundation as {
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, unknown>;
  };

  assert.equal(foundation.additionalProperties, false);
  assert.deepEqual(foundation.required, [
    "schema_version",
    "run_id",
    "candidates",
    "claims",
    "evidence",
    "evidenced_values",
    "eligible_candidate_ids",
    "gate_evaluations",
    "unknown_count",
    "not_asked_count",
    "gate_evaluation_completed_at",
    "consultant_projection_readiness",
  ]);
  assert.deepEqual(foundation.properties.schema_version, {
    type: "string",
    enum: [COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION],
  });
  assert.equal("rationale_short" in foundation.properties, false);
  assert.equal("rfq_question_sets" in foundation.properties, false);
  assert.equal("analyst" in foundation.properties, false);
  assert.equal("artifacts" in foundation.properties, false);
});

test("keeps Consultant readiness blocked on the exact current source gaps", () => {
  assert.deepEqual(CONSULTANT_REQUIRED_SOURCE_IDS, [
    "full_candidate_rationales",
    "rfq_question_sets",
    "rfq_wave_recommendations",
    "reserve_candidates_and_expansion_leads",
    "due_diligence_checklist",
    "excluded_sources",
    "full_limitations",
    "soft_cap_configuration",
  ]);
  assert.deepEqual(CONSULTANT_UNAVAILABLE_SOURCE_IDS, [
    "full_candidate_rationales",
    "rfq_question_sets",
    "rfq_wave_recommendations",
    "reserve_candidates_and_expansion_leads",
    "due_diligence_checklist",
    "full_limitations",
    "soft_cap_configuration",
  ]);

  const bundle = generateContractSchemas() as {
    schemas: Record<string, unknown>;
  };
  const foundation = bundle.schemas.completeResultFoundation as {
    properties: {
      consultant_projection_readiness: {
        properties: {
          outcome: unknown;
          missing_sources: {
            minItems: number;
            maxItems: number;
            prefixItems: Array<{
              properties: Record<string, unknown>;
            }>;
          };
        };
      };
    };
  };
  const readiness = foundation.properties.consultant_projection_readiness;
  assert.deepEqual(readiness.properties.outcome, {
    type: "string",
    enum: ["blocked"],
  });
  assert.equal(
    readiness.properties.missing_sources.minItems,
    CONSULTANT_UNAVAILABLE_SOURCE_IDS.length,
  );
  assert.equal(
    readiness.properties.missing_sources.maxItems,
    CONSULTANT_UNAVAILABLE_SOURCE_IDS.length,
  );
  assert.deepEqual(
    readiness.properties.missing_sources.prefixItems.map(
      (item) => item.properties.source_id,
    ),
    CONSULTANT_UNAVAILABLE_SOURCE_IDS.map((sourceId) => ({
      type: "string",
      enum: [sourceId],
    })),
  );
});

test("requires non-whitespace exclusion reasons in the foundation schema", () => {
  const bundle = generateContractSchemas() as {
    schemas: {
      completeResultFoundation: {
        properties: {
          evidence: {
            items: {
              properties: {
                exclusion_reason: {
                  type: string;
                  pattern: string;
                };
              };
            };
          };
        };
      };
    };
  };
  const exclusionReason =
    bundle.schemas.completeResultFoundation.properties.evidence.items.properties
      .exclusion_reason;
  assert.deepEqual(exclusionReason, { type: "string", pattern: "\\S" });

  const requiredContent = new RegExp(exclusionReason.pattern, "u");
  for (const whitespaceOnly of ["", " ", "   ", "\t", "\n", " \t\r\n "])
    assert.equal(requiredContent.test(whitespaceOnly), false);
  assert.equal(requiredContent.test("reason"), true);
  assert.equal(requiredContent.test("  reason  "), true);
});

test("publishes a separate closed v2 Demo-safe foundation without changing v1", () => {
  const bundle = generateContractSchemas() as any;
  const v1 = bundle.schemas.completeResultFoundation;
  const v2 = bundle.schemas.completeResultFoundationV2;
  assert.deepEqual(v1.properties.schema_version.enum, [
    COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION,
  ]);
  assert.equal(v2.additionalProperties, false);
  assert.deepEqual(v2.properties.schema_version.enum, [
    COMPLETE_RESULT_FOUNDATION_V2_SCHEMA_VERSION,
  ]);
  assert.ok(v2.required.includes("demo_rationale_sources"));
  assert.ok(v2.required.includes("demo_low_confidence_caution"));
  const rationaleVariants = v2.properties.demo_rationale_sources.items.oneOf;
  assert.equal(rationaleVariants.length, 2);
  assert.ok(
    rationaleVariants.every(
      (variant: any) =>
        variant.additionalProperties === false &&
        JSON.stringify(variant.required) ===
          JSON.stringify(["candidate_id", "rule_outcome", "rationale_short"]) &&
        !("confidence" in variant.properties),
    ),
  );
  assert.deepEqual(
    rationaleVariants.map((variant: any) => [
      variant.properties.rule_outcome.const,
      variant.properties.rationale_short.const,
    ]),
    Object.entries({
      mandatory_rules_satisfied: "Passed all mandatory matching rules.",
      mandatory_rules_not_satisfied:
        "Did not pass all mandatory matching rules.",
    }),
  );
  assert.deepEqual(
    v2.properties.demo_low_confidence_caution.oneOf[1].properties.text,
    {
      const: DEMO_LOW_CONFIDENCE_CAUTION_TEXT,
    },
  );
  const [nonLiveEvidence, liveEvidence] = v2.properties.evidence.items.oneOf;
  assert.deepEqual(nonLiveEvidence.properties.provenance.enum, [
    "synthetic_fixture",
    "repository_fixture",
  ]);
  assert.deepEqual(liveEvidence.properties.provenance, {
    const: "live_secure_fetch",
  });
  assert.deepEqual(liveEvidence.properties.source_kind, {
    const: "reserved_url",
  });
  assert.ok(liveEvidence.required.includes("exact_url"));
  assert.ok(liveEvidence.required.includes("external_verification_basis"));
  assert.deepEqual(liveEvidence.not, { required: ["fixture_identity"] });
  assert.equal(
    liveEvidence.properties.external_verification_basis.oneOf.length,
    3,
  );
  const verificationMatrix = liveEvidence.allOf[1].oneOf;
  assert.deepEqual(verificationMatrix[0].properties.verification_status, {
    const: "externally_verified",
  });
  assert.equal(
    verificationMatrix[0].properties.external_verification_basis.oneOf.length,
    2,
  );
  assert.deepEqual(
    verificationMatrix[1].properties.external_verification_basis.properties
      .kind,
    { const: "not_externally_verified" },
  );
});
