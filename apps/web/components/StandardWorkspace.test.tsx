import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import { ProductRouter } from "./ProductRouter";
import { CanonicalReview } from "./standard/CanonicalReview";
import { StandardResult } from "./standard/StandardResult";
import { StructuredIntake } from "./standard/StructuredIntake";
import { workspaceJson } from "./standard/api";
import type { StandardResultProjectionV1 } from "./standard/types";

const session = {
  display_name: "Standard Evaluator",
  tier: "standard" as const,
  quota: { limit: 5, used: 1, remaining: 4, next_capacity_at: null },
  execution: { active: 1, capacity: 3 },
  research_mode: {
    id: "synthetic_reference" as const,
    label: "Synthetic reference" as const,
    live_qualified: false,
  },
  csrf_token: "fixture-csrf-value",
  environment: "test" as const,
};

const emptyRequests = {
  schema_version: "standard-request-history.v1",
  items: [],
  synthetic_warning: "Synthetic evaluation data — not a sourcing result",
};
const emptyRuns = {
  schema_version: "standard-run-history.v1",
  items: [],
  synthetic_warning: "Synthetic evaluation data — not a sourcing result",
};

afterEach(() => vi.unstubAllGlobals());

test("routes Standard identity into the owner workspace without changing Demo entry", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/api/v1/me")
        ? session
        : url.includes("/api/v1/requests?")
          ? emptyRequests
          : emptyRuns;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  render(<ProductRouter authPath="/auth/simulator/start" />);
  expect(
    await screen.findByRole("heading", { name: "Requests" }),
  ).toBeVisible();
  expect(
    screen.getByText("Synthetic evaluation data — not a sourcing result"),
  ).toBeVisible();
  expect(screen.getByText("4", { selector: "strong" })).toBeVisible();
  expect(screen.getByText(/1 used/)).toBeVisible();
  expect(screen.getByText(/Next capacity: available now/)).toBeVisible();
  expect(screen.queryByText(/Consultant/i)).not.toBeInTheDocument();
});

test("preserves the server polling cadence on a private 304", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(null, {
          status: 304,
          headers: {
            ETag: '"run-version-2"',
            "MB-Poll-After-Ms": "1750",
          },
        }),
    ),
  );
  await expect(workspaceJson("/api/v1/runs/run-fixture")).resolves.toEqual({
    body: undefined,
    etag: '"run-version-2"',
    notModified: true,
    pollAfterMs: 1750,
  });
});

test("adds multiple independently editable constraints, exclusions, and conditional requirements", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/resolution")
        ? {
            schema_version: "domain-pack-resolution.v1",
            category_id: "synthetic_industrial_components",
            confidence: 1,
            confidence_threshold: 0.8,
            activation_state: "confirmed",
            registry_version: "2026-08-15.1",
            pack_version: "2026-08-15.1",
            activation_token: "signed-activation-token",
          }
        : {
            schema_version: "domain-pack.v1",
            registry_version: "2026-08-15.1",
            pack_version: "2026-08-15.1",
            category_id: "synthetic_industrial_components",
            category_label: "Synthetic Industrial Components",
            macro_parameters: [
              "product_specification",
              "supplier_producer_profile",
              "trade_structure_commercial_execution",
            ],
            core_fields: [
              {
                field_id: "FLD-CORE-PS-01",
                macro_parameter: "product_specification",
                label: "product_category",
                description: "Product category.",
                kind: "text",
                requirement: "required",
                allowed_units: [],
                allowed_values: [],
              },
            ],
            domain_fields: [],
          };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  render(
    <StructuredIntake
      session={session}
      onCanonical={() => undefined}
      onCancel={() => undefined}
    />,
  );
  fireEvent.change(screen.getByLabelText("Source-language input"), {
    target: { value: "Industrial component requirement" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Resolve product category" }),
  );
  expect(
    await screen.findByRole("button", { name: "Add hard constraint" }),
  ).toBeVisible();
  for (let index = 0; index < 2; index += 1) {
    fireEvent.click(
      screen.getByRole("button", { name: "Add hard constraint" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add exclusion" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add conditional requirement" }),
    );
  }
  expect(screen.getAllByText(/^Hard constraint \d+$/u)).toHaveLength(2);
  expect(screen.getByLabelText("Exclusion 1")).toBeVisible();
  expect(screen.getByLabelText("Exclusion 2")).toBeVisible();
  expect(screen.getAllByText(/^Conditional requirement \d+$/u)).toHaveLength(2);
});

test("fails closed when identity resolution fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 500 })),
  );
  render(<ProductRouter authPath="/auth/simulator/start" />);
  expect(
    await screen.findByRole("heading", { name: "Identity resolution failed." }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Continue with Google" }),
  ).not.toBeInTheDocument();
});

const result: StandardResultProjectionV1 = {
  schema_version: "standard-result-projection.v1",
  run_id: "run-fixture",
  outcome: "matched",
  scarcity: "limited",
  projection_version: 3,
  synthetic_warning: "Synthetic evaluation data — not a sourcing result",
  gate_eliminations: [
    { gate_id: "gate-1", label: "Hard constraints", eliminated_count: 2 },
  ],
  limitations: {
    unknown_count: 1,
    not_asked_count: 2,
    affected_low_confidence_dimensions: ["price_tier_fit"],
    evidence_states: ["claimed", "stale"],
    restricted_party_screening_notice:
      "No restricted-party screening was performed.",
    advisory_boundary: "Independent verification remains required.",
  },
  candidates: [
    {
      display_name: "Synthetic Industrial Candidate",
      country_code: "XZ",
      rationale_extended:
        "A deterministic fixture rationale with bounded evidence.",
      compatibility_score: 78,
      fit_band: "strong_fit",
      band_ceiling: "potential_fit",
      displayed_band: "potential_fit",
      band_ceiling_reason: "Critical evidence confidence cap",
      dimension_scores: [
        {
          dimension_id: "category_product_fit",
          weight: 25,
          score: 90,
          confidence: "high",
        },
        {
          dimension_id: "compliance_certification_fit",
          weight: 20,
          score: 70,
          confidence: "medium",
        },
        {
          dimension_id: "volume_capacity_fit",
          weight: 15,
          score: 80,
          confidence: "medium",
        },
        {
          dimension_id: "price_tier_fit",
          weight: 15,
          score: 75,
          confidence: "low",
        },
        {
          dimension_id: "positioning_brand_fit",
          weight: 15,
          score: 76,
          confidence: "medium",
        },
        {
          dimension_id: "geographic_reach_fit",
          weight: 10,
          score: 74,
          confidence: "medium",
        },
      ],
      positive_drivers: [
        {
          dimension_id: "category_product_fit",
          explanation: "Category fit is strong.",
          claim_id: "claim-1",
          evidence_ids: ["evidence-1"],
        },
      ],
      limiting_gaps: [
        {
          dimension_id: "price_tier_fit",
          explanation: "Price evidence is stale.",
          claim_id: "claim-2",
          evidence_ids: ["evidence-1"],
        },
      ],
      citations: [
        {
          evidence_id: "evidence-1",
          fixture_identity: "fixture://candidate/1",
          title: "Synthetic candidate record",
          publisher: "MatchBASE fixtures",
          published_or_updated: "2026-08-01",
          accessed_at: "2026-08-15",
          source_tier: "primary",
          status: "stale",
          access_state: "available",
          extract: "Synthetic support text.",
          content_sha256: "a".repeat(64),
          provenance: "synthetic_fixture",
        },
      ],
      freshness: "stale",
      verification_status: "claimed",
      evidence_confidence: "medium",
    },
  ],
};

test("renders the closed Standard projection and no arithmetic probability language", async () => {
  render(<StandardResult result={result} onBack={() => undefined} />);
  expect(
    screen.getByRole("heading", { name: "Responsible candidate comparison" }),
  ).toBeVisible();
  expect(
    screen.getByRole("region", { name: "Six-dimension candidate comparison" }),
  ).toBeVisible();
  expect(screen.getAllByRole("row")).toHaveLength(7);
  expect(screen.getByText("78")).toBeVisible();
  expect(screen.getByText(/No padding/)).toBeVisible();
  expect(screen.getByText(/not probabilities or guarantees/i)).toBeVisible();
  fireEvent.click(screen.getByText(/Evidence and citations/));
  expect(screen.getByText("Synthetic support text.")).toBeVisible();
  await waitFor(async () =>
    expect(
      (
        await axe.run(document, {
          rules: { "color-contrast": { enabled: false } },
        })
      ).violations,
    ).toEqual([]),
  );
});

test("refuses an oversized projection before rendering candidate data", () => {
  const oversized = {
    ...result,
    candidates: [
      result.candidates[0]!,
      result.candidates[0]!,
      result.candidates[0]!,
      result.candidates[0]!,
    ],
  };
  render(<StandardResult result={oversized} onBack={() => undefined} />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "exceeded the Standard disclosure limit",
  );
  expect(
    screen.queryByText("Synthetic Industrial Candidate"),
  ).not.toBeInTheDocument();
});

test("shows translation confidence and requires an owner contradiction choice without preselection", async () => {
  render(
    <CanonicalReview
      session={session}
      onRun={() => undefined}
      onBack={() => undefined}
      request={{
        schema_version: "structured-standard-request.v1",
        request_id: "10000000-0000-4000-8000-000000000010",
        canonical_version_id: "10000000-0000-4000-8000-000000000011",
        version: 1,
        source_language: "fa",
        canonical_language: "en",
        domain_pack: {
          registry_version: "registry.v1",
          pack_version: "pack.v1",
          category_id: "synthetic_industrial_components",
        },
        fields: [
          {
            field_id: "FLD-CORE-PS-01",
            macro_parameter: "product_specification",
            typed_value: { value_state: "provided", value: "Industrial pump" },
            translated: true,
            confidence: 0.72,
          },
        ],
        hard_constraints: [],
        exclusions: [],
        conditional_requirements: [],
        contradictions: [
          {
            contradiction_id: "20000000-0000-4000-8000-000000000010",
            contradiction_class: "field_value",
            resolution_state: "unresolved",
            alternatives: [
              {
                alternative_id: "alternative-a",
                canonical_english_value: "Industrial pump",
                field_ids: ["FLD-CORE-PS-01"],
              },
              {
                alternative_id: "alternative-b",
                canonical_english_value: "Industrial valve",
                field_ids: ["FLD-CORE-PS-01"],
              },
            ],
          },
        ],
        readiness: "not_ready",
        created_at: "2026-08-15T00:00:00.000Z",
      }}
    />,
  );
  expect(
    screen.getByText("Translated to English · low confidence 72%"),
  ).toBeVisible();
  expect(
    screen
      .getAllByRole("radio")
      .every((radio) => !(radio as HTMLInputElement).checked),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Confirm and start synthetic research",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Select one owner resolution",
  );
  expect(
    (
      await axe.run(document, {
        rules: { "color-contrast": { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});
