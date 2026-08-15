import { createHash } from "node:crypto";
import type {
  CandidateIdentityResolutionV1,
  CandidateV1,
} from "@matchbase/contracts";

export interface CandidateIdentityResolutionInput {
  readonly accountId: string;
  readonly runId: string;
  readonly candidates: readonly Pick<
    CandidateV1,
    "candidateId" | "displayName" | "countryCode"
  >[];
  readonly hashCanonicalIdentity?: (canonicalIdentity: string) => string;
}

interface CanonicalCandidate {
  readonly candidateId: string;
  readonly canonicalIdentity: string | null;
  readonly canonicalIdentitySha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;

function exactText(value: string, label: string): string {
  if (!value || value !== value.trim() || value !== value.normalize("NFC")) {
    throw new Error(`${label} must be canonical text.`);
  }
  return value;
}

function defaultHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compareCandidateId(
  left: CanonicalCandidate,
  right: CanonicalCandidate,
): number {
  return left.candidateId < right.candidateId
    ? -1
    : left.candidateId > right.candidateId
      ? 1
      : 0;
}

export function canonicalizeCandidateIdentity(
  candidate: Pick<CandidateV1, "displayName" | "countryCode">,
): string | null {
  const countryCode = candidate.countryCode.normalize("NFKC").toUpperCase();
  const displayName = candidate.displayName
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    !/^[A-Z]{2}$/u.test(countryCode) ||
    displayName.length < 2 ||
    !/[\p{L}\p{N}]/u.test(displayName)
  ) {
    return null;
  }
  return `name=${displayName}|country=${countryCode}`;
}

export function resolveCandidateIdentities(
  input: CandidateIdentityResolutionInput,
): readonly CandidateIdentityResolutionV1[] {
  const accountId = exactText(input.accountId, "accountId");
  const runId = exactText(input.runId, "runId");
  const hash = input.hashCanonicalIdentity ?? defaultHash;
  const candidateIds = new Set<string>();
  const canonical: CanonicalCandidate[] = input.candidates.map((candidate) => {
    const candidateId = exactText(candidate.candidateId, "candidateId");
    if (candidateIds.has(candidateId)) {
      throw new Error(
        "Candidate identifiers must be unique before resolution.",
      );
    }
    candidateIds.add(candidateId);
    const canonicalIdentity = canonicalizeCandidateIdentity(candidate);
    const canonicalIdentitySha256 = hash(
      canonicalIdentity ?? `ambiguous:${candidateId}`,
    );
    if (!SHA256.test(canonicalIdentitySha256)) {
      throw new Error(
        "Candidate identity hash function returned an invalid digest.",
      );
    }
    return { candidateId, canonicalIdentity, canonicalIdentitySha256 };
  });

  const byHash = new Map<string, CanonicalCandidate[]>();
  for (const item of canonical) {
    if (item.canonicalIdentity === null) continue;
    const group = byHash.get(item.canonicalIdentitySha256) ?? [];
    group.push(item);
    byHash.set(item.canonicalIdentitySha256, group);
  }

  const collisionHashes = new Set<string>();
  for (const [digest, group] of byHash) {
    if (new Set(group.map((item) => item.canonicalIdentity)).size > 1) {
      collisionHashes.add(digest);
    }
  }

  const winnerByIdentity = new Map<string, string>();
  for (const item of [...canonical].sort(compareCandidateId)) {
    if (
      item.canonicalIdentity !== null &&
      !collisionHashes.has(item.canonicalIdentitySha256) &&
      !winnerByIdentity.has(item.canonicalIdentity)
    ) {
      winnerByIdentity.set(item.canonicalIdentity, item.candidateId);
    }
  }

  return Object.freeze(
    [...canonical]
      .sort(compareCandidateId)
      .map((item): CandidateIdentityResolutionV1 => {
        const base = {
          resolutionId: `IDENTITY:${runId}:${item.candidateId}`,
          accountId,
          runId,
          candidateId: item.candidateId,
          canonicalIdentitySha256: item.canonicalIdentitySha256,
          resolverVersion: "candidate-identity-resolver.v1" as const,
        };
        if (item.canonicalIdentity === null) {
          return Object.freeze({
            ...base,
            disposition: "rejected_ambiguous",
            mergedIntoCandidateId: null,
            reasonCode: "insufficient_identity",
          });
        }
        if (collisionHashes.has(item.canonicalIdentitySha256)) {
          return Object.freeze({
            ...base,
            disposition: "rejected_ambiguous",
            mergedIntoCandidateId: null,
            reasonCode: "canonical_hash_collision",
          });
        }
        const winner = winnerByIdentity.get(item.canonicalIdentity);
        if (!winner) throw new Error("Candidate identity winner is missing.");
        if (winner === item.candidateId) {
          return Object.freeze({
            ...base,
            disposition: "distinct",
            mergedIntoCandidateId: null,
            reasonCode: "unique_canonical_identity",
          });
        }
        return Object.freeze({
          ...base,
          disposition: "duplicate",
          mergedIntoCandidateId: winner,
          reasonCode: "duplicate_canonical_identity",
        });
      }),
  );
}
