"use client";
import { useRef, useState } from "react";

/** MB-UX-LIVE-001 L09: stop the exact server execution, never just polling. */
export function StopResearchButton({
  runId,
  executionId,
  onStopped,
}: {
  runId: string;
  executionId: string;
  onStopped: (session: any) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  async function stop() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stop_research",
          run_id: runId,
          execution_id: executionId,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success)
        throw new Error(
          data.error ||
            "Stop could not be confirmed. Current research status remains unchanged.",
        );
      if (data.session?.execution_id === executionId) onStopped(data.session);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Stop could not be confirmed. Try again.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <div className="my-4 rounded-lg border border-slate-600 p-4">
      <button
        type="button"
        onClick={() => void stop()}
        disabled={pending}
        className="rounded bg-red-800 px-4 py-2 text-white disabled:opacity-50"
      >
        {pending ? "Stopping research…" : "Stop research"}
      </button>
      <p className="mt-2 text-sm text-slate-300">
        Saved findings and approvals are kept. Worker cancellation takes up to
        20 seconds after confirmation. Already-dispatched provider calls may
        still finish and incur charges. Restarting begins a new execution.
      </p>
      {pending && <p role="status">Requesting server cancellation…</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
