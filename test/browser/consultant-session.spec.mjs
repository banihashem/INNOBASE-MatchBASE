import { expect, test } from "@playwright/test";

// Real HTTP and disposable PostgreSQL identity; no research is started.
test("Consultant Home sign-in reaches the saved workspace through the real session", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Sign in as Consultant/i }).click();
  await expect(
    page.getByRole("heading", { name: "Your sourcing dashboard" }),
  ).toBeVisible();
  const identity = await page.request.get("/api/v1/me");
  expect(identity.ok()).toBe(true);
  expect((await identity.json()).tier).toBe("consultant");
});
