import assert from "node:assert/strict";
import test from "node:test";
import { removesInvalidRetainedContact } from "../../../packages/data/dist/consultant-retained-recovery.js";
import { GOLDEN_SCENARIO_V3_01 } from "../../../packages/contracts/dist/src/index.js";
test("L04 same-count recovery requires removal of an invalid contact on the same retained entities", () => {
  const prior = structuredClone(GOLDEN_SCENARIO_V3_01);
  prior.supplier_candidates = prior.supplier_candidates.slice(0, 1);
  prior.supplier_candidates[0].contacts.general_email = "[email protected]";
  const next = structuredClone(prior);
  assert.equal(removesInvalidRetainedContact(prior, next), false);
  delete next.supplier_candidates[0].contacts.general_email;
  assert.equal(removesInvalidRetainedContact(prior, next), true);
  const replacement = structuredClone(next);
  replacement.supplier_candidates[0].supplier_entity_id = "other-entity";
  assert.equal(removesInvalidRetainedContact(prior, replacement), false);
  const invented = structuredClone(next);
  invented.supplier_candidates[0].contacts.general_email =
    "invented@example.com";
  assert.equal(removesInvalidRetainedContact(prior, invented), false);
  const valid = structuredClone(prior);
  valid.supplier_candidates[0].contacts.general_email = "real@example.com";
  assert.equal(removesInvalidRetainedContact(valid, next), false);
  next.supplier_candidates = [];
  assert.equal(removesInvalidRetainedContact(prior, next), false);
});
