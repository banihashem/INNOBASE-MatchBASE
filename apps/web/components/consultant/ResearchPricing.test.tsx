import { render, screen, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  GOLDEN_SCENARIO_V3_01,
  type ConsultantResearchOutputV3,
  type EvidenceSourceV3,
  type SupplierEntityV3,
} from "@matchbase/contracts";
import { ResearchPricing, SupplierPriceSummary } from "./ResearchPricing";
import {
  additionalPriceEvidence,
  researchPriceGroups,
} from "./research-pricing";

afterEach(cleanup);
const source: EvidenceSourceV3 = {
  evidence_id: "price-source",
  source_id: "price-source",
  source_url: "https://supplier.example/prices",
  source_title: "Supplier prices",
  publisher: "Supplier",
  source_type: "official_website",
  retrieved_at: "2026-09-09T00:00:00Z",
  freshness_status: "current",
  verification_status: "externally_verified",
  excerpt_summary: "Product USD 100 MT FOB Mundra",
  supports_claim_ids: [],
  contradicts_claim_ids: [],
};
function candidate(id: string, price: number): SupplierEntityV3 {
  return {
    ...GOLDEN_SCENARIO_V3_01.supplier_candidates[0]!,
    candidate_id: id,
    supplier_entity_id: id,
    legal_name: id,
    offering: {
      ...GOLDEN_SCENARIO_V3_01.supplier_candidates[0]!.offering,
      product_name: "Product",
      model_or_sku: "P1",
    },
    commercial: {
      price_min: price,
      price_max: price,
      currency: "USD",
      unit: "MT",
      incoterm: "FOB",
      incoterm_location: "Mundra",
      price_date: "Updated on 2024-11-14",
      commercial_confidence: "medium",
      commercial_evidence_ids: [source.evidence_id],
    },
  };
}
function output(
  suppliers: SupplierEntityV3[],
  sources = [source],
): ConsultantResearchOutputV3 {
  return {
    ...GOLDEN_SCENARIO_V3_01,
    research_mode: "live",
    supplier_candidates: suppliers,
    evidence_sources: sources,
    claims: suppliers.flatMap((supplier) =>
      (["price_min", "price_max"] as const).flatMap((bound) =>
        supplier.commercial[bound] === undefined
          ? []
          : [
              {
                claim_id: `${supplier.candidate_id}-${bound}`,
                supplier_entity_id: supplier.supplier_entity_id,
                claim_type: "pricing",
                field_path: `commercial.${bound}`,
                normalized_value: supplier.commercial[bound],
                claim_text: `commercial.${bound}: ${supplier.commercial[bound]}`,
                status: "externally_verified",
                confidence: "medium",
                conflict_status: "single_source",
                evidence_ids: supplier.commercial.commercial_evidence_ids,
              },
            ],
      ),
    ),
  };
}
describe("Section 3 research pricing", () => {
  it("MB-UX-QUALITY-001 L06 preserves sourced lower bounds without turning them into exact or aggregate prices", () => {
    const base = candidate("Lower-bound supplier", 100);
    const { price_max: _maximum, ...commercial } = base.commercial;
    const record = {
      ...base,
      commercial: { ...commercial, price_validity: "Until 2026-10-01" },
    };
    const saved = structuredClone(record);
    const data = output([record]);
    render(
      <SupplierPriceSummary
        supplier={record}
        evidence={data.evidence_sources}
        claims={data.claims}
        detailed
      />,
    );
    expect(screen.getByText(/Lower bound only: USD 100 \/ MT/)).toBeVisible();
    expect(screen.getByText(/Price date:/).parentElement).toHaveTextContent(
      "Updated on 2024-11-14",
    );
    expect(screen.getByText(/Validity \/ source wording:/)).toHaveTextContent(
      "Until 2026-10-01",
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", source.source_url);
    expect(researchPriceGroups(data)).toHaveLength(0);
    cleanup();
    render(<ResearchPricing output={data} />);
    expect(
      screen.getByText(/No comparable supplier price range/),
    ).toBeVisible();
    expect(
      screen.getByText("One-sided supplier price indications (1)"),
    ).toBeVisible();
    expect(screen.queryByText("USD 100 / MT")).not.toBeInTheDocument();
    expect(additionalPriceEvidence(data)).toEqual([]);
    expect(record).toEqual(saved);
  });

  it("MB-UX-QUALITY-001 L06 retains an upper-bound price date and named place without inventing a closed range", () => {
    const base = candidate("Upper-bound supplier", 100);
    const { price_min: _minimum, ...commercial } = base.commercial;
    const record = {
      ...base,
      commercial: {
        ...commercial,
        price_max: 100,
        price_validity: "Until 2026-10-01",
      },
    };
    render(
      <SupplierPriceSummary supplier={record} evidence={[source]} detailed />,
    );
    expect(screen.getByText(/Upper bound only: USD 100 \/ MT/)).toBeVisible();
    expect(screen.getByText(/Price date:/).parentElement).toHaveTextContent(
      "Updated on 2024-11-14",
    );
    expect(screen.getByText(/Delivery basis:/)).toHaveTextContent("FOB Mundra");
    expect(screen.getByText(/Validity \/ source wording:/)).toHaveTextContent(
      "Until 2026-10-01",
    );
    expect(
      screen.queryByText("Not stated in supplier price evidence"),
    ).not.toBeInTheDocument();
    expect(researchPriceGroups(output([record]))).toHaveLength(0);
  });

  it("ranges all stored suppliers, including unrevealed profiles, and exposes dated source detail", () => {
    const data = output([candidate("A", 100), candidate("B", 120)]);
    render(<ResearchPricing output={data} />);
    expect(screen.getByText("USD 100 – 120 / MT")).toBeDefined();
    expect(screen.getByText(/2 of 2 supplier profiles/)).toBeDefined();
    expect(screen.getAllByText(/Updated on 2024-11-14/).length).toBeGreaterThan(
      0,
    );
    expect(
      screen
        .getAllByRole("link", { hidden: true })
        .every((link) => link.getAttribute("href") === source.source_url),
    ).toBe(true);
  });
  it("does not pool currencies, units, delivery bases, dates, products or quantity tiers", () => {
    const base = candidate("A", 100);
    const variants: SupplierEntityV3[] = [
      { currency: "AED" },
      { unit: "kg" },
      { incoterm: "CIF" },
      { incoterm_location: "Dubai" },
      { price_date: "2026-09-09" },
      { moq: "100 MT" },
    ].map((patch, index) => ({
      ...base,
      candidate_id: String(index),
      commercial: { ...base.commercial, ...patch },
    }));
    variants.push({
      ...base,
      candidate_id: "other-product",
      offering: { ...base.offering, product_name: "Other product" },
    });
    expect(researchPriceGroups(output([base, ...variants]))).toHaveLength(8);
  });
  it("keeps unknown price dates separate from validity and retrieval", () => {
    const base = candidate("A", 100);
    const { price_date: _date, ...commercial } = base.commercial;
    render(
      <SupplierPriceSummary
        supplier={{
          ...base,
          commercial: { ...commercial, price_validity: "2026-10-01" },
        }}
        evidence={[source]}
        claims={output([base]).claims}
        detailed
      />,
    );
    expect(
      screen.getByText(/Price date:/).parentElement?.textContent,
    ).toContain("Not stated");
    expect(
      screen.getByText(/Validity \/ source wording:/).textContent,
    ).toContain("2026-10-01");
    expect(screen.getByText(/Source retrieved:/).textContent).toContain(
      "2026-09-09",
    );
  });
  it("shows retained historical rice evidence without assigning it to a similarly named dossier", () => {
    const riceSource = {
      ...source,
      source_url: "https://ecoexport.in/basmati-rice-price-india/",
      excerpt_summary:
        "Verified excerpt 5:\n1121 STEAM BASMATI RICE USD 1110 MT FOB Mundra\n\nVerified excerpt 6:\nBasmati Rice Price in India ( Updated on 14-11-2024)",
    };
    const supplier = {
      ...candidate("Eco Export Ahmedabad, Gujarat", 0),
      commercial: {
        commercial_confidence: "not_assessed" as const,
        commercial_evidence_ids: [],
      },
    };
    render(
      <>
        <ResearchPricing output={output([supplier], [riceSource])} />
        <SupplierPriceSummary supplier={supplier} evidence={[riceSource]} />
      </>,
    );
    expect(
      screen.getByText("1121 STEAM BASMATI RICE USD 1110 MT FOB Mundra"),
    ).toBeDefined();
    expect(
      screen.getByText(/Source price date \/ update:/).textContent,
    ).toContain("14-11-2024");
    expect(
      within(
        screen.getByLabelText("Price for Eco Export Ahmedabad, Gujarat"),
      ).getByText(/No attributable price found/),
    ).toBeDefined();
    expect(
      screen.getByText(/No comparable supplier price range/),
    ).toBeDefined();
  });
  it("does not manufacture a range from missing, negative, inverted or unlinked prices", () => {
    const base = candidate("A", 100);
    const variants = [
      { ...base, commercial: { ...base.commercial, price_min: -1 } },
      { ...base, commercial: { ...base.commercial, price_max: 50 } },
      {
        ...base,
        commercial: { ...base.commercial, commercial_evidence_ids: [] },
      },
    ];
    for (const variant of variants)
      expect(researchPriceGroups(output([variant]))).toHaveLength(0);
    expect(researchPriceGroups(output([base]))[0]).toMatchObject({
      low: 100,
      high: 100,
    });
  });
  it("does not repeat a price source already assigned to a supplier or infer price date from retrieval", () => {
    expect(additionalPriceEvidence(output([candidate("A", 100)]))).toEqual([]);
    expect(additionalPriceEvidence(output([]))[0]?.dateText).toBeUndefined();
  });
  it("separates quality, specifications, origin, pack size and unknown delivery bases", () => {
    const a = candidate("A", 100);
    const variants: SupplierEntityV3[] = [
      {
        ...a,
        candidate_id: "B",
        offering: { ...a.offering, specifications: { broken_percent: 25 } },
      },
      {
        ...a,
        candidate_id: "C",
        offering: { ...a.offering, grade_or_quality: "Other grade" },
      },
      {
        ...a,
        candidate_id: "D",
        offering: { ...a.offering, country_of_origin: "Pakistan" },
      },
      {
        ...a,
        candidate_id: "E",
        packaging_and_logistics: {
          pack_size: "50 kg",
          logistics_evidence_ids: [],
        },
      },
    ];
    expect(researchPriceGroups(output([a, ...variants]))).toHaveLength(5);
    const { incoterm: _term, ...commercial } = a.commercial;
    expect(
      researchPriceGroups(
        output([
          { ...a, commercial },
          { ...a, candidate_id: "F", commercial },
        ]),
      ),
    ).toHaveLength(2);
  });
  it("does not promote MOQ evidence, another supplier's price or an unsupported range bound", () => {
    const a = candidate("A", 100);
    const data = output([a]);
    expect(
      researchPriceGroups({
        ...data,
        claims: data.claims.map((claim) => ({
          ...claim,
          field_path: "commercial.moq",
        })),
      }),
    ).toHaveLength(0);
    expect(
      researchPriceGroups({
        ...data,
        claims: data.claims.map((claim) => ({
          ...claim,
          supplier_entity_id: "someone-else",
        })),
      }),
    ).toHaveLength(0);
    expect(
      researchPriceGroups({
        ...data,
        supplier_candidates: [
          { ...a, commercial: { ...a.commercial, price_max: 200 } },
        ],
      }),
    ).toHaveLength(0);
  });
  it("recognizes the retained decimal price claim without inferring a unit or a date", () => {
    const base = candidate("Maargga", 230);
    const data = output([base]);
    const claims = data.claims.map(
      ({ normalized_value: _value, ...claim }) => ({
        ...claim,
        claim_text: `${claim.field_path}: 230.00`,
      }),
    );
    expect(researchPriceGroups({ ...data, claims })[0]?.low).toBe(230);
  });
});
