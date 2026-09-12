import type {
  ConsultantResearchOutputV3,
  EvidenceSourceV3,
  SupplierEntityV3,
  ClaimV3,
  ResearchPriceSearchV3,
} from "@matchbase/contracts";
import { displaySupplierText } from "@matchbase/contracts";
import {
  additionalPriceEvidence,
  formatPrice,
  researchPriceGroups,
  supplierPrice,
} from "./research-pricing";
import {
  RecentResearchPrices,
  recentPriceObservations,
} from "./RecentResearchPrices";

function SourceLinks({ sources }: { sources: readonly EvidenceSourceV3[] }) {
  return (
    <>
      {sources.map((source) => (
        <div key={source.evidence_id}>
          <a
            className="underline break-all"
            href={
              /^https?:\/\//i.test(source.source_url)
                ? source.source_url
                : undefined
            }
            target="_blank"
            rel="noreferrer"
          >
            {source.source_url}
          </a>
          <span className="block">
            Source retrieved: {source.retrieved_at.slice(0, 10)} (not the price
            date)
          </span>
        </div>
      ))}
    </>
  );
}

export function SupplierPriceSummary({
  supplier,
  evidence,
  claims = [],
  detailed = false,
  recentPrices,
}: {
  supplier: SupplierEntityV3;
  evidence: readonly EvidenceSourceV3[];
  claims?: readonly ClaimV3[];
  detailed?: boolean;
  recentPrices?: ResearchPriceSearchV3 | undefined;
}) {
  const price = supplierPrice(supplier, evidence, claims);
  const c = supplier.commercial;
  const recent = recentPriceObservations(recentPrices).filter(
    (p) =>
      p.provenance === "supplier_listing" &&
      p.supplier_name?.trim().toLowerCase() ===
        supplier.legal_name.trim().toLowerCase(),
  );
  return (
    <div
      className="text-xs space-y-1 py-2"
      aria-label={`Price for ${supplier.legal_name}`}
    >
      {recent.length > 0 && (
        <div className="space-y-1">
          <strong>Recent supplier listing</strong>
          {recent.map((p) => (
            <p key={p.observation_id}>
              {formatPrice(
                p.price_min,
                p.price_max,
                p.currency,
                p.unit ?? undefined,
              )}{" "}
              · Price date: {p.source_published_at.slice(0, 10)} ·{" "}
              <a
                className="underline"
                href={
                  /^https?:\/\//i.test(p.source_url) ? p.source_url : undefined
                }
                target="_blank"
                rel="noreferrer"
              >
                Source
              </a>
            </p>
          ))}
        </div>
      )}
      {recentPrices && !recent.length && (
        <p>
          No recent price is attributed to this supplier. Request-level market
          evidence, when available, is shown separately.
        </p>
      )}
      <p>
        <strong>Price: </strong>
        {price
          ? price.low !== undefined && price.high !== undefined
            ? formatPrice(price.low, price.high, c.currency, c.unit)
            : `${price.low === undefined ? "Upper" : "Lower"} bound only: ${displaySupplierText(c.currency, "Currency not stated")} ${price.low ?? price.high} / ${displaySupplierText(c.unit, "unit not stated")}`
          : "No attributable price found"}
      </p>
      <p>
        <strong>Price date: </strong>
        {displaySupplierText(
          c.price_date,
          "Not stated in supplier price evidence",
        )}
      </p>
      {price && (
        <>
          <p>
            Delivery basis:{" "}
            {[c.incoterm, c.incoterm_location].filter(Boolean).join(" ") ||
              "Not stated"}
          </p>
          <p>Recorded indication; current quotation required.</p>
          {price && !price.sources.length && (
            <p>No linked price source available.</p>
          )}
        </>
      )}
      {detailed && price && (
        <>
          <p>Validity / source wording: {c.price_validity ?? "Not stated"}</p>
          {price && <SourceLinks sources={price.sources} />}
        </>
      )}
    </div>
  );
}

export function ResearchPricing({
  output,
}: {
  output: ConsultantResearchOutputV3;
}) {
  const groups = researchPriceGroups(output);
  const additional = additionalPriceEvidence(output);
  const count = groups.reduce((total, group) => total + group.prices.length, 0);
  const oneSided = output.supplier_candidates.filter((supplier) => {
    const price = supplierPrice(
      supplier,
      output.evidence_sources,
      output.claims,
    );
    return (
      price &&
      (price.low === undefined || price.high === undefined) &&
      (price.sources.length > 0 || output.research_mode === "fixture")
    );
  });
  return (
    <section
      aria-labelledby="research-pricing-heading"
      className="rounded-lg border border-sky-800 bg-slate-900 p-4 space-y-3 text-slate-200"
    >
      <h3 id="research-pricing-heading" className="font-semibold text-white">
        Research price range
      </h3>
      {output.price_research && (
        <RecentResearchPrices search={output.price_research} />
      )}
      {output.price_research && (
        <h4 className="font-semibold pt-3 border-t border-slate-600">
          Other retained supplier price indications
        </h4>
      )}
      <p className="text-sm">
        {count} of {output.supplier_candidates.length} supplier profiles have
        sourced prices with both bounds recorded. These are observed
        indications, not a current market quotation or a delivered-cost
        estimate. Different products, currencies, units, delivery terms,
        quantities and price dates are shown separately.
      </p>
      {output.research_mode === "fixture" && (
        <p>Illustrative fixture prices only.</p>
      )}
      {!groups.length && (
        <p className="text-sm">
          No comparable supplier price range is available from this saved
          research.
        </p>
      )}
      {groups.map((group, index) => {
        const first = group.prices[0]!;
        const c = first.supplier.commercial;
        return (
          <div
            key={index}
            className="rounded border border-slate-700 p-3 text-sm space-y-1"
          >
            <p className="font-bold text-sky-300">
              {formatPrice(group.low, group.high, c.currency, c.unit)}
            </p>
            <p>{first.supplier.offering.product_name}</p>
            <p>
              {[c.incoterm, c.incoterm_location].filter(Boolean).join(" ") ||
                "Delivery basis not stated"}{" "}
              · MOQ: {c.moq ?? "Not stated"}
            </p>
            <p>
              Price date: {first.date ?? "Not stated"} · {group.prices.length}{" "}
              supplier profile(s)
              {group.low === group.high
                ? " · Single observed price; broader range unavailable"
                : ""}
            </p>
            <details>
              <summary className="cursor-pointer">
                Price sources and dates
              </summary>
              {group.prices.map((price) => (
                <div className="mt-3" key={price.supplier.candidate_id}>
                  <strong>{price.supplier.legal_name}</strong>
                  <SupplierPriceSummary
                    supplier={price.supplier}
                    evidence={output.evidence_sources}
                    claims={output.claims}
                    detailed
                  />
                </div>
              ))}
            </details>
          </div>
        );
      })}
      {oneSided.length > 0 && (
        <details className="border-t border-slate-700 pt-3 text-sm">
          <summary className="cursor-pointer">
            One-sided supplier price indications ({oneSided.length})
          </summary>
          <p>
            A minimum or maximum alone is excluded from the comparable price
            range.
          </p>
          {oneSided.map((supplier) => (
            <div key={supplier.candidate_id} className="mt-3">
              <strong>{supplier.legal_name}</strong>
              <SupplierPriceSummary
                supplier={supplier}
                evidence={output.evidence_sources}
                claims={output.claims}
                detailed
              />
            </div>
          ))}
        </details>
      )}
      {additional.length > 0 && (
        <div className="border-t border-slate-700 pt-3 space-y-3 text-sm">
          <h4 className="font-semibold text-amber-200">
            Additional price evidence
          </h4>
          <p>
            These source quotations are not attributed to the listed supplier
            profiles and are excluded from their price range. Product, date,
            availability and delivery basis require confirmation. Historical
            prices are not current offers.
          </p>
          {additional.map(({ source, rows, dateText }) => (
            <div
              key={source.evidence_id}
              className="rounded border border-slate-700 p-3 space-y-2"
            >
              {rows.map((row) => (
                <blockquote key={row} className="font-semibold">
                  {row}
                </blockquote>
              ))}
              <p>Source price date / update: {dateText ?? "Not stated"}</p>
              <SourceLinks sources={[source]} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
