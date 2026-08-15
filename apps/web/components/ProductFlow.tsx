"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

const SYNTHETIC_NOTICE = "Synthetic evaluation data — not a sourcing result";
const QUALIFIED_LIVE_NOTICE =
  "Qualified live research — external evidence is fetched and verified for this run";
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

type DemoCandidate = {
  display_name: string;
  country_code: string;
  rationale_short: string;
};

type DemoResult = {
  schema_version: "demo-projection.v1";
  run_id: string;
  outcome: "matched" | "no_responsible_match";
  scarcity: "none" | "limited" | "zero";
  candidates: DemoCandidate[];
  unmet_mandatory_constraints: string[];
  limitations_notice: string;
  projection_version: 1;
};

type Screen =
  | "loading"
  | "signed-out"
  | "intake"
  | "canonical"
  | "running"
  | "result"
  | "cancelled";

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

function assertDemoProjection(value: DemoResult): DemoResult {
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
  const [result, setResult] = useState<DemoResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RequestFailure | null>(null);
  const mainHeading = useRef<HTMLHeadingElement>(null);
  const validationSummary = useRef<HTMLDivElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const needId = useId();
  const qualifiedLive = session?.research_mode.live_qualified === true;
  const researchNotice = qualifiedLive
    ? QUALIFIED_LIVE_NOTICE
    : SYNTHETIC_NOTICE;
  const constraintsId = useId();
  const contextId = useId();

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
      mainHeading.current?.focus();
    }
  }, [screen]);

  useEffect(() => {
    if (validation.length) validationSummary.current?.focus();
  }, [validation]);

  useEffect(() => {
    if (failure) errorSummary.current?.focus();
  }, [failure]);

  useEffect(() => {
    if (screen !== "running" || !run || run.terminal) return;
    const delay = Math.max(250, Math.min(run.poll_after_ms ?? 2_000, 10_000));
    const timer = window.setTimeout(async () => {
      try {
        const next = await requestJson<RunStatus>(`/api/v1/runs/${run.run_id}`);
        setRun(next);
        if (next.result_available && next.links.result) {
          const projection = assertDemoProjection(
            await requestJson<DemoResult>(next.links.result),
          );
          setResult(projection);
          setScreen("result");
        } else if (next.terminal && next.state === "cancelled") {
          setScreen("cancelled");
        } else if (next.terminal) {
          throw new RequestFailure(
            "Research ended before a result was available.",
            null,
            true,
          );
        }
      } catch (error) {
        setFailure(
          error instanceof RequestFailure
            ? error
            : new RequestFailure(
                "Run status is temporarily unavailable.",
                null,
                true,
              ),
        );
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [run, screen]);

  const resetFailure = () => setFailure(null);

  async function submitIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: string[] = [];
    if (!source.need.trim())
      errors.push("Describe the product or capability you need.");
    if (!source.constraints.trim())
      errors.push("State at least one mandatory constraint.");
    if (!contextUnknown && !source.context.trim()) {
      errors.push("Add preferences and context, or mark this part unknown.");
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
      if (accepted.result_available && accepted.links.result) {
        setResult(
          assertDemoProjection(
            await requestJson<DemoResult>(accepted.links.result),
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
            <span>{session.display_name}</span>
            <span className="tier-badge">Demo</span>
          </div>
        ) : null}
      </header>

      <main id="main-content" className="main">
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
                <div
                  className="validation-summary"
                  role="alert"
                  tabIndex={-1}
                  ref={validationSummary}
                >
                  <h2>Correct the following</h2>
                  <ul>
                    {validation.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
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
                  aria-describedby={`${needId}-hint`}
                  value={source.need}
                  onChange={(event) =>
                    setSource({ ...source, need: event.target.value })
                  }
                />
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
                  aria-describedby={`${constraintsId}-hint`}
                  value={source.constraints}
                  onChange={(event) =>
                    setSource({ ...source, constraints: event.target.value })
                  }
                />
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
                  aria-describedby={`${contextId}-hint`}
                  value={source.context}
                  disabled={contextUnknown}
                  onChange={(event) =>
                    setSource({ ...source, context: event.target.value })
                  }
                />
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
            <p className="live-status" role="status" aria-live="polite">
              {run.phase_label}
            </p>
            {run.progress.percent_complete === null ? (
              <div
                className="indeterminate"
                role="progressbar"
                aria-label="Research progress"
              />
            ) : (
              <div>
                <progress max="100" value={run.progress.percent_complete}>
                  {run.progress.percent_complete}%
                </progress>
                <p>
                  {run.progress.steps_completed} of{" "}
                  {run.progress.steps_total_planned} verified stages complete
                </p>
              </div>
            )}
            <p>
              Keep this page open. Status refreshes automatically using the
              server-provided interval.
            </p>
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
                  ? qualifiedLive
                    ? "No candidate met every mandatory constraint in this qualified live run."
                    : "No candidate met every mandatory constraint in this synthetic evaluation."
                  : "Fewer than three candidates met every mandatory constraint. Results are not padded."}
              </div>
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
                    <h2>{candidate.display_name}</h2>
                    <p className="country">{candidate.country_code}</p>
                    <p>{candidate.rationale_short}</p>
                  </article>
                </li>
              ))}
            </ol>
            {result.unmet_mandatory_constraints.length ? (
              <div>
                <h2>Unmet mandatory constraints</h2>
                <ul>
                  {result.unmet_mandatory_constraints.map((item) => (
                    <li key={item}>{item}</li>
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
