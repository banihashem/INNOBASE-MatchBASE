import type {
  ResearchPriceSearchV3,
  ResearchPriceObservationV3,
} from "@matchbase/contracts";
import { formatPrice } from "./research-pricing";

/** MB-UX-DEV-004 L02: age belongs to the saved search, not the viewer's clock. */
export function recentPriceObservations(
  search?: ResearchPriceSearchV3,
): ResearchPriceObservationV3[] {
  if (!search) return [];
  const asOf = Date.parse(search.searched_at);
  return search.observations.filter((price) => {
    const age = asOf - Date.parse(price.source_published_at);
    return (
      Number.isFinite(age) &&
      age >= 0 &&
      age < 30 * 86400000 &&
      (!price.valid_until || Date.parse(price.valid_until) >= asOf) &&
      Number.isFinite(price.price_min) &&
      price.price_min >= 0 &&
      Number.isFinite(price.price_max) &&
      price.price_max >= price.price_min
    );
  });
}

export function RecentResearchPrices({
  search,
  compact = false,
}: {
  search: ResearchPriceSearchV3;
  compact?: boolean;
}) {
  const valid = recentPriceObservations(search);
  const week = valid.filter(
    (p) =>
      Date.parse(search.searched_at) - Date.parse(p.source_published_at) <
      7 * 86400000,
  );
  const preferred = week.length ? week : valid;
  const groups = new Map<string, ResearchPriceObservationV3[]>();
  for (const price of preferred) {
    // An unspecified unit or market does not establish comparability.
    const key = JSON.stringify([
      price.provenance,
      price.currency,
      price.unit ?? price.observation_id,
      price.product_or_service,
      price.route_or_market ?? price.observation_id,
      price.incoterm ?? price.observation_id,
      price.quantity_basis ?? price.observation_id,
      price.supplier_name,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), price]);
  }
  return (
    <div className="space-y-3" aria-label="Recent price research">
      <h4 className="font-semibold">Recent supplier and market prices</h4>
      <p className="text-sm">
        Search completed: {search.searched_at.slice(0, 10)}. Price windows
        checked:{" "}
        {search.searched_windows_days.map((d) => `${d} days`).join(" → ") ||
          "Not completed"}
        .
      </p>
      <p className="text-sm">
        Supplier listings and market benchmarks are separate. A benchmark does
        not establish a supplier&apos;s offer or delivered cost. Dates refer to
        the source price, not the page visit.
      </p>
      {search.status === "incomplete" && (
        <p className="text-sm">
          Recent-price research is incomplete. Available evidence is retained
          below.
        </p>
      )}
      {!preferred.length && (
        <p className="font-semibold">
          No usable price dated within the checked period was verified. A
          current quotation is required.
        </p>
      )}
      {[...groups.values()].map((prices) => {
        const first = prices[0]!;
        return (
          <div
            key={first.observation_id}
            className="rounded border border-slate-500 p-3 space-y-2 text-sm"
          >
            <p className="font-bold">
              {formatPrice(
                Math.min(...prices.map((p) => p.price_min)),
                Math.max(...prices.map((p) => p.price_max)),
                first.currency,
                first.unit ?? undefined,
              )}
            </p>
            <p className="font-semibold">
              {first.provenance === "supplier_listing"
                ? `Supplier listing · ${first.supplier_name ?? "Named source"}`
                : "Market benchmark · not a supplier quotation"}
            </p>
            <p>
              {first.product_or_service} ·{" "}
              {first.route_or_market ?? "Market or route not stated"}
            </p>
            <p>
              Delivery terms: {first.incoterm ?? "Not stated"} ·{" "}
              {week.length
                ? "Under 7 days at search time"
                : "Under 30 days at search time"}
            </p>
            <p>Quantity basis: {first.quantity_basis ?? "Not stated"}</p>
            {prices.map((price) => (
              <div key={price.observation_id}>
                <p>
                  Price date: {price.source_published_at.slice(0, 10)}
                  {price.valid_until
                    ? ` · Valid until: ${price.valid_until.slice(0, 10)}`
                    : ""}
                </p>
                <a
                  className="underline break-all"
                  href={
                    /^https?:\/\//i.test(price.source_url)
                      ? price.source_url
                      : undefined
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {price.source_title || price.source_url}
                </a>
                {!compact && (
                  <details>
                    <summary className="cursor-pointer">
                      Price evidence and relevance
                    </summary>
                    <blockquote className="mt-2">{price.quote}</blockquote>
                    <p>{price.date_quote}</p>
                    <p>{price.relevance_note}</p>
                  </details>
                )}
              </div>
            ))}
          </div>
        );
      })}
      {search.limitations.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">
            Price coverage and limitations
          </summary>
          <ul className="list-disc pl-5 text-sm">
            {search.limitations.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
