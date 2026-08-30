import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import { ProductFlow } from "./ProductFlow";

const axeOptions = {
  runOnly: {
    type: "tag" as const,
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
  },
  rules: { "color-contrast": { enabled: false } },
};

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
  canonical_language: "en",
  canonical_text: "Source a fixture pump.",
  source_language_tag: "en",
  source_language_confidence: 1,
  fields: [],
  match_readiness: "ready",
  contradictions: [],
};

function run(state: "queued" | "running" | "complete", progress: number) {
  const terminal = state === "complete";
  return {
    run_id: "run-1",
    state,
    phase_label:
      state === "queued"
        ? "Queued"
        : state === "running"
          ? "Applying constraints"
          : "Complete",
    terminal,
    result_available: terminal,
    poll_after_ms: terminal ? null : 250,
    progress: {
      steps_completed: progress / 20,
      steps_total_planned: 5,
      percent_complete: progress,
    },
    links: {
      result: terminal ? "/api/v1/runs/run-1/result" : null,
      cancel: "/api/v1/runs/run-1/cancellation",
    },
  };
}

const result = {
  schema_version: "demo-projection.v1",
  run_id: "run-1",
  outcome: "matched",
  scarcity: "limited",
  candidates: [
    {
      display_name: "Fixture Industries",
      country_code: "DE",
      rationale_short: "Meets the mandatory synthetic constraint.",
    },
  ],
  unmet_mandatory_constraints: [],
  limitations_notice: "Synthetic limitations apply.",
  projection_version: 1,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function startDemoRun() {
  fireEvent.change(screen.getByLabelText("What must be sourced?"), {
    target: { value: "Fixture pump" },
  });
  fireEvent.change(
    screen.getByLabelText("What conditions cannot be compromised?"),
    { target: { value: "Must be corrosion resistant" } },
  );
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to English confirmation" }),
  );
  expect(
    await screen.findByRole("heading", {
      name: "Confirm the normalized request",
    }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm and start research" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Research in progress" }),
  ).toBeVisible();
}

test("pauses Demo polling, announces state once, and preserves focus on completion", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const statusResponses = [
    run("running", 40),
    run("running", 60),
    run("complete", 100),
  ];
  let statusRequests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      let body: unknown;
      if (url === "/api/v1/requests" && method === "POST") body = canonical;
      else if (url.endsWith("/confirmation")) body = {};
      else if (url === "/api/v1/runs" && method === "POST")
        body = run("queued", 0);
      else if (url === "/api/v1/runs/run-1/result") body = result;
      else if (url === "/api/v1/runs/run-1") {
        statusRequests += 1;
        body = statusResponses.shift();
      } else throw new Error(`Unexpected request: ${method} ${url}`);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  vi.stubGlobal("crypto", { randomUUID: () => "fixture-id" });

  const { container } = render(<ProductFlow initialSession={session} />);
  fireEvent.change(screen.getByLabelText("What must be sourced?"), {
    target: { value: "Fixture pump" },
  });
  fireEvent.change(
    screen.getByLabelText("What conditions cannot be compromised?"),
    { target: { value: "Must be corrosion resistant" } },
  );
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to English confirmation" }),
  );
  expect(
    await screen.findByRole("heading", {
      name: "Confirm the normalized request",
    }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm and start research" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Research in progress" }),
  ).toBeVisible();

  const liveStatus = container.querySelector("main > .sr-only[role='status']");
  expect(liveStatus).toBeEmptyDOMElement();
  fireEvent.click(screen.getByRole("button", { name: "Pause updates" }));
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(statusRequests).toBe(0);

  fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
  await waitFor(() => expect(statusRequests).toBe(1));
  await waitFor(() =>
    expect(liveStatus).toHaveTextContent("Applying constraints. Stage 2 of 5."),
  );

  fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
  await waitFor(() => expect(statusRequests).toBe(2));
  expect(liveStatus).toHaveTextContent("Applying constraints. Stage 2 of 5.");
  expect((await axe.run(document, axeOptions)).violations).toEqual([]);

  fireEvent.click(screen.getByRole("button", { name: "Resume updates" }));
  const brand = screen.getByRole("link", { name: "MatchBASE home" });
  brand.focus();
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(
    await screen.findByRole("heading", { name: "Eligible candidate summary" }),
  ).toBeVisible();
  expect(statusRequests).toBe(3);
  expect(brand).toHaveFocus();
  expect(liveStatus).toHaveTextContent(
    "Research complete. 1 eligible candidate.",
  );
});

test("discards an in-flight Demo poll when updates are paused", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let resolvePoll: ((response: Response) => void) | undefined;
  let statusRequests = 0;
  let resultRequests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/requests" && method === "POST")
        return new Response(JSON.stringify(canonical), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (url.endsWith("/confirmation"))
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (url === "/api/v1/runs" && method === "POST")
        return new Response(JSON.stringify(run("queued", 0)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (url === "/api/v1/runs/run-1") {
        statusRequests += 1;
        return new Promise<Response>((resolve) => {
          resolvePoll = resolve;
        });
      }
      if (url === "/api/v1/runs/run-1/result") {
        resultRequests += 1;
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }),
  );
  vi.stubGlobal("crypto", { randomUUID: () => "fixture-id" });

  const { container } = render(<ProductFlow initialSession={session} />);
  await startDemoRun();
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(statusRequests).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Pause updates" }));

  await act(async () => {
    resolvePoll?.(
      new Response(JSON.stringify(run("complete", 100)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await Promise.resolve();
  });

  expect(
    screen.getByRole("heading", { name: "Research in progress" }),
  ).toBeVisible();
  expect(resultRequests).toBe(0);
  expect(
    container.querySelector("main > .sr-only[role='status']"),
  ).not.toHaveTextContent("Research complete");
  expect((await axe.run(document, axeOptions)).violations).toEqual([]);
});

test("discloses a terminal Demo failure without moving existing focus", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const failedRun = {
    ...run("running", 80),
    state: "failed",
    phase_label: "Failed",
    terminal: true,
    result_available: false,
    poll_after_ms: null,
    links: {
      result: null,
      cancel: "/api/v1/runs/run-1/cancellation",
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      let body: unknown;
      if (url === "/api/v1/requests" && method === "POST") body = canonical;
      else if (url.endsWith("/confirmation")) body = {};
      else if (url === "/api/v1/runs" && method === "POST")
        body = run("queued", 0);
      else if (url === "/api/v1/runs/run-1") body = failedRun;
      else throw new Error(`Unexpected request: ${method} ${url}`);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  vi.stubGlobal("crypto", { randomUUID: () => "fixture-id" });

  render(<ProductFlow initialSession={session} />);
  await startDemoRun();
  const brand = screen.getByRole("link", { name: "MatchBASE home" });
  brand.focus();
  await act(async () => vi.advanceTimersByTimeAsync(300));

  expect(
    await screen.findByRole("heading", { name: "Research failed" }),
  ).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Research ended before a result was available.",
  );
  expect(
    screen.getByRole("button", { name: "Return to workspace" }),
  ).toBeVisible();
  expect(brand).toHaveFocus();
  expect((await axe.run(document, axeOptions)).violations).toEqual([]);
});
