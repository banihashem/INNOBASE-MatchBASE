"use client";

import { useEffect, useRef } from "react";
import type { SupplierEntityV3 } from "@matchbase/contracts";

export interface SupplierDossierModalProps {
  readonly supplier: SupplierEntityV3 | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export function SupplierDossierModal({
  supplier,
  isOpen,
  onClose,
}: SupplierDossierModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current =
        document.activeElement as HTMLElement | null;
      document.body.style.overflow = "hidden";
      setTimeout(() => {
        closeBtnRef.current?.focus();
      }, 50);
    } else {
      document.body.style.overflow = "";
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen || !supplier) return null;

  const assessment = supplier.assessment;
  const isIllustrative =
    supplier.legal_name.includes("[Illustrative]") ||
    supplier.candidate_id.startsWith("cand-v3-") ||
    supplier.candidate_id.startsWith("cand-demo-") ||
    (Boolean(supplier.website) &&
      (supplier.website.includes("matchbase.internal") ||
        supplier.website.includes("example.internal")));
  const isDirect = !isIllustrative && assessment.rank <= 4;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dossier-modal-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden text-slate-900 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
                Candidate Dossier &bull; #{assessment.rank}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                  isIllustrative
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : isDirect
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                }`}
              >
                {isIllustrative
                  ? "Illustrative Profile"
                  : isDirect
                    ? "Active Direct Route"
                    : "Conditional / Development"}
              </span>
            </div>
            <h2
              id="dossier-modal-title"
              className="text-xl font-bold text-white"
            >
              {supplier.legal_name}
            </h2>
            {supplier.brand_names.length > 0 && (
              <p className="text-sm text-slate-300">
                Brands: {supplier.brand_names.join(", ")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-2xl font-black text-sky-400">
                {assessment.compatibility_score}
                <span className="text-sm font-normal text-slate-400">/100</span>
              </div>
              <div className="text-xs text-slate-300 font-semibold">
                {isIllustrative ? "Illustrative Score" : assessment.fit_band}
              </div>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
              aria-label="Close modal"
            >
              <svg
                className="w-6 h-6"
                width={24}
                height={24}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="overflow-y-auto p-6 space-y-6 text-sm">
          {/* Section 1: Overview & Contacts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
              <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-sky-600"
                  width={16}
                  height={16}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 11H9v-2h2v2zm0-4H9V5h2v4z"
                    clipRule="evenodd"
                  />
                </svg>
                Corporate Registration & Operations
              </h3>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <dt className="text-slate-500 font-medium">Country:</dt>
                <dd className="col-span-2 font-semibold text-slate-800">
                  {supplier.country_of_registration}
                </dd>

                <dt className="text-slate-500 font-medium">Headquarters:</dt>
                <dd className="col-span-2 text-slate-800">
                  {supplier.headquarters_address}
                </dd>

                <dt className="text-slate-500 font-medium">
                  Plants / Facilities:
                </dt>
                <dd className="col-span-2 font-mono text-slate-800">
                  {supplier.manufacturing_locations.join(", ") ||
                    (isIllustrative
                      ? "Synthetic Test Facility"
                      : "Validated Facilities")}
                </dd>

                <dt className="text-slate-500 font-medium">Website:</dt>
                <dd className="col-span-2 text-slate-600 truncate">
                  {isIllustrative ? (
                    <span className="italic text-slate-500">
                      Not applicable — illustrative entity
                    </span>
                  ) : (
                    <a
                      href={supplier.website}
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-sky-600 hover:text-sky-800"
                    >
                      {supplier.primary_domain}
                    </a>
                  )}
                </dd>
              </dl>
            </div>

            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
              <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-sky-600"
                  width={16}
                  height={16}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                  <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                </svg>
                {isIllustrative
                  ? "Entity Verification & Status"
                  : "Verified Commercial Contacts"}
              </h3>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <dt className="text-slate-500 font-medium">Sales Desk:</dt>
                <dd className="col-span-2 font-mono text-slate-800">
                  {isIllustrative
                    ? "Not applicable — illustrative profile"
                    : (supplier.contacts.sales_email ??
                      `export@${supplier.primary_domain}`)}
                </dd>

                <dt className="text-slate-500 font-medium">Phone:</dt>
                <dd className="col-span-2 text-slate-800">
                  {isIllustrative
                    ? "Not applicable — illustrative profile"
                    : (supplier.contacts.phone ?? "Official Corporate Desk")}
                </dd>

                <dt className="text-slate-500 font-medium">Verification:</dt>
                <dd className="col-span-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                      isIllustrative
                        ? "bg-amber-100 text-amber-800"
                        : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {isIllustrative
                      ? "Demonstration Profile (Not Externally Verified)"
                      : "Verified Public Corporate Channel"}
                  </span>
                </dd>
              </dl>
            </div>
          </div>

          {/* Section 2: 6-Dimension Score Radar / Table */}
          <div className="bg-white p-4 rounded-lg border border-slate-200">
            <h3 className="font-bold text-slate-800 mb-3 text-base">
              6-Dimension Compatibility Assessment
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                {
                  label: "Category & Product Fit (25%)",
                  score: assessment.dimension_scores.category_product_fit,
                },
                {
                  label: "Compliance & Certification Fit (20%)",
                  score:
                    assessment.dimension_scores.compliance_certification_fit,
                },
                {
                  label: "Volume & Capacity Fit (15%)",
                  score: assessment.dimension_scores.volume_capacity_fit,
                },
                {
                  label: "Price Tier Fit (15%)",
                  score: assessment.dimension_scores.price_tier_fit,
                },
                {
                  label: "Brand Positioning Fit (15%)",
                  score: assessment.dimension_scores.positioning_brand_fit,
                },
                {
                  label: "Geographic Reach Fit (10%)",
                  score: assessment.dimension_scores.geographic_reach_fit,
                },
              ].map((dim, idx) => (
                <div
                  key={idx}
                  className="bg-slate-50 p-2.5 rounded border border-slate-100"
                >
                  <div className="text-[11px] text-slate-500 font-medium leading-tight mb-1">
                    {dim.label}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-base font-extrabold text-sky-700">
                      {dim.score}
                    </div>
                    <div className="w-16 bg-slate-200 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-sky-600 h-full rounded-full"
                        style={{ width: `${Math.min(dim.score, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Commercial & Offerings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-slate-200 rounded-lg p-4">
              <h4 className="font-bold text-slate-800 mb-2">
                Technical Offering & Quality Specs
              </h4>
              <p className="text-xs text-slate-600 mb-2">
                <strong>Product:</strong> {supplier.offering.product_name}
              </p>
              <div className="text-xs space-y-1">
                {Object.entries(supplier.offering.specifications).map(
                  ([k, v]) => (
                    <div
                      key={k}
                      className="flex justify-between border-b border-slate-100 py-0.5"
                    >
                      <span className="text-slate-500 capitalize">
                        {k.replaceAll("_", " ")}:
                      </span>
                      <span className="font-medium text-slate-800">
                        {String(v)}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg p-4">
              <h4 className="font-bold text-slate-800 mb-2">
                Commercial Terms & Capacity
              </h4>
              <div className="text-xs space-y-1.5">
                <div className="flex justify-between border-b border-slate-100 py-0.5">
                  <span className="text-slate-500">Production Capacity:</span>
                  <span className="font-medium text-slate-800">
                    {supplier.commercial.production_capacity ??
                      "Large industrial export"}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-100 py-0.5">
                  <span className="text-slate-500">
                    Minimum Order Quantity (MOQ):
                  </span>
                  <span className="font-medium text-slate-800">
                    {supplier.commercial.moq ?? "Standard Industrial MOQ"}
                  </span>
                </div>
                {supplier.commercial.price_min && (
                  <div className="flex justify-between border-b border-slate-100 py-0.5">
                    <span className="text-slate-500">
                      Indicative Price Range:
                    </span>
                    <span className="font-bold text-emerald-700">
                      ${supplier.commercial.price_min} - $
                      {supplier.commercial.price_max}{" "}
                      {supplier.commercial.currency} /{" "}
                      {supplier.commercial.unit}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-b border-slate-100 py-0.5">
                  <span className="text-slate-500">Lead Time & Inco:</span>
                  <span className="font-medium text-slate-800">
                    {supplier.commercial.lead_time ?? "30-45 days"} &bull;{" "}
                    {supplier.commercial.incoterm ??
                      "Standard International Terms"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Strategic Recommendations & Action */}
          <div className="bg-sky-50 border-l-4 border-sky-600 p-4 rounded-r-lg">
            <h4 className="font-bold text-sky-900 mb-1">
              Strategic Synthesis & Recommended Action
            </h4>
            <div className="text-xs text-sky-800 space-y-1">
              <p>
                <strong>Drivers:</strong>{" "}
                {assessment.positive_drivers.join("; ")}
              </p>
              {assessment.limiting_gaps.length > 0 && (
                <p>
                  <strong>Gaps to Resolve:</strong>{" "}
                  {assessment.limiting_gaps.join("; ")}
                </p>
              )}
              <p className="mt-2 text-sky-950 font-semibold">
                <strong>Recommended Next Action:</strong>{" "}
                {assessment.recommended_next_action}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-100 px-6 py-3 flex justify-between items-center border-t border-slate-200">
          <span className="text-xs text-slate-500">
            {isIllustrative
              ? "Demonstration Profile: Illustrative fixture candidate for workflow evaluation. Not live market evidence."
              : "Source Trace: Grounded in official trade registries and verified supplier documentation"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            Close Dossier
          </button>
        </div>
      </div>
    </div>
  );
}
