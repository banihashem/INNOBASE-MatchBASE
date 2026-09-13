import { render, screen, fireEvent, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ResearchReview } from "@matchbase/contracts";
import { ResearchReviewPanel } from "./ResearchReviewPanel";
import { phaseLabel } from "./workflow-status";

const review: ResearchReview = {
  version: "research-review.v1",
  round_number: 2,
  leads: [
    {
      lead_id: "lead-a",
      name: "Unfinished logistics",
      website_url: "https://example.com",
      source_urls: ["https://example.com/services", "javascript:alert(1)"],
      status: "needs_review",
      reason: "Route not confirmed",
      missing_evidence: ["Aqaba service evidence"],
      first_seen_round: 1,
      last_seen_round: 2,
    },
  ],
  coverage_gaps: ["Destination coverage"],
  summary: { discovered: 4, documented: 3, needs_review: 1, excluded: 0 },
  changes: { new_leads: 1, promoted: 2 },
};
it("MB-UX-QUALITY-001 L01 labels the approved planning stage distinctly from web research", () => {
  expect(phaseLabel("research_focus_analysis")).toBe(
    "Analysing your follow-up and saved findings",
  );
});
it("MB-UX-QUALITY-001 L01 distinguishes leads from suppliers and exposes evidence before selection", () => {
  const select = vi.fn();
  render(<ResearchReviewPanel review={review} onSelect={select} />);
  fireEvent.click(screen.getByText(/Incomplete research leads/));
  expect(screen.getByText(/they are not documented suppliers/)).toBeVisible();
  expect(screen.getByText("Aqaba service evidence")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "https://example.com/services" }),
  ).toHaveAttribute("href", "https://example.com/services");
  expect(
    screen.queryByRole("link", { name: /javascript/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Include Unfinished logistics in follow-up focus",
    }),
  );
  expect(select).toHaveBeenCalledWith("lead-a", true);
});
it("MB-UX-QUALITY-001 L01 makes historical lead review read-only", () => {
  render(<ResearchReviewPanel review={review} />);
  fireEvent.click(screen.getByText(/Incomplete research leads/));
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByText(/First seen: round 1/)).toBeVisible();
});

const progressiveReview: ResearchReview = {
  ...review,
  round_number: 4,
  evidence_memory: {
    version: "research-evidence-memory.v1",
    round_number: 4,
    entities: [{ lead_id: "lead-a", name: "Unfinished logistics" }],
    source_urls: ["https://example.com/services"],
    facts: [],
    relationships: [
      {
        insight_id: "insight-a",
        kind: "shared_source",
        statement: "Two supplier mentions use the same directory entry.",
        lead_ids: ["lead-a"],
        source_urls: [
          "https://example.com/services",
          Object.assign(new URL("https://example.com"), {
            username: "synthetic-user",
          }).href,
        ],
        next_question: "Does the registry distinguish these legal entities?",
        status: "research_hypothesis",
      },
    ],
    limitations: ["The directory may repeat company marketing."],
  },
  method_reviews: [
    {
      method: "official_institutions",
      round_number: 4,
      status: "incomplete",
      searched_at: "2026-09-13T10:00:00Z",
      lead_ids: ["lead-a"],
      sources: [
        {
          url: "https://registry.example/record",
          title: "Company register search result",
          excerpt: "<script>source claim</script>",
          retrieved_at: null,
          access: "provider_citation_only",
        },
        {
          url: "javascript:alert(1)",
          title: "Access-limited record",
          excerpt: "Access requires an account.",
          retrieved_at: null,
          access: "access_limited",
        },
      ],
      limitations: ["Company-level customs records were unavailable."],
    },
  ],
};

it("MB-UX-QUALITY-001 L11 presents source-backed relationships as questions, not established supplier facts", () => {
  render(<ResearchReviewPanel review={progressiveReview} />);
  const region = screen.getByRole("region", {
    name: "Research questions from connected findings",
  });
  expect(region).toHaveTextContent(
    "not established company, ownership or capability facts",
  );
  expect(
    screen.getByText("Does the registry distinguish these legal entities?"),
  ).toBeVisible();
  expect(
    screen.getByText(/Related research records: Unfinished logistics/),
  ).toBeVisible();
  expect(
    within(region).getByRole("link", { name: "https://example.com/services" }),
  ).toHaveAttribute("href", "https://example.com/services");
  expect(screen.queryByRole("link", { name: /secret/ })).toBeNull();
  expect(
    screen.getByText("The directory may repeat company marketing."),
  ).toBeVisible();
  expect(screen.queryByRole("button")).toBeNull();
});

it("MB-UX-QUALITY-001 L11 keeps provider citations and limited access distinct from retrieved official evidence", () => {
  const { container } = render(
    <ResearchReviewPanel review={progressiveReview} />,
  );
  fireEvent.click(
    screen.getByText(/Country and institutional sources · Round 4/),
  );
  expect(
    screen.getByText(/Company-level customs records were unavailable/),
  ).toBeVisible();
  expect(
    screen.getByText(
      /Search-provider citation only · full content not retrieved/,
    ),
  ).toBeVisible();
  expect(
    screen.getByText(/Access limited · source content not confirmed/),
  ).toBeVisible();
  expect(
    screen.getByText(
      /not necessarily a confirmed corporate profile or official company record/,
    ),
  ).toBeVisible();
  expect(screen.getByText("<script>source claim</script>")).toBeVisible();
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
});

it.each([
  [
    "social_evidence_research",
    "Checking public corporate profiles and social sources",
  ],
  [
    "institutional_evidence_research",
    "Checking country registries and institutional records",
  ],
])(
  "MB-UX-QUALITY-001 L11 identifies the running %s method without claiming completion",
  (phase, label) => {
    expect(phaseLabel(phase)).toBe(label);
  },
);
