import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ProductFlow, SYNTHETIC_NOTICE } from "./ProductFlow";

const session = {
  display_name: "Demo Evaluator",
  tier: "demo" as const,
  quota: { limit: 3, used: 1, remaining: 2, next_capacity_at: null },
  execution: { active: 1, capacity: 3 },
  research_mode: {
    id: "synthetic_reference" as const,
    label: "Synthetic reference" as const,
    live_qualified: false,
  },
  csrf_token: "fixture-csrf-value",
  environment: "test" as const,
};

const canonical = {
  request_id: "request-1",
  canonical_version_id: "canonical-1",
  version: 1,
  canonical_language: "en" as const,
  canonical_text: "Source a corrosion-resistant industrial pump.",
  source_language_tag: "fa",
  source_language_confidence: 0.99,
  fields: [
    {
      fieldId: "field-1",
      path: "product.need",
      canonicalValue: "Corrosion-resistant industrial pump",
      languageOrigin: "translated",
    },
  ],
  match_readiness: "ready" as const,
  contradictions: [],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("keeps the exact synthetic disclosure visible in signed-out and workspace states", () => {
  const { unmount } = render(<ProductFlow initialSession={null} />);
  expect(screen.getByText(SYNTHETIC_NOTICE)).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Continue with Google" }),
  ).toHaveAttribute("href", "/auth/google/start");
  unmount();
  render(<ProductFlow initialSession={session} />);
  expect(screen.getByText(SYNTHETIC_NOTICE)).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Frame the request" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /upload/i }),
  ).not.toBeInTheDocument();
});

test("renders the server-assigned qualified-live mode without provider topology", () => {
  const qualifiedSession = {
    ...session,
    research_mode: {
      id: "qualified_live_research" as const,
      label: "Qualified live research" as const,
      live_qualified: true,
    },
  };
  const { container } = render(
    <ProductFlow initialSession={qualifiedSession} />,
  );
  expect(
    screen.getByText(
      "Qualified live research — external evidence is fetched and verified for this run",
    ),
  ).toBeVisible();
  expect(screen.queryByText(SYNTHETIC_NOTICE)).not.toBeInTheDocument();
  expect(container.textContent).not.toMatch(
    /gemini|openrouter|provider|model/iu,
  );
});

test("renders the server-owned qualified-live boundary before authentication", () => {
  render(
    <ProductFlow
      initialSession={null}
      signedOutResearchMode={{
        id: "qualified_live_research",
        label: "Qualified live research",
        live_qualified: true,
      }}
    />,
  );
  expect(
    screen.getByText(
      "Qualified live research is enabled — each run remains evidence-bound",
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      "Google authentication is active. Research mode is assigned by server policy after sign-in.",
    ),
  ).toBeVisible();
  expect(screen.queryByText(SYNTHETIC_NOTICE)).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      /external evidence is fetched and verified for this run/iu,
    ),
  ).not.toBeInTheDocument();
});

test("reports all three-part validation failures and focuses the first invalid field", async () => {
  render(<ProductFlow initialSession={session} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to English confirmation" }),
  );
  const summary = await screen.findByRole("alert");
  expect(summary).not.toHaveFocus();
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(screen.getByLabelText("What must be sourced?")).toHaveFocus();
  for (const field of screen.getAllByRole("textbox")) {
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")).toMatch(/-error/u);
  }
});

test("clears transient intake after canonicalization and renders only Demo projection fields", async () => {
  const responses = [
    canonical,
    {},
    {
      run_id: "run-1",
      state: "queued",
      phase_label: "Queued for fixture evaluation",
      terminal: false,
      result_available: false,
      poll_after_ms: 250,
      progress: {
        steps_completed: 0,
        steps_total_planned: 5,
        percent_complete: 0,
      },
      links: {
        result: null,
        cancel: "/api/v1/runs/run-1/cancellation",
      },
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const body = responses.shift();
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  vi.stubGlobal("crypto", { randomUUID: () => "fixture-id" });

  render(<ProductFlow initialSession={session} />);
  fireEvent.change(screen.getByLabelText("What must be sourced?"), {
    target: { value: "Transient source fixture" },
  });
  fireEvent.change(
    screen.getByLabelText("What conditions cannot be compromised?"),
    {
      target: { value: "Mandatory fixture constraint" },
    },
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "This information is unknown or not applicable",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to English confirmation" }),
  );
  expect(
    await screen.findByRole("heading", {
      name: "Confirm the normalized request",
    }),
  ).toBeVisible();
  expect(
    screen.queryByDisplayValue("Transient source fixture"),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Translated")).toBeVisible();
});

test("blocks contradictions until a corrected immutable version is returned", async () => {
  const blocked = {
    ...canonical,
    match_readiness: "not_ready" as const,
    contradictions: ["constraint.location.conflict"],
  };
  const revised = {
    ...canonical,
    version: 2,
    canonical_version_id: "canonical-2",
  };
  const responses = [blocked, revised];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(responses.shift()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
  vi.stubGlobal("crypto", { randomUUID: () => "fixture-id" });
  render(<ProductFlow initialSession={session} />);
  fireEvent.change(screen.getByLabelText("What must be sourced?"), {
    target: { value: "Fixture product" },
  });
  fireEvent.change(
    screen.getByLabelText("What conditions cannot be compromised?"),
    {
      target: { value: "Fixture constraint" },
    },
  );
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to English confirmation" }),
  );
  expect(
    await screen.findByRole("heading", {
      name: "Contradictions block research",
    }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Confirm and start research" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Create corrected version" }),
  );
  await waitFor(() =>
    expect(
      screen.getByText("English canonical request · Version 2"),
    ).toBeVisible(),
  );
  expect(
    screen.getByRole("button", { name: "Confirm and start research" }),
  ).toBeVisible();
});

describe("Demo disclosure", () => {
  test("does not render prohibited fields even when a hostile payload supplies them", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const responses = [
      canonical,
      {},
      {
        run_id: "run-1",
        state: "running",
        phase_label: "Applying mandatory constraints",
        terminal: false,
        result_available: false,
        poll_after_ms: 250,
        progress: {
          steps_completed: 2,
          steps_total_planned: 5,
          percent_complete: 40,
        },
        links: { result: null, cancel: "/api/v1/runs/run-1/cancellation" },
      },
      {
        run_id: "run-1",
        state: "complete",
        phase_label: "Complete",
        terminal: true,
        result_available: true,
        poll_after_ms: null,
        progress: {
          steps_completed: 5,
          steps_total_planned: 5,
          percent_complete: 100,
        },
        links: {
          result: "/api/v1/runs/run-1/result",
          cancel: "/api/v1/runs/run-1/cancellation",
        },
      },
      {
        schema_version: "demo-projection.v1",
        run_id: "run-1",
        outcome: "matched",
        scarcity: "limited",
        candidates: [
          {
            display_name: "Fixture Industries",
            country_code: "DE",
            rationale_short:
              "Meets the stated mandatory synthetic constraints.",
            compatibility_score: 98,
          },
        ],
        unmet_mandatory_constraints: [],
        limitations_notice: "Synthetic limitations apply.",
        projection_version: 1,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(responses.shift()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    vi.stubGlobal("crypto", { randomUUID: () => "fixture-id" });
    render(<ProductFlow initialSession={session} />);
    fireEvent.change(screen.getByLabelText("What must be sourced?"), {
      target: { value: "Fixture product" },
    });
    fireEvent.change(
      screen.getByLabelText("What conditions cannot be compromised?"),
      {
        target: { value: "Fixture constraint" },
      },
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to English confirmation" }),
    );
    await screen.findByRole("heading", {
      name: "Confirm the normalized request",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and start research" }),
    );
    await screen.findByRole("heading", { name: "Research in progress" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.queryByText("98")).not.toBeInTheDocument();
    expect(
      screen.getByText("The result disclosure failed its safety check."),
    ).toBeVisible();
  });
});
