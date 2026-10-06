// MB-SEC-DEPENDENCIES-001 L03: exercise the installed patched native library.
// https://github.com/advisories/GHSA-wq5f-xc86-pv6w
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isolatedEnvironment } from "../../scripts/dependency-audit.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const web = createRequire(resolve(root, "apps/web/package.json"));
const next = createRequire(web.resolve("next"));
const sharpPath = next.resolve("sharp");

function isolated(check) {
  const result = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=128",
      "--input-type=commonjs",
      "--eval",
      `const sharp=require(${JSON.stringify(sharpPath)});sharp.cache(false);sharp.concurrency(1);(${check.toString()})(sharp).catch(error=>{console.error(error);process.exitCode=1;});`,
    ],
    {
      cwd: root,
      env: isolatedEnvironment(),
      shell: false,
      timeout: 10000,
      maxBuffer: 128 * 1024,
      encoding: "utf8",
    },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
}

test("patched sharp loads librsvg 2.63.2 and renders bounded ordinary SVG pixels", () => {
  isolated(async (sharp) => {
    const assert = require("node:assert/strict");
    assert.equal(sharp.versions.sharp, "0.35.5");
    assert.equal(sharp.versions.rsvg, "2.63.2");
    assert.equal(sharp.versions.vips, "8.18.7");
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#ff0000"/><circle cx="8" cy="8" r="4" fill="#0000ff"/></svg>',
    );
    const { data, info } = await sharp(svg, { limitInputPixels: 4096 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 16);
    assert.equal(info.height, 16);
    assert.equal(info.channels, 4);
    assert.equal(data.length, 16 * 16 * 4);
    assert.deepEqual([...data.subarray(0, 4)], [255, 0, 0, 255]);
    const center = (8 * 16 + 8) * 4;
    assert.deepEqual([...data.subarray(center, center + 4)], [0, 0, 255, 255]);
  });
});

test("patched sharp preserves ordinary PNG encode resize and decode behavior", () => {
  isolated(async (sharp) => {
    const assert = require("node:assert/strict");
    const raw = Buffer.alloc(8 * 8 * 3);
    for (let i = 0; i < raw.length; i += 3) {
      raw[i] = 12;
      raw[i + 1] = 34;
      raw[i + 2] = 56;
    }
    const png = await sharp(raw, { raw: { width: 8, height: 8, channels: 3 } })
      .png()
      .toBuffer();
    const metadata = await sharp(png, { limitInputPixels: 4096 }).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 8);
    assert.equal(metadata.height, 8);
    const { data, info } = await sharp(png, { limitInputPixels: 4096 })
      .resize(4, 4, { kernel: "nearest" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 4);
    assert.equal(info.height, 4);
    assert.equal(info.channels, 3);
    for (let i = 0; i < data.length; i += 3)
      assert.deepEqual([...data.subarray(i, i + 3)], [12, 34, 56]);
  });
});

test("patched sharp rejects malformed SVG and excessive declared dimensions within a bounded process", () => {
  isolated(async (sharp) => {
    const assert = require("node:assert/strict");
    const malformed = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect></svg>',
    );
    await assert.rejects(
      sharp(malformed, { limitInputPixels: 4096 }).png().toBuffer(),
    );
    const large = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="10000"><rect width="1" height="1"/></svg>',
    );
    await assert.rejects(
      sharp(large, { limitInputPixels: 4096 }).png().toBuffer(),
      /pixel limit/i,
    );
  });
});
