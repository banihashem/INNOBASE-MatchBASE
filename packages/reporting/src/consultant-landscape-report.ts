import {
  formatApprovedFactV3,
  parseApprovedRequestFactsV3,
  type ConsultantResearchOutputV3,
  type SupplierEntityV3,
} from "@matchbase/contracts";

/** Detect untranslated scripts without treating accented legal names or units as a translation. */
const hasUntranslatedScript = (text: string): boolean =>
  /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(
    text.replace(/[\u03a9\u03bc]/gu, ""),
  );

export class ConsultantReportLanguageError extends Error {
  readonly code = "MB-422-PDF-ENGLISH-REQUIRED";
  readonly status = 422;
  constructor() {
    super(
      "An English report cannot be produced from untranslated content. The saved findings remain unchanged; an English interpretation of that content is required.",
    );
    this.name = "ConsultantReportLanguageError";
  }
}

function englishOverview(output: ConsultantResearchOutputV3): string {
  const count = output.supplier_candidates.length;
  const approved = output.approved_request_snapshot;
  const product =
    approved?.product_name || output.request_snapshot.product_name;
  const scope =
    product && !hasUntranslatedScript(product) ? ` for ${product}` : "";
  const priceCount = output.supplier_candidates.filter(
    (s) =>
      s.commercial.price_min !== undefined ||
      s.commercial.price_max !== undefined,
  ).length;
  const contactCount = output.supplier_candidates.filter(
    (s) =>
      s.contacts?.sales_email ||
      s.contacts?.export_email ||
      s.contacts?.general_email ||
      s.contacts?.phone,
  ).length;
  return `${count} supplier profiles, ${output.evidence_sources.length} evidence sources and ${output.claims.length} claims are retained${scope}. ${count ? "The supplier dossiers retain their recorded fit assessments and unresolved validation requirements; inclusion does not establish full compliance with the buyer's request." : "No supplier profile passed the publication requirements in this result, so no supplier ranking can be presented. Recorded sources remain available in the source register; their existence alone does not establish an eligible supplier."} ${priceCount} profiles contain an observed price and ${contactCount} contain business contact data. The complete approved English request below remains authoritative, including requirements not represented by typed fields. Review source observations, missing evidence, commercial limitations and recorded costs in the remaining report sections.`;
}

const esc = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const display = (value: unknown): string =>
  value === undefined || value === null || value === ""
    ? "Unknown / not evidenced"
    : Array.isArray(value)
      ? value.length
        ? value.map(esc).join("; ")
        : "Not recorded"
      : esc(value);
const link = (url: string | undefined | null, label?: string): string =>
  url && /^https?:\/\//i.test(url)
    ? `<a href="${esc(url)}">${esc(label || url)}</a>`
    : display(url);
const list = (items: readonly string[] | undefined): string =>
  items?.length
    ? `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
    : '<p class="muted">Not recorded.</p>';
const rows = (items: readonly (readonly [string, unknown])[]): string =>
  `<table class="facts"><tbody>${items.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${display(value)}</td></tr>`).join("")}</tbody></table>`;
const refs = (ids: readonly string[] | undefined): string =>
  ids?.length
    ? ids
        .map((id) => `<a href="#evidence-${esc(id)}">[${esc(id)}]</a>`)
        .join(" ")
    : '<span class="muted">No linked evidence</span>';
const price = (s: SupplierEntityV3): string => {
  const c = s.commercial;
  if (c.price_min === undefined && c.price_max === undefined)
    return "Unknown / quotation required";
  return `${c.price_min ?? "?"}${c.price_max !== undefined && c.price_max !== c.price_min ? ` - ${c.price_max}` : ""} ${c.currency ?? "currency unknown"} / ${c.unit ?? "unit unknown"}`;
};

/** Full supplier landscape, rendered from run-bound approved facts and observed evidence only. */
export function generateConsultantLandscapeHtml(
  output: ConsultantResearchOutputV3,
): string {
  if (
    output.claims.some((claim) =>
      hasUntranslatedScript(
        JSON.stringify([claim.claim_text, claim.normalized_value, claim.unit]),
      ),
    )
  )
    throw new ConsultantReportLanguageError();
  const suppliers = output.supplier_candidates ?? [];
  const approved = output.approved_request_snapshot;
  const demo = output.research_mode === "fixture";
  const reconstructedOverview = hasUntranslatedScript(
    output.executive_summary.direct_answer,
  );
  const directAnswer = reconstructedOverview
    ? englishOverview(output)
    : output.executive_summary.direct_answer;
  // Report-only display projection: never rewrite the approved snapshot or its audit hashes.
  const reconstructedFacts =
    !!approved &&
    hasUntranslatedScript(
      JSON.stringify([approved.facts, approved.unparsed_clauses]),
    );
  const approvedDisplay =
    approved && reconstructedFacts
      ? parseApprovedRequestFactsV3(approved.approved_translation)
      : approved;
  const presentationNotice =
    reconstructedOverview || reconstructedFacts
      ? '<p class="presentation-note">English presentation reconstructed from the saved structured findings and approved English request. This is not a new research or translation call. The original narrative and approval record remain unchanged; source observations, requirements, uncertainty and recorded costs are retained below.</p>'
      : "";
  const sections: string[] = [];
  const banner = demo
    ? '<div class="notice">DEMONSTRATION - Illustrative profiles and commercial observations. External supplier capability has not been verified.</div>'
    : '<div class="live">LIVE RESEARCH - Read the evidence status and unresolved gaps for each claim.</div>';
  const section = (title: string, content: string, id: string): void => {
    sections.push(
      `<section class="page" id="${esc(id)}"><header><span>INNOBASE / MatchBASE</span><span>${esc(output.as_of_date)} / ${esc(output.research_status)}</span></header>${banner}<h1>${esc(title)}</h1>${content}<footer>Run ${esc(output.research_run_id)} | ${approved ? `Approved revision ${esc(approved.revision_id)}` : "Approved request lineage unavailable"}</footer></section>`,
    );
  };

  section(
    "Supplier Landscape and Procurement Assessment",
    `<div class="cover-title">${esc(output.request_snapshot.product_name || output.title)}</div><p class="lead">${esc(directAnswer)}</p>${presentationNotice}<div class="metrics"><div><b>${suppliers.length}</b><span>Distinct supplier profiles</span></div><div><b>${output.evidence_sources.length}</b><span>Recorded evidence sources</span></div><div><b>${output.claims.length}</b><span>Recorded claims</span></div><div><b>${esc(output.executive_summary.confidence_assessment)}</b><span>Evidence confidence</span></div></div><h2>Executive findings</h2>${list(output.executive_summary.key_findings)}<h2>Reading this report</h2><p>The approved request defines the buyer's requirements. The landscape and detailed supplier dossiers describe observed offerings. Compatibility, evidence confidence and unresolved commercial questions are presented separately.</p><ol><li><a href="#approved-request">Approved request and traceability</a></li><li><a href="#methodology">Evaluation method and evidence boundaries</a></li><li><a href="#landscape-0">Complete supplier landscape</a></li><li><a href="#supplier-0">Detailed supplier dossiers and claim evidence</a></li><li><a href="#rfq">RFQ and due diligence plan</a></li><li><a href="#source-register">Source register and disclosures</a></li></ol>`,
    "executive-summary",
  );

  const factRows =
    approvedDisplay?.facts
      .map(
        (fact) =>
          `<tr><td>${esc(fact.label)}</td><td>${esc(formatApprovedFactV3(fact))}</td><td>${esc(fact.operator)}</td><td>${esc(fact.source_clause)}</td></tr>`,
      )
      .join("") ?? "";
  section(
    "Approved Request and Traceability",
    approved
      ? `${rows([
          ["Approved revision", approved.revision_id],
          ["Approved at", approved.approved_at],
          ["Content SHA-256", approved.content_hash],
          ["Source intake SHA-256", approved.source_intake_hash],
          [
            "Product classification",
            `${output.primary_classification.scheme} ${output.primary_classification.code} - ${output.primary_classification.label} (${output.primary_classification.confidence})`,
          ],
        ])}<h2>Approved interpretation - complete text</h2><div class="approved-text">${esc(approved.approved_translation)}</div><h2>Structured buyer requirements</h2>${factRows ? `<table><thead><tr><th>Requirement</th><th>Approved value</th><th>Operator</th><th>Provenance in approved text</th></tr></thead><tbody>${factRows}</tbody></table>` : "<p>No typed facts were extracted. The complete approved interpretation remains authoritative; no values have been substituted.</p>"}${approvedDisplay?.unparsed_clauses.length ? `<h2>Additional approved clauses</h2><p>These clauses remain part of the request even where a typed projection is unavailable.</p>${list(approvedDisplay.unparsed_clauses)}` : ""}`
      : '<div class="notice">This historical record has no trustworthy approved request snapshot. Buyer facts are unknown. Historical template values have not been backfilled.</div>',
    "approved-request",
  );

  section(
    "Evaluation Method and Evidence Boundaries",
    `<p>This report uses the actual supplier assessments and linked source records from this run. ${demo ? "Demonstration scores are sample values and do not establish a match to the approved request." : "A fit score is an assessment, not independent proof of a supplier claim."}</p><h2>MatchBASE comparison dimensions</h2>${rows(
      [
        ["Category and product fit", "25%"],
        ["Compliance and certification fit", "20%"],
        ["Volume and capacity fit", "15%"],
        ["Price tier fit", "15%"],
        ["Positioning and brand fit", "15%"],
        ["Geographic reach fit", "10%"],
      ],
    )}<h2>Evidence rules</h2><ul><li>Company identity, exact product, contact details, authorization and commercial terms require their own supporting sources.</li><li>Supplier claims, inferred observations, unknown values and corroborated facts retain their separate status.</li><li>Currency, unit, Incoterm, place, date, quantity basis and quotation validity must align before prices are compared.</li><li>Missing evidence does not prove a supplier is ineligible; it remains an unresolved validation item.</li><li>Stock signals do not establish available quantity, current warehouse stock or export acceptance.</li></ul>${rows(
      [
        ["Research mode", output.research_mode],
        ["Research status", output.research_status],
        [
          "Verification loops recorded",
          output.telemetry.verification_loops_count,
        ],
        ["Source cut-off", output.as_of_date],
        ["Coverage", output.executive_summary.research_coverage_status],
      ],
    )}`,
    "methodology",
  );

  if (output.price_research) {
    const pricing = output.price_research;
    const englishPriceText = (value: string | null | undefined): string =>
      value && hasUntranslatedScript(value)
        ? "Original-language detail retained at source"
        : value || "Unknown / not evidenced";
    for (
      let offset = 0;
      offset < Math.max(1, pricing.observations.length);
      offset += 5
    ) {
      const group = pricing.observations.slice(offset, offset + 5);
      section(
        "Recent Public Price Research",
        `<p>Search recorded at ${esc(pricing.searched_at)}. Search windows: ${esc(pricing.searched_windows_days.join(" then "))} days. ${pricing.status === "incomplete" ? "Price research is incomplete." : pricing.status === "no_recent_prices" ? "No usable recent public price was established." : "Source-dated price observations were found."}</p><p>Prices under seven days are preferred; the search broadens to under thirty days only if no usable seven-day price is established. Freshness is measured at the saved search time, not the time this PDF is opened. A public supplier listing is not a binding quotation; a market benchmark is not attributed to a supplier. Different products, grades, quantity scopes, currencies, units, routes or Incoterms must not be combined.</p>${list(pricing.limitations)}${group
          .map(
            (price) =>
              `<h2>${price.provenance === "supplier_listing" ? "Public supplier listing" : "Market benchmark"}</h2>${rows(
                [
                  [
                    "Supplier",
                    price.provenance === "supplier_listing"
                      ? englishPriceText(price.supplier_name)
                      : "Not attributed to a supplier",
                  ],
                  [
                    "Product / service",
                    englishPriceText(price.product_or_service),
                  ],
                  [
                    "Observed price",
                    `${price.price_min}${price.price_max !== price.price_min ? ` - ${price.price_max}` : ""} ${englishPriceText(price.currency)} / ${englishPriceText(price.unit)}`,
                  ],
                  ["Quantity basis", englishPriceText(price.quantity_basis)],
                  ["Route / market", englishPriceText(price.route_or_market)],
                  ["Incoterm", englishPriceText(price.incoterm)],
                  [
                    price.date_basis === "published"
                      ? "Source publication date"
                      : "Price effective date",
                    price.source_published_at,
                  ],
                  ["Validity end", price.valid_until],
                  ["Age at search", `${price.age_days.toFixed(1)} days`],
                  [
                    "Relevance / limitations",
                    englishPriceText(price.relevance_note),
                  ],
                ],
              )}<p>${link(price.source_url, englishPriceText(price.source_title))}</p><p>${esc(englishPriceText(price.quote))}</p><p>${esc(englishPriceText(price.date_quote))}</p>`,
          )
          .join("")}`,
        `recent-prices-${offset}`,
      );
    }
  }

  for (let offset = 0; offset < Math.max(suppliers.length, 1); offset += 5) {
    const group = suppliers.slice(offset, offset + 5);
    section(
      suppliers.length
        ? `Supplier Landscape - ${offset + 1} to ${Math.min(offset + 5, suppliers.length)} of ${suppliers.length}`
        : "Supplier Landscape - No Published Profiles",
      group.length
        ? `<table class="landscape"><thead><tr><th>Rank / supplier</th><th>Country / role</th><th>Product / model</th><th>Fit / evidence</th><th>Observed price / terms</th><th>Principal gap</th></tr></thead><tbody>${group.map((s, i) => `<tr><td><a href="#supplier-${offset + i}">${s.assessment.rank}. ${esc(s.legal_name)}</a></td><td>${esc(s.country_of_registration)}<br>${esc(s.manufacturer_status)}</td><td>${esc(s.offering.product_name)}<br>${display(s.offering.model_or_sku)}</td><td>${esc(s.assessment.compatibility_score)} / ${esc(s.assessment.fit_band)}<br>Evidence: ${esc(s.assessment.evidence_confidence)}</td><td>${esc(price(s))}<br>${display(s.commercial.incoterm)} ${display(s.commercial.incoterm_location)}</td><td>${display(s.assessment.limiting_gaps[0] ?? s.assessment.unknowns[0])}</td></tr>`).join("")}</tbody></table>`
        : "<p>No supplier candidates were returned. Buyer requirements remain available above; no company profiles have been invented.</p>",
      `landscape-${offset}`,
    );
  }

  suppliers.forEach((s, index) => {
    const c = s.contacts;
    section(
      `${s.assessment.rank}. ${s.legal_name}`,
      `<div class="profile-top"><strong>${esc(s.assessment.fit_band)} / ${esc(s.assessment.compatibility_score)} fit score</strong><span>Evidence ${esc(s.assessment.evidence_confidence)} | Identity ${esc(s.identity_confidence)} | Completeness ${esc(s.assessment.data_completeness)}%</span></div><div class="columns"><div><h2>Company identity and direct contact</h2>${rows(
        [
          [
            "Trading name / brands",
            [s.trading_name, ...s.brand_names].filter(Boolean),
          ],
          [
            "Country / company role",
            `${s.country_of_registration} / ${s.supplier_type} / ${s.manufacturer_status}`,
          ],
          ["Registered headquarters", s.headquarters_address],
          ["Manufacturing locations", s.manufacturing_locations],
          [
            "Registry identifiers",
            s.registry_identifiers
              ? Object.entries(s.registry_identifiers).map(
                  ([k, v]) => `${k}: ${v}`,
                )
              : undefined,
          ],
        ],
      )}<p><b>Official website:</b> ${link(s.website)}</p><p><b>Official contact page:</b> ${link(c?.contact_page_url)}</p>${rows(
        [
          [
            "Sales / export email",
            c?.sales_email ?? c?.export_email ?? c?.general_email,
          ],
          ["Telephone", c?.phone],
          ["Contact verification", c?.verification_status],
        ],
      )}<p>${refs(s.identity_evidence_ids)} ${refs(c?.contact_evidence_ids)}</p></div><div><h2>Observed offering</h2>${rows(
        [
          ["Product", s.offering.product_name],
          [
            "Family / brand",
            `${s.offering.product_family} / ${s.offering.brand ?? "Unknown"}`,
          ],
          ["Model / SKU", s.offering.model_or_sku],
          ["Description", s.offering.description],
          [
            "Origin / manufacturing site",
            `${s.offering.country_of_origin} / ${s.offering.manufacturing_site ?? "Unknown"}`,
          ],
          ["Use cases", s.offering.use_cases],
        ],
      )}<h3>Observed specifications</h3>${rows(Object.entries(s.offering.specifications))}<p>${refs(s.offering.product_evidence_ids)}</p></div></div><div class="columns"><div><h2>Commercial observation</h2>${rows(
        [
          ["Observed price", price(s)],
          [
            "Price type / confidence",
            `${s.commercial.price_type ?? "Unknown"} / ${s.commercial.commercial_confidence}`,
          ],
          [
            "Incoterm / named place",
            `${s.commercial.incoterm ?? "Unknown"} / ${s.commercial.incoterm_location ?? "Unknown"}`,
          ],
          [
            "MOQ / production capacity",
            `${s.commercial.moq ?? "Unknown"} / ${s.commercial.production_capacity ?? "Unknown"}`,
          ],
          ["Lead time", s.commercial.lead_time],
          ["Payment terms", s.commercial.payment_terms],
          ["Price validity", s.commercial.price_validity],
        ],
      )}<p>${refs(s.commercial.commercial_evidence_ids)}</p></div><div><h2>Decision notes</h2><h3>Positive drivers</h3>${list(s.assessment.positive_drivers)}<h3>Limiting gaps and unknowns</h3>${list([...s.assessment.limiting_gaps, ...s.assessment.unknowns])}<h3>Required next validation</h3>${list(s.assessment.required_validation)}<p>${esc(s.assessment.recommended_next_action)}</p></div></div>`,
      `supplier-${index}`,
    );
    const claims = output.claims.filter(
      (claim) => claim.supplier_entity_id === s.supplier_entity_id,
    );
    section(
      `${s.legal_name} - Verification Dossier`,
      `<h2>Buyer requirement reference</h2><p>${approved ? `Approved revision ${esc(approved.revision_id)} / SHA-256 ${esc(approved.content_hash)}. Assessments below must be read against the complete approved request.` : "Approved request lineage is unavailable; current buyer compliance cannot be inferred."}</p><h2>Mandatory constraint results</h2>${s.assessment.mandatory_constraint_results.length ? `<table><thead><tr><th>Constraint</th><th>Recorded result</th><th>Evidence</th></tr></thead><tbody>${s.assessment.mandatory_constraint_results.map((r) => `<tr><td>${esc(r.constraint)}</td><td>${demo ? "Illustrative / not evaluated for this request" : r.satisfied ? "Recorded as satisfied - inspect evidence" : "Not established / validation required"}</td><td>${refs(r.evidence_ids)}</td></tr>`).join("")}</tbody></table>` : "<p>No constraint-level result is recorded.</p>"}<div class="columns"><div><h2>Certificates and compliance scope</h2>${
        s.certifications.length
          ? s.certifications
              .map(
                (cert) =>
                  `<article><h3>${esc(cert.certification_name)}</h3>${rows([
                    [
                      "Issuer / certificate",
                      `${cert.issuer ?? "Unknown"} / ${cert.certificate_number ?? "Unknown"}`,
                    ],
                    ["Scope", cert.scope],
                    [
                      "Status / verification",
                      `${cert.status} / ${cert.verification_status}`,
                    ],
                    [
                      "Validity",
                      `${cert.valid_from ?? "Unknown"} to ${cert.valid_until ?? "Unknown"}`,
                    ],
                    [
                      "Destination relevance",
                      cert.destination_market_relevance,
                    ],
                  ])}<p>${refs(cert.evidence_ids)}</p></article>`,
              )
              .join("")
          : "<p>No certificate evidence is recorded.</p>"
      }<h2>Risk flags</h2>${list(s.assessment.risk_flags)}</div><div><h2>Packaging and logistics</h2>${
        s.packaging_and_logistics
          ? rows(
              Object.entries(s.packaging_and_logistics)
                .filter(([key]) => key !== "logistics_evidence_ids")
                .map(([key, val]) => [key.replaceAll("_", " "), val] as const),
            )
          : "<p>Unknown / not evidenced.</p>"
      }<p>${refs(s.packaging_and_logistics?.logistics_evidence_ids)}</p><h2>Dimension scores</h2>${rows(Object.entries(s.assessment.dimension_scores).map(([key, value]) => [key.replaceAll("_", " "), value] as const))}</div></div><h2>Claim-level evidence</h2>${claims.length ? `<table><thead><tr><th>Claim</th><th>Status / confidence / conflict</th><th>Evidence</th></tr></thead><tbody>${claims.map((claim) => `<tr><td>${esc(claim.claim_text)}</td><td>${esc(claim.status)} / ${esc(claim.confidence)} / ${esc(claim.conflict_status)}</td><td>${refs(claim.evidence_ids)}</td></tr>`).join("")}</tbody></table>` : "<p>No supplier-specific claim records are linked. Treat uncited fields according to their recorded uncertainty.</p>"}`,
      `dossier-${index}`,
    );
  });

  section(
    "RFQ and Due Diligence Plan",
    `<p>This section defines validation work; it does not record supplier contact, purchase approval or transaction execution.</p><h2>Comparable RFQ packet</h2><ol><li>Attach the complete approved requirement and revision. Ask for exact model/SKU, drawings, quantities, specification deviations and named manufacturing site.</li><li>Request a signed quotation stating currency, unit, quantity basis, Incoterms 2020 term and named place, exclusions, delivery schedule, validity and payment terms.</li><li>Collect current certificates with issuer, scope, plant identification and expiry; verify the issuing source and destination requirements.</li><li>Obtain written stock or production allocation, warranty scope, local service/spares arrangements and shipment acceptance.</li><li>Verify the contracting entity, public corporate registry and beneficiary independently before contractual commitment.</li></ol><h2>Supplier-specific validation queue</h2><table><thead><tr><th>Supplier</th><th>Required validation</th><th>Next recorded action</th></tr></thead><tbody>${suppliers.map((s) => `<tr><td>${esc(s.legal_name)}</td><td>${display(s.assessment.required_validation)}</td><td>${esc(s.assessment.recommended_next_action)}</td></tr>`).join("")}</tbody></table><h2>Evidence-based sequencing</h2><p>Resolve critical identity, product and market-access gaps first. Compare commercial offers only after technical deviations and Incoterm scope have been reconciled. Release an RFQ or order only through the buyer's approval process.</p>`,
    "rfq",
  );

  section(
    "Source Register and Disclosures",
    `<h2>Evidence sources</h2>${
      output.evidence_sources.length
        ? output.evidence_sources
            .map((source) => {
              const host = (() => {
                try {
                  return new URL(source.source_url).hostname;
                } catch {
                  return "saved source";
                }
              })();
              const publisher = hasUntranslatedScript(source.publisher)
                ? `Original-language publisher (${host})`
                : source.publisher;
              const title = hasUntranslatedScript(source.source_title)
                ? `Original-language source - ${publisher || host}`
                : source.source_title;
              const linkedClaims = output.claims.filter(
                (claim) =>
                  claim.evidence_ids.includes(source.evidence_id) ||
                  source.supports_claim_ids.includes(claim.claim_id) ||
                  source.contradicts_claim_ids.includes(claim.claim_id),
              );
              const summary = hasUntranslatedScript(source.excerpt_summary)
                ? `Original-language quotation remains in the saved evidence and at the source link. The following are recorded English claim statements, not a translation or evidence of a full source review. ${
                    linkedClaims.length
                      ? linkedClaims
                          .map(
                            (claim) =>
                              `[${claim.claim_id}] ${claim.claim_text}`,
                          )
                          .join(" ")
                      : "Source retained; no published claim is attributed to this source."
                  }`
                : source.excerpt_summary;
              return `<article id="evidence-${esc(source.evidence_id)}" class="source"><h3>[${esc(source.evidence_id)}] ${esc(title)}</h3><p>${link(source.source_url, hasUntranslatedScript(source.source_url) ? host : undefined)}</p>${rows(
                [
                  ["Source ID", source.source_id],
                  ["Publisher / type", `${publisher} / ${source.source_type}`],
                  [
                    "Retrieved / published",
                    `${source.retrieved_at} / ${source.published_at ?? "Unknown"}`,
                  ],
                  [
                    "Verification / freshness",
                    `${source.verification_status} / ${source.freshness_status}`,
                  ],
                  ["Summary", summary],
                  ["Supports claims", source.supports_claim_ids],
                  ["Contradicts claims", source.contradicts_claim_ids],
                ],
              )}</article>`;
            })
            .join("")
        : "<p>No source records are available for this run. This absence is not a verification result.</p>"
    }<h2>Limitations and disclosures</h2>${output.limitations_and_disclosures.map((item) => `<article><h3>${esc(item.title)} (${esc(item.severity)})</h3><p>${esc(item.description)}</p></article>`).join("")}`,
    "source-register",
  );

  const visibleContent = sections.join("\n").replace(/<[^>]*>/g, "");
  if (
    hasUntranslatedScript(visibleContent) ||
    hasUntranslatedScript(output.title)
  )
    throw new ConsultantReportLanguageError();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(output.title)}</title><style>
  @page{size:A4 landscape}*{box-sizing:border-box}body{margin:0;font:8.5pt/1.25 Arial,Helvetica,sans-serif;color:#172b3a;background:#fff}a{color:#155e75;text-decoration:none;overflow-wrap:anywhere}h1{font-size:17pt;line-height:1.15;margin:8px 0 10px;letter-spacing:-.4px}h2{font-size:10.5pt;color:#123e55;margin:9px 0 5px}h3{font-size:9pt;margin:6px 0 3px}p{margin:4px 0 6px}ul,ol{margin:4px 0 8px;padding-left:19px}li{margin:2px 0}.page{break-before:page;padding:0}.page:first-child{break-before:auto}header{display:flex;justify-content:space-between;border-bottom:2px solid #0d766e;padding-bottom:8px;color:#164e63;font-size:9pt;font-weight:bold}footer{border-top:1px solid #ccd8dd;margin-top:12px;padding-top:6px;font-size:8pt;color:#475b67;overflow-wrap:anywhere}.notice,.live{padding:5px 8px;font-size:8pt;margin-top:8px;border-left:4px solid #b7791f;background:#fffbeb;color:#713f12}.live{border-color:#0f766e;background:#f0fdfa;color:#115e59}.cover-title{font-size:23pt;color:#0f4b60;margin:16px 0 10px;font-weight:bold;line-height:1.2}.lead{font-size:10pt;max-width:95%}.metrics{display:flex;gap:15px;margin:16px 0}.metrics>div{flex:1;background:#f0f6f8;border-top:3px solid #0f766e;padding:10px}.metrics b{display:block;font-size:20pt}.metrics span{display:block;font-size:9pt}.columns{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:6px 0;align-items:start}.profile-top{display:flex;justify-content:space-between;background:#eaf4f5;padding:7px;gap:12px}.approved-text{white-space:pre-wrap;border-left:3px solid #0f766e;padding:12px;background:#f8fafc;overflow-wrap:anywhere}.muted{color:#5b6871}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:6px 0 8px;font-size:8pt}th,td{text-align:left;vertical-align:top;padding:2px 5px;border:1px solid #d5dfe3;overflow-wrap:anywhere}th{background:#e9f1f4;font-weight:bold}thead{display:table-header-group}tr{break-inside:avoid}.facts th{width:34%;color:#29434f}.facts td{background:#fff}.landscape th:nth-child(1){width:19%}.landscape th:nth-child(3){width:20%}.source{break-inside:avoid;border-bottom:1px solid #d5dfe3;margin:12px 0;padding-bottom:7px}h1,h2,h3{break-after:avoid}article{margin:10px 0}p,li{orphans:3;widows:3}
  .page[id^="dossier-"] h1{font-size:15pt;margin-bottom:6px}.page[id^="dossier-"] h2{margin-top:6px}.page[id^="dossier-"] .columns{margin:4px 0}footer{display:none}
  </style></head><body>${sections.join("\n")}</body></html>`;
}
