import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

function token(name: string): string {
  const value = css.match(
    new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "iu"),
  )?.[1];
  if (!value) throw new Error(`Missing color token: --${name}`);
  return value;
}

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/gu)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function ratio(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("keeps the rendered design-token contrast pairs above WCAG AA thresholds", () => {
  const pairs = [
    {
      name: "body text",
      foreground: token("ink"),
      background: token("surface"),
      minimum: 4.5,
    },
    {
      name: "muted text",
      foreground: token("muted"),
      background: token("surface"),
      minimum: 4.5,
    },
    {
      name: "primary action",
      foreground: "#ffffff",
      background: token("forest"),
      minimum: 4.5,
    },
    {
      name: "error text",
      foreground: token("danger"),
      background: token("surface"),
      minimum: 4.5,
    },
    {
      name: "progress fill",
      foreground: token("forest"),
      background: token("line"),
      minimum: 3,
    },
    {
      name: "progress track boundary",
      foreground: token("forest"),
      background: token("surface"),
      minimum: 3,
    },
    {
      name: "focus indicator",
      foreground: token("focus"),
      background: token("paper"),
      minimum: 3,
    },
  ];

  for (const pair of pairs) {
    expect(
      ratio(pair.foreground, pair.background),
      `${pair.name}: ${pair.foreground} on ${pair.background}`,
    ).toBeGreaterThanOrEqual(pair.minimum);
  }
});
