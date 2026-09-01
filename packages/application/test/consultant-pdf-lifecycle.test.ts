import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { renderConsultantResultPdfFixture } from "../src/consultant-pdf-lifecycle";
import { createGcsImmutablePdfWriter } from "../src/consultant-pdf-lifecycle";
import { createCloudRunMetadataAccessTokenProvider } from "../src/consultant-pdf-lifecycle";
import { preserveTerminalResultOnArtifactFailure } from "../src/consultant-pdf-lifecycle";
import { validateConsultantPdfQualification } from "../src/consultant-pdf-lifecycle";
import { DatabaseConsultantReportModelBuilder } from "../src/consultant-report-model-builder";
import { createEnvironmentConsultantPdfIdentity } from "../src/consultant-pdf-reporting-adapter";

describe("Consultant PDF renderer", () => {
  it("requires closed same-invocation qualification evidence before release", () => {
    const bytes = Uint8Array.from(Buffer.from("qualified-pdf"));
    const fileSha256 = createHash("sha256").update(bytes).digest("hex");
    const evidence = {
      schemaVersion: "consultant-pdf-qualification.v1" as const,
      templateSha256: "a".repeat(64),
      fontSha256: "b".repeat(64),
      toolchainSha256: "c".repeat(64),
      attestationSha256: "d".repeat(64),
      resultSha256: "e".repeat(64),
      reportModelSha256: "f".repeat(64),
      geometries: [
        {
          geometry: "a4" as const,
          sha256: fileSha256,
          byteSize: bytes.byteLength,
          pageCount: 2,
          pageSizePoints: [595.276, 841.89] as const,
          tagged: true,
          title: "Report",
          veraUa1Compliant: true,
          blankContentPages: [],
        },
        {
          geometry: "letter" as const,
          sha256: "9".repeat(64),
          byteSize: 12,
          pageCount: 2,
          pageSizePoints: [612, 792] as const,
          tagged: true,
          title: "Report",
          veraUa1Compliant: true,
          blankContentPages: [],
        },
      ] as const,
    };
    const expected = {
      fileSha256,
      resultSha256: "e".repeat(64),
      templateSha256: "a".repeat(64),
      pageCount: 2,
      byteSize: bytes.byteLength,
    };
    expect(validateConsultantPdfQualification(evidence, expected)).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(() =>
      validateConsultantPdfQualification(
        {
          ...evidence,
          geometries: [
            { ...evidence.geometries[0], blankContentPages: [2] },
            evidence.geometries[1],
          ],
        },
        expected,
      ),
    ).toThrow(/geometry/u);
    expect(() =>
      validateConsultantPdfQualification(
        { basis: "machine" } as never,
        expected,
      ),
    ).toThrow(/lineage/u);
  });
  it("constructs only an exact enabled web queue identity", () => {
    expect(createEnvironmentConsultantPdfIdentity({})).toBeNull();
    expect(
      createEnvironmentConsultantPdfIdentity({
        MATCHBASE_CONSULTANT_PDF_RUNTIME: "enabled",
        MATCHBASE_PDF_TEMPLATE_SHA256: "a".repeat(64),
        MATCHBASE_PDF_FONT_SHA256: "b".repeat(64),
        MATCHBASE_PDF_TOOLCHAIN_SHA256: "c".repeat(64),
        MATCHBASE_PDF_ALLOWED_ATTESTATION_SHA256: "d".repeat(64),
      }),
    ).toMatchObject({
      templateVersion: "a".repeat(64),
      pageGeometry: "a4",
    });
  });
  it("builds a composer-validated tenant-bound complete/no-match report model", async () => {
    for (const eligible of [4, 0]) {
      const result = {
        landscape: { eligible_count: eligible },
        evidence: [
          {
            evidence_id: "excluded-source-1",
            title: "Unused supplier page",
            verification_disposition: "excluded",
            exclusion_reason: "Not used by a decision-bearing claim.",
          },
        ],
      };
      const query = vi.fn(async () => ({
        rows: [
          {
            canonical_document: {
              requirement: "fixture",
              contradictions: eligible === 0 ? ["route conflict"] : [],
            },
            complete_result_document: result,
            result_sha256_hex: "a".repeat(64),
            assembled_at: new Date("2026-09-01T00:00:00Z"),
            outcome: eligible === 0 ? "no_responsible_match" : "candidates",
            eligible_count: eligible,
            limitations_text: "Fixture limitation.",
            candidate_count: eligible,
            evidence_count: 1,
            score_count: eligible,
            candidate_rows: [],
            evidence_rows: [{ title: "retained source" }],
            score_rows: [],
            claim_rows: [],
            excluded_candidate_rows: [
              {
                candidate_id: "reserve-1",
                name: "Reserve supplier",
                reason: "stock_not_confirmed",
                rank: 3,
              },
            ],
            unknown_field_rows: [
              {
                field_key: "target_incoterm",
                value_state: "explicitly_unknown",
                macro_parameter: "trade_structure_commercial_execution",
              },
            ],
          },
        ],
      }));
      const builder = new DatabaseConsultantReportModelBuilder({
        query,
      } as never);
      const built = await builder.build({
        accountId: "00000000-0000-4000-8000-000000000001",
        generatedByUserId: "00000000-0000-4000-8000-000000000002",
        runId: "00000000-0000-4000-8000-000000000003",
        result,
        resultSha256: "a".repeat(64),
        canonicalRequestVersionId: "00000000-0000-4000-8000-000000000004",
        projectionVersionId: "00000000-0000-4000-8000-000000000005",
        scoringConfigVersionId: "00000000-0000-4000-8000-000000000006",
        modelPolicyVersionId: "00000000-0000-4000-8000-000000000007",
        analystDecisionSetId: "server-owned-live-research",
        templateVersion: "test-template.v1",
        pageGeometry: "a4",
      });
      expect(built.reportModel.schema_version).toBe(
        "consultant-report-model.v1",
      );
      expect(built.report.sections.length).toBeGreaterThan(20);
      expect(
        built.reportModel.sections.some(
          (section) => section.section_id === "SEC-09.3",
        ),
      ).toBe(eligible < 3);
      expect(
        built.reportModel.sections.some(
          (section) => section.section_id === "SEC-05.2",
        ),
      ).toBe(eligible === 0);
      for (const sectionId of ["SEC-05.3", "SEC-12", "SEC-20"])
        expect(
          built.reportModel.sections.find(
            (section) => section.section_id === sectionId,
          )?.blocks.length,
        ).toBeGreaterThan(0);
      expect(
        built.reportModel.sections.find(
          (section) => section.section_id === "SEC-20",
        )?.explicit_empty_reason,
      ).toBeUndefined();
      expect(query.mock.calls[0]?.[1]?.[0]).toBe(
        "00000000-0000-4000-8000-000000000001",
      );
    }
  });
  it("preserves terminal readability when artifact processing fails", async () => {
    const terminal = Object.freeze({ disposition: "complete", runId: "run" });
    await expect(
      preserveTerminalResultOnArtifactFailure(terminal, async () => {
        throw new Error("blocking QA failed");
      }),
    ).resolves.toBe(terminal);
  });
  it("renders deterministic run-bound PDF bytes", () => {
    const input = {
      runId: "00000000-0000-4000-8000-000000000137",
      result: {
        schema_version: "consultant-result-projection.v2",
        landscape: { eligible_count: 2, displayed_count: 2 },
      },
    } as const;
    const first = renderConsultantResultPdfFixture(input);
    const second = renderConsultantResultPdfFixture(input);
    expect(Buffer.from(first).subarray(0, 8).toString("ascii")).toBe(
      "%PDF-1.7",
    );
    expect(Buffer.from(first)).toEqual(Buffer.from(second));
    expect(createHash("sha256").update(first).digest("hex")).toBe(
      createHash("sha256").update(second).digest("hex"),
    );
    expect(Buffer.from(first).toString("ascii")).toContain(input.runId);
  });

  it("renders no-responsible-match without inventing candidates", () => {
    const bytes = renderConsultantResultPdfFixture({
      runId: "00000000-0000-4000-8000-000000000138",
      result: { landscape: { eligible_count: 0, displayed_count: 0 } },
    });
    const text = Buffer.from(bytes).toString("ascii");
    expect(text).toContain("No responsible match");
    expect(text).toContain("Eligible candidates: 0");
  });
});

describe("immutable GCS writer", () => {
  it("obtains and caches a bounded metadata-server bearer token", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "metadata-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200 },
        ),
    );
    const provider = createCloudRunMetadataAccessTokenProvider(
      request as typeof fetch,
      () => 1000,
    );
    await expect(provider()).resolves.toBe("metadata-token");
    await expect(provider()).resolves.toBe("metadata-token");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]?.headers).toEqual({
      "Metadata-Flavor": "Google",
    });
  });

  it("uses metadata auth input and generation-match zero", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            bucket: "matchbase-artifacts",
            name: "consultant/a/b/c.pdf",
            generation: "7",
          }),
          { status: 200 },
        ),
    );
    const writer = createGcsImmutablePdfWriter({
      bucket: "matchbase-artifacts",
      accessToken: async () => "token",
      fetchImplementation: request as typeof fetch,
    });
    await expect(
      writer.putImmutable("consultant/a/b/c.pdf", new Uint8Array([1])),
    ).resolves.toBe("gs://matchbase-artifacts/consultant/a/b/c.pdf");
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toContain("ifGenerationMatch=0");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer token",
      "Content-Type": "application/pdf",
    });
  });

  it("fails closed when an existing object's bytes do not match", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([2]), { status: 200 }),
      );
    const writer = createGcsImmutablePdfWriter({
      bucket: "matchbase-artifacts",
      accessToken: async () => "token",
      fetchImplementation: request as typeof fetch,
    });
    await expect(
      writer.putImmutable("consultant/a/b/c.pdf", new Uint8Array([1])),
    ).rejects.toThrow(/collision/u);
  });

  it("reconciles a prior exact create-only write after a worker crash", async () => {
    const bytes = new Uint8Array([1]);
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(new Response(bytes, { status: 200 }));
    const writer = createGcsImmutablePdfWriter({
      bucket: "matchbase-artifacts",
      accessToken: async () => "token",
      fetchImplementation: request as typeof fetch,
    });
    await expect(
      writer.putImmutable("consultant/a/b/c.pdf", bytes),
    ).resolves.toBe("gs://matchbase-artifacts/consultant/a/b/c.pdf");
  });
});
