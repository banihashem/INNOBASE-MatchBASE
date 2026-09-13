import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPublicSocialChecks } from "../../../packages/application/dist/public-social-review.js";

const scope = "MB-UX-QUALITY-001 L11";
const oldTime = "2026-09-10T09:00:00Z";
const startedAt = "2026-09-13T10:00:00Z";
const completedAt = "2026-09-13T10:00:10Z";
const recordedAt = "2026-09-13T10:01:00Z";
const linkedProfile = "https://www.linkedin.com/company/aster-industrial";
const otherProfile = "https://www.linkedin.com/company/other-industrial";
const plan = { round_number: 2, research_strategy: "progressive-evidence.v1" };

function fixture() {
  return {
    candidates: [
      {
        supplier_entity_id: "entity-a",
        legal_name: "Aster Industrial",
        identity_evidence_ids: ["evidence-a"],
      },
    ],
    claims: [{ supplier_entity_id: "entity-a", evidence_ids: ["evidence-a"] }],
    evidence_sources: [
      { evidence_id: "evidence-a", source_url: linkedProfile },
    ],
    checkpoints: [],
    continuation: {
      roster: [],
      evidence: [],
      remaining_gaps: [],
      retrieved: [
        [
          linkedProfile,
          {
            url: linkedProfile,
            text: "Old supplier profile",
            content_sha256: "a".repeat(64),
            retrieved_at: oldTime,
          },
        ],
      ],
      method_reviews: [],
    },
  };
}
function checkpoint(changes = {}) {
  return {
    phase: "source_retrieval",
    state: "completed",
    started_at: startedAt,
    completed_at: completedAt,
    evidence_urls: [linkedProfile],
    content_sha256: "a".repeat(64),
    ...changes,
  };
}
function method(changes = {}) {
  return {
    method: "public_social",
    round_number: 2,
    status: "references_found",
    searched_at: startedAt,
    lead_ids: ["entity-a"],
    sources: [
      {
        url: linkedProfile,
        title: "Profile",
        excerpt: "Aster Industrial",
        access: "retrieved",
        retrieved_at: completedAt,
      },
    ],
    limitations: [],
    ...changes,
  };
}

test(`${scope} old retrieved sources remain linked but do not become this-round reviewed profiles`, () => {
  const result = fixture();
  const before = structuredClone(result);
  const checks = buildPublicSocialChecks(plan, result, recordedAt);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].profile_url, linkedProfile);
  assert.equal(checks[0].status, "not_executed");
  assert.match(
    checks[0].limitation,
    /Previously retained supplier-linked evidence/,
  );
  assert.match(checks[0].limitation, /not a new source retrieval/);
  assert.deepEqual(result, before);
});

test(`${scope} current completed retrieval records reviewed status with its actual checkpoint time`, () => {
  const result = fixture();
  result.checkpoints = [checkpoint()];
  const checks = buildPublicSocialChecks(plan, result, recordedAt);
  assert.equal(checks[0].status, "reviewed");
  assert.equal(checks[0].checked_at, completedAt);
  assert.match(
    checks[0].limitation,
    /does not independently establish corporate profile ownership/,
  );
});

test(`${scope} a failed current original-page refresh overrides retained success without falsely reviewing redirects`, () => {
  const result = fixture();
  result.evidence_sources.push({
    evidence_id: "evidence-b",
    source_url: otherProfile,
  });
  result.claims[0].evidence_ids.push("evidence-b");
  result.checkpoints = [
    checkpoint({
      error: "MB-422-SOURCE-UNAVAILABLE",
      content_sha256: undefined,
      evidence_urls: [linkedProfile, otherProfile],
    }),
  ];
  const checks = buildPublicSocialChecks(plan, result, recordedAt);
  assert.equal(
    checks.find((check) => check.profile_url === linkedProfile).status,
    "access_limited",
  );
  assert.equal(
    checks.find((check) => check.profile_url === otherProfile).status,
    "not_executed",
  );
  assert.match(checks[0].limitation, /Earlier evidence remains retained/);
});

test(`${scope} no current successful checkpoint is inferred from a started, malformed or unrelated step`, () => {
  for (const changes of [
    { state: "started" },
    { content_sha256: undefined },
    { completed_at: undefined },
    { completed_at: oldTime },
    { phase: "verification" },
  ]) {
    const result = fixture();
    result.checkpoints = [checkpoint(changes)];
    assert.equal(
      buildPublicSocialChecks(plan, result, recordedAt)[0].status,
      "not_executed",
    );
  }
});

test(`${scope} current method retrieval can support a supplier-associated URL without broad scope attribution`, () => {
  const result = fixture();
  result.candidates.push({
    supplier_entity_id: "entity-b",
    legal_name: "Unrelated Industrial",
    identity_evidence_ids: [],
  });
  result.continuation.method_reviews = [
    method({ lead_ids: ["entity-a", "entity-b"] }),
  ];
  const checks = buildPublicSocialChecks(plan, result, recordedAt);
  assert.equal(checks[0].status, "reviewed");
  assert.equal(checks[0].checked_at, completedAt);
  assert.equal(checks[1].status, "not_executed");
  assert.equal(checks[1].profile_url, null);
  assert.match(
    checks[1].limitation,
    /Query scope does not prove a source belongs to this company/,
  );
});

test(`${scope} a method reference without accepted supplier association never becomes that supplier's profile`, () => {
  const result = fixture();
  result.continuation.method_reviews = [
    method({
      sources: [
        { url: otherProfile, access: "retrieved", retrieved_at: completedAt },
      ],
    }),
  ];
  const checks = buildPublicSocialChecks(plan, result, recordedAt);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].profile_url, linkedProfile);
  assert.equal(checks[0].status, "not_executed");
});

test(`${scope} previous-round and pre-search retrieval records do not qualify as current method review`, () => {
  for (const saved of [
    method({ round_number: 1 }),
    method({
      sources: [
        { url: linkedProfile, access: "retrieved", retrieved_at: oldTime },
      ],
    }),
    method({ method: "official_institutions" }),
  ]) {
    const result = fixture();
    result.continuation.method_reviews = [saved];
    assert.equal(
      buildPublicSocialChecks(plan, result, recordedAt)[0].status,
      "not_executed",
    );
  }
});

test(`${scope} current citation-only content states its limits without asserting blocked access or ownership`, () => {
  const result = fixture();
  result.continuation.method_reviews = [
    method({
      sources: [
        {
          url: linkedProfile,
          access: "provider_citation_only",
          retrieved_at: null,
        },
      ],
    }),
  ];
  const check = buildPublicSocialChecks(plan, result, recordedAt)[0];
  assert.equal(check.status, "access_limited");
  assert.match(check.limitation, /original page was not retrieved/);
  assert.match(check.limitation, /does not establish that access was blocked/);
});

test(`${scope} social review timing follows new versus legacy approved scope`, () => {
  const result = fixture();
  for (const round of [1, 2, 3])
    assert.deepEqual(
      buildPublicSocialChecks({ round_number: round }, result, recordedAt),
      [],
    );
  for (const round of [4, 5])
    assert.equal(
      buildPublicSocialChecks({ round_number: round }, result, recordedAt)
        .length,
      1,
    );
  assert.deepEqual(
    buildPublicSocialChecks({ ...plan, round_number: 1 }, result, recordedAt),
    [],
  );
  assert.equal(buildPublicSocialChecks(plan, result, recordedAt).length, 1);
});

test(`${scope} unrelated claims, unsafe URLs and lookalike platforms are never supplier social links`, () => {
  const result = fixture();
  result.candidates[0].identity_evidence_ids = [];
  result.claims[0].supplier_entity_id = "excluded-entity";
  result.evidence_sources.push(
    {
      evidence_id: "unsafe",
      source_url: Object.assign(new URL("https://linkedin.com/company/aster"), {
        username: "synthetic-user",
      }).href,
    },
    {
      evidence_id: "lookalike",
      source_url: "https://linkedin.com.attacker.com/company/aster",
    },
  );
  result.claims.push({
    supplier_entity_id: "entity-a",
    evidence_ids: ["unsafe", "lookalike"],
  });
  result.checkpoints = [checkpoint()];
  const checks = buildPublicSocialChecks(plan, result, recordedAt);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].profile_url, null);
  assert.equal(checks[0].status, "not_executed");
});

test(`${scope} final successful or failed retrieval observation wins without claiming a later cache review`, () => {
  const result = fixture();
  result.checkpoints = [
    checkpoint({
      completed_at: "2026-09-13T10:00:20Z",
      error: "MB-422-SOURCE-UNAVAILABLE",
    }),
    checkpoint(),
  ];
  assert.equal(
    buildPublicSocialChecks(plan, result, recordedAt)[0].status,
    "access_limited",
  );
});
