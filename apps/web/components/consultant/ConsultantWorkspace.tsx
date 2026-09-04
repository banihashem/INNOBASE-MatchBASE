"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseDemoProjectionV1,
  parseConsultantResultProjectionV1,
  parseConsultantResultProjectionV2,
  parseConsultantRunHistoryV1,
  parseStandardResultProjectionV1,
} from "@matchbase/contracts";
import { UserProfile } from "../profile/UserProfile";
import {
  type WorkspaceSession,
  userFacingSessionName,
} from "../standard/types";
import { idempotencyKey, workspaceJson } from "../standard/api";
import {
  ConsultantResultView,
  type ConsultantVisibleResult,
} from "./ConsultantResult";

type RunItem = {
  run_id: string;
  request_id: string;
  state: string;
  updated_at: string;
  result_available: boolean;
  outcome: string;
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
  consultant_prose?: string;
  deep_research_prompt?: string;
  source_language_tag: string;
  source_language_confidence: number;
  fields: CanonicalField[];
  match_readiness: "ready" | "partially_ready" | "not_ready";
  contradictions: string[];
};

type ViewState =
  | { state: "loading" }
  | { state: "intake" }
  | {
      state: "confirm";
      canonical: CanonicalResponse;
      canonicalText: string;
    }
  | {
      state: "running";
      runId: string;
      phaseLabel?: string;
      elapsedSeconds: number;
    }
  | { state: "runs"; items: RunItem[] }
  | { state: "profile" }
  | {
      state: "result";
      result: ConsultantVisibleResult;
      artifactDownload:
        import("./ConsultantResult").ResultArtifactDownload | null;
      reportStatus: "idle" | "requesting" | "queued" | "error";
    }
  | { state: "error"; message: string };

export function ConsultantWorkspace({
  initialSession,
  workspaceBadge = "Consultant",
  initialView = "runs",
  initialRunId,
}: {
  initialSession: WorkspaceSession;
  workspaceBadge?: string;
  initialView?: "intake" | "runs" | "profile" | undefined;
  initialRunId?: string | undefined;
}) {
  const [view, setView] = useState<ViewState>(
    initialView === "profile"
      ? { state: "profile" }
      : initialView === "intake"
        ? { state: "intake" }
        : { state: "loading" },
  );

  // Step 1: 3-part intake fields
  const [productRequirement, setProductRequirement] = useState("");
  const [technicalRequirements, setTechnicalRequirements] = useState("");
  const [orderProfile, setOrderProfile] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    confirmed: boolean;
    similarRunId: string;
    productTitle: string;
  } | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const moveFocusAfterLoad = useRef(false);
  const reportPollAbort = useRef<AbortController | null>(null);

  const loadRuns = useCallback(async (moveFocus = false) => {
    reportPollAbort.current?.abort();
    moveFocusAfterLoad.current = moveFocus;
    setView({ state: "loading" });
    try {
      const response = await workspaceJson<unknown>("/api/v1/consultant/runs");
      const history = parseConsultantRunHistoryV1(response.body);
      setView({ state: "runs", items: [...history.items] });
      if (
        typeof window !== "undefined" &&
        window.location.pathname !== "/runs"
      ) {
        window.history.pushState(null, "", "/runs");
      }
    } catch {
      setView({
        state: "error",
        message: "The run history could not be loaded.",
      });
    }
  }, []);

  useEffect(() => () => reportPollAbort.current?.abort(), []);

  useEffect(() => {
    if (!isSubmitting) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isSubmitting]);

  useEffect(() => {
    if (initialRunId) {
      void openResult(initialRunId);
    }
  }, [initialRunId]);

  useEffect(() => {
    function handlePopState() {
      const path = window.location.pathname;
      const match = path.match(/^\/runs\/([^/]+)/);
      if (match && match[1]) {
        void openResult(decodeURIComponent(match[1]));
      } else if (path.startsWith("/runs")) {
        void loadRuns();
      } else if (path.startsWith("/profile")) {
        setView({ state: "profile" });
      } else {
        setView({ state: "intake" });
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [loadRuns]);

  useEffect(() => {
    if (initialView === "runs") void loadRuns();
  }, [initialView, loadRuns]);

  useEffect(() => {
    if (view.state === "loading" || !moveFocusAfterLoad.current) return;
    moveFocusAfterLoad.current = false;
    headingRef.current?.focus();
  }, [view]);

  async function openResult(runId: string) {
    moveFocusAfterLoad.current = true;
    setView({ state: "loading" });
    try {
      const resultPath =
        initialSession.tier === "admin"
          ? `/api/v1/consultant/runs/${encodeURIComponent(runId)}/result`
          : `/api/v1/runs/${encodeURIComponent(runId)}/result`;
      const response = await workspaceJson<unknown>(resultPath);
      const body = response.body;
      if (
        body === null ||
        typeof body !== "object" ||
        !("schema_version" in body)
      )
        throw new Error("Consultant result schema is invalid.");
      const result = (() => {
        switch (body.schema_version) {
          case "consultant-result-projection.v1":
            return parseConsultantResultProjectionV1(body);
          case "consultant-result-projection.v2":
            return parseConsultantResultProjectionV2(body);
          case "standard-result-projection.v1":
            return parseStandardResultProjectionV1(body);
          case "demo-projection.v1":
            return parseDemoProjectionV1(body);
          default:
            throw new Error("Consultant result schema is unsupported.");
        }
      })();
      setView({
        state: "result",
        result,
        artifactDownload: response.artifactDownload,
        reportStatus: "idle",
      });
      setIsSubmitting(false);
      if (
        typeof window !== "undefined" &&
        window.location.pathname !== `/runs/${encodeURIComponent(runId)}`
      ) {
        window.history.pushState(
          null,
          "",
          `/runs/${encodeURIComponent(runId)}`,
        );
      }
    } catch {
      setView({ state: "error", message: "The result could not be loaded." });
      setIsSubmitting(false);
    }
  }

  // Handle Step 1 Intake Submission
  async function handleSubmitIntake(e: React.FormEvent) {
    e.preventDefault();
    if (!productRequirement.trim()) {
      setFormError("Product Requirement cannot be empty.");
      return;
    }

    // UX-007: Check for near-duplicate request against cached history
    if (!duplicateWarning?.confirmed) {
      const normalizedInput = productRequirement.trim().toLowerCase();
      const inputWords = new Set(
        normalizedInput.split(/\s+/).filter((w) => w.length > 3),
      );
      // If user repeatedly submits the same text
      if (typeof window !== "undefined" && window.sessionStorage) {
        const lastInput =
          window.sessionStorage.getItem("matchbase_last_intake") || "";
        const lastRunId =
          window.sessionStorage.getItem("matchbase_last_run_id") || "";
        if (lastInput && lastRunId) {
          const lastWords = new Set(
            lastInput
              .toLowerCase()
              .split(/\s+/)
              .filter((w) => w.length > 3),
          );
          let intersection = 0;
          for (const w of inputWords) {
            if (lastWords.has(w)) intersection++;
          }
          const similarity =
            inputWords.size > 0 ? intersection / inputWords.size : 0;
          if (similarity > 0.75) {
            setDuplicateWarning({
              confirmed: false,
              similarRunId: lastRunId,
              productTitle: lastInput.slice(0, 60) + "…",
            });
            return;
          }
        }
      }
    }

    setFormError(null);
    setIsSubmitting(true);
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem(
        "matchbase_last_intake",
        productRequirement.trim(),
      );
    }

    try {
      const combinedSource = [
        `[Product Requirement]:\n${productRequirement.trim()}`,
        `[Technical, Quality & Trade Requirements]:\n${technicalRequirements.trim() || "Standard verified industrial parameters and certifications"}`,
        `[Order & Supplier Profile]:\n${orderProfile.trim() || "Standard international trade volume and commercial terms"}`,
      ].join("\n\n");

      const response = await workspaceJson<CanonicalResponse>(
        "/api/v1/requests",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("consultant-intake") },
          body: JSON.stringify({
            source_text: combinedSource,
            presented_fields: [
              "need",
              "mandatory_constraints",
              "preferences_context",
            ],
            unknown_fields: orderProfile.trim() ? [] : ["preferences_context"],
          }),
        },
        initialSession.csrf_token,
      );

      setView({
        state: "confirm",
        canonical: response.body,
        canonicalText: response.body.canonical_text,
      });
    } catch (err: unknown) {
      setFormError(
        err instanceof Error
          ? err.message
          : "Failed to structure the request with AI.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handle Step 2 Confirmation and Launch Deep Research
  async function handleConfirmAndRun() {
    if (view.state !== "confirm") return;
    setIsSubmitting(true);
    setFormError(null);

    try {
      const { canonical } = view;

      // 1. Confirm version
      await workspaceJson(
        `/api/v1/requests/${canonical.request_id}/versions/${canonical.version}/confirmation`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("consultant-confirm") },
          body: JSON.stringify({ accepted: true }),
        },
        initialSession.csrf_token,
      );

      // 2. Submit run
      const runRes = await workspaceJson<{ run_id: string }>(
        "/api/v1/runs",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("consultant-run") },
          body: JSON.stringify({
            request_id: canonical.request_id,
            version: canonical.version,
          }),
        },
        initialSession.csrf_token,
      );

      const runId = runRes.body.run_id;
      if (typeof window !== "undefined" && window.sessionStorage) {
        window.sessionStorage.setItem("matchbase_last_run_id", runId);
      }
      setView({
        state: "running",
        runId,
        phaseLabel: "Queued for execution",
        elapsedSeconds: 0,
      });

      // 3. Poll for run completion with truthful phase telemetry and elapsed time
      const startTime = Date.now();
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await workspaceJson<{
            state: string;
            phase_label?: string;
            result_available: boolean;
            outcome?: string;
          }>(`/api/v1/runs/${encodeURIComponent(runId)}`);

          const elapsed = Math.floor((Date.now() - startTime) / 1000);

          if (statusRes.body.result_available) {
            clearInterval(pollInterval);
            await openResult(runId);
          } else if (statusRes.body.state === "failed") {
            clearInterval(pollInterval);
            setView({
              state: "error",
              message:
                "Deep research execution encountered a processing issue.",
            });
          } else {
            setView((current) =>
              current.state === "running"
                ? {
                    ...current,
                    phaseLabel:
                      statusRes.body.phase_label ||
                      (statusRes.body.state === "queued"
                        ? "Queued for execution"
                        : "Collecting and verifying evidence"),
                    elapsedSeconds: elapsed,
                  }
                : current,
            );
          }
        } catch {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          setView((current) =>
            current.state === "running"
              ? { ...current, elapsedSeconds: elapsed }
              : current,
          );
        }
      }, 1500);
    } catch (err: unknown) {
      setFormError(
        err instanceof Error
          ? err.message
          : "Failed to confirm and launch research.",
      );
      setIsSubmitting(false);
    }
  }

  async function handleCancelRun(runId: string) {
    try {
      await workspaceJson(
        `/api/v1/runs/${encodeURIComponent(runId)}/cancellation`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("consultant-cancel") },
          body: JSON.stringify({ reason: "owner_cancelled" }),
        },
        initialSession.csrf_token,
      );
      setView({ state: "runs", items: [] });
      await loadRuns();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Cancellation failed.");
    }
  }

  async function requestReport() {
    if (
      view.state !== "result" ||
      view.artifactDownload ||
      view.result.schema_version !== "consultant-result-projection.v2"
    )
      return;
    const runId = view.result.run_id;
    setView({ ...view, reportStatus: "requesting" });
    try {
      const accepted = await workspaceJson<{
        job_id: string;
        state: string;
      }>(
        `/api/v1/runs/${encodeURIComponent(runId)}/artifacts`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("consultant-pdf") },
        },
        initialSession.csrf_token,
      );
      if (!accepted.body.job_id || accepted.body.state !== "queued")
        throw new Error("Invalid report job acknowledgement.");
      setView((current) =>
        current.state === "result"
          ? { ...current, reportStatus: "queued" }
          : current,
      );
      const controller = new AbortController();
      reportPollAbort.current?.abort();
      reportPollAbort.current = controller;
      let pollAfterMs = accepted.pollAfterMs ?? 1_000;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, pollAfterMs);
          controller.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              reject(new DOMException("Polling aborted", "AbortError"));
            },
            { once: true },
          );
        });
        const status = await workspaceJson<{ state: string }>(
          `/api/v1/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(accepted.body.job_id)}`,
          { signal: controller.signal },
        );
        if (status.body.state === "completed") {
          await openResult(runId);
          return;
        }
        if (status.body.state === "failed")
          throw new Error("Report generation failed.");
        pollAfterMs = status.pollAfterMs ?? pollAfterMs;
      }
      throw new Error("Report generation timed out.");
    } catch {
      setView((current) =>
        current.state === "result"
          ? { ...current, reportStatus: "error" }
          : current,
      );
    }
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header standard-header">
        <a className="brand" href="/" aria-label="MatchBASE home">
          <span className="brand-mark">M</span>
          <span>MatchBASE</span>
        </a>
        <nav aria-label="Primary navigation">
          <button
            className={
              view.state === "intake" ||
              view.state === "confirm" ||
              view.state === "running"
                ? "nav-button active"
                : "nav-button"
            }
            onClick={() => {
              setIsSubmitting(false);
              setFormError(null);
              setView({ state: "intake" });
              if (typeof window !== "undefined")
                window.history.pushState(null, "", "/intake");
            }}
          >
            Intake & Research
          </button>
          <button
            className={
              view.state === "runs" ? "nav-button active" : "nav-button"
            }
            onClick={() => void loadRuns(true)}
          >
            Runs
          </button>
          <button
            className={
              view.state === "profile" ? "nav-button active" : "nav-button"
            }
            onClick={() => {
              setView({ state: "profile" });
              if (typeof window !== "undefined")
                window.history.pushState(null, "", "/profile");
            }}
          >
            Profile
          </button>
        </nav>
        <div className="identity">
          <span>
            <bdi dir="auto">{userFacingSessionName(initialSession)}</bdi>
          </span>
          <span className="tier-badge">{workspaceBadge}</span>
        </div>
      </header>

      <main className="main standard-main" id="main-content">
        {view.state === "loading" ? (
          <p role="status">Loading Consultant workspace…</p>
        ) : null}

        {view.state === "error" ? (
          <section className="standard-section">
            <h1 ref={headingRef} tabIndex={-1}>
              Consultant workspace unavailable
            </h1>
            <div className="error-summary" role="alert">
              {view.message}
            </div>
            <button
              className="primary-action"
              onClick={() => void loadRuns(true)}
            >
              Retry
            </button>
          </section>
        ) : null}

        {/* STEP 1: 3-BOX INTAKE */}
        {view.state === "intake" ? (
          <section
            className="standard-section"
            aria-labelledby="consultant-intake-heading"
          >
            <div
              className="stepper"
              aria-label="Consultant pipeline progress"
              style={{ marginBottom: "1.5rem" }}
            >
              <span aria-current="step" style={{ fontWeight: 700 }}>
                1 Intake (3 Boxes)
              </span>
              <span style={{ color: "var(--muted, #94a3b8)" }}>
                2 Confirm (Dual Displays)
              </span>
              <span style={{ color: "var(--muted, #94a3b8)" }}>
                3 Deep Research
              </span>
            </div>

            <p className="eyebrow">Consultant tier sourcing</p>
            <h1 id="consultant-intake-heading" ref={headingRef} tabIndex={-1}>
              Define Procurement Scope
            </h1>
            <p className="lede">
              Input in any language (English, Persian, Arabic, etc.). The AI
              pipeline will translate, conceptualize, and generate an
              authoritative Advisory Narrative (Display 1) and a Thinking-Model
              Deep Research Execution Prompt (Display 2).
            </p>

            {formError ? (
              <div
                className="error-summary"
                role="alert"
                style={{ marginBottom: "1rem" }}
              >
                {formError}
              </div>
            ) : null}

            <form onSubmit={handleSubmitIntake} noValidate>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "1.25rem",
                  marginBottom: "1.5rem",
                }}
              >
                <div>
                  <label
                    htmlFor="box-product-requirement"
                    style={{
                      display: "block",
                      fontWeight: 700,
                      marginBottom: "0.25rem",
                    }}
                  >
                    Box 1: Product Requirement{" "}
                    <span
                      style={{
                        color: "var(--danger, #f87171)",
                        fontSize: "0.85rem",
                        fontWeight: 500,
                      }}
                    >
                      (Required)
                    </span>
                  </label>
                  <p
                    className="field-hint"
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--muted, #94a3b8)",
                      marginBottom: "0.5rem",
                    }}
                  >
                    What must be sourced? (Category, functional role, core
                    application, and industry nomenclature)
                  </p>
                  <textarea
                    id="box-product-requirement"
                    rows={4}
                    className="canonical-editor"
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      borderRadius: "6px",
                    }}
                    placeholder="e.g. Procurement of industrial electrical power and instrumentation cables — BASEC and IEC compliant..."
                    value={productRequirement}
                    onChange={(e) => setProductRequirement(e.target.value)}
                    required
                    aria-required="true"
                  />
                </div>

                <div>
                  <label
                    htmlFor="box-technical-requirements"
                    style={{
                      display: "block",
                      fontWeight: 700,
                      marginBottom: "0.25rem",
                    }}
                  >
                    Box 2: Technical, Quality & Trade Requirements{" "}
                    <span
                      style={{
                        color: "var(--muted, #94a3b8)",
                        fontSize: "0.85rem",
                        fontWeight: 400,
                      }}
                    >
                      (Optional)
                    </span>
                  </label>
                  <p
                    className="field-hint"
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--muted, #94a3b8)",
                      marginBottom: "0.5rem",
                    }}
                  >
                    Mandatory parameters, test standards (e.g. IEC, ISO, CE,
                    FAT, SIF/SFDA, HACCP), and delivery terms
                  </p>
                  <textarea
                    id="box-technical-requirements"
                    rows={4}
                    className="canonical-editor"
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      borderRadius: "6px",
                    }}
                    placeholder="e.g. Fire-resistant and armored specifications, factory test certificates (FAT), conforming to GPU AC A320 low THD, SAE ARP5015..."
                    value={technicalRequirements}
                    onChange={(e) => setTechnicalRequirements(e.target.value)}
                  />
                </div>

                <div>
                  <label
                    htmlFor="box-order-profile"
                    style={{
                      display: "block",
                      fontWeight: 700,
                      marginBottom: "0.25rem",
                    }}
                  >
                    Box 3: Order & Supplier Profile{" "}
                    <span
                      style={{
                        color: "var(--muted, #94a3b8)",
                        fontSize: "0.85rem",
                        fontWeight: 400,
                      }}
                    >
                      (Optional)
                    </span>
                  </label>
                  <p
                    className="field-hint"
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--muted, #94a3b8)",
                      marginBottom: "0.5rem",
                    }}
                  >
                    Volume/capacity, target MOQ, preferred supplier origin,
                    logistics, and Incoterms
                  </p>
                  <textarea
                    id="box-order-profile"
                    rows={3}
                    className="canonical-editor"
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      borderRadius: "6px",
                    }}
                    placeholder="e.g. Initial order for aviation ground power support; scalable monthly container volume; CIF/DDP delivery terms..."
                    value={orderProfile}
                    onChange={(e) => setOrderProfile(e.target.value)}
                  />
                </div>
              </div>

              {duplicateWarning && !duplicateWarning.confirmed ? (
                <div
                  className="info-summary"
                  role="alert"
                  style={{
                    marginBottom: "1.25rem",
                    borderLeftColor: "var(--warning, #f59e0b)",
                    background: "rgba(245, 158, 11, 0.08)",
                  }}
                >
                  <strong
                    style={{
                      color: "var(--warning, #f59e0b)",
                      display: "block",
                      marginBottom: "0.25rem",
                    }}
                  >
                    ⚠️ Near-Duplicate Request Notice (Quota Protection)
                  </strong>
                  <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.9rem" }}>
                    This request appears materially similar to a recently
                    submitted sourcing run (
                    <em>{duplicateWarning.productTitle}</em>). Submitting a new
                    run will consume 1 of your remaining 20 quota allocations.
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.75rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      className="primary-action"
                      style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}
                      onClick={() => {
                        setDuplicateWarning({
                          ...duplicateWarning,
                          confirmed: true,
                        });
                        // Re-trigger submit with confirmation
                        setTimeout(() => {
                          const form = document.querySelector("form");
                          if (form) form.requestSubmit();
                        }, 50);
                      }}
                    >
                      Proceed Anyway (Consume Quota)
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}
                      onClick={() =>
                        void openResult(duplicateWarning.similarRunId)
                      }
                    >
                      View Previous Sourcing Result
                    </button>
                  </div>
                </div>
              ) : null}

              <div
                className="form-actions"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                }}
              >
                <button
                  type="submit"
                  className="primary-action"
                  disabled={isSubmitting || !productRequirement.trim()}
                >
                  {isSubmitting
                    ? `Synthesizing Advisory & Deep Research Prompt (${elapsedSeconds}s)…`
                    : "Process Request & Generate Advisory Prompt"}
                </button>

                {isSubmitting ? (
                  <div
                    role="status"
                    aria-live="polite"
                    style={{
                      padding: "1.25rem",
                      borderRadius: "8px",
                      border: "1px solid var(--forest-2, #818cf8)",
                      background: "rgba(99, 102, 241, 0.08)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.75rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <strong
                        style={{
                          color: "var(--forest-2, #818cf8)",
                          fontSize: "0.95rem",
                        }}
                      >
                        Active AI Conceptualization & Advisory Pipeline
                      </strong>
                      <span
                        style={{
                          fontSize: "0.85rem",
                          color: "var(--muted, #94a3b8)",
                          fontFamily: "monospace",
                        }}
                      >
                        Elapsed: {elapsedSeconds}s
                      </span>
                    </div>
                    <div
                      style={{
                        height: "4px",
                        width: "100%",
                        background: "var(--line, #1c2738)",
                        borderRadius: "2px",
                        overflow: "hidden",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          height: "100%",
                          width: "50%",
                          background:
                            "linear-gradient(90deg, #6366f1, #818cf8)",
                          borderRadius: "2px",
                          animation: "pulse 1.5s ease-in-out infinite",
                        }}
                      />
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.85rem",
                        color: "var(--ink, #e2e8f0)",
                      }}
                    >
                      AI conceptualization and advisory formulation in progress…
                      Analyzing procurement parameters, mapping international
                      classification codes, and synthesizing deep research
                      prompts.
                    </p>
                  </div>
                ) : null}
              </div>
            </form>
          </section>
        ) : null}

        {/* STEP 2: CONFIRMATION WITH DUAL DISPLAYS */}
        {view.state === "confirm" ? (
          <section
            className="standard-section"
            aria-labelledby="consultant-confirm-heading"
          >
            <div
              className="stepper"
              aria-label="Consultant pipeline progress"
              style={{ marginBottom: "1.5rem" }}
            >
              <span style={{ color: "var(--muted, #94a3b8)" }}>1 Intake</span>
              <span
                aria-current="step"
                style={{ fontWeight: 700, color: "var(--forest-2, #818cf8)" }}
              >
                2 Confirm (Dual Displays)
              </span>
              <span style={{ color: "var(--muted, #94a3b8)" }}>
                3 Deep Research
              </span>
            </div>

            <p className="eyebrow">English canonical normalization</p>
            <h1 id="consultant-confirm-heading" ref={headingRef} tabIndex={-1}>
              Review & Authorize Deep Research
            </h1>
            <p className="lede">
              Detected language:{" "}
              <strong>{view.canonical.source_language_tag}</strong> (
              {Math.round(view.canonical.source_language_confidence * 100)}%
              confidence). Inspect the AI conceptualization and the generated
              deep research execution prompt before initiating web sourcing.
            </p>

            {formError ? (
              <div
                className="error-summary"
                role="alert"
                style={{ marginBottom: "1rem" }}
              >
                {formError}
              </div>
            ) : null}

            {/* DISPLAY 1: CONSULTANT ADVISORY NARRATIVE */}
            <div style={{ marginBottom: "1.75rem" }}>
              <label
                htmlFor="consultant-display-1"
                style={{
                  display: "block",
                  fontWeight: 700,
                  fontSize: "1.05rem",
                  marginBottom: "0.5rem",
                  color: "var(--ink, #e2e8f0)",
                }}
              >
                Display 1: Advisory Conceptual Summary (متن پیوسته با ادبیات
                مناسب مشاوره‌ای)
              </label>
              <div
                id="consultant-display-1"
                style={{
                  padding: "1.25rem",
                  borderRadius: "8px",
                  border: "1px solid var(--line, #1c2738)",
                  background: "var(--surface, #111827)",
                  color: "var(--ink, #e2e8f0)",
                  lineHeight: 1.7,
                  fontSize: "0.95rem",
                  whiteSpace: "pre-line",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }}
              >
                {view.canonical.consultant_prose ||
                  view.canonical.canonical_text}
              </div>
            </div>

            {/* DISPLAY 2: DEEP RESEARCH PROMPT */}
            <div style={{ marginBottom: "1.75rem" }}>
              <label
                htmlFor="consultant-display-2"
                style={{
                  display: "block",
                  fontWeight: 700,
                  fontSize: "1.05rem",
                  marginBottom: "0.5rem",
                  color: "var(--ink, #e2e8f0)",
                }}
              >
                Display 2: Deep Research Execution Prompt (پرامپت تحقیق عمیق
                توسط مدل متفکرانه)
              </label>
              <textarea
                id="consultant-display-2"
                className="canonical-editor"
                rows={10}
                style={{
                  width: "100%",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  lineHeight: 1.5,
                  padding: "1rem",
                  borderRadius: "8px",
                  background: "var(--surface-high, #1e293b)",
                  color: "var(--ink, #e2e8f0)",
                  border: "1px solid var(--line, #1c2738)",
                }}
                readOnly
                value={
                  view.canonical.deep_research_prompt || view.canonicalText
                }
              />
            </div>

            <div style={{ marginBottom: "1.75rem" }}>
              <label
                htmlFor="canonical-summary-text"
                style={{
                  display: "block",
                  fontWeight: 600,
                  marginBottom: "0.25rem",
                  color: "var(--ink, #e2e8f0)",
                }}
              >
                Strict English Canonical Sentence
              </label>
              <textarea
                id="canonical-summary-text"
                rows={2}
                className="canonical-editor"
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  background: "var(--surface, #111827)",
                  color: "var(--ink, #e2e8f0)",
                  border: "1px solid var(--line, #1c2738)",
                  borderRadius: "6px",
                }}
                value={view.canonicalText}
                onChange={(e) =>
                  setView({ ...view, canonicalText: e.target.value })
                }
              />
            </div>

            <div
              className="form-actions"
              style={{ display: "flex", gap: "1rem" }}
            >
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  setIsSubmitting(false);
                  setFormError(null);
                  setView({ state: "intake" });
                }}
              >
                Return to Intake
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={isSubmitting}
                onClick={() => void handleConfirmAndRun()}
              >
                {isSubmitting
                  ? "Launching Deep Research…"
                  : "Confirm & Launch Deep Research"}
              </button>
            </div>
          </section>
        ) : null}

        {/* STEP 3: DEEP RESEARCH RUNNING PROGRESS */}
        {view.state === "running" ? (
          <section
            className="standard-section"
            aria-labelledby="consultant-running-heading"
          >
            <div
              className="stepper"
              aria-label="Consultant pipeline progress"
              style={{ marginBottom: "1.5rem" }}
            >
              <span style={{ color: "var(--muted, #94a3b8)" }}>1 Intake</span>
              <span style={{ color: "var(--muted, #94a3b8)" }}>2 Confirm</span>
              <span
                aria-current="step"
                style={{ fontWeight: 700, color: "var(--forest-2, #818cf8)" }}
              >
                3 Deep Research (In Progress)
              </span>
            </div>

            <p className="eyebrow">Consultant execution</p>
            <h1 id="consultant-running-heading" ref={headingRef} tabIndex={-1}>
              Deep Research Execution in Progress
            </h1>
            <p className="lede">
              Live multi-source evidence collection and candidate qualification
              are underway across verified manufacturer and trade registries.
            </p>

            <div
              role="status"
              aria-live="polite"
              style={{
                marginTop: "1.5rem",
                padding: "1.5rem",
                borderRadius: "8px",
                border: "1px solid var(--forest-2, #818cf8)",
                background: "rgba(99, 102, 241, 0.08)",
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <div>
                  <strong
                    style={{
                      color: "var(--forest-2, #818cf8)",
                      fontSize: "1rem",
                      display: "block",
                    }}
                  >
                    {view.phaseLabel ?? "Collecting and verifying evidence"}
                  </strong>
                  <span
                    style={{
                      fontSize: "0.82rem",
                      color: "var(--muted, #94a3b8)",
                      fontFamily: "monospace",
                    }}
                  >
                    Run ID: {view.runId}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: "0.9rem",
                    color: "var(--ink, #e2e8f0)",
                    fontFamily: "monospace",
                    background: "var(--surface, #111827)",
                    padding: "0.25rem 0.75rem",
                    borderRadius: "4px",
                    border: "1px solid var(--line, #1c2738)",
                  }}
                >
                  Elapsed: {view.elapsedSeconds}s
                </span>
              </div>

              <div
                className="standard-progress"
                role="progressbar"
                aria-label="Deep research in progress"
                style={{
                  height: "6px",
                  width: "100%",
                  background: "var(--line, #1c2738)",
                  borderRadius: "3px",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: "100%",
                    width: "40%",
                    background: "linear-gradient(90deg, #6366f1, #818cf8)",
                    borderRadius: "3px",
                    animation: "pulse 1.5s ease-in-out infinite",
                  }}
                />
              </div>

              <p
                style={{
                  margin: 0,
                  fontSize: "0.88rem",
                  color: "var(--text-muted, #94a3b8)",
                  lineHeight: 1.5,
                }}
              >
                The research engine is executing structured discovery across
                certified supplier directories, auditing technical compliance
                standards, and synthesizing candidate dimension scores. You can
                leave this page; your run is persisted and available under
                Sourcing Runs.
              </p>

              <div
                style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}
              >
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => void handleCancelRun(view.runId)}
                  style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}
                >
                  Cancel Execution
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {view.state === "profile" ? (
          <UserProfile
            tier="consultant"
            displayName={userFacingSessionName(initialSession)}
            email={initialSession.email}
            quota={initialSession.quota}
            newRequestHref={undefined}
          />
        ) : null}

        {view.state === "runs" ? (
          <section
            className="standard-section"
            aria-labelledby="consultant-runs-heading"
          >
            <p className="eyebrow">Consultant workspace</p>
            <h1 id="consultant-runs-heading" ref={headingRef} tabIndex={-1}>
              Your sourcing runs
            </h1>
            <p className="lede">
              Result depth is locked to the tier recorded when each run was
              submitted.
            </p>
            {view.items.length === 0 ? (
              <p role="status">No sourcing runs are available.</p>
            ) : (
              <div
                className="standard-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Consultant run history"
              >
                <table className="standard-table">
                  <caption>Owned runs and result availability</caption>
                  <thead>
                    <tr>
                      <th scope="col">Run</th>
                      <th scope="col">State</th>
                      <th scope="col">Updated</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.items.map((item) => (
                      <tr key={item.run_id}>
                        <th scope="row">
                          <code>{item.run_id.slice(0, 8)}</code>
                        </th>
                        <td>{item.state.replaceAll("_", " ")}</td>
                        <td>
                          <time dateTime={item.updated_at}>
                            {new Intl.DateTimeFormat("en-GB", {
                              dateStyle: "medium",
                              timeStyle: "short",
                              timeZone: "UTC",
                            }).format(new Date(item.updated_at))}
                          </time>
                        </td>
                        <td>
                          {item.result_available ? (
                            <button
                              className="secondary-action"
                              onClick={() => void openResult(item.run_id)}
                            >
                              Open result
                            </button>
                          ) : item.outcome === "failed" ? (
                            "Research failed — no result was generated"
                          ) : (
                            "Result not available"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}

        {view.state === "result" ? (
          <>
            <ConsultantResultView
              result={view.result}
              artifactDownload={view.artifactDownload}
              headingRef={headingRef}
              onBack={() => void loadRuns(true)}
            />
            {!view.artifactDownload &&
            view.result.schema_version === "consultant-result-projection.v2" ? (
              <section className="standard-section" aria-label="PDF report">
                <button
                  className="secondary-action"
                  disabled={
                    view.reportStatus === "requesting" ||
                    view.reportStatus === "queued"
                  }
                  onClick={() => void requestReport()}
                >
                  {view.reportStatus === "requesting" ||
                  view.reportStatus === "queued"
                    ? "Generating PDF report…"
                    : "Generate PDF report"}
                </button>
                {view.reportStatus === "error" ? (
                  <p className="error-summary" role="alert">
                    PDF report generation is unavailable. The research result
                    remains available.
                  </p>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}
      </main>
      <footer>
        <span>Consultant result workspace</span>
        <span>Governed disclosure only</span>
      </footer>
    </>
  );
}
