import assert from "node:assert/strict";
import test from "node:test";

import { assertLiveEvidenceSourceBindings } from "../../packages/application/dist/live-source-binding.js";
import { validateEvidenceGraph } from "../../packages/ai-evidence/dist/src/evidence/integrity.js";

const source = Object.freeze({
  evidenceId: "EV-LIVE-001",
  canonicalUrl: "https://evidence.example.org/source/deep-page",
  publisherDomain: "evidence.example.org",
  retrievedAt: "2026-08-25T12:00:00.000Z",
  contentSha256: "a".repeat(64),
  boundedExcerpt: "Bounded server-owned source excerpt.",
});

const evidence = Object.freeze({
  evidenceId: source.evidenceId,
  sourceKind: "external_url",
  url: source.canonicalUrl,
  title: "Provider-authored display title",
  publisher: "Provider-authored display publisher",
  publisherDomain: source.publisherDomain,
  retrievedAt: source.retrievedAt,
  contentSha256: source.contentSha256,
  extract: source.boundedExcerpt,
  verificationDisposition: "accepted",
  exclusionReason: "",
});

const sourceTwo = Object.freeze({
  evidenceId: "EV-LIVE-002",
  canonicalUrl: "https://second.example.net/evidence/canonical",
  publisherDomain: "second.example.net",
  retrievedAt: "2026-08-25T12:00:02.000Z",
  contentSha256: "b".repeat(64),
  boundedExcerpt: "Caf\u00e9 \u0394 source excerpt.",
});

const evidenceTwo = Object.freeze({
  ...evidence,
  evidenceId: sourceTwo.evidenceId,
  url: sourceTwo.canonicalUrl,
  publisherDomain: sourceTwo.publisherDomain,
  retrievedAt: sourceTwo.retrievedAt,
  contentSha256: sourceTwo.contentSha256,
  extract: sourceTwo.boundedExcerpt,
});

function evidenceOnlyGraph(items) {
  return {
    schemaVersion: "evidence-graph.v1",
    runId: "RUN-LIVE-SOURCE-BINDING",
    candidates: [],
    claims: [],
    evidence: items,
    eligibleCandidateIds: [],
    gateEvaluationCompletedAt: "2026-08-25T12:01:00.000Z",
  };
}

test("accepts exact server-owned live source bindings without trusting display text", () => {
  assert.doesNotThrow(() =>
    assertLiveEvidenceSourceBindings([evidence], [source]),
  );
  assert.doesNotThrow(() =>
    assertLiveEvidenceSourceBindings(
      [
        {
          ...evidence,
          title: "Different untrusted title",
          publisher: "Different untrusted publisher",
        },
      ],
      [source],
    ),
  );
});

test("accepts valid excluded evidence without mutating evidence or source records", () => {
  const excludedEvidence = {
    ...evidence,
    verificationDisposition: "excluded",
    exclusionReason:
      "Source was securely fetched but did not support the claim.",
  };
  const evidenceBefore = structuredClone(excludedEvidence);
  const sourceBefore = structuredClone(source);

  validateEvidenceGraph(evidenceOnlyGraph([excludedEvidence]));
  assert.doesNotThrow(() =>
    assertLiveEvidenceSourceBindings([excludedEvidence], [source]),
  );
  assert.deepEqual(excludedEvidence, evidenceBefore);
  assert.deepEqual(source, sourceBefore);
});

for (const [label, mutate] of [
  ["evidence ID", (value) => ({ ...value, evidenceId: "EV-LIVE-OTHER" })],
  [
    "canonical URL",
    (value) => ({
      ...value,
      url: "https://evidence.example.org/source/other-page",
    }),
  ],
  [
    "publisher domain",
    (value) => ({ ...value, publisherDomain: "other.example.org" }),
  ],
  [
    "retrieval timestamp",
    (value) => ({ ...value, retrievedAt: "2026-08-25T12:00:01.000Z" }),
  ],
  ["content hash", (value) => ({ ...value, contentSha256: "b".repeat(64) })],
  ["bounded excerpt", (value) => ({ ...value, extract: "Other excerpt." })],
]) {
  test(`rejects a provider ${label} mismatch`, () => {
    assert.throws(
      () => assertLiveEvidenceSourceBindings([mutate(evidence)], [source]),
      /not exactly bound to a fetched source/iu,
    );
  });
}

test("rejects a server domain inconsistent with its canonical URL", () => {
  assert.throws(
    () =>
      assertLiveEvidenceSourceBindings(
        [evidence],
        [{ ...source, publisherDomain: "other.example.org" }],
      ),
    /not exactly bound to a fetched source/iu,
  );
});

test("rejects duplicate fetched evidence IDs", () => {
  assert.throws(
    () => assertLiveEvidenceSourceBindings([evidence], [source, { ...source }]),
    /not exactly bound to a fetched source/iu,
  );
});

test("rejects duplicate provider evidence IDs", () => {
  assert.throws(
    () =>
      assertLiveEvidenceSourceBindings([evidence, { ...evidence }], [source]),
    /not exactly bound to a fetched source/iu,
  );
  assert.throws(
    () => validateEvidenceGraph(evidenceOnlyGraph([evidence, { ...evidence }])),
    /identifiers must be unique/iu,
  );
});

test("rejects unknown provider evidence IDs but allows unused fetched sources", () => {
  assert.throws(
    () =>
      assertLiveEvidenceSourceBindings(
        [{ ...evidence, evidenceId: "EV-LIVE-UNKNOWN" }],
        [source, sourceTwo],
      ),
    /not exactly bound to a fetched source/iu,
  );
  assert.doesNotThrow(() =>
    assertLiveEvidenceSourceBindings([evidence], [source, sourceTwo]),
  );
});

test("rejects two-source tuple splicing", () => {
  assert.throws(
    () =>
      assertLiveEvidenceSourceBindings(
        [{ ...evidence, url: sourceTwo.canonicalUrl }],
        [source, sourceTwo],
      ),
    /not exactly bound to a fetched source/iu,
  );
  assert.throws(
    () =>
      assertLiveEvidenceSourceBindings(
        [
          {
            ...evidence,
            contentSha256: sourceTwo.contentSha256,
            extract: sourceTwo.boundedExcerpt,
          },
        ],
        [source, sourceTwo],
      ),
    /not exactly bound to a fetched source/iu,
  );
});

for (const [label, mutatedSource] of [
  [
    "uppercase URL host",
    {
      ...source,
      canonicalUrl: "https://EVIDENCE.example.org/source/deep-page",
    },
  ],
  [
    "explicit default port",
    {
      ...source,
      canonicalUrl: "https://evidence.example.org:443/source/deep-page",
    },
  ],
  ["uppercase domain", { ...source, publisherDomain: "EVIDENCE.example.org" }],
  [
    "trailing-dot domain",
    { ...source, publisherDomain: "evidence.example.org." },
  ],
]) {
  test(`rejects non-canonical URL/domain form: ${label}`, () => {
    assert.throws(
      () => assertLiveEvidenceSourceBindings([evidence], [mutatedSource]),
      /not exactly bound to a fetched source/iu,
    );
  });
}

for (const [label, contentSha256] of [
  ["uppercase", "A".repeat(64)],
  ["short", "a".repeat(63)],
  ["long", "a".repeat(65)],
]) {
  test(`rejects ${label} provider content hash`, () => {
    assert.throws(
      () =>
        assertLiveEvidenceSourceBindings(
          [{ ...evidence, contentSha256 }],
          [source],
        ),
      /not exactly bound to a fetched source/iu,
    );
  });
}

test("binds excerpt whitespace and Unicode byte-for-byte", () => {
  assert.doesNotThrow(() =>
    assertLiveEvidenceSourceBindings([evidenceTwo], [sourceTwo]),
  );
  for (const extract of [
    ` ${sourceTwo.boundedExcerpt}`,
    `${sourceTwo.boundedExcerpt}\n`,
    sourceTwo.boundedExcerpt.normalize("NFD"),
  ]) {
    assert.throws(
      () =>
        assertLiveEvidenceSourceBindings(
          [{ ...evidenceTwo, extract }],
          [sourceTwo],
        ),
      /not exactly bound to a fetched source/iu,
    );
  }
});
