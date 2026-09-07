import type {
  ConsultantResearchOutputV3,
  SupplierEntityV3,
} from "@matchbase/contracts";
import { ApprovedRequestSummary } from "./ApprovedRequestSummary";

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
  return (
    <section
      aria-labelledby="section-3-heading"
      className="bg-slate-800/60 rounded-xl border border-slate-700 p-6 shadow-lg backdrop-blur space-y-6"
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
            Section 3: Ranked Supplier Candidates &amp; Dossiers
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Showing {visibleSuppliers.length} of {suppliers.length} assessed
            candidate profiles.
          </p>
        </div>

        {/* Action Buttons: PDF & JSON */}
        <div className="flex items-center gap-3">
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
            Export Structured JSON
          </button>
        </div>
      </div>

      <ApprovedRequestSummary snapshot={output.approved_request_snapshot} />
      {/* Candidate Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visibleSuppliers.map((supp) => {
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
              className="bg-slate-900/90 rounded-xl border border-slate-700 p-5 hover:border-slate-500 transition-all shadow-md flex flex-col justify-between"
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
                    </div>
                    <div className="text-[10px] text-slate-400 uppercase font-semibold mt-1">
                      {isIllustrative
                        ? "Illustrative Score"
                        : supp.assessment.fit_band}
                    </div>
                  </div>
                </div>

                {/* Details row */}
                <div className="text-xs space-y-1 my-3 bg-slate-800/60 p-2.5 rounded border border-slate-700/60">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Country / Origin:</span>
                    <span className="font-mono font-medium text-slate-200">
                      {supp.country_of_registration}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Capacity &amp; MOQ:</span>
                    <span className="text-slate-200 truncate max-w-[200px]">
                      {supp.commercial.production_capacity ?? "Not found"}{" "}
                      &bull; {supp.commercial.moq ?? "Not found"}
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
                    ) : (
                      <a
                        href={
                          supp.website && /^https?:\/\//i.test(supp.website)
                            ? supp.website
                            : undefined
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-400 hover:text-sky-300 underline truncate max-w-[200px]"
                      >
                        {supp.primary_domain}
                      </a>
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

                <p className="text-xs text-slate-300 line-clamp-2 mb-4">
                  {supp.assessment.positive_drivers.join("; ")}
                </p>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-800">
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
                  View Full Dossier &rarr;
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Progressive Revelation Button */}
      {revealedCount < suppliers.length && (
        <div className="text-center pt-4">
          <button
            type="button"
            onClick={handleRevealMore}
            disabled={isLoading}
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
            Reveal 5 More Candidates ({visibleSuppliers.length} of{" "}
            {suppliers.length} shown)
          </button>
        </div>
      )}
    </section>
  );
}
