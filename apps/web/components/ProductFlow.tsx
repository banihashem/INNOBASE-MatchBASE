"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { DemoProjectionV1 } from "@matchbase/contracts";

const SYNTHETIC_NOTICE = "Synthetic evaluation data — not a sourcing result";
const QUALIFIED_LIVE_NOTICE =
  "Qualified live research — external evidence is fetched and verified for this run";
const NEED_REQUIRED = "Describe the product or capability you need.";
const CONSTRAINTS_REQUIRED = "State at least one mandatory constraint.";
const CONTEXT_REQUIRED =
  "Add preferences and context, or mark this part unknown.";
const PROHIBITED_RESULT_KEYS = new Set([
  "score",
  "compatibility_score",
  "band",
  "citations",
  "verification_status",
  "evidence_count",
  "hidden_count",
  "reserve_candidates",
  "pdf",
  "export",
]);

type Session = {
  display_name: string;
  tier: "demo";
  quota: {
    limit: number;
    used: number;
    remaining: number;
    next_capacity_at: string | null;
  };
  execution: { active: number; capacity: number };
  research_mode: {
    id: "synthetic_reference" | "qualified_live_research";
    label: "Synthetic reference" | "Qualified live research";
    live_qualified: boolean;
  };
  csrf_token: string;
  environment: "local" | "test";
};

type CanonicalField = {
  fieldId?: string;
  field_id?: string;
  path: string;
  canonicalValue?: string;
  canonical_value?: string;
  languageOrigin?: string;
  language_origin?: string;
};

type CanonicalResponse = {
  request_id: string;
  canonical_version_id: string;
  version: number;
  canonical_language: "en";
  canonical_text: string;
  source_language_tag: string;
  source_language_confidence: number;
  fields: CanonicalField[];
  match_readiness: "ready" | "partially_ready" | "not_ready";
  contradictions: string[];
};

type RunStatus = {
  run_id: string;
  state: string;
  phase_label: string;
  terminal: boolean;
  result_available: boolean;
  poll_after_ms: number | null;
  progress: {
    steps_completed: number;
    steps_total_planned: number;
    percent_complete: number | null;
  };
  links: { result: string | null; cancel: string };
};

type Screen =
  | "loading"
  | "signed-out"
  | "intake"
  | "canonical"
  | "running"
  | "result"
  | "cancelled"
  | "failed";

class RequestFailure extends Error {
  constructor(
    message: string,
    readonly correlationId: string | null,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  csrfToken?: string,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const error = (body.error ?? body) as Record<string, unknown>;
    throw new RequestFailure(
      typeof error.detail === "string"
        ? error.detail
        : "The request could not be completed.",
      typeof error.correlation_id === "string" ? error.correlation_id : null,
      error.retryable === true,
    );
  }
  return (body.data ?? body) as T;
}

function assertDemoProjection(value: DemoProjectionV1): DemoProjectionV1 {
  const scan = (subject: unknown): void => {
    if (Array.isArray(subject)) {
      subject.forEach(scan);
      return;
    }
    if (!subject || typeof subject !== "object") return;
    for (const [key, nested] of Object.entries(subject)) {
      if (PROHIBITED_RESULT_KEYS.has(key.toLowerCase())) {
        throw new RequestFailure(
          "The result disclosure failed its safety check.",
          null,
          false,
        );
      }
      scan(nested);
    }
  };
  scan(value);
  if (value.candidates.length > 3) {
    throw new RequestFailure(
      "The result disclosure exceeded the Demo limit.",
      null,
      false,
    );
  }
  return value;
}

function formatUtc(value: string | null): string {
  if (!value) return "Capacity is available now";
  return (
    new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value)) + " UTC"
  );
}

export function ProductFlow({
  initialSession,
  authPath = "/auth/google/start",
}: Readonly<{ initialSession?: Session | null; authPath?: string }>) {
  const [screen, setScreen] = useState<Screen>(
    initialSession === undefined
      ? "loading"
      : initialSession
        ? "intake"
        : "signed-out",
  );
  const [session, setSession] = useState<Session | null>(
    initialSession ?? null,
  );
  const [source, setSource] = useState({
    need: "",
    constraints: "",
    context: "",
  });
  const [contextUnknown, setContextUnknown] = useState(false);
  const [validation, setValidation] = useState<string[]>([]);
  const [canonical, setCanonical] = useState<CanonicalResponse | null>(null);
  const [canonicalText, setCanonicalText] = useState("");
  const [run, setRun] = useState<RunStatus | null>(null);
  const [result, setResult] = useState<DemoProjectionV1 | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RequestFailure | null>(null);
  const [runUpdateError, setRunUpdateError] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [updatesPaused, setUpdatesPaused] = useState(false);
  const [runAnnouncement, setRunAnnouncement] = useState("");
  const mainHeading = useRef<HTMLHeadingElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const needInput = useRef<HTMLTextAreaElement>(null);
  const constraintsInput = useRef<HTMLTextAreaElement>(null);
  const contextInput = useRef<HTMLTextAreaElement>(null);
  const lastAnnouncedState = useRef<string | null>(null);
  const suppressNextScreenFocus = useRef(true);
  const suppressFailureFocus = useRef(false);
  const pollGeneration = useRef(0);
  const needId = useId();
  const qualifiedLive = session?.research_mode.live_qualified === true;
  const researchNotice = qualifiedLive
    ? QUALIFIED_LIVE_NOTICE
    : SYNTHETIC_NOTICE;
  const constraintsId = useId();
  const contextId = useId();
  const needInvalid = validation.includes(NEED_REQUIRED);
  const constraintsInvalid = validation.includes(CONSTRAINTS_REQUIRED);
  const contextInvalid =
    validation.includes(CONTEXT_REQUIRED) && !contextUnknown;

  useEffect(() => {
    if (initialSession !== undefined) return;
    requestJson<Session>("/api/v1/me")
      .then((me) => {
        setSession(me);
        setScreen("intake");
      })
      .catch(() => setScreen("signed-out"));
  }, [initialSession]);

  useEffect(() => {
    if (screen !== "loading" && screen !== "signed-out") {
      if (suppressNextScreenFocus.current) {
        suppressNextScreenFocus.current = false;
        return;
      }
      mainHeading.current?.focus();
    }
  }, [screen]);

  useEffect(() => {
    if (needInvalid) needInput.current?.focus();
    else if (constraintsInvalid) constraintsInput.current?.focus();
    else if (contextInvalid) contextInput.current?.focus();
  }, [constraintsInvalid, contextInvalid, needInvalid]);

  useEffect(() => {
    if (!failure) return;
    if (suppressFailureFocus.current) {
      suppressFailureFocus.current = false;
      return;
    }
    errorSummary.current?.focus();
  }, [failure]);

  const refreshRunStatus = useCallback(
    async (
      currentRun: RunStatus,
      announceWhilePaused = false,
      expectedGeneration = pollGeneration.current,
    ) => {
      let next: RunStatus;
      try {
        next = await requestJson<RunStatus>(
          `/api/v1/runs/${currentRun.run_id}`,
        );
        if (expectedGeneration !== pollGeneration.current) return;
        setRunUpdateError(null);
      } catch {
        if (expectedGeneration !== pollGeneration.current) return;
        const message = "Status updates are unavailable. Retrying.";
        setRunUpdateError(message);
        setRunAnnouncement(message);
        setPollAttempt((attempt) => attempt + 1);
        return;
      }
      setRun(next);
      if (
        announceWhilePaused &&
        lastAnnouncedState.current !== next.state &&
        !next.terminal
      ) {
        lastAnnouncedState.current = next.state;
        setRunAnnouncement(
          `${next.phase_label}. Stage ${next.progress.steps_completed} of ${next.progress.steps_total_planned}.`,
        );
      }
      try {
        if (next.result_available && next.links.result) {
          const projection = assertDemoProjection(
            await requestJson<DemoProjectionV1>(next.links.result),
          );
          if (expectedGeneration !== pollGeneration.current) return;
          lastAnnouncedState.current = next.state;
          setRunAnnouncement(
            projection.candidates.length === 0
              ? "Research complete. No candidate met the mandatory constraints."
              : `Research complete. ${projection.candidates.length} eligible ${projection.candidates.length === 1 ? "candidate" : "candidates"}.`,
          );
          setResult(projection);
          const activeElement = document.activeElement;
          suppressNextScreenFocus.current =
            activeElement instanceof HTMLElement &&
            activeElement !== document.body &&
            activeElement.closest("main") === null;
          setScreen("result");
        } else if (next.terminal && next.state === "cancelled") {
          lastAnnouncedState.current = next.state;
          setRunAnnouncement("Research cancelled.");
          suppressNextScreenFocus.current = true;
          setScreen("cancelled");
        } else if (next.terminal) {
          suppressFailureFocus.current = true;
          suppressNextScreenFocus.current = true;
          setFailure(
            new RequestFailure(
              "Research ended before a result was available.",
              null,
              true,
            ),
          );
          setScreen("failed");
        }
      } catch (error) {
        suppressFailureFocus.current = true;
        suppressNextScreenFocus.current = true;
        setFailure(
          error instanceof RequestFailure
            ? error
            : new RequestFailure(
                "Run status is temporarily unavailable.",
                null,
                true,
              ),
        );
        setScreen("failed");
      }
    },
    [],
  );

  useEffect(() => {
    if (screen !== "running" || !run || run.terminal || updatesPaused) return;
    const expectedGeneration = pollGeneration.current;
    const delay = Math.max(250, Math.min(run.poll_after_ms ?? 2_000, 10_000));
    const timer = window.setTimeout(
      () => void refreshRunStatus(run, false, expectedGeneration),
      delay,
    );
    return () => window.clearTimeout(timer);
  }, [pollAttempt, refreshRunStatus, run, screen, updatesPaused]);

  useEffect(() => {
    if (
      screen !== "running" ||
      !run ||
      updatesPaused ||
      lastAnnouncedState.current === run.state
    )
      return;
    lastAnnouncedState.current = run.state;
    const timer = window.setTimeout(() => {
      setRunAnnouncement(
        `${run.phase_label}. Stage ${run.progress.steps_completed} of ${run.progress.steps_total_planned}.`,
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [run, screen, updatesPaused]);

  const resetFailure = () => setFailure(null);

  async function submitIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: string[] = [];
    if (!source.need.trim()) errors.push(NEED_REQUIRED);
    if (!source.constraints.trim()) errors.push(CONSTRAINTS_REQUIRED);
    if (!contextUnknown && !source.context.trim()) {
      errors.push(CONTEXT_REQUIRED);
    }
    setValidation(errors);
    if (errors.length || !session) return;
    setBusy(true);
    resetFailure();
    try {
      const response = await requestJson<CanonicalResponse>(
        "/api/v1/requests",
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            source_text: [
              source.need,
              source.constraints,
              contextUnknown ? "" : source.context,
            ]
              .filter(Boolean)
              .join("\n\n"),
            presented_fields: [
              "need",
              "mandatory_constraints",
              "preferences_context",
            ],
            unknown_fields: contextUnknown ? ["preferences_context"] : [],
          }),
        },
        session.csrf_token,
      );
      setCanonical(response);
      setCanonicalText(response.canonical_text);
      setSource({ need: "", constraints: "", context: "" });
      setScreen("canonical");
    } catch (error) {
      setFailure(
        error instanceof RequestFailure
          ? error
          : new RequestFailure(
              "Canonicalization is temporarily unavailable.",
              null,
              true,
            ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function resolveContradictions() {
    if (!canonical || !session || !canonicalText.trim()) return;
    setBusy(true);
    resetFailure();
    try {
      const revised = await requestJson<CanonicalResponse>(
        `/api/v1/requests/${canonical.request_id}/versions`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            canonical_text: canonicalText,
            fields: canonical.fields,
            readiness: "ready",
          }),
        },
        session.csrf_token,
      );
      setCanonical(revised);
      setCanonicalText(revised.canonical_text);
    } catch (error) {
      setFailure(error as RequestFailure);
    } finally {
      setBusy(false);
    }
  }

  async function confirmAndRun() {
    if (!canonical || !session) return;
    if (canonical.contradictions.length) {
      setValidation(["Resolve every contradiction before starting research."]);
      return;
    }
    setBusy(true);
    resetFailure();
    try {
      await requestJson(
        `/api/v1/requests/${canonical.request_id}/versions/${canonical.version}/confirmation`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ accepted: true }),
        },
        session.csrf_token,
      );
      const accepted = await requestJson<RunStatus>(
        "/api/v1/runs",
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            request_id: canonical.request_id,
            version: canonical.version,
          }),
        },
        session.csrf_token,
      );
      setRun(accepted);
      pollGeneration.current += 1;
      setUpdatesPaused(false);
      setRunAnnouncement("");
      lastAnnouncedState.current = null;
      if (accepted.result_available && accepted.links.result) {
        setResult(
          assertDemoProjection(
            await requestJson<DemoProjectionV1>(accepted.links.result),
          ),
        );
        setScreen("result");
      } else {
        setScreen("running");
      }
    } catch (error) {
      setFailure(error as RequestFailure);
    } finally {
      setBusy(false);
    }
  }

  async function cancelRun() {
    if (!run || !session) return;
    setBusy(true);
    resetFailure();
    try {
      await requestJson(
        run.links.cancel,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
        session.csrf_token,
      );
      setRun({ ...run, state: "cancelled", terminal: true });
      setScreen("cancelled");
    } catch (error) {
      setFailure(error as RequestFailure);
    } finally {
      setBusy(false);
    }
  }

  function handleEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && failure) resetFailure();
  }

  return (
    <div className="app-shell" onKeyDown={handleEscape}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside
        className={
          qualifiedLive
            ? "synthetic-banner qualified-live-banner"
            : "synthetic-banner"
        }
        aria-label="Research mode notice"
      >
        <span aria-hidden="true">◆</span>{" "}
        <strong>{session?.research_mode.label ?? "Synthetic reference"}</strong>
        <span aria-hidden="true"> · </span>
        {researchNotice}
      </aside>
      <header className="site-header">
        <a className="brand" href="/" aria-label="MatchBASE home">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span>MatchBASE</span>
        </a>
        {session ? (
          <div className="identity">
            <span>
              <bdi dir="auto">{session.display_name}</bdi>
            </span>
            <span className="tier-badge">Demo</span>
          </div>
        ) : null}
      </header>

      <main id="main-content" className="main">
        <p
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {runAnnouncement}
        </p>
        {failure ? (
          <div
            className="error-summary"
            role="alert"
            tabIndex={-1}
            ref={errorSummary}
          >
            <strong>Action could not be completed</strong>
            <p>{failure.message}</p>
            {failure.correlationId ? (
              <p>Reference: {failure.correlationId}</p>
            ) : null}
            {failure.retryable ? (
              <p>Your input remains in this browser. Retry when ready.</p>
            ) : null}
            <button
              type="button"
              className="text-button"
              onClick={resetFailure}
            >
              Dismiss error
            </button>
          </div>
        ) : null}

        {screen === "loading" ? (
          <section className="center-panel" aria-labelledby="loading-title">
            <h1 id="loading-title" ref={mainHeading} tabIndex={-1}>
              Checking workspace access
            </h1>
            <p role="status">Loading your local Demo session…</p>
          </section>
        ) : null}

        {screen === "signed-out" ? (
          <section className="landing" aria-labelledby="landing-title">
            <div>
              <p className="eyebrow">Authenticated Demo reference path</p>
              <h1 id="landing-title" ref={mainHeading} tabIndex={-1}>
                Define an industrial sourcing need with evidence-shaped
                discipline.
              </h1>
              <p className="lede">
                Structure a multilingual request, confirm its English canonical
                form, and inspect up to three eligible{" "}
                {qualifiedLive ? "source-verified" : "synthetic"} candidates.
              </p>
              <a className="primary-action" href={authPath}>
                Continue with Google
              </a>
              <p className="environment-disclosure">
                {qualifiedLive
                  ? "Test identity only. Research mode is assigned by server policy."
                  : "Local/test simulator. This is not live Google authentication or live supplier research."}
              </p>
            </div>
            <aside className="principles" aria-label="Demo boundaries">
              <h2>What this path proves</h2>
              <ul>
                <li>Original-language text stays transient.</li>
                <li>You confirm the English canonical request.</li>
                <li>Mandatory constraints are applied before ranking.</li>
                <li>Demo disclosure is limited server-side.</li>
              </ul>
            </aside>
          </section>
        ) : null}

        {screen === "intake" && session ? (
          <>
            <section
              className="workspace-summary"
              aria-labelledby="workspace-title"
            >
              <div>
                <p className="eyebrow">Demo workspace</p>
                <h1 id="workspace-title" ref={mainHeading} tabIndex={-1}>
                  Frame the request
                </h1>
              </div>
              <dl className="workspace-metrics">
                <div>
                  <dt>Tier</dt>
                  <dd>Demo</dd>
                </div>
                <div>
                  <dt>Runs remaining</dt>
                  <dd>
                    {session.quota.remaining} of {session.quota.limit}
                  </dd>
                </div>
                <div>
                  <dt>Next capacity</dt>
                  <dd>{formatUtc(session.quota.next_capacity_at)}</dd>
                </div>
                <div>
                  <dt>Active capacity</dt>
                  <dd>
                    {session.execution.active} of {session.execution.capacity}
                  </dd>
                </div>
              </dl>
            </section>
            <div className="stepper" aria-label="Request progress">
              <span aria-current="step">1 Intake</span>
              <span>2 Confirm</span>
              <span>3 Research</span>
            </div>
            <form className="intake-form" onSubmit={submitIntake} noValidate>
              <div className="form-intro">
                <h2>Three-part intake</h2>
                <p>
                  Write in any language. Source text is held only in this
                  browser until canonicalization succeeds.
                </p>
              </div>
              {validation.length ? (
                <div className="validation-summary" role="alert">
                  <h2>Correct the following</h2>
                  <ul>
                    {validation.map((item) => {
                      const target =
                        item === NEED_REQUIRED
                          ? needId
                          : item === CONSTRAINTS_REQUIRED
                            ? constraintsId
                            : contextId;
                      return (
                        <li key={item}>
                          <a href={`#${target}`}>{item}</a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              <fieldset>
                <legend>
                  <span>01</span> Product or capability need
                </legend>
                <label htmlFor={needId}>What must be sourced?</label>
                <p id={`${needId}-hint`} className="field-hint">
                  Include function, application, and essential technical
                  context.
                </p>
                <textarea
                  id={needId}
                  ref={needInput}
                  aria-invalid={needInvalid}
                  aria-describedby={`${needId}-hint${needInvalid ? ` ${needId}-error` : ""}`}
                  value={source.need}
                  onChange={(event) =>
                    setSource({ ...source, need: event.target.value })
                  }
                />
                {needInvalid ? (
                  <p id={`${needId}-error`} className="field-error">
                    {NEED_REQUIRED}
                  </p>
                ) : null}
              </fieldset>
              <fieldset>
                <legend>
                  <span>02</span> Mandatory constraints
                </legend>
                <label htmlFor={constraintsId}>
                  What conditions cannot be compromised?
                </label>
                <p id={`${constraintsId}-hint`} className="field-hint">
                  State geography, certification, capacity, timing, or technical
                  limits.
                </p>
                <textarea
                  id={constraintsId}
                  ref={constraintsInput}
                  aria-invalid={constraintsInvalid}
                  aria-describedby={`${constraintsId}-hint${constraintsInvalid ? ` ${constraintsId}-error` : ""}`}
                  value={source.constraints}
                  onChange={(event) =>
                    setSource({ ...source, constraints: event.target.value })
                  }
                />
                {constraintsInvalid ? (
                  <p id={`${constraintsId}-error`} className="field-error">
                    {CONSTRAINTS_REQUIRED}
                  </p>
                ) : null}
              </fieldset>
              <fieldset>
                <legend>
                  <span>03</span> Preferences and context
                </legend>
                <label htmlFor={contextId}>What would improve the fit?</label>
                <p id={`${contextId}-hint`} className="field-hint">
                  Keep preferences separate from mandatory constraints.
                </p>
                <textarea
                  id={contextId}
                  ref={contextInput}
                  aria-invalid={contextInvalid}
                  aria-describedby={`${contextId}-hint${contextInvalid ? ` ${contextId}-error` : ""}`}
                  value={source.context}
                  disabled={contextUnknown}
                  onChange={(event) =>
                    setSource({ ...source, context: event.target.value })
                  }
                />
                {contextInvalid ? (
                  <p id={`${contextId}-error`} className="field-error">
                    {CONTEXT_REQUIRED}
                  </p>
                ) : null}
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={contextUnknown}
                    onChange={(event) =>
                      setContextUnknown(event.target.checked)
                    }
                  />
                  This information is unknown or not applicable
                </label>
              </fieldset>
              <div className="form-actions">
                <p>No file uploads are accepted in this Demo.</p>
                <button
                  className="primary-action"
                  type="submit"
                  disabled={busy}
                >
                  {busy
                    ? "Creating English canonical form…"
                    : "Continue to English confirmation"}
                </button>
              </div>
            </form>
          </>
        ) : null}

        {screen === "canonical" && canonical ? (
          <section className="workflow-panel" aria-labelledby="canonical-title">
            <div className="stepper" aria-label="Request progress">
              <span>1 Intake</span>
              <span aria-current="step">2 Confirm</span>
              <span>3 Research</span>
            </div>
            <p className="eyebrow">
              English canonical request · Version {canonical.version}
            </p>
            <h1 id="canonical-title" ref={mainHeading} tabIndex={-1}>
              Confirm the normalized request
            </h1>
            <p>
              Detected language:{" "}
              <strong>{canonical.source_language_tag}</strong> (
              {Math.round(canonical.source_language_confidence * 100)}%
              confidence). The original source text is no longer held after this
              successful conversion.
            </p>
            {canonical.contradictions.length ? (
              <div className="contradiction" role="alert">
                <h2>Contradictions block research</h2>
                <p>
                  Correct the English canonical text, then create a new
                  immutable version.
                </p>
                <ul>
                  {canonical.contradictions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <label htmlFor="canonical-text">English canonical form</label>
            <textarea
              id="canonical-text"
              className="canonical-editor"
              value={canonicalText}
              onChange={(event) => setCanonicalText(event.target.value)}
            />
            <h2>Structured fields</h2>
            <div className="field-list">
              {canonical.fields.map((field) => (
                <article key={field.fieldId ?? field.field_id ?? field.path}>
                  <h3>{field.path}</h3>
                  <p>{field.canonicalValue ?? field.canonical_value}</p>
                  {(field.languageOrigin ?? field.language_origin) ===
                  "translated" ? (
                    <span className="origin-badge">Translated</span>
                  ) : null}
                </article>
              ))}
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={() => setScreen("intake")}
              >
                Return to intake
              </button>
              {canonical.contradictions.length ? (
                <button
                  type="button"
                  className="primary-action"
                  disabled={busy || !canonicalText.trim()}
                  onClick={resolveContradictions}
                >
                  Create corrected version
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-action"
                  disabled={busy}
                  onClick={confirmAndRun}
                >
                  {qualifiedLive
                    ? "Confirm and start qualified live research"
                    : "Confirm and start research"}
                </button>
              )}
            </div>
          </section>
        ) : null}

        {screen === "running" && run ? (
          <section
            className="workflow-panel status-panel"
            aria-labelledby="status-title"
          >
            <div className="stepper" aria-label="Request progress">
              <span>1 Intake</span>
              <span>2 Confirm</span>
              <span aria-current="step">3 Research</span>
            </div>
            <p className="eyebrow">
              {session?.research_mode.label ?? "Research"} · Run {run.run_id}
            </p>
            <h1 id="status-title" ref={mainHeading} tabIndex={-1}>
              Research in progress
            </h1>
            <p className="live-status">{runUpdateError ?? run.phase_label}</p>
            {run.progress.percent_complete === null ? (
              <div
                className="indeterminate"
                role="progressbar"
                aria-label="Research progress"
              />
            ) : (
              <div>
                <progress
                  max="100"
                  value={run.progress.percent_complete}
                  aria-label="Research progress"
                >
                  {run.progress.percent_complete}%
                </progress>
                <p>
                  {run.progress.steps_completed} of{" "}
                  {run.progress.steps_total_planned} verified stages complete
                </p>
              </div>
            )}
            <p>
              You can close this page. Research continues and your result will
              be here when you return.
            </p>
            <button
              type="button"
              className="secondary-action"
              aria-pressed={updatesPaused}
              onClick={() =>
                setUpdatesPaused((paused) => {
                  if (!paused) pollGeneration.current += 1;
                  return !paused;
                })
              }
            >
              {updatesPaused ? "Resume updates" : "Pause updates"}
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                const expectedGeneration = pollGeneration.current;
                void refreshRunStatus(run, true, expectedGeneration).finally(
                  () => setBusy(false),
                );
              }}
            >
              Refresh now
            </button>
            <button
              type="button"
              className="danger-action"
              disabled={busy}
              onClick={cancelRun}
            >
              Cancel research
            </button>
          </section>
        ) : null}

        {screen === "cancelled" ? (
          <section className="workflow-panel" aria-labelledby="cancelled-title">
            <p className="eyebrow">Run closed</p>
            <h1 id="cancelled-title" ref={mainHeading} tabIndex={-1}>
              Research cancelled
            </h1>
            <p role="status">
              No result was disclosed. You can revise the request before
              starting another chargeable run.
            </p>
            <button
              type="button"
              className="primary-action"
              onClick={() => setScreen("intake")}
            >
              Return to workspace
            </button>
          </section>
        ) : null}

        {screen === "failed" ? (
          <section className="workflow-panel" aria-labelledby="failed-title">
            <p className="eyebrow">Run closed</p>
            <h1 id="failed-title" ref={mainHeading} tabIndex={-1}>
              Research failed
            </h1>
            <p>No result was disclosed.</p>
            <button
              type="button"
              className="primary-action"
              onClick={() => {
                resetFailure();
                setScreen("intake");
              }}
            >
              Return to workspace
            </button>
          </section>
        ) : null}

        {screen === "result" && result ? (
          <section
            className="workflow-panel results"
            aria-labelledby="results-title"
          >
            <p className="eyebrow">
              {qualifiedLive ? "Qualified live result" : "Demo result"} · Demo
              projection v{result.projection_version}
            </p>
            <h1 id="results-title" ref={mainHeading} tabIndex={-1}>
              {result.outcome === "no_responsible_match"
                ? "No responsible match"
                : "Eligible candidate summary"}
            </h1>
            {result.scarcity !== "none" ? (
              <div className="scarcity-note" role="status">
                {result.scarcity === "zero"
                  ? "No candidate met the mandatory constraints for this request."
                  : `${result.candidates.length} ${result.candidates.length === 1 ? "candidate" : "candidates"} met all mandatory constraints. Fewer than three met them, so fewer than three are shown.`}
              </div>
            ) : null}
            {result.outcome === "no_responsible_match" ? (
              <p className="lede">
                Qualified research completed. This is a responsible no-match
                result, not a processing failure. Demo does not disclose
                suppliers that failed a mandatory constraint.
              </p>
            ) : null}
            <ol className="candidate-grid">
              {result.candidates.map((candidate) => (
                <li key={`${candidate.display_name}-${candidate.country_code}`}>
                  <article>
                    <span className="rank" aria-hidden="true">
                      {String(
                        result.candidates.indexOf(candidate) + 1,
                      ).padStart(2, "0")}
                    </span>
                    <h2>
                      <bdi dir="auto">{candidate.display_name}</bdi>
                    </h2>
                    <p className="country">{candidate.country_code}</p>
                    <p>
                      <bdi dir="auto">{candidate.rationale_short}</bdi>
                    </p>
                  </article>
                </li>
              ))}
            </ol>
            {result.unmet_mandatory_constraints.length ? (
              <div>
                <h2>Unmet mandatory constraints</h2>
                <ul>
                  {result.unmet_mandatory_constraints.map((item) => (
                    <li key={item}>
                      <bdi dir="auto">{item}</bdi>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="limitations">{result.limitations_notice}</p>
            <button
              type="button"
              className="primary-action"
              onClick={() => setScreen("intake")}
            >
              Start a new request
            </button>
          </section>
        ) : null}
      </main>
      <footer>
        <span>Local reference environment</span>
        <span>
          {qualifiedLive
            ? "Demo disclosure · Qualified live evidence path"
            : "Demo disclosure · No live provider calls"}
        </span>
      </footer>
    </div>
  );
}

export { SYNTHETIC_NOTICE };
