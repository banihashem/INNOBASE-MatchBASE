import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  GOVERNED_PDF_TOOLCHAIN_SHA256,
  validateTemplateQualificationAttestation,
  type PdfRuntimeConfig,
} from "../src/runtime-adapter.js";

const config: PdfRuntimeConfig = {
  weasyprint_path: "/opt/matchbase/pdf-venv/bin/weasyprint",
  verapdf_path: "/opt/verapdf/verapdf",
  pdfinfo_path: "/usr/bin/pdfinfo",
  pdftotext_path: "/usr/bin/pdftotext",
  template_sha256: "a".repeat(64),
  font_sha256: "b".repeat(64),
  toolchain_sha256: GOVERNED_PDF_TOOLCHAIN_SHA256,
  allowed_attestation_sha256: null,
  timeout_ms: 5000,
  max_output_bytes: 100000,
  max_page_count: 40,
};
test("runtime configuration rejects URL tools, traversal and unsafe bounds", () => {
  assert.throws(() =>
    validateTemplateQualificationAttestation(undefined, {
      ...config,
      weasyprint_path: "https://evil.test/tool",
    }),
  );
  assert.throws(() =>
    validateTemplateQualificationAttestation(undefined, {
      ...config,
      timeout_ms: 999,
    }),
  );
});
test("template attestation fails closed on missing, malformed or mismatched evidence", () => {
  assert.equal(
    validateTemplateQualificationAttestation(undefined, config),
    false,
  );
  assert.equal(
    validateTemplateQualificationAttestation(
      {
        schema_version: "matchbase-template-qualification.v1",
        template_sha256: config.template_sha256,
        font_sha256: config.font_sha256,
        toolchain_sha256: config.toolchain_sha256,
        qualified_checks: ["contrast_ratio"],
        evidence_sha256: "d".repeat(64),
        attestation_sha256: "0".repeat(64),
      },
      config,
    ),
    false,
  );
});

test("tracked governed attestation is bound to the current template, font, toolchain and authentic qualification evidence", async () => {
  const toolchainRoot = new URL("../../pdf-toolchain/", import.meta.url);
  const [reportCss, a4Css, letterCss, evidenceBytes, attestationBytes] =
    await Promise.all([
      readFile(new URL("report.css", toolchainRoot), "utf8"),
      readFile(new URL("a4.css", toolchainRoot), "utf8"),
      readFile(new URL("letter.css", toolchainRoot), "utf8"),
      readFile(new URL("template-qualification-evidence.json", toolchainRoot)),
      readFile(new URL("template-attestation.json", toolchainRoot), "utf8"),
    ]);
  const attestation = JSON.parse(
    attestationBytes,
  ) as import("../src/runtime-adapter.js").TemplateQualificationAttestationV1;
  const evidence = JSON.parse(evidenceBytes.toString("utf8")) as {
    template_sha256: string;
    font_sha256: string;
    toolchain_sha256: string;
    machine_checks: {
      contrast_ratio: {
        outcome: string;
        minimum_ratio: number;
        required_ratio: number;
      };
    };
    determinism_evidence: {
      model_sha256: string;
      render_count: number;
      isolated_runtime_invocations: boolean;
      output_sha256: string;
      byte_size: number;
      byte_equal: boolean;
    };
    render_evidence: readonly {
      fixture: string;
      geometry: string;
      sha256: string;
      byte_size: number;
    }[];
  };
  const digest = (value: Uint8Array | string) =>
    createHash("sha256").update(value).digest("hex");
  const templateSha = digest(reportCss + a4Css + letterCss);
  assert.equal(evidence.template_sha256, templateSha);
  assert.equal(attestation.template_sha256, templateSha);
  assert.equal(attestation.evidence_sha256, digest(evidenceBytes));
  assert.equal(evidence.font_sha256, attestation.font_sha256);
  assert.equal(evidence.toolchain_sha256, GOVERNED_PDF_TOOLCHAIN_SHA256);
  assert.equal(evidence.machine_checks.contrast_ratio.outcome, "pass");
  assert.ok(
    evidence.machine_checks.contrast_ratio.minimum_ratio >=
      evidence.machine_checks.contrast_ratio.required_ratio,
  );
  assert.equal(evidence.render_evidence.length, 10);
  assert.equal(
    evidence.determinism_evidence.model_sha256,
    digest(await readFile(new URL("smoke.html", toolchainRoot))),
  );
  assert.equal(evidence.determinism_evidence.render_count, 2);
  assert.equal(
    evidence.determinism_evidence.isolated_runtime_invocations,
    true,
  );
  assert.equal(evidence.determinism_evidence.byte_equal, true);
  assert.match(evidence.determinism_evidence.output_sha256, /^[0-9a-f]{64}$/u);
  assert.ok(evidence.determinism_evidence.byte_size > 0);
  assert.deepEqual(
    [...new Set(evidence.render_evidence.map((item) => item.fixture))].sort(),
    [
      "contradiction",
      "malicious-long-content",
      "ranked",
      "scarcity",
      "zero-match",
    ],
  );
  for (const item of evidence.render_evidence) {
    assert.match(item.sha256, /^[0-9a-f]{64}$/u);
    assert.ok(item.byte_size > 0);
  }
  const governedConfig: PdfRuntimeConfig = {
    ...config,
    template_sha256: templateSha,
    font_sha256: attestation.font_sha256,
    allowed_attestation_sha256: attestation.attestation_sha256,
  };
  assert.equal(
    validateTemplateQualificationAttestation(attestation, governedConfig),
    true,
  );
});

test("worker image copies both the governed attestation and its evidence into the fixed runtime asset directory", async () => {
  const dockerfile = await readFile(
    new URL("../../../../Dockerfile", import.meta.url),
    "utf8",
  );
  assert.match(
    dockerfile,
    /packages\/reporting\/pdf-toolchain\/template-attestation\.json packages\/reporting\/pdf-toolchain\/template-qualification-evidence\.json \/opt\/matchbase\/report-assets\//u,
  );
});
