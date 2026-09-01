import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(
  new URL("../../deployment/gcp/Deploy-CloudRun.ps1", import.meta.url),
  "utf8",
);

test("Cloud Run plan binds the closed PDF identity to web and worker", () => {
  for (const name of [
    "MATCHBASE_CONSULTANT_PDF_RUNTIME=enabled",
    "MATCHBASE_PDF_TEMPLATE_SHA256=$PdfTemplateSha256",
    "MATCHBASE_PDF_FONT_SHA256=$PdfFontSha256",
    "MATCHBASE_PDF_TOOLCHAIN_SHA256=$PdfToolchainSha256",
    "MATCHBASE_PDF_ALLOWED_ATTESTATION_SHA256=$PdfAllowedAttestationSha256",
  ])
    assert.equal(script.split(name).length - 1, 2, name);
  assert.equal(
    script.includes("MATCHBASE_PDF_TEMPLATE_ATTESTATION_JSON"),
    false,
  );
  assert.match(script, /MATCHBASE_ARTIFACT_GCS_BUCKET=\$ArtifactBucket/u);
});
