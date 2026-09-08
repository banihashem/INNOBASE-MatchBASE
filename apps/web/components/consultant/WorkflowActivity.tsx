"use client";
import { useEffect, useState } from "react";
import {
  phaseLabel,
  resultReady,
  workflowLabel,
  type ActivityStep,
  type WorkflowProgress,
} from "./workflow-status";

export function WorkflowActivity({
  state,
  progress,
  activity = [],
  busy = false,
  connectionError = null,
  pdfBusy = false,
  retryAction = null,
}: {
  state: string;
  progress: WorkflowProgress | null;
  activity?: ActivityStep[];
  busy?: boolean;
  connectionError?: string | null;
  pdfBusy?: boolean;
  retryAction?: string | null;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const initialInterpretation =
    state === "prep_step1_interpreting" || (state === "intake_draft" && busy);
  const failureLabel =
    retryAction === "interpretation"
      ? "Interpretation stopped"
      : retryAction === "prepare"
        ? "Preparation stopped"
        : "Research stopped";
  const failed = state === "workflow_failed";
  const stoppedByUser = failed && progress?.phase === "user_cancelled";
  const recoveryCopy =
    retryAction === "research"
      ? "Your saved request and approvals are retained. No research is running. A new execution requires a fresh cost estimate and your approval. Completed round results are retained."
      : retryAction === "prepare"
        ? "Your approved interpretation is saved. No research is running. Retry restarts advisory research and research-plan preparation; the plan still needs your approval."
        : "Your saved request is retained. No research is running. Retry repeats the failed interpretation or preparation step.";
  const ready = resultReady(state);
  const awaiting =
    state.includes("awaiting_approval") ||
    state === "prep_step3_prompt_approved";
  const active =
    !failed && !ready && !awaiting && (busy || state !== "intake_draft");
  const age = progress?.updated_at ? now - Date.parse(progress.updated_at) : 0;
  const quiet = active && age > 120000;
  const failure = [...activity].reverse().find((step) => step.failed > 0);
  const heading = pdfBusy
    ? "Preparing your PDF download"
    : failed
      ? stoppedByUser
        ? "Stopped by you"
        : failureLabel
      : awaiting
        ? workflowLabel(state)
        : ready
          ? "Your supplier results are ready"
          : phaseLabel(
              progress?.phase || (busy ? "interpretation" : "queued"),
              progress?.loop,
            );
  const stages = [
    "Your request",
    "English interpretation · Your approval",
    "Advisory research · 3 rounds",
    "Research plan · Your approval",
    "Gemini + OpenAI supplier discovery",
    "Evidence review · one approved round at a time",
    "Ranked results and supplier details",
    "PDF download",
  ];
  return (
    <section className="workflow-activity" aria-label="Research activity">
      <div role="status" aria-label="Workflow progress" aria-live="polite">
        <p className="activity-kicker">
          {failed
            ? stoppedByUser
              ? "Research stopped"
              : "Action needed"
            : pdfBusy || active
              ? "Working on your request"
              : awaiting
                ? "Your review is needed"
                : ready
                  ? "Research complete"
                  : "Research status"}
        </p>
        <h2>{heading}</h2>
        <p>
          {pdfBusy
            ? "The report is being prepared and transferred to your browser. Keep this page open until the download starts."
            : failed
              ? stoppedByUser
                ? "Your saved findings, request and approvals are retained. No new execution starts without a fresh cost estimate and your approval. Completed round results remain available."
                : recoveryCopy
              : awaiting
                ? state === "prep_step3_prompt_approved"
                  ? "Your research plan is approved. Review the recorded spend and get a cost estimate below. Research starts only after you approve that estimate."
                  : "Review the editable text below to continue. Research waits for your approval."
                : ready
                  ? "Open any supplier for the full evidence and contact details. Download the report from the results section."
                  : initialInterpretation
                    ? "Your saved request is being interpreted in English. Keep this page open until the interpretation is ready for review."
                    : "The server is processing your saved request. You can leave this page and return from Home; reopening it does not start another research execution."}
        </p>
        {failure && failed && (
          <p>
            <strong>
              Stopped at: {phaseLabel(failure.phase, failure.loop)}
            </strong>
          </p>
        )}
        {!awaiting &&
          progress?.loop != null &&
          progress.loop > 0 &&
          (progress.max_loops ?? 0) > 1 && (
            <p>
              Loop {progress.loop}
              {progress.max_loops ? ` of up to ${progress.max_loops}` : ""} ·
              Reported by the server
            </p>
          )}
      </div>
      {connectionError ? (
        <p role="alert" className="activity-warning">
          Status connection interrupted. The last saved status is shown; this
          does not mean the research stopped. Reconnecting automatically.
        </p>
      ) : quiet ? (
        <p className="activity-warning">
          No new stage update for {Math.floor(age / 60000)} minutes. The last
          reported operation may still be running; completion time is not yet
          known.
        </p>
      ) : null}
      {progress?.updated_at && (
        <p className="activity-time">
          Last server update:{" "}
          <time dateTime={progress.updated_at}>
            {new Date(progress.updated_at).toLocaleString()}
          </time>
        </p>
      )}
      <details className="activity-details">
        <summary>View research stages and recorded activity</summary>
        <ol className="activity-roadmap" aria-label="Research plan">
          {stages.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ol>
        <h3>Recorded activity · Current execution</h3>
        {activity.length ? (
          <ul className="activity-log">
            {activity.map((step) => {
              const status = step.failed
                ? "Stopped"
                : step.started > step.completed
                  ? failed
                    ? "Interrupted"
                    : "In progress"
                  : step.completed
                    ? "Completed"
                    : "Recorded";
              return (
                <li key={`${step.phase}:${step.loop}`}>
                  <span>{phaseLabel(step.phase, step.loop)}</span>
                  <strong>{status}</strong>
                  {step.phase.endsWith("extraction_batch") && (
                    <small>
                      {step.completed} detail batches completed · {step.started}{" "}
                      started
                    </small>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>
            Detailed activity appears after the server records a research stage.
          </p>
        )}
        {progress?.message && (
          <details>
            <summary>Latest technical checkpoint</summary>
            <p>{progress.message}</p>
          </details>
        )}
      </details>
    </section>
  );
}
