import type {
  ConsultantResearchOutputV3,
  SupplierEntityV3,
} from "@matchbase/contracts";

export function generateConsultantLandscapeHtml(
  output: ConsultantResearchOutputV3,
): string {
  const escapeHtml = (val: string | undefined | null) =>
    (val ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const suppliers: readonly SupplierEntityV3[] =
    output.supplier_candidates ?? [];
  const domain = output.primary_classification.code.startsWith("0207")
    ? "poultry"
    : output.primary_classification.code.startsWith("8516")
      ? "water_heater"
      : "generic";

  const matrixPagesCount =
    suppliers.length === 0 ? 1 : Math.ceil(suppliers.length / 5);
  const totalPages = 4 + matrixPagesCount; // Cover (1) + Exec/Facts (2) + Matrix (N) + Commercial/Specs (N+1) + Lineage/Disclosures (N+2)

  const isDemo =
    output.research_mode === "fixture" ||
    output.telemetry.synthesis_model_id === "deterministic-fixture-engine.v3" ||
    output.telemetry.total_cost_usd === 0;

  const demoBannerHtml = isDemo
    ? `<div class="demo-banner">DEMONSTRATION RESEARCH &bull; NOT FOR COMMERCIAL RELIANCE &bull; SYNTHETIC ILLUSTRATIVE ENTITIES</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(output.title)}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 10mm 14mm 12mm 14mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 9.5pt;
      line-height: 1.35;
    }
    .page {
      page-break-after: always;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .page:last-child {
      page-break-after: avoid;
    }

    /* Demonstration Notice Banner */
    .demo-banner {
      background: #C41E3A;
      color: #ffffff;
      font-size: 7pt;
      font-weight: 800;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      text-align: center;
      padding: 3px 8px;
      border-radius: 4px;
      margin-bottom: 6px;
    }

    header.report-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #C41E3A;
      padding-bottom: 5px;
      margin-bottom: 10px;
    }
    .brand-title {
      font-size: 11pt;
      font-weight: 800;
      color: #C41E3A;
      letter-spacing: 0.5px;
    }
    .report-badge {
      background: #fdf2f4;
      color: #C41E3A;
      font-size: 7.5pt;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      border: 1px solid #fecdd3;
    }
    .report-badge-demo {
      background: #fff1f2;
      color: #9f1239;
      border: 1px solid #f43f5e;
    }
    footer.report-footer {
      display: flex;
      justify-content: space-between;
      border-top: 1px solid #e2e8f0;
      padding-top: 5px;
      margin-top: 10px;
      font-size: 7pt;
      color: #64748b;
    }

    /* Cover Page */
    .cover-page {
      justify-content: center;
      text-align: left;
      padding: 20px 16px;
    }
    .cover-title {
      font-size: 22pt;
      font-weight: 900;
      color: #0f172a;
      line-height: 1.15;
      margin: 0 0 6px 0;
    }
    .cover-subtitle {
      font-size: 12pt;
      color: #475569;
      margin: 0 0 18px 0;
      font-weight: 500;
    }
    .trace-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 18px;
    }
    .trace-item {
      font-size: 8pt;
    }
    .trace-label {
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      font-size: 6.5pt;
    }
    .trace-value {
      font-family: monospace;
      color: #0f172a;
      font-size: 8pt;
      word-break: break-all;
    }
    .disclaimer-box {
      background: #fff5f5;
      border-left: 4px solid #C41E3A;
      padding: 8px 12px;
      font-size: 7.5pt;
      color: #881337;
      border-radius: 0 4px 4px 0;
    }

    /* Section Headings */
    h2.section-heading {
      font-size: 13pt;
      font-weight: 800;
      color: #0f172a;
      margin: 0 0 8px 0;
    }

    /* Executive Summary Grid */
    .summary-grid {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 12px;
    }
    .card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px;
    }
    .card-title {
      font-size: 10pt;
      font-weight: 700;
      color: #C41E3A;
      margin-bottom: 5px;
    }
    .findings-list {
      margin: 0;
      padding-left: 14px;
    }
    .findings-list li {
      margin-bottom: 4px;
      font-size: 8.5pt;
    }

    /* Sourcing Table */
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7pt;
      margin-top: 5px;
    }
    table.data-table th {
      background: #1e293b;
      color: #ffffff;
      padding: 5px 6px;
      text-align: left;
      font-weight: 600;
    }
    table.data-table td {
      padding: 5px 6px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
    }
    table.data-table tr:nth-child(even) {
      background: #f8fafc;
    }
    .status-badge {
      display: inline-block;
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 6pt;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge-active {
      background: #dcfce7;
      color: #15803d;
    }
    .badge-conditional {
      background: #fef3c7;
      color: #b45309;
    }
    .badge-low-fit {
      background: #fee2e2;
      color: #b91c1c;
    }
    .score-pill {
      font-weight: 800;
      font-size: 8pt;
      color: #C41E3A;
    }
    .fixture-id-tag {
      font-family: monospace;
      font-size: 6.5pt;
      background: #f1f5f9;
      color: #475569;
      padding: 1px 4px;
      border-radius: 3px;
      display: inline-block;
      margin-top: 2px;
    }
    .mismatch-alert {
      background: #fff1f2;
      border: 1px solid #fecdd3;
      color: #9f1239;
      padding: 4px 6px;
      border-radius: 4px;
      font-size: 7pt;
      margin-top: 3px;
    }
  </style>
</head>
<body>

  <!-- PAGE 1: COVER SLIDE -->
  <section class="page cover-page">
    ${demoBannerHtml}
    <div style="margin-bottom: 12px; display: flex; gap: 8px;">
      <span class="report-badge">MatchBASE Consultant-Tier Intelligence Dossier</span>
      ${isDemo ? '<span class="report-badge report-badge-demo">Demonstration Research &bull; Illustrative Profiles</span>' : ""}
    </div>
    <h1 class="cover-title">${escapeHtml(output.title)}</h1>
    <p class="cover-subtitle">${escapeHtml(output.subtitle ?? "Structured Sourcing Landscape & Supplier Discovery")}</p>
    
    <div class="trace-grid">
      <div class="trace-item">
        <div class="trace-label">Research Run ID (UUID)</div>
        <div class="trace-value">${escapeHtml(output.research_run_id)}</div>
      </div>
      <div class="trace-item">
        <div class="trace-label">Execution ID (UUID)</div>
        <div class="trace-value">${escapeHtml(output.execution_id)}</div>
      </div>
      <div class="trace-item">
        <div class="trace-label">Classification ID (UUID)</div>
        <div class="trace-value">${escapeHtml(output.classification_id)}</div>
      </div>
      <div class="trace-item">
        <div class="trace-label">Tariff Code / Scheme</div>
        <div class="trace-value">${escapeHtml(output.primary_classification.code)} (${escapeHtml(output.primary_classification.scheme)}) - ${escapeHtml(output.primary_classification.label)}</div>
      </div>
      <div class="trace-item">
        <div class="trace-label">As of Date / Generation Timestamp</div>
        <div class="trace-value">${escapeHtml(output.as_of_date)} / ${escapeHtml(output.generated_at)}</div>
      </div>
      <div class="trace-item">
        <div class="trace-label">Dual-Lane Research Engine & Synthesis Model</div>
        <div class="trace-value">Lanes: [${output.telemetry.lanes_executed.join(", ")}] &bull; Synthesis: ${escapeHtml(output.telemetry.synthesis_model_id)} &bull; Loops: ${output.telemetry.verification_loops_count}</div>
      </div>
    </div>

    <div class="disclaimer-box">
      <strong>Corporate Integrity Notice:</strong> Demonstration dataset &mdash; not live market evidence. Illustrative supplier profiles synthesized for workflow validation and structural verification under MatchBASE Policy A. Not for commercial reliance, binding procurement commitments, or contract execution.
    </div>
    <footer class="report-footer">
      <div>Run ID: ${escapeHtml(output.research_run_id)}</div>
      <div>Page 1 of ${totalPages}</div>
    </footer>
  </section>

  <!-- PAGE 2: EXECUTIVE SUMMARY & REQUEST FACTS VS SOURCING BASIS -->
  <section class="page">
    ${demoBannerHtml}
    <header class="report-header">
      <div class="brand-title">MatchBASE / Consultant Landscape</div>
      <div class="report-badge">Executive Summary &amp; Request Alignment</div>
    </header>
    <div>
      <h2 class="section-heading">Strategic Overview &amp; Approved Request Alignment</h2>
      <div class="summary-grid">
        <div class="card">
          <div class="card-title">Executive Summary</div>
          <p style="font-size: 8.5pt; margin-top: 0;">${escapeHtml(output.executive_summary.direct_answer)}</p>
          <div class="card-title" style="margin-top: 8px;">Key Sourcing Findings</div>
          <ul class="findings-list">
            ${output.executive_summary.key_findings.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}
          </ul>
        </div>
        <div class="card">
          <div class="card-title">Approved Request Facts vs. Observed Sourcing Basis</div>
          <p style="font-size: 8pt;"><strong>Product:</strong> ${escapeHtml(output.request_snapshot.product_name)} (${escapeHtml(output.request_snapshot.product_category)})</p>
          <p style="font-size: 8pt;"><strong>Requested Delivery Terms:</strong> ${escapeHtml(output.request_snapshot.mandatory_constraints.find((c) => c.includes("CFR") || c.includes("CIF") || c.includes("DDP")) ?? "As specified in request")}</p>
          <p style="font-size: 8pt;"><strong>Target Candidates:</strong> ${output.total_candidates_found} found (Target: ${output.target_candidates_count})</p>
          ${
            domain === "poultry"
              ? `<div class="mismatch-alert">
                  <strong>Commercial Lineage Note:</strong> Buyer intake requested CFR terms. Supplier market quotations reflect observed CIF basis; ocean freight and marine insurance reconciliation required prior to final PO.
                </div>`
              : domain === "water_heater"
                ? `<div style="background: #f0fdf4; border: 1px solid #86efac; color: #166534; padding: 4px 6px; border-radius: 4px; font-size: 7pt; margin-top: 3px;">
                    <strong>Corridor Alignment:</strong> DDP Dubai delivery terms confirmed with CE marking, 10 bar tested rating, and &le;85 cm outer diameter.
                  </div>`
                : ""
          }
          <div class="card-title" style="margin-top: 8px;">Research Coverage &amp; Confidence</div>
          <p style="font-size: 8pt;"><strong>Coverage Status:</strong> ${escapeHtml(output.executive_summary.research_coverage_status)} &bull; <strong>Confidence:</strong> ${escapeHtml(output.executive_summary.confidence_assessment)}</p>
        </div>
      </div>
    </div>
    <footer class="report-footer">
      <div>Run ID: ${escapeHtml(output.research_run_id)}</div>
      <div>Page 2 of ${totalPages}</div>
    </footer>
  </section>

  <!-- PAGES 3 TO (2 + matrixPagesCount): SOURCING MATRIX OR ZERO-MATCH GUIDANCE -->
  ${
    suppliers.length === 0
      ? `
  <section class="page">
    ${demoBannerHtml}
    <header class="report-header">
      <div class="brand-title">MatchBASE / Sourcing Discovery</div>
      <div class="report-badge">Zero Candidates Qualified</div>
    </header>
    <div>
      <h2 class="section-heading">No Strong Match Analysis &amp; Constraint Relaxation Guidance</h2>
      <div class="card" style="margin-bottom: 12px; background: #fff5f5; border: 1px solid #fecdd3;">
        <div class="card-title" style="color: #9f1239;">Incompatible Technical Constraint Envelope Detected</div>
        <p style="font-size: 8.5pt; color: #881337;">
          Zero suppliers met 100% of the mandatory criteria concurrently. The combination of ultra-narrow envelope (&le;40cm diameter), ultra-high pressure (&ge;25 bar), and hazardous location certification (ATEX Zone 0) is physically non-standard for 500L cylindrical water calorifiers.
        </p>
      </div>
      <div class="summary-grid">
        <div class="card">
          <div class="card-title">Constraint Relaxation Pathways</div>
          <ul class="findings-list">
            <li><strong>Relax Diameter Constraint:</strong> Expanding diameter envelope from 40 cm to standard commercial 85 cm opens qualified European and regional calorifier manufacturers.</li>
            <li><strong>Decouple ATEX Enclosure:</strong> Procure a standard 10&ndash;16 bar commercial calorifier and place immersion control electronics in an external explosion-proof panel.</li>
            <li><strong>Pressure Re-evaluation:</strong> Verify if municipal supply pressure actually requires 25 bar or if a pressure-reducing valve (PRV) allows standard 10 bar operation.</li>
          </ul>
        </div>
        <div class="card">
          <div class="card-title">Recommended Next Steps</div>
          <ul class="findings-list">
            <li>Re-run MatchBASE intake with revised 85 cm diameter threshold.</li>
            <li>Consult MEP engineering contractor regarding mechanical room clearance.</li>
            <li>Review alternative split-system or modular calorifier topologies.</li>
          </ul>
        </div>
      </div>
    </div>
    <footer class="report-footer">
      <div>Run ID: ${escapeHtml(output.research_run_id)}</div>
      <div>Page 3 of ${totalPages}</div>
    </footer>
  </section>
      `
      : Array.from({ length: matrixPagesCount })
          .map((_, pageIdx) => {
            const startIdx = pageIdx * 5;
            const slice = suppliers.slice(startIdx, startIdx + 5);
            return `
  <section class="page">
    ${demoBannerHtml}
    <header class="report-header">
      <div class="brand-title">MatchBASE / Sourcing Matrix</div>
      <div class="report-badge">Candidates ${startIdx + 1} to ${startIdx + slice.length} of ${suppliers.length}</div>
    </header>
    <div>
      <h2 class="section-heading">Supplier Candidate Profiles (Batch ${pageIdx + 1})</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 32px;">Rank</th>
            <th style="width: 140px;">Company &amp; Fixture ID</th>
            <th style="width: 70px;">Status</th>
            <th style="width: 75px;">Facilities</th>
            <th style="width: 90px;">Country / Domain</th>
            <th style="width: 80px;">Capacity / MOQ</th>
            <th style="width: 40px;">Score</th>
            <th>Strategic Rationale &amp; Observed Basis</th>
          </tr>
        </thead>
        <tbody>
          ${slice
            .map(
              (s) => `
          <tr>
            <td><span class="score-pill">#${s.assessment.rank}</span></td>
            <td>
              <strong>${escapeHtml(s.legal_name)}</strong>
              <div><span class="fixture-id-tag">ID: ${escapeHtml(s.candidate_id)}</span></div>
              ${s.brand_names.length ? `<small style="color: #64748b;">Brands: ${escapeHtml(s.brand_names.join(", "))}</small>` : ""}
            </td>
            <td>
              <span class="status-badge ${
                s.assessment.compatibility_score >= 80
                  ? "badge-active"
                  : s.assessment.compatibility_score >= 60
                    ? "badge-conditional"
                    : "badge-low-fit"
              }">
                ${escapeHtml(s.assessment.fit_band)}
              </span>
            </td>
            <td>${escapeHtml(s.manufacturing_locations.join(", ") || "Verified Facility")}</td>
            <td>
              ${escapeHtml(s.country_of_registration)}<br>
              <small style="color: #C41E3A;">${escapeHtml(s.primary_domain)}</small>
            </td>
            <td>
              <small>${escapeHtml(s.commercial.production_capacity ?? "Commercial capacity")}</small><br>
              <small style="color: #64748b;">MOQ: ${escapeHtml(s.commercial.moq ?? "1 order")}</small>
            </td>
            <td><span class="score-pill">${s.assessment.compatibility_score}</span></td>
            <td>
              <div style="font-size: 6.5pt; color: #334155;">${escapeHtml(s.assessment.positive_drivers.slice(0, 2).join(". "))}</div>
              ${s.assessment.limiting_gaps.length ? `<div style="font-size: 6.5pt; color: #b91c1c; margin-top: 2px;"><strong>Risk/Gap:</strong> ${escapeHtml(s.assessment.limiting_gaps[0])}</div>` : ""}
              <div style="font-size: 6.5pt; color: #C41E3A; margin-top: 2px;"><strong>Next:</strong> ${escapeHtml(s.assessment.recommended_next_action)}</div>
            </td>
          </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <footer class="report-footer">
      <div>Run ID: ${escapeHtml(output.research_run_id)}</div>
      <div>Page ${3 + pageIdx} of ${totalPages}</div>
    </footer>
  </section>
        `;
          })
          .join("")
  }

  <!-- PAGE (totalPages - 1): COMMERCIAL BENCHMARKS & SPECIFICATIONS -->
  <section class="page">
    ${demoBannerHtml}
    <header class="report-header">
      <div class="brand-title">MatchBASE / Commercial Intelligence</div>
      <div class="report-badge">Commercial Parameters</div>
    </header>
    <div>
      <h2 class="section-heading">Commercial Benchmarks &amp; Sourcing Specifications</h2>
      <div class="summary-grid">
        <div class="card">
          <div class="card-title">Commercial Terms &amp; Indicative Pricing</div>
          ${
            domain === "poultry"
              ? `
          <table class="data-table" style="margin-bottom: 8px;">
            <thead>
              <tr>
                <th>Product SKU</th>
                <th>Indicative CIF (USD / MT)</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Frozen Whole Chicken Grade A (1000g-1200g)</td>
                <td><strong>$1,620 - $1,740</strong></td>
                <td>Metric Ton / Observed CIF</td>
              </tr>
            </tbody>
          </table>
          <p style="font-size: 7.5pt; color: #475569;"><em>Note: Benchmarks reflect containerized 40ft reefer spot indications. Payment terms typically 10-30% advance, balance against B/L copy, or 100% irrevocable LC at sight. Requested CFR basis requires freight reconciliation.</em></p>
              `
              : domain === "water_heater"
                ? `
          <p style="font-size: 8pt;"><strong>Commercial Scope:</strong> Commercial Electric Water Heater (500L Storage Calorifier), 10 units.</p>
          <p style="font-size: 8pt;"><strong>Indicative DDP Range:</strong> $2,100 &ndash; $2,850 per unit (delivered on-site Dubai, including customs clearance and technical documentation).</p>
          <p style="font-size: 8pt;"><strong>Warranty &amp; Spares:</strong> 5-year tank warranty, immersion element spares stocked in UAE, local commissioning support.</p>
                `
                : `
          <p style="font-size: 8pt;"><strong>Commercial Scope:</strong> Direct manufacturer pricing subject to technical specification sign-off and quantity confirmation.</p>
                `
          }
        </div>
        <div class="card">
          <div class="card-title">Technical &amp; Logistics Parameters</div>
          ${
            domain === "poultry"
              ? `
          <p style="font-size: 8pt;"><strong>Packaging:</strong> 10kg master export carton with 4 &times; 2.5kg inner polybags.</p>
          <p style="font-size: 8pt;"><strong>Temperature:</strong> Continuous deep freeze at -18&deg;C throughout transport and containerization.</p>
          <p style="font-size: 8pt;"><strong>Shelf Life:</strong> 12 months minimum from production date (SFDA standard: &ge;70% remaining upon arrival).</p>
          <p style="font-size: 8pt;"><strong>Volume:</strong> 4 &times; 40ft High-Cube reefer containers (~108 MT total).</p>
              `
              : domain === "water_heater"
                ? `
          <p style="font-size: 8pt;"><strong>Capacity &amp; Pressure:</strong> 500 Litres, 10 bar working pressure (tested &ge;15 bar).</p>
          <p style="font-size: 8pt;"><strong>Dimensions:</strong> Outer diameter strictly capped at &le;85 cm for mechanical room service door entry.</p>
          <p style="font-size: 8pt;"><strong>Electrical:</strong> Three-phase industrial supply (380V&ndash;415V, 50/60 Hz).</p>
          <p style="font-size: 8pt;"><strong>Standards:</strong> CE, Pressure Equipment Directive (PED 2014/68/EU), UAE MoIAT / G-Mark.</p>
                `
                : `
          <p style="font-size: 8pt;"><strong>Standard Parameters:</strong> Compliance with applicable regional import regulations and industrial manufacturing standards.</p>
                `
          }
        </div>
      </div>
    </div>
    <footer class="report-footer">
      <div>Run ID: ${escapeHtml(output.research_run_id)}</div>
      <div>Page ${totalPages - 1} of ${totalPages}</div>
    </footer>
  </section>

  <!-- PAGE totalPages: VERIFICATION LINEAGE & DISCLOSURES -->
  <section class="page">
    ${demoBannerHtml}
    <header class="report-header">
      <div class="brand-title">MatchBASE / Governance &amp; Lineage</div>
      <div class="report-badge">Lineage &amp; Disclosures</div>
    </header>
    <div>
      <h2 class="section-heading">Evidence Lineage &amp; Regulatory Disclosures</h2>
      
      <!-- Regulatory Context Sources (Separated from Candidate Evidence) -->
      <div class="card" style="margin-bottom: 8px;">
        <div class="card-title">Trade Lane &amp; Category Regulatory References</div>
        <p style="font-size: 7.5pt; color: #475569; margin-top: 0; margin-bottom: 4px;">
          <em>Note: The following official regulatory portals and standards directories provide category and jurisdiction context. They do NOT constitute counterparty accreditation records for synthetic illustrative entities.</em>
        </p>
        <ul class="findings-list">
          ${output.evidence_sources
            .filter(
              (e) =>
                e.source_type === "official_registry" ||
                e.source_type === "trade_directory",
            )
            .slice(0, 4)
            .map(
              (e) =>
                `<li><strong>${escapeHtml(e.publisher)}:</strong> ${escapeHtml(e.source_title)} &mdash; <em>${escapeHtml(e.excerpt_summary)}</em> [Classification: Regulatory Context / Status: ${escapeHtml(e.verification_status)}]</li>`,
            )
            .join("")}
        </ul>
      </div>

      <!-- Demonstration Synthetic Fixture Disclosure -->
      <div class="card" style="margin-bottom: 8px;">
        <div class="card-title">Demonstration Fixture Definitions &amp; Lineage</div>
        <ul class="findings-list">
          ${output.evidence_sources
            .filter((e) => e.source_type === "synthetic_fixture")
            .map(
              (e) =>
                `<li><strong>${escapeHtml(e.publisher)}:</strong> ${escapeHtml(e.source_title)} &mdash; <em>${escapeHtml(e.excerpt_summary)}</em> [Status: ${escapeHtml(e.verification_status)}]</li>`,
            )
            .join("")}
          ${
            output.evidence_sources.filter(
              (e) => e.source_type === "synthetic_fixture",
            ).length === 0
              ? `<li><strong>MatchBASE Platform Governance:</strong> Policy A Synthetic Demonstration Dataset Specification &mdash; <em>Governed illustrative candidate parameters.</em> [Status: illustrative]</li>`
              : ""
          }
        </ul>
      </div>

      <div class="card">
        <div class="card-title">Limitations &amp; Advisory Boundaries</div>
        <ul class="findings-list">
          ${output.limitations_and_disclosures.map((lim) => `<li><strong>${escapeHtml(lim.title)}:</strong> ${escapeHtml(lim.description)}</li>`).join("")}
        </ul>
      </div>
    </div>
    <footer class="report-footer">
      <div>Run ID: ${escapeHtml(output.research_run_id)}</div>
      <div>Page ${totalPages} of ${totalPages}</div>
    </footer>
  </section>

</body>
</html>`;
}
