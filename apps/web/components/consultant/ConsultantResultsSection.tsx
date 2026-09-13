"use client";
import { useId, useRef, useState } from "react";
import type {
  ConsultantResearchOutputV3,
  SupplierEntityV3,
} from "@matchbase/contracts";
import {
  displaySupplierText,
  getSupplierLocationSummary,
  getSupplierWebsite,
} from "@matchbase/contracts";
import "./consultant-results.css";
import { ApprovedRequestSummary } from "./ApprovedRequestSummary";
import { ResearchPricing, SupplierPriceSummary } from "./ResearchPricing";

const filterControlClass =
  "min-h-11 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300";

interface ConsultantResultsSectionProps {
  output: ConsultantResearchOutputV3;
  suppliers: readonly SupplierEntityV3[];
  visibleSuppliers: readonly SupplierEntityV3[];
  revealedCount: number;
  isLoading: boolean;
  isPdfDownloading: boolean;
  handlePdfDownload: () => Promise<void>;
  handleJsonExport: () => void;
  handleRevealMore: () => Promise<void>;
  onSelectSupplier: (supplier: SupplierEntityV3) => void;
}

export function ConsultantResultsSection({
  output,
  suppliers,
  visibleSuppliers,
  revealedCount,
  isLoading,
  isPdfDownloading,
  handlePdfDownload,
  handleJsonExport,
  handleRevealMore,
  onSelectSupplier,
}: ConsultantResultsSectionProps) {
  const filterId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("all");
  const [filteredCount, setFilteredCount] = useState(5);
  // MB-UX-SIMPLIFY-001 L01: filters never write reveal state or change saved ranks.
  const registeredCountries = new Map<
    string,
    { label: string; count: number }
  >();
  let missingCountryCount = 0;
  for (const supplier of suppliers) {
    const label = displaySupplierText(supplier.country_of_registration, "");
    if (!label) {
      missingCountryCount += 1;
      continue;
    }
    const key = label.toLowerCase();
    const previous = registeredCountries.get(key);
    registeredCountries.set(key, {
      label: previous?.label ?? label,
      count: (previous?.count ?? 0) + 1,
    });
  }
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtering = terms.length > 0 || country !== "all";
  const matchingSuppliers = suppliers.filter((supplier) => {
    const registered = displaySupplierText(
      supplier.country_of_registration,
      "",
    ).toLowerCase();
    if (country === "missing" && registered) return false;
    if (country !== "all" && country !== "missing" && registered !== country)
      return false;
    const searchable = [
      supplier.legal_name,
      ...supplier.brand_names,
      getSupplierLocationSummary(supplier).value,
      displaySupplierText(supplier.country_of_registration, ""),
      ...supplier.manufacturing_locations,
      supplier.offering.product_name,
      supplier.offering.product_family,
      supplier.offering.description ?? "",
      supplier.offering.brand ?? "",
      supplier.offering.model_or_sku ?? "",
      supplier.offering.grade_or_quality ?? "",
      displaySupplierText(supplier.offering.country_of_origin, ""),
      ...supplier.offering.use_cases,
      ...Object.values(supplier.offering.specifications).flatMap((value) =>
        Array.isArray(value) ? value : [String(value)],
      ),
      getSupplierWebsite(supplier)?.href ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
  const displayedSuppliers = filtering
    ? matchingSuppliers.slice(0, filteredCount)
    : visibleSuppliers;
  const materialLimits = [
    ...new Set(
      [
        output.executive_summary.primary_limitation,
        ...output.limitations_and_disclosures
          .filter((limitation) => limitation.severity === "critical")
          .map(
            (limitation) => `${limitation.title}: ${limitation.description}`,
          ),
      ].filter((limit): limit is string => Boolean(limit?.trim())),
    ),
  ];
  function clearFilters() {
    setSearch("");
    setCountry("all");
    setFilteredCount(5);
    searchInput.current?.focus();
  }
  return (
    <section
      id="supplier-findings"
      tabIndex={-1}
      aria-labelledby="section-3-heading"
      className="consultant-results bg-slate-800/60 rounded-xl border border-slate-700 p-6 shadow-lg backdrop-blur space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-700 pb-4">
        <div>
          <h2
            id="section-3-heading"
            className="text-xl font-bold text-white flex items-center gap-2"
          >
            <span
              aria-hidden="true"
              className="w-6 h-6 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center font-bold"
            >
              3
            </span>
            Supplier shortlist
          </h2>
          <p
            className="text-sm text-slate-300 mt-1"
            aria-live="polite"
            aria-atomic="true"
          >
            {filtering
              ? `Showing ${displayedSuppliers.length} of ${matchingSuppliers.length} matching profiles · ${suppliers.length} total`
              : `Showing ${displayedSuppliers.length} of ${suppliers.length} assessed candidate profiles.`}
          </p>
        </div>

        {/* Action Buttons: PDF & JSON */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handlePdfDownload}
            disabled={isPdfDownloading}
            aria-label="Download Full PDF Report"
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              className="w-4 h-4"
              width={16}
              height={16}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z"
                clipRule="evenodd"
              />
            </svg>
            {isPdfDownloading
              ? "Generating PDF..."
              : "Download Full PDF Report"}
          </button>

          <details className="result-export-details">
            <summary>More export options</summary>
            <button
              type="button"
              onClick={handleJsonExport}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold rounded-lg border border-slate-600 transition-colors flex items-center gap-2"
            >
              <svg
                className="w-4 h-4 text-slate-400"
                width={16}
                height={16}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Export research data (JSON)
            </button>
          </details>
        </div>
      </div>

      {materialLimits.length > 0 && (
        <div
          className="space-y-2 border-l-2 border-amber-400 pl-3 text-sm text-amber-100"
          aria-label="Material research limitations"
        >
          {materialLimits.map((limitation) => (
            <p
              key={limitation}
              className="whitespace-pre-line break-words"
              dir="auto"
            >
              {limitation}
            </p>
          ))}
        </div>
      )}
      {!suppliers.length && (
        <div className="rounded-lg border border-slate-600 bg-slate-900 p-4 space-y-2">
          <h3 className="font-semibold text-white">
            No supplier profiles ready in this round
          </h3>
          <p className="text-sm text-slate-200 whitespace-pre-line" dir="auto">
            {output.executive_summary.direct_answer}
          </p>
          <p className="text-sm text-amber-200">
            Discovered names alone are not verified supplier profiles. No
            candidate in this round passed the required evidence and mandatory
            requirement checks. This does not establish that no suitable
            suppliers exist.
          </p>
        </div>
      )}
      {suppliers.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            Overall evidence confidence:{" "}
            {output.executive_summary.confidence_assessment.replaceAll(
              "_",
              " ",
            )}
            {output.executive_summary.research_coverage_status
              ? ` · Research coverage: ${output.executive_summary.research_coverage_status.replaceAll("_", " ")}`
              : ""}
          </p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label htmlFor={`${filterId}-search`} className="space-y-1 text-sm">
              <span className="block font-semibold">
                Search supplier profiles
              </span>
              <input
                ref={searchInput}
                id={`${filterId}-search`}
                type="search"
                value={search}
                className={`${filterControlClass} w-full`}
                placeholder="Company, product or location"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setFilteredCount(5);
                }}
              />
            </label>
            <label
              htmlFor={`${filterId}-country`}
              className="space-y-1 text-sm"
            >
              <span className="block font-semibold">Registered country</span>
              <select
                id={`${filterId}-country`}
                value={country}
                className={`${filterControlClass} w-full`}
                aria-describedby={`${filterId}-country-help`}
                onChange={(event) => {
                  setCountry(event.target.value);
                  setFilteredCount(5);
                }}
              >
                <option value="all">All registered countries</option>
                {[...registeredCountries.entries()]
                  .sort(([, left], [, right]) =>
                    left.label.localeCompare(right.label),
                  )
                  .map(([value, option]) => (
                    <option key={value} value={value}>
                      {option.label} ({option.count})
                    </option>
                  ))}
                {missingCountryCount > 0 && (
                  <option value="missing">
                    Not established ({missingCountryCount})
                  </option>
                )}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              id={`${filterId}-country-help`}
              className="text-xs text-slate-300"
            >
              Country uses the saved registration field. Search also covers
              recorded headquarters and manufacturing locations.
            </p>
            {(search || country !== "all") && (
              <button
                type="button"
                className={filterControlClass}
                onClick={clearFilters}
              >
                Clear supplier filters
              </button>
            )}
          </div>
          <p className="text-sm text-slate-300">
            Original research ranks are retained. Fit scores are assessments;
            confirm commercial terms and evidence before procurement.{" "}
            <a
              href="#research-pricing-heading"
              className="text-sky-300 underline"
            >
              View price research
            </a>
          </p>
          <p className="text-xs text-slate-300">
            Filters change this list only. Report downloads include all saved
            profiles.
          </p>
          {filtering && matchingSuppliers.length === 0 && (
            <p className="rounded-lg bg-slate-900 p-4 text-sm">
              No saved supplier profiles match these filters. Try a different
              term or clear the filters. All {suppliers.length} profiles remain
              available.
            </p>
          )}
        </div>
      )}
      {/* Candidate Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {displayedSuppliers.map((supp) => {
          const location = getSupplierLocationSummary(supp);
          const website = getSupplierWebsite(supp);
          const isIllustrative =
            output.research_mode === "fixture" ||
            supp.legal_name.includes("[Illustrative]") ||
            supp.candidate_id.startsWith("cand-demo-");
          const isDirectRoute =
            !isIllustrative &&
            supp.manufacturer_status === "direct_manufacturer";
          return (
            <div
              key={supp.candidate_id}
              className="supplier-result-card bg-slate-900/90 rounded-xl border border-slate-700 p-5 hover:border-slate-500 transition-all shadow-md flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-extrabold text-sky-400">
                        Rank #{supp.assessment.rank}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${
                          isIllustrative
                            ? "bg-amber-950 text-amber-200 border border-amber-800"
                            : isDirectRoute
                              ? "bg-emerald-950 text-emerald-300 border border-emerald-700"
                              : "bg-amber-950 text-amber-200 border border-amber-800"
                        }`}
                      >
                        {isIllustrative
                          ? "Illustrative Profile"
                          : isDirectRoute
                            ? "Direct Manufacturer"
                            : "Supplier Profile"}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-white">
                      {supp.legal_name}
                    </h3>
                    {supp.brand_names.length > 0 && (
                      <p className="text-xs text-slate-400">
                        Brands: {supp.brand_names.join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-sky-400 leading-none">
                      {supp.assessment.compatibility_score}
                      <span className="supplier-score-scale"> / 100</span>
                    </div>
                    <div className="text-[10px] text-slate-400 uppercase font-semibold mt-1">
                      {isIllustrative
                        ? "Illustrative Score"
                        : supp.assessment.fit_band}
                    </div>
                  </div>
                </div>

                {/* Details row */}
                <div className="supplier-key-facts text-sm space-y-1 my-3 bg-slate-800/60 p-2.5 rounded border border-slate-700/60">
                  <div className="flex justify-between">
                    <span className="text-slate-400">{location.label}:</span>
                    <span className="font-medium text-slate-200 text-right break-words">
                      {location.value}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Capacity &amp; MOQ:</span>
                    <span className="text-slate-200 text-right break-words">
                      {displaySupplierText(supp.commercial.production_capacity)}{" "}
                      &bull; {displaySupplierText(supp.commercial.moq)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">
                      {isIllustrative ? "Fixture ID:" : "Website:"}
                    </span>
                    {isIllustrative ? (
                      <span className="font-mono text-slate-300">
                        {supp.candidate_id}
                      </span>
                    ) : website ? (
                      <a
                        href={website.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-400 hover:text-sky-300 underline truncate max-w-[200px]"
                      >
                        {website.label}
                      </a>
                    ) : (
                      <span className="text-slate-300">Not established</span>
                    )}
                  </div>
                  {isIllustrative && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Public Website:</span>
                      <span className="italic text-slate-500">
                        Not applicable — illustrative entity
                      </span>
                    </div>
                  )}
                </div>

                <SupplierPriceSummary
                  supplier={supp}
                  evidence={output.evidence_sources}
                  claims={output.claims}
                  recentPrices={output.price_research}
                />
                <p className="text-sm text-slate-300 mb-4">
                  {supp.assessment.positive_drivers.join("; ")}
                </p>
                {supp.assessment.limiting_gaps.length > 0 && (
                  <p className="supplier-card-gap">
                    <strong>Needs confirmation: </strong>
                    {supp.assessment.limiting_gaps.slice(0, 2).join("; ")}
                  </p>
                )}
                <p className="supplier-evidence-note">
                  Evidence confidence: {supp.assessment.evidence_confidence}.
                  Fit score is an assessment, not a guarantee.
                </p>
              </div>

              <div className="supplier-card-actions flex items-center justify-between pt-3 border-t border-slate-800">
                <span className="text-[11px] text-slate-400">
                  Next:{" "}
                  <strong className="text-slate-200">
                    {supp.assessment.recommended_next_action}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={() => onSelectSupplier(supp)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-sky-600 text-slate-200 hover:text-white rounded-md text-xs font-bold transition-colors border border-slate-700"
                >
                  View supplier details &rarr;
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Progressive Revelation Button */}
      {(filtering
        ? displayedSuppliers.length < matchingSuppliers.length
        : revealedCount < suppliers.length) && (
        <div className="text-center pt-4">
          <button
            type="button"
            onClick={
              filtering
                ? () => setFilteredCount((count) => count + 5)
                : handleRevealMore
            }
            disabled={!filtering && isLoading}
            className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-sky-400 font-bold text-sm rounded-lg border border-sky-800/80 transition-all shadow-md hover:border-sky-600 flex items-center gap-2 mx-auto"
          >
            <svg
              className="w-4 h-4"
              width={16}
              height={16}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
            {filtering
              ? `Show more matching suppliers (${displayedSuppliers.length} of ${matchingSuppliers.length} shown)`
              : `Show next suppliers (${visibleSuppliers.length} of ${suppliers.length} shown)`}
          </button>
        </div>
      )}
      <ResearchPricing output={output} />
      {suppliers.length > 0 && (
        <details className="border-t border-slate-700 pt-2">
          <summary className="cursor-pointer py-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">
            Research summary and assessment context
          </summary>
          <div className="space-y-2 pb-3 text-sm text-slate-200">
            <p className="whitespace-pre-line break-words" dir="auto">
              {output.executive_summary.direct_answer}
            </p>
          </div>
        </details>
      )}
      <ApprovedRequestSummary snapshot={output.approved_request_snapshot} />
    </section>
  );
}
