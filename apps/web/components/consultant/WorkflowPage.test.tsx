import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConsultantWorkflowPage from "../../app/consultant/workflow/page";
import { GOLDEN_SCENARIO_V3_01 } from "@matchbase/contracts";
import { SupplierDossierModal } from "./SupplierDossierModal";
import { InterpretationApprovalStep } from "./InterpretationApprovalStep";

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type RequestBody = Record<string, any>;
let requests: RequestBody[];
let save: (body: RequestBody) => Promise<Response>;
let version: number;
let created: number;
const roundOverview = {
  costs: {
    currency: "USD",
    recorded_total_usd: 0.2,
    openrouter_charge_usd: 0,
    byok_upstream_usd: 0.2,
    preparation_usd: 0.2,
    research_usd: 0,
    unpriced_calls: 0,
    calls: 5,
    complete: true,
    by_execution: {},
    disclosure: "Recorded usage",
  },
  rounds: [],
  next_round: 1,
};
const roundQuote = {
  quote_id: "quote-1",
  choices: [],
  plan: {
    round_number: 1,
    title: "Initial research",
    purpose: "Find suppliers",
    estimated_low_usd: 0.1,
    estimated_high_usd: 1,
    expires_at: "2099-01-01T00:00:00Z",
    research_models: ["google/gemini", "openai/gpt"],
    synthesis_model: "reasoner",
    extraction_model: "extractor",
    search_engine: "native",
    focus_requirements: [],
    max_calls: 9,
    max_output_tokens_per_call: 12000,
    assumptions: ["No automatic next round"],
  },
};

beforeEach(() => {
  requests = [];
  version = 1;
  created = 0;
  sessionStorage.clear();
  window.history.replaceState({}, "", "/consultant/workflow?mode=new");
  save = async () => response({ success: true, draft_version: ++version });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (
        String(url).startsWith("/api/v1/consultant/research-rounds") &&
        !options?.body
      )
        return response(roundOverview);
      if (String(url) === "/api/v1/me")
        return response({
          tier: "consultant",
          user_id: "user",
          account_id: "account",
        });
      const body = options?.body ? JSON.parse(String(options.body)) : {};
      requests.push(body);
      if (body.action === "create_draft")
        return response({
          success: true,
          draft_id: `draft-${++created}`,
          draft_version: 1,
        });
      if (body.action === "save_draft") return save(body);
      throw new Error(`Unexpected request ${url} ${JSON.stringify(body)}`);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openDraft() {
  render(<ConsultantWorkflowPage />);
  await waitFor(() => expect(window.location.search).toBe("?draft_id=draft-1"));
  await screen.findByLabelText("Product Requirement");
  vi.useFakeTimers();
}

function edit(suffix = "A") {
  fireEvent.change(screen.getByLabelText("Product Requirement"), {
    target: { value: `Product ${suffix}` },
  });
  fireEvent.change(
    screen.getByLabelText("Technical, Quality & Trade Requirements"),
    { target: { value: `Technical ${suffix}` } },
  );
  fireEvent.change(screen.getByLabelText("Order & Supplier Profile"), {
    target: { value: `Order ${suffix}` },
  });
}

async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("MB-UX-LIVE-001 L03 stage gates", () => {
  it("L09 exposes Stop only in Section 3 and preserves stopped state against a late poll", async () => {
    window.history.replaceState({}, "", "/consultant/workflow?run_id=run-stop");
    const stalePoll = deferred();
    let reads = 0;
    const active = {
      run_id: "run-stop",
      execution_id: "execution-stop",
      state: "verification_loop_running",
      mode: "live",
      intake: {},
      retry_action: "research",
      step1_interpretation: { english_translation: "Approved pumps" },
      step3_deep_prompt: {
        is_approved: true,
        prompt_text: "Approved pump research",
      },
      progress: { phase: "verification", loop: 4, max_loops: 15 },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (
          String(url).startsWith("/api/v1/consultant/research-rounds") &&
          !options?.body
        )
          return response(roundOverview);
        if (url === "/api/v1/me")
          return response({
            tier: "consultant",
            user_id: "user",
            account_id: "account",
          });
        if (!options?.method) {
          if (++reads > 1) return stalePoll.promise;
          return response({ session: active });
        }
        const body = JSON.parse(String(options.body));
        requests.push(body);
        if (body.action === "stop_research")
          return response({
            success: true,
            session: {
              ...active,
              state: "workflow_failed",
              error: "Research stopped by your request.",
              progress: { phase: "user_cancelled", loop: 4, max_loops: 15 },
            },
          });
        throw new Error("Unexpected mutation");
      }),
    );
    render(<ConsultantWorkflowPage />);
    await screen.findByRole("button", { name: "Stop research" });
    fireEvent.click(
      screen.getByRole("tab", { name: "Section 2: Preparation" }),
    );
    expect(
      screen.queryByRole("button", { name: "Stop research" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("tab", { name: "Section 3: Research & Results" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop research" }));
    await screen.findByRole("button", {
      name: "Review a new research estimate",
    });
    await act(async () => {
      stalePoll.resolve(response({ session: active }));
    });
    expect(
      screen.queryByRole("button", { name: "Stop research" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Stopped by you" }),
    ).toBeInTheDocument();
    expect(requests).toEqual([
      {
        action: "stop_research",
        run_id: "run-stop",
        execution_id: "execution-stop",
      },
    ]);
  });

  it("restores the accepted intake and real running state after a competing submission wins", async () => {
    const defaultFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (
          String(url).startsWith("/api/v1/consultant/research-rounds") &&
          !options?.body
        )
          return response(roundOverview);
        const body = options?.body ? JSON.parse(String(options.body)) : {};
        if (body.action === "submit_intake") {
          requests.push(body);
          return response(
            {
              success: false,
              code: "MB-409-DRAFT-CONFLICT",
              error: {
                code: "MB-409-DRAFT-CONFLICT",
                message: "Another tab already submitted this draft.",
              },
              run_id: "accepted-run",
              draft_id: "draft-1",
              draft_version: 4,
            },
            409,
          );
        }
        if (String(url).includes("run_id=accepted-run"))
          return response({
            session: {
              run_id: "accepted-run",
              draft_id: "draft-1",
              draft_version: 4,
              state: "verification_loop_running",
              mode: "live",
              retry_action: "research",
              intake: {
                product_requirement: "Accepted pump",
                technical_compliance: "Accepted CE requirement",
                order_profile: "Accepted 10 units",
              },
              step1_interpretation: {
                english_translation: "Accepted pump, CE required, 10 units",
                fidelity_validation: { valid: true },
              },
              step3_deep_prompt: {
                prompt_text: "Approved pump research",
                is_approved: true,
              },
              progress: {
                phase: "verification",
                loop: 2,
                max_loops: 15,
                message: "Existing research is still running",
              },
            },
          });
        return defaultFetch(url, options);
      }),
    );
    await openDraft();
    edit("Rejected local edit");
    fireEvent.click(
      screen.getByRole("button", { name: /Submit Intake & Proceed/ }),
    );
    await tick();
    expect(window.location.search).toBe(
      "?draft_id=draft-1&run_id=accepted-run",
    );
    expect(
      screen.getByRole("tab", { name: "Section 3: Research & Results" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByText("Existing research is still running"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Retry/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Section 1: Request/ }));
    expect(screen.getByLabelText("Product Requirement")).toHaveValue(
      "Accepted pump",
    );
    expect(
      screen.getByLabelText("Technical, Quality & Trade Requirements"),
    ).toHaveValue("Accepted CE requirement");
    expect(screen.getByLabelText("Order & Supplier Profile")).toHaveValue(
      "Accepted 10 units",
    );
    expect(screen.getByLabelText("Product Requirement")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "+ New Consultant Research" }),
    ).toBeDisabled();
    expect(
      requests.some((item) =>
        [
          "approve_step1",
          "approve_step3",
          "retry_interpretation",
          "execute_research",
        ].includes(item.action),
      ),
    ).toBe(false);
  });

  it("opens research only after explicit prompt approval and keeps submitted input locked", async () => {
    window.history.replaceState(
      {},
      "",
      "/consultant/workflow?run_id=run-stages",
    );
    const approval = deferred();
    let session: any = {
      run_id: "run-stages",
      state: "prep_step3_prompt_awaiting_approval",
      mode: "live",
      intake: {
        product_requirement: "Industrial pump",
        technical_compliance: "CE required",
        order_profile: "10 units to Dubai",
      },
      step1_interpretation: {
        english_translation: "Industrial pump, CE required, 10 units to Dubai",
        fidelity_validation: { valid: true },
      },
      step3_deep_prompt: {
        prompt_text: "Find qualified industrial pump suppliers",
        is_approved: false,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (
          String(url).startsWith("/api/v1/consultant/research-rounds") &&
          !options?.body
        )
          return response(roundOverview);
        if (url === "/api/v1/me")
          return response({
            tier: "consultant",
            user_id: "user",
            account_id: "account",
          });
        if (!options?.method) return response({ session });
        const body = JSON.parse(String(options.body));
        requests.push(body);
        if (body.action === "approve_step3") return approval.promise;
        if (body.action === "quote") return response(roundQuote);
        expect(body.action).toBe("approve");
        session = {
          ...session,
          state: "verification_loop_running",
          retry_action: "research",
          progress: {
            phase: "verification",
            loop: 1,
            max_loops: 15,
            message: "First verification loop underway",
          },
        };
        return response({ success: true, processing: true, session }, 202);
      }),
    );
    render(<ConsultantWorkflowPage />);
    const prompt = await screen.findByLabelText(
      "Editable Synthesized Research Prompt",
    );
    const researchTab = screen.getByRole("tab", {
      name: "Section 3: Research & Results",
    });
    expect(researchTab).toBeDisabled();
    fireEvent.change(prompt, {
      target: {
        value: "Use this reviewed prompt; preserve CE and 10 units to Dubai.",
      },
    });
    expect(requests).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: /Approve Prompt & Review Cost/ }),
    );
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.edited_prompt).toBe(
      "Use this reviewed prompt; preserve CE and 10 units to Dubai.",
    );
    expect(researchTab).toBeDisabled();
    session = {
      ...session,
      state: "prep_step3_prompt_approved",
      step3_deep_prompt: {
        prompt_text: requests[0]?.edited_prompt,
        is_approved: true,
      },
    };
    await act(async () => {
      approval.resolve(response({ success: true, session }));
    });
    const estimate = await screen.findByRole("button", {
      name: /Get cost estimate/,
    });
    expect(requests.map((r) => r.action)).toEqual(["approve_step3"]);
    fireEvent.click(estimate);
    const approveCost = await screen.findByRole("button", {
      name: /Approve cost estimate & start round 1/,
    });
    expect(requests.map((r) => r.action)).toEqual(["approve_step3", "quote"]);
    fireEvent.click(approveCost);
    await screen.findByText("First verification loop underway");
    expect(researchTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "+ New Consultant Research" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("tab", { name: "Section 2: Preparation" }),
    );
    expect(prompt).toBeDisabled();
    expect(
      screen.getByLabelText("Editable English Interpretation"),
    ).toBeDisabled();
    expect(
      requests.filter((item) => item.action === "execute_research"),
    ).toHaveLength(0);
    expect(requests.filter((item) => item.action === "approve")).toHaveLength(
      1,
    );
  });

  it("retains a failed submitted run and retries interpretation only on explicit request", async () => {
    const defaultFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (
          String(url).startsWith("/api/v1/consultant/research-rounds") &&
          !options?.body
        )
          return response(roundOverview);
        const body = options?.body ? JSON.parse(String(options.body)) : {};
        if (body.action === "submit_intake") {
          requests.push(body);
          expect(body.draft_version).toBe(2);
          return response(
            {
              success: false,
              error: {
                code: "MB-502-LIVE-PROVIDER",
                message: "Interpretation provider stopped",
              },
              run_id: "failed-intake",
              execution_id: "attempt-1",
              draft_id: "draft-1",
              draft_version: 3,
              retry_action: "interpretation",
            },
            502,
          );
        }
        if (body.action === "retry_interpretation") {
          requests.push(body);
          expect(body.run_id).toBe("failed-intake");
          return response({
            success: true,
            session: {
              run_id: "failed-intake",
              draft_id: "draft-1",
              draft_version: 3,
              state: "prep_step1_awaiting_approval",
              retry_action: null,
              step1_interpretation: {
                english_translation: "Product A. Technical A. Order A.",
                fidelity_validation: { valid: true },
              },
            },
          });
        }
        if (body.action === "validate_step1_fidelity")
          return response({ success: true, fidelity: { valid: true } });
        return defaultFetch(url, options);
      }),
    );
    await openDraft();
    edit();
    fireEvent.click(
      screen.getByRole("button", { name: /Submit Intake & Proceed/ }),
    );
    await tick();
    expect(window.location.search).toBe(
      "?draft_id=draft-1&run_id=failed-intake",
    );
    expect(
      screen.getByRole("tab", { name: "Section 2: Preparation" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("button", { name: "+ New Consultant Research" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Product Requirement")).toBeDisabled();
    expect(
      screen.queryByLabelText("Editable English Interpretation"),
    ).not.toBeInTheDocument();
    expect(
      requests.filter((item) => item.action === "retry_interpretation"),
    ).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry Interpretation" }),
    );
    await tick();
    await tick(450);
    expect(
      screen.getByLabelText("Editable English Interpretation"),
    ).toHaveValue("Product A. Technical A. Order A.");
    expect(
      screen.getByRole("button", { name: "Approve Interpretation & Proceed" }),
    ).toBeEnabled();
    expect(
      requests.filter((item) => item.action === "retry_interpretation"),
    ).toHaveLength(1);
    expect(
      requests.some(
        (item) =>
          item.action === "approve_step1" || item.action === "execute_research",
      ),
    ).toBe(false);
  });

  it("shows authoritative omission for a legacy preserved ledger row without claiming complete detection", () => {
    const requirement = {
      requirement_id: "supplier-profile",
      normalized_label: "Supplier representation",
      concept: "supplier_profile",
      source_text: "Have a representative in Iran",
      normalized_value: "Representative in Iran",
      fidelity_status: "preserved",
    };
    render(
      <InterpretationApprovalStep
        workflowState="prep_step1_awaiting_approval"
        isLoading={false}
        step1Translation="Freight service"
        step1Fidelity={{
          valid: false,
          omitted_count: 1,
          mutated_count: 0,
          preserved_count: 0,
          omitted_items: [requirement],
          mutated_items: [],
          ledger: { total_explicit_count: 1, requirements: [requirement] },
        }}
        isFidelityValidating={false}
        showFullLedger
        setShowFullLedger={() => {}}
        onTranslationChange={() => {}}
        onRetryValidation={() => {}}
        handleApproveStep1={async () => {}}
      />,
    );
    const row = screen.getByRole("row", { name: /Supplier representation/ });
    expect(within(row).getByText("omitted")).toBeInTheDocument();
    expect(within(row).queryByText("preserved")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Approval Gated (Fidelity Issues)" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/a passed check does not establish/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/all explicit requirements preserved/i),
    ).not.toBeInTheDocument();
  });
});

describe("MB-UX-LIVE-001 L01 draft transitions", () => {
  it("preserves constraint-only evidence and the source currency, price type and validity in the dossier", () => {
    const base = GOLDEN_SCENARIO_V3_01.supplier_candidates[0]!;
    const source = {
      ...GOLDEN_SCENARIO_V3_01.evidence_sources[0]!,
      evidence_id: "ev-constraint-only",
      source_title: "Constraint certificate",
      source_url: "https://supplier.example/certificate",
    };
    render(
      <SupplierDossierModal
        isOpen
        onClose={() => {}}
        evidenceSources={[source]}
        supplier={{
          ...base,
          commercial: {
            ...base.commercial,
            price_min: 12,
            price_max: 16,
            currency: "EUR",
            unit: "unit",
            price_type: "Supplier indicative quotation",
            price_validity: "2026-10-01",
          },
          assessment: {
            ...base.assessment,
            mandatory_constraint_results: [
              {
                constraint: "Food contact certification",
                satisfied: true,
                evidence_ids: [source.evidence_id],
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("EUR 12 - 16 / unit")).toBeInTheDocument();
    expect(
      screen.getByText("Supplier indicative quotation"),
    ).toBeInTheDocument();
    expect(screen.getByText("2026-10-01")).toBeInTheDocument();
    const table = screen.getByRole("table", {
      name: "Mandatory constraint assessment",
    });
    expect(
      within(table).getByText("Food contact certification"),
    ).toBeInTheDocument();
    expect(within(table).getByText("Supported")).toBeInTheDocument();
    expect(
      within(table).getByRole("link", { name: source.source_title }),
    ).toHaveAttribute("href", source.source_url);
    expect(
      screen.getAllByRole("link", { name: source.source_title }),
    ).toHaveLength(2);
  });
  it("polls a real 202 preparation payload even while retry_action names the running stage", async () => {
    window.history.replaceState(
      {},
      "",
      "/consultant/workflow?run_id=run-queued",
    );
    let queued = false;
    let progressReads = 0;
    const base = {
      run_id: "run-queued",
      mode: "live",
      intake: {},
      step1_interpretation: {
        english_translation: "Approved industrial pump",
        fidelity_validation: { valid: true },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (
          String(url).startsWith("/api/v1/consultant/research-rounds") &&
          !options?.body
        )
          return response(roundOverview);
        if (url === "/api/v1/me")
          return response({
            tier: "consultant",
            user_id: "user",
            account_id: "account",
          });
        if (!options?.method) {
          if (!queued)
            return response({
              session: {
                ...base,
                state: "prep_step1_awaiting_approval",
                retry_action: null,
              },
            });
          progressReads += 1;
          if (progressReads === 1)
            return response({
              session: {
                ...base,
                state: "prep_step2_advisory_generating",
                retry_action: "prepare",
                progress: {
                  phase: "advisory",
                  loop: 1,
                  max_loops: 3,
                  message: "Advisory loop in progress",
                },
              },
            });
          return response({
            session: {
              ...base,
              state: "prep_step3_prompt_awaiting_approval",
              retry_action: null,
              step2_advisory: {
                loop1_trade_lane: "Trade evidence",
                loop2_regulatory: "Regulatory evidence",
                loop3_supply_structure: "Supply evidence",
                sources: [],
              },
              step3_deep_prompt: { prompt_text: "Prepared research prompt" },
            },
          });
        }
        const body = JSON.parse(String(options.body));
        requests.push(body);
        if (body.action === "validate_step1_fidelity")
          return response({ success: true, fidelity: { valid: true } });
        expect(body.action).toBe("approve_step1");
        queued = true;
        return response(
          {
            success: true,
            processing: true,
            session: {
              ...base,
              state: "prep_step2_advisory_generating",
              retry_action: "prepare",
              progress: {
                phase: "queued",
                loop: 0,
                max_loops: 3,
                message: "Your request is queued for research.",
              },
            },
          },
          202,
        );
      }),
    );
    render(<ConsultantWorkflowPage />);
    const approve = await screen.findByRole("button", {
      name: "Approve Interpretation & Proceed",
    });
    await waitFor(() =>
      expect(
        requests.some(
          (request) => request.action === "validate_step1_fidelity",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    await waitFor(() => expect(queued).toBe(true));
    await screen.findByText("Advisory loop in progress");
    expect(
      screen.queryByRole("button", { name: /Retry failed/ }),
    ).not.toBeInTheDocument();
    await screen.findByDisplayValue(
      "Prepared research prompt",
      {},
      { timeout: 4000 },
    );
    expect(progressReads).toBe(2);
    expect(
      requests.some((request) => request.action === "execute_research"),
    ).toBe(false);
  });

  it("blocks New until a pending intake mutation settles without mixing draft identities", async () => {
    const submit = deferred();
    const defaultFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (
          String(url).startsWith("/api/v1/consultant/research-rounds") &&
          !options?.body
        )
          return response(roundOverview);
        const body = options?.body ? JSON.parse(String(options.body)) : {};
        if (body.action === "submit_intake") {
          requests.push(body);
          return submit.promise;
        }
        return defaultFetch(url, options);
      }),
    );
    await openDraft();
    edit();
    expect(
      screen.getByRole("tab", { name: "Section 1: Request" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tab", { name: "Section 2: Preparation" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: /Submit Intake & Proceed/ }),
    );
    await tick();
    expect(requests.some((request) => request.action === "submit_intake")).toBe(
      true,
    );
    const startNew = screen.getByRole("button", {
      name: "+ New Consultant Research",
    });
    expect(startNew).toBeDisabled();
    fireEvent.click(startNew);
    expect(created).toBe(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => {
      submit.resolve(
        response({
          success: true,
          session: {
            run_id: "submitted-run",
            state: "prep_step1_awaiting_approval",
            mode: "demonstration",
            step1_interpretation: {
              english_translation: "Product A. Technical A. Order A.",
              fidelity_validation: { valid: true },
            },
            step2_advisory: null,
          },
        }),
      );
    });
    await tick();
    expect(created).toBe(1);
    expect(window.location.search).toBe(
      "?draft_id=draft-1&run_id=submitted-run",
    );
    expect(screen.getByLabelText("Product Requirement")).toHaveValue(
      "Product A",
    );
    expect(screen.getByLabelText("Order & Supplier Profile")).toHaveValue(
      "Order A",
    );
    expect(
      screen.getByLabelText("Editable English Interpretation"),
    ).toHaveValue("Product A. Technical A. Order A.");
    expect(
      screen.getByRole("tab", { name: "Section 2: Preparation" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tab", { name: "Section 3: Research & Results" }),
    ).toBeDisabled();
    expect(startNew).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Resume Research" }),
    ).toBeDisabled();
    const requestTab = screen.getByRole("tab", { name: /Section 1: Request/ });
    fireEvent.click(requestTab);
    expect(screen.getByLabelText("Product Requirement")).toBeDisabled();
    expect(
      screen.getByLabelText("Technical, Quality & Trade Requirements"),
    ).toBeDisabled();
    expect(screen.getByLabelText("Order & Supplier Profile")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Submit Intake & Proceed/ }),
    ).toBeDisabled();
    fireEvent.keyDown(requestTab, { key: "ArrowRight" });
    const preparationTab = screen.getByRole("tab", {
      name: "Section 2: Preparation",
    });
    expect(preparationTab).toHaveFocus();
    expect(preparationTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });
  it("ignores an older valid response after the current interpretation fails validation", async () => {
    window.history.replaceState(
      {},
      "",
      "/consultant/workflow?run_id=run-validation",
    );
    const older = deferred();
    const current = deferred();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (
          String(url).startsWith("/api/v1/consultant/research-rounds") &&
          !options?.body
        )
          return response(roundOverview);
        if (url === "/api/v1/me")
          return response({
            tier: "consultant",
            user_id: "user",
            account_id: "account",
          });
        if (!options?.method)
          return response({
            session: {
              run_id: "run-validation",
              state: "prep_step1_awaiting_approval",
              mode: "live",
              intake: {},
              step1_interpretation: {
                english_translation: "Original request",
                fidelity_validation: { valid: true },
              },
            },
          });
        const body = JSON.parse(String(options.body));
        requests.push(body);
        expect(body.action).toBe("validate_step1_fidelity");
        return body.translation === "Earlier valid version"
          ? older.promise
          : current.promise;
      }),
    );
    render(<ConsultantWorkflowPage />);
    const interpretation = await screen.findByLabelText(
      "Editable English Interpretation",
    );
    vi.useFakeTimers();
    fireEvent.change(interpretation, {
      target: { value: "Earlier valid version" },
    });
    await tick(400);
    fireEvent.change(interpretation, {
      target: { value: "Current invalid version" },
    });
    await tick(400);
    await act(async () => {
      current.resolve(
        response({
          success: true,
          fidelity: {
            valid: false,
            omitted_count: 1,
            mutated_count: 0,
            explanation: "Required clause omitted",
            omitted_items: [],
            mutated_items: [],
          },
        }),
      );
    });
    await tick();
    expect(
      screen.getByRole("button", { name: "Approval Gated (Fidelity Issues)" }),
    ).toBeDisabled();
    await act(async () => {
      older.resolve(response({ success: true, fidelity: { valid: true } }));
    });
    await tick();
    expect(
      screen.getByRole("button", { name: "Approval Gated (Fidelity Issues)" }),
    ).toBeDisabled();
    expect(interpretation).toHaveValue("Current invalid version");
  });
  it("uses server progress to finish exactly three advisory loops without launching research", async () => {
    window.history.replaceState(
      {},
      "",
      "/consultant/workflow?run_id=run-progress",
    );
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (
          String(url).startsWith("/api/v1/consultant/research-rounds") &&
          !options?.body
        )
          return response(roundOverview);
        if (url === "/api/v1/me")
          return response({
            tier: "consultant",
            user_id: "user",
            account_id: "account",
          });
        expect(options?.method).toBeUndefined();
        reads += 1;
        const session = {
          run_id: "run-progress",
          mode: "live",
          intake: {},
          state:
            reads < 3
              ? "prep_step2_advisory_generating"
              : "prep_step3_prompt_awaiting_approval",
          progress: {
            phase: "preparation",
            loop: reads < 3 ? 1 : 3,
            max_loops: 3,
            message: "Server checkpoint",
          },
          ...(reads >= 3
            ? {
                step1_interpretation: {
                  english_translation: "Approved request",
                },
                step2_advisory: {
                  loop1_trade_lane: "Evidence from trade sources",
                  loop2_regulatory: "Evidence from regulatory sources",
                  loop3_supply_structure: "Evidence from supplier sources",
                  sources: [],
                },
                step3_deep_prompt: { prompt_text: "Editable prepared prompt" },
              }
            : {}),
        };
        return response({ session });
      }),
    );
    render(<ConsultantWorkflowPage />);
    await screen.findByText("Server checkpoint");
    expect(
      screen.getByRole("status", { name: "Workflow progress" }),
    ).toHaveTextContent("Loop 1 of up to 3");
    await screen.findByText(
      "Evidence from trade sources",
      {},
      { timeout: 4000 },
    );
    vi.useFakeTimers();
    expect(screen.getByText("Evidence from trade sources")).toBeInTheDocument();
    expect(
      screen.getByText("Evidence from regulatory sources"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Evidence from supplier sources"),
    ).toBeInTheDocument();
    const prompt = screen.getByLabelText(
      "Editable Synthesized Research Prompt",
    );
    expect(prompt).toBeEnabled();
    fireEvent.change(prompt, { target: { value: "My edited prompt" } });
    expect(prompt).toHaveValue("My edited prompt");
    const settledReads = reads;
    await tick(10000);
    expect(reads).toBe(settledReads);
    expect(requests).toHaveLength(0);
  });

  it("reveals match-sorted candidates five at a time and opens their full dossier", async () => {
    window.history.replaceState(
      {},
      "",
      "/consultant/workflow?run_id=run-results",
    );
    let revealed = 5;
    const output = {
      ...GOLDEN_SCENARIO_V3_01,
      supplier_candidates: [
        ...GOLDEN_SCENARIO_V3_01.supplier_candidates,
      ].reverse(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (
          String(url).startsWith("/api/v1/consultant/research-rounds") &&
          !options?.body
        )
          return response(roundOverview);
        if (url === "/api/v1/me")
          return response({
            tier: "consultant",
            user_id: "user",
            account_id: "account",
          });
        if (!options?.method)
          return response({
            session: {
              run_id: "run-results",
              state: "completed",
              mode: "demonstration",
              intake: {},
              output,
              revealed_count: revealed,
            },
          });
        const body = JSON.parse(String(options.body));
        requests.push(body);
        expect(body.action).toBe("reveal_more");
        revealed += 5;
        return response({ success: true, revealed_count: revealed });
      }),
    );
    render(<ConsultantWorkflowPage />);
    await screen.findByText(/Showing 5 of 20/);
    expect(
      screen.getByRole("tab", { name: "Section 3: Research & Results" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("button", { name: "+ New Consultant Research" }),
    ).toBeEnabled();
    const best = [...output.supplier_candidates].sort(
      (a, b) =>
        b.assessment.compatibility_score - a.assessment.compatibility_score,
    )[0]!;
    expect(
      within(
        screen.getByRole("region", {
          name: "Section 3: Ranked Supplier Candidates & Dossiers",
        }),
      ).getAllByRole("heading", { level: 3 })[0],
    ).toHaveTextContent(best.legal_name);
    for (const count of [10, 15, 20]) {
      fireEvent.click(
        screen.getByRole("button", { name: /Reveal 5 More Candidates/ }),
      );
      await screen.findByText(new RegExp(`Showing ${count} of 20`));
    }
    expect(
      screen.queryByRole("button", { name: /Reveal 5 More Candidates/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", { name: /View Full Dossier/ })[0]!,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(best.legal_name);
    expect(screen.getByRole("dialog")).toHaveTextContent("Sources inspected");
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Commercial Terms & Capacity",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Risks, Unknowns & Required Validation",
    );
  });
  it("serializes Save & New after a pending autosave and freezes all three latest fields", async () => {
    const first = deferred();
    const second = deferred();
    save = (body) =>
      body.expected_version === 1 ? first.promise : second.promise;
    await openDraft();
    edit();
    await tick(800);
    expect(requests.filter((r) => r.action === "save_draft")).toHaveLength(1);
    edit("B");
    fireEvent.click(
      screen.getByRole("button", { name: "+ New Consultant Research" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save & Start New" }));
    await tick();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.getByRole("dialog", { name: "Save Unsaved Changes?" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Product Requirement")).toBeDisabled();
    expect(
      screen.getByLabelText("Technical, Quality & Trade Requirements"),
    ).toBeDisabled();
    expect(screen.getByLabelText("Order & Supplier Profile")).toBeDisabled();
    expect(created).toBe(1);
    await act(async () => {
      first.resolve(response({ success: true, draft_version: 2 }));
    });
    await tick();
    const saves = requests.filter((r) => r.action === "save_draft");
    expect(saves).toHaveLength(2);
    expect(saves[1]).toMatchObject({
      expected_version: 2,
      draft_id: "draft-1",
      draft_data: {
        productRequirement: "Product B",
        technicalCompliance: "Technical B",
        orderProfile: "Order B",
      },
    });
    expect(created).toBe(1);
    await act(async () => {
      second.resolve(response({ success: true, draft_version: 3 }));
    });
    await tick();
    expect(created).toBe(2);
    expect(screen.getByLabelText("Product Requirement")).toHaveValue("");
    expect(window.location.search).toBe("?draft_id=draft-2");
  });

  it("keeps local fields and draft identity when the explicit save fails", async () => {
    save = async () => response({ error: "Storage unavailable" }, 503);
    await openDraft();
    edit();
    fireEvent.click(
      screen.getByRole("button", { name: "+ New Consultant Research" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save & Start New" }));
    await tick();
    expect(screen.getByText("Storage unavailable")).toBeInTheDocument();
    expect(screen.getByLabelText("Product Requirement")).toHaveValue(
      "Product A",
    );
    expect(screen.getByLabelText("Order & Supplier Profile")).toHaveValue(
      "Order A",
    );
    expect(created).toBe(1);
    expect(window.location.search).toBe("?draft_id=draft-1");
  });

  it("does not repeatedly save acknowledged content and starts a blank clean draft", async () => {
    await openDraft();
    edit();
    await tick(800);
    await tick(5000);
    expect(requests.filter((r) => r.action === "save_draft")).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "+ New Consultant Research" }),
    );
    await tick();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(created).toBe(2);
    expect(screen.getByLabelText("Order & Supplier Profile")).toHaveValue("");
  });

  it("places focus on Stay, wraps Tab, and restores focus and input on Escape", async () => {
    await openDraft();
    edit();
    const trigger = screen.getByRole("button", {
      name: "+ New Consultant Research",
    });
    trigger.focus();
    fireEvent.click(trigger);
    expect(
      screen.getByRole("button", { name: "Stay & Continue Editing" }),
    ).toHaveFocus();
    const discard = screen.getByRole("button", {
      name: "Discard Unsaved Inputs & Start New",
    });
    discard.focus();
    fireEvent.keyDown(discard, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close dialog" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByLabelText("Product Requirement")).toHaveValue(
      "Product A",
    );
    expect(requests.filter((r) => r.action === "save_draft")).toHaveLength(0);
  });

  it("never launches supplier research if prompt approval is rejected", async () => {
    window.history.replaceState({}, "", "/consultant/workflow?run_id=run-1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (
          String(url).startsWith("/api/v1/consultant/research-rounds") &&
          !options?.body
        )
          return response(roundOverview);
        if (url === "/api/v1/me")
          return response({
            tier: "consultant",
            user_id: "user",
            account_id: "account",
          });
        if (!options?.method)
          return response({
            session: {
              run_id: "run-1",
              state: "prep_step3_prompt_awaiting_approval",
              mode: "live",
              intake: {},
              step1_interpretation: { english_translation: "Approved request" },
              step3_deep_prompt: { prompt_text: "Find evidenced suppliers" },
            },
          });
        const body = JSON.parse(String(options.body));
        requests.push(body);
        return response(
          { success: false, error: "Prompt version rejected" },
          422,
        );
      }),
    );
    render(<ConsultantWorkflowPage />);
    const launch = await screen.findByRole("button", {
      name: /Approve Prompt & Review Cost/,
    });
    fireEvent.click(launch);
    await screen.findByText("Prompt version rejected");
    expect(requests.map((request) => request.action)).toEqual([
      "approve_step3",
    ]);
  });
});
