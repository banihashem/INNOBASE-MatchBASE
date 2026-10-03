import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webRequire = createRequire(resolve(root, "apps/web/package.json"));
const tailwindRequire = createRequire(webRequire.resolve("tailwindcss"));
const chokidarRequire = createRequire(tailwindRequire.resolve("chokidar"));
const micromatchRequire = createRequire(tailwindRequire.resolve("micromatch"));
const fastGlobRequire = createRequire(tailwindRequire.resolve("fast-glob"));
const fastGlobMicromatchRequire = createRequire(
  fastGlobRequire.resolve("micromatch"),
);
const bracesPath = micromatchRequire.resolve("braces");
const braces = micromatchRequire("braces");
const micromatch = tailwindRequire("micromatch");
const depthError = /Maximum pattern nesting depth \(64\) exceeded/u;
const widthError = /Maximum pattern AST nodes \(16384\) exceeded/u;
const cycleError = /Cyclic .*pattern AST/u;

function deepAst() {
  let node = { type: "root", nodes: [] };
  for (let i = 0; i < 100; i += 1) {
    node = { type: "root", nodes: [node] };
  }
  return node;
}

test("all Tailwind 3 paths resolve the same patched braces package", () => {
  const paths = [
    chokidarRequire.resolve("braces"),
    micromatchRequire.resolve("braces"),
    fastGlobMicromatchRequire.resolve("braces"),
  ];
  for (const path of paths) {
    assert.equal(realpathSync(path), realpathSync(bracesPath));
  }
});

test("patched braces preserves ordinary compile and expansion", () => {
  assert.deepEqual(braces("{a,b}"), ["(a|b)"]);
  assert.equal(braces.compile("prefix/{a,b}/suffix"), "prefix/(a|b)/suffix");
  assert.deepEqual(braces.expand("{a,b}"), ["a", "b"]);
  assert.equal(braces.stringify(braces.parse("{a,b}")), "{a,b}");
  assert.deepEqual(
    micromatch(["src/a.ts", "src/b.js", "src/c.md"], "src/*.{ts,js}"),
    ["src/a.ts", "src/b.js"],
  );

  const withinLimit = `${"(".repeat(63)}x${")".repeat(63)}`;
  assert.equal(braces.compile(withinLimit), withinLimit);
  assert.throws(
    () => braces.parse(`${"(".repeat(64)}x${")".repeat(64)}`),
    depthError,
  );
});

test("string input rejects excessive braces and parentheses before a stack overflow", () => {
  const nestedBraces = `${"{".repeat(3000)}a,b${"}".repeat(3000)}`;
  const nestedParens = `${"(".repeat(3000)}x${")".repeat(3000)}`;
  for (const input of [nestedBraces, nestedParens]) {
    assert.ok(input.length < 10000);
    for (const entry of [braces.parse, braces.compile, braces.expand]) {
      assert.throws(
        () => entry(input, { maxLength: 10000, maxDepth: 10000 }),
        depthError,
      );
    }
  }
});

test("direct caller ASTs are bounded in compile, expand, and stringify", () => {
  for (const entry of [braces.compile, braces.expand, braces.stringify]) {
    assert.throws(() => entry(deepAst(), { maxDepth: 10000 }), depthError);
  }
});

test("direct AST width and cycles are rejected before recursive processing", () => {
  for (const entry of [braces.compile, braces.expand, braces.stringify]) {
    const wide = {
      type: "root",
      nodes: Array.from({ length: 16384 }, () => ({
        type: "text",
        value: "x",
      })),
    };
    assert.throws(() => entry(wide), widthError);

    const cyclic = { type: "root", nodes: [] };
    cyclic.nodes.push(cyclic);
    assert.throws(() => entry(cyclic), cycleError);

    const child = { type: "root", nodes: [] };
    child.parent = child;
    assert.throws(() => entry({ type: "root", nodes: [child] }), cycleError);
  }
});

test("nested array AST values and numeric fields fail before implicit coercion", () => {
  let nested = "x";
  for (let i = 0; i < 20000; i += 1) {
    nested = [nested];
  }
  const cyclic = [];
  cyclic.push(cyclic);

  for (const entry of [braces.compile, braces.expand, braces.stringify]) {
    assert.throws(
      () => entry({ type: "root", nodes: [{ type: "text", value: nested }] }),
      /Expected pattern AST value string/u,
    );
    assert.throws(
      () => entry({ type: "root", nodes: [{ type: "text", value: cyclic }] }),
      /Expected pattern AST value string/u,
    );
    for (const field of ["ranges", "commas"]) {
      assert.throws(
        () =>
          entry({
            type: "root",
            nodes: [{ type: "brace", [field]: nested, nodes: [] }],
          }),
        new RegExp(`Expected pattern AST ${field} non-negative integer`, "u"),
      );
    }
  }
});
