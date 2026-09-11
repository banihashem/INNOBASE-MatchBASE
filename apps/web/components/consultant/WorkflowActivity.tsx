"use client";
import { useEffect, useState } from "react";
import { Progress } from "../ui/progress-1";
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
        ? "Your approved interpretation is saved. No research is running. A manual retry starts preparation again and may repeat paid work; automatic recovery within an active attempt retains completed topics. Your research plan still needs approval."
        : "Your saved request is retained. No research is running. Retry repeats the failed interpretation or preparation step.";
  const ready = resultReady(state);
  const awaiting =
    state.includes("awaiting_approval") ||
    state === "prep_step2_advisory_ready" ||
    state === "prep_step3_prompt_approved";
  const active =
    !failed &&
    !ready &&
    !awaiting &&
    state !== "invalidated" &&
    (busy || state !== "intake_draft");
  const preparing = state.startsWith("prep_");
  const recoveryAttempt = progress?.recovery_attempt;
  const recoveryLimit = progress?.max_recovery_attempts;
  const focusPlanning = progress?.phase === "research_focus_analysis";
  const recoveringStage =
    active &&
    (preparing || focusPlanning) &&
    Number.isInteger(recoveryAttempt) &&
    Number.isInteger(recoveryLimit) &&
    recoveryAttempt! > 1 &&
    recoveryAttempt! <= recoveryLimit! &&
    recoveryLimit! <= 3;
  const age = progress?.updated_at ? now - Date.parse(progress.updated_at) : 0;
  const quiet = active && age > 120000;
  const failure = [...activity].reverse().find((step) => step.failed > 0);
  const finishedOperations = activity.reduce(
    (sum, step) => sum + step.completed,
    0,
  );
  const pendingOperations = activity.reduce(
    (sum, step) =>
      sum + Math.max(0, step.started - step.completed - step.failed),
    0,
  );
  const runningSteps = activity.filter(
    (step) => step.started > step.completed + step.failed,
  );
  const heading = pdfBusy
    ? "Preparing your PDF download"
    : failed
      ? stoppedByUser
        ? "Stopped by you"
        : failureLabel
      : awaiting
        ? workflowLabel(state)
        : ready
          ? "Your research results are ready"
          : runningSteps.length > 1
            ? preparing
              ? "Preparing and checking your request"
              : "Research steps are running in parallel"
            : phaseLabel(
                runningSteps[0]?.phase ||
                  progress?.phase ||
                  (busy ? "interpretation" : "queued"),
                runningSteps[0]?.loop ?? progress?.loop,
              );
  const stages = [
    "Your request",
    "English interpretation · Your approval",
    "Advisory research · 3 topics",
    "Research plan · Your approval",
    "Supplier discovery across independent research sources",
    "Evidence review · one approved round at a time",
    "Ranked results and supplier details",
    "PDF download",
  ];
  const recordedActivity = (
    <div className="activity-recorded" aria-label="Recorded execution activity">
      <h3>Current work and completed steps</h3>
      {activity.length > 0 && (
        <p className="activity-counts">
          {finishedOperations} operation(s) completed
          {active && !connectionError && pendingOperations > 0
            ? ` · ${pendingOperations} in progress`
            : ""}
          {failed ? " · Execution stopped" : ""}
        </p>
      )}
      {activity.length ? (
        <ul className="activity-log">
          {activity.map((step) => {
            const pending = step.started > step.completed + step.failed;
            const status = pending
              ? failed || ready || awaiting || state === "invalidated"
                ? "Interrupted"
                : connectionError
                  ? "Last recorded: in progress"
                  : step.failed
                    ? "Retry in progress"
                    : "In progress"
              : step.failed
                ? failed
                  ? "Stopped"
                  : step.completed
                    ? "Completed with recovered or incomplete attempts"
                    : active
                      ? "Recovery in progress"
                      : "Incomplete"
                : step.completed
                  ? "Completed"
                  : "Recorded";
            return (
              <li key={`${step.phase}:${step.loop}`} data-status={status}>
                <span className="activity-operation-name">
                  <span className="activity-operation-icon" aria-hidden="true">
                    {status === "Completed"
                      ? "✓"
                      : status === "Stopped" || status === "Interrupted"
                        ? "!"
                        : "·"}
                  </span>
                  {phaseLabel(step.phase, step.loop)}
                </span>
                <strong className="activity-operation-status">{status}</strong>
                {(step.completed > 0 || step.started > 1) && (
                  <small>
                    {step.completed} completed · {step.started} started
                    {step.failed > 0 ? ` · ${step.failed} stopped` : ""}
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
    </div>
  );
  return (
    <section className="workflow-activity" aria-label="Research activity">
      <div>
        <p
          className="sr-only"
          role="status"
          aria-label="Workflow progress"
          aria-live="polite"
        >
          {heading}
        </p>
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
        {!connectionError && (active || ready || pdfBusy) && (
          <div className="activity-progress">
            <div className="activity-progress-caption">
              <span>
                {pdfBusy
                  ? "Preparing download"
                  : ready
                    ? "Result saved"
                    : preparing
                      ? "Preparation in progress"
                      : "Research in progress"}
              </span>
              <span>
                {ready && !pdfBusy ? "100%" : "Completion time not yet known"}
              </span>
            </div>
            <Progress
              aria-label={pdfBusy ? "PDF preparation" : "Execution progress"}
              aria-valuetext={
                ready && !pdfBusy
                  ? "Result saved"
                  : "In progress; completion percentage is not yet known"
              }
              value={ready && !pdfBusy ? 100 : null}
            />
            {!ready && !pdfBusy && (
              <p className="activity-progress-note">
                Completed operations and current work appear below as updates
                arrive.
              </p>
            )}
          </div>
        )}
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
                  ? "Review the available supplier and price findings, including any gaps. Download the report from the results section."
                  : initialInterpretation
                    ? "Your saved request is being interpreted in English. Keep this page open until the interpretation is ready for review."
                    : "The server is processing your saved request. You can leave this page and return from Dashboard; reopening it does not start another research execution."}
        </p>
        {active && !connectionError && progress?.message && (
          <p
            className="activity-current-operation"
            aria-label="Current operation"
          >
            {phaseLabel(progress.phase || "queued", progress.loop)}
          </p>
        )}
        {recoveringStage && !connectionError && (
          <p className="activity-current-operation" role="status">
            {preparing ? "Automatic recovery" : "Focus analysis recovery"} ·
            Attempt {recoveryAttempt} of {recoveryLimit}.{" "}
            {preparing
              ? "Completed topics are retained. Each model call may be charged and is recorded in your costs."
              : "Previous round results and selected leads are retained. This attempt counts toward the approved round allowance and recorded costs."}
          </p>
        )}
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
              {preparing ? "Preparation topic" : "Research step"}{" "}
              {progress.loop}
              {progress.max_loops ? ` of up to ${progress.max_loops}` : ""}
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
          Last update:{" "}
          <time dateTime={progress.updated_at}>
            {new Date(progress.updated_at).toLocaleString()}
          </time>
        </p>
      )}
      {ready ? (
        <details className="activity-details activity-completed-history">
          <summary>View completed research steps</summary>
          {recordedActivity}
        </details>
      ) : (
        recordedActivity
      )}
      <details className="activity-details">
        <summary>Research roadmap and support details</summary>
        <ol className="activity-roadmap" aria-label="Research plan">
          {stages.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ol>
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
