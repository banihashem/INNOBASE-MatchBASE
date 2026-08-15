import type {
  CandidateIdentityResolutionV1,
  EvidenceDriverRecordV1,
  EvidenceGraphV1,
  EvidenceLineageLedgerV1,
  EvidenceValueRecordV1,
} from "@matchbase/contracts";
import { validateEvidenceGraph } from "./integrity.js";

const LEDGER_FIELDS = [
  "schemaVersion",
  "accountId",
  "runId",
  "values",
  "drivers",
  "identityResolutions",
] as const;
const VALUE_FIELDS = [
  "valueId",
  "accountId",
  "runId",
  "candidateId",
  "claimId",
  "evidenceId",
  "fieldId",
  "valueSha256",
] as const;
const DRIVER_FIELDS = [
  "driverId",
  "accountId",
  "runId",
  "candidateId",
  "claimId",
  "valueId",
  "evidenceId",
  "dimensionId",
  "direction",
] as const;
const IDENTITY_FIELDS = [
  "resolutionId",
  "accountId",
  "runId",
  "candidateId",
  "canonicalIdentitySha256",
  "disposition",
  "mergedIntoCandidateId",
  "resolverVersion",
  "reasonCode",
] as const;
const SHA256 = /^[a-f0-9]{64}$/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a closed object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const fields = [...expected].sort();
  if (
    actual.length !== fields.length ||
    actual.some((field, index) => field !== fields[index])
  ) {
    throw new Error(`${label} must use the closed lineage contract.`);
  }
}

function text(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value !== value.normalize("NFC")
  ) {
    throw new Error(`${label} must be canonical text.`);
  }
  return value;
}

function unique<T>(
  values: readonly T[],
  id: (value: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const identity = id(value);
    if (!identity || result.has(identity)) {
      throw new Error(`${label} identifiers must be unique.`);
    }
    result.set(identity, value);
  }
  return result;
}

function scope(
  value: { readonly accountId: string; readonly runId: string },
  ledger: EvidenceLineageLedgerV1,
  label: string,
): void {
  if (value.accountId !== ledger.accountId || value.runId !== ledger.runId) {
    throw new Error(`${label} crosses account or run scope.`);
  }
}

function parseLedger(value: unknown): EvidenceLineageLedgerV1 {
  const ledger = record(value, "Evidence lineage ledger");
  exactKeys(ledger, LEDGER_FIELDS, "Evidence lineage ledger");
  if (ledger.schemaVersion !== "evidence-lineage-ledger.v1") {
    throw new Error("Evidence lineage ledger schema version is invalid.");
  }
  text(ledger.accountId, "accountId");
  text(ledger.runId, "runId");
  for (const field of ["values", "drivers", "identityResolutions"] as const) {
    if (!Array.isArray(ledger[field])) {
      throw new Error(`Evidence lineage ${field} must be an array.`);
    }
  }
  const values = ledger.values as unknown as EvidenceValueRecordV1[];
  const drivers = ledger.drivers as unknown as EvidenceDriverRecordV1[];
  const identities =
    ledger.identityResolutions as unknown as CandidateIdentityResolutionV1[];
  for (const [index, valueRecord] of values.entries()) {
    const item = record(valueRecord, `Value ${index}`);
    exactKeys(item, VALUE_FIELDS, `Value ${index}`);
    for (const field of VALUE_FIELDS.slice(0, -1)) text(item[field], field);
    if (
      typeof item.valueSha256 !== "string" ||
      !SHA256.test(item.valueSha256)
    ) {
      throw new Error(`Value ${index} has an invalid digest.`);
    }
  }
  for (const [index, driverRecord] of drivers.entries()) {
    const item = record(driverRecord, `Driver ${index}`);
    exactKeys(item, DRIVER_FIELDS, `Driver ${index}`);
    for (const field of DRIVER_FIELDS) text(item[field], field);
    if (
      !new Set(["supports", "contradicts", "limits"]).has(
        String(item.direction),
      )
    ) {
      throw new Error(`Driver ${index} direction is invalid.`);
    }
  }
  for (const [index, identityRecord] of identities.entries()) {
    const item = record(identityRecord, `Identity ${index}`);
    exactKeys(item, IDENTITY_FIELDS, `Identity ${index}`);
    for (const field of IDENTITY_FIELDS) {
      if (field !== "mergedIntoCandidateId") text(item[field], field);
    }
    if (
      item.mergedIntoCandidateId !== null &&
      typeof item.mergedIntoCandidateId !== "string"
    ) {
      throw new Error(`Identity ${index} merge target is invalid.`);
    }
    if (!SHA256.test(String(item.canonicalIdentitySha256))) {
      throw new Error(`Identity ${index} has an invalid digest.`);
    }
  }
  return value as EvidenceLineageLedgerV1;
}

export function validateEvidenceLineageLedger(
  graphValue: unknown,
  ledgerValue: unknown,
): asserts ledgerValue is EvidenceLineageLedgerV1 {
  validateEvidenceGraph(graphValue);
  const graph = graphValue as EvidenceGraphV1;
  const ledger = parseLedger(ledgerValue);
  if (ledger.runId !== graph.runId) {
    throw new Error("Evidence lineage ledger belongs to another run.");
  }
  const candidates = new Map(
    graph.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const claims = new Map(graph.claims.map((claim) => [claim.claimId, claim]));
  const evidence = new Map(
    graph.evidence.map((source) => [source.evidenceId, source]),
  );
  const values = unique(ledger.values, (value) => value.valueId, "Value");
  const drivers = unique(ledger.drivers, (driver) => driver.driverId, "Driver");
  const identities = unique(
    ledger.identityResolutions,
    (identity) => identity.resolutionId,
    "Identity resolution",
  );
  void drivers;
  void identities;

  const valueEdges = new Set<string>();
  for (const value of ledger.values) {
    scope(value, ledger, `Value ${value.valueId}`);
    const claim = claims.get(value.claimId);
    if (
      !candidates.has(value.candidateId) ||
      !claim ||
      claim.candidateId !== value.candidateId ||
      !evidence.has(value.evidenceId) ||
      !claim.evidenceIds.includes(value.evidenceId)
    ) {
      throw new Error(`Value ${value.valueId} has dangling lineage.`);
    }
    const edge = [
      value.candidateId,
      value.claimId,
      value.evidenceId,
      value.fieldId,
    ].join("\u001f");
    if (valueEdges.has(edge)) {
      throw new Error(`Value ${value.valueId} duplicates a lineage edge.`);
    }
    valueEdges.add(edge);
  }

  const driverEdges = new Set<string>();
  for (const driver of ledger.drivers) {
    scope(driver, ledger, `Driver ${driver.driverId}`);
    const value = values.get(driver.valueId);
    const claim = claims.get(driver.claimId);
    if (
      !value ||
      !claim ||
      !candidates.has(driver.candidateId) ||
      value.candidateId !== driver.candidateId ||
      value.claimId !== driver.claimId ||
      value.evidenceId !== driver.evidenceId ||
      claim.candidateId !== driver.candidateId ||
      !claim.evidenceIds.includes(driver.evidenceId)
    ) {
      throw new Error(`Driver ${driver.driverId} has dangling lineage.`);
    }
    const edge = [driver.valueId, driver.dimensionId, driver.direction].join(
      "\u001f",
    );
    if (driverEdges.has(edge)) {
      throw new Error(`Driver ${driver.driverId} duplicates a lineage edge.`);
    }
    driverEdges.add(edge);
  }

  for (const claim of graph.claims.filter((item) => item.decisionBearing)) {
    const claimValues = ledger.values.filter(
      (value) =>
        value.claimId === claim.claimId &&
        value.candidateId === claim.candidateId,
    );
    if (
      claimValues.length === 0 ||
      claimValues.some(
        (value) =>
          !ledger.drivers.some(
            (driver) =>
              driver.valueId === value.valueId &&
              driver.claimId === claim.claimId &&
              driver.candidateId === claim.candidateId &&
              driver.evidenceId === value.evidenceId,
          ),
      )
    ) {
      throw new Error(
        `Claim ${claim.claimId} lacks exact value/driver lineage.`,
      );
    }
  }

  const identityByCandidate = new Map<string, CandidateIdentityResolutionV1>();
  for (const identity of ledger.identityResolutions) {
    scope(identity, ledger, `Identity ${identity.resolutionId}`);
    if (
      !candidates.has(identity.candidateId) ||
      identityByCandidate.has(identity.candidateId) ||
      identity.resolverVersion !== "candidate-identity-resolver.v1"
    ) {
      throw new Error(`Identity ${identity.resolutionId} has invalid lineage.`);
    }
    identityByCandidate.set(identity.candidateId, identity);
  }
  if (identityByCandidate.size !== candidates.size) {
    throw new Error("Every candidate requires one identity resolution.");
  }
  for (const identity of identityByCandidate.values()) {
    if (identity.disposition === "distinct") {
      if (
        identity.mergedIntoCandidateId !== null ||
        identity.reasonCode !== "unique_canonical_identity"
      ) {
        throw new Error(
          `Distinct identity ${identity.resolutionId} is invalid.`,
        );
      }
      continue;
    }
    if (identity.disposition === "duplicate") {
      const target = identity.mergedIntoCandidateId
        ? identityByCandidate.get(identity.mergedIntoCandidateId)
        : undefined;
      if (
        !target ||
        target.disposition !== "distinct" ||
        target.canonicalIdentitySha256 !== identity.canonicalIdentitySha256 ||
        identity.reasonCode !== "duplicate_canonical_identity"
      ) {
        throw new Error(
          `Duplicate identity ${identity.resolutionId} is invalid.`,
        );
      }
      continue;
    }
    if (
      identity.disposition !== "rejected_ambiguous" ||
      identity.mergedIntoCandidateId !== null ||
      !new Set(["insufficient_identity", "canonical_hash_collision"]).has(
        identity.reasonCode,
      )
    ) {
      throw new Error(
        `Ambiguous identity ${identity.resolutionId} is invalid.`,
      );
    }
  }
  for (const candidateId of graph.eligibleCandidateIds) {
    if (identityByCandidate.get(candidateId)?.disposition !== "distinct") {
      throw new Error(
        "Duplicate or ambiguous candidate entered the eligible set.",
      );
    }
  }
}
