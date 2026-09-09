import { useEffect, useRef, useState } from "react";

interface Correction {
  original_translation: string;
  suggested_translation: string;
  changes: string[];
  source: "saved_interpretation" | "ai_correction" | "current_interpretation";
  cost_usd: number | null;
}

export function InterpretationCorrectionPanel({
  runId,
  translation,
  hasFidelityIssue,
  disabled,
  onApply,
}: {
  runId: string;
  translation: string;
  hasFidelityIssue: boolean;
  disabled: boolean;
  onApply: (text: string) => void;
}) {
  const [proposal, setProposal] = useState<Correction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(
    null,
  );
  const requestRef = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const signature = `${runId}\u0000${translation}`;
  const latest = useRef(signature);
  latest.current = signature;

  useEffect(() => {
    ++sequence.current;
    requestRef.current?.abort();
    setProposal(null);
    setError("");
    setBusy(false);
    return () => {
      ++sequence.current;
      requestRef.current?.abort();
    };
  }, [signature, disabled]);

  async function suggest() {
    const id = ++sequence.current;
    const requestedSignature = signature;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError("");
    setProposal(null);
    try {
      const csrf =
        document.cookie
          .split(";")
          .map((value) => value.trim())
          .find(
            (value) =>
              value.startsWith("__Host-matchbase_csrf=") ||
              value.startsWith("matchbase_csrf="),
          )
          ?.split("=")
          .slice(1)
          .join("=") ?? "";
      const response = await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrf),
          "Idempotency-Key": `step1-correction-${Date.now()}-${Array.from(crypto.getRandomValues(new Uint32Array(2))).join("-")}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          action: "suggest_step1_correction",
          run_id: runId,
          translation,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error ||
            "The correction could not be prepared. Your text is unchanged.",
        );
      const value = body.correction;
      if (
        !body.success ||
        !value ||
        value.original_translation !== translation ||
        typeof value.suggested_translation !== "string" ||
        !value.suggested_translation.trim() ||
        value.suggested_translation.length > 24000 ||
        value.fidelity?.valid !== true ||
        !(
          value.cost_usd === null ||
          (typeof value.cost_usd === "number" &&
            Number.isFinite(value.cost_usd) &&
            value.cost_usd >= 0)
        ) ||
        !Array.isArray(value.changes) ||
        !value.changes.every((item: unknown) => typeof item === "string") ||
        ![
          "saved_interpretation",
          "ai_correction",
          "current_interpretation",
        ].includes(value.source)
      )
        throw new Error(
          "No validated correction is available. Your text is unchanged.",
        );
      if (
        id === sequence.current &&
        latest.current === requestedSignature &&
        !controller.signal.aborted
      )
        setProposal(value);
    } catch (failure) {
      if (id === sequence.current && !controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Correction unavailable. Your text is unchanged.",
        );
    } finally {
      if (id === sequence.current && !controller.signal.aborted) setBusy(false);
    }
  }

  const canUndo = undo && undo.after === translation;
  if (!hasFidelityIssue && !canUndo && !proposal && !error) return null;
  return (
    <section
      aria-label="Suggested interpretation correction"
      className="my-4 rounded-lg border border-sky-700 bg-sky-950/30 p-4 space-y-3 text-sm"
    >
      <h4 className="font-semibold text-sky-200">Correct the interpretation</h4>
      {canUndo && (
        <div className="space-y-2">
          <p role="status" className="text-emerald-200">
            Correction applied. Review the text above; final approval is still a
            separate step.
          </p>
          <button
            type="button"
            disabled={disabled}
            className="text-sky-300 underline disabled:opacity-40"
            onClick={() => {
              onApply(undo.before);
              setUndo(null);
            }}
          >
            Undo correction
          </button>
        </div>
      )}
      {hasFidelityIssue && !proposal && !busy && (
        <>
          <p className="text-slate-300 text-xs">
            Review a proposed correction before applying it. The system first
            checks the saved wording at no cost. If that cannot resolve the
            issue, one AI call may be charged; its recorded cost is shown with
            the proposal. Your original request and approval remain unchanged.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void suggest()}
            className="rounded bg-sky-700 px-3 py-2 font-semibold text-white disabled:opacity-40"
          >
            Suggest a correction
          </button>
        </>
      )}
      {busy && (
        <>
          <p role="status" className="text-sky-200">
            Checking saved wording and preparing a correction against your
            original request...
          </p>
          <button
            type="button"
            className="text-sky-300 underline"
            onClick={() => {
              ++sequence.current;
              requestRef.current?.abort();
              setBusy(false);
            }}
          >
            Cancel suggestion
          </button>
          <p className="text-xs text-slate-400">
            An AI call already sent may still finish and be charged.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="text-rose-200">
          {error}
        </p>
      )}
      {proposal && (
        <>
          <p className="text-xs text-slate-300">
            {proposal.source === "ai_correction"
              ? "AI-proposed wording"
              : "Saved wording check"}{" "}
            ·{" "}
            {proposal.cost_usd === null
              ? "Cost record pending; not counted as free"
              : `Recorded cost: USD ${proposal.cost_usd.toFixed(6)}`}
          </p>
          {proposal.changes.length > 0 && (
            <ul className="list-disc pl-5 text-slate-200">
              {proposal.changes.map((change, index) => (
                <li key={index}>{change}</li>
              ))}
            </ul>
          )}
          <label className="block text-sky-200">
            Proposed English interpretation
            <textarea
              aria-label="Proposed English interpretation"
              readOnly
              rows={9}
              value={proposal.suggested_translation}
              className="mt-2 w-full rounded border border-slate-600 bg-slate-950 p-3 text-xs text-slate-200"
            />
          </label>
          <p className="text-xs text-slate-300">
            Checked against detected requirements. Review the complete proposal
            before applying; these checks do not establish that every requested
            detail was detected.
          </p>
          {proposal.suggested_translation !== translation ? (
            <button
              type="button"
              disabled={
                disabled || proposal.original_translation !== translation
              }
              className="rounded bg-sky-700 px-3 py-2 font-semibold text-white disabled:opacity-40"
              onClick={() => {
                setUndo({
                  before: translation,
                  after: proposal.suggested_translation,
                });
                onApply(proposal.suggested_translation);
                setProposal(null);
              }}
            >
              Apply suggested correction
            </button>
          ) : (
            <p role="status" className="text-emerald-200">
              The current wording passes the detected requirement checks. No
              text change is needed.
            </p>
          )}
          <button
            type="button"
            className="ml-3 text-sky-300 underline"
            onClick={() => setProposal(null)}
          >
            Dismiss suggestion
          </button>
        </>
      )}
    </section>
  );
}
