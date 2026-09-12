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
