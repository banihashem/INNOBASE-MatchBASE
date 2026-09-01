import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import { ProductRouter } from "./ProductRouter";
import { CanonicalReview } from "./standard/CanonicalReview";
import { StandardResult } from "./standard/StandardResult";
import { StructuredIntake } from "./standard/StructuredIntake";
import { workspaceJson } from "./standard/api";
import {
  type StandardResultProjectionV1,
  userFacingSessionName,
} from "./standard/types";

test("uses an opaque user reference instead of the historical Google user placeholder", () => {
  expect(
    userFacingSessionName({
      display_name: "Google user",
      user_display_name: null,
      subject: { user_id: "1e23f33e-0000-4000-8000-000000000001" },
    }),
  ).toBe("User 1e23f33e");
  expect(
    userFacingSessionName({
      display_name: "Account",
      user_display_name: "Verified Person",
    }),
  ).toBe("Verified Person");
});

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
const jsdomAxeOptions = {
  runOnly: {
    type: "tag" as const,
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
  },
  rules: { "color-contrast": { enabled: false } },
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
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
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

test("surfaces the current top-level runtime fault detail and correlation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            detail: "Structured canonicalisation fixture is unavailable.",
            correlation_id: "runtime-correlation-1",
          }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ),
  );
  await expect(workspaceJson("/api/v1/requests")).rejects.toMatchObject({
    message: "Structured canonicalisation fixture is unavailable.",
    status: 422,
    correlationId: "runtime-correlation-1",
  });
});

test("associates the missing Standard source error and focuses its field", async () => {
  render(
    <StructuredIntake
      session={session}
      onCanonical={() => undefined}
      onCancel={() => undefined}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Resolve product category" }),
  );
  const source = screen.getByLabelText("Source-language input");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Enter the transient sourcing requirement first.",
  );
  await waitFor(() => expect(source).toHaveFocus());
  expect(source).toHaveAttribute("aria-invalid", "true");
  expect(source).toHaveAttribute(
    "aria-describedby",
    "standard-source-hint standard-intake-error",
  );
});

test("retains transient source text when canonical request submission fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/resolution"))
        return new Response(
          JSON.stringify({
            schema_version: "domain-pack-resolution.v1",
            category_id: "synthetic_industrial_components",
            confidence: 1,
            confidence_threshold: 0.8,
            activation_state: "confirmed",
            registry_version: "2026-08-15.1",
            pack_version: "2026-08-15.1",
            activation_token: "signed-activation-token",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      if (url.includes("/api/v1/domain-packs/"))
        return new Response(
          JSON.stringify({
            schema_version: "domain-pack.v1",
            registry_version: "2026-08-15.1",
            pack_version: "2026-08-15.1",
            category_id: "synthetic_industrial_components",
            category_label: "Synthetic Industrial Components",
            macro_parameters: ["product_specification"],
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
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      expect(init?.method).toBe("POST");
      return new Response(
        JSON.stringify({ error: { detail: "Canonicalization unavailable." } }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  render(
    <StructuredIntake
      session={session}
      onCanonical={() => undefined}
      onCancel={() => undefined}
    />,
  );
  const source = screen.getByLabelText("Source-language input");
  fireEvent.change(source, {
    target: { value: "Industrial automation controller" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Resolve product category" }),
  );
  await screen.findByRole("button", { name: "Prepare canonical English" });
  fireEvent.change(screen.getByLabelText(/product_category required/u), {
    target: { value: "provided" },
  });
  fireEvent.change(screen.getByLabelText("product_category value"), {
    target: { value: "Industrial automation controller" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare canonical English" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Canonicalization unavailable.",
  );
  expect(source).toHaveValue("Industrial automation controller");
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
  projection_version: 4,
  synthetic_warning: "Synthetic evaluation data — not a sourcing result",
  gate_eliminations: [
    { gate_id: "gate-1", label: "Hard constraints", eliminated_count: 2 },
  ],
  scarcity_analysis: {
    reducing_constraints: [
      {
        constraint_id: "constraint-1",
        field_id: "annual_volume",
        label: "Annual volume minimum",
        eliminated_count: 2,
      },
    ],
    unmet_mandatory_constraints: [],
    permitted_relaxations: [
      {
        constraint_id: "constraint-1",
        field_id: "annual_volume",
        label: "Annual volume minimum",
        direction: "lower_is_acceptable",
        tolerance: "10",
      },
    ],
  },
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
  const resultHeading = screen.getByRole("heading", {
    name: "Responsible candidate comparison",
  });
  expect(resultHeading).toBeVisible();
  expect(resultHeading.nextElementSibling).toHaveAttribute("role", "status");
  expect(
    screen.getByRole("region", { name: "Six-dimension candidate comparison" }),
  ).toBeVisible();
  expect(screen.getAllByRole("row")).toHaveLength(7);
  expect(screen.getByText("78")).toBeVisible();
  const compatibilityMeter = screen.getByRole("meter", {
    name: "Synthetic Industrial Candidate compatibility score",
  });
  expect(compatibilityMeter).toHaveAttribute("aria-valuemin", "0");
  expect(compatibilityMeter).toHaveAttribute("aria-valuemax", "100");
  expect(compatibilityMeter).toHaveAttribute("aria-valuenow", "78");
  expect(compatibilityMeter).toHaveAttribute(
    "aria-valuetext",
    "78 of 100, strong fit",
  );
  expect(
    screen.getByText(
      "1 candidate met all mandatory constraints. Fewer than three met them, so fewer than three are shown.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Which constraints reduced the set" }),
  ).toBeVisible();
  expect(
    screen
      .getAllByText("Annual volume minimum")
      .some((item) =>
        item
          .closest("li")
          ?.textContent?.includes("Annual volume minimum: 2 eliminated"),
      ),
  ).toBe(true);
  expect(screen.getByText(/No padding/)).toBeVisible();
  expect(screen.getByText(/not probabilities or guarantees/i)).toBeVisible();
  fireEvent.click(screen.getByText(/Evidence and citations/));
  expect(screen.getByText("Synthetic support text.")).toBeVisible();
  await waitFor(async () =>
    expect((await axe.run(document, jsdomAxeOptions)).violations).toEqual([]),
  );
});

test("renders no responsible match as a neutral success with enumerated constraints", async () => {
  const zeroResult: StandardResultProjectionV1 = {
    ...result,
    outcome: "no_responsible_match",
    scarcity: "zero",
    candidates: [],
    scarcity_analysis: {
      reducing_constraints: result.scarcity_analysis.reducing_constraints,
      unmet_mandatory_constraints: [
        {
          constraint_id: "constraint-1",
          field_id: "annual_volume",
          label: "Annual volume minimum",
        },
      ],
      permitted_relaxations: result.scarcity_analysis.permitted_relaxations,
    },
  };
  render(<StandardResult result={zeroResult} onBack={() => undefined} />);
  const noMatchHeading = screen.getByRole("heading", {
    name: "No responsible match",
  });
  expect(noMatchHeading).toBeVisible();
  expect(noMatchHeading.nextElementSibling).toHaveAttribute("role", "status");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "No candidate met the mandatory constraints for this request.",
  );
  expect(
    screen.getByRole("heading", {
      name: "Which mandatory constraints could not be met",
    }),
  ).toBeVisible();
  expect(screen.getAllByText("Annual volume minimum").length).toBeGreaterThan(
    0,
  );
  const rendered = document.body.textContent ?? "";
  for (const prohibited of [
    "No suppliers exist",
    "no results",
    "search failed",
    "empty",
  ])
    expect(rendered.toLowerCase()).not.toContain(prohibited.toLowerCase());
  await waitFor(async () =>
    expect((await axe.run(document, jsdomAxeOptions)).violations).toEqual([]),
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
    screen.getByRole("heading", {
      level: 1,
      name: "Result disclosure refused",
    }),
  ).toBeVisible();
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
  await waitFor(() => expect(screen.getAllByRole("radio")[0]).toHaveFocus());
  expect(screen.getAllByRole("radio")[0]).toHaveAttribute(
    "aria-describedby",
    "canonical-review-error",
  );
  expect((await axe.run(document, jsdomAxeOptions)).violations).toEqual([]);
});
