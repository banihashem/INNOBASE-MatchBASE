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

test("renders exact failed workflow identities with source drilldown", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Deployments", exact: true }).click();
  for (const { runId, jobId, commit } of [
    {
      runId: "31828022521",
      jobId: "94856743504",
      commit: "edd721df00fa14d048e36d76bbe5366841a6a672",
    },
    {
      runId: "31839133155",
      jobId: "94891988899",
      commit: "9ba20d0e60992b844d036a32d8e1bae8934f291c",
    },
    {
      runId: "31841980355",
      jobId: "94900624954",
      commit: "23c932c4b731e02976e86cf23f25f49a0653b242",
    },
    {
      runId: "31848282665",
      jobId: "94919022117",
      commit: "d44fc5305473725600237f0de40d8e66568cb3b7",
    },
  ]) {
    const card = page.locator("article", {
      hasText: `EXT-GITHUB-FAILURE-${runId}`,
    });
    await expect(card).toContainText(jobId);
    await expect(card).toContainText(commit);
    await expect(card).toContainText("failure");
    await card.getByRole("button", { name: "Inspect 1 source" }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "predecessor-failures-v1.json",
    );
    await page.getByRole("button", { name: "Close source drilldown" }).click();
  }
});
