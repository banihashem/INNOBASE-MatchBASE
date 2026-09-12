import assert from "node:assert/strict";
import test from "node:test";
import {
  GOLDEN_SCENARIO_V3_01,
  type ConsultantResearchOutputV3,
  type SupplierEntityV3,
} from "@matchbase/contracts";
import { generateConsultantLandscapeHtml } from "../src/consultant-landscape-report.js";

function fixture(
  supplier: Partial<SupplierEntityV3>,
): ConsultantResearchOutputV3 {
  return {
    ...GOLDEN_SCENARIO_V3_01,
    supplier_candidates: [
      { ...GOLDEN_SCENARIO_V3_01.supplier_candidates[0]!, ...supplier },
    ],
  };
}

function section(html: string, id: string): string {
  const start = html.indexOf(`<section class="page" id="${id}">`);
  assert.notEqual(start, -1, `Section ${id} must exist`);
  return html.slice(start, html.indexOf("</section>", start));
}

test("MB-UX-QUALITY-001 L06 PDF names the location basis without turning headquarters into registration or origin", () => {
  const output = fixture({
    country_of_registration: "Not verified",
    headquarters_address: "Industrial Avenue, Porto, Portugal",
    manufacturing_locations: ["Valencia, Spain"],
    offering: {
      ...GOLDEN_SCENARIO_V3_01.supplier_candidates[0]!.offering,
      country_of_origin: "Italy",
    },
  });
  const saved = structuredClone(output);
  const html = generateConsultantLandscapeHtml(output);
  const landscape = section(html, "landscape-0");
  const profile = section(html, "supplier-0");
  assert.match(
    landscape,
    /Headquarters:<\/b> Industrial Avenue, Porto, Portugal/,
  );
  assert.match(
    profile,
    /<th>Country of registration<\/th><td>Not established<\/td>/,
  );
  assert.match(
    profile,
    /<th>Headquarters<\/th><td>Industrial Avenue, Porto, Portugal<\/td>/,
  );
  assert.match(
    profile,
    /<th>Manufacturing locations<\/th><td>Valencia, Spain<\/td>/,
  );
  assert.match(profile, /<th>Product origin<\/th><td>Italy<\/td>/);
  assert.doesNotMatch(
    html,
    /Registered headquarters|Country \/ role|Country \/ company role/,
  );
  assert.deepEqual(
    output,
    saved,
    "PDF rendering must not rewrite saved observations",
  );
});

test("MB-UX-QUALITY-001 L06 PDF retains explicitly stated specification origins without inferring from headquarters or overwriting canonical origin", () => {
  const output = fixture({
    headquarters_address: "Dubai, United Arab Emirates",
    country_of_registration: "United Arab Emirates",
    offering: {
      ...GOLDEN_SCENARIO_V3_01.supplier_candidates[0]!.offering,
      country_of_origin: "Unknown",
      specifications: {
        origin: "Made In China",
        place_of_origin: "China",
        "Country Of Origin": "India",
      },
    },
  });
  const saved = structuredClone(output);
  const profile = section(
    generateConsultantLandscapeHtml(output),
    "supplier-0",
  );
  assert.match(
    profile,
    /<th>Origin stated in specifications<\/th><td>origin: Made In China; place_of_origin: China; Country Of Origin: India<\/td>/,
  );
  assert.deepEqual(output, saved);
  const base = output.supplier_candidates[0]!;
  const canonical = section(
    generateConsultantLandscapeHtml(
      fixture({
        ...base,
        offering: { ...base.offering, country_of_origin: "Germany" },
      }),
    ),
    "supplier-0",
  );
  assert.match(canonical, /<th>Product origin<\/th><td>Germany<\/td>/);
  assert.match(canonical, /<th>origin<\/th><td>Made In China<\/td>/);
  assert.doesNotMatch(canonical, /<th>Origin stated in specifications<\/th>/);
  const absent = section(
    generateConsultantLandscapeHtml(
      fixture({
        ...base,
        offering: {
          ...base.offering,
          specifications: { origin_port: "Dubai" },
        },
      }),
    ),
    "supplier-0",
  );
  assert.match(absent, /<th>Product origin<\/th><td>Not established<\/td>/);
});

test("MB-UX-QUALITY-001 L06 PDF retains registration and manufacturing fallback labels and missing identity uncertainty", () => {
  const registration = generateConsultantLandscapeHtml(
    fixture({
      country_of_registration: "Ireland",
      headquarters_address: "Not verified",
      manufacturing_locations: ["Poland"],
    }),
  );
  assert.match(
    section(registration, "landscape-0"),
    /Registered country:<\/b> Ireland/,
  );
  const manufacturing = generateConsultantLandscapeHtml(
    fixture({
      country_of_registration: "Unknown",
      headquarters_address: " ",
      manufacturing_locations: ["Poland"],
    }),
  );
  assert.match(
    section(manufacturing, "landscape-0"),
    /Manufacturing location(?:s)?:<\/b> Poland/,
  );
  const missing = generateConsultantLandscapeHtml(
    fixture({
      country_of_registration: "Unknown",
      headquarters_address: "Not verified",
      manufacturing_locations: [],
    }),
  );
  assert.match(
    section(missing, "landscape-0"),
    /Supplier location:<\/b> Not established/,
  );
  assert.match(section(missing, "supplier-0"), /Identity not_assessed/);
});

test("MB-UX-QUALITY-001 L06 PDF preserves all contact channels and link provenance without upgrading verification", () => {
  const output = fixture({
    website: "https://supplier.example/catalogue",
    primary_domain: null,
    contacts: {
      sales_email: "sales@supplier.example",
      export_email: "export@supplier.example",
      general_email: "office@supplier.example",
      phone: "+000 123456",
      whatsapp_business: "+000 654321",
      linkedin_company_url: "https://www.linkedin.com/company/supplier",
      other_official_social_urls: [
        "https://social.example/supplier",
        "javascript:alert(1)",
      ],
      contact_page_url: "https://supplier.example/contact",
      verification_status: "unverified",
      contact_evidence_ids: ["contact-evidence-1"],
    },
  });
  const profile = section(
    generateConsultantLandscapeHtml(output),
    "supplier-0",
  );
  for (const email of [
    "sales@supplier.example",
    "export@supplier.example",
    "office@supplier.example",
  ])
    assert.ok(profile.includes(email));
  assert.match(profile, /href="https:\/\/supplier\.example\/catalogue"/);
  assert.match(profile, /<th>Contact verification<\/th><td>unverified<\/td>/);
  assert.match(profile, /href="#evidence-contact-evidence-1"/);
  assert.match(profile, /<th>WhatsApp Business<\/th><td>\+000 654321<\/td>/);
  assert.match(
    profile,
    /href="https:\/\/www\.linkedin\.com\/company\/supplier"/,
  );
  assert.match(profile, /href="https:\/\/social\.example\/supplier"/);
  assert.ok(
    profile.includes("javascript:alert(1)"),
    "Unusable recorded channel remains plain text",
  );
  assert.doesNotMatch(profile, /href="javascript:/);
  assert.doesNotMatch(profile, /Official website|Official contact page/);

  const blanks = section(
    generateConsultantLandscapeHtml(
      fixture({
        website: null,
        primary_domain: null,
        contacts: {
          sales_email: " ",
          export_email: "export@supplier.example",
          general_email: "Not verified",
          verification_status: "unverified",
          contact_evidence_ids: [],
        },
      }),
    ),
    "supplier-0",
  );
  assert.match(blanks, /<th>Sales email<\/th><td>Not established<\/td>/);
  assert.match(
    blanks,
    /<th>Export email<\/th><td>export@supplier.example<\/td>/,
  );
  assert.match(blanks, /<th>General email<\/th><td>Not established<\/td>/);
  assert.match(blanks, /<b>Website:<\/b> Not established/);
});

test("MB-UX-QUALITY-001 L06 PDF retains zero and one-sided price bounds, source date and separate validity", () => {
  const commercial = {
    commercial_confidence: "not_assessed" as const,
    commercial_evidence_ids: ["price-evidence-1"],
    currency: "EUR",
    unit: "kg",
    price_date: "2026-09-10",
    price_validity: "2026-09-30",
  };
  for (const [bounds, expected] of [
    [{ price_min: 0, price_max: 0 }, "0 EUR / kg"],
    [{ price_min: 0, price_max: 12 }, "0 - 12 EUR / kg"],
    [{ price_max: 12 }, "Up to 12 EUR / kg"],
    [{ price_min: 12 }, "From 12 EUR / kg"],
  ] as const) {
    const html = generateConsultantLandscapeHtml(
      fixture({ commercial: { ...commercial, ...bounds } }),
    );
    assert.ok(section(html, "landscape-0").includes(expected));
    const profile = section(html, "supplier-0");
    assert.ok(profile.includes(expected));
    assert.match(profile, /<th>Price source date<\/th><td>2026-09-10<\/td>/);
    assert.match(profile, /<th>Price validity<\/th><td>2026-09-30<\/td>/);
    assert.match(profile, /href="#evidence-price-evidence-1"/);
    assert.match(section(html, "landscape-0"), /Price date: 2026-09-10/);
  }
  const undated = section(
    generateConsultantLandscapeHtml(
      fixture({
        commercial: {
          commercial_confidence: "not_assessed",
          commercial_evidence_ids: [],
          price_max: 12,
          currency: "Unknown",
          unit: "",
          price_validity: "2026-09-30",
        },
      }),
    ),
    "supplier-0",
  );
  assert.match(
    undated,
    /Up to 12 currency not established \/ unit not established/,
  );
  assert.match(undated, /<th>Price source date<\/th><td>Not established<\/td>/);
  const absent = section(
    generateConsultantLandscapeHtml(
      fixture({
        commercial: {
          commercial_confidence: "not_assessed",
          commercial_evidence_ids: [],
        },
      }),
    ),
    "supplier-0",
  );
  assert.match(absent, /Unknown \/ quotation required/);
  assert.doesNotMatch(absent, /0 USD|0 EUR/);
});

test("MB-UX-QUALITY-001 L06 PDF preserves contradictory identity evidence and its exact status", () => {
  const output = fixture({
    country_of_registration: "Ireland",
    headquarters_address: "Porto, Portugal",
  });
  const supplier = output.supplier_candidates[0]!;
  const conflicting = {
    ...output,
    claims: [
      {
        ...output.claims[0]!,
        supplier_entity_id: supplier.supplier_entity_id,
        claim_text:
          "The reported registration country conflicts with the registry source.",
        status: "supplier_claimed" as const,
        conflict_status: "conflicting" as const,
        evidence_ids: ["conflicting-registry-source"],
      },
    ],
  };
  const dossier = section(
    generateConsultantLandscapeHtml(conflicting),
    "dossier-0",
  );
  assert.ok(dossier.includes(conflicting.claims[0]!.claim_text));
  assert.ok(dossier.includes("supplier_claimed"));
  assert.ok(dossier.includes("conflicting"));
  assert.match(dossier, /href="#evidence-conflicting-registry-source"/);
});

test("MB-UX-QUALITY-001 L06 PDF exposes linked alternative observations without declaring a contradiction or changing the summary", () => {
  const output = fixture({});
  const supplier = output.supplier_candidates[0]!;
  const claims = ["Advance payment", "Net 30 days"].map((value, index) => ({
    ...output.claims[0]!,
    claim_id: `payment-claim-${index}`,
    supplier_entity_id: supplier.supplier_entity_id,
    field_path: "commercial.payment_terms",
    claim_text: `commercial.payment_terms: ${value}`,
    normalized_value: value,
    status: "supplier_claimed" as const,
    evidence_ids: [`payment-source-${index}`],
  }));
  const sources = claims.map((claim, index) => ({
    ...output.evidence_sources[0]!,
    evidence_id: `payment-source-${index}`,
    supports_claim_ids: [claim.claim_id],
    contradicts_claim_ids: [],
  }));
  const withVariants = { ...output, claims, evidence_sources: sources };
  const saved = structuredClone(withVariants);
  const dossier = section(
    generateConsultantLandscapeHtml(withVariants),
    "dossier-0",
  );
  assert.match(dossier, /Other recorded values/);
  assert.match(dossier, /Source dates, sites or product variants may differ/);
  assert.match(dossier, /do not by themselves establish a contradiction/);
  assert.match(dossier, /<td>Advance payment<\/td>/);
  assert.match(dossier, /<td>Net 30 days<\/td>/);
  for (const source of sources)
    assert.ok(dossier.includes(`href="#evidence-${source.evidence_id}"`));
  assert.deepEqual(withVariants, saved);
  const unlinked = section(
    generateConsultantLandscapeHtml({
      ...withVariants,
      evidence_sources: sources.map((source) => ({
        ...source,
        supports_claim_ids: [],
      })),
    }),
    "dossier-0",
  );
  assert.doesNotMatch(unlinked, /Other recorded values/);
  assert.ok(
    unlinked.includes(claims[0]!.claim_text),
    "Unlinked claims remain disclosed in the original claim register",
  );
});
