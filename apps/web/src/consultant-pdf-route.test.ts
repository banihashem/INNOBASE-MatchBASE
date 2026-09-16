import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class Unavailable extends Error {
    readonly status = 503;
    readonly code = "MB-503-PDF-RENDERER-UNAVAILABLE";
  }
  return {
    ApplicationFault: class extends Error {
      constructor(
        readonly status: number,
        readonly kind: string,
        readonly code: string,
        message: string,
      ) {
        super(message);
      }
    },
    Unavailable,
    resolve: vi.fn(),
    authorize: vi.fn(),
    render: vi.fn(),
    save: vi.fn(),
    round: vi.fn(),
    rights: vi.fn(),
    EvidenceFault: class extends Error {
      readonly status = 409;
      readonly code = "MB-409-EVIDENCE-WITHDRAWN";
    },
    pool: Object.freeze({ synthetic: true }),
  };
});
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}));
vi.mock("@matchbase/application", () => ({
  ApplicationFault: mocks.ApplicationFault,
  authorizeConsultantRunResourceRead: mocks.authorize,
  assertConsultantOutputReadRights: mocks.rights,
}));
vi.mock("@matchbase/contracts", () => ({
  parseConsultantResearchOutputV3: (value: unknown) => value,
}));
vi.mock("@matchbase/data", () => ({
  getResearchRoundForExecution: mocks.round,
  savePdfReportLedger: mocks.save,
  ExecutionIntegrityFault: mocks.EvidenceFault,
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
  mocks.resolve.mockResolvedValue({
    accountId: "synthetic-account",
    userId: "synthetic-profile",
  });
  mocks.authorize.mockResolvedValue({ runId, output });
  mocks.render.mockResolvedValue({ bytes, pageCount: 98 });
  mocks.save.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("MB-UX-QUALITY-001 L06 actual PDF page-count persistence", () => {
  const oldExecution = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const olderOutput = {
    ...output,
    execution_id: oldExecution,
    user_profile_id: "synthetic-profile",
    classification_id: "synthetic-classification",
  };
  const olderRound = {
    run_id: runId,
    account_id: "synthetic-account",
    user_profile_id: "synthetic-profile",
    execution_id: oldExecution,
    classification_id: "synthetic-classification",
    output: olderOutput,
  };
  const historicalRequest = () =>
    new Request(
      `http://localhost/api/v1/consultant/reports/${runId}/pdf?execution_id=${oldExecution}`,
    );
  it("MB-ARCH-IMPLEMENT-001 L02 F03 another profile cannot select a historical execution", async () => {
    mocks.authorize.mockRejectedValue(
      new mocks.ApplicationFault(
        404,
        "run-not-found",
        "MB-404-RUN",
        "The requested run was not found.",
      ),
    );
    const response = await GET(historicalRequest(), context);
    expect(response.status).toBe(404);
    expect(mocks.round).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("MB-ARCH-IMPLEMENT-001 L02 F03 allows the selected older PDF when only the latest output is withdrawn", async () => {
    mocks.authorize.mockImplementation(async ({ resourceKind }) => {
      if (resourceKind === "report_pdf")
        throw new mocks.EvidenceFault("Latest source withdrawn.");
      return {
        runId,
        output: null,
        owner_account_id: "synthetic-account",
        owner_user_profile_id: "synthetic-profile",
      };
    });
    mocks.round.mockResolvedValue(olderRound);
    mocks.rights.mockImplementation(async (_pool, _account, chosen) => {
      if (chosen.execution_id !== oldExecution)
        throw new mocks.EvidenceFault("Latest source withdrawn.");
    });
    const response = await GET(historicalRequest(), context);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ resourceKind: "research_history" }),
    );
    expect(mocks.render).toHaveBeenCalledExactlyOnceWith(olderOutput);
    expect(mocks.rights).toHaveBeenCalledTimes(3);
  });
  it("MB-ARCH-IMPLEMENT-001 L02 F03 blocks the selected withdrawn older PDF even if the latest report is allowed", async () => {
    mocks.round.mockResolvedValue(olderRound);
    mocks.rights.mockImplementation(async (_pool, _account, chosen) => {
      if (chosen.execution_id === oldExecution)
        throw new mocks.EvidenceFault("Older source withdrawn.");
    });
    const response = await GET(historicalRequest(), context);
    expect(response.status).toBe(409);
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([
    { run_id: "foreign-run" },
    { account_id: "foreign-account" },
    { user_profile_id: "foreign-profile" },
    { execution_id: "foreign-execution" },
    { output: { ...olderOutput, user_profile_id: "foreign-profile" } },
    { output: { ...olderOutput, execution_id: output.execution_id } },
  ])(
    "MB-ARCH-IMPLEMENT-001 L02 F03 rejects historical report scope mismatch %j",
    async (override) => {
      mocks.round.mockResolvedValue({ ...olderRound, ...override });
      const response = await GET(historicalRequest(), context);
      expect(response.status).toBe(404);
      expect(mocks.render).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
    },
  );
  it("MB-ARCH-IMPLEMENT-001 L02 denies a withdrawn old-round PDF before rendering", async () => {
    mocks.rights.mockRejectedValue(new mocks.EvidenceFault("Source withdrawn"));
    const response = await GET(request("GET"), context);
    expect(response.status).toBe(409);
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("MB-ARCH-IMPLEMENT-001 L02 withdrawal during rendering cannot enter the ledger or response", async () => {
    mocks.rights
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(
        new mocks.EvidenceFault("Source withdrawn during render"),
      );
    const response = await GET(request("GET"), context);
    expect(response.status).toBe(409);
    expect(mocks.render).toHaveBeenCalledOnce();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(response.headers.get("Content-Type")).not.toBe("application/pdf");
  });
  it("MB-ARCH-IMPLEMENT-001 L02 a last rights check prevents bytes after ledger persistence", async () => {
    mocks.rights
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(
        new mocks.EvidenceFault("Source withdrawn before serving"),
      );
    const response = await GET(request("GET"), context);
    expect(response.status).toBe(409);
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(await response.text()).not.toContain("%PDF");
  });
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
