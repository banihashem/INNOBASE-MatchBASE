import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ProductFlow } from "./ProductFlow";

const session = {
  display_name: "Demo Evaluator",
  tier: "demo" as const,
  quota: { limit: 3, used: 3, remaining: 0, next_capacity_at: null },
  execution: { active: 0, capacity: 3 },
  research_mode: {
    id: "synthetic_reference" as const,
    label: "Synthetic reference" as const,
    live_qualified: false,
  },
  csrf_token: "fixture-csrf-value",
  environment: "test" as const,
};

afterEach(() => vi.unstubAllGlobals());

test("initial session hydration preserves browser focus before the skip link", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(session), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );

  render(<ProductFlow />);
  expect(
    screen.getByRole("heading", { name: "Checking workspace access" }),
  ).toBeVisible();
  expect(
    await screen.findByRole("heading", { name: "Frame the request" }),
  ).toBeVisible();
  await waitFor(() => expect(document.body).toHaveFocus());
  expect(screen.getByRole("link", { name: "Skip to main content" })).toBe(
    document.querySelector(".app-shell > .skip-link"),
  );
});
