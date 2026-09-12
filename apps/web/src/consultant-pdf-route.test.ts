import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class Unavailable extends Error {
    readonly status = 503;
    readonly code = "MB-503-PDF-RENDERER-UNAVAILABLE";
  }
  return {
    Unavailable,
    resolve: vi.fn(),
    authorize: vi.fn(),
    render: vi.fn(),
    save: vi.fn(),
    round: vi.fn(),
    pool: Object.freeze({ synthetic: true }),
  };
});
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}));
vi.mock("@matchbase/application", () => ({
  ApplicationFault: class extends Error {},
  authorizeConsultantRunResourceRead: mocks.authorize,
}));
vi.mock("@matchbase/contracts", () => ({
  parseConsultantResearchOutputV3: (value: unknown) => value,
}));
vi.mock("@matchbase/data", () => ({
  getResearchRoundForExecution: mocks.round,
  savePdfReportLedger: mocks.save,
}));
vi.mock("@matchbase/reporting", () => ({
  generateConsultantPdfArtifact: mocks.render,
  ConsultantPdfRendererUnavailableError: mocks.Unavailable,
  ConsultantReportLanguageError: class extends Error {},
}));
vi.mock("./db-client", () => ({ getAppDatabasePool: () => mocks.pool }));
vi.mock("./fetch-runtime", () => ({ resolveRequestSession: mocks.resolve }));

import { GET, HEAD } from "../app/api/v1/consultant/reports/[runId]/pdf/route";

const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const context = { params: Promise.resolve({ runId }) };
const output = {
  research_run_id: runId,
  execution_id: "synthetic-execution",
  supplier_candidates: Array.from({ length: 11 }, () => ({})),
};
const bytes = Buffer.from("%PDF-1.4\nSynthetic exact response bytes");
const request = (method: string, headers?: HeadersInit) =>
  new Request(`http://localhost/api/v1/consultant/reports/${runId}/pdf`, {
    method,
    ...(headers ? { headers } : {}),
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden in PDF route tests");
    }),
  );
  mocks.resolve.mockResolvedValue({ accountId: "synthetic-account" });
  mocks.authorize.mockResolvedValue({ runId, output });
  mocks.render.mockResolvedValue({ bytes, pageCount: 98 });
  mocks.save.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("MB-UX-QUALITY-001 L06 actual PDF page-count persistence", () => {
  it("records the 98 rendered pages for 11 suppliers and returns identical bytes", async () => {
    const response = await GET(request("GET"), context);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(mocks.render).toHaveBeenCalledWith(output);
    expect(mocks.save).toHaveBeenCalledWith(
      mocks.pool,
      expect.objectContaining({
        run_id: runId,
        pdf_bytes: bytes,
        page_count: 98,
      }),
    );
  });

  it("keeps full-document metadata for HEAD and partial-range delivery", async () => {
    const head = await HEAD(request("HEAD"), context);
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(bytes.length));
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    const range = await GET(request("GET", { Range: "bytes=0-4" }), context);
    expect(range.status).toBe(206);
    expect(Buffer.from(await range.arrayBuffer())).toEqual(
      bytes.subarray(0, 5),
    );
    expect(mocks.save).toHaveBeenCalledTimes(2);
    for (const call of mocks.save.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({ pdf_bytes: bytes, page_count: 98 }),
      );
    }
  });

  it("does not persist guessed metadata when PDF page-tree parsing fails", async () => {
    mocks.render.mockRejectedValue(
      new mocks.Unavailable("Page metadata unavailable"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const response = await GET(request("GET"), context);
      expect(response.status).toBe(503);
      expect(mocks.save).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
