import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseConsultantReportModelBuilder } from "../../../packages/application/dist/index.js";

test("Consultant report preserves claim risk independently from decision materiality", async () => {
  const result = {
    schema_version: "complete-result-foundation.v2",
    landscape: { eligible_count: 1, displayed_count: 1 },
    claims: [
      {
        claim_id: "claim-1",
        decision_bearing: true,
        high_risk: false,
      },
    ],
  };
  const pool = {
    async query() {
      return {
        rows: [
          {
            canonical_document: {},
            complete_result_document: result,
            result_sha256_hex: "a".repeat(64),
            assembled_at: new Date("2026-09-02T00:00:00.000Z"),
            candidate_count: 1,
            evidence_count: 1,
            score_count: 0,
            outcome: "candidates",
            eligible_count: 1,
            limitations_text:
              "Supplier evidence remains subject to due diligence.",
            candidate_rows: [],
            evidence_rows: [
              {
                evidence_item_id: "evidence-1",
                title: "Supplier source",
                publisher_domain: "supplier.example",
                url: "https://supplier.example/evidence",
                retrieved_at: "2026-09-02T00:00:00.000Z",
                verification: "claimed",
              },
            ],
            score_rows: [],
            claim_rows: [
              {
                claim_id: "claim-1",
                assertion: "Supplier states that inventory is available.",
                decision_bearing: true,
                verification: "claimed",
                url: "https://supplier.example/evidence",
                publisher: "supplier.example",
                retrieved_at: "2026-09-02T00:00:00.000Z",
                title: "Supplier source",
              },
            ],
            excluded_candidate_rows: [],
            unknown_field_rows: [],
          },
        ],
      };
    },
  };
  const built = await new DatabaseConsultantReportModelBuilder(pool).build({
    runId: "run-1",
    accountId: "account-1",
    generatedByUserId: "user-1",
    result,
    resultSha256: "a".repeat(64),
    canonicalRequestVersionId: "canonical-1",
    projectionVersionId: "projection-1",
    scoringConfigVersionId: "scoring-1",
    modelPolicyVersionId: "model-1",
    analystDecisionSetId: "server-owned-live-research",
    templateVersion: "b".repeat(64),
    pageGeometry: "a4",
  });

  assert.equal(built.reportModel.claims.length, 1);
  assert.equal(built.reportModel.claims[0].materiality, "eligibility");
  assert.equal(built.reportModel.claims[0].high_risk, false);
  assert.equal(built.reportModel.citations.length, 1);
});

test("Consultant report rejects missing claim risk lineage", async () => {
  const result = {
    schema_version: "complete-result-foundation.v2",
    landscape: { eligible_count: 1, displayed_count: 1 },
    claims: [],
  };
  const pool = {
    async query() {
      return {
        rows: [
          {
            canonical_document: {},
            complete_result_document: result,
            result_sha256_hex: "a".repeat(64),
            assembled_at: new Date("2026-09-02T00:00:00.000Z"),
            candidate_count: 1,
            evidence_count: 1,
            score_count: 0,
            outcome: "candidates",
            eligible_count: 1,
            limitations_text: "Due diligence required.",
            candidate_rows: [],
            evidence_rows: [],
            score_rows: [],
            claim_rows: [
              {
                claim_id: "claim-1",
                assertion: "Claim",
                decision_bearing: true,
                verification: "claimed",
                url: "https://supplier.example/evidence",
                publisher: "supplier.example",
                retrieved_at: "2026-09-02T00:00:00.000Z",
                title: "Supplier source",
              },
            ],
            excluded_candidate_rows: [],
            unknown_field_rows: [],
          },
        ],
      };
    },
  };

  await assert.rejects(
    () =>
      new DatabaseConsultantReportModelBuilder(pool).build({
        runId: "run-1",
        accountId: "account-1",
        generatedByUserId: "user-1",
        result,
        resultSha256: "a".repeat(64),
        canonicalRequestVersionId: "canonical-1",
        projectionVersionId: "projection-1",
        scoringConfigVersionId: "scoring-1",
        modelPolicyVersionId: "model-1",
        analystDecisionSetId: "server-owned-live-research",
        templateVersion: "b".repeat(64),
        pageGeometry: "a4",
      }),
    /claim risk lineage is invalid/u,
  );
});

test("Consultant report keeps true high-risk claims behind corroboration gate G4", async () => {
  const result = {
    schema_version: "complete-result-foundation.v2",
    landscape: { eligible_count: 1, displayed_count: 1 },
    claims: [
      {
        claim_id: "claim-1",
        decision_bearing: true,
        high_risk: true,
      },
    ],
  };
  const pool = {
    async query() {
      return {
        rows: [
          {
            canonical_document: {},
            complete_result_document: result,
            result_sha256_hex: "a".repeat(64),
            assembled_at: new Date("2026-09-02T00:00:00.000Z"),
            candidate_count: 1,
            evidence_count: 1,
            score_count: 0,
            outcome: "candidates",
            eligible_count: 1,
            limitations_text: "Due diligence required.",
            candidate_rows: [],
            evidence_rows: [],
            score_rows: [],
            claim_rows: [
              {
                claim_id: "claim-1",
                assertion: "Claim",
                decision_bearing: true,
                verification: "claimed",
                url: "https://supplier.example/evidence",
                publisher: "supplier.example",
                retrieved_at: "2026-09-02T00:00:00.000Z",
                title: "Supplier source",
              },
            ],
            excluded_candidate_rows: [],
            unknown_field_rows: [],
          },
        ],
      };
    },
  };

  await assert.rejects(
    () =>
      new DatabaseConsultantReportModelBuilder(pool).build({
        runId: "run-1",
        accountId: "account-1",
        generatedByUserId: "user-1",
        result,
        resultSha256: "a".repeat(64),
        canonicalRequestVersionId: "canonical-1",
        projectionVersionId: "projection-1",
        scoringConfigVersionId: "scoring-1",
        modelPolicyVersionId: "model-1",
        analystDecisionSetId: "server-owned-live-research",
        templateVersion: "b".repeat(64),
        pageGeometry: "a4",
      }),
    /high_risk_claim_lacks_independent_equal_or_higher_corroboration/u,
  );
});
