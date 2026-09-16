import test from "node:test";
import assert from "node:assert/strict";
import {
  REPAIR_CONTRACT,
  repairOrganization,
  sha256,
  validateRepairProposal,
} from "../../deployment/incident-repair/protocol.mjs";
const packet = {
  version: "research-incident-packet.v1",
  fault_code: "UNCLASSIFIED",
  disposition: "incident_required",
  stage: "research",
  playbook_version: "research-recovery.v1",
  reproduction: "synthetic-fixture-required",
  authority: {
    tools: [],
    model_calls: 0,
    may_deploy: false,
    may_change_oracle: false,
  },
};
const baseline = { "src/recovery-policy.mjs": "export const cap=3;" };
const proposal = () => ({
  version: "repair-proposal.v1",
  changes: [
    {
      path: "src/recovery-policy.mjs",
      original_sha256: sha256(baseline["src/recovery-policy.mjs"]),
      content: "export const cap=2;",
    },
  ],
});
test("incident organization carries no spend, credential, oracle or release authority", () => {
  const org = repairOrganization(packet);
  assert.equal(org.roles.length, 5);
  assert.equal(org.contract.may_deploy, false);
  assert.equal(org.incident.authority.model_calls, 0);
  assert.throws(() =>
    repairOrganization({ ...packet, raw_response: "private buyer text" }),
  );
  assert.throws(() =>
    repairOrganization({
      ...packet,
      authority: { ...packet.authority, tools: ["shell"] },
    }),
  );
});
test("a bounded exact-source patch remains an unapproved artifact", () => {
  const result = validateRepairProposal(
    proposal(),
    baseline,
    Object.keys(baseline),
  );
  assert.equal(result.may_deploy, false);
  assert.equal(result.release_state, REPAIR_CONTRACT.release_state);
  assert.match(result.candidate_sha256, /^[a-f0-9]{64}$/u);
});
test("repair cannot expand scope, mutate oracle or use traversal even if an adapter asks", () => {
  for (const path of [
    "../oracle.mjs",
    "src/../oracle.mjs",
    "tests/oracle.mjs",
    "deployment/release.mjs",
    "src/authorization.ts",
    "C:/runtime/key",
    "src\\policy.mjs",
  ]) {
    const patch = proposal();
    patch.changes[0].path = path;
    assert.throws(() =>
      validateRepairProposal(
        patch,
        { [path]: baseline["src/recovery-policy.mjs"] },
        [path],
      ),
    );
  }
});
test("stale baseline, extra permission fields, duplicate files and unbounded patch are rejected", () => {
  const stale = proposal();
  stale.changes[0].original_sha256 = "0".repeat(64);
  const extra = { ...proposal(), deploy: true };
  const duplicate = proposal();
  duplicate.changes.push(duplicate.changes[0]);
  const large = proposal();
  large.changes[0].content = "x".repeat(70000);
  for (const patch of [stale, extra, duplicate, large])
    assert.throws(() =>
      validateRepairProposal(patch, baseline, Object.keys(baseline)),
    );
});
