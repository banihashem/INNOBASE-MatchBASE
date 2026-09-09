import type {
  ConsultantResearchOutputV3,
  EvidenceSourceV3,
  SupplierEntityV3,
  ClaimV3,
} from "@matchbase/contracts";
import {
  additionalPriceEvidence,
  formatPrice,
  researchPriceGroups,
  supplierPrice,
} from "./research-pricing";

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
}: {
  supplier: SupplierEntityV3;
  evidence: readonly EvidenceSourceV3[];
  claims?: readonly ClaimV3[];
  detailed?: boolean;
}) {
  const price = supplierPrice(supplier, evidence, claims);
  const c = supplier.commercial;
  return (
    <div
      className="text-xs space-y-1 py-2"
      aria-label={`Price for ${supplier.legal_name}`}
    >
      <p>
        <strong>Price: </strong>
        {price
          ? formatPrice(price.low, price.high, c.currency, c.unit)
          : c.price_max !== undefined
            ? `Upper bound only: ${c.currency ?? "Currency not stated"} ${c.price_max}${c.unit ? ` / ${c.unit}` : ""}`
            : "No attributable price found"}
      </p>
      <p>
        <strong>Price date: </strong>
        {price?.date ?? "Not stated in supplier price evidence"}
      </p>
      {price && (
        <>
          <p>
            Delivery basis:{" "}
            {[c.incoterm, c.incoterm_location].filter(Boolean).join(" ") ||
              "Not stated"}
          </p>
          <p>Recorded indication; current quotation required.</p>
          {!price.sources.length && <p>No linked price source available.</p>}
        </>
      )}
      {detailed && price && (
        <>
          <p>Validity / source wording: {c.price_validity ?? "Not stated"}</p>
          <SourceLinks sources={price.sources} />
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
  return (
    <section
      aria-labelledby="research-pricing-heading"
      className="rounded-lg border border-sky-800 bg-slate-900 p-4 space-y-3 text-slate-200"
    >
      <h3 id="research-pricing-heading" className="font-semibold text-white">
        Research price range
      </h3>
      <p className="text-sm">
        {count} of {output.supplier_candidates.length} supplier profiles have
        sourced prices. These are observed indications, not a current market
        quotation or a delivered-cost estimate. Different products, currencies,
        units, delivery terms, quantities and price dates are shown separately.
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
