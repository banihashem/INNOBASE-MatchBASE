// MB-SEC-DEPENDENCIES-001 L02: exercise the installed upstream CVE-2026-93749 fix.
// https://github.com/7rulnik/source-map-js/commit/cf7658058ceeaa8619d5ae0ec90be6905209d016
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isolatedEnvironment } from "../../scripts/dependency-audit.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const web = createRequire(resolve(root, "apps/web/package.json"));
const postcss = createRequire(web.resolve("postcss"));
const libraryPath = postcss.resolve("source-map-js");

function isolated(check) {
  const result = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=128",
      "--input-type=commonjs",
      "--eval",
      `(${check.toString()})(require(${JSON.stringify(libraryPath)}));`,
    ],
    {
      cwd: root,
      env: isolatedEnvironment(),
      shell: false,
      timeout: 5000,
      maxBuffer: 128 * 1024,
      encoding: "utf8",
    },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
}

test("source-map-js preserves ordinary generated and indexed mapping round trips", () => {
  isolated(({ SourceMapGenerator, SourceMapConsumer, SourceNode }) => {
    const assert = require("node:assert/strict");
    const generator = new SourceMapGenerator({ file: "bundle.js" });
    generator.addMapping({
      generated: { line: 1, column: 0 },
      original: { line: 4, column: 2 },
      source: "input.js",
      name: "value",
    });
    generator.setSourceContent("input.js", "const value = 1;");
    const consumer = new SourceMapConsumer(generator.toJSON());
    assert.deepEqual(consumer.originalPositionFor({ line: 1, column: 0 }), {
      source: "input.js",
      line: 4,
      column: 2,
      name: "value",
    });
    assert.equal(
      SourceNode.fromStringWithSourceMap("x", consumer).toString(),
      "x",
    );
    const ordinaryCopy = new SourceMapConsumer(
      SourceMapGenerator.fromSourceMap(consumer).toJSON(),
    );
    assert.deepEqual(
      ordinaryCopy.originalPositionFor({ line: 1, column: 0 }),
      consumer.originalPositionFor({ line: 1, column: 0 }),
    );
    const unnamed = new SourceMapGenerator({ file: "section.js" });
    unnamed.addMapping({
      generated: { line: 1, column: 0 },
      original: { line: 4, column: 2 },
      source: "input.js",
    });
    unnamed.setSourceContent("input.js", "const value = 1;");
    const indexed = new SourceMapConsumer({
      version: 3,
      sections: [{ offset: { line: 2, column: 0 }, map: unnamed.toJSON() }],
    });
    // Indexed consumers need an explicit sourceRoot for fromSourceMap.
    indexed.sourceRoot = null;
    const copied = new SourceMapConsumer(
      SourceMapGenerator.fromSourceMap(indexed).toJSON(),
    );
    assert.deepEqual(copied.originalPositionFor({ line: 3, column: 0 }), {
      source: "input.js",
      line: 4,
      column: 2,
      name: null,
    });
    assert.equal(copied.sourceContentFor("input.js"), "const value = 1;");
  });
});

test("source-map-js rejects malformed indexed line and column offsets", () => {
  isolated(({ SourceMapConsumer }) => {
    const assert = require("node:assert/strict");
    const flat = {
      version: 3,
      sources: ["input.js"],
      sourcesContent: ["x"],
      names: [],
      mappings: "AAAA",
    };
    for (const field of ["line", "column"]) {
      for (const invalid of [
        -1,
        0.5,
        NaN,
        Infinity,
        -Infinity,
        Number.MAX_SAFE_INTEGER + 1,
        "1",
        null,
        undefined,
        {},
      ]) {
        assert.throws(
          () =>
            new SourceMapConsumer({
              version: 3,
              sections: [
                { offset: { line: 0, column: 0, [field]: invalid }, map: flat },
              ],
            }),
          /Section offset line and column must be non-negative integers/u,
        );
      }
    }
  });
});

test("source-map-js rejects extreme and cumulatively excessive nested offsets", () => {
  isolated(({ SourceMapConsumer }) => {
    const assert = require("node:assert/strict");
    const flat = {
      version: 3,
      sources: ["input.js"],
      sourcesContent: ["x"],
      names: [],
      mappings: "AAAA",
    };
    const section = (line, map) => ({
      version: 3,
      sections: [{ offset: { line, column: 0 }, map }],
    });
    for (const line of [10_000_001, 1_000_000_000_000]) {
      assert.throws(
        () => new SourceMapConsumer(section(line, flat)),
        /must not exceed/u,
      );
    }
    assert.throws(
      () =>
        new SourceMapConsumer(
          section(5_000_000, section(5_000_000, section(5_000_000, flat))),
        ),
      /including offsets of nested sections/u,
    );
    const valid = new SourceMapConsumer(section(20, section(30, flat)));
    const lines = [];
    valid.eachMapping((mapping) => lines.push(mapping.generatedLine));
    assert.deepEqual(lines, [51]);
  });
});

test("source-map-js bounds accepted large gaps and nested source traversal in an isolated process", () => {
  isolated(({ SourceMapConsumer, SourceMapGenerator, SourceNode }) => {
    const assert = require("node:assert/strict");
    const flat = {
      version: 3,
      sources: ["input.js"],
      sourcesContent: ["x"],
      names: [],
      mappings: "AAAA",
    };
    const section = (line, map) => ({
      version: 3,
      sections: [{ offset: { line, column: 0 }, map }],
    });
    const largest = new SourceMapConsumer(section(10_000_000, flat));
    assert.equal(
      SourceNode.fromStringWithSourceMap("x", largest).toString(),
      "x",
    );
    const gap = new SourceMapConsumer(section(1_000_000, flat));
    gap.sourceRoot = null;
    const serialized = SourceMapGenerator.fromSourceMap(gap).toJSON().mappings;
    assert.equal(serialized.length, 1_000_004);
    assert.equal(serialized.slice(-5), ";AAAA");
    assert.equal(serialized.slice(0, 1_000_000), ";".repeat(1_000_000));
    let nested = flat;
    for (let depth = 0; depth < 35; depth += 1) nested = section(1, nested);
    assert.deepEqual(new SourceMapConsumer(nested).sources, ["input.js"]);
  });
});
