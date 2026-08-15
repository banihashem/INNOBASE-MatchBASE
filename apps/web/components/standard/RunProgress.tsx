import { useEffect, useRef, useState } from "react";
import { idempotencyKey, workspaceJson } from "./api";
import type {
  StandardResultProjectionV1,
  StandardRunProjectionV1,
  WorkspaceSession,
} from "./types";

export function RunProgress({
  session,
  runId,
  onResult,
  onTerminal,
}: {
  session: WorkspaceSession;
  runId: string;
  onResult: (result: StandardResultProjectionV1) => void;
  onTerminal: () => void;
}) {
  const [run, setRun] = useState<StandardRunProjectionV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let currentEtag: string | null = null;
    async function poll() {
      try {
        const response = await workspaceJson<StandardRunProjectionV1>(
          `/api/v1/runs/${encodeURIComponent(runId)}`,
          { headers: currentEtag ? { "If-None-Match": currentEtag } : {} },
        );
        if (!alive.current) return;
        if (response.etag) currentEtag = response.etag;
        if (!response.notModified) {
          setRun(response.body);
          if (response.body.terminal) {
            if (response.body.result_available) {
              const result = await workspaceJson<StandardResultProjectionV1>(
                `/api/v1/runs/${encodeURIComponent(runId)}/result`,
              );
              if (alive.current) onResult(result.body);
            }
            return;
          }
          timer = setTimeout(
            () => void poll(),
            response.pollAfterMs ?? Math.max(250, response.body.poll_after_ms),
          );
          return;
        }
        timer = setTimeout(() => void poll(), response.pollAfterMs ?? 500);
      } catch (reason) {
        if (alive.current)
          setError(
            reason instanceof Error ? reason.message : "Run status failed.",
          );
      }
    }
    void poll();
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId, onResult]);

  async function cancel() {
    try {
      await workspaceJson(
        `/api/v1/runs/${encodeURIComponent(runId)}/cancellation`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("standard-cancel") },
          body: JSON.stringify({ reason: "owner_cancelled" }),
        },
        session.csrf_token,
      );
      onTerminal();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Cancellation failed.",
      );
    }
  }

  return (
    <section
      className="standard-section"
      aria-labelledby="run-heading"
      aria-busy={!run?.terminal}
    >
      <p className="eyebrow">Synthetic research</p>
      <h2 id="run-heading">
        {run?.phase_label ?? "Queued for bounded execution"}
      </h2>
      {error ? (
        <div className="error-summary" role="alert">
          {error}
        </div>
      ) : null}
      <div
        className="standard-progress"
        role="progressbar"
        aria-label="Run progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={run?.progress ?? 0}
      >
        <span style={{ width: `${run?.progress ?? 0}%` }} />
      </div>
      <p role="status" aria-live="polite">
        {run
          ? `${run.phase_label}. ${run.progress}% complete.`
          : "Waiting for a lease-backed worker."}
      </p>
      <p>
        {run?.limitations_notice ?? "No live web or provider route is active."}
      </p>
      {!run?.terminal ? (
        <button
          type="button"
          className="danger-action"
          onClick={() => void cancel()}
        >
          Cancel run
        </button>
      ) : null}
      {run?.terminal && !run.result_available ? (
        <button type="button" className="secondary-action" onClick={onTerminal}>
          Return to requests
        </button>
      ) : null}
    </section>
  );
}
