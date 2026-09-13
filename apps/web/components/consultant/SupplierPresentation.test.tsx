import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GOLDEN_SCENARIO_V3_01,
  type ConsultantResearchOutputV3,
  type ClaimV3,
  type EvidenceSourceV3,
  type SupplierEntityV3,
} from "@matchbase/contracts";
import { ConsultantResultsSection } from "./ConsultantResultsSection";
import { SupplierDossierModal } from "./SupplierDossierModal";
import { ConsultantResultView } from "./ConsultantResult";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function supplier(overrides: Partial<SupplierEntityV3> = {}): SupplierEntityV3 {
  const base = GOLDEN_SCENARIO_V3_01.supplier_candidates[0]!;
  return {
    ...base,
    supplier_entity_id: "supplier-retained",
    candidate_id: "candidate-retained",
    legal_name: "Retained Supplier",
    brand_names: [],
    entity_basis: "live_verified",
    evidence_basis: "live_evidence",
    verification_status: "supplier_claimed",
    manufacturer_status: "unknown",
    country_of_registration: "Not verified",
    headquarters_address: "12 Trade Street, Dubai, United Arab Emirates",
    manufacturing_locations: [],
    website: "https://retained.example/products",
    primary_domain: null,
    contacts: { verification_status: "unverified", contact_evidence_ids: [] },
    commercial: {
      commercial_confidence: "not_assessed",
      commercial_evidence_ids: [],
    },
    certifications: [],
    packaging_and_logistics: { logistics_evidence_ids: [] },
    offering: {
      product_name: "Retained chemical",
      product_family: "Industrial chemical",
      country_of_origin: "China",
      specifications: {},
      use_cases: [],
      product_evidence_ids: [],
    },
    assessment: {
      ...base.assessment,
      compatibility_score: 70,
      rank: 1,
      mandatory_constraint_results: [],
      positive_drivers: [],
      limiting_gaps: [],
      risk_flags: [],
      unknowns: [],
      required_validation: [],
    },
    ...overrides,
  };
}

function output(
  suppliers: readonly SupplierEntityV3[],
): ConsultantResearchOutputV3 {
  return {
    ...GOLDEN_SCENARIO_V3_01,
    research_mode: "live",
    supplier_candidates: suppliers,
    claims: [],
    evidence_sources: [],
    executive_summary: {
      ...GOLDEN_SCENARIO_V3_01.executive_summary,
      direct_answer: "Retained supplier observations require review.",
    },
    limitations_and_disclosures: [
      {
        title: "Retained qualification gap",
        severity: "advisory",
        description: "Supplier registration needs independent confirmation.",
      },
    ],
  };
}

function renderCard(record: SupplierEntityV3) {
  return render(
    <ConsultantResultsSection
      output={output([record])}
      suppliers={[record]}
      visibleSuppliers={[record]}
      revealedCount={1}
      isLoading={false}
      isPdfDownloading={false}
      handlePdfDownload={async () => {}}
      handleJsonExport={() => {}}
      handleRevealMore={async () => {}}
      onSelectSupplier={() => {}}
    />,
  );
}

function searchSuppliers() {
  return Array.from({ length: 12 }, (_, index) => {
    const base = supplier();
    return supplier({
      legal_name: `Supplier ${index + 1}`,
      candidate_id: `candidate-${index + 1}`,
      supplier_entity_id: `entity-${index + 1}`,
      brand_names: index === 9 ? ["Retained Export Brand"] : [],
      country_of_registration: index < 6 ? "Singapore" : "Not verified",
      headquarters_address:
        index === 8 ? "Mumbai, India" : "Dubai, United Arab Emirates",
      website: index === 11 ? "https://retained.de/products" : base.website,
      offering: {
        ...base.offering,
        product_name: index === 10 ? "Technical hydroxide" : "Chemical product",
        specifications: index === 10 ? { grade: "Technical" } : {},
      },
      assessment: { ...base.assessment, rank: index + 1 },
    });
  });
}

function renderSearchResults(
  records = searchSuppliers(),
  research = output(records),
) {
  const handleRevealMore = vi.fn(async () => {});
  const handlePdfDownload = vi.fn(async () => {});
  const handleJsonExport = vi.fn();
  const onSelectSupplier = vi.fn();
  const view = render(
    <ConsultantResultsSection
      output={research}
      suppliers={records}
      visibleSuppliers={records.slice(0, 5)}
      revealedCount={5}
      isLoading={false}
      isPdfDownloading={false}
      handleRevealMore={handleRevealMore}
      handlePdfDownload={handlePdfDownload}
      handleJsonExport={handleJsonExport}
      onSelectSupplier={onSelectSupplier}
    />,
  );
  return {
    ...view,
    records,
    research,
    handleRevealMore,
    handlePdfDownload,
    handleJsonExport,
    onSelectSupplier,
  };
}

describe("MB-UX-SIMPLIFY-001 L01 finding saved suppliers", () => {
  it("searches all retained profiles before pagination and preserves source rank and detail identity", () => {
    const { records, onSelectSupplier } = renderSearchResults();
    const before = structuredClone(records);
    expect(screen.queryByRole("heading", { name: "Supplier 9" })).toBeNull();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search supplier profiles" }),
      { target: { value: "MUMBAI" } },
    );
    expect(screen.getByRole("heading", { name: "Supplier 9" })).toBeVisible();
    expect(screen.getByText("Rank #9")).toBeVisible();
    expect(
      screen.getByText("Showing 1 of 1 matching profiles · 12 total"),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: /View supplier details/ }),
    );
    expect(onSelectSupplier).toHaveBeenCalledExactlyOnceWith(records[8]);
    expect(records).toEqual(before);
  });

  it.each([
    ["technical hydroxide", "Supplier 11"],
    ["retained export brand", "Supplier 10"],
    ["retained.de", "Supplier 12"],
  ])("finds stored product, brand and website wording for %s", (term, name) => {
    renderSearchResults();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: term },
    });
    expect(
      screen.getAllByRole("heading", { name: /^Supplier \d+$/ }),
    ).toHaveLength(1);
    expect(screen.getByRole("heading", { name })).toBeVisible();
  });

  it("reveals filtered matches locally in groups of five and restores the existing unfiltered reveal contract", () => {
    const { handleRevealMore } = renderSearchResults();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "supplier" },
    });
    expect(
      screen.getAllByRole("heading", { name: /^Supplier \d+$/ }),
    ).toHaveLength(5);
    fireEvent.click(
      screen.getByRole("button", { name: /Show more matching suppliers/ }),
    );
    expect(
      screen
        .getAllByRole("heading", { name: /^Supplier \d+$/ })
        .map((heading) => heading.textContent),
    ).toEqual(
      Array.from({ length: 10 }, (_, index) => `Supplier ${index + 1}`),
    );
    expect(handleRevealMore).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: /Show more matching suppliers/ }),
    );
    expect(
      screen.getAllByRole("heading", { name: /^Supplier \d+$/ }),
    ).toHaveLength(12);
    expect(
      screen.queryByRole("button", { name: /Show more matching suppliers/ }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear supplier filters" }),
    );
    expect(
      screen.getAllByRole("heading", { name: /^Supplier \d+$/ }),
    ).toHaveLength(5);
    fireEvent.click(
      screen.getByRole("button", { name: /Show next suppliers/ }),
    );
    expect(handleRevealMore).toHaveBeenCalledOnce();
  });

  it("filters only recorded registration countries without deriving them from a domain, headquarters or goods origin", () => {
    renderSearchResults();
    const countries = screen.getByRole("combobox", {
      name: "Registered country",
    });
    expect(
      within(countries)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "All registered countries",
      "Singapore (6)",
      "Not established (6)",
    ]);
    expect(countries).toHaveAccessibleDescription(/saved registration field/);
    fireEvent.change(countries, { target: { value: "singapore" } });
    expect(
      screen.getByText("Showing 5 of 6 matching profiles · 12 total"),
    ).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Mumbai" },
    });
    expect(
      screen.getByText(/No saved supplier profiles match these filters/),
    ).toBeVisible();
    fireEvent.change(countries, { target: { value: "missing" } });
    expect(screen.getByRole("heading", { name: "Supplier 9" })).toBeVisible();
    expect(screen.getByText("Mumbai, India")).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "retained.de" },
    });
    expect(screen.getByRole("heading", { name: "Supplier 12" })).toBeVisible();
  });

  it("makes a no-match filter recoverable without treating the saved research as empty", () => {
    const { handleRevealMore } = renderSearchResults();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "unmatched term" },
    });
    expect(
      screen.getByText("Showing 0 of 0 matching profiles · 12 total"),
    ).toBeVisible();
    expect(
      screen.queryByText("No supplier profiles ready in this round"),
    ).toBeNull();
    expect(screen.getByText(/All 12 profiles remain available/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Show next suppliers/ }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear supplier filters" }),
    );
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.getByRole("combobox")).toHaveValue("all");
    expect(
      screen.getAllByRole("heading", { name: /^Supplier \d+$/ }),
    ).toHaveLength(5);
    expect(handleRevealMore).not.toHaveBeenCalled();
  });

  it("retains material limitations visibly and puts supplier cards before secondary report context", () => {
    const records = searchSuppliers();
    const baseResearch = output(records);
    const research: ConsultantResearchOutputV3 = {
      ...baseResearch,
      executive_summary: {
        ...baseResearch.executive_summary,
        primary_limitation:
          "Independent company identity checks remain incomplete.",
        research_coverage_status: "partial",
      },
      limitations_and_disclosures: [
        {
          title: "Comparison incomplete",
          severity: "critical",
          description: "The AI comparison did not finish.",
        },
      ],
    };
    renderSearchResults(records, research);
    expect(
      screen.getByText(
        "Independent company identity checks remain incomplete.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Comparison incomplete: The AI comparison did not finish.",
      ),
    ).toBeVisible();
    expect(screen.getByText(/Research coverage: partial/)).toBeVisible();
    const firstCard = screen.getByRole("heading", { name: "Supplier 1" });
    const priceResearch = screen.getByRole("heading", {
      name: "Research price range",
    });
    expect(
      firstCard.compareDocumentPosition(priceResearch) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByText(research.executive_summary.direct_answer),
    ).not.toBeVisible();
    fireEvent.click(
      screen.getByText("Research summary and assessment context"),
    );
    expect(
      screen.getByText(research.executive_summary.direct_answer),
    ).toBeVisible();
    expect(document.querySelectorAll("#supplier-findings")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "View price research" }),
    ).toHaveAttribute("href", "#research-pricing-heading");
  });

  it("preserves incoming match order and saved rank labels when filtering suppliers with different scores and ranks", () => {
    const records = searchSuppliers()
      .reverse()
      .map((record, index) => ({
        ...record,
        assessment: { ...record.assessment, compatibility_score: 95 - index },
      }));
    const original = structuredClone(records);
    renderSearchResults(records);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "supplier" },
    });
    expect(
      screen
        .getAllByRole("heading", { name: /^Supplier \d+$/ })
        .map((heading) => heading.textContent),
    ).toEqual([
      "Supplier 12",
      "Supplier 11",
      "Supplier 10",
      "Supplier 9",
      "Supplier 8",
    ]);
    expect(screen.getByText("Rank #12")).toBeVisible();
    expect(screen.getByText("Rank #8")).toBeVisible();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Registered country" }),
      { target: { value: "singapore" } },
    );
    expect(
      screen
        .getAllByRole("heading", { name: /^Supplier \d+$/ })
        .map((heading) => heading.textContent),
    ).toEqual([
      "Supplier 6",
      "Supplier 5",
      "Supplier 4",
      "Supplier 3",
      "Supplier 2",
    ]);
    expect(screen.getByText("Rank #6")).toBeVisible();
    expect(screen.getByText("Rank #2")).toBeVisible();
    expect(records).toEqual(original);
  });

  it("keeps full-report downloads available while the displayed supplier list is filtered", () => {
    const { handlePdfDownload, handleJsonExport, research } =
      renderSearchResults();
    const before = structuredClone(research);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Mumbai" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Download Full PDF Report" }),
    );
    expect(handlePdfDownload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("More export options"));
    fireEvent.click(
      screen.getByRole("button", { name: "Export research data (JSON)" }),
    );
    expect(handleJsonExport).toHaveBeenCalledOnce();
    expect(research).toEqual(before);
  });

  it("preserves the genuine empty-research state without showing unusable filters", () => {
    renderSearchResults([]);
    expect(
      screen.getByText("No supplier profiles ready in this round"),
    ).toBeVisible();
    expect(
      screen.getByText(
        /This does not establish that no suitable suppliers exist/,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.queryByText(/No saved supplier profiles match these filters/),
    ).toBeNull();
  });
});

describe("MB-UX-QUALITY-001 L06 supplier presentation consistency", () => {
  it("shows explicit origin specification wording when canonical product origin is missing, with all differing source fields retained", () => {
    const base = supplier();
    const record = {
      ...base,
      offering: {
        ...base.offering,
        country_of_origin: "Unknown",
        specifications: {
          origin: "Made In China",
          place_of_origin: "China",
          "Country Of Origin": "India",
        },
      },
    };
    const original = structuredClone(record);
    const view = render(
      <SupplierDossierModal supplier={record} isOpen onClose={() => {}} />,
    );
    expect(
      screen.getByText("Origin stated in specifications:").parentElement,
    ).toHaveTextContent(
      "origin: Made In China; place_of_origin: China; Country Of Origin: India",
    );
    expect(screen.queryByText("Product origin:")).not.toBeInTheDocument();
    expect(record).toEqual(original);
    view.rerender(
      <SupplierDossierModal
        supplier={{
          ...record,
          offering: { ...record.offering, country_of_origin: "Germany" },
        }}
        isOpen
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Product origin:").parentElement).toHaveTextContent(
      "Germany",
    );
    expect(screen.getByText("Made In China")).toBeVisible();
    expect(
      screen.queryByText("Origin stated in specifications:"),
    ).not.toBeInTheDocument();
  });

  it("shows the retained headquarters location without turning it into registration or product origin", () => {
    const record = supplier();
    const original = structuredClone(record);
    renderCard(record);
    expect(screen.getByText(record.headquarters_address)).toBeVisible();
    expect(screen.queryByText("Country / Origin:")).not.toBeInTheDocument();
    expect(screen.queryByText("Not verified")).not.toBeInTheDocument();
    cleanup();
    render(
      <SupplierDossierModal supplier={record} isOpen onClose={() => {}} />,
    );
    expect(
      screen.getByText("Registered country:").nextElementSibling,
    ).toHaveTextContent("Not established");
    expect(
      screen.getByText("Headquarters:").nextElementSibling,
    ).toHaveTextContent(record.headquarters_address);
    expect(screen.getByText("Product origin:").parentElement).toHaveTextContent(
      "China",
    );
    expect(record).toEqual(original);
  });

  it("keeps registration distinct when no usable headquarters address is retained", () => {
    const record = supplier({
      headquarters_address: "N/A",
      country_of_registration: "Singapore",
    });
    renderCard(record);
    expect(screen.getByText("Singapore")).toBeVisible();
    expect(screen.queryByText("N/A")).not.toBeInTheDocument();
    cleanup();
    render(
      <SupplierDossierModal supplier={record} isOpen onClose={() => {}} />,
    );
    expect(
      screen.getByText("Registered country:").nextElementSibling,
    ).toHaveTextContent("Singapore");
    expect(
      screen.getByText("Headquarters:").nextElementSibling,
    ).toHaveTextContent("Not established");
    expect(screen.getByText("Product origin:").parentElement).toHaveTextContent(
      "China",
    );
  });

  it("uses the valid saved website when primary domain is missing and never creates an empty website link", () => {
    renderCard(supplier());
    expect(
      screen.getByRole("link", { name: /retained\.example/ }),
    ).toHaveAttribute("href", "https://retained.example/products");
    cleanup();
    renderCard(supplier({ website: null, primary_domain: null }));
    expect(screen.queryByRole("link", { name: "" })).not.toBeInTheDocument();
    expect(screen.getByText("Website:").parentElement).toHaveTextContent(
      "Not established",
    );
  });

  it("retains all public email roles, named Incoterm place and stored contact channels in supplier details", () => {
    const record = supplier({
      contacts: {
        sales_email: "sales@retained.example",
        export_email: "export@retained.example",
        general_email: "info@retained.example",
        phone: "+971 4 000 0000",
        whatsapp_business: "+971 50 000 0000",
        verification_status: "claimed",
        contact_evidence_ids: [],
        other_official_social_urls: [
          "https://social.example/retained",
          "javascript:alert(1)",
        ],
      },
      commercial: {
        commercial_confidence: "medium",
        commercial_evidence_ids: [],
        incoterm: "FOB",
        incoterm_location: "Jebel Ali",
      },
    });
    render(
      <SupplierDossierModal supplier={record} isOpen onClose={() => {}} />,
    );
    for (const text of [
      "sales@retained.example",
      "export@retained.example",
      "info@retained.example",
      "+971 4 000 0000",
      "+971 50 000 0000",
    ])
      expect(screen.getByText(text)).toBeVisible();
    expect(
      screen.getByText("Incoterm / named place:").parentElement,
    ).toHaveTextContent("FOB / Jebel Ali");
    expect(
      screen.getByRole("link", { name: /Other official social profile/ }),
    ).toHaveAttribute("href", "https://social.example/retained");
    expect(
      screen.queryByRole("link", { name: /javascript:/ }),
    ).not.toBeInTheDocument();
  });

  it("reveals differing retained observations with their own sources without declaring a confirmed conflict", () => {
    const record = supplier({
      commercial: {
        commercial_confidence: "medium",
        commercial_evidence_ids: ["capacity-a", "capacity-b"],
        production_capacity: "100 tonnes per month",
      },
    });
    const claims: ClaimV3[] = [
      "100 tonnes per month",
      "2400 tonnes per year",
    ].map((value, index) => ({
      claim_id: `capacity-claim-${index}`,
      supplier_entity_id: record.supplier_entity_id,
      claim_type: "volume",
      field_path: "commercial.production_capacity",
      normalized_value: value,
      claim_text: `commercial.production_capacity: ${value}`,
      status: "externally_verified",
      confidence: "medium",
      conflict_status: "single_source",
      evidence_ids: [index === 0 ? "capacity-a" : "capacity-b"],
    }));
    const evidence: EvidenceSourceV3[] = claims.map((claim, index) => ({
      evidence_id: claim.evidence_ids[0]!,
      source_id: `capacity-source-${index}`,
      source_url: `https://retained.example/site-${index}`,
      source_title: `Production site ${index + 1}`,
      publisher: "Retained Supplier",
      source_type: "official_website",
      retrieved_at: "2026-09-12T00:00:00Z",
      freshness_status: "current",
      verification_status: "externally_verified",
      excerpt_summary: claim.claim_text,
      supports_claim_ids: [claim.claim_id],
      contradicts_claim_ids: [],
    }));
    const original = structuredClone({ record, claims, evidence });
    render(
      <SupplierDossierModal
        supplier={record}
        claims={claims}
        evidenceSources={evidence}
        isOpen
        onClose={() => {}}
      />,
    );
    const disclosure = screen
      .getByText("Other recorded values")
      .closest("details")!;
    fireEvent.click(within(disclosure).getByText("Other recorded values"));
    expect(
      within(disclosure).getByText("100 tonnes per month"),
    ).toBeInTheDocument();
    expect(
      within(disclosure).getByText("2400 tonnes per year"),
    ).toBeInTheDocument();
    expect(
      within(disclosure).getByText(
        /Sources may describe different dates, sites or product variants/,
      ),
    ).toBeInTheDocument();
    for (const source of evidence)
      expect(
        within(disclosure).getByRole("link", {
          name: source.source_title,
          hidden: true,
        }),
      ).toHaveAttribute("href", source.source_url);
    expect(
      within(disclosure).queryByText(/confirmed conflict/i),
    ).not.toBeInTheDocument();
    expect({ record, claims, evidence }).toEqual(original);
  });

  it.each(["verified", "claimed", "unverified", "not_applicable"] as const)(
    "uses a positive contact indicator only for verified status (%s)",
    (status) => {
      render(
        <SupplierDossierModal
          supplier={supplier({
            contacts: { verification_status: status, contact_evidence_ids: [] },
          })}
          isOpen
          onClose={() => {}}
        />,
      );
      const badge = screen.getByText(status.replaceAll("_", " "));
      if (status === "verified") expect(badge).toHaveClass("bg-emerald-100");
      else expect(badge).not.toHaveClass("bg-emerald-100");
    },
  );

  it("renders historical V3 records through the same cards and dossier without invented commercial or certification facts", () => {
    const data = output([supplier()]);
    const original = structuredClone(data);
    const onBack = vi.fn();
    render(<ConsultantResultView result={data} onBack={onBack} />);
    expect(
      screen.getByRole("heading", { name: "Saved supplier research" }),
    ).toBeVisible();
    expect(
      screen.getByText("Supplier registration needs independent confirmation."),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: /View supplier details/ }),
    );
    const dialog = within(screen.getByRole("dialog"));
    expect(
      dialog.getByText("Headquarters:").nextElementSibling,
    ).toHaveTextContent(data.supplier_candidates[0]!.headquarters_address);
    expect(
      dialog.getByText("Production Capacity:").parentElement,
    ).toHaveTextContent("Not established");
    for (const invented of [
      /50,000/,
      /official corporate registry/i,
      /cold.chain.guaranteed/i,
      /ISO 9001/,
      /HACCP/,
      /1 container/,
    ])
      expect(dialog.queryByText(invented)).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Close modal" }));
    fireEvent.click(screen.getByRole("button", { name: "Return to runs" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(data).toEqual(original);
  });

  it("reveals existing historical candidates in rank order without fetching or changing saved records", () => {
    const records = Array.from({ length: 6 }, (_, index) =>
      supplier({
        legal_name: `Supplier ${6 - index}`,
        candidate_id: `candidate-${index}`,
        supplier_entity_id: `supplier-${index}`,
        assessment: { ...supplier().assessment, rank: 6 - index },
      }),
    );
    const data = output(records);
    const original = structuredClone(data);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ConsultantResultView result={data} onBack={() => {}} />);
    expect(
      screen.queryByRole("heading", { name: "Supplier 6" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Show next suppliers/ }),
    );
    expect(
      screen
        .getAllByRole("heading", { name: /^Supplier \d$/ })
        .map((element) => element.textContent),
    ).toEqual([
      "Supplier 1",
      "Supplier 2",
      "Supplier 3",
      "Supplier 4",
      "Supplier 5",
      "Supplier 6",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(data).toEqual(original);
  });

  it("preserves a matching versioned artifact download and surfaces its failed response", async () => {
    const data = output([supplier()]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Not ready", { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ConsultantResultView
        result={data}
        onBack={() => {}}
        artifactDownload={{
          run_id: data.research_run_id,
          artifact_version_id: "artifact-v2",
          version: 2,
          href: "/api/v1/artifacts/artifact-v2/download",
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Download Full PDF Report" }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/artifacts/artifact-v2/download",
        expect.objectContaining({ credentials: "same-origin", method: "GET" }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "PDF download failed: PDF request returned HTTP 409",
    );
  });

  it("binds a generic historical PDF link to the saved execution rather than the latest run output", async () => {
    const data = output([supplier()]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Not ready", { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ConsultantResultView
        result={data}
        onBack={() => {}}
        artifactDownload={{
          run_id: data.research_run_id,
          artifact_version_id: `${data.research_run_id}-v1`,
          version: 1,
          href: `/api/v1/consultant/reports/${data.research_run_id}/pdf`,
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Download Full PDF Report" }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/consultant/reports/${encodeURIComponent(data.research_run_id)}/pdf?execution_id=${encodeURIComponent(data.execution_id)}`,
        expect.objectContaining({ credentials: "same-origin" }),
      ),
    );
    await screen.findByRole("status");
  });
});
