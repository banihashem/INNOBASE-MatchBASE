import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  CONSULTANT_REPORT_DIMENSIONS,
  CONSULTANT_REPORT_MODEL_VERSION,
  EXPLICIT_EMPTY_TEXT,
  MATCHBASE_BRAND_MANIFEST_V1,
  MATCHBASE_BRAND_MANIFEST_VERSION,
  REPORT_SECTION_REGISTRY,
  assertConsultantDimensionParity,
  canonicalSerialize,
  canonicalSha256,
  composeConsultantReportV1,
  type BudgetedTextV1,
  type ConsultantReportModelV1,
  type ConsultantReportSectionV1,
} from "../src/index.js";

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function text(
  value: string,
  maxCharacters = Array.from(value).length + 32,
): BudgetedTextV1 {
  return { value, max_characters: maxCharacters };
}

function citationReference(url: string) {
  return {
    claim_id: "claim-eligibility-001",
    url,
    retrieval_run_id: "run-001",
  } as const;
}

function modelFixture(): ConsultantReportModelV1 {
  const sections: ConsultantReportSectionV1[] = REPORT_SECTION_REGISTRY.filter(
    ({ status }) => status !== "conditional",
  ).map((definition) => {
    const sourceReferences = [
      {
        source_type: "run_record" as const,
        source_id: "run-001",
        field_path: `sections.${definition.section_id}`,
      },
    ];
    if (definition.status === "required_explicit_empty") {
      const sectionId =
        definition.section_id as keyof typeof EXPLICIT_EMPTY_TEXT;
      return {
        section_id: definition.section_id,
        source_references: sourceReferences,
        blocks: [],
        explicit_empty_reason: EXPLICIT_EMPTY_TEXT[sectionId],
      };
    }
    return {
      section_id: definition.section_id,
      source_references: sourceReferences,
      blocks: [
        {
          kind: "paragraph",
          text: text(
            `Authored and sourced content for ${definition.section_id}.`,
            120,
          ),
        },
      ],
    };
  });

  return {
    schema_version: CONSULTANT_REPORT_MODEL_VERSION,
    brand_manifest_version: MATCHBASE_BRAND_MANIFEST_VERSION,
    document_control: {
      document: text("MatchBASE Consultant Report", 80),
      prepared_by: text("Named Consultant", 80),
      prepared_at: "2026-08-25T08:30:00+00:00",
      classification: text("Confidential", 40),
      status: "For Review",
      basis: text("Canonical request crv-001 and research run run-001", 160),
    },
    lineage: {
      artifact_version: 1,
      generating_run_id: "run-001",
      canonical_request_version_id: "crv-001",
      projection_version_id: "consultant-projection.v1",
      analyst_decision_set_id: "decision-set-001",
      result_sha256: "a".repeat(64),
      template_version: "renderer-neutral-template.v1",
      page_geometry: "a4",
      generated_by_subject_id: "user-001",
      composed_at: "2026-08-25T08:30:00Z",
    },
    scoring_dimensions: CONSULTANT_REPORT_DIMENSIONS.map((dimension) => ({
      ...dimension,
    })),
    sections,
    omitted_conditional_sections: REPORT_SECTION_REGISTRY.filter(
      ({ status }) => status === "conditional",
    ).map((definition) => ({
      section_id: definition.section_id,
      authoritative_condition:
        "authoritative_condition" in definition
          ? definition.authoritative_condition
          : "",
      non_applicability_reason: text(
        `Recorded source state shows that ${definition.section_id} does not apply.`,
        160,
      ),
      source_references: [
        {
          source_type: "gate_outcome",
          source_id: "gate-record-001",
          field_path: `conditional_sections.${definition.section_id}`,
        },
      ],
    })),
    claims: [
      {
        claim_id: "claim-eligibility-001",
        assertion: text(
          "The candidate satisfies the recorded eligibility gate.",
          160,
        ),
        materiality: "eligibility",
        high_risk: true,
        section_ids: ["SEC-11.2", "SEC-09"],
      },
      {
        claim_id: "claim-context-001",
        assertion: text(
          "The request was reviewed against the recorded run inputs.",
          160,
        ),
        materiality: "context",
        high_risk: false,
        section_ids: ["SEC-04"],
      },
    ],
    citations: [
      {
        claim_id: "claim-eligibility-001",
        url: "https://register.example.invalid/evidence/eligibility",
        publisher: text("Example Official Register", 120),
        published_or_updated: text("not stated by source", 40),
        accessed_at: "2026-08-25T08:00:00+00:00",
        source_tier: "official_register",
        verification_status: "externally_verified",
        extracted_support: text(
          "Recorded supporting text for the eligibility claim.",
          240,
        ),
        corroborated_by: [
          citationReference(
            "https://authority.example.test/records/eligibility",
          ),
        ],
        retrieval_run_id: "run-001",
      },
      {
        claim_id: "claim-eligibility-001",
        url: "https://authority.example.test/records/eligibility",
        publisher: text("Independent Public Authority", 120),
        published_or_updated: text("2026-08-20T12:00:00Z", 40),
        accessed_at: "2026-08-25T08:01:00Z",
        source_tier: "official_register",
        verification_status: "externally_verified",
        extracted_support: text(
          "Independent corroborating eligibility record.",
          240,
        ),
        corroborated_by: [],
        retrieval_run_id: "run-001",
      },
    ],
  };
}

function mutableFixture(): Mutable<ConsultantReportModelV1> {
  return structuredClone(modelFixture()) as Mutable<ConsultantReportModelV1>;
}

function failuresFor(input: unknown) {
  const result = composeConsultantReportV1(input);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected composition failure");
  return result.failures;
}

test("registry records exact conditional rules and explicit-empty texts", () => {
  assert.deepEqual(
    REPORT_SECTION_REGISTRY.filter(
      ({ status }) => status === "conditional",
    ).map((definition) => [
      definition.section_id,
      "authoritative_condition" in definition
        ? definition.authoritative_condition
        : undefined,
    ]),
    [
      [
        "SEC-03.4",
        "The engagement poses a determinable question and gate outcomes plus analyst determination answer it",
      ],
      [
        "SEC-05.2",
        "A hard-constraint contradiction was detected during this engagement",
      ],
      [
        "SEC-05.4",
        "A correction was proposed with evidence and adopted by an analyst",
      ],
      [
        "SEC-07",
        "The domain pack defines a mandatory regulatory route for the destination",
      ],
      [
        "SEC-08",
        "Public market context materially informs the shortlist and citable evidence exists",
      ],
      [
        "SEC-09.3",
        "Fewer than three eligible candidates survived, or the eligible set was truncated at the cap",
      ],
    ],
  );
  assert.deepEqual(EXPLICIT_EMPTY_TEXT, {
    "SEC-05.3": "No further data is outstanding for RFQ issue",
    "SEC-12": "No reserve candidates were identified",
    "SEC-20": "No source was excluded after validation",
  });
});

test("brand manifest contains binding palette and explicit unresolved state", () => {
  assert.deepEqual(MATCHBASE_BRAND_MANIFEST_V1.tokens.color, {
    brand_red: "#FD4140",
    primary_text: "#22252C",
    secondary_text: "#3D4049",
    muted: "#6E727C",
    reverse: "#FFFFFF",
    cover_text: "#1B1B1B",
    small_red_text: {
      state: "unresolved",
      decision_id: "OD-TIER-057",
      candidates: ["#C4292A", "#D42B2A"],
    },
    cover_field_background: { state: "unresolved", value: null },
    reverse_header_fill: { state: "unresolved", value: null },
  });
  assert.deepEqual(MATCHBASE_BRAND_MANIFEST_V1.tokens.spacing, {
    state: "unresolved",
  });
  assert.deepEqual(MATCHBASE_BRAND_MANIFEST_V1.assets, []);
  assert.equal(
    MATCHBASE_BRAND_MANIFEST_V1.tokens.typography.embedding_license.state,
    "unresolved",
  );
  assert.equal(MATCHBASE_BRAND_MANIFEST_V1.asset_license.state, "unresolved");
});

test("foundation preflight never claims full artifact G14", () => {
  assertConsultantDimensionParity();
  const result = composeConsultantReportV1(modelFixture());
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected composition success");
  assert.equal(result.value.full_artifact_g14.outcome, "not_evaluated");
  assert.equal(result.value.full_artifact_g14.release_blocked, true);
  assert.equal(result.value.authoritative_hand05.outcome, "not_evaluated");
  assert.equal(result.value.authoritative_hand05.release_blocked, true);
  assert.equal(
    result.value.foundation_check_results.some(
      ({ gate_id }) => gate_id === "LINEAGE_PREFLIGHT",
    ),
    true,
  );
  assert.equal(
    result.value.foundation_check_results.some(
      ({ gate_id }) => (gate_id as string) === "G14",
    ),
    false,
  );
  assert.equal(
    createHash("sha256")
      .update(result.value.canonical_model, "utf8")
      .digest("hex"),
    result.value.model_sha256,
  );
  assert.equal(result.value.hash_relationship.hashed_value, "canonical_model");
});

test("omitted conditionals require exact condition, source, and reason", () => {
  const missing = mutableFixture();
  missing.omitted_conditional_sections.pop();
  assert.ok(
    failuresFor(missing).some(
      ({ code }) =>
        code === "conditional_omission_requires_exact_condition_sourced_reason",
    ),
  );

  const wrongCondition = mutableFixture();
  wrongCondition.omitted_conditional_sections[0]!.authoritative_condition =
    "An invented condition.";
  assert.ok(
    failuresFor(wrongCondition).some(
      ({ code }) =>
        code === "conditional_omission_requires_exact_condition_sourced_reason",
    ),
  );

  const sourceLess = mutableFixture();
  sourceLess.omitted_conditional_sections[0]!.source_references.length = 0;
  assert.ok(
    failuresFor(sourceLess).some(
      ({ code, kind }) =>
        code ===
          "conditional_omission_requires_exact_condition_sourced_reason" &&
        kind === "missing_source",
    ),
  );
});

test("R/E sections accept only their canonical explicit-empty text", () => {
  const model = mutableFixture();
  const reserve = model.sections.find(
    ({ section_id }) => section_id === "SEC-12",
  );
  assert.ok(reserve !== undefined);
  reserve.explicit_empty_reason =
    "No further data is outstanding for RFQ issue";
  assert.ok(
    failuresFor(model).some(
      ({ gate_id, section_id }) => gate_id === "G7" && section_id === "SEC-12",
    ),
  );
});

test("G4 enforces high-risk corroboration closure, independence, and tier", () => {
  const missingTarget = mutableFixture();
  missingTarget.citations[0]!.corroborated_by[0]!.url =
    "https://missing.example.invalid/no-record";
  assert.ok(
    failuresFor(missingTarget).some(
      ({ code }) => code === "corroboration_reference_not_closed",
    ),
  );
  assert.ok(
    failuresFor(missingTarget).some(
      ({ code }) =>
        code ===
        "high_risk_claim_lacks_independent_equal_or_higher_corroboration",
    ),
  );

  const samePublisher = mutableFixture();
  samePublisher.citations[1]!.publisher.value =
    samePublisher.citations[0]!.publisher.value;
  assert.ok(
    failuresFor(samePublisher).some(
      ({ code }) => code === "corroborating_source_is_not_independent",
    ),
  );

  const lowerTier = mutableFixture();
  lowerTier.citations[1]!.source_tier = "secondary_commentary";
  lowerTier.citations[1]!.verification_status = "claimed";
  assert.ok(
    failuresFor(lowerTier).some(
      ({ code }) => code === "corroborating_source_tier_is_lower",
    ),
  );
});

test("G4 preserves meaningful source-stated publication text and exact fallback", () => {
  const humanDate = mutableFixture();
  humanDate.citations[0]!.published_or_updated.value = "June 2026";
  const result = composeConsultantReportV1(humanDate);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected human source date to be preserved");
  assert.equal(
    result.value.model.citations.find(
      ({ url }) =>
        url === "https://register.example.invalid/evidence/eligibility",
    )?.published_or_updated.value,
    "June 2026",
  );

  const inexactFallback = mutableFixture();
  inexactFallback.citations[0]!.published_or_updated.value =
    "Not Stated By Source";
  assert.ok(
    failuresFor(inexactFallback).some(
      ({ code }) => code === "invalid_published_or_updated_source_text",
    ),
  );
});

test("G4 rejects duplicate citation identity", () => {
  const duplicate = mutableFixture();
  duplicate.citations.push(structuredClone(duplicate.citations[0]!));
  assert.ok(
    failuresFor(duplicate).some(
      ({ code }) => code === "duplicate_citation_identity",
    ),
  );
});

test("full-citation sorting makes shuffled accepted input byte-identical", () => {
  const original = modelFixture();
  const shuffled = mutableFixture();
  shuffled.sections.reverse();
  shuffled.omitted_conditional_sections.reverse();
  shuffled.claims.reverse();
  shuffled.citations.reverse();
  const first = composeConsultantReportV1(original);
  const second = composeConsultantReportV1(shuffled);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) throw new Error("Expected composition success");
  assert.equal(first.value.canonical_model, second.value.canonical_model);
  assert.equal(first.value.model_sha256, second.value.model_sha256);
});

test("normalized model is deeply frozen without freezing caller input", () => {
  const input = mutableFixture();
  const result = composeConsultantReportV1(input);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected composition success");
  assert.equal(Object.isFrozen(result.value.model), true);
  assert.equal(Object.isFrozen(result.value.model.sections), true);
  assert.equal(Object.isFrozen(result.value.model.sections[0]!.blocks), true);
  const firstBlock = result.value.model.sections[0]!.blocks[0];
  assert.ok(firstBlock?.kind === "paragraph");
  assert.equal(Object.isFrozen(firstBlock.text), true);
  assert.equal(Object.isFrozen(input), false);
  assert.throws(() => {
    (result.value.model.sections as unknown as unknown[]).push({});
  }, TypeError);
});

test("declared-budget preflight enforces caller declaration by code points", () => {
  const model = mutableFixture();
  const cover = model.sections.find(
    ({ section_id }) => section_id === "SEC-00",
  );
  assert.ok(cover?.blocks[0]?.kind === "paragraph");
  cover.blocks[0].text = text("😀😀", 1);
  assert.ok(
    failuresFor(model).some(
      ({ gate_id, code }) =>
        gate_id === "DECLARED_BUDGET_PREFLIGHT" &&
        code === "declared_content_length_budget_exceeded",
    ),
  );
});

test("large caller-declared budget never produces authoritative HAND-05 pass", () => {
  const model = mutableFixture();
  const cover = model.sections.find(
    ({ section_id }) => section_id === "SEC-00",
  );
  assert.ok(cover?.blocks[0]?.kind === "paragraph");
  cover.blocks[0].text = text("x".repeat(100_000), 100_000);
  const result = composeConsultantReportV1(model);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected declared-budget preflight success");
  assert.equal(result.value.authoritative_hand05.outcome, "not_evaluated");
  assert.equal(result.value.authoritative_hand05.release_blocked, true);
  assert.equal(
    result.value.foundation_check_results.some(
      ({ gate_id }) => (gate_id as string) === "HAND-05",
    ),
    false,
  );
  assert.equal(
    result.value.foundation_check_results.some(
      ({ gate_id, outcome }) =>
        gate_id === "DECLARED_BUDGET_PREFLIGHT" && outcome === "pass",
    ),
    true,
  );
});

test("HAND-09 rejects HTML and script-like markup before rendering", () => {
  const model = mutableFixture();
  const cover = model.sections.find(
    ({ section_id }) => section_id === "SEC-00",
  );
  assert.ok(cover?.blocks[0]?.kind === "paragraph");
  cover.blocks[0].text = text(
    "<script>globalThis.compromised=true</script>",
    120,
  );
  assert.ok(
    failuresFor(model).some(
      ({ gate_id, code }) =>
        gate_id === "HAND-09" && code === "html_or_model_markup_rejected",
    ),
  );
});

test("G6 rejects dimension or weight drift from contracts", () => {
  const model = mutableFixture();
  (model.scoring_dimensions[0] as { weight: number }).weight = 24;
  assert.ok(
    failuresFor(model).some(
      ({ gate_id, code }) =>
        gate_id === "G6" && code === "charter_dimension_mismatch",
    ),
  );
});

test("G7 rejects missing required sections and source-less content", () => {
  const missing = mutableFixture();
  missing.sections.splice(
    missing.sections.findIndex(({ section_id }) => section_id === "SEC-18"),
    1,
  );
  assert.ok(
    failuresFor(missing).some(
      ({ code, section_id }) =>
        code === "missing_required_section" && section_id === "SEC-18",
    ),
  );
  const sourceLess = mutableFixture();
  sourceLess.sections[0]!.source_references.length = 0;
  assert.ok(
    failuresFor(sourceLess).some(
      ({ kind, code }) =>
        kind === "missing_source" && code === "missing_source_reference",
    ),
  );
});

test("lineage preflight rejects malformed digest and calendar timestamp", () => {
  const model = mutableFixture();
  model.lineage.result_sha256 = "not-a-digest";
  model.lineage.composed_at = "2026-02-30T00:00:00Z";
  const failures = failuresFor(model);
  assert.ok(
    failures.some(
      ({ gate_id, code }) =>
        gate_id === "LINEAGE_PREFLIGHT" && code === "invalid_result_sha256",
    ),
  );
  assert.ok(
    failures.some(
      ({ gate_id, code }) =>
        gate_id === "LINEAGE_PREFLIGHT" && code === "invalid_composed_at",
    ),
  );
});

test("canonical serializer rejects values outside its closed domain", () => {
  assert.throws(() => canonicalSerialize({ value: undefined }), /Non-JSON/u);
  assert.throws(() => canonicalSerialize({ value: Number.NaN }), /Non-finite/u);
  assert.throws(() => canonicalSerialize({ value: new Date() }), /Non-plain/u);
  const sparse: number[] = [];
  sparse.length = 1;
  assert.throws(() => canonicalSerialize(sparse), /Sparse array/u);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalSerialize(cyclic), /Cyclic/u);
});

test("canonical hash is process timezone and locale independent", () => {
  const moduleUrl = new URL("../src/index.js", import.meta.url).href;
  const payload = JSON.stringify({
    z: "İstanbul",
    a: 1.25,
    nested: { b: true, a: null },
  });
  const script = `import { canonicalSha256 } from ${JSON.stringify(moduleUrl)}; process.stdout.write(canonicalSha256(JSON.parse(process.env.REPORT_PAYLOAD)));`;
  const run = (timezone: string, locale: string) =>
    spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        TZ: timezone,
        LANG: locale,
        REPORT_PAYLOAD: payload,
      },
    });
  const utc = run("UTC", "C");
  const tehran = run("Asia/Tehran", "fa_IR.UTF-8");
  assert.equal(utc.status, 0, utc.stderr);
  assert.equal(tehran.status, 0, tehran.stderr);
  assert.equal(utc.stdout, tehran.stdout);
  assert.equal(utc.stdout, canonicalSha256(JSON.parse(payload)));
});
