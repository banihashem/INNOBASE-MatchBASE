"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./AdminEntitlementManager.module.css";

const TIERS = ["demo", "standard", "consultant", "admin"] as const;
const ADMIN_SUB_ROLES = [
  "support",
  "analyst",
  "consultant_manager",
  "product",
  "security_audit",
  "super_admin",
] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type Action = "grant" | "revoke";
type EntitlementKind = "tier" | "admin_sub_role";

interface SessionProjection {
  readonly tier?: unknown;
  readonly admin_sub_roles?: unknown;
  readonly csrf_token?: unknown;
}

interface Draft {
  readonly action: Action;
  readonly subject_user_id: string;
  readonly entitlement_kind: EntitlementKind;
  readonly entitlement_value: string;
  readonly justification: string;
  readonly expires_at: string;
}

interface Snapshot {
  readonly tier: string | null;
  readonly admin_sub_roles: readonly string[];
  readonly tier_expires_at?: string | null;
}

interface MutationResult {
  readonly action: Action;
  readonly subject_user_id: string;
  readonly entitlement_kind: EntitlementKind;
  readonly entitlement_value: string;
  readonly expires_at: string | null;
  readonly changed: boolean;
  readonly before: Snapshot;
  readonly after: Snapshot;
  readonly audit_id: string;
}

interface EntitlementHistoryItem {
  readonly kind: string;
  readonly value: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly revoked_at: string | null;
  readonly grant_actor_kind: "system" | "user";
  readonly granted_by: string | null;
  readonly revoked_by: string | null;
  readonly justification: string;
}

interface EntitlementReadResult {
  readonly subject_user_id: string;
  readonly current: Snapshot;
  readonly history: readonly EntitlementHistoryItem[];
}

type FieldErrors = Partial<Record<keyof Draft, string>>;

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
  timeZoneName: "short",
});

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.valueOf())
    ? "Timestamp unavailable"
    : TIMESTAMP_FORMATTER.format(timestamp);
}

function isRfc3339(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(
      value,
    );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= new Date(Date.UTC(year, month, 0)).getUTCDate() &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly correlationId: string | null,
  ) {
    super(message);
  }
}

async function jsonRequest<T>(
  url: string,
  init: RequestInit = {},
  forbiddenMessage = "The server refused this entitlement change.",
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: { detail?: string; correlation_id?: string };
  };
  if (!response.ok) {
    throw new RequestError(
      response.status === 403
        ? forbiddenMessage
        : (body.error?.detail ??
            "The entitlement request could not be completed."),
      body.error?.correlation_id ?? response.headers.get("MB-Correlation-Id"),
    );
  }
  return body;
}

function initialDraft(): Draft {
  return {
    action: "grant",
    subject_user_id: "",
    entitlement_kind: "tier",
    entitlement_value: "demo",
    justification: "",
    expires_at: "",
  };
}

function validateDraft(draft: Draft): FieldErrors {
  const errors: FieldErrors = {};
  if (!UUID_PATTERN.test(draft.subject_user_id)) {
    errors.subject_user_id = "Enter a valid subject user UUID.";
  }
  const values = draft.entitlement_kind === "tier" ? TIERS : ADMIN_SUB_ROLES;
  if (!values.some((value) => value === draft.entitlement_value)) {
    errors.entitlement_value = "Select an allowed entitlement value.";
  }
  if (
    draft.justification.length === 0 ||
    draft.justification !== draft.justification.trim() ||
    draft.justification.length > 2_000 ||
    [...draft.justification].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    errors.justification =
      "Enter 1–2,000 characters without leading, trailing, or control characters.";
  }
  if (
    draft.action === "grant" &&
    draft.entitlement_kind === "tier" &&
    draft.entitlement_value === "consultant"
  ) {
    const expiry = new Date(draft.expires_at);
    if (
      !isRfc3339(draft.expires_at) ||
      Number.isNaN(expiry.valueOf()) ||
      expiry.valueOf() <= Date.now()
    ) {
      errors.expires_at =
        "Enter a valid RFC3339 timestamp later than the current time.";
    }
  }
  return errors;
}

function SnapshotDetails({ snapshot }: { readonly snapshot: Snapshot }) {
  return (
    <dl className={styles.snapshot}>
      <dt>Tier</dt>
      <dd>{snapshot.tier ?? "None"}</dd>
      <dt>Admin sub-roles</dt>
      <dd>
        {snapshot.admin_sub_roles.length > 0
          ? snapshot.admin_sub_roles.join(", ")
          : "None"}
      </dd>
      <dt>Tier expiry</dt>
      <dd>
        {snapshot.tier_expires_at ? (
          <time dateTime={snapshot.tier_expires_at}>
            {formatTimestamp(snapshot.tier_expires_at)}
          </time>
        ) : (
          "No expiry"
        )}
      </dd>
    </dl>
  );
}

function EntitlementHistory({
  result,
}: {
  readonly result: EntitlementReadResult;
}) {
  return (
    <section aria-labelledby="entitlement-current-title">
      <h3 id="entitlement-current-title">Current stored entitlements</h3>
      <SnapshotDetails snapshot={result.current} />
      <div className={styles.tableScroll} tabIndex={0}>
        <table className={styles.historyTable}>
          <caption>
            Entitlement history for subject{" "}
            <bdi dir="auto">{result.subject_user_id}</bdi>
          </caption>
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">Value</th>
              <th scope="col">Effective from</th>
              <th scope="col">Effective to</th>
              <th scope="col">Revoked at</th>
              <th scope="col">Granted by</th>
              <th scope="col">Revoked by</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {result.history.length === 0 ? (
              <tr>
                <td colSpan={8}>No entitlement history is stored.</td>
              </tr>
            ) : (
              result.history.map((item, index) => (
                <tr
                  key={`${item.kind}:${item.value}:${item.effective_from}:${index}`}
                >
                  <td>{item.kind}</td>
                  <td>{item.value}</td>
                  <td>
                    <time dateTime={item.effective_from}>
                      {formatTimestamp(item.effective_from)}
                    </time>
                  </td>
                  <td>
                    {item.effective_to ? (
                      <time dateTime={item.effective_to}>
                        {formatTimestamp(item.effective_to)}
                      </time>
                    ) : (
                      "Active"
                    )}
                  </td>
                  <td>
                    {item.revoked_at ? (
                      <time dateTime={item.revoked_at}>
                        {formatTimestamp(item.revoked_at)}
                      </time>
                    ) : (
                      "Not revoked"
                    )}
                  </td>
                  <td>
                    {item.grant_actor_kind === "system" ? (
                      "System"
                    ) : item.granted_by ? (
                      <bdi dir="auto">{item.granted_by}</bdi>
                    ) : (
                      "User unavailable"
                    )}
                  </td>
                  <td>
                    {item.revoked_by ? (
                      <bdi dir="auto">{item.revoked_by}</bdi>
                    ) : (
                      "Not revoked"
                    )}
                  </td>
                  <td>
                    <bdi dir="auto">{item.justification}</bdi>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AdminEntitlementManager() {
  const [sessionState, setSessionState] = useState<
    "loading" | "allowed" | "denied" | "error"
  >("loading");
  const [csrfToken, setCsrfToken] = useState("");
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [requestState, setRequestState] = useState<
    "idle" | "submitting" | "error" | "success"
  >("idle");
  const [requestMessage, setRequestMessage] = useState("");
  const [liveStatus, setLiveStatus] = useState("");
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [result, setResult] = useState<MutationResult | null>(null);
  const [entitlementRead, setEntitlementRead] =
    useState<EntitlementReadResult | null>(null);
  const [readState, setReadState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [readMessage, setReadMessage] = useState("");
  const [readCorrelationId, setReadCorrelationId] = useState<string | null>(
    null,
  );
  const [reviewReadError, setReviewReadError] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const justificationRef = useRef<HTMLTextAreaElement>(null);
  const expiryRef = useRef<HTMLInputElement>(null);
  const loadSubjectRef = useRef<HTMLButtonElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const readGenerationRef = useRef(0);

  async function loadSession() {
    setSessionState("loading");
    setLiveStatus("Verifying the administrator session.");
    try {
      const session = await jsonRequest<SessionProjection>("/api/v1/me");
      const roles = Array.isArray(session.admin_sub_roles)
        ? session.admin_sub_roles
        : [];
      if (
        session.tier !== "admin" ||
        !roles.includes("super_admin") ||
        typeof session.csrf_token !== "string" ||
        session.csrf_token.length === 0
      ) {
        setSessionState("denied");
        setLiveStatus("Access denied.");
        return;
      }
      setCsrfToken(session.csrf_token);
      setSessionState("allowed");
      setLiveStatus("Administrator session verified.");
    } catch (error) {
      setRequestMessage(
        error instanceof Error
          ? error.message
          : "The administrator session could not be loaded.",
      );
      setSessionState("error");
      setLiveStatus("Administrator session verification failed.");
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  function updateDraft<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      if (
        key === "action" ||
        key === "entitlement_kind" ||
        key === "entitlement_value"
      ) {
        delete next.expires_at;
      }
      return next;
    });
    setRequestState("idle");
    setResult(null);
    idempotencyKeyRef.current = null;
    if (key === "subject_user_id") {
      readGenerationRef.current += 1;
      setEntitlementRead(null);
      setReadState("idle");
      setReadMessage("");
      setReadCorrelationId(null);
      setReviewReadError(false);
    }
  }

  async function loadSubject(subjectUserId = draft.subject_user_id) {
    if (!UUID_PATTERN.test(subjectUserId)) {
      setErrors((current) => ({
        ...current,
        subject_user_id: "Enter a valid subject user UUID.",
      }));
      queueMicrotask(() => subjectRef.current?.focus());
      return false;
    }
    const generation = ++readGenerationRef.current;
    setReadState("loading");
    setReadMessage("");
    setReadCorrelationId(null);
    setReviewReadError(false);
    setLiveStatus("Loading current entitlements and history.");
    try {
      const body = await jsonRequest<EntitlementReadResult>(
        `/api/v1/admin/entitlements?subject_user_id=${encodeURIComponent(subjectUserId)}`,
        {},
        "The server refused access to this entitlement subject.",
      );
      if (generation !== readGenerationRef.current) return false;
      if (
        body.subject_user_id !== subjectUserId ||
        !body.current ||
        !Array.isArray(body.current.admin_sub_roles) ||
        !Array.isArray(body.history)
      ) {
        throw new Error("The entitlement read response is invalid.");
      }
      setEntitlementRead(body);
      setReadState("success");
      setLiveStatus("Current entitlements and history loaded.");
      return true;
    } catch (error) {
      if (generation !== readGenerationRef.current) return false;
      setEntitlementRead(null);
      setReadMessage(
        error instanceof Error
          ? error.message
          : "Current entitlements and history could not be loaded.",
      );
      setReadCorrelationId(
        error instanceof RequestError ? error.correlationId : null,
      );
      setReadState("error");
      setLiveStatus("Entitlement history load failed.");
      return false;
    }
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      queueMicrotask(() => {
        if (nextErrors.subject_user_id) subjectRef.current?.focus();
        else if (nextErrors.expires_at) expiryRef.current?.focus();
        else if (nextErrors.justification) justificationRef.current?.focus();
      });
      return;
    }
    if (
      readState !== "success" ||
      entitlementRead?.subject_user_id !== draft.subject_user_id
    ) {
      setReviewReadError(true);
      queueMicrotask(() => loadSubjectRef.current?.focus());
      return;
    }
    idempotencyKeyRef.current = crypto.randomUUID();
    setStep("review");
    setRequestState("idle");
    setLiveStatus("Exact entitlement change ready for review.");
  }

  async function submitMutation() {
    setRequestState("submitting");
    setLiveStatus("Submitting the entitlement change.");
    setRequestMessage("");
    setCorrelationId(null);
    try {
      const body = await jsonRequest<MutationResult>(
        "/api/v1/admin/entitlements",
        {
          method: "POST",
          headers: {
            "X-CSRF-Token": csrfToken,
            "Idempotency-Key": idempotencyKeyRef.current ?? crypto.randomUUID(),
          },
          body: JSON.stringify({
            action: draft.action,
            subject_user_id: draft.subject_user_id,
            entitlement_kind: draft.entitlement_kind,
            entitlement_value: draft.entitlement_value,
            justification: draft.justification,
            ...(draft.action === "grant" &&
            draft.entitlement_kind === "tier" &&
            draft.entitlement_value === "consultant"
              ? { expires_at: draft.expires_at }
              : {}),
          }),
        },
      );
      setResult(body);
      await loadSubject(draft.subject_user_id);
      setRequestState("success");
      setLiveStatus("Entitlement change recorded.");
    } catch (error) {
      setRequestMessage(
        error instanceof Error
          ? error.message
          : "The entitlement request could not be completed.",
      );
      setCorrelationId(
        error instanceof RequestError ? error.correlationId : null,
      );
      setRequestState("error");
      setLiveStatus("Entitlement change failed.");
    }
  }

  const values = draft.entitlement_kind === "tier" ? TIERS : ADMIN_SUB_ROLES;
  const readPanel =
    readState === "loading" ? (
      <p className={styles.notice} role="status">
        Loading current entitlements and history…
      </p>
    ) : readState === "error" ? (
      <div className={`${styles.notice} ${styles.error}`} role="alert">
        <p>{readMessage}</p>
        {readCorrelationId ? (
          <p>
            Correlation ID: <bdi dir="auto">{readCorrelationId}</bdi>
          </p>
        ) : null}
        <button
          className={styles.button}
          type="button"
          onClick={() => void loadSubject()}
        >
          Retry current and history
        </button>
      </div>
    ) : readState === "success" && entitlementRead ? (
      <div className={styles.readPanel}>
        <EntitlementHistory result={entitlementRead} />
      </div>
    ) : null;

  return (
    <>
      <a className={styles.skipLink} href="#admin-entitlement-main">
        Skip to entitlement control
      </a>
      <main id="admin-entitlement-main" className={styles.shell} tabIndex={-1}>
        <p
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {liveStatus}
        </p>
        <header className={styles.header}>
          <p className={styles.eyebrow}>TASK-073-C · bounded write surface</p>
          <h1>Admin entitlement change</h1>
          <p className={styles.lede}>
            Grant or revoke one stored tier or Admin sub-role. The server
            enforces authorization, account scope, separation rules, and durable
            audit.
          </p>
          <p className={styles.scopeNote}>
            Delivered here: current entitlements, history, and one grant or
            revoke at a time, including required expiry for Consultant grants.
            Budget controls, suspension, and restoration are not delivered in
            this surface.
          </p>
        </header>

        {sessionState === "loading" ? (
          <p className={styles.notice} role="status">
            Verifying the administrator session…
          </p>
        ) : null}

        {sessionState === "error" ? (
          <section className={`${styles.notice} ${styles.error}`} role="alert">
            <p>{requestMessage}</p>
            <button
              className={styles.button}
              type="button"
              onClick={loadSession}
            >
              Retry session check
            </button>
          </section>
        ) : null}

        {sessionState === "denied" ? (
          <p className={`${styles.notice} ${styles.error}`} role="alert">
            Access denied. This control requires the Admin tier and the exact
            super_admin sub-role.
          </p>
        ) : null}

        {sessionState === "allowed" ? (
          <>
            <ol className={styles.steps} aria-label="Entitlement change steps">
              <li
                className={`${styles.step} ${step === "edit" ? styles.currentStep : ""}`}
                aria-current={step === "edit" ? "step" : undefined}
              >
                1. Define change
              </li>
              <li
                className={`${styles.step} ${step === "review" ? styles.currentStep : ""}`}
                aria-current={step === "review" ? "step" : undefined}
              >
                2. Review and confirm
              </li>
            </ol>

            <section
              className={styles.panel}
              aria-busy={requestState === "submitting"}
            >
              {step === "edit" ? (
                <>
                  <h2>Define one entitlement change</h2>
                  {Object.keys(errors).length > 0 || reviewReadError ? (
                    <div
                      className={`${styles.notice} ${styles.error}`}
                      role="alert"
                    >
                      <p>Correct the marked fields before review.</p>
                      <ul className={styles.errorList}>
                        {errors.subject_user_id ? (
                          <li>
                            <a href="#entitlement-subject">
                              Subject user UUID: {errors.subject_user_id}
                            </a>
                          </li>
                        ) : null}
                        {errors.entitlement_value ? (
                          <li>
                            <a href="#entitlement-value">
                              Exact value: {errors.entitlement_value}
                            </a>
                          </li>
                        ) : null}
                        {errors.expires_at ? (
                          <li>
                            <a href="#entitlement-expiry">
                              Consultant expiry: {errors.expires_at}
                            </a>
                          </li>
                        ) : null}
                        {errors.justification ? (
                          <li>
                            <a href="#entitlement-justification">
                              Required reason: {errors.justification}
                            </a>
                          </li>
                        ) : null}
                        {reviewReadError ? (
                          <li>
                            <a href="#entitlement-load">
                              Subject state: Load current entitlements and
                              history before review.
                            </a>
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  ) : null}
                  <form className={styles.form} onSubmit={review} noValidate>
                    <div className={styles.field}>
                      <label htmlFor="entitlement-subject">
                        Subject user UUID
                      </label>
                      <input
                        ref={subjectRef}
                        id="entitlement-subject"
                        className={
                          errors.subject_user_id ? styles.invalid : undefined
                        }
                        value={draft.subject_user_id}
                        onChange={(event) =>
                          updateDraft("subject_user_id", event.target.value)
                        }
                        aria-invalid={Boolean(errors.subject_user_id)}
                        aria-describedby={
                          errors.subject_user_id
                            ? "entitlement-subject-hint entitlement-subject-error"
                            : "entitlement-subject-hint"
                        }
                        autoComplete="off"
                        required
                      />
                      <p id="entitlement-subject-hint" className={styles.hint}>
                        The server resolves this UUID only inside the actor
                        account. Current entitlements and history must be loaded
                        before review.
                      </p>
                      {errors.subject_user_id ? (
                        <p
                          id="entitlement-subject-error"
                          className={styles.fieldError}
                        >
                          {errors.subject_user_id}
                        </p>
                      ) : null}
                      <div className={styles.actions}>
                        <button
                          ref={loadSubjectRef}
                          id="entitlement-load"
                          className={`${styles.button} ${styles.secondary}`}
                          type="button"
                          disabled={readState === "loading"}
                          onClick={() => void loadSubject()}
                        >
                          {readState === "loading"
                            ? "Loading current and history…"
                            : "Load current and history"}
                        </button>
                      </div>
                    </div>

                    {readPanel}

                    <div className={styles.field}>
                      <label htmlFor="entitlement-action">Action</label>
                      <select
                        id="entitlement-action"
                        value={draft.action}
                        onChange={(event) =>
                          updateDraft("action", event.target.value as Action)
                        }
                      >
                        <option value="grant">grant</option>
                        <option value="revoke">revoke</option>
                      </select>
                    </div>

                    <div className={styles.field}>
                      <label htmlFor="entitlement-kind">Entitlement kind</label>
                      <select
                        id="entitlement-kind"
                        value={draft.entitlement_kind}
                        onChange={(event) => {
                          const kind = event.target.value as EntitlementKind;
                          setDraft((current) => ({
                            ...current,
                            entitlement_kind: kind,
                            entitlement_value:
                              kind === "tier" ? TIERS[0] : ADMIN_SUB_ROLES[0],
                          }));
                          setErrors((current) => {
                            const next = { ...current };
                            delete next.entitlement_kind;
                            delete next.entitlement_value;
                            delete next.expires_at;
                            return next;
                          });
                          setRequestState("idle");
                          setResult(null);
                          idempotencyKeyRef.current = null;
                        }}
                      >
                        <option value="tier">tier</option>
                        <option value="admin_sub_role">admin_sub_role</option>
                      </select>
                    </div>

                    <div className={styles.field}>
                      <label htmlFor="entitlement-value">Exact value</label>
                      <select
                        id="entitlement-value"
                        className={
                          errors.entitlement_value ? styles.invalid : undefined
                        }
                        value={draft.entitlement_value}
                        onChange={(event) =>
                          updateDraft("entitlement_value", event.target.value)
                        }
                        aria-invalid={Boolean(errors.entitlement_value)}
                        aria-describedby={
                          errors.entitlement_value
                            ? "entitlement-value-error"
                            : undefined
                        }
                      >
                        {values.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                      {errors.entitlement_value ? (
                        <p
                          id="entitlement-value-error"
                          className={styles.fieldError}
                        >
                          {errors.entitlement_value}
                        </p>
                      ) : null}
                    </div>

                    {draft.action === "grant" &&
                    draft.entitlement_kind === "tier" &&
                    draft.entitlement_value === "consultant" ? (
                      <div className={styles.field}>
                        <label htmlFor="entitlement-expiry">
                          Consultant expiry (RFC3339)
                        </label>
                        <input
                          ref={expiryRef}
                          id="entitlement-expiry"
                          className={
                            errors.expires_at ? styles.invalid : undefined
                          }
                          type="text"
                          inputMode="text"
                          autoComplete="off"
                          placeholder="2027-12-31T23:59:59Z"
                          value={draft.expires_at}
                          onChange={(event) =>
                            updateDraft("expires_at", event.target.value)
                          }
                          aria-invalid={Boolean(errors.expires_at)}
                          aria-describedby={
                            errors.expires_at
                              ? "entitlement-expiry-hint entitlement-expiry-error"
                              : "entitlement-expiry-hint"
                          }
                          required
                        />
                        <p id="entitlement-expiry-hint" className={styles.hint}>
                          Required for Consultant grants. Include seconds and a
                          UTC Z or numeric offset. The database clock makes the
                          final future-time decision.
                        </p>
                        {errors.expires_at ? (
                          <p
                            id="entitlement-expiry-error"
                            className={styles.fieldError}
                          >
                            {errors.expires_at}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <div className={styles.field}>
                      <label htmlFor="entitlement-justification">
                        Required reason
                      </label>
                      <textarea
                        ref={justificationRef}
                        id="entitlement-justification"
                        className={
                          errors.justification ? styles.invalid : undefined
                        }
                        value={draft.justification}
                        onChange={(event) =>
                          updateDraft("justification", event.target.value)
                        }
                        aria-invalid={Boolean(errors.justification)}
                        aria-describedby={
                          errors.justification
                            ? "entitlement-reason-hint entitlement-reason-error"
                            : "entitlement-reason-hint"
                        }
                        maxLength={2_000}
                        required
                      />
                      <p id="entitlement-reason-hint" className={styles.hint}>
                        Stored in the audit event. Maximum 2,000 characters.
                      </p>
                      {errors.justification ? (
                        <p
                          id="entitlement-reason-error"
                          className={styles.fieldError}
                        >
                          {errors.justification}
                        </p>
                      ) : null}
                    </div>

                    <div className={styles.actions}>
                      <button className={styles.button} type="submit">
                        Review exact change
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <>
                  <h2>Review exact change</h2>
                  <dl className={styles.review}>
                    <dt>Subject user UUID</dt>
                    <dd>
                      <bdi dir="auto">{draft.subject_user_id}</bdi>
                    </dd>
                    <dt>Action</dt>
                    <dd>{draft.action}</dd>
                    <dt>Kind</dt>
                    <dd>{draft.entitlement_kind}</dd>
                    <dt>Exact value</dt>
                    <dd>{draft.entitlement_value}</dd>
                    {draft.action === "grant" &&
                    draft.entitlement_kind === "tier" &&
                    draft.entitlement_value === "consultant" ? (
                      <>
                        <dt>Consultant expiry</dt>
                        <dd>
                          <time dateTime={draft.expires_at}>
                            {formatTimestamp(draft.expires_at)}
                          </time>{" "}
                          (<bdi dir="auto">{draft.expires_at}</bdi>)
                        </dd>
                      </>
                    ) : null}
                    <dt>Reason</dt>
                    <dd>
                      <bdi dir="auto">{draft.justification}</bdi>
                    </dd>
                  </dl>

                  {requestState === "error" ? (
                    <div
                      className={`${styles.notice} ${styles.error}`}
                      role="alert"
                    >
                      <p>{requestMessage}</p>
                      {correlationId ? (
                        <p>
                          Correlation ID: <bdi dir="auto">{correlationId}</bdi>
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {requestState === "submitting" ? (
                    <p className={styles.notice} role="status">
                      Submitting and waiting for durable audit…
                    </p>
                  ) : null}

                  {requestState !== "success" ? (
                    <>
                      <p className={styles.confirmation}>
                        <strong>
                          {draft.action === "grant" ? "Grant" : "Revoke"}{" "}
                          {draft.entitlement_kind === "tier"
                            ? "tier"
                            : "Admin sub-role"}{" "}
                          “<bdi dir="auto">{draft.entitlement_value}</bdi>”{" "}
                          {draft.action === "grant" ? "to" : "from"} subject{" "}
                          <bdi dir="auto">{draft.subject_user_id}</bdi>. Reason:{" "}
                          <bdi dir="auto">{draft.justification}</bdi>.
                          {draft.action === "grant" &&
                          draft.entitlement_kind === "tier" &&
                          draft.entitlement_value === "consultant" ? (
                            <>
                              {" "}
                              Expires exactly at{" "}
                              <bdi dir="auto">{draft.expires_at}</bdi> (
                              {formatTimestamp(draft.expires_at)}).
                            </>
                          ) : null}
                        </strong>
                      </p>
                      <div className={styles.actions}>
                        <button
                          className={`${styles.button} ${styles.secondary}`}
                          type="button"
                          disabled={requestState === "submitting"}
                          onClick={() => {
                            setStep("edit");
                            setRequestState("idle");
                            idempotencyKeyRef.current = null;
                          }}
                        >
                          Back to edit
                        </button>
                        <button
                          className={styles.button}
                          type="button"
                          disabled={requestState === "submitting"}
                          onClick={() => void submitMutation()}
                        >
                          {requestState === "error"
                            ? "Retry exact change"
                            : "Confirm exact change"}
                        </button>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </section>

            {step === "review" ? readPanel : null}

            {result ? (
              <section
                className={styles.result}
                aria-labelledby="entitlement-result-title"
              >
                <h2 id="entitlement-result-title">
                  Entitlement change recorded
                </h2>
                <p role="status">
                  {result.changed
                    ? "The stored entitlement changed and the audit event was recorded."
                    : "No stored entitlement value changed; the audited request was recorded."}
                </p>
                <h3>Before</h3>
                <SnapshotDetails snapshot={result.before} />
                <h3>After</h3>
                <SnapshotDetails snapshot={result.after} />
                <p>
                  Requested expiry:{" "}
                  {result.expires_at ? (
                    <time dateTime={result.expires_at}>
                      {formatTimestamp(result.expires_at)}
                    </time>
                  ) : (
                    "None"
                  )}
                </p>
                <p>
                  Audit ID:{" "}
                  <bdi dir="auto" className={styles.auditId}>
                    {result.audit_id}
                  </bdi>
                </p>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => {
                    setDraft(initialDraft());
                    setStep("edit");
                    setRequestState("idle");
                    setResult(null);
                    idempotencyKeyRef.current = null;
                    readGenerationRef.current += 1;
                    setEntitlementRead(null);
                    setReadState("idle");
                    setReadMessage("");
                    setReadCorrelationId(null);
                    setReviewReadError(false);
                  }}
                >
                  Define another change
                </button>
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}
