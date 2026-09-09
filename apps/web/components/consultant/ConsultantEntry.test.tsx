import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Page from "../../app/page";
import { ProductRouter } from "../ProductRouter";
import { ConsultantEntry } from "./ConsultantEntry";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("Consultant-only entry presents one sign-in path without demonstration or other tier navigation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 401 })),
  );
  render(
    <ProductRouter
      consultantOnly
      authPath="/auth/simulator/start?fixture=consultant"
    />,
  );
  expect(
    await screen.findByRole("link", { name: /Sign in as Consultant/ }),
  ).toHaveAttribute("href", "/auth/simulator/start?fixture=consultant");
  expect(screen.queryByText(/Standard workspace/i)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Find suppliers/ })).toBeVisible();
});

test("Consultant-only entry does not grant access to an authenticated Standard account", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ tier: "standard", csrf_token: "test-csrf" }),
        ),
    ),
  );
  render(<ProductRouter consultantOnly authPath="/auth/google/start" />);
  expect(
    await screen.findByRole("heading", { name: "Consultant access required" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: /New research/ }),
  ).not.toBeInTheDocument();
});

test("failed identity lookup explains recovery without guessing access", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 503 })),
  );
  render(<ProductRouter consultantOnly authPath="/auth/google/start" />);
  expect(
    await screen.findByRole("button", { name: "Reload workspace" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Continue with Google" }),
  ).not.toBeInTheDocument();
});

test("switching accounts uses CSRF and idempotency and retains context on failure", async () => {
  const fetcher = vi.fn(async () => new Response("{}", { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  render(
    <ConsultantEntry
      state="access-required"
      authPath="/auth/google/start"
      csrfToken="test-csrf"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Use another account" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your account is unchanged",
    ),
  );
  expect(fetcher).toHaveBeenCalledWith(
    "/auth/logout",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "X-CSRF-Token": "test-csrf",
        "Idempotency-Key": expect.stringMatching(/^signout-/),
      }),
    }),
  );
});

test("local sign-in fixtures do not falsely label verified live research as demonstration-only", () => {
  vi.stubEnv("MATCHBASE_LIVE_RESEARCH_ENABLED", "true");
  vi.stubEnv("MATCHBASE_LIVE_RESEARCH_CREDENTIALS_VERIFIED", "true");
  vi.stubEnv("MATCHBASE_SYNTHETIC_FIXTURE", "true");
  expect(Page().props.signedOutResearchMode.live_qualified).toBe(true);
  vi.stubEnv("MATCHBASE_LIVE_RESEARCH_CREDENTIALS_VERIFIED", "false");
  expect(Page().props.signedOutResearchMode.live_qualified).toBe(false);
});
