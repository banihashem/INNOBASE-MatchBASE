import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Browser } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { GOLDEN_SCENARIO_V3_01 } from "@matchbase/contracts";
import {
  ConsultantPdfRenderer,
  ConsultantPdfRendererUnavailableError,
  readConsultantPdfPageCount,
} from "../src/pdf-generator.js";

test("MB-UX-QUALITY-001 L06 PDF metadata reads compressed page trees without changing bytes", async () => {
  const document = await PDFDocument.create();
  document.setTitle("Synthetic metadata fixture /Count 999 /Type /Page");
  for (let index = 0; index < 13; index += 1) document.addPage();
  const bytes = await document.save({ useObjectStreams: true });
  const before = Buffer.from(bytes);
  assert.equal(await readConsultantPdfPageCount(bytes), 13);
  assert.deepEqual(Buffer.from(bytes), before);
});

test("MB-UX-QUALITY-001 L06 invalid PDF metadata never becomes an estimated page count", async () => {
  await assert.rejects(
    readConsultantPdfPageCount(Buffer.from("not a PDF")),
    ConsultantPdfRendererUnavailableError,
  );
});

test(
  "MB-UX-QUALITY-001 L06 multi-page supplier dossiers retain actual page metadata on a cold cache hit",
  { timeout: 60_000 },
  async () => {
    const cache = await mkdtemp(join(tmpdir(), "matchbase-pdf-metadata-"));
    const renderer = new ConsultantPdfRenderer();
    Reflect.set(renderer, "getCacheDir", () => cache);
    const getBrowser = Reflect.get(
      renderer,
      "getBrowser",
    ) as () => Promise<Browser>;
    let browser: Browser | undefined;
    try {
      browser = await getBrowser.call(renderer);
      const newPage = browser.newPage.bind(browser);
      browser.newPage = async (...args) => {
        const page = await newPage(...args);
        await page.route("**/*", (route) => route.abort());
        return page;
      };
      const seedSupplier = structuredClone(
        GOLDEN_SCENARIO_V3_01.supplier_candidates[0]!,
      );
      const supplier = {
        ...seedSupplier,
        assessment: {
          ...seedSupplier.assessment,
          risk_flags: Array.from(
            { length: 90 },
            (_, index) =>
              `Synthetic dossier validation item ${index + 1}: independently confirm product scope, source date and the supplier's current commercial terms before procurement.`,
          ),
        },
      };
      const output = {
        ...GOLDEN_SCENARIO_V3_01,
        research_run_id: "synthetic-pdf-page-count",
        supplier_candidates: [supplier],
        claims: GOLDEN_SCENARIO_V3_01.claims.filter(
          (claim) => claim.supplier_entity_id === supplier.supplier_entity_id,
        ),
      };
      const before = JSON.stringify(output);
      const first = await renderer.renderPdfArtifact(output);
      assert.ok(
        first.pageCount > 5,
        "A multi-page dossier must exceed the old four-plus-matrix estimate",
      );
      assert.equal(
        await readConsultantPdfPageCount(first.bytes),
        first.pageCount,
      );
      await browser.close();
      browser = undefined;

      const coldRenderer = new ConsultantPdfRenderer();
      Reflect.set(coldRenderer, "getCacheDir", () => cache);
      Reflect.set(coldRenderer, "getBrowser", async () => {
        throw new Error("Cached PDF metadata must not rerender the report");
      });
      const cached = await coldRenderer.renderPdfArtifact(output);
      assert.equal(cached.pageCount, first.pageCount);
      assert.deepEqual(
        cached.bytes,
        first.bytes,
        "Cache bytes must remain unchanged",
      );
      assert.equal(JSON.stringify(output), before);

      // A valid header alone must not trap future downloads on a corrupt cached page tree.
      const files = await readdir(cache);
      assert.equal(files.length, 1);
      await writeFile(
        join(cache, files[0]!),
        `%PDF-1.7\n${" ".repeat(11_000)}`,
      );
      let replacementRenders = 0;
      Reflect.set(coldRenderer, "getBrowser", async () => ({
        newPage: async () => ({
          setContent: async () => {},
          pdf: async () => {
            replacementRenders += 1;
            return first.bytes;
          },
          close: async () => {},
        }),
      }));
      const repaired = await coldRenderer.renderPdfArtifact(output);
      assert.equal(replacementRenders, 1);
      assert.equal(repaired.pageCount, first.pageCount);
      assert.deepEqual(repaired.bytes, first.bytes);
      const repairedCacheHit = await coldRenderer.renderPdfArtifact(output);
      assert.equal(
        replacementRenders,
        1,
        "The replacement must be retained in cache",
      );
      assert.equal(repairedCacheHit.pageCount, first.pageCount);
    } finally {
      await browser?.close();
      await rm(cache, { recursive: true, force: true });
    }
  },
);
