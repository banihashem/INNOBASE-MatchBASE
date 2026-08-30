import { expect, test } from "@playwright/test";
import { buildConsultantResultProjectionV2 } from "../../packages/application/dist/index.js";
import { parseConsultantResultProjectionV2 } from "../../packages/contracts/dist/src/index.js";
import {
  buildStandardSyntheticEvidenceGraph,
  buildStandardSyntheticHardConstraints,
} from "../../packages/ai-evidence/dist/src/standard.js";
import { expectAccessibleState } from "./accessibility-matrix.mjs";

const runId = "00000000-0000-4000-8000-000000000137";
const constraints = buildStandardSyntheticHardConstraints();
const result = structuredClone(
  buildConsultantResultProjectionV2({
    completeResult: buildStandardSyntheticEvidenceGraph(
      runId,
      "many",
      constraints,
    ),
    projectionAsOf: new Date("2026-08-25T00:00:00.000Z"),
    hardConstraints: constraints,
    softCap: 3,
    configurationRelease: {
      configId: "00000000-0000-4000-8000-000000000620",
      configVersion: "consultant-soft-cap.browser.v1",
      contentSha256: "a".repeat(64),
      boundAt: new Date("2026-08-25T00:00:00.000Z"),
      effectiveReleaseAt: new Date("2026-08-24T00:00:00.000Z"),
    },
  }),
);
const longUrl = `https://long-source.example.test/${"bounded-evidence-segment-".repeat(12)}`;
const liveFact = result.source_facts.find(
  (fact) => fact.verification_disposition === "accepted",
);
if (!liveFact)
  throw new Error("Consultant browser fixture requires accepted evidence.");
const visibleCitation = result.candidates
  .flatMap((candidate) => candidate.citations)
  .find((citation) => citation.evidence_id === liveFact.evidence_id);
if (!visibleCitation)
  throw new Error("Consultant browser fixture requires a visible citation.");
delete liveFact.fixture_identity;
liveFact.exact_url = longUrl;
liveFact.publisher_domain = "long-source.example.test";
liveFact.provenance = "live_secure_fetch";
delete visibleCitation.fixture_identity;
visibleCitation.exact_url = longUrl;
visibleCitation.provenance = "live_secure_fetch";
parseConsultantResultProjectionV2(result);

function json(route, value) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

test("Consultant result is keyboard operable, complete, and responsive", async ({
  page,
}) => {
  await page.route("**/api/v1/me", (route) =>
    json(route, {
      display_name: "Consultant Evaluator",
      tier: "consultant",
      quota: { limit: 20, used: 1, remaining: 19, next_capacity_at: null },
      execution: { active: 0, capacity: 3 },
      research_mode: {
        id: "synthetic_reference",
        label: "Synthetic reference",
        live_qualified: false,
      },
      csrf_token: "consultant-browser-csrf",
      environment: "test",
    }),
  );
  await page.route(`**/api/v1/runs/${runId}/result`, (route) =>
    json(route, result),
  );
  await page.route("**/api/v1/runs?filter=all", (route) =>
    json(route, {
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
    }),
  );

  await page.goto("/");
  const historyHeading = page.getByRole("heading", {
    name: "Your sourcing runs",
  });
  await expect(historyHeading).toBeVisible();
  await expect(historyHeading).not.toBeFocused();
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/u);
  const openResult = page.getByRole("button", { name: "Open result" });
  await openResult.focus();
  await page.keyboard.press("Enter");
  const resultHeading = page.getByRole("heading", {
    name: "Eligible candidate landscape",
  });
  await expect(resultHeading).toBeFocused();
  await expect(page.getByText("Evidence confidence").first()).toBeVisible();
  await expect(page.getByText("Positive drivers").first()).toBeVisible();
  await expect(page.getByText("Limitations and evidence state")).toBeVisible();
  await expect(page.getByRole("meter")).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "Synthetic RFQ execution snapshot" }),
  ).toBeVisible();
  await expect(page.getByText(/no supplier was contacted/iu)).toBeVisible();
  const configuration = page.getByText("Bound configuration release");
  await configuration.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("consultant-soft-cap.browser.v1")).toBeVisible();
  const sourceFacts = page.getByText(/Source facts \([1-9][0-9]*\)/u);
  await sourceFacts.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: longUrl })).toBeVisible();
  await expect(
    page.getByText(result.rfq_execution_snapshot.wave_instance_id),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expectAccessibleState(page, "Consultant result with real candidates", {
    responsive: true,
  });
});
