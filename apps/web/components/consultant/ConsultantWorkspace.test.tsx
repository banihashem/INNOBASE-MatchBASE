import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import {
  buildConsultantResultProjection,
  buildConsultantResultProjectionV2,
} from "@matchbase/application";
import {
  buildStandardSyntheticEvidenceGraph,
  buildStandardSyntheticHardConstraints,
} from "@matchbase/ai-evidence/standard";
import { ConsultantWorkspace } from "./ConsultantWorkspace";
import { ProductRouter } from "../ProductRouter";

const session = {
  display_name: "Consultant Evaluator",
  tier: "consultant" as const,
  quota: { limit: 20, used: 1, remaining: 19, next_capacity_at: null },
  execution: { active: 0, capacity: 3 },
  research_mode: {
    id: "synthetic_reference" as const,
    label: "Synthetic reference" as const,
    live_qualified: false,
  },
  csrf_token: "consultant-csrf",
  environment: "test" as const,
};

const runId = "00000000-0000-4000-8000-000000000137";
const history = {
  items: [
    {
      run_id: runId,
      request_id: "00000000-0000-4000-8000-000000000138",
      state: "completed",
      updated_at: "2026-08-25T00:00:00.000Z",
      result_available: true,
      outcome: "matched",
    },
  ],
};
const constraints = buildStandardSyntheticHardConstraints();
const result = buildConsultantResultProjection({
  completeResult: buildStandardSyntheticEvidenceGraph(
    runId,
    "two",
    constraints,
  ),
  projectionAsOf: new Date("2026-08-25T00:00:00.000Z"),
  hardConstraints: constraints,
  softCap: 20,
});
const resultV2 = buildConsultantResultProjectionV2({
  completeResult: buildStandardSyntheticEvidenceGraph(
    "00000000-0000-4000-8000-000000000139",
    "many",
    constraints,
  ),
  projectionAsOf: new Date("2026-08-25T00:00:00.000Z"),
  hardConstraints: constraints,
  softCap: 3,
  configurationRelease: {
    configId: "00000000-0000-4000-8000-000000000620",
    configVersion: "consultant-soft-cap.test.v1",
    contentSha256: "a".repeat(64),
    boundAt: new Date("2026-08-25T00:00:00.000Z"),
    effectiveReleaseAt: new Date("2026-08-24T00:00:00.000Z"),
  },
});

afterEach(() => vi.unstubAllGlobals());

test("ProductRouter resolves Consultant into the visible Consultant workspace", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(input).includes("/api/v1/me") ? session : { items: [] },
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  render(<ProductRouter authPath="/auth/simulator/start" />);
  expect(
    await screen.findByRole("heading", { name: "Your sourcing runs" }),
  ).toBeVisible();
  expect(
    screen.getByText("Consultant", { selector: ".tier-badge" }),
  ).toBeVisible();
  expect(
    screen.queryByText(/No product workflow is enabled/iu),
  ).not.toBeInTheDocument();
});

test("renders owned runs, distinct counts, below-cap disclosure and source limitation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(String(input).endsWith("/result") ? result : history),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  const { container } = render(
    <ConsultantWorkspace initialSession={session} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Open result" }));
  const heading = await screen.findByRole("heading", {
    name: "Eligible candidate landscape",
  });
  expect(heading).toBeVisible();
  await waitFor(() => expect(heading).toHaveFocus());
  expect(screen.getByText("Eligible candidates")).toBeVisible();
  expect(screen.getByText("Displayed candidates")).toBeVisible();
  expect(
    screen.getByText(/safety scarcity rule overrides the documented minimum/u),
  ).toBeVisible();
  expect(
    screen.getByText(/Consultant source readiness: limited/u),
  ).toBeVisible();
  expect(
    screen.getAllByRole("meter", { name: /compatibility score/u }),
  ).toHaveLength(2);
  expect(screen.getAllByText("Evidence confidence")).toHaveLength(2);
  expect(screen.getAllByText("Positive drivers")).toHaveLength(2);
  expect((await axe.run(container)).violations).toEqual([]);
});

test("renders v2 source policy, RFQ wave, eligible reserves, diligence, and fail-closed limitations", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(input).endsWith("/result") ? resultV2 : history,
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  const { container } = render(
    <ConsultantWorkspace initialSession={session} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Open result" }));
  expect(
    await screen.findByRole("heading", {
      name: "Eligible candidate landscape",
    }),
  ).toBeVisible();
  expect(
    screen.getByText(/Production release remains blocked/iu),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "Source policy" })).toBeVisible();
  expect(screen.getByText("task137-rfq-wave-due-diligence.v1")).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Synthetic RFQ wave recommendation" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Next-ranked eligible reserves" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Synthetic RFQ execution snapshot" }),
  ).toBeVisible();
  expect(screen.getByText(/no supplier was contacted/iu)).toBeVisible();
  expect(screen.getByText("3 / 2 / 3")).toBeVisible();
  fireEvent.click(screen.getByText("Bound configuration release"));
  expect(screen.getByText("consultant-soft-cap.test.v1")).toBeVisible();
  expect(screen.getByText("Synthetic RFQ question set (20)")).toBeVisible();
  expect(screen.getByText("Due-diligence checklist (8)")).toBeVisible();
  fireEvent.click(screen.getByText(/Source facts \([1-9][0-9]*\)/u));
  expect(screen.getByText(/publisher are display claims only/iu)).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Full limitations" }),
  ).toBeVisible();
  expect((await axe.run(container)).violations).toEqual([]);
});

test("keeps initial focus before the skip link and formats run time in explicit UTC", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(history), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
  render(<ConsultantWorkspace initialSession={session} />);
  const heading = await screen.findByRole("heading", {
    name: "Your sourcing runs",
  });
  expect(heading).not.toHaveFocus();
  const time = screen.getByText(/25 Aug 2026/u).closest("time");
  expect(time).toHaveAttribute("datetime", "2026-08-25T00:00:00.000Z");
});

test("exposes empty and retryable error states", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<ConsultantWorkspace initialSession={session} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be loaded",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("No sourcing runs"),
  );
});

test("rejects malformed Consultant network output before rendering it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(input).endsWith("/result")
              ? { ...result, hidden_supplier_score: 99 }
              : history,
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  render(<ConsultantWorkspace initialSession={session} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open result" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The result could not be loaded.",
  );
  expect(
    screen.queryByRole("heading", { name: "Eligible candidate landscape" }),
  ).not.toBeInTheDocument();
});

test("rejects an unknown result schema before the Demo render branch", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(input).endsWith("/result")
              ? {
                  schema_version: "future-unknown-projection.v9",
                  candidates: [],
                  limitations_notice: "Must not render.",
                }
              : history,
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  render(<ConsultantWorkspace initialSession={session} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open result" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The result could not be loaded.",
  );
  expect(
    screen.queryByRole("heading", {
      name: "Original disclosure depth preserved",
    }),
  ).not.toBeInTheDocument();
});

test("parses immutable historical Demo and Standard results at the client boundary", async () => {
  const standardResult = {
    ...Object.fromEntries(
      Object.entries(result).filter(
        ([key]) => key !== "landscape" && key !== "consultant_source_readiness",
      ),
    ),
    schema_version: "standard-result-projection.v1",
    projection_version: 4,
  };
  const demoResult = {
    schema_version: "demo-projection.v1",
    run_id: runId,
    outcome: "no_responsible_match",
    scarcity: "zero",
    candidates: [],
    unmet_mandatory_constraints: [],
    limitations_notice: "Historical Demo projection.",
    projection_version: 1,
  };
  for (const [body, heading] of [
    [standardResult, "Responsible candidate comparison"],
    [demoResult, "Original disclosure depth preserved"],
  ] as const) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(
            JSON.stringify(String(input).endsWith("/result") ? body : history),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const view = render(<ConsultantWorkspace initialSession={session} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open result" }));
    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();
  }
});
