import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConsultantWorkflowPage from "../../app/consultant/workflow/page";
import {
  WorkflowSessionRecovery,
  useWorkflowSession,
} from "./WorkflowSessionRecovery";

const original = {
  account_id: "account-a",
  user_id: "user-a",
  tier: "consultant",
};
const saved = {
  run_id: "run-a",
  draft_id: "draft-a",
  draft_version: 2,
  state: "prep_step3_prompt_awaiting_approval",
  mode: "live",
  intake: {},
  step3_deep_prompt: { prompt_text: "Saved English plan", is_approved: false },
};
function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}
let identity: typeof original;
let authenticated: boolean;
let rejectApproval: boolean;
let approvalFailure: number | "network";
let serverState: string;
let mutations: { body: any; csrf: string | null }[];
let reads: string[];

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(
    {},
    "",
    "/consultant/workflow?draft_id=draft-a&run_id=run-a",
  );
  identity = { ...original };
  authenticated = true;
  rejectApproval = true;
  approvalFailure = 401;
  serverState = saved.state;
  mutations = [];
  reads = [];
  document.cookie = "matchbase_csrf=old-proof; Path=/";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/v1/me")
        return authenticated
          ? json(identity)
          : json({ error: "A valid session is required." }, 401);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        mutations.push({
          body,
          csrf: new Headers(init.headers).get("X-CSRF-Token"),
        });
        if (rejectApproval) {
          if (approvalFailure === "network")
            throw new Error("Network unavailable");
          return json(
            {
              error: {
                message:
                  approvalFailure === 401
                    ? "A valid session is required."
                    : "Request refused.",
              },
            },
            approvalFailure,
          );
        }
        return json({
          success: true,
          session: {
            ...saved,
            state: "prep_step3_prompt_approved",
            step3_deep_prompt: {
              prompt_text: body.edited_prompt,
              is_approved: true,
            },
          },
        });
      }
      reads.push(input);
      if (!authenticated)
        return json({ error: "A valid session is required." }, 401);
      if (input.startsWith("/api/v1/consultant/research-rounds"))
        return json({ rounds: [], costs: {}, next_round: 1 });
      return json({
        session: {
          ...saved,
          state: serverState,
          step3_deep_prompt: {
            ...saved.step3_deep_prompt,
            is_approved: serverState === "prep_step3_prompt_approved",
          },
        },
        draft: { draft_id: "draft-a", draft_version: 2 },
      });
    }),
  );
});
afterEach(() => {
  document.cookie = "matchbase_csrf=; Max-Age=0; Path=/";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function expireWithEdits() {
  render(<ConsultantWorkflowPage />);
  const plan = await screen.findByLabelText("Editable research plan");
  await waitFor(() => expect(plan).toBeEnabled());
  fireEvent.change(plan, { target: { value: "My unsaved English plan" } });
  fireEvent.click(
    screen.getByRole("button", { name: /Approve plan & review cost/ }),
  );
  await screen.findByRole("heading", { name: "Sign in again to continue" });
  expect(mutations).toHaveLength(1);
}

describe("MB-UX-QUALITY-002 L02 session recovery", () => {
  it("discards a response dispatched before the session was locked", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const observed = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) =>
        input === "/slow" ? pending : Promise.resolve(json({}, 401)),
      ),
    );
    function Probe() {
      const { request } = useWorkflowSession();
      return (
        <>
          <button
            onClick={() => {
              void request("/slow").then(async (response) =>
                observed(response.status, await response.json()),
              );
            }}
          >
            Read pending result
          </button>
          <button
            onClick={() => {
              void request("/expire");
            }}
          >
            Expire session
          </button>
        </>
      );
    }
    render(
      <WorkflowSessionRecovery>
        <Probe />
      </WorkflowSessionRecovery>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Read pending result" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Expire session" }));
    await screen.findByRole("heading", { name: "Sign in again to continue" });
    await act(async () => {
      finish(json({ private_result: "stale private payload" }));
    });
    await waitFor(() => expect(observed).toHaveBeenCalledOnce());
    expect(observed.mock.calls[0]?.[0]).toBe(401);
    expect(JSON.stringify(observed.mock.calls)).not.toContain(
      "stale private payload",
    );
  });

  it("preserves English edits and same URL, requires current sign-in, and never replays approval", async () => {
    await expireWithEdits();
    const link = screen.getByRole("link", {
      name: "Open sign-in in a new tab",
    });
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    authenticated = false;
    fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));
    await screen.findByText(/Sign-in is still required/);
    expect(mutations).toHaveLength(1);
    authenticated = true;
    document.cookie = "matchbase_csrf=current-proof; Path=/";
    fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));
    await screen.findByText(/Sign-in restored/);
    expect(screen.getByLabelText("Editable research plan")).toHaveValue(
      "My unsaved English plan",
    );
    expect(window.location.search).toBe("?draft_id=draft-a&run_id=run-a");
    expect(sessionStorage.getItem("matchbase_workflow_draft_v1")).toBeNull();
    vi.useFakeTimers();
    const readCount = reads.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31000);
    });
    expect(reads).toHaveLength(readCount);
    expect(mutations).toHaveLength(1);
    vi.useRealTimers();
    rejectApproval = false;
    fireEvent.click(
      screen.getByRole("button", { name: /Approve plan & review cost/ }),
    );
    await waitFor(() => expect(mutations).toHaveLength(2));
    expect(mutations[1]).toMatchObject({
      csrf: "current-proof",
      body: {
        action: "approve_step3",
        run_id: "run-a",
        edited_prompt: "My unsaved English plan",
      },
    });
    expect(mutations.every(({ body }) => body.action === "approve_step3")).toBe(
      true,
    );
  });

  for (const changed of [{ user_id: "user-b" }, { account_id: "account-b" }]) {
    it(`refuses recovery for a changed ${Object.keys(changed)[0]} before reading saved private work`, async () => {
      await expireWithEdits();
      identity = { ...identity, ...changed };
      const count = reads.length;
      fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));
      await screen.findByText(/A different account is signed in/);
      expect(reads).toHaveLength(count);
      expect(
        screen.queryByRole("button", { name: /Approve plan & review cost/ }),
      ).not.toBeInTheDocument();
      expect(mutations).toHaveLength(1);
    });
  }

  it("reconciles a plan already approved elsewhere without overlaying unapproved local edits", async () => {
    await expireWithEdits();
    serverState = "prep_step3_prompt_approved";
    fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));
    await screen.findByText(/Sign-in restored/);
    const plan = screen.getByLabelText("Editable research plan");
    await waitFor(() => expect(plan).toHaveValue("Saved English plan"));
    expect(plan).toBeDisabled();
    expect(mutations).toHaveLength(1);
  });

  it("recovers a signed-out reload at the original run URL through reads only", async () => {
    authenticated = false;
    render(<ConsultantWorkflowPage />);
    await screen.findByRole("heading", { name: "Sign in again to continue" });
    expect(mutations).toHaveLength(0);
    authenticated = true;
    fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));
    await screen.findByLabelText("Editable research plan");
    expect(window.location.search).toBe("?draft_id=draft-a&run_id=run-a");
    expect(mutations).toHaveLength(0);
  });

  it("hydrates the same run when initial identity succeeds but the saved-run read expires", async () => {
    const initialFetch = globalThis.fetch;
    let firstRead = true;
    let expireRead!: (response: Response) => void;
    const pendingRead = new Promise<Response>((resolve) => {
      expireRead = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (firstRead && input.startsWith("/api/v1/consultant/workflow?")) {
          firstRead = false;
          return pendingRead;
        }
        return initialFetch(input, init);
      }),
    );
    render(<ConsultantWorkflowPage />);
    await waitFor(() =>
      expect(
        screen.queryByText("Preparing your request form…"),
      ).not.toBeInTheDocument(),
    );
    await act(async () => {
      expireRead(json({}, 401));
    });
    await screen.findByRole("heading", { name: "Sign in again to continue" });
    fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));
    const plan = await screen.findByLabelText("Editable research plan");
    await waitFor(() => expect(plan).toBeEnabled());
    expect(plan).toHaveValue("Saved English plan");
    expect(mutations).toHaveLength(0);
  });

  it("does not create a new draft automatically after reauthenticating an initial new-request URL", async () => {
    authenticated = false;
    window.history.replaceState({}, "", "/consultant/workflow?mode=new");
    render(<ConsultantWorkflowPage />);
    await screen.findByRole("heading", { name: "Sign in again to continue" });
    const before = mutations.length;
    authenticated = true;
    fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));
    await screen.findByText(/Sign-in restored/);
    await screen.findByRole("button", { name: "Retry preparing request form" });
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mutations).toHaveLength(before);
    expect(window.location.search).toBe("?mode=new");
  });

  for (const failure of [403, "network"] as const) {
    it(`does not present a ${failure} failure as an expired session`, async () => {
      approvalFailure = failure;
      render(<ConsultantWorkflowPage />);
      const plan = await screen.findByLabelText("Editable research plan");
      await waitFor(() => expect(plan).toBeEnabled());
      fireEvent.click(
        screen.getByRole("button", { name: /Approve plan & review cost/ }),
      );
      await screen.findByText(
        failure === 403 ? "Request refused." : "Network unavailable",
      );
      expect(
        screen.queryByRole("heading", { name: "Sign in again to continue" }),
      ).not.toBeInTheDocument();
      expect(plan).toBeEnabled();
      expect(mutations).toHaveLength(1);
    });
  }

  it("retains the original draft version so a newer saved draft requires conflict resolution", async () => {
    window.history.replaceState(
      {},
      "",
      "/consultant/workflow?draft_id=draft-a",
    );
    let version = 5;
    let recovered = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input === "/api/v1/me") return json(original);
        if (!init?.method)
          return json({
            draft: {
              draft_id: "draft-a",
              draft_version: version,
              draft_data: {
                productRequirement: "Saved product",
                technicalCompliance: "Saved terms",
                orderProfile: "Saved order",
              },
            },
          });
        const body = JSON.parse(String(init.body));
        mutations.push({ body, csrf: "" });
        return recovered
          ? json({ current_version: 6 }, 409)
          : json({ error: "A valid session is required." }, 401);
      }),
    );
    render(<ConsultantWorkflowPage />);
    const input = await screen.findByLabelText("Product Requirement");
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "Unsaved local product" } });
    await screen.findByRole(
      "heading",
      { name: "Sign in again to continue" },
      { timeout: 2000 },
    );
    version = 6;
    recovered = true;
    fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));
    await screen.findByText(/Sign-in restored/);
    expect(screen.getByLabelText("Product Requirement")).toHaveValue(
      "Unsaved local product",
    );
    expect(mutations).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Resume automatic checks and draft saving",
      }),
    );
    await screen.findByRole(
      "alertdialog",
      { name: "This draft changed in another tab" },
      { timeout: 2000 },
    );
    expect(mutations[1]?.body).toMatchObject({
      action: "save_draft",
      expected_version: 5,
      draft_data: { productRequirement: "Unsaved local product" },
    });
  });

  it("does not apply saved fidelity approval to unsaved English interpretation edits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input === "/api/v1/me") return json(original);
        if (!init?.method)
          return json({
            session: {
              ...saved,
              state: "prep_step1_awaiting_approval",
              step3_deep_prompt: null,
              step1_interpretation: {
                english_translation: "Original English",
                fidelity_validation: { valid: true },
              },
            },
            draft: { draft_id: "draft-a" },
          });
        const body = JSON.parse(String(init.body));
        mutations.push({ body, csrf: "" });
        return body.translation === "Unsaved English"
          ? json({}, 401)
          : json({ success: true, fidelity: { valid: true } });
      }),
    );
    render(<ConsultantWorkflowPage />);
    const interpretation = await screen.findByLabelText(
      "Editable English Interpretation",
    );
    fireEvent.change(interpretation, { target: { value: "Unsaved English" } });
    await screen.findByRole("heading", { name: "Sign in again to continue" });
    const count = mutations.length;
    fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));
    await screen.findByText(/Sign-in restored/);
    expect(
      screen.getByLabelText("Editable English Interpretation"),
    ).toHaveValue("Unsaved English");
    expect(
      screen.getByRole("button", { name: "Approve interpretation & continue" }),
    ).toBeDisabled();
    expect(mutations).toHaveLength(count);
  });
});

it("MB-UX-QUALITY-002 L02 correction keeps durable failure details and recovery after sign-in", async () => {
  const preceding = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const response = await preceding(input, init);
      if (input.startsWith("/api/v1/consultant/workflow?") && !init?.method) {
        const body = await response.json();
        body.session.state = "workflow_failed";
        body.session.error = "Synthetic durable preparation failure";
        body.session.retry_action = "prepare";
        return json(body);
      }
      return response;
    }),
  );
  render(<ConsultantWorkflowPage />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Retry failed preparation stage",
    }),
  );
  await screen.findByRole("heading", { name: "Sign in again to continue" });
  fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));
  await screen.findByText(/Sign-in restored/);
  await screen.findByText("Synthetic durable preparation failure");
  expect(
    screen.getByRole("button", { name: "Retry failed preparation stage" }),
  ).toBeInTheDocument();
});

it("MB-UX-QUALITY-002 L02 correction invalidates fidelity after editing while recovered automatic work is paused", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/v1/me") return json(original);
      if (!init?.method)
        return json({
          session: {
            ...saved,
            state: "prep_step1_awaiting_approval",
            step3_deep_prompt: null,
            step1_interpretation: {
              english_translation: "Original English",
              fidelity_validation: { valid: true },
            },
          },
          draft: { draft_id: "draft-a" },
        });
      const body = JSON.parse(String(init.body));
      mutations.push({ body, csrf: "" });
      return body.action === "approve_step1"
        ? json({}, 401)
        : json({ success: true, fidelity: { valid: true } });
    }),
  );
  render(<ConsultantWorkflowPage />);
  await screen.findByLabelText("Editable English Interpretation");
  const approval = screen.getByRole("button", {
    name: "Approve interpretation & continue",
  });
  await waitFor(() =>
    expect(
      mutations.some(({ body }) => body.action === "validate_step1_fidelity"),
    ).toBe(true),
  );
  await waitFor(() => expect(approval).toBeEnabled());
  fireEvent.click(approval);
  await screen.findByRole("heading", { name: "Sign in again to continue" });
  fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));
  await screen.findByText(/Sign-in restored/);
  const mutationCount = mutations.length;
  fireEvent.change(screen.getByLabelText("Editable English Interpretation"), {
    target: { value: "Entirely changed unvalidated text" },
  });
  expect(mutations).toHaveLength(mutationCount);
  expect(
    screen.getByRole("button", { name: "Approve interpretation & continue" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Resume automatic checks and draft saving",
    }),
  );
  await waitFor(() =>
    expect(
      mutations.some(
        ({ body }) =>
          body.action === "validate_step1_fidelity" &&
          body.translation === "Entirely changed unvalidated text",
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Approve interpretation & continue" }),
    ).toBeEnabled(),
  );
});

it("MB-UX-QUALITY-002 L02 correction hydrates an existing intake draft if its first read expires after identity loads", async () => {
  window.history.replaceState({}, "", "/consultant/workflow?draft_id=draft-a");
  let draftReads = 0;
  let expireRead!: (response: Response) => void;
  const pendingRead = new Promise<Response>((resolve) => {
    expireRead = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/v1/me") return json(original);
      if (init?.method) throw new Error("Unexpected mutation");
      draftReads += 1;
      if (draftReads === 1) {
        return pendingRead;
      }
      return json({
        draft: {
          draft_id: "draft-a",
          draft_version: 5,
          draft_data: {
            productRequirement: "Saved product",
            technicalCompliance: "Saved terms",
            orderProfile: "Saved order",
          },
        },
      });
    }),
  );
  render(<ConsultantWorkflowPage />);
  await waitFor(() =>
    expect(
      screen.queryByText("Preparing your request form…"),
    ).not.toBeInTheDocument(),
  );
  await act(async () => {
    expireRead(json({}, 401));
  });
  await screen.findByRole("heading", { name: "Sign in again to continue" });
  fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));
  await screen.findByText(/Sign-in restored/);
  expect(await screen.findByLabelText("Product Requirement")).toHaveValue(
    "Saved product",
  );
  expect(screen.getByLabelText("Product Requirement")).toBeEnabled();
  expect(
    vi
      .mocked(globalThis.fetch)
      .mock.calls.every(([, init]) => !init?.method || init.method === "GET"),
  ).toBe(true);
});

it("MB-UX-QUALITY-002 L02 correction retains saved fidelity for an already approved interpretation", async () => {
  const preceding = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const response = await preceding(input, init);
      if (input.startsWith("/api/v1/consultant/workflow?") && !init?.method) {
        const body = await response.json();
        body.session.step1_interpretation = {
          english_translation: "Approved English",
          fidelity_validation: { valid: true, preserved_count: 3 },
        };
        return json(body);
      }
      return response;
    }),
  );
  render(<ConsultantWorkflowPage />);
  await screen.findByText(/Checked Requirements Passed/);
  const interpretation = screen.getByLabelText(
    "Editable English Interpretation",
  );
  expect(interpretation).toHaveValue("Approved English");
  expect(interpretation).toBeDisabled();
  expect(mutations).toHaveLength(0);
});
