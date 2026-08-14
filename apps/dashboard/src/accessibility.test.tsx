import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { fixtureSnapshot } from "./test/fixture";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("dashboard accessibility", () => {
  it("has no automatically detectable structural violations", async () => {
    document.documentElement.lang = "en";
    document.title = "MatchBASE Control Room";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fixtureSnapshot())),
    );
    render(<App />);
    await screen.findByText("Local PM dashboard");
    const result = await axe.run(document, {
      // jsdom has no canvas; the exact foreground/background ratios are asserted below.
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });

  it("uses a coral accent with WCAG AA contrast on light surfaces", () => {
    const channel = (value: number) => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) => {
      const channels = hex
        .match(/[0-9a-f]{2}/giu)
        ?.map((part) => parseInt(part, 16));
      if (!channels || channels.length !== 3) throw new Error("invalid color");
      return (
        0.2126 * channel(channels[0]!) +
        0.7152 * channel(channels[1]!) +
        0.0722 * channel(channels[2]!)
      );
    };
    const ratio = (foreground: string, background: string) => {
      const values = [luminance(foreground), luminance(background)].sort(
        (a, b) => b - a,
      );
      return (values[0]! + 0.05) / (values[1]! + 0.05);
    };
    expect(ratio("c83232", "ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("c83232", "faf9f7")).toBeGreaterThanOrEqual(4.5);
  });
});
