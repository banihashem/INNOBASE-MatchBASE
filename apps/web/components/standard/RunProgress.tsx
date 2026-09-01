import { useCallback, useEffect, useRef, useState } from "react";
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
  onAnnouncement,
  deferResultToProfile = false,
}: {
  session: WorkspaceSession;
  runId: string;
  onResult: (result: StandardResultProjectionV1) => void;
  onTerminal: () => void;
  onAnnouncement: (message: string) => void;
  deferResultToProfile?: boolean;
}) {
  const [run, setRun] = useState<StandardRunProjectionV1 | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [resultLoadFailed, setResultLoadFailed] = useState(false);
  const [updatesPaused, setUpdatesPaused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const currentEtag = useRef<string | null>(null);
  const lastAnnouncedState = useRef<string | null>(null);
  const requestGeneration = useRef(0);

  const loadStatus = useCallback(
    async (expectedGeneration: number) => {
      try {
        const response = await workspaceJson<StandardRunProjectionV1>(
          `/api/v1/runs/${encodeURIComponent(runId)}`,
          {
            headers: currentEtag.current
              ? { "If-None-Match": currentEtag.current }
              : {},
          },
        );
        if (expectedGeneration !== requestGeneration.current) return null;
        setUpdateError(null);
        if (response.etag) currentEtag.current = response.etag;
        if (response.notModified) return response.pollAfterMs ?? 500;
        setRun(response.body);
        if (lastAnnouncedState.current !== response.body.state) {
          lastAnnouncedState.current = response.body.state;
          setAnnouncement(`${response.body.phase_label}.`);
        }
        if (response.body.terminal) {
          if (response.body.result_available) {
            if (deferResultToProfile) {
              onAnnouncement(
                "Qualified research complete. The Consultant result is available in your profile.",
              );
              onTerminal();
              return null;
            }
            setResultLoadFailed(false);
            try {
              const result = await workspaceJson<StandardResultProjectionV1>(
                `/api/v1/runs/${encodeURIComponent(runId)}/result`,
              );
              if (expectedGeneration === requestGeneration.current) {
                onAnnouncement(
                  result.body.candidates.length === 0
                    ? "Research complete. No candidate met the mandatory constraints."
                    : `Research complete. ${result.body.candidates.length} eligible ${result.body.candidates.length === 1 ? "candidate" : "candidates"}.`,
                );
                onResult(result.body);
              }
            } catch (reason) {
              if (expectedGeneration === requestGeneration.current) {
                setResultLoadFailed(true);
                setActionError(
                  reason instanceof Error
                    ? reason.message
                    : "Result disclosure failed.",
                );
              }
            }
          } else if (response.body.state === "failed") {
            setActionError(
              `Research failed. ${response.body.limitations_notice}`,
            );
          }
          return null;
        }
        return (
          response.pollAfterMs ?? Math.max(250, response.body.poll_after_ms)
        );
      } catch {
        if (expectedGeneration === requestGeneration.current) {
          const message = "Status updates are unavailable. Retrying.";
          setUpdateError(message);
          setAnnouncement(message);
        }
        return 2_000;
      }
    },
    [deferResultToProfile, onAnnouncement, onResult, onTerminal, runId],
  );

  useEffect(() => {
    const expectedGeneration = requestGeneration.current + 1;
    requestGeneration.current = expectedGeneration;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      const nextDelay = await loadStatus(expectedGeneration);
      if (
        expectedGeneration === requestGeneration.current &&
        nextDelay !== null
      )
        timer = setTimeout(() => void poll(), nextDelay);
    }
    if (!updatesPaused) void poll();
    return () => {
      if (requestGeneration.current === expectedGeneration)
        requestGeneration.current += 1;
      if (timer) clearTimeout(timer);
    };
  }, [loadStatus, updatesPaused]);

  async function refreshNow() {
    const expectedGeneration = requestGeneration.current;
    setRefreshing(true);
    await loadStatus(expectedGeneration);
    setRefreshing(false);
  }

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
      setActionError(
        reason instanceof Error ? reason.message : "Cancellation failed.",
      );
    }
  }

  return (
    <section className="standard-section" aria-labelledby="run-heading">
      <p className="eyebrow">{session.research_mode.label}</p>
      <h1 id="run-heading" tabIndex={-1}>
        {run?.phase_label ?? "Queued for bounded execution"}
      </h1>
      {actionError ? (
        <div className="error-summary" role="alert">
          {actionError}
        </div>
      ) : null}
      {updateError ? <p>{updateError}</p> : null}
      <div
        className="standard-progress"
        role="progressbar"
        aria-label="Run progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={run?.progress}
        aria-valuetext={
          run ? `${run.progress}% complete` : "Waiting for run status"
        }
      >
        <span style={{ width: `${run?.progress ?? 0}%` }} />
      </div>
      <p>
        {run
          ? `${run.phase_label}. ${run.progress}% complete.`
          : "Waiting for a lease-backed worker."}
      </p>
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </p>
      <p>
        {run?.limitations_notice ?? "No live web or provider route is active."}
      </p>
      {!run?.terminal ? (
        <>
          <button
            type="button"
            className="secondary-action"
            aria-pressed={updatesPaused}
            onClick={() =>
              setUpdatesPaused((paused) => {
                if (!paused) requestGeneration.current += 1;
                return !paused;
              })
            }
          >
            {updatesPaused ? "Resume updates" : "Pause updates"}
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={refreshing}
            onClick={() => void refreshNow()}
          >
            Refresh now
          </button>
          <button
            type="button"
            className="danger-action"
            onClick={() => void cancel()}
          >
            Cancel run
          </button>
        </>
      ) : null}
      {run?.terminal && (!run.result_available || resultLoadFailed) ? (
        <button type="button" className="secondary-action" onClick={onTerminal}>
          Return to requests
        </button>
      ) : null}
    </section>
  );
}
