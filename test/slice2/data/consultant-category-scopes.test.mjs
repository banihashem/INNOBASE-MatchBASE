import assert from "node:assert/strict";
import test from "node:test";
import {
  privateEvidenceCategoryKey,
  privateEvidenceCategoryScopeKeys,
} from "../../../packages/data/dist/index.js";

test("classification scopes retain exact identity and deterministic parents", () => {
  const classification = {
    scheme: "UNSPSC",
    code: "78101802",
    version: "27.0",
  };
  const scopes = privateEvidenceCategoryScopeKeys(classification);
  assert.equal(scopes[0], privateEvidenceCategoryKey(classification));
  assert.equal(new Set(scopes).size, scopes.length);
  assert.ok(scopes.length >= 6);
  assert.deepEqual(scopes, privateEvidenceCategoryScopeKeys(classification));
});

test("logistics scopes bridge official service and controlled fallback classifications", () => {
  const cpc = privateEvidenceCategoryScopeKeys({
    scheme: "CPC",
    code: "67910",
    version: "2.1",
    label: "Freight transport agency services",
  });
  const isic = privateEvidenceCategoryScopeKeys({
    scheme: "ISIC",
    code: "5229",
    version: "Rev.4",
    label: "Other transportation support activities",
  });
  const custom = privateEvidenceCategoryScopeKeys({
    scheme: "CUSTOM_MATCHBASE",
    code: "SERVICES.LOGISTICS.FREIGHT_FORWARDING",
    version: "1",
  });
  assert.ok(cpc.some((scope) => isic.includes(scope)));
  assert.ok(cpc.some((scope) => custom.includes(scope)));
});

test("unrelated goods do not inherit logistics industry scopes", () => {
  const chemicals = privateEvidenceCategoryScopeKeys({
    scheme: "HS",
    code: "281520",
    version: "2022",
    label: "Potassium hydroxide",
  });
  const logistics = privateEvidenceCategoryScopeKeys({
    scheme: "CPC",
    code: "67910",
    version: "2.1",
  });
  assert.equal(
    chemicals.some((scope) => logistics.includes(scope)),
    false,
  );
});
