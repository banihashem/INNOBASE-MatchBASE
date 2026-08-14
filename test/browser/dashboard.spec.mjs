import { expect, test } from "@playwright/test";

const views = [
  "Portfolio",
  "Gates",
  "Backlog",
  "Decisions",
  "Risks",
  "Requirements",
  "Tests",
  "Defects",
  "Deployments",
  "Costs",
  "Agents",
  "Loops",
  "Evidence",
];

test("renders every control view without horizontal mobile overflow", async ({
  page,
}) => {
  const errors = [];
  const failedResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      failedResponses.push({ status: response.status(), url: response.url() });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Portfolio");
  for (const name of views) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  }
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(Math.max(dimensions.body, dimensions.document)).toBeLessThanOrEqual(
    dimensions.viewport,
  );
  const expectedSnapshotMisses = failedResponses.filter(
    ({ status, url }) =>
      status === 404 && new URL(url).pathname === "/current-snapshot.json",
  );
  expect(failedResponses).toEqual(expectedSnapshotMisses);
  expect(
    errors.filter(
      (message) =>
        message !==
        "Failed to load resource: the server responded with a status of 404 (Not Found)",
    ),
  ).toEqual([]);
  expect(errors).toHaveLength(expectedSnapshotMisses.length);
});

test("desktop control room fits its viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Portfolio");
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(Math.max(dimensions.body, dimensions.document)).toBeLessThanOrEqual(
    dimensions.viewport,
  );
});
