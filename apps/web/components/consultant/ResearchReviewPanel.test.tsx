import { render, screen, fireEvent } from "@testing-library/react";
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
