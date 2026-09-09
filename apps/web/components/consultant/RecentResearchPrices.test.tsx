import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type {
  ResearchPriceObservationV3,
  ResearchPriceSearchV3,
} from "@matchbase/contracts";
import {
  recentPriceObservations,
  RecentResearchPrices,
} from "./RecentResearchPrices";
afterEach(cleanup);
const observation: ResearchPriceObservationV3 = {
  observation_id: "one",
  provenance: "market_benchmark",
  supplier_name: null,
  source_url: "https://example.com/market",
  source_title: "Market bulletin",
  quote: "Rice USD100 per MT",
  date_quote: "Published 2026-09-08",
  price_min: 100,
  price_max: 120,
  currency: "USD",
  unit: "MT",
  product_or_service: "Rice",
  route_or_market: "UAE",
  incoterm: "FOB",
  quantity_basis: "1 MT",
  source_published_at: "2026-09-08T00:00:00Z",
  source_date_text: "Published 2026-09-08",
  valid_until: null,
  date_basis: "published",
  age_days: 1,
  recency: "under_7_days",
  relevance_note: "Same grade and market",
};
const search = (
  observations: ResearchPriceObservationV3[],
): ResearchPriceSearchV3 => ({
  searched_at: "2026-09-09T00:00:00Z",
  status: "prices_found",
  searched_windows_days: [7, 30],
  observations,
  limitations: [],
});
it("DEV004 L02 excludes future, expired and exactly thirty-day-old evidence regardless of supplied age", () => {
  const data = search([
    observation,
    {
      ...observation,
      observation_id: "future",
      source_published_at: "2026-09-10T00:00:00Z",
    },
    {
      ...observation,
      observation_id: "old",
      source_published_at: "2026-08-10T00:00:00Z",
    },
    {
      ...observation,
      observation_id: "expired",
      valid_until: "2026-09-08T00:00:00Z",
    },
  ]);
  expect(recentPriceObservations(data).map((p) => p.observation_id)).toEqual([
    "one",
  ]);
});
it("DEV004 L02 prefers seven-day evidence and separates benchmark from supplier quotation", () => {
  render(
    <RecentResearchPrices
      search={search([
        observation,
        {
          ...observation,
          observation_id: "month",
          price_min: 900,
          price_max: 900,
          source_published_at: "2026-08-30T00:00:00Z",
        },
      ])}
    />,
  );
  expect(screen.getByText("USD 100 – 120 / MT")).toBeInTheDocument();
  expect(screen.queryByText(/USD 900/)).not.toBeInTheDocument();
  expect(
    screen.getByText("Market benchmark · not a supplier quotation"),
  ).toBeInTheDocument();
  expect(screen.getByText(/Price date: 2026-09-08/)).toBeInTheDocument();
});
it("DEV004 L02 falls back to month evidence without mixing units or currencies", () => {
  const monthly = {
    ...observation,
    source_published_at: "2026-08-30T00:00:00Z",
  };
  render(
    <RecentResearchPrices
      search={search([
        monthly,
        {
          ...monthly,
          observation_id: "aed",
          currency: "AED",
          unit: "kg",
          price_min: 5,
          price_max: 5,
        },
      ])}
    />,
  );
  expect(screen.getByText("USD 100 – 120 / MT")).toBeInTheDocument();
  expect(screen.getByText("AED 5 / kg")).toBeInTheDocument();
  expect(screen.getAllByText(/Under 30 days/)).toHaveLength(2);
});
it("DEV004 L02 reports price-stage interruption without claiming a zero price", () => {
  render(
    <RecentResearchPrices
      search={{
        ...search([]),
        status: "incomplete",
        searched_windows_days: [7],
        limitations: ["Search interrupted"],
      }}
    />,
  );
  expect(
    screen.getByText(/Recent-price research is incomplete/),
  ).toBeInTheDocument();
  expect(screen.getByText(/No usable price dated/)).toBeInTheDocument();
  expect(screen.queryByText(/USD 0/)).not.toBeInTheDocument();
});
