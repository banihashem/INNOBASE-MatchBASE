import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createEnvironmentConsultantPdfPipeline } from "../../../packages/application/dist/consultant-pdf-reporting-adapter.js";

const environment = Object.freeze({
  MATCHBASE_CONSULTANT_PDF_RUNTIME: "enabled",
  MATCHBASE_PDF_TEMPLATE_SHA256:
    "473c4a1383b3ae99965a62eed29defa195cd1236a521581efa9c7f31b8afac9f",
  MATCHBASE_PDF_FONT_SHA256:
    "abdc775b21b1bc470d50c97e790d276f2054b7504e56e5bd3e64f48d68582322",
  MATCHBASE_PDF_TOOLCHAIN_SHA256:
    "af3810688779ce540e91eb42fc17304267c6384026d9eadc9d9e230957a083c0",
  MATCHBASE_PDF_ALLOWED_ATTESTATION_SHA256:
    "6585ad8d7f8788480cdab833ba9a703dbc683e6dd86d25aeb809da7e508c1d98",
});

test("enabled worker startup admits the tracked governed PDF attestation", async () => {
  const attestation = await readFile(
    new URL(
      "../../../packages/reporting/pdf-toolchain/template-attestation.json",
      import.meta.url,
    ),
    "utf8",
  );
  const pipeline = await createEnvironmentConsultantPdfPipeline(
    { query: async () => ({ rows: [] }) },
    environment,
    async () => attestation,
  );
  assert.ok(pipeline);
  assert.equal(
    pipeline.templateVersion,
    environment.MATCHBASE_PDF_TEMPLATE_SHA256,
  );
  assert.equal(pipeline.pageGeometry, "a4");
});

test("enabled worker startup rejects an attestation not bound to the configured allowlist", async () => {
  const mismatched = JSON.stringify({
    schema_version: "matchbase-template-qualification.v1",
    template_sha256: environment.MATCHBASE_PDF_TEMPLATE_SHA256,
    font_sha256: environment.MATCHBASE_PDF_FONT_SHA256,
    toolchain_sha256: environment.MATCHBASE_PDF_TOOLCHAIN_SHA256,
    qualified_checks: ["contrast_ratio"],
    evidence_sha256: "0".repeat(64),
    attestation_sha256: environment.MATCHBASE_PDF_ALLOWED_ATTESTATION_SHA256,
  });
  await assert.rejects(
    createEnvironmentConsultantPdfPipeline(
      { query: async () => ({ rows: [] }) },
      environment,
      async () => mismatched,
    ),
    /template attestation is not admitted/u,
  );
});
