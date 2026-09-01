import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureLegacyMisclassifiedDomainPackAnnotation,
  readLegacyMisclassifiedDomainPackAnnotation,
} from "../../../packages/data/dist/index.js";

const expected = {
  schema_version: "legacy-misclassified-domain-pack.v1",
  observed_category: "synthetic_industrial_components",
  corrected_category: "food_agricultural_commodities",
  reason_code: "historical_domain_pack_resolver_misclassification",
};

test("server-owned legacy annotation is additive, idempotent, and drift-checked", async () => {
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes("SELECT annotation"))
        return { rows: [{ annotation: expected }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  await ensureLegacyMisclassifiedDomainPackAnnotation(client, {
    accountId: "00000000-0000-4000-8000-000000000001",
    requestId: "00000000-0000-4000-8000-000000000002",
    observedCategory: expected.observed_category,
    correctedCategory: expected.corrected_category,
  });
  assert.match(calls[0].text, /ON CONFLICT[\s\S]*DO NOTHING/iu);
  assert.doesNotMatch(calls[0].text, /\bUPDATE\b/iu);
  assert.deepEqual(
    await readLegacyMisclassifiedDomainPackAnnotation(client, {
      accountId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000002",
    }),
    expected,
  );
  const drifted = {
    ...client,
    async query(text, _values = []) {
      if (text.includes("SELECT annotation"))
        return {
          rows: [{ annotation: { ...expected, corrected_category: "other" } }],
          rowCount: 1,
        };
      return { rows: [], rowCount: 1 };
    },
  };
  await assert.rejects(
    ensureLegacyMisclassifiedDomainPackAnnotation(drifted, {
      accountId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000002",
      observedCategory: expected.observed_category,
      correctedCategory: expected.corrected_category,
    }),
    /drifted/iu,
  );
});
