import assert from "node:assert/strict";
import test from "node:test";
import { groundNativeCandidateIndex } from "../../../packages/application/dist/native-candidate-index.js";

const native = {
  text: "### 1) Aster Logistics LLC\n- **Legal name:** Aster Logistics LLC (Dubai).\n- Proof quote: “Filed By : A0180 - **Aster Logistics LLC**”.\n### 2) Birch Shipping\nSwitch services are unknown.",
  citations: [
    {
      url: "https://aster.example.com/tariff",
      content: "Aster Logistics LLC publishes its tariff.",
    },
  ],
};
const index = (candidates) => ({
  candidates,
  remaining_gaps: ["Verify identity"],
  evidence_exhausted: false,
  summary: "Discovery leads only.",
});
const candidate = (anchor_quote, overrides = {}) => ({
  legal_name: "Aster Logistics LLC",
  anchor_quote,
  source_urls: [native.citations[0].url],
  ...overrides,
});

test("MB-UX-LIVE-001 L06 display formatting never invents an index source span", () => {
  for (const anchor of [
    '"Aster Logistics LLC (Dubai)."',
    "Proof quote: “Filed By : A0180 - Aster Logistics LLC”.",
    "Aster Logistics LLC is verified and certified.",
  ]) {
    const input = index([candidate(anchor)]);
    const before = structuredClone(input);
    const result = groundNativeCandidateIndex(input, native);
    assert.equal(result.index.candidates.length, 1);
    assert.ok(native.text.includes(result.index.candidates[0].anchor_quote));
    assert.notEqual(result.index.candidates[0].anchor_quote, anchor);
    assert.deepEqual(result.diagnostics.reanchored_names, [
      "Aster Logistics LLC",
    ]);
    assert.deepEqual(input, before);
  }
});

test("MB-UX-LIVE-001 L06 exact anchors and original citation text remain supported", () => {
  const anchor = native.citations[0].content;
  const result = groundNativeCandidateIndex(index([candidate(anchor)]), native);
  assert.equal(result.index.candidates[0].anchor_quote, anchor);
  assert.deepEqual(result.diagnostics.reanchored_names, []);
});

test("MB-UX-LIVE-001 L06 uncited prose URLs are removed, never repaired or granted authority", () => {
  const uncited = "https://aster.example.com/about";
  const result = groundNativeCandidateIndex(
    index([
      candidate("Aster Logistics LLC", {
        source_urls: [uncited, native.citations[0].url],
      }),
    ]),
    { ...native, text: native.text + "\n" + uncited },
  );
  assert.deepEqual(result.index.candidates[0].source_urls, [
    native.citations[0].url,
  ]);
  assert.deepEqual(result.diagnostics.discarded_source_urls, [uncited]);
  const noSources = groundNativeCandidateIndex(
    index([candidate("Aster Logistics LLC", { source_urls: [uncited] })]),
    native,
  );
  assert.deepEqual(noSources.index.candidates[0].source_urls, []);
});

test("MB-UX-LIVE-001 L06 unknown and embedded names are excluded without discarding grounded peers", () => {
  const input = index([
    candidate("Aster Logistics LLC"),
    candidate("Birch Shipping Company", {
      legal_name: "Birch Shipping Company",
    }),
    candidate("Logistics", { legal_name: "ster Logistics" }),
  ]);
  const result = groundNativeCandidateIndex(input, native);
  assert.equal(result.index.candidates.length, 1);
  assert.equal(result.diagnostics.rejected_candidates.length, 2);
  assert.equal(result.index.remaining_gaps.length, 3);
  assert.throws(
    () => groundNativeCandidateIndex(index(input.candidates.slice(1)), native),
    /MB-422-LIVE-INDEX/,
  );
});

test("MB-UX-LIVE-001 L06 an empty index stays empty and duplicate names merge only cited URLs", () => {
  assert.equal(
    groundNativeCandidateIndex(index([]), native).index.candidates.length,
    0,
  );
  assert.equal(
    groundNativeCandidateIndex(
      index([
        candidate("Aster Logistics LLC"),
        candidate('"Aster Logistics LLC"'),
      ]),
      native,
    ).index.candidates.length,
    1,
  );
});
