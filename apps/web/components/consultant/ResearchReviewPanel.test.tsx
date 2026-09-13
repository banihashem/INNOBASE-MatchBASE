import { render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
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
  fireEvent.click(screen.getByText(/Evidence and missing information/));
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
  fireEvent.click(screen.getByText(/Evidence and missing information/));
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
  fireEvent.click(
    screen.getByText(/Research questions from connected findings/),
  );
  fireEvent.click(
    screen.getByText("Does the registry distinguish these legal entities?"),
  );
  const region = screen.getByRole("region", {
    name: "Research questions from connected findings",
  });
  expect(region).toHaveTextContent(
    "not established company, ownership or capability facts",
  );
  fireEvent.click(screen.getByText(/Unresolved research coverage/));
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
  expect(
    screen.queryByRole("button", { name: /Use research question/ }),
  ).toBeNull();
});

it("MB-UX-QUALITY-001 L11 keeps provider citations and limited access distinct from retrieved official evidence", () => {
  const { container } = render(
    <ResearchReviewPanel review={progressiveReview} />,
  );
  fireEvent.click(
    screen.getByText(/Public and institutional research sources/),
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

const manyLeads: ResearchReview = {
  ...review,
  leads: Array.from({ length: 12 }, (_, index) => ({
    ...review.leads[0]!,
    lead_id: `lead-${index + 1}`,
    name: `Company ${String(index + 1).padStart(2, "0")}`,
    status: index === 11 ? ("excluded" as const) : ("needs_review" as const),
    reason:
      index === 11
        ? "Company is outside the requested geography"
        : "Route not confirmed",
    missing_evidence:
      index === 8
        ? ["Independent export certificate"]
        : ["Aqaba service evidence"],
  })),
  summary: { discovered: 15, documented: 3, needs_review: 11, excluded: 1 },
};

function SelectionHarness({
  initialIds = [],
  disabled = false,
  withBulk = true,
}: {
  initialIds?: string[];
  disabled?: boolean;
  withBulk?: boolean;
}) {
  const [ids, setIds] = useState(initialIds);
  return (
    <ResearchReviewPanel
      review={manyLeads}
      selectedIds={ids}
      disabled={disabled}
      onSelect={(id, selected) =>
        setIds((previous) =>
          selected
            ? [...new Set([...previous, id])]
            : previous.filter((value) => value !== id),
        )
      }
      onSelectMany={
        withBulk
          ? (visible, selected) =>
              setIds((previous) =>
                selected
                  ? [...new Set([...previous, ...visible])]
                  : previous.filter((value) => !visible.includes(value)),
              )
          : undefined
      }
    />
  );
}

it("MB-UX-SIMPLIFY-001 L01 keeps evidence and research hypotheses available behind closed disclosures", () => {
  render(<ResearchReviewPanel review={progressiveReview} />);
  expect(screen.getByText("Route not confirmed")).not.toBeVisible();
  expect(
    screen.getByText("Does the registry distinguish these legal entities?"),
  ).not.toBeVisible();
  expect(
    screen.getByText("Company-level customs records were unavailable."),
  ).not.toBeVisible();
  expect(
    screen.getByText(/Unresolved research coverage · 2 limitations/),
  ).toBeVisible();
  fireEvent.click(
    screen.getByText(/Research questions from connected findings/),
  );
  expect(
    screen.getByText("Does the registry distinguish these legal entities?"),
  ).toBeVisible();
  expect(
    screen.getByText("Two supplier mentions use the same directory entry."),
  ).not.toBeVisible();
  fireEvent.click(
    screen.getByText("Does the registry distinguish these legal entities?"),
  );
  expect(
    screen.getByText("Two supplier mentions use the same directory entry."),
  ).toBeVisible();
});

it("MB-UX-SIMPLIFY-001 L01 searches every retained lead and evidence gap rather than only the visible page", () => {
  render(<ResearchReviewPanel review={manyLeads} />);
  fireEvent.click(screen.getByText(/Incomplete research leads/));
  expect(screen.getAllByRole("heading", { level: 5 })).toHaveLength(5);
  expect(screen.queryByText("Company 09")).toBeNull();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search incomplete leads" }),
    { target: { value: "INDEPENDENT certificate" } },
  );
  expect(screen.getByText("Company 09")).toBeVisible();
  expect(screen.getAllByRole("heading", { level: 5 })).toHaveLength(1);
  fireEvent.click(screen.getByText(/Evidence and missing information/));
  expect(screen.getByText("Independent export certificate")).toBeVisible();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "no such record" },
  });
  expect(screen.getByRole("status")).toHaveTextContent(
    "No leads match these filters",
  );
  expect(screen.queryByRole("heading", { name: /Company/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(screen.getByRole("searchbox")).toHaveValue("");
  expect(screen.getByRole("searchbox")).toHaveFocus();
  expect(screen.getByText("Company 01")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Showing 1–5 of 12");
});

it("MB-UX-SIMPLIFY-001 L01 preserves hidden selections and applies bulk changes only to the visible page", () => {
  render(<SelectionHarness initialIds={["lead-12"]} />);
  fireEvent.click(screen.getByText(/Incomplete research leads/));
  expect(screen.getByRole("status")).toHaveTextContent(
    "1 selected · 1 outside this page",
  );
  fireEvent.click(screen.getByRole("button", { name: "Select visible leads" }));
  expect(
    screen
      .getAllByRole("checkbox")
      .every((checkbox) => (checkbox as HTMLInputElement).checked),
  ).toBe(true);
  expect(screen.getByRole("status")).toHaveTextContent(
    "6 selected · 1 outside this page",
  );
  fireEvent.click(screen.getByRole("button", { name: "Next leads" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "6 selected · 6 outside this page",
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Include Company 06 in follow-up focus",
    }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Filter leads" }), {
    target: { value: "selected" },
  });
  expect(screen.getByRole("status")).toHaveTextContent(
    "7 selected · 2 outside this page",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Clear visible selection" }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "2 selected · 0 outside this page",
  );
  expect(
    screen.getByRole("checkbox", {
      name: "Include Company 06 in follow-up focus",
    }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", {
      name: "Include Company 12 in follow-up focus",
    }),
  ).toBeChecked();
  expect(
    screen.getByText("Company is outside the requested geography"),
  ).toBeVisible();
  expect(
    within(screen.getByText("Company 12").closest("li")!).getByText("Excluded"),
  ).toBeVisible();
});

it("MB-UX-SIMPLIFY-001 L01 keeps single-selection consumers compatible with visible bulk actions", () => {
  render(<SelectionHarness withBulk={false} initialIds={["lead-12"]} />);
  fireEvent.click(screen.getByText(/Incomplete research leads/));
  fireEvent.click(screen.getByRole("button", { name: "Select visible leads" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "6 selected · 1 outside this page",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Clear visible selection" }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "1 selected · 1 outside this page",
  );
});

it("MB-UX-SIMPLIFY-001 L01 shows selected-empty and excluded states without changing evidence classification", () => {
  render(<SelectionHarness />);
  fireEvent.click(screen.getByText(/Incomplete research leads/));
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "selected" },
  });
  expect(screen.getByText(/No leads are selected/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Select visible leads" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "excluded" },
  });
  expect(
    screen.getByRole("checkbox", {
      name: "Include Company 12 in follow-up focus",
    }),
  ).not.toBeChecked();
  expect(
    screen.getByText("Company is outside the requested geography"),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Select visible leads" }));
  expect(
    within(screen.getByText("Company 12").closest("li")!).getByText("Excluded"),
  ).toBeVisible();
  expect(screen.getByText(/they are not documented suppliers/)).toBeVisible();
});

it("MB-UX-SIMPLIFY-001 L01 disables selection mutations while keeping research review navigable", () => {
  render(<SelectionHarness disabled initialIds={["lead-1"]} />);
  fireEvent.click(screen.getByText(/Incomplete research leads/));
  expect(
    screen
      .getAllByRole("checkbox")
      .every((checkbox) => (checkbox as HTMLInputElement).disabled),
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Select visible leads" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Clear visible selection" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next leads" }));
  expect(screen.getByText("Company 06")).toBeVisible();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Company 01" },
  });
  expect(
    screen.getByRole("checkbox", {
      name: "Include Company 01 in follow-up focus",
    }),
  ).toBeChecked();
});

it("MB-UX-SIMPLIFY-001 L01 passes a retained source-backed question only after explicit use", () => {
  const onUseQuestion = vi.fn();
  const { rerender } = render(
    <ResearchReviewPanel
      review={progressiveReview}
      onUseQuestion={onUseQuestion}
    />,
  );
  fireEvent.click(
    screen.getByText(/Research questions from connected findings/),
  );
  expect(onUseQuestion).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Use research question: Does the registry distinguish these legal entities?",
    }),
  );
  expect(onUseQuestion).toHaveBeenCalledExactlyOnceWith(
    "Does the registry distinguish these legal entities?",
  );
  rerender(
    <ResearchReviewPanel
      review={progressiveReview}
      onUseQuestion={onUseQuestion}
      disabled
    />,
  );
  expect(
    screen.getByRole("button", { name: /Use research question/ }),
  ).toBeDisabled();
  const ungrounded: ResearchReview = {
    ...progressiveReview,
    evidence_memory: {
      ...progressiveReview.evidence_memory!,
      relationships: progressiveReview.evidence_memory!.relationships.map(
        (insight) => ({ ...insight, source_urls: ["javascript:alert(1)"] }),
      ),
    },
  };
  rerender(
    <ResearchReviewPanel review={ungrounded} onUseQuestion={onUseQuestion} />,
  );
  expect(
    screen.queryByRole("button", { name: /Use research question/ }),
  ).toBeNull();
});

it("MB-UX-SIMPLIFY-001 L01 keeps all retained research questions reachable in small pages", () => {
  const manyQuestions: ResearchReview = {
    ...progressiveReview,
    evidence_memory: {
      ...progressiveReview.evidence_memory!,
      relationships: Array.from({ length: 8 }, (_, index) => ({
        ...progressiveReview.evidence_memory!.relationships[0]!,
        insight_id: `question-${index}`,
        next_question: `Verify saved relationship ${index + 1}?`,
      })),
    },
  };
  render(<ResearchReviewPanel review={manyQuestions} />);
  fireEvent.click(
    screen.getByText(/Research questions from connected findings/),
  );
  expect(screen.getByText("Verify saved relationship 1?")).toBeVisible();
  expect(screen.queryByText("Verify saved relationship 4?")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Previous questions" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next questions" }));
  expect(screen.getByText("Verify saved relationship 4?")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next questions" }));
  expect(screen.getByText("Verify saved relationship 8?")).toBeVisible();
  expect(screen.getByRole("button", { name: "Next questions" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Previous questions" }));
  expect(screen.getByText("Verify saved relationship 4?")).toBeVisible();
});
