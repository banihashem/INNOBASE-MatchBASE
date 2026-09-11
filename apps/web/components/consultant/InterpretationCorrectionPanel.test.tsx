import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InterpretationCorrectionPanel } from "./InterpretationCorrectionPanel";

const original = "Order: 5 machines.";
const corrected = "Order: 3 machines.";
function Harness() {
  const [text, setText] = useState(original);
  return (
    <>
      <input
        aria-label="Current interpretation"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <InterpretationCorrectionPanel
        runId="saved-run"
        translation={text}
        hasFidelityIssue={text !== corrected}
        disabled={false}
        onApply={setText}
      />
    </>
  );
}
function response(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      success: true,
      correction: {
        original_translation: original,
        suggested_translation: corrected,
        changes: ["Restore the requested quantity of 3."],
        source: "saved_interpretation",
        cost_usd: 0,
        fidelity: { valid: true },
        ...overrides,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.unstubAllGlobals());

describe("L12 reviewable interpretation correction", () => {
  it("previews without editing, applies explicitly, and supports undo without approval", async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetch);
    document.cookie = "matchbase_csrf=ui-correction-token";
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Suggest a correction" }),
    );
    expect(
      await screen.findByLabelText("Proposed English interpretation"),
    ).toHaveValue(corrected);
    expect(screen.getByLabelText("Current interpretation")).toHaveValue(
      original,
    );
    expect(screen.getByText(/Recorded cost: USD 0.000000/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply suggested correction" }),
    );
    expect(screen.getByLabelText("Current interpretation")).toHaveValue(
      corrected,
    );
    expect(
      screen.getByText(/final approval is still a separate step/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo correction" }));
    expect(screen.getByLabelText("Current interpretation")).toHaveValue(
      original,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]![1].body).action).toBe(
      "suggest_step1_correction",
    );
    expect(fetch.mock.calls[0]![1].headers["x-csrf-token"]).toBe(
      "ui-correction-token",
    );
    expect(fetch.mock.calls[0]![1].headers["Idempotency-Key"]).toMatch(
      /^step1-correction-/,
    );
  });
  it("does not overwrite text edited while the suggestion is running", async () => {
    const pending = deferred();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetch);
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Suggest a correction" }),
    );
    fireEvent.change(screen.getByLabelText("Current interpretation"), {
      target: { value: "My newer wording" },
    });
    await act(async () => pending.resolve(response()));
    expect(screen.getByLabelText("Current interpretation")).toHaveValue(
      "My newer wording",
    );
    expect(
      screen.queryByRole("button", { name: "Apply suggested correction" }),
    ).not.toBeInTheDocument();
    expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
  });
  it("invalidates a preview when the current text changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Suggest a correction" }),
    );
    await screen.findByRole("button", { name: "Apply suggested correction" });
    fireEvent.change(screen.getByLabelText("Current interpretation"), {
      target: { value: "A different edit" },
    });
    expect(
      screen.queryByRole("button", { name: "Apply suggested correction" }),
    ).not.toBeInTheDocument();
  });
  it("keeps the text and offers retry after a provider failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Provider unavailable; your text is unchanged.",
          }),
          { status: 503 },
        ),
      ),
    );
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Suggest a correction" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Provider unavailable",
    );
    expect(screen.getByLabelText("Current interpretation")).toHaveValue(
      original,
    );
    expect(
      screen.getByRole("button", { name: "Suggest a correction" }),
    ).toBeEnabled();
  });
  it.each([
    { fidelity: { valid: false } },
    { original_translation: "A different request" },
    { cost_usd: "free" },
  ])("refuses an invalid or mismatched proposal %j", async (invalid) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(invalid)));
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Suggest a correction" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No validated correction",
    );
    expect(
      screen.queryByRole("button", { name: "Apply suggested correction" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Current interpretation")).toHaveValue(
      original,
    );
  });
  it("cancels a preview and ignores its late response", async () => {
    const pending = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Suggest a correction" }),
    );
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
    await act(async () => pending.resolve(response()));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Suggest a correction" }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByLabelText("Proposed English interpretation"),
    ).not.toBeInTheDocument();
  });
});

describe("MB-UX-QUALITY-001 L03 bounded correction recovery", () => {
  it("discloses the billable recovery limit and preserves text while waiting without client retries", async () => {
    const pending = deferred();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetch);
    render(<Harness />);
    expect(
      screen.getByText(/up to 3 AI attempts may be charged/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Suggest a correction" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "within a total of 3 AI attempts",
    );
    expect(
      screen.getByRole("region", {
        name: "Suggested interpretation correction",
      }),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Current interpretation")).toHaveValue(
      original,
    );
    expect(
      screen.getByText(
        /Stopping the wait does not cancel this correction operation/,
      ),
    ).toBeInTheDocument();
    await act(async () => pending.resolve(response()));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("region", {
        name: "Suggested interpretation correction",
      }),
    ).toHaveAttribute("aria-busy", "false");
  });

  it("shows server-reported recovery attempts and total cost without applying or approving the proposal", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        source: "ai_correction",
        cost_usd: 0.024,
        attempts_used: 3,
        recovered: true,
      }),
    );
    vi.stubGlobal("fetch", fetch);
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Suggest a correction" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "ready after 3 AI attempts",
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "An earlier response was repaired automatically",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing has been applied or approved",
    );
    expect(screen.getByText(/Recorded cost: USD 0.024000/)).toHaveTextContent(
      "Total across all attempts",
    );
    expect(screen.getByLabelText("Current interpretation")).toHaveValue(
      original,
    );
    expect(
      screen.getByRole("button", { name: "Apply suggested correction" }),
    ).toBeEnabled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed validated response reviewable without repeating the request or hiding diagnostic details", async () => {
    const message =
      "MB-422-CORRECTION-FIDELITY: Correction changed a required specification.";
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: message }), { status: 422 }),
      );
    vi.stubGlobal("fetch", fetch);
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Suggest a correction" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("could not pass the requirement checks");
    expect(alert).toHaveTextContent("Your text and approval are unchanged");
    expect(alert).not.toHaveTextContent("MB-422");
    expect(screen.getByText(message).closest("details")).not.toHaveAttribute(
      "open",
    );
    expect(screen.getByLabelText("Current interpretation")).toHaveValue(
      original,
    );
    expect(
      screen.queryByRole("button", { name: "Apply suggested correction" }),
    ).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { source: "ai_correction", attempts_used: 4, recovered: true },
    { source: "ai_correction", attempts_used: 1, recovered: true },
    { source: "saved_interpretation", attempts_used: 2, recovered: false },
  ])("refuses inconsistent recovery metadata %j", async (metadata) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(metadata)));
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Suggest a correction" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No validated correction",
    );
    expect(screen.getByLabelText("Current interpretation")).toHaveValue(
      original,
    );
    expect(
      screen.queryByRole("button", { name: "Apply suggested correction" }),
    ).not.toBeInTheDocument();
  });
});
