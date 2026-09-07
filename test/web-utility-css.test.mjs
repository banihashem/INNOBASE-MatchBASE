import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import postcssConfig from "../apps/web/postcss.config.mjs";

const requireWeb = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const postcss = requireWeb("postcss");
const inputPath = fileURLToPath(
  new URL("../apps/web/app/globals.css", import.meta.url),
);
const originalDirectory = process.cwd();
let generated;
try {
  // Match Next's app working directory and exercise real config discovery.
  process.chdir(fileURLToPath(new URL("../apps/web/", import.meta.url)));
  const plugins = Object.entries(postcssConfig.plugins).map(([name, options]) =>
    requireWeb(name)(options),
  );
  generated = await postcss(plugins).process(
    await readFile(inputPath, "utf8"),
    {
      from: inputPath,
    },
  );
} finally {
  process.chdir(originalDirectory);
}

function declaration(selector, property) {
  let value;
  generated.root.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(property, (entry) => {
      value = entry.value;
    });
  });
  return value;
}

test("web build emits layout, spacing and responsive Consultant utilities", () => {
  assert.equal(declaration(".flex", "display"), "flex");
  assert.equal(declaration(".p-6", "padding"), "1.5rem");
  assert.equal(declaration(".max-w-6xl", "max-width"), "72rem");
  assert.equal(declaration(".text-3xl", "font-size"), "1.875rem");
  assert.equal(declaration(".text-\\[11px\\]", "font-size"), "11px");
  assert.equal(declaration(".border", "border-style"), "solid");
  assert.equal(declaration(".border-b", "border-bottom-style"), "solid");
  assert.equal(declaration(".border-l-4", "border-left-style"), "solid");
  assert.equal(declaration(".border-l-4", "border-left-width"), "4px");
  let responsivePadding = false;
  generated.root.walkAtRules("media", (rule) => {
    if (rule.params !== "(min-width: 640px)") return;
    rule.walkRules(".sm\\:p-8", (entry) => {
      entry.walkDecls("padding", (padding) => {
        responsivePadding = padding.value === "2rem";
      });
    });
  });
  assert.ok(responsivePadding);
  assert.equal(generated.warnings().length, 0);
});

test("generated utilities preserve the legacy palette without a global reset or cascade layer", () => {
  assert.equal(declaration(":root", "--paper"), "#0b0f19");
  assert.equal(declaration(":root", "--indigo-500"), "#5b5cf6");
  assert.equal(
    declaration(".bg-slate-950", "background-color"),
    "rgb(11 15 25 / var(--tw-bg-opacity, 1))",
  );
  assert.match(declaration("h1", "font-size"), /^clamp\(/u);
  assert.match(declaration(".primary-action", "background"), /gradient/u);
  assert.equal(declaration("*", "border-style"), undefined);
  assert.equal(
    declaration("button, input, optgroup, select, textarea", "margin"),
    undefined,
  );
  assert.doesNotMatch(generated.css, /@(?:tailwind|layer)\b/u);
});
