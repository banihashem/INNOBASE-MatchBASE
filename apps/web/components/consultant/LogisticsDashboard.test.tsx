import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  GOLDEN_SCENARIO_V3_01,
  createSearchDimensionConfiguration,
  compileSearchDimensionPlan,
  createSearchDimensionCoverage,
  evaluateSearchDimensionPlan,
  type SearchDimensionObservation,
} from "@matchbase/contracts";
import { ConsultantResultsSection } from "./ConsultantResultsSection";
import { SupplierDossierModal } from "./SupplierDossierModal";
import {
  isLogisticsOutput,
  LogisticsDashboard,
  LogisticsSupplierFacts,
  LOGISTICS_GROUPS,
} from "./LogisticsDashboard";
afterEach(cleanup);
describe("MB-UX-LOGISTICS-001 L01 saved logistics decisions", () => {
  it("groups exactly the existing 26 logistics criteria and excludes cargo-only guesses", () => {
    expect(
      new Set(LOGISTICS_GROUPS.flatMap((group) => [...group.ids])).size,
    ).toBe(26);
    const output = structuredClone(GOLDEN_SCENARIO_V3_01);
    expect(isLogisticsOutput(output)).toBe(false);
    expect(isLogisticsOutput(output, "logistics")).toBe(true);
  });
  it("makes missing legacy assessments explicit and keeps long approved text collapsed", () => {
    const output = structuredClone(GOLDEN_SCENARIO_V3_01);
    render(
      <LogisticsDashboard
        output={output}
        suppliers={output.supplier_candidates}
      />,
    );
    expect(
      screen.getByText(/No assessment has been inferred or backfilled/),
    ).toBeTruthy();
    expect(
      screen.getByText("Approved transport request").closest("details")?.open,
    ).toBe(false);
  });
  it("renders exact persisted unknowns and never uses a manufacturer default as a freight role", () => {
    const output = structuredClone(GOLDEN_SCENARIO_V3_01);
    const supplier = output.supplier_candidates[0]!;
    const plan = compileSearchDimensionPlan(
      createSearchDimensionConfiguration({ profile_ids: ["logistics.ocean"] }),
      {
        owner_scope: {
          account_id: "account",
          user_profile_id: output.user_profile_id,
        },
        primary_classification_id: output.classification_id,
        original_buyer_intent:
          "Qingdao to either Tincan or Lekki; not the reverse lane.",
      },
    );
    const assessment = createSearchDimensionCoverage(plan, {
      trace: output,
      entity_id: supplier.supplier_entity_id,
      now: "2026-10-06T00:00:00Z",
    });
    const enriched = {
      ...output,
      search_dimension_plan: plan,
      search_dimension_assessments: [assessment],
    };
    render(<LogisticsSupplierFacts output={enriched} supplier={supplier} />);
    expect(
      screen.getByText(/Evidenced role/).parentElement?.textContent,
    ).toContain("Not established");
    expect(screen.queryByText("Direct Manufacturer")).toBeNull();
    expect(
      screen.getAllByText(/No admitted observation/).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/unexecuted/).length).toBeGreaterThan(0);
  });
  it.each(["ranked card", "actual dossier"] as const)(
    "retains custom buyer mandatory and non-logistics registry evidence in the specialized %s",
    (surface) => {
      const output = structuredClone(GOLDEN_SCENARIO_V3_01);
      const supplier = output.supplier_candidates[0]!;
      const owner_scope = {
        account_id: "account",
        user_profile_id: output.user_profile_id,
      };
      const trace = {
        user_profile_id: output.user_profile_id,
        research_run_id: output.research_run_id,
        execution_id: output.execution_id,
        classification_id: output.classification_id,
      };
      const configuration = createSearchDimensionConfiguration({
        profile_ids: ["core", "logistics.ocean"],
      });
      configuration.custom_definitions.push({
        id: "custom.switch_document",
        revision: 1,
        label: "Buyer-specific switch document authority",
        description: "Verify buyer-specific authority before procurement.",
        kind: "capability",
        value_type: "boolean",
        profile_ids: ["logistics.ocean"],
        default_active: true,
        default_severity: "preferred",
        applicability: "always",
        locked: false,
        allowed_operators: ["research", "equals"],
        owner_scope,
      });
      configuration.selections.push({
        selection_id: "custom.switch_document",
        dimension_id: "custom.switch_document",
        active: true,
        severity: "mandatory",
        original_requirement: "buyer-specific switch authority required.",
        operator: "equals",
        expected: true,
        scope: { lot_id: "default", subject_id: "request" },
      });
      const contact = configuration.selections.find(
        (selection) => selection.dimension_id === "core.contact",
      )!;
      contact.operator = "equals";
      contact.expected = "RFQ desk";
      const plan = compileSearchDimensionPlan(configuration, {
        owner_scope,
        primary_classification_id: output.classification_id,
        original_buyer_intent:
          "Qingdao to Lekki; buyer-specific switch authority required.",
      });
      const observation: SearchDimensionObservation = {
        observation_id: "contact-source-observation",
        selection_id: contact.selection_id,
        dimension_id: contact.dimension_id,
        definition_revision: 1,
        trace,
        entity_id: supplier.supplier_entity_id,
        scope: contact.scope,
        value: "RFQ desk",
        source: {
          source_id: "contact-source",
          uri: "https://example.com/approved-contact",
          literal_excerpt: "Contact our RFQ desk for this request.",
          published_at: "2026-10-01T00:00:00Z",
          retrieved_at: "2026-10-06T00:00:00Z",
        },
      };
      const assessment = evaluateSearchDimensionPlan(plan, [observation], {
        trace,
        entity_id: supplier.supplier_entity_id,
        now: "2026-10-06T00:00:00Z",
        admitted_observation_ids: [observation.observation_id],
      });
      expect(
        plan.dimensions.find(
          (entry) => entry.definition.id === "custom.switch_document",
        ),
      ).toMatchObject({
        definition: { default_severity: "preferred" },
        selection: { severity: "mandatory" },
      });
      expect(
        assessment.dimensions.find(
          (row) => row.dimension_id === "core.contact",
        ),
      ).toMatchObject({ outcome: "supported", execution_status: "completed" });
      const enriched = {
        ...output,
        search_dimension_plan: plan,
        search_dimension_assessments: [assessment],
        search_dimension_observations: [observation],
      };
      const before = JSON.stringify(enriched);
      render(
        surface === "ranked card" ? (
          <ConsultantResultsSection
            output={enriched}
            suppliers={[supplier]}
            visibleSuppliers={[supplier]}
            revealedCount={1}
            isLoading={false}
            isPdfDownloading={false}
            handlePdfDownload={async () => {}}
            handleJsonExport={() => {}}
            handleRevealMore={async () => {}}
            onSelectSupplier={() => {}}
          />
        ) : (
          <SupplierDossierModal
            output={enriched}
            supplier={supplier}
            dimensionAssessment={assessment}
            isOpen
            onClose={() => {}}
          />
        ),
      );
      const additional = screen
        .getByText("Additional approved criteria")
        .closest("section")!;
      expect(
        additional.closest("details")?.querySelector("summary")?.textContent,
      ).toBe("Logistics evidence and RFQ gaps");
      const customRow = within(additional)
        .getByText("Buyer-specific switch document authority")
        .closest("li")!;
      expect(customRow.textContent).toContain("unknown · unexecuted");
      expect(customRow.textContent).toContain(
        "Requested: true. Observed: No admitted observation.",
      );
      expect(customRow.textContent).toContain(
        "mandatory; scope default / request",
      );
      expect(customRow.querySelector("a")).toBeNull();
      const contactRow = within(additional)
        .getByText("Commercial contact")
        .closest("li")!;
      expect(contactRow.textContent).toContain("supported · completed");
      expect(contactRow.textContent).toContain(
        "Requested: RFQ desk. Observed: RFQ desk.",
      );
      expect(contactRow.textContent).toContain(
        "preferred; scope default / request",
      );
      expect(contactRow.textContent).toContain(
        observation.source.literal_excerpt,
      );
      expect(contactRow.textContent).toContain(
        "Published: 2026-10-01T00:00:00Z; observed: 2026-10-06T00:00:00Z; valid: not recorded to not recorded.",
      );
      expect(contactRow.querySelector("a")?.href).toBe(observation.source.uri);
      expect(additional.querySelectorAll("li")).toHaveLength(
        assessment.dimensions.filter(
          (row) => !row.dimension_id.startsWith("logistics."),
        ).length,
      );
      expect(JSON.stringify(enriched)).toBe(before);
    },
  );
});
