import { useMemo, useRef, useState } from "react";
import type { StructuredStandardRequestV1 } from "./types";
import type {
  StandardRequestVersionSummaryV1,
  StandardValueState,
} from "@matchbase/contracts";
import type { WorkspaceSession } from "./types";
import { idempotencyKey, workspaceJson } from "./api";

type ResolutionMap = Record<string, string>;

export function CanonicalReview({
  session,
  request,
  onRun,
  onBack,
  versionHistory = [],
}: {
  session: WorkspaceSession;
  request: StructuredStandardRequestV1;
  onRun: (runId: string) => void;
  onBack: () => void;
  versionHistory?: StandardRequestVersionSummaryV1[];
}) {
  const [draft, setDraft] = useState(request);
  const [baseline, setBaseline] = useState(request);
  const [resolutions, setResolutions] = useState<ResolutionMap>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const changed = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline],
  );
  const unresolved = draft.contradictions.filter(
    (item) => item.resolution_state === "unresolved",
  );

  function fail(message: string) {
    setError(message);
    requestAnimationFrame(() => errorRef.current?.focus());
  }

  function updateProvided(fieldId: string, value: string) {
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.field_id === fieldId &&
        field.typed_value.value_state === "provided"
          ? { ...field, typed_value: { ...field.typed_value, value } }
          : field,
      ),
    }));
  }

  function updateState(fieldId: string, state: StandardValueState) {
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.field_id === fieldId
          ? {
              ...field,
              typed_value:
                state === "provided"
                  ? { value_state: "provided" as const, value: "" }
                  : { value_state: state },
            }
          : field,
      ),
    }));
  }

  function updateProvidedMetadata(
    fieldId: string,
    key: "unit" | "raw_expression",
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field) => {
        if (
          field.field_id !== fieldId ||
          field.typed_value.value_state !== "provided"
        )
          return field;
        const typed = { ...field.typed_value };
        if (value) typed[key] = value;
        else delete typed[key];
        return { ...field, typed_value: typed };
      }),
    }));
  }

  async function confirmAndRun() {
    if (unresolved.some((item) => !resolutions[item.contradiction_id])) {
      fail("Select one owner resolution for every contradiction.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let canonical = draft;
      if (changed) {
        const version = await workspaceJson<StructuredStandardRequestV1>(
          `/api/v1/requests/${encodeURIComponent(request.request_id)}/versions`,
          {
            method: "POST",
            headers: { "Idempotency-Key": idempotencyKey("standard-version") },
            body: JSON.stringify({ structured_request: draft }),
          },
          session.csrf_token,
        );
        canonical = version.body;
        setBaseline(canonical);
        setDraft(canonical);
        setResolutions({});
        if (
          canonical.contradictions.some(
            (item) => item.resolution_state === "unresolved",
          )
        ) {
          fail(
            "Canonical edits created a new immutable version. Review its regenerated contradictions before confirmation.",
          );
          return;
        }
      }
      const confirmation = await workspaceJson<{ version: number }>(
        `/api/v1/requests/${encodeURIComponent(canonical.request_id)}/versions/${canonical.version}/confirmation`,
        {
          method: "POST",
          headers: {
            "Idempotency-Key": idempotencyKey("standard-confirmation"),
          },
          body: JSON.stringify({
            accepted: true,
            contradiction_resolutions: unresolved.map((item) => ({
              contradiction_id: item.contradiction_id,
              selected_alternative: resolutions[item.contradiction_id],
              reason_english:
                "The request owner selected this canonical alternative.",
            })),
          }),
        },
        session.csrf_token,
      );
      const run = await workspaceJson<{ run_id: string }>(
        "/api/v1/runs",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("standard-run") },
          body: JSON.stringify({
            request_id: canonical.request_id,
            canonical_request_version: confirmation.body.version,
          }),
        },
        session.csrf_token,
      );
      onRun(run.body.run_id);
    } catch (reason) {
      fail(
        reason instanceof Error
          ? reason.message
          : "Canonical confirmation failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="standard-section" aria-labelledby="canonical-heading">
      <p className="eyebrow">Canonical review</p>
      <h2 id="canonical-heading">Confirm the canonical English request</h2>
      <p className="lede">
        Source language: <strong>{draft.source_language}</strong>. Canonical
        language: <strong>English</strong>.
      </p>
      <p>
        Pack {draft.domain_pack.category_id.replaceAll("_", " ")} · registry{" "}
        {draft.domain_pack.registry_version} · version {draft.version}
      </p>
      <p className="validation-summary" role="status">
        Readiness: <strong>{draft.readiness.replaceAll("_", " ")}</strong>
      </p>
      {versionHistory.length > 0 ? (
        <details className="canonical-card">
          <summary>
            Immutable canonical version history ({versionHistory.length})
          </summary>
          <ol>
            {versionHistory.map((version) => (
              <li key={version.canonical_version_id}>
                Version {version.version} ·{" "}
                {version.readiness.replaceAll("_", " ")} ·{" "}
                <time dateTime={version.created_at}>
                  {new Date(version.created_at).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {error ? (
        <div
          className="error-summary"
          role="alert"
          tabIndex={-1}
          ref={errorRef}
        >
          {error}
        </div>
      ) : null}
      <div className="canonical-grid">
        {draft.fields.map((field) => (
          <div className="canonical-field" key={field.field_id}>
            <label htmlFor={`canonical-${field.field_id}`}>
              {field.field_id}
            </label>
            <select
              aria-label={`${field.field_id} value state`}
              value={field.typed_value.value_state}
              onChange={(event) =>
                updateState(
                  field.field_id,
                  event.target.value as StandardValueState,
                )
              }
            >
              <option value="provided">Provided</option>
              <option value="explicitly_unknown">Explicitly unknown</option>
              <option value="empty">Empty</option>
              <option value="not_asked">Not asked</option>
              <option value="not_applicable">Not applicable</option>
            </select>
            {field.typed_value.value_state === "provided" ? (
              <div className="standard-value-grid">
                <input
                  id={`canonical-${field.field_id}`}
                  aria-label={`${field.field_id} canonical English value`}
                  lang="en"
                  value={field.typed_value.value}
                  onChange={(event) =>
                    updateProvided(field.field_id, event.target.value)
                  }
                />
                <input
                  aria-label={`${field.field_id} canonical unit`}
                  lang="en"
                  value={field.typed_value.unit ?? ""}
                  onChange={(event) =>
                    updateProvidedMetadata(
                      field.field_id,
                      "unit",
                      event.target.value,
                    )
                  }
                  placeholder="Unit, if applicable"
                />
                <input
                  aria-label={`${field.field_id} canonical raw expression`}
                  lang="en"
                  value={field.typed_value.raw_expression ?? ""}
                  onChange={(event) =>
                    updateProvidedMetadata(
                      field.field_id,
                      "raw_expression",
                      event.target.value,
                    )
                  }
                  placeholder="Raw expression, if applicable"
                />
              </div>
            ) : (
              <p>{field.typed_value.value_state.replaceAll("_", " ")}</p>
            )}
            <small
              className={
                field.confidence < 0.8 ? "low-confidence-marker" : undefined
              }
            >
              {field.translated
                ? "Translated to English"
                : "Already canonical English"}{" "}
              · {field.confidence < 0.8 ? "low confidence" : "confidence"}{" "}
              {Math.round(field.confidence * 100)}%
            </small>
          </div>
        ))}
      </div>
      {draft.conditional_requirements.length > 0 ? (
        <section aria-labelledby="conditional-review">
          <h3 id="conditional-review">Conditional requirements</h3>
          {draft.conditional_requirements.map((item) => (
            <article className="canonical-card" key={item.requirement_id}>
              <p>
                <strong>If:</strong> {item.canonical_english_condition}
              </p>
              <p>
                <strong>Required:</strong> {item.canonical_english_result}
              </p>
              <small>
                Literal source span validated with{" "}
                {item.source_validation.algorithm}; source text discarded.
              </small>
            </article>
          ))}
        </section>
      ) : null}
      {unresolved.length > 0 ? (
        <section aria-labelledby="contradictions-heading">
          <h3 id="contradictions-heading">Resolve contradictions</h3>
          {unresolved.map((item) => (
            <fieldset key={item.contradiction_id}>
              <legend>{item.contradiction_class.replaceAll("_", " ")}</legend>
              {item.alternatives.map((alternative) => (
                <label key={alternative.alternative_id} className="radio-row">
                  <input
                    type="radio"
                    name={item.contradiction_id}
                    value={alternative.alternative_id}
                    checked={
                      resolutions[item.contradiction_id] ===
                      alternative.alternative_id
                    }
                    onChange={() =>
                      setResolutions((current) => ({
                        ...current,
                        [item.contradiction_id]: alternative.alternative_id,
                      }))
                    }
                  />
                  {alternative.canonical_english_value}
                </label>
              ))}
            </fieldset>
          ))}
        </section>
      ) : null}
      <div className="form-actions">
        <button
          className="secondary-action"
          type="button"
          onClick={onBack}
          disabled={busy}
        >
          Back
        </button>
        <button
          className="primary-action"
          type="button"
          onClick={() => void confirmAndRun()}
          disabled={busy}
        >
          {busy ? "Confirming…" : "Confirm and start synthetic research"}
        </button>
      </div>
    </section>
  );
}
