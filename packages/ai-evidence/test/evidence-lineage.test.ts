import assert from "node:assert/strict";
import test from "node:test";
import type {
  EvidenceGraphV1,
  EvidenceLineageLedgerV1,
} from "@matchbase/contracts";
import {
  contentSha256,
  resolveCandidateIdentities,
  validateEvidenceLineageLedger,
} from "../src/index.js";
import { buildSyntheticEvidenceGraph } from "../src/research/synthetic-fixtures.js";

const accountId = "ACC-LINEAGE-001";

function ledgerFor(graph: EvidenceGraphV1): EvidenceLineageLedgerV1 {
  const values = graph.claims.map((claim, index) => ({
    valueId: `VALUE-${index + 1}`,
    accountId,
    runId: graph.runId,
    candidateId: claim.candidateId,
    claimId: claim.claimId,
    evidenceId: claim.evidenceIds[0]!,
    fieldId: "declared_manufacturing_profile",
    valueSha256: contentSha256(`verified-value-${index + 1}`),
  }));
  return {
    schemaVersion: "evidence-lineage-ledger.v1",
    accountId,
    runId: graph.runId,
    values,
    drivers: values.map((value, index) => ({
      driverId: `DRIVER-${index + 1}`,
      accountId,
      runId: graph.runId,
      candidateId: value.candidateId,
      claimId: value.claimId,
      valueId: value.valueId,
      evidenceId: value.evidenceId,
      dimensionId: "technical",
      direction: "supports",
    })),
    identityResolutions: resolveCandidateIdentities({
      accountId,
      runId: graph.runId,
      candidates: graph.candidates,
    }),
  };
}

test("accepts exact claim/value/source/candidate/driver lineage", () => {
  const graph = buildSyntheticEvidenceGraph("RUN-LINEAGE", "two");
  assert.doesNotThrow(() =>
    validateEvidenceLineageLedger(graph, ledgerFor(graph)),
  );
});

test("fails closed on dangling value and driver relations", () => {
  const graph = buildSyntheticEvidenceGraph("RUN-DANGLING-LINEAGE", "one");
  const mutations: Array<(ledger: EvidenceLineageLedgerV1) => void> = [
    (ledger) => {
      (ledger.values[0] as { candidateId: string }).candidateId =
        "CAND-MISSING";
    },
    (ledger) => {
      (ledger.values[0] as { claimId: string }).claimId = "CLAIM-MISSING";
    },
    (ledger) => {
      (ledger.values[0] as { evidenceId: string }).evidenceId = "EVD-MISSING";
    },
    (ledger) => {
      (ledger.drivers[0] as { valueId: string }).valueId = "VALUE-MISSING";
    },
  ];
  for (const mutate of mutations) {
    const ledger = structuredClone(ledgerFor(graph));
    mutate(ledger);
    assert.throws(
      () => validateEvidenceLineageLedger(graph, ledger),
      /dangling lineage/iu,
    );
  }
});

test("rejects cross-tenant and duplicate semantic lineage", () => {
  const graph = buildSyntheticEvidenceGraph("RUN-SCOPE-LINEAGE", "one");
  const crossTenant = structuredClone(ledgerFor(graph));
  (crossTenant.values[0] as { accountId: string }).accountId = "ACC-OTHER";
  assert.throws(
    () => validateEvidenceLineageLedger(graph, crossTenant),
    /crosses account or run scope/iu,
  );

  const duplicate = structuredClone(ledgerFor(graph));
  (duplicate as { values: EvidenceLineageLedgerV1["values"] }).values = [
    ...duplicate.values,
    { ...duplicate.values[0]!, valueId: "VALUE-DUPLICATE-ID" },
  ];
  assert.throws(
    () => validateEvidenceLineageLedger(graph, duplicate),
    /duplicates a lineage edge/iu,
  );
});

test("deterministically resolves distinct and duplicate candidates", () => {
  const candidates = [
    {
      candidateId: "CAND-B",
      displayName: "  ACME—Industrial  ",
      countryCode: "de",
    },
    {
      candidateId: "CAND-A",
      displayName: "Acme Industrial",
      countryCode: "DE",
    },
  ];
  const forward = resolveCandidateIdentities({
    accountId,
    runId: "RUN-IDENTITY",
    candidates,
  });
  const reversed = resolveCandidateIdentities({
    accountId,
    runId: "RUN-IDENTITY",
    candidates: [...candidates].reverse(),
  });
  assert.deepEqual(forward, reversed);
  assert.deepEqual(
    forward.map(({ candidateId, disposition, mergedIntoCandidateId }) => ({
      candidateId,
      disposition,
      mergedIntoCandidateId,
    })),
    [
      {
        candidateId: "CAND-A",
        disposition: "distinct",
        mergedIntoCandidateId: null,
      },
      {
        candidateId: "CAND-B",
        disposition: "duplicate",
        mergedIntoCandidateId: "CAND-A",
      },
    ],
  );
});

test("rejects ambiguous identity and injected digest collisions", () => {
  const ambiguous = resolveCandidateIdentities({
    accountId,
    runId: "RUN-AMBIGUOUS",
    candidates: [
      { candidateId: "CAND-X", displayName: "---", countryCode: "DE" },
    ],
  });
  assert.equal(ambiguous[0]?.disposition, "rejected_ambiguous");
  assert.equal(ambiguous[0]?.reasonCode, "insufficient_identity");

  const collision = resolveCandidateIdentities({
    accountId,
    runId: "RUN-COLLISION",
    candidates: [
      { candidateId: "CAND-A", displayName: "Alpha", countryCode: "DE" },
      { candidateId: "CAND-B", displayName: "Beta", countryCode: "NL" },
    ],
    hashCanonicalIdentity: () => "0".repeat(64),
  });
  assert.equal(
    collision.every(
      (item) =>
        item.disposition === "rejected_ambiguous" &&
        item.reasonCode === "canonical_hash_collision",
    ),
    true,
  );
});

test("duplicate identities cannot remain eligible", () => {
  const graph = buildSyntheticEvidenceGraph("RUN-DUPLICATE-ELIGIBLE", "two");
  graph.candidates[1]!.displayName = graph.candidates[0]!.displayName;
  graph.candidates[1]!.countryCode = graph.candidates[0]!.countryCode;
  const ledger = ledgerFor(graph);
  assert.throws(
    () => validateEvidenceLineageLedger(graph, ledger),
    /duplicate or ambiguous candidate entered/iu,
  );
});
