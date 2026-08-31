import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import * as applicationPublic from "../../../packages/application/dist/index.js";
import * as aiEvidencePublic from "../../../packages/ai-evidence/dist/src/index.js";
import {
  STANDARD_DIMENSION_WEIGHTS_SHA256,
  buildOperationalLiveCompleteResultV2,
  readOperationalLiveCompleteResultV2,
} from "../../../packages/application/dist/live-complete-result-v2.js";

const dimensionScores = {
  category_product_fit: 80,
  compliance_certification_fit: 80,
  volume_capacity_fit: 80,
  price_tier_fit: 80,
  positioning_brand_fit: 80,
  geographic_reach_fit: 80,
};

test("operational trust minting is absent from public package exports", () => {
  assert.equal(
    "buildOperationalLiveCompleteResultV2" in applicationPublic,
    false,
  );
  assert.equal(
    "readOperationalLiveCompleteResultV2" in applicationPublic,
    false,
  );
  assert.equal("sealTrustedLiveFetchLedgerV2" in aiEvidencePublic, false);
});

function fixture() {
  const candidateId = randomUUID();
  const claimId = randomUUID();
  const usedId = randomUUID();
  const unusedId = randomUUID();
  const graph = {
    schemaVersion: "evidence-graph.v1",
    runId: randomUUID(),
    candidates: [
      {
        candidateId,
        displayName: "Standard Manufacturing",
        countryCode: "AE",
        rationaleShort: "Provider-only extended rationale.",
        rationaleClaimIds: [claimId],
        compatibilityScore: 80,
        fitBand: "strong",
        bandCeiling: "strong",
        displayedBand: "strong",
        dimensionScores,
        citations: [usedId],
        verificationStatus: "claimed",
        mandatoryConstraintsSatisfied: true,
        failedConstraintIds: [],
        deterministicRankKey: `020:${candidateId}`,
      },
    ],
    claims: [
      {
        claimId,
        candidateId,
        text: "Provider qualification claim.",
        decisionBearing: true,
        verificationStatus: "claimed",
        evidenceConfidence: "high",
        evidenceIds: [usedId],
      },
    ],
    evidence: [
      {
        evidenceId: usedId,
        sourceKind: "external_url",
        url: "https://used.example.org/source",
        title: "Supplier display claim",
        publisher: "Publisher display claim",
        publisherDomain: "used.example.org",
        retrievedAt: "2026-08-25T00:00:00.000Z",
        extract: "Used fetched excerpt.",
        contentSha256: createHash("sha256").update("used").digest("hex"),
        verificationStatus: "claimed",
        verificationDisposition: "accepted",
      },
    ],
    eligibleCandidateIds: [candidateId],
    gateEvaluationCompletedAt: "2026-08-25T00:01:00.000Z",
  };
  const sourceBindings = [
    {
      evidenceId: usedId,
      canonicalUrl: "https://used.example.org/source",
      publisherDomain: "used.example.org",
      retrievedAt: "2026-08-25T00:00:00.000Z",
      contentSha256: createHash("sha256").update("used").digest("hex"),
      boundedExcerpt: "Used fetched excerpt.",
    },
    {
      evidenceId: unusedId,
      canonicalUrl: "https://unused.example.org/source",
      publisherDomain: "unused.example.org",
      retrievedAt: "2026-08-25T00:00:01.000Z",
      contentSha256: createHash("sha256").update("unused").digest("hex"),
      boundedExcerpt: "Unused fetched excerpt.",
    },
  ];
  return { graph, sourceBindings, candidateId, unusedId };
}

test("operational producer seals live provenance and retains unused fetches", () => {
  const input = fixture();
  const result = buildOperationalLiveCompleteResultV2({
    graph: input.graph,
    eligibleCandidateIds: [input.candidateId],
    sourceBindings: input.sourceBindings,
    qualificationMode: "synthetic_qualification",
  });
  assert.equal(
    result.foundation.schema_version,
    "complete-result-foundation.v2",
  );
  assert.equal(result.trustedFetchLedger.record_count, 2);
  assert.ok(
    result.foundation.evidence.every(
      (item) => item.provenance === "live_secure_fetch",
    ),
  );
  const unused = result.foundation.evidence.find(
    (item) => item.evidence_id === input.unusedId,
  );
  assert.equal(unused.verification_disposition, "excluded");
  assert.ok(unused.exclusion_reason.trim());
  const bytes = JSON.stringify(result.foundation);
  const read = readOperationalLiveCompleteResultV2({
    document: JSON.parse(bytes),
    resultSha256: createHash("sha256").update(bytes).digest(),
    expectedRunId: result.foundation.run_id,
    sourceBindings: input.sourceBindings,
  });
  assert.equal(JSON.stringify(read), bytes);
  const poisoned = structuredClone(read);
  poisoned.candidates[0].rationale_extended =
    "Supplier claim with hidden citation and unverifiable factual assertion.";
  const demo = aiEvidencePublic.projectStoredResult({
    tier: "demo",
    completeResult: poisoned,
    runBoundMandatoryConstraints: [],
    researchMode: "qualified_live_research",
  });
  assert.equal(
    demo.body.candidates[0].rationale_short,
    "Passed all mandatory matching rules.",
  );
  assert.doesNotMatch(
    JSON.stringify(demo.body),
    /hidden citation|supplier claim/iu,
  );
  const standard = aiEvidencePublic.projectStoredResult({
    tier: "standard",
    completeResult: read,
    projectionAsOf: "2026-08-25T00:02:00.000Z",
    runBoundCanonicalHardConstraints: [],
  });
  assert.equal(standard.body.run_id, read.run_id);
  assert.throws(
    () =>
      readOperationalLiveCompleteResultV2({
        document: JSON.parse(bytes),
        resultSha256: Buffer.alloc(32),
        expectedRunId: result.foundation.run_id,
        sourceBindings: input.sourceBindings,
      }),
    /integrity check failed/iu,
  );
});

test("server-derived source identity fills empty provider display claims without minting verification", () => {
  const input = fixture();
  input.graph.evidence[0].title = "";
  input.graph.evidence[0].publisher = "";
  const result = buildOperationalLiveCompleteResultV2({
    graph: input.graph,
    eligibleCandidateIds: [input.candidateId],
    sourceBindings: input.sourceBindings,
    qualificationMode: "synthetic_qualification",
  });
  const used = result.foundation.evidence.find(
    (item) => item.evidence_id === input.graph.evidence[0].evidenceId,
  );
  assert.equal(used.publisher, "used.example.org");
  assert.equal(used.verification_status, "claimed");
  assert.deepEqual(used.external_verification_basis, {
    kind: "not_externally_verified",
  });
});

test("operational producer rejects provider verification forgery", () => {
  const input = fixture();
  input.graph.candidates[0].verificationStatus = "externally_verified";
  assert.throws(
    () =>
      buildOperationalLiveCompleteResultV2({
        graph: input.graph,
        eligibleCandidateIds: [input.candidateId],
        sourceBindings: input.sourceBindings,
        qualificationMode: "synthetic_qualification",
      }),
    /provider output cannot assert externally_verified/iu,
  );
});

test("production weights fail closed without exact documented SME validation", () => {
  const input = fixture();
  const build = (smeWeightValidation) =>
    buildOperationalLiveCompleteResultV2({
      graph: input.graph,
      eligibleCandidateIds: [input.candidateId],
      sourceBindings: input.sourceBindings,
      qualificationMode: "production",
      ...(smeWeightValidation ? { smeWeightValidation } : {}),
    });
  assert.throws(() => build(), /documented SME validation/iu);
  assert.throws(
    () =>
      build({
        validation_record_id: "SME-TASK137",
        approved_at: "2026-08-25T00:00:00.000Z",
        weight_config_sha256: "0".repeat(64),
      }),
    /documented SME validation/iu,
  );
  assert.doesNotThrow(() =>
    build({
      validation_record_id: "SME-TASK137",
      approved_at: "2026-08-25T00:00:00.000Z",
      weight_config_sha256: STANDARD_DIMENSION_WEIGHTS_SHA256,
    }),
  );
});
