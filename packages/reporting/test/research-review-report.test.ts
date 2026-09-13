import assert from "node:assert/strict";
import test from "node:test";
import {
  GOLDEN_SCENARIO_V3_01,
  type ResearchReview,
} from "@matchbase/contracts";
import { generateConsultantLandscapeHtml } from "../src/consultant-landscape-report.js";

function review(): ResearchReview {
  return {
    version: "research-review.v1",
    round_number: 4,
    leads: [
      {
        lead_id: "lead-a",
        name: "Incomplete & Company",
        source_urls: ["https://supplier.example/services"],
        status: "needs_review",
        reason: "Destination capability unresolved.",
        missing_evidence: ["Dated operating record"],
        first_seen_round: 2,
        last_seen_round: 4,
      },
    ],
    summary: { discovered: 4, documented: 3, needs_review: 1, excluded: 0 },
    changes: { new_leads: 1, promoted: 2 },
    coverage_gaps: ["Two similar entity names remain unresolved."],
    evidence_memory: {
      version: "research-evidence-memory.v1",
      round_number: 4,
      entities: [{ lead_id: "lead-a", name: "Incomplete & Company" }],
      source_urls: ["https://supplier.example/services"],
      facts: [],
      relationships: [
        {
          insight_id: "insight-a",
          kind: "shared_source",
          statement: "Both directory entries repeat the same marketing claim.",
          lead_ids: ["lead-a"],
          source_urls: ["https://supplier.example/services"],
          next_question: "Does the registry identify separate legal entities?",
          status: "research_hypothesis",
        },
      ],
      limitations: ["Shared sources are not independent corroboration."],
    },
    method_reviews: [
      {
        method: "official_institutions",
        round_number: 4,
        status: "incomplete",
        searched_at: "2026-09-13T10:00:00Z",
        lead_ids: ["lead-a"],
        sources: [
          {
            url: "https://registry.example/record",
            title: "Registry search result",
            excerpt: "<script>entity claim</script>",
            retrieved_at: null,
            access: "provider_citation_only",
          },
        ],
        limitations: ["No company-level customs record was accessible."],
      },
    ],
  };
}

test("MB-UX-QUALITY-001 L11 exports hypotheses, sources, incomplete leads and limitations without upgrading evidence", () => {
  const output = { ...GOLDEN_SCENARIO_V3_01, research_review: review() };
  const before = structuredClone(output);
  const html = generateConsultantLandscapeHtml(output);
  assert.match(html, /id="research-review"/);
  assert.match(html, /Does the registry identify separate legal entities\?/);
  assert.match(html, /Research hypothesis - verification required/);
  assert.match(html, /not established company, ownership or capability facts/);
  assert.match(
    html,
    /Search-provider citation only - full content not retrieved/,
  );
  assert.match(html, /No company-level customs record was accessible/);
  assert.match(html, /Shared sources are not independent corroboration/);
  assert.match(html, /Incomplete &amp; Company/);
  assert.match(html, /Destination capability unresolved/);
  assert.match(html, /1 new leads; 2 promoted/);
  assert.match(html, /href="https:\/\/registry.example\/record"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;entity claim&lt;\/script&gt;/);
  assert.deepEqual(output, before);
});

test("MB-UX-QUALITY-001 L11 exports only safe public reference links", () => {
  const data = review();
  data.method_reviews![0]!.sources[0]!.url = Object.assign(
    new URL("https://registry.example/record"),
    { username: "synthetic-user" },
  ).href;
  data.evidence_memory!.relationships[0]!.source_urls = [
    "javascript:alert(1)",
    "data:text/html,<script>bad</script>",
  ];
  const html = generateConsultantLandscapeHtml({
    ...GOLDEN_SCENARIO_V3_01,
    research_review: data,
  });
  assert.doesNotMatch(
    html,
    /href="(?:javascript:|data:|https:\/\/name:secret@)/,
  );
  assert.doesNotMatch(html, /name:secret/);
  assert.match(html, /Source link unavailable/);
});

test("MB-UX-QUALITY-001 L11 retains original-language sources without claiming an English translation", () => {
  const data = review();
  const original = "\u0645\u0646\u0628\u0639 \u0631\u0633\u0645\u06cc";
  data.method_reviews![0]!.sources[0]!.title = original;
  data.method_reviews![0]!.sources[0]!.excerpt = original;
  const html = generateConsultantLandscapeHtml({
    ...GOLDEN_SCENARIO_V3_01,
    research_review: data,
  });
  assert.doesNotMatch(html, /[\u0600-\u06ff]/);
  assert.match(
    html,
    /Original-language detail retained in saved research; English interpretation unavailable/,
  );
  assert.equal(data.method_reviews![0]!.sources[0]!.excerpt, original);
  assert.match(html, /href="https:\/\/registry.example\/record"/);
});

test("MB-UX-QUALITY-001 L11 historical reports do not invent progressive method reviews", () => {
  const html = generateConsultantLandscapeHtml(GOLDEN_SCENARIO_V3_01);
  assert.doesNotMatch(html, /id="research-review"/);
  const legacy = review();
  delete legacy.evidence_memory;
  delete legacy.method_reviews;
  const saved = generateConsultantLandscapeHtml({
    ...GOLDEN_SCENARIO_V3_01,
    research_review: legacy,
  });
  assert.match(
    saved,
    /No dedicated method review was retained with this historical result/,
  );
  assert.doesNotMatch(saved, /Company register search completed/);
});
