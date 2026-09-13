import assert from "node:assert/strict";
import test from "node:test";
import {
  progressiveResearchInstructions,
  progressiveResearchMethods,
  requiresPublicSocialReview,
} from "../../../packages/application/dist/progressive-research-policy.js";
import { createRoundCallGuard } from "../../../packages/application/dist/consultant-research-cost.js";

const strategy = "progressive-evidence.v1";

test("MB-UX-QUALITY-001 L11 newly approved rounds progress from social review to institutional cross-checks", () => {
  for (const round of [1, 2, 3, 4, 5]) {
    const plan = Object.freeze({
      research_strategy: strategy,
      round_number: round,
    });
    assert.deepEqual(
      progressiveResearchMethods(plan),
      round === 1
        ? []
        : round < 4
          ? ["public_social"]
          : ["public_social", "official_institutions"],
    );
    assert.equal(requiresPublicSocialReview(plan), round > 1);
  }
});

test("MB-UX-QUALITY-001 L11 historical approvals retain their existing round-four social requirement without added calls", () => {
  for (const round of [1, 2, 3, 4, 5]) {
    const plan = Object.freeze({ round_number: round });
    assert.deepEqual(progressiveResearchMethods(plan), []);
    assert.equal(progressiveResearchInstructions(plan), "");
    assert.equal(requiresPublicSocialReview(plan), round >= 4);
  }
});

test("MB-UX-QUALITY-001 L11 unknown strategies are rejected when the call guard is created", () => {
  for (const unknown of ["future.v2", "", null, 1, {}]) {
    const plan = { round_number: 4, research_strategy: unknown };
    for (const fn of [
      progressiveResearchMethods,
      progressiveResearchInstructions,
      requiresPublicSocialReview,
      createRoundCallGuard,
    ])
      assert.throws(() => fn(plan), {
        code: "MB-409-RESEARCH-STRATEGY",
      });
  }
});

test("MB-UX-QUALITY-001 L11 instructions preserve evidence scope, entity distinctions and public-access boundaries", () => {
  const second = progressiveResearchInstructions({
    research_strategy: strategy,
    round_number: 2,
  });
  const fourth = progressiveResearchInstructions({
    research_strategy: strategy,
    round_number: 4,
  });
  assert.ok(second.length < 3500);
  assert.ok(fourth.length < 4500);
  assert.match(second, /hypotheses, not proof of ownership/);
  assert.match(second, /copied or syndicated announcements/);
  assert.match(second, /Do not bypass login, CAPTCHA or paywalls/);
  assert.doesNotMatch(second, /Prioritize official business registries/);
  assert.match(fourth, /countries of registration and operation/);
  assert.match(fourth, /incorporation, headquarters, factory, branch, agent/);
  assert.match(fourth, /company-level customs data is not public/);
  assert.match(fourth, /no later round starts automatically/);
  assert.equal(
    progressiveResearchInstructions({
      research_strategy: strategy,
      round_number: 1,
    }),
    "",
  );
});

test("MB-UX-QUALITY-001 L11 helper methods do not add work outside the five-round sequence", () => {
  for (const round of [0, 6]) {
    const plan = { research_strategy: strategy, round_number: round };
    assert.deepEqual(progressiveResearchMethods(plan), []);
    assert.equal(requiresPublicSocialReview(plan), false);
  }
});
