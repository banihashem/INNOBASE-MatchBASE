import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import { ProductRouter } from "../ProductRouter";

const adminSession = {
  display_name: "Admin Operator",
  tier: "admin" as const,
  admin_sub_roles: ["super_admin"],
  quota: { limit: null, used: 0, remaining: null, next_capacity_at: null },
  execution: { active: 0, capacity: 3 },
  research_mode: {
    id: "qualified_live_research" as const,
    label: "Qualified live research" as const,
    live_qualified: true,
  },
  csrf_token: "fixture-csrf-value",
  environment: "test" as const,
};

const jsdomAxeOptions = {
  runOnly: {
    type: "tag" as const,
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
  },
  rules: { "color-contrast": { enabled: false } },
};

afterEach(() => vi.unstubAllGlobals());

test("routes Super-admin to governed product and operational tools without changing entitlement", async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(adminSession), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<ProductRouter authPath="/auth/simulator/start" />);

  expect(
    await screen.findByRole("heading", {
      name: "Operational control workspace",
    }),
  ).toBeVisible();
  expect(
    screen.getByText(/without changing the stored Admin entitlement/),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Start product research" }),
  ).toHaveAttribute("href", "/admin/product");
  expect(screen.getByRole("link", { name: "Open my results" })).toHaveAttribute(
    "href",
    "/admin/profile",
  );
  expect(
    screen.getByRole("link", { name: "Open research inventory" }),
  ).toHaveAttribute("href", "/admin/research");
  expect(
    screen.getByRole("link", { name: "Open entitlement manager" }),
  ).toHaveAttribute("href", "/admin/entitlements");
  expect(
    screen.getByRole("link", { name: "Open governance queue" }),
  ).toHaveAttribute("href", "/admin/requests");
  expect(screen.getByText("super_admin")).toBeVisible();
  expect(screen.queryByText(/unlimited research/iu)).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((await axe.run(document, jsdomAxeOptions)).violations).toEqual([]);
});
