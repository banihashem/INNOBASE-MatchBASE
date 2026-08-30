import assert from "node:assert/strict";
import test from "node:test";
import type {
  CanonicalFieldV1,
  CanonicalRequestV1,
} from "@matchbase/contracts";
import type {
  CanonicalizationCapability,
  CanonicalizationInput,
} from "../src/capabilities.js";
import {
  CanonicalizationTimeoutError,
  DeterministicFixtureCanonicalizer,
  runCanonicalizationWithinBudget,
} from "../src/canonicalization/canonicalizer.js";
import { DeterministicFixtureLanguageIdentifier } from "../src/canonicalization/language.js";

function characters(points: readonly number[]): string {
  return String.fromCodePoint(...points);
}

const suffix = characters([
  0x20, 0x41, 0x42, 0x31, 0x32, 0x20, 0x34, 0x35, 0x20, 0x63, 0x6d,
]);

const sources = [
  { expected: "en", value: characters([0x4e, 0x65, 0x65, 0x64]) + suffix },
  {
    expected: "fa",
    value: characters([0x0646, 0x06cc, 0x0627, 0x0632]) + suffix,
  },
  {
    expected: "ar",
    value: characters([0x0645, 0x0637, 0x0644, 0x0648, 0x0628]) + suffix,
  },
  {
    expected: "es",
    value: characters([0x006e, 0x0069, 0x00f1, 0x006f]) + suffix,
  },
] as const;

function field(overrides: Partial<CanonicalFieldV1> = {}): CanonicalFieldV1 {
  return {
    fieldId: "FLD-CORE-PS-03",
    path: "product_specification.core.product_name_raw",
    valueState: "provided",
    languageOrigin: "translated",
    canonicalValue: "industrial component",
    ...overrides,
  };
}

function input(sourceText: string): CanonicalizationInput {
  return {
    requestId: "REQ-FIX-001",
    sourceText,
    presentedFields: ["FLD-CORE-PS-03"],
    fixtureCanonicalText: "Need model AB12 with length 45 cm.",
    fixtureCanonicalFields: [field()],
  };
}

function canonicalizer(): DeterministicFixtureCanonicalizer {
  return new DeterministicFixtureCanonicalizer({
    digestKey: new Uint8Array(32).fill(7),
    digestKeyId: "fixture-hmac-key-v1",
    languageIdentifier: new DeterministicFixtureLanguageIdentifier(),
    now: () => new Date("2026-08-14T00:00:00.000Z"),
  });
}

test("canonicalizes four language fixtures without retaining source text", async () => {
  for (const source of sources) {
    const result = await runCanonicalizationWithinBudget(
      canonicalizer(),
      input(source.value),
      { record: () => undefined },
    );
    assert.equal(result.language.bcp47, source.expected);
    assert.equal(result.canonicalLanguage, "en");
    assert.equal(result.originalTextDigest.algorithm, "HMAC-SHA-256");
    assert.equal(result.protectedSpans.length, 2);
    assert.equal(JSON.stringify(result).includes(source.value), false);
  }
});

test("detects contradictory canonical fields without selecting a winner", async () => {
  const request = input(sources[0].value);
  request.presentedFields = ["origin-a", "origin-b"];
  request.fixtureCanonicalFields = [
    field({
      fieldId: "origin-a",
      path: "supplier.origin",
      canonicalValue: "Brazil",
    }),
    field({
      fieldId: "origin-b",
      path: "supplier.origin",
      canonicalValue: "GCC",
    }),
  ];
  const result = await canonicalizer().canonicalize(
    request,
    new AbortController().signal,
    { record: () => undefined },
  );
  assert.equal(result.readiness, "not_ready");
  assert.equal(result.contradictionIds.length, 1);
});

test("deterministically preserves model, code, and quantity spans without retaining source", async () => {
  const sourceText = `${characters([0x0646, 0x06cc, 0x0627, 0x0632])} MX900 HS-CODE 45 kg`;
  const request = input(sourceText);
  request.fixtureCanonicalText = "Synthetic industrial sourcing request.";
  const result = await canonicalizer().canonicalize(
    request,
    new AbortController().signal,
    { record: () => undefined },
  );
  assert.deepEqual(
    result.protectedSpans.map((span) => [span.category, span.canonicalValue]),
    [
      ["model", "MX900"],
      ["code_enum", "HS-CODE"],
      ["quantity_unit", "45 kg"],
    ],
  );
  for (const span of result.protectedSpans) {
    assert.equal(result.canonicalText.split(span.canonicalValue).length - 1, 1);
  }
  assert.equal(result.canonicalText.includes(sourceText), false);
  assert.deepEqual(
    result.provenance.map((item) => item.capabilityId),
    ["CAP-LANGUAGE-ID", "CAP-TRANSLATE"],
  );
});

test("preserves a grouped quantity and unit as one byte-identical protected span", async () => {
  const request = input("Need monthly capacity of 2,000 units.");
  request.fixtureCanonicalText = "Need monthly industrial capacity.";
  const result = await canonicalizer().canonicalize(
    request,
    new AbortController().signal,
    { record: () => undefined },
  );

  assert.deepEqual(
    result.protectedSpans.map((span) => [span.category, span.canonicalValue]),
    [["quantity_unit", "2,000 units"]],
  );
  assert.equal(result.canonicalText.includes("2,000 units"), true);
  assert.equal(
    result.protectedSpans.some((span) => span.canonicalValue === "000 units"),
    false,
  );
  assert.equal(result.canonicalText.split("2,000 units").length - 1, 1);
});

test("enforces the bounded timeout with a source-free retryable error", async () => {
  const never: CanonicalizationCapability = {
    capabilityId: "CAP-TRANSLATE",
    canonicalize: async () =>
      await new Promise<CanonicalRequestV1>(() => undefined),
  };
  await assert.rejects(
    runCanonicalizationWithinBudget(
      never,
      input(sources[1].value),
      { record: () => undefined },
      5,
    ),
    (error: unknown) =>
      error instanceof CanonicalizationTimeoutError &&
      !error.message.includes(sources[1].value),
  );
});
