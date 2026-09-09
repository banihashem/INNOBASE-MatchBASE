import assert from "node:assert/strict";
import test from "node:test";
import { normalizeResearchGaps } from "../../../packages/application/dist/research-gap-normalizer.js";
import {
  buildNativeResearchRoundInstructions,
  RESEARCH_EXECUTION_INSTRUCTIONS,
} from "../../../packages/application/dist/research-execution-instructions.js";

test("MB-UX-LIVE-001 L14 recorded JSON debris cannot become a research focus", () => {
  const values = [
    "Exact seller identity is missing",
    "",
    "  ",
    'evidence_exhausted":true,',
    'summary_ok":false}] }'.repeat(80),
    '{"remaining_gaps":["quoted data"]}',
    '"price":"unknown",',
    '"status":7,',
    "```json",
    null,
    7,
    "Missing warranty terms",
    "x".repeat(801),
    "Bad\u0000gap",
  ];
  const original = structuredClone(values);
  assert.deepEqual(normalizeResearchGaps(values), [
    "Exact seller identity is missing",
    "Missing warranty terms",
  ]);
  assert.deepEqual(values, original);
});

test("MB-UX-LIVE-001 L14 legitimate multilingual gaps, exact model identifiers and URLs remain unchanged in meaning", () => {
  const gaps = [
    "  Confirm TL-SG1024D V11\n datasheet  ",
    "Missing warranty: see https://seller.example/returns?region=AE",
    "Availability [10 units] is unknown.",
    "Supplier's legal entity is unconfirmed.",
    "\u0627\u0628\u0647\u0627\u0645 \u062f\u0631 \u06af\u0627\u0631\u0627\u0646\u062a\u06cc",
  ];
  assert.deepEqual(normalizeResearchGaps(gaps), [
    "Confirm TL-SG1024D V11 datasheet",
    ...gaps.slice(1),
  ]);
});

test("MB-UX-LIVE-001 L14 gap normalization is stable, deduplicated and bounded", () => {
  assert.deepEqual(normalizeResearchGaps(null), []);
  assert.deepEqual(
    normalizeResearchGaps({ remaining_gaps: ["Missing contact"] }),
    [],
  );
  assert.deepEqual(
    normalizeResearchGaps(
      [
        "Missing contact",
        "missing contact",
        " Missing contact ",
        "Missing price",
      ],
      1,
    ),
    ["Missing contact"],
  );
  assert.deepEqual(normalizeResearchGaps(["Missing contact"], 0), []);
  const result = normalizeResearchGaps(
    Array.from({ length: 250 }, (_, i) => `Missing field ${i}`),
    200,
  );
  assert.equal(result.length, 40);
  assert.deepEqual(normalizeResearchGaps(result, 40), result);
});

test("MB-UX-LIVE-001 L14 discovery instructions separate grounded seller discovery from unavailable RFQ answers", () => {
  assert.match(
    RESEARCH_EXECUTION_INSTRUCTIONS,
    /companies offering the requested product or service/,
  );
  assert.match(
    RESEARCH_EXECUTION_INSTRUCTIONS,
    /own product\/capability and contact\/legal pages/,
  );
  assert.match(
    RESEARCH_EXECUTION_INSTRUCTIONS,
    /Do not turn the full procurement checklist into a single restrictive search query/,
  );
  assert.match(
    RESEARCH_EXECUTION_INSTRUCTIONS,
    /Missing public evidence is not proof of a mismatch/,
  );
  assert.match(
    RESEARCH_EXECUTION_INSTRUCTIONS,
    /Preferences and permitted separately presented alternatives must not become mandatory exclusion rules/,
  );
  assert.match(
    RESEARCH_EXECUTION_INSTRUCTIONS,
    /Do not claim a legal alias relationship without source support/,
  );
  const round = buildNativeResearchRoundInstructions(
    "verification",
    2,
    "Review current source gaps",
  );
  assert.match(round, /identity and actual offering evidence first/);
  assert.match(
    round,
    /never waives the approved requirements or authorizes another call or round/,
  );
  assert.match(round, /fresh cost estimate and explicit human approval/);
});
