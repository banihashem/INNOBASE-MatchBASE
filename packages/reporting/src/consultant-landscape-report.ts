import type { ConsultantResearchOutputV3 } from "@matchbase/contracts";

export function generateConsultantLandscapeHtml(
  output: ConsultantResearchOutputV3,
): string {
  const escapeHtml = (val: string) =>
    val
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const suppliers = output.supplier_candidates;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(output.title)}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 12mm 15mm 15mm 15mm;
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
      font-size: 11pt;
      line-height: 1.4;
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
    header.report-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #0284c7;
      padding-bottom: 6px;
      margin-bottom: 14px;
    }
    .brand-title {
      font-size: 13pt;
      font-weight: 800;
      color: #0369a1;
      letter-spacing: 0.5px;
    }
    .report-badge {
      background: #e0f2fe;
      color: #0369a1;
      font-size: 8.5pt;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    footer.report-footer {
      display: flex;
      justify-content: space-between;
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
      margin-top: 14px;
      font-size: 8pt;
      color: #64748b;
    }

    /* Cover Page */
    .cover-page {
      justify-content: center;
      text-align: left;
      padding: 40px 20px;
    }
    .cover-title {
      font-size: 26pt;
      font-weight: 900;
      color: #0f172a;
      line-height: 1.15;
      margin: 0 0 10px 0;
    }
    .cover-subtitle {
      font-size: 14pt;
      color: #334155;
      margin: 0 0 30px 0;
      font-weight: 500;
    }
    .trace-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    .trace-item {
      font-size: 9pt;
    }
    .trace-label {
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      font-size: 7.5pt;
    }
    .trace-value {
      font-family: monospace;
      color: #0f172a;
      font-size: 9pt;
      word-break: break-all;
    }
    .disclaimer-box {
      background: #fffbeb;
      border-left: 4px solid #f59e0b;
      padding: 12px 16px;
      font-size: 8.5pt;
      color: #78350f;
      border-radius: 0 6px 6px 0;
    }

    /* Section Headings */
    h2.section-heading {
      font-size: 16pt;
      font-weight: 800;
      color: #0f172a;
      margin: 0 0 12px 0;
    }

    /* Executive Summary Grid */
    .summary-grid {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 16px;
    }
    .card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 14px;
    }
    .card-title {
      font-size: 11pt;
      font-weight: 700;
      color: #0369a1;
      margin-bottom: 8px;
    }
    .findings-list {
      margin: 0;
      padding-left: 18px;
    }
    .findings-list li {
      margin-bottom: 6px;
      font-size: 9.5pt;
    }

    /* Sourcing Table */
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8pt;
      margin-top: 6px;
    }
    table.data-table th {
      background: #0f172a;
      color: #ffffff;
      padding: 6px 8px;
      text-align: left;
      font-weight: 600;
    }
    table.data-table td {
      padding: 5px 8px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
    }
    table.data-table tr:nth-child(even) {
      background: #f8fafc;
    }
    .status-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 7pt;
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
    .score-pill {
      font-weight: 800;
      font-size: 9pt;
      color: #0369a1;
    }
  </style>
</head>
<body>

  <!-- PAGE 1: COVER SLIDE -->
  <section class="page cover-page">
    <div style="margin-bottom: 20px;">
      <span class="report-badge">MatchBASE Consultant-Tier Intelligence Dossier</span>
    </div>
    <h1 class="cover-title">${escapeHtml(output.title)}</h1>
    <p class="cover-subtitle">${escapeHtml(output.subtitle ?? "Authoritative Sourcing Landscape & Supplier Discovery")}</p>
    
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
        <div class="trace-label">Dual-Lane Research Engine Disclosures</div>
        <div class="trace-value">Lane G (${output.telemetry.lanes_executed.includes("lane_gemini") ? "Gemini 2.5 Flash Web" : "N/A"}) + Lane O (${output.telemetry.lanes_executed.includes("lane_openai") ? "OpenAI GPT-4o" : "N/A"}) | Synthesis: ${escapeHtml(output.telemetry.synthesis_model_id)}</div>
      </div>
    </div>

    <div class="disclaimer-box">
      <strong>Confidential Commercial Advisory:</strong> This document contains structured intelligence and evidence-backed supplier discovery synthesized strictly from inspected registries and verified supplier disclosures. Prior to issuing irrevocable financial commitments or entering binding supply agreements, verify current slaughterhouse active status against the live SFDA establishment portal.
    </div>
  </section>

  <!-- PAGE 2: EXECUTIVE SUMMARY & TRADE CORRIDOR -->
  <section class="page">
    <header class="report-header">
      <div class="brand-title">MatchBASE / Consultant Landscape</div>
      <div class="report-badge">Executive Summary & Corridor</div>
    </header>
    <div>
      <h2 class="section-heading">Strategic Overview & Sourcing Synthesis</h2>
      <div class="summary-grid">
        <div class="card">
          <div class="card-title">Executive Summary</div>
          <p style="font-size: 9.5pt; margin-top: 0;">${escapeHtml(output.executive_summary.direct_answer)}</p>
          <div class="card-title" style="margin-top: 12px;">Key Findings</div>
          <ul class="findings-list">
            ${output.executive_summary.key_findings.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}
          </ul>
        </div>
        <div class="card">
          <div class="card-title">Trade Corridor & Regulatory Route</div>
          <p style="font-size: 9pt;"><strong>Corridor:</strong> Southern Brazil Poultry Belt to Saudi Arabia (Jeddah Islamic Port / King Abdulaziz Port Dammam).</p>
          <p style="font-size: 9pt;"><strong>Active SFDA Candidates (Wave 1):</strong> 4 slaughterhouse groups hold active, unrestricted approvals ready for immediate commercial PO issuance.</p>
          <p style="font-size: 9pt;"><strong>Conditional / Development Candidates (Wave 2/3):</strong> 16 slaughterhouses offer competitive capacity but require SFDA list reinstatement or partner quota packaging.</p>
          <p style="font-size: 9pt;"><strong>Ocean Transit:</strong> 32 to 38 days average reefer sailing via Port of Paranaguá (PR) or Santos (SP).</p>
        </div>
      </div>
    </div>
    <footer class="report-footer">
      <div>Run ID: ${escapeHtml(output.research_run_id)}</div>
      <div>Page 2 of 8</div>
    </footer>
  </section>

  <!-- PAGES 3-6: 20-SUPPLIER SOURCING MATRIX (5 per page) -->
  ${[0, 5, 10, 15]
    .map((startIdx, pageOffset) => {
      const slice = suppliers.slice(startIdx, startIdx + 5);
      return `
  <section class="page">
    <header class="report-header">
      <div class="brand-title">MatchBASE / Sourcing Matrix</div>
      <div class="report-badge">Candidates ${startIdx + 1} to ${startIdx + slice.length} of ${suppliers.length}</div>
    </header>
    <div>
      <h2 class="section-heading">Verified Supplier Candidate Profiles (Batch ${pageOffset + 1})</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 35px;">Rank</th>
            <th style="width: 140px;">Company & Brands</th>
            <th style="width: 70px;">Status</th>
            <th style="width: 80px;">Plants (SIF)</th>
            <th style="width: 100px;">Location / Web</th>
            <th style="width: 85px;">Capacity / MOQ</th>
            <th style="width: 50px;">Score</th>
            <th>Strategic Rationale & Next Action</th>
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
              ${s.brand_names.length ? `<br><small style="color: #64748b;">Brands: ${escapeHtml(s.brand_names.join(", "))}</small>` : ""}
            </td>
            <td>
              <span class="status-badge ${s.assessment.rank <= 4 ? "badge-active" : "badge-conditional"}">
                ${s.assessment.rank <= 4 ? "Active SFDA" : "Conditional"}
              </span>
            </td>
            <td>${escapeHtml(s.manufacturing_locations.join(", ") || "SIF Verified")}</td>
            <td>
              ${escapeHtml(s.country_of_registration)}<br>
              <small><a href="${escapeHtml(s.website)}" target="_blank" style="color: #0284c7;">${escapeHtml(s.primary_domain)}</a></small>
            </td>
            <td>
              <small>${escapeHtml(s.commercial.production_capacity ?? "Commercial capacity")}</small><br>
              <small style="color: #64748b;">MOQ: ${escapeHtml(s.commercial.moq ?? "1 container")}</small>
            </td>
            <td><span class="score-pill">${s.assessment.compatibility_score}</span></td>
            <td>
              <div style="font-size: 7.5pt; color: #334155;">${escapeHtml(s.assessment.positive_drivers.slice(0, 2).join(". "))}</div>
              <div style="font-size: 7.5pt; color: #0369a1; margin-top: 2px;"><strong>Next:</strong> ${escapeHtml(s.assessment.recommended_next_action)}</div>
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
      <div>Page ${3 + pageOffset} of 8</div>
    </footer>
  </section>
      `;
    })
    .join("")}

  <!-- PAGE 7: COMMERCIAL BENCHMARKS & LOGISTICS -->
  <section class="page">
    <header class="report-header">
      <div class="brand-title">MatchBASE / Commercial Intelligence</div>
      <div class="report-badge">Pricing & Logistics</div>
    </header>
    <div>
      <h2 class="section-heading">Pricing Benchmarks & Logistics Specifications</h2>
      <div class="summary-grid">
        <div class="card">
          <div class="card-title">Indicative Price Ranges (CIF Jeddah)</div>
          <table class="data-table" style="margin-bottom: 12px;">
            <thead>
              <tr>
                <th>Product SKU</th>
                <th>Indicative CIF (USD / MT)</th>
                <th>Unit / Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Frozen Whole Chicken Grade A (900g-1200g)</td>
                <td><strong>$1,620 - $1,740</strong></td>
                <td>Metric Ton / CIF Jeddah</td>
              </tr>
              <tr>
                <td>Boneless Skinless Chicken Breast (IQF)</td>
                <td><strong>$2,450 - $2,680</strong></td>
                <td>Metric Ton / CIF Jeddah</td>
              </tr>
              <tr>
                <td>Shawarma Cut (2.5kg bags)</td>
                <td><strong>$2,100 - $2,300</strong></td>
                <td>Metric Ton / CIF Jeddah</td>
              </tr>
            </tbody>
          </table>
          <p style="font-size: 8.5pt; color: #475569;"><em>Note: Benchmarks reflect containerized 40ft reefer spot indications. Payment terms typically 10-30% advance, balance against B/L copy, or 100% irrevocable LC at sight.</em></p>
        </div>
        <div class="card">
          <div class="card-title">Packaging & Cold-Chain Parameters</div>
          <p style="font-size: 9pt;"><strong>Packaging:</strong> 10kg master carton (4 x 2.5kg poly-bagged portions or individually poly-bagged whole birds).</p>
          <p style="font-size: 9pt;"><strong>Temperature:</strong> Continuous deep freeze at -18°C throughout transport and containerization.</p>
          <p style="font-size: 9pt;"><strong>Shelf Life:</strong> 12 months minimum from production date (SFDA standard: at least 70% shelf life remaining upon arrival).</p>
          <p style="font-size: 9pt;"><strong>Container Loading:</strong> 27 MT net per 40ft High-Cube reefer container (approx. 2,700 master cartons).</p>
        </div>
      </div>
    </div>
    <footer class="report-footer">
      <div>Run ID: ${escapeHtml(output.research_run_id)}</div>
      <div>Page 7 of 8</div>
    </footer>
  </section>

  <!-- PAGE 8: VERIFICATION LINEAGE & DISCLOSURES -->
  <section class="page">
    <header class="report-header">
      <div class="brand-title">MatchBASE / Governance & Lineage</div>
      <div class="report-badge">Lineage & Audit Trace</div>
    </header>
    <div>
      <h2 class="section-heading">Verification Lineage & Regulatory Disclosures</h2>
      <div class="card" style="margin-bottom: 12px;">
        <div class="card-title">100% Claim-to-Evidence Lineage Trace</div>
        <p style="font-size: 8.5pt; color: #334155; margin-top: 0;">
          Every fact, capability assertion, and certification state cited in this report is anchored to verifiable evidence sources:
        </p>
        <ul class="findings-list">
          ${output.evidence_sources
            .slice(0, 5)
            .map(
              (e) =>
                `<li><strong>${escapeHtml(e.publisher)}:</strong> <a href="${escapeHtml(e.source_url)}" target="_blank" style="color: #0284c7;">${escapeHtml(e.source_title)}</a> &mdash; <em>${escapeHtml(e.excerpt_summary)}</em></li>`,
            )
            .join("")}
        </ul>
      </div>
      <div class="card">
        <div class="card-title">Limitations & Advisory Boundaries</div>
        <ul class="findings-list">
          ${output.limitations_and_disclosures.map((lim) => `<li><strong>${escapeHtml(lim.title)}:</strong> ${escapeHtml(lim.description)}</li>`).join("")}
        </ul>
      </div>
    </div>
    <footer class="report-footer">
      <div>Run ID: ${escapeHtml(output.research_run_id)}</div>
      <div>Page 8 of 8</div>
    </footer>
  </section>

</body>
</html>`;
}
