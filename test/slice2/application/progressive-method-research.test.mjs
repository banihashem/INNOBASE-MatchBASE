import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMethodReview,
  recoverableMethodFailure,
} from "../../../packages/application/dist/progressive-method-research.js";
import { LiveResearchError } from "../../../packages/application/dist/openrouter-model-policy.js";

test("MB-UX-QUALITY-001 L11 method references preserve current access, not claimed corporate or registry verification", () => {
  const url = "https://authority.example.org/record",
    other = "https://profile.example.org/company",
    limited = "https://limited.example.org/company";
  const at = "2026-09-13T00:00:00Z";
  const response = {
    citations: [
      { url, title: "Record", content: "Earlier provider excerpt" },
      { url: other, title: "Profile", content: "Company-authored claim" },
      { url: limited, title: "Login" },
      { url: "http://127.0.0.1/private", title: "Unusable" },
    ],
  };
  const review = buildMethodReview(
    "official_institutions",
    { round_number: 4 },
    [],
    at,
    response,
    new Map([
      [url, { text: "Current retrieved text", retrieved_at: at }],
      [limited, null],
    ]),
  );
  assert.equal(review.status, "references_found");
  assert.equal(review.sources.length, 3);
  assert.deepEqual(
    review.sources.map((source) => source.access),
    ["retrieved", "provider_citation_only", "access_limited"],
  );
  assert.equal(review.sources[0].excerpt, "Current retrieved text");
  assert.equal(review.sources[1].retrieved_at, null);
  assert.ok(
    review.limitations.some((entry) =>
      entry.includes("not confirmed corporate profiles"),
    ),
  );
  assert.deepEqual(response.citations[0].content, "Earlier provider excerpt");
});

test("MB-UX-QUALITY-001 L11 supplemental failures never hide permission, persistence, billing or cancellation failures", () => {
  for (const code of [
    "MB-503-LIVE-CHECKPOINT",
    "MB-409-ROUND-ALLOWANCE",
    "MB-409-STAGE-ALLOWANCE",
    "MB-499-LIVE-CANCELLED",
    "MB-422-LIVE-REFUSAL",
    "MB-403-BYOK",
  ]) {
    assert.equal(
      recoverableMethodFailure(new LiveResearchError(code, "Stopped", true)),
      false,
    );
  }
  assert.equal(
    recoverableMethodFailure(
      new LiveResearchError("MB-502-LIVE-PROVIDER", "Access denied", false),
    ),
    false,
  );
  assert.equal(
    recoverableMethodFailure(
      new LiveResearchError("MB-502-LIVE-PROVIDER", "Temporary", true),
    ),
    true,
  );
  assert.equal(
    recoverableMethodFailure(
      new LiveResearchError("MB-422-LIVE-EVIDENCE", "No citations"),
    ),
    true,
  );
  assert.equal(
    recoverableMethodFailure(new Error("Unknown persistence failure")),
    false,
  );
});

test("MB-UX-QUALITY-001 L11 source-free supplemental outcome is an explicit evidence gap, never a negative company finding", () => {
  const review = buildMethodReview(
    "public_social",
    { round_number: 2 },
    [],
    "2026-09-13T00:00:00Z",
    undefined,
    new Map(),
    "MB-422-LIVE-EVIDENCE",
  );
  assert.equal(review.status, "incomplete");
  assert.deepEqual(review.sources, []);
  assert.ok(
    review.limitations.some((entry) => entry.includes("does not establish")),
  );
});
