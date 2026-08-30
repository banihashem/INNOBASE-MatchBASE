import assert from "node:assert/strict";
import test from "node:test";
import {
  DIRECTIONAL_SCORE_STATEMENT,
  assertRenderedBands,
  bandFromScore,
  p4QualificationFixtures,
  renderBand,
} from "../src/index.js";

test("GF-PDF-013 pins score boundaries and the two-argument uncertainty cap", () => {
  assert.deepEqual([45, 46, 75, 76, 77, 100].map(bandFromScore), [
    "low_fit",
    "potential_fit",
    "potential_fit",
    "strong_fit",
    "strong_fit",
    "strong_fit",
  ]);
  assert.equal(renderBand(78, "potential_fit"), "potential_fit");
  assert.doesNotThrow(() =>
    assertRenderedBands(
      p4QualificationFixtures().flatMap(({ bands }) => bands),
    ),
  );
});

test("GF-PDF-013 rejects one mismatched occurrence and cannot be waived", () => {
  assert.throws(
    () =>
      assertRenderedBands([
        {
          occurrence_id: "mutated-score-77",
          score: 77,
          band_ceiling: "strong_fit",
          displayed_band: "potential_fit",
        },
      ]),
    /GF-PDF-013 mismatch/u,
  );
});

test("qualification set always contains both long-content fixtures and exact advisory text", () => {
  assert.deepEqual(
    p4QualificationFixtures().map(({ fixture_id }) => fixture_id),
    ["GF-PDF-013", "GF-PDF-019a", "GF-PDF-019b"],
  );
  assert.equal(
    DIRECTIONAL_SCORE_STATEMENT,
    "Scores are directional and designed for shortlisting. They do not replace formal RFQ, factory documentation review, legal import checks, or live availability confirmation.",
  );
});
