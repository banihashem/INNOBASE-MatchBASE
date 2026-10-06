"use client";
import { useEffect, useState } from "react";
import type {
  NarrativeMapping,
  ResearchCostSummary,
} from "@matchbase/contracts";
import { useWorkflowSession } from "./WorkflowSessionRecovery";
import { workflowMutationHeaders } from "./workflow-request";
export interface NarrativeOperation {
  cost_summary?: ResearchCostSummary;
  operation_id: string;
  narrative: string;
  status: string;
  proposal: NarrativeMapping | null;
  receipts: Record<
    string,
    {
      state?: string;
      dispatched?: boolean;
      cost_reported?: boolean;
      cost_usd?: number;
      upstream_inference_cost?: number;
      is_byok?: boolean;
    }
  >;
  error: string | null;
}
const boxLabels = {
  productRequirement: "Product Requirement",
  technicalCompliance: "Technical, Quality & Trade Requirements",
  orderProfile: "Order & Supplier Profile",
};
export function NarrativeIntakePanel({
  draftId,
  industry,
  narrative,
  disabled,
  busy,
  onIndustry,
  onNarrative,
  onSubmit,
  onApply,
  onManual,
}: {
  draftId: string;
  industry: string;
  narrative: string;
  disabled: boolean;
  busy: boolean;
  onIndustry: (value: string) => void;
  onNarrative: (value: string) => void;
  onSubmit: () => Promise<NarrativeOperation>;
  onApply: (mapping: NarrativeMapping) => void;
  onManual: () => void;
}) {
  const { request } = useWorkflowSession();
  const [operation, setOperation] = useState<NarrativeOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    let current = true;
    setOperation(null);
    setError(null);
    if (!draftId || industry !== "logistics") {
      setReading(false);
      return;
    }
    setReading(true);
    request("/api/v1/consultant/workflow", {
      method: "POST",
      headers: workflowMutationHeaders(),
      body: JSON.stringify({ action: "read_narrative", draft_id: draftId }),
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Preparation status could not be read. Your saved source remains available; do not repeat a pending submission.",
          );
        return response.json();
      })
      .then((data) => {
        if (current) setOperation(data.operation ?? null);
      })
      .catch((reason) => {
        if (current) setError(reason.message);
      })
      .finally(() => {
        if (current) setReading(false);
      });
    return () => {
      current = false;
    };
  }, [draftId, industry, request]);
  async function submit() {
    setError(null);
    try {
      setOperation(await onSubmit());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Preparation failed. Your request remains available for manual entry.",
      );
    }
  }
  const cost = operation?.cost_summary;
  return (
    <section
      aria-labelledby="industry-heading"
      className="rounded-xl border border-slate-600 bg-slate-900 p-5 space-y-4"
    >
      <h2 id="industry-heading" className="text-xl font-bold text-white">
        Choose your industry
      </h2>
      <label className="block text-sm" htmlFor="request-industry">
        Industry
      </label>
      <select
        id="request-industry"
        value={industry}
        disabled={disabled || busy}
        onChange={(event) => onIndustry(event.target.value)}
        className="block mt-2 min-h-11 w-full rounded border border-slate-500 bg-slate-950 p-2 text-white"
      >
        <option value="">Select an industry</option>
        <option value="logistics">Logistics and freight forwarding</option>
        <option value="general">Other products and services</option>
      </select>
      <p className="text-sm text-slate-300">
        This choice guides the intake view. Classification and research scope
        are reviewed separately in Section 2.
      </p>
      {industry === "logistics" && (
        <>
          <label className="block font-semibold" htmlFor="logistics-narrative">
            Describe your logistics request in any language
          </label>
          <p id="logistics-guidance" className="text-sm text-slate-300">
            Include origin → destination, alternatives or separate lots,
            service, cargo/equipment, quantities and units, timing, provider
            role, documents and quote scope. Keep required, preferred and
            excluded terms explicit. Unknown details can stay unknown.
          </p>
          <textarea
            id="logistics-narrative"
            dir="auto"
            rows={7}
            maxLength={12000}
            value={narrative}
            disabled={disabled || busy}
            onChange={(event) => onNarrative(event.target.value)}
            aria-describedby="logistics-guidance preparation-disclosure"
            className="w-full rounded border border-slate-500 bg-slate-950 p-3 text-white"
          />
          <p id="preparation-disclosure" className="text-sm text-amber-200">
            Submit authorizes one paid AI preparation call through the
            configured BYOK route, with no web search and no automatic retry (up
            to 4,000 output tokens). Exact cost is not known in advance.
            Research still requires its separate estimate and approval. Original
            sentences are copied into editable fields; compound sentences may
            appear in more than one field.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={
                disabled ||
                busy ||
                reading ||
                !narrative.trim() ||
                Boolean(operation) ||
                Boolean(error)
              }
              onClick={() => void submit()}
              className="min-h-11 rounded bg-sky-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Preparing editable fields…" : "Submit"}
            </button>
            <button
              type="button"
              disabled={disabled || busy}
              onClick={onManual}
              className="min-h-11 rounded border border-slate-500 bg-slate-800 px-4 py-2 text-white"
            >
              Review fields manually
            </button>
          </div>
          <div
            role="status"
            aria-live="polite"
            className="text-sm text-slate-200"
          >
            {reading && "Reading saved preparation status…"}
            {busy &&
              "Your source is saved. Preparing a proposal; this may take up to 90 seconds. Leaving does not authorize a repeat call."}
            {operation && (
              <p>
                Preparation: {operation.status}.{" "}
                {cost && cost.calls > 0
                  ? `Known recorded subtotal: USD ${cost.recorded_total_usd.toFixed(6)}.`
                  : "No dispatched provider call recorded."}{" "}
                {cost?.complete
                  ? "Recorded charges remain linked to this draft and its submitted run."
                  : "Complete preparation cost is unknown."}
              </p>
            )}
          </div>
          {(error || operation?.error) && (
            <p role="alert" className="text-amber-200">
              {error || operation?.error}
            </p>
          )}
          {operation && ["reserved", "running"].includes(operation.status) && (
            <p className="text-amber-200 text-sm">
              The final outcome is not recorded. No repeat call is available.
              Reload to read the saved outcome, or continue with manual fields.
            </p>
          )}
          {operation?.proposal && (
            <>
              <p className="text-sm text-slate-200">
                Every original sentence is retained. Source coverage does not
                establish correct interpretation. Review the proposal before
                Section 2 approval. Unresolved sentences are retained in Product
                Requirement for review.
              </p>
              <button
                type="button"
                disabled={disabled || busy || narrative !== operation.narrative}
                onClick={() => onApply(operation.proposal!)}
                className="min-h-11 rounded border border-sky-500 bg-slate-800 px-4 py-2 text-white"
              >
                Apply saved proposal to the three fields
              </button>
              {narrative !== operation.narrative && (
                <p className="text-amber-200 text-sm">
                  The narrative has changed. The earlier proposal cannot replace
                  the current fields. Continue with manual review.
                </p>
              )}
              <details className="text-sm">
                <summary className="cursor-pointer min-h-11 py-2">
                  Original source and sentence assignments
                </summary>
                <ol className="space-y-3">
                  {operation.proposal.units.map((unit) => (
                    <li
                      key={unit.id}
                      className="border-l-2 border-slate-500 pl-3"
                    >
                      <p dir="auto" className="whitespace-pre-wrap">
                        {unit.text}
                      </p>
                      <p className="text-slate-300">
                        {operation
                          .proposal!.assignments.find(
                            (row) => row.unit_id === unit.id,
                          )
                          ?.boxes.map((box) => boxLabels[box])
                          .join(" · ") || "Unresolved — manual review"}
                      </p>
                    </li>
                  ))}
                </ol>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
