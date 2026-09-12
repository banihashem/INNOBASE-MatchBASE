import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, test } from "node:test";
import {
  buildResearchReview,
  collectResearchLeads,
  hydrateResearchContinuation,
} from "../../../packages/application/dist/research-review.js";

beforeEach((t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error(
      "Review projection must not call a provider or retrieve a page.",
    );
  });
});

const indexed = (name, source = "https://directory.example.org/companies") => ({
  legal_name: name,
  anchor_quote: `${name} appears in the observed directory.`,
  source_urls: [source],
});
const continuation = (overrides = {}) => ({
  roster: [],
  evidence: [],
  retrieved: [],
  remaining_gaps: [],
  ...overrides,
});
function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
const record = (name, overrides = {}) => ({
  legal_name: name,
  country: "Unknown",
  headquarters: "Unknown",
  website: null,
  supplier_type: "unknown",
  manufacturer_status: "unknown",
  identity: {
    status: "unknown",
    source_urls: [],
    quote: `${name} was observed.`,
  },
  product_name: "Industrial pump",
  product_family: "Pumps",
  product_origin: "Unknown",
  product: {
    status: "unknown",
    source_urls: [],
    quote: "Published capability unavailable.",
  },
  facts: [],
  certifications: [],
  constraints: [],
  unknowns: ["Capacity is not established."],
  risks: [],
  ...overrides,
});

test("MB-UX-QUALITY-001 L01 retains all indexed names beyond the dossier cap without merging a shared domain", () => {
  const names = Array.from(
    { length: 73 },
    (_, index) => `Observed Company ${index}`,
  );
  const leads = collectResearchLeads(
    [],
    names.map((name) => indexed(name)),
    1,
  );
  const checkpoint = deepFreeze(continuation({ indexed_leads: leads }));
  const review = buildResearchReview(
    checkpoint,
    names.slice(0, 5).map((legal_name) => ({ legal_name })),
    [],
    1,
  );
  assert.equal(leads.length, 73);
  assert.deepEqual(review.summary, {
    discovered: 73,
    documented: 5,
    needs_review: 68,
    excluded: 0,
  });
  assert.deepEqual(
    new Set(review.leads.map((lead) => lead.name)),
    new Set(names.slice(5)),
  );
  assert.ok(
    review.leads.every(
      (lead) =>
        lead.status === "needs_review" && lead.missing_evidence.length > 0,
    ),
  );
  assert.equal(checkpoint.indexed_leads.length, 73);
});

test("MB-UX-QUALITY-001 L01 accumulates five rounds and promotes leads without changing prior snapshots", () => {
  let collected = [];
  let previous;
  const snapshots = [];
  for (let round = 1; round <= 5; round++) {
    const names = Array.from(
      { length: 12 },
      (_, index) => `Company ${(round - 1) * 12 + index}`,
    );
    const observed = names.map((name) => indexed(name));
    if (round > 1)
      observed.push(
        indexed("Company 11", `https://directory.example.org/round-${round}`),
      );
    collected = collectResearchLeads(collected, observed, round);
    const checkpoint = deepFreeze(continuation({ indexed_leads: collected }));
    const dossierNames = Array.from({ length: 5 * round }, (_, index) => ({
      legal_name: `Company ${index}`,
    }));
    const review = buildResearchReview(
      checkpoint,
      dossierNames,
      [],
      round,
      previous,
    );
    assert.equal(review.summary.discovered, 12 * round);
    assert.equal(review.summary.documented, 5 * round);
    assert.equal(review.leads.length, 7 * round);
    assert.equal(review.changes.promoted, round === 1 ? 0 : 5);
    assert.equal(review.changes.new_leads, round === 1 ? 7 : 12);
    assert.equal(
      collected.find((lead) => lead.name === "Company 11").first_seen_round,
      1,
    );
    assert.equal(
      collected.find((lead) => lead.name === "Company 11").last_seen_round,
      round,
    );
    for (const snapshot of snapshots) {
      assert.equal(
        JSON.stringify(snapshot.checkpoint),
        snapshot.checkpointJson,
      );
      assert.equal(JSON.stringify(snapshot.review), snapshot.reviewJson);
    }
    previous = deepFreeze(review);
    snapshots.push({
      checkpoint,
      review,
      checkpointJson: JSON.stringify(checkpoint),
      reviewJson: JSON.stringify(review),
    });
  }
  const lead = collected.find((item) => item.name === "Company 11");
  assert.equal(lead.source_urls.length, 5);
  assert.equal(
    snapshots[0].review.leads.some((item) => item.name === "Company 11"),
    true,
  );
  assert.equal(
    snapshots[4].review.leads.some((item) => item.name === "Company 11"),
    false,
  );
});

test("MB-UX-QUALITY-001 L01 reobserves normalized names with stable identity and copied source arrays", () => {
  const previous = deepFreeze(
    collectResearchLeads([], [indexed("ＡＣＭＥ  Pumps")], 1),
  );
  const current = collectResearchLeads(
    previous,
    [indexed("acme pumps", "https://acme.example.org/about")],
    3,
  );
  assert.equal(current.length, 1);
  assert.equal(current[0].lead_id, previous[0].lead_id);
  assert.equal(current[0].first_seen_round, 1);
  assert.equal(current[0].last_seen_round, 3);
  assert.equal(previous[0].last_seen_round, 1);
  current[0].source_urls.push("https://acme.example.org/new");
  assert.equal(previous[0].source_urls.length, 1);
});

test("MB-UX-QUALITY-001 L01 filters unsafe public links while retaining raw checkpoint evidence", () => {
  const safe = "https://company.example.org/evidence";
  const unsafe = [
    "javascript:alert(1)",
    "file:///private/report",
    "http://localhost/report",
    "http://127.0.0.1/report",
    "https://user:password@company.example.org/report",
    "https://host.internal/report",
  ];
  const candidate = record("Unreviewed Company", {
    website: unsafe[2],
    identity: {
      status: "unknown",
      quote: "Unreviewed Company",
      source_urls: [...unsafe, safe],
    },
    product: {
      status: "unknown",
      quote: "Pump listing",
      source_urls: [safe, ...unsafe],
    },
  });
  const raw = deepFreeze(
    continuation({
      indexed_leads: collectResearchLeads(
        [],
        [{ ...indexed(candidate.legal_name), source_urls: [...unsafe, safe] }],
        1,
      ),
      roster: [["company", candidate]],
    }),
  );
  const review = buildResearchReview(raw, [], [], 1);
  assert.deepEqual(review.leads[0].source_urls, [safe]);
  assert.equal("website_url" in review.leads[0], false);
  assert.equal(review.leads[0].status, "needs_review");
  assert.deepEqual(raw.indexed_leads[0].source_urls, [...unsafe, safe]);
});

test("MB-UX-QUALITY-001 L01 excludes only a grounded mandatory mismatch and keeps unknown or commercial gaps incomplete", () => {
  const url = "https://maker.example.org/specifications";
  const quote = "Maximum supported pressure is 4 bar.";
  const requirement = "Operating pressure at least 10 bar";
  const proof = {
    constraint: requirement,
    dimension: "product",
    status: "unmet",
    quote,
    source_urls: [url],
  };
  const rows = [
    record("Evidence Conflict", { constraints: [proof] }),
    record("Unverified Conflict", {
      constraints: [
        {
          ...proof,
          source_urls: ["https://uncited.example.org/specifications"],
        },
      ],
    }),
    record("Unknown Capability", {
      constraints: [{ ...proof, status: "unknown" }],
    }),
    record("Commercial Gap", {
      constraints: [{ ...proof, dimension: "price" }],
    }),
  ];
  const review = buildResearchReview(
    continuation({
      roster: rows.map((candidate, index) => [`candidate-${index}`, candidate]),
      evidence: [
        [
          url,
          {
            source: {
              source_url: url,
              source_type: "official_website",
              excerpt_summary: quote,
            },
            native_citation: { url, content: quote },
            authoritative_text: quote,
          },
        ],
      ],
    }),
    [],
    [requirement],
    2,
  );
  assert.deepEqual(review.summary, {
    discovered: 4,
    documented: 0,
    needs_review: 3,
    excluded: 1,
  });
  assert.equal(
    review.leads.find((lead) => lead.name === "Evidence Conflict").status,
    "excluded",
  );
  assert.match(
    review.leads
      .find((lead) => lead.name === "Evidence Conflict")
      .missing_evidence.join(" "),
    /Mandatory technical or compliance mismatch/,
  );
  for (const name of [
    "Unverified Conflict",
    "Unknown Capability",
    "Commercial Gap",
  ])
    assert.equal(
      review.leads.find((lead) => lead.name === name).status,
      "needs_review",
    );
});

test("MB-UX-QUALITY-001 L01 merges roster-only leads, deduplicates gaps and retains focus analysis", () => {
  const focus = {
    objective: "Check capacity",
    question_summary: "Can this supplier meet volume?",
    priority_lead_ids: [],
    search_tasks: ["Find an official capacity statement"],
    evidence_gaps: ["Capacity"],
    scope_notes: ["No change to approved requirements"],
  };
  const checkpoint = deepFreeze(
    continuation({
      indexed_leads: collectResearchLeads([], [indexed("Indexed Company")], 1),
      roster: [
        ["first", record("Indexed Company")],
        ["second", record("Roster Only Company")],
      ],
      remaining_gaps: ["Capacity", "Price"],
      coverage_gaps: ["Capacity", "Identity"],
      focus_analysis: focus,
    }),
  );
  const review = buildResearchReview(checkpoint, [], [], 2);
  assert.deepEqual(
    review.leads.map((lead) => lead.name),
    ["Indexed Company", "Roster Only Company"],
  );
  assert.deepEqual(review.coverage_gaps, ["Capacity", "Price", "Identity"]);
  assert.deepEqual(review.focus_analysis, focus);
  assert.equal(checkpoint.indexed_leads.length, 1);
});

const legacyRound = (overrides = {}) => ({
  account_id: randomUUID(),
  user_profile_id: randomUUID(),
  run_id: randomUUID(),
  execution_id: randomUUID(),
  classification_id: randomUUID(),
  round_id: randomUUID(),
  round_number: 2,
  status: "completed",
  plan: { focus_requirements: [] },
  continuation: null,
  output: { supplier_candidates: [] },
  ...overrides,
});
const indexText = (candidates) =>
  JSON.stringify({
    candidates,
    remaining_gaps: [],
    evidence_exhausted: false,
    summary: "Observed names only",
  });

test("MB-UX-QUALITY-001 L01 legacy later rounds recover only completed owned ancestors with original observation rounds", async () => {
  const parent = legacyRound({ round_number: 1 });
  const current = legacyRound({
    ...parent,
    round_id: randomUUID(),
    execution_id: randomUUID(),
    round_number: 2,
    plan: { focus_requirements: [], parent_round_id: parent.round_id },
  });
  const original = structuredClone([parent, current]);
  const queries = [];
  const db = {
    async query(sql, values) {
      queries.push(values);
      if (sql.includes("FROM consultant_research_round")) {
        assert.deepEqual(values, [
          parent.round_id,
          current.account_id,
          current.run_id,
          current.user_profile_id,
          current.classification_id,
          1,
        ]);
        assert.ok(sql.includes("status='completed'"));
        assert.ok(sql.includes("output IS NOT NULL"));
        return { rows: [parent] };
      }
      assert.deepEqual(values.slice(0, 2), [
        current.account_id,
        current.run_id,
      ]);
      assert.ok(
        [parent.execution_id, current.execution_id].includes(values[2]),
      );
      const names =
        values[2] === parent.execution_id
          ? ["Hidden Earlier", "Observed Twice"]
          : ["Hidden Later", "Observed Twice"];
      return {
        rows: [
          {
            phase: "discovery_openai",
            detail: {
              state: "completed",
              response_content: names
                .map((name) => `${name} makes pumps.`)
                .join(" "),
            },
          },
          {
            phase: "discovery_openai_extraction_index",
            detail: {
              state: "completed",
              response_content: indexText(names.map((name) => indexed(name))),
            },
          },
        ],
      };
    },
  };
  const hydrated = await hydrateResearchContinuation(db, current);
  assert.deepEqual(
    hydrated.indexed_leads.map((lead) => [
      lead.name,
      lead.first_seen_round,
      lead.last_seen_round,
    ]),
    [
      ["Hidden Earlier", 1, 1],
      ["Observed Twice", 1, 2],
      ["Hidden Later", 2, 2],
    ],
  );
  assert.equal(queries.length, 3);
  assert.deepEqual([parent, current], original);
});

test("MB-UX-QUALITY-001 L01 historical projection admits only native-grounded names within the exact account/run/execution", async () => {
  const url = "https://observed.example.org/about";
  const round = deepFreeze(
    legacyRound({
      continuation: continuation({
        retrieved: [
          [
            url,
            {
              url,
              text: "Retrieved Company manufactures pumps.",
              content_sha256: "fixture",
              retrieved_at: "2026-09-11T00:00:00Z",
            },
          ],
        ],
      }),
    }),
  );
  const scoped = [
    {
      phase: "discovery_gemini",
      detail: {
        state: "completed",
        response_content: "Native Company offers industrial pumps.",
        response_citations: [
          {
            url,
            title: "Observed supplier source",
            content_excerpt: "Citation Company is mentioned by this source.",
          },
        ],
      },
    },
    {
      phase: "synthesis",
      detail: { response_content: "Synthesis Invented Company" },
    },
    {
      phase: "verification_extraction",
      detail: { response_content: "Extraction Invented Company" },
    },
    {
      phase: "discovery_extraction_index",
      detail: {
        state: "completed",
        response_content: indexText([
          {
            legal_name: "Native Company",
            anchor_quote: "A fabricated marketing promise by Native Company",
            source_urls: [url, "https://uncited.example.org/invented"],
          },
          indexed("Citation Company", url),
          indexed("Retrieved Company", url),
          indexed("Synthesis Invented Company", url),
          indexed("Extraction Invented Company", url),
          indexed("Outside Account Company", url),
          indexed("Outside Run Company", url),
          indexed("Outside Execution Company", url),
        ]),
      },
    },
    {
      phase: "verification_extraction_index",
      detail: { response_content: "{ truncated JSON" },
    },
  ].map((event) => ({
    ...event,
    account_id: round.account_id,
    run_id: round.run_id,
    execution_id: round.execution_id,
  }));
  const unrelated = ["account_id", "run_id", "execution_id"].map(
    (field, index) => ({
      account_id: round.account_id,
      run_id: round.run_id,
      execution_id: round.execution_id,
      [field]: randomUUID(),
      phase: "discovery_gemini",
      detail: {
        response_content: [
          "Outside Account Company",
          "Outside Run Company",
          "Outside Execution Company",
        ][index],
      },
    }),
  );
  let reads = 0;
  const db = {
    async query(sql, values) {
      reads++;
      assert.match(
        sql,
        /WHERE account_id=\$1 AND run_id=\$2 AND execution_id=\$3/,
      );
      assert.match(sql, /ORDER BY event_id/);
      assert.deepEqual(values, [
        round.account_id,
        round.run_id,
        round.execution_id,
      ]);
      return {
        rows: [...scoped, ...unrelated].filter(
          (event) =>
            event.account_id === values[0] &&
            event.run_id === values[1] &&
            event.execution_id === values[2],
        ),
      };
    },
  };
  const hydrated = await hydrateResearchContinuation(db, round);
  assert.equal(reads, 1);
  assert.deepEqual(
    hydrated.indexed_leads.map((lead) => lead.name),
    ["Native Company", "Citation Company", "Retrieved Company"],
  );
  assert.equal(
    hydrated.indexed_leads[0].anchor_quote,
    "Native Company offers industrial pumps.",
  );
  assert.deepEqual(hydrated.indexed_leads[0].source_urls, [url]);
  assert.ok(
    hydrated.indexed_leads.every(
      (lead) => lead.first_seen_round === 2 && lead.last_seen_round === 2,
    ),
  );
  assert.equal(round.continuation.indexed_leads, undefined);
  assert.deepEqual(hydrated.retrieved, round.continuation.retrieved);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("MB-UX-QUALITY-001 L01 hydration reuses and deep-copies an existing lead snapshot without historical reads", async () => {
  for (const leads of [
    [],
    collectResearchLeads([], [indexed("Retained Company")], 1),
  ]) {
    const round = deepFreeze(
      legacyRound({ continuation: continuation({ indexed_leads: leads }) }),
    );
    const hydrated = await hydrateResearchContinuation(
      {
        query() {
          throw new Error("Existing checkpoint must not be reconstructed.");
        },
      },
      round,
    );
    assert.deepEqual(hydrated, round.continuation);
    assert.notEqual(hydrated, round.continuation);
    hydrated.indexed_leads.push({ lead_id: "new" });
    assert.equal(round.continuation.indexed_leads.length, leads.length);
    if (leads.length) {
      hydrated.indexed_leads[0].source_urls.push(
        "https://changed.example.org/new",
      );
      assert.equal(round.continuation.indexed_leads[0].source_urls.length, 1);
    }
  }
});

test("MB-UX-QUALITY-001 L01 corrupt historical indexes cannot self-ground a supplier", async () => {
  const round = legacyRound();
  const rows = [
    {
      phase: "discovery_extraction_index",
      detail: {
        state: "completed",
        response_content: indexText([indexed("Invented Company")]),
      },
    },
    {
      phase: "verification_extraction_index",
      detail: { state: "completed", response_content: "not JSON" },
    },
    {
      phase: "verification_extraction_index",
      detail: { state: "completed", response_content: "{}" },
    },
  ];
  const hydrated = await hydrateResearchContinuation(
    {
      async query() {
        return { rows };
      },
    },
    round,
  );
  assert.deepEqual(hydrated.indexed_leads, []);
  assert.equal(round.continuation, null);
});

test("MB-UX-QUALITY-001 L01 hydrates roster-only lead IDs for both legacy and current planner continuations", async () => {
  for (const mode of ["legacy", "current-empty", "current-indexed"]) {
    const oldLead = collectResearchLeads(
      [],
      [indexed("Previously Indexed")],
      1,
    );
    const raw = continuation({
      roster: [
        ["known", record("Previously Indexed")],
        ["roster-only", record("Roster Only")],
      ],
      ...(mode === "legacy"
        ? {}
        : { indexed_leads: mode === "current-indexed" ? oldLead : [] }),
    });
    const round = deepFreeze(legacyRound({ continuation: raw }));
    let reads = 0;
    const hydrated = await hydrateResearchContinuation(
      {
        async query() {
          reads++;
          assert.equal(mode, "legacy");
          return { rows: [] };
        },
      },
      round,
    );
    assert.equal(reads, mode === "legacy" ? 1 : 0);
    const review = buildResearchReview(raw, [], [], round.round_number);
    assert.deepEqual(
      new Set(hydrated.indexed_leads.map((lead) => lead.lead_id)),
      new Set(review.leads.map((lead) => lead.lead_id)),
      "Every exposed lead ID must be available in the next-round planner checkpoint.",
    );
    assert.equal(hydrated.indexed_leads.length, 2);
    if (mode === "current-indexed") {
      assert.equal(hydrated.indexed_leads[0].first_seen_round, 1);
      assert.equal(hydrated.indexed_leads[0].last_seen_round, 1);
      assert.equal(raw.indexed_leads.length, 1);
    } else assert.equal(raw.indexed_leads?.length ?? 0, 0);
    assert.equal(
      hydrated.indexed_leads.find((lead) => lead.name === "Roster Only")
        .first_seen_round,
      2,
    );
  }
});

test("MB-UX-QUALITY-001 L01 malformed historical index members do not discard grounded peers", async () => {
  const round = legacyRound();
  const rows = [
    {
      phase: "discovery_gemini",
      detail: {
        state: "completed",
        response_content: "Retained Peer makes pumps.",
      },
    },
    {
      phase: "discovery_extraction_index",
      detail: {
        state: "completed",
        response_content: indexText([null, indexed("Retained Peer"), 42]),
      },
    },
  ];
  const hydrated = await hydrateResearchContinuation(
    {
      async query() {
        return { rows };
      },
    },
    round,
  );
  assert.deepEqual(
    hydrated.indexed_leads.map((lead) => lead.name),
    ["Retained Peer"],
  );
});

test("MB-UX-QUALITY-001 L08 hydration excludes failed or blocked native authority while preserving completed-index incomplete leads", async () => {
  const goodUrl = "https://retained.example.org/catalog";
  const blockedUrl = "https://blocked.example.org/catalog";
  const rows = deepFreeze([
    {
      phase: "discovery_openai",
      detail: {
        state: "completed",
        finish_reason: "stop",
        native_finish_reason: "STOP",
        response_content:
          "Pending Dossier manufactures pumps. Failed Index Name supplies valves. Started Index Name supplies pipes. Unfinished Index Name supplies fittings.",
        response_citations: [
          {
            url: goodUrl,
            title: "Completed discovery",
            content_excerpt: "Pending Dossier manufactures pumps.",
          },
        ],
      },
    },
    {
      phase: "discovery_gemini",
      detail: {
        state: "failed",
        finish_reason: "error",
        native_finish_reason: "RECITATION",
        response_failure_kind: "refusal",
        response_content: "Blocked Prose Name manufactures pumps.",
        response_citations: [
          {
            url: blockedUrl,
            title: "Blocked response",
            content_excerpt: "Blocked Citation Name supplies valves.",
          },
        ],
      },
    },
    {
      phase: "discovery_deepseek",
      detail: {
        state: "failed",
        finish_reason: "error",
        response_failure_kind: "provider_error",
        response_content: "Provider Error Name manufactures pumps.",
      },
    },
    {
      phase: "verification",
      detail: {
        state: "completed",
        finish_reason: "stop",
        native_finish_reason: "RECITATION",
        response_content: "Mislabelled Blocked Name manufactures pumps.",
      },
    },
    {
      phase: "discovery_openai_extraction_index",
      detail: {
        state: "completed",
        finish_reason: "stop",
        response_content: indexText([
          indexed("Pending Dossier", goodUrl),
          indexed("Blocked Prose Name", blockedUrl),
          indexed("Blocked Citation Name", blockedUrl),
          indexed("Provider Error Name", goodUrl),
          indexed("Mislabelled Blocked Name", blockedUrl),
        ]),
      },
    },
    {
      phase: "discovery_openai_extraction_batch",
      detail: {
        state: "failed",
        finish_reason: "length",
        response_content: "Pending Dossier supplier details are incomplete",
      },
    },
    ...[
      ["failed", "error", "Failed Index Name"],
      ["started", undefined, "Started Index Name"],
      ["completed", "length", "Unfinished Index Name"],
    ].map(([state, finish_reason, name]) => ({
      phase: "discovery_openai_extraction_index",
      detail: {
        state,
        finish_reason,
        response_content: indexText([indexed(name, goodUrl)]),
      },
    })),
  ]);
  const originalEvents = structuredClone(rows);
  const round = deepFreeze(legacyRound({ round_number: 1 }));
  const hydrated = await hydrateResearchContinuation(
    {
      async query(sql, values) {
        assert.match(sql, /^SELECT /);
        assert.deepEqual(values, [
          round.account_id,
          round.run_id,
          round.execution_id,
        ]);
        return { rows };
      },
    },
    round,
  );
  assert.deepEqual(
    hydrated.indexed_leads.map((lead) => lead.name),
    ["Pending Dossier"],
  );
  assert.deepEqual(hydrated.indexed_leads[0].source_urls, [goodUrl]);
  const review = buildResearchReview(hydrated, [], [], 1);
  assert.equal(review.summary.needs_review, 1);
  assert.equal(review.summary.documented, 0);
  assert.equal(review.leads[0].status, "needs_review");
  assert.match(review.leads[0].reason, /not a verified supplier/);
  assert.doesNotMatch(JSON.stringify(hydrated), /Blocked|Provider Error/);
  assert.deepEqual(
    rows,
    originalEvents,
    "Raw failure and partial-response audit history must remain untouched",
  );
  assert.equal(round.continuation, null);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});
