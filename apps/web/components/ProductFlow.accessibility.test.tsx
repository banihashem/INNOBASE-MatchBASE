import { fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { expect, test, vi } from "vitest";
import { ProductFlow } from "./ProductFlow";

const jsdomAxeOptions = {
  rules: { "color-contrast": { enabled: false } },
};

const session = {
  display_name: "Demo Evaluator",
  tier: "demo" as const,
  quota: { limit: 3, used: 0, remaining: 3, next_capacity_at: null },
  execution: { active: 0, capacity: 3 },
  research_mode: {
    id: "synthetic_reference" as const,
    label: "Synthetic reference" as const,
    live_qualified: false,
  },
  csrf_token: "fixture-csrf-value",
  environment: "test" as const,
};

test("signed-out, intake and validation states have no axe violations", async () => {
  const { unmount } = render(<ProductFlow initialSession={null} />);
  expect((await axe.run(document, jsdomAxeOptions)).violations).toEqual([]);

  unmount();
  render(<ProductFlow initialSession={session} />);
  expect((await axe.run(document, jsdomAxeOptions)).violations).toEqual([]);

  fireEvent.click(
    screen.getByRole("button", { name: "Continue to English confirmation" }),
  );
  expect((await axe.run(document, jsdomAxeOptions)).violations).toEqual([]);
});

test("canonical confirmation has no axe violations", async () => {
  vi.stubGlobal("crypto", { randomUUID: () => "fixture-id" });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            request_id: "request-1",
            canonical_version_id: "canonical-1",
            version: 1,
            canonical_language: "en",
            canonical_text: "Source an industrial fixture product.",
            source_language_tag: "ar",
            source_language_confidence: 0.98,
            fields: [
              {
                fieldId: "field-1",
                path: "product.need",
                canonicalValue: "Industrial fixture product",
                languageOrigin: "translated",
              },
            ],
            match_readiness: "ready",
            contradictions: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  render(<ProductFlow initialSession={session} />);
  fireEvent.change(screen.getByLabelText("What must be sourced?"), {
    target: { value: "Synthetic source value" },
  });
  fireEvent.change(
    screen.getByLabelText("What conditions cannot be compromised?"),
    {
      target: { value: "Synthetic mandatory condition" },
    },
  );
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to English confirmation" }),
  );
  await screen.findByRole("heading", {
    name: "Confirm the normalized request",
  });
  expect((await axe.run(document, jsdomAxeOptions)).violations).toEqual([]);
});
