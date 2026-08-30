import { type FormEvent, useMemo, useRef, useState } from "react";
import type {
  DomainPackFieldV1,
  StandardIntakeSubmissionV1,
  StandardValueState,
} from "@matchbase/contracts";
import { idempotencyKey, workspaceJson } from "./api";
import type {
  DomainPackResolutionV1,
  DomainPackV1,
  StructuredStandardRequestV1,
  WorkspaceSession,
} from "./types";

type DraftField = {
  state: StandardValueState;
  value: string;
  unit: string;
  raw: string;
};

type ConstraintDraft = {
  id: string;
  field: string;
  value: string;
  relaxable: "non_relaxable" | "relaxable";
  tolerance: string;
  direction: "higher_is_acceptable" | "lower_is_acceptable" | "exact";
};

type ConditionalDraft = {
  id: string;
  condition: string;
  result: string;
  source: string;
};

const FIELD_IMPACT = {
  product_specification:
    "Matters to category/product fit and compliance/certification fit.",
  supplier_producer_profile:
    "Matters to volume/capacity fit and positioning/brand fit.",
  trade_structure_commercial_execution:
    "Matters to price-tier fit and geographic-reach fit.",
} as const;

export function StructuredIntake({
  session,
  onCanonical,
  onCancel,
}: {
  session: WorkspaceSession;
  onCanonical: (request: StructuredStandardRequestV1) => void;
  onCancel: () => void;
}) {
  const [sourceText, setSourceText] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState<
    "en" | "fa" | "ar" | "es"
  >("en");
  const [resolution, setResolution] = useState<DomainPackResolutionV1 | null>(
    null,
  );
  const [pack, setPack] = useState<DomainPackV1 | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftField>>({});
  const [conditionals, setConditionals] = useState<ConditionalDraft[]>([]);
  const [exclusions, setExclusions] = useState<string[]>([]);
  const [constraints, setConstraints] = useState<ConstraintDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const sourceRequiredError =
    error === "Enter the transient sourcing requirement first.";

  const fields = useMemo(
    () => [...(pack?.core_fields ?? []), ...(pack?.domain_fields ?? [])],
    [pack],
  );
  const groups = useMemo(
    () =>
      [
        "product_specification",
        "supplier_producer_profile",
        "trade_structure_commercial_execution",
      ] as const,
    [],
  );

  function fail(message: string) {
    setError(message);
    requestAnimationFrame(() => errorRef.current?.focus());
  }

  function updateConstraint(id: string, update: Partial<ConstraintDraft>) {
    setConstraints((current) =>
      current.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
  }

  function updateConditional(id: string, update: Partial<ConditionalDraft>) {
    setConditionals((current) =>
      current.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
  }

  async function resolveCategory(confirmedCategoryId?: string) {
    if (!sourceText.trim()) {
      setError("Enter the transient sourcing requirement first.");
      requestAnimationFrame(() => sourceRef.current?.focus());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { body } = await workspaceJson<DomainPackResolutionV1>(
        "/api/v1/domain-packs/resolution",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("domain-pack") },
          body: JSON.stringify({
            source_text: sourceText,
            ...(confirmedCategoryId
              ? { confirmed_category_id: confirmedCategoryId }
              : {}),
          }),
        },
        session.csrf_token,
      );
      setResolution(body);
      if (body.activation_state === "confirmed") {
        const response = await workspaceJson<DomainPackV1>(
          `/api/v1/domain-packs/${encodeURIComponent(body.category_id)}`,
          { headers: { "MB-Domain-Pack-Activation": body.activation_token } },
        );
        setPack(response.body);
        const initial = Object.fromEntries(
          [...response.body.core_fields, ...response.body.domain_fields].map(
            (field) => [
              field.field_id,
              {
                state: "empty",
                value: "",
                unit: "",
                raw: "",
              } satisfies DraftField,
            ],
          ),
        );
        setDrafts(initial);
      }
    } catch (reason) {
      fail(
        reason instanceof Error
          ? reason.message
          : "Category resolution failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  function updateField(fieldId: string, update: Partial<DraftField>) {
    setDrafts((current) => ({
      ...current,
      [fieldId]: {
        ...(current[fieldId] ?? {
          state: "empty",
          value: "",
          unit: "",
          raw: "",
        }),
        ...update,
      },
    }));
  }

  function fieldControl(field: DomainPackFieldV1) {
    const draft = drafts[field.field_id] ?? {
      state: "empty",
      value: "",
      unit: "",
      raw: "",
    };
    return (
      <div className="standard-field" key={field.field_id}>
        <label htmlFor={`state-${field.field_id}`}>
          {field.label}{" "}
          <span className="requirement-tag">{field.requirement}</span>
        </label>
        <p className="field-hint">
          {field.description} {FIELD_IMPACT[field.macro_parameter]}
        </p>
        <select
          id={`state-${field.field_id}`}
          value={draft.state}
          onChange={(event) =>
            updateField(field.field_id, {
              state: event.target.value as StandardValueState,
            })
          }
        >
          <option value="provided">Provided</option>
          <option value="explicitly_unknown">Explicitly unknown</option>
          <option value="empty">Empty</option>
          <option value="not_asked">Not asked</option>
          <option value="not_applicable">Not applicable</option>
        </select>
        {draft.state === "provided" ? (
          <div className="standard-value-grid">
            {field.allowed_values.length > 0 ? (
              <select
                aria-label={`${field.label} value`}
                value={draft.value}
                onChange={(event) =>
                  updateField(field.field_id, { value: event.target.value })
                }
                required={field.requirement === "required"}
              >
                <option value="">Select value</option>
                {field.allowed_values.map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            ) : field.kind === "boolean" ? (
              <select
                aria-label={`${field.label} value`}
                value={draft.value}
                onChange={(event) =>
                  updateField(field.field_id, { value: event.target.value })
                }
                required={field.requirement === "required"}
              >
                <option value="">Select value</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <input
                aria-label={`${field.label} value`}
                dir="auto"
                value={draft.value}
                inputMode={
                  ["integer", "decimal", "quantity"].includes(field.kind)
                    ? "decimal"
                    : "text"
                }
                onChange={(event) =>
                  updateField(field.field_id, { value: event.target.value })
                }
                required={field.requirement === "required"}
              />
            )}
            {field.allowed_units.length > 0 ? (
              <select
                aria-label={`${field.label} unit`}
                value={draft.unit}
                onChange={(event) =>
                  updateField(field.field_id, { unit: event.target.value })
                }
              >
                <option value="">Select unit</option>
                {field.allowed_units.map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </select>
            ) : null}
            <input
              aria-label={`${field.label} raw expression`}
              dir="auto"
              value={draft.raw}
              onChange={(event) =>
                updateField(field.field_id, { raw: event.target.value })
              }
              placeholder="Raw expression, if supplied"
            />
          </div>
        ) : null}
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!pack || !resolution || resolution.activation_state !== "confirmed")
      return fail("Confirm the product category before continuing.");
    for (const conditional of conditionals) {
      if (!conditional.source || !sourceText.includes(conditional.source))
        return fail(
          "Each conditional source text must be a literal substring of the transient input.",
        );
      if (!conditional.condition.trim() || !conditional.result.trim())
        return fail(
          "Each conditional requirement needs an English condition and required result.",
        );
    }
    if (
      constraints.some(
        (item) =>
          !item.field ||
          !item.value.trim() ||
          (item.relaxable === "relaxable" && !item.tolerance.trim()),
      )
    )
      return fail("Complete every added hard constraint or remove it.");
    if (exclusions.some((item) => !item.trim()))
      return fail("Complete every added exclusion or remove it.");
    const unresolvedRequired = fields.filter(
      (field) =>
        field.requirement === "required" &&
        (drafts[field.field_id]?.state ?? "empty") === "empty",
    );
    if (unresolvedRequired.length > 0)
      return fail(
        `Choose a provided, explicitly unknown, not asked, or not applicable state for every required field (${unresolvedRequired.length} remaining).`,
      );
    const submission: StandardIntakeSubmissionV1 = {
      schema_version: "standard-intake-submission.v1",
      domain_pack_activation_token: resolution.activation_token,
      source_language: sourceLanguage,
      source_text: sourceText,
      fields: fields.map((field) => {
        const value = drafts[field.field_id] ?? {
          state: "empty",
          value: "",
          unit: "",
          raw: "",
        };
        return {
          field_id: field.field_id,
          macro_parameter: field.macro_parameter,
          typed_value:
            value.state === "provided"
              ? {
                  value_state: "provided",
                  value: value.value,
                  ...(value.unit ? { unit: value.unit } : {}),
                  ...(value.raw ? { raw_expression: value.raw } : {}),
                }
              : { value_state: value.state },
        };
      }),
      hard_constraints: constraints.map((constraint) => ({
        constraint_id: constraint.id,
        field_id: constraint.field,
        operator: "equals" as const,
        target: { value_state: "provided" as const, value: constraint.value },
        ...(constraint.relaxable === "relaxable"
          ? {
              relaxability: "relaxable" as const,
              tolerance: constraint.tolerance,
              direction: constraint.direction,
            }
          : { relaxability: "non_relaxable" as const }),
      })),
      exclusions: exclusions.map((exclusion) => ({
        exclusion_id: crypto.randomUUID(),
        field_id: "named_exclusions",
        canonical_english_value: exclusion.trim(),
      })),
      conditional_requirements: conditionals.map((conditional) => ({
        requirement_id: conditional.id,
        condition: conditional.condition.trim(),
        required_result: conditional.result.trim(),
        source_text: conditional.source,
        source_start_byte: new TextEncoder().encode(
          sourceText.slice(0, sourceText.indexOf(conditional.source)),
        ).length,
        source_end_byte: new TextEncoder().encode(
          sourceText.slice(
            0,
            sourceText.indexOf(conditional.source) + conditional.source.length,
          ),
        ).length,
        requirement_level: "mandatory" as const,
      })),
    };
    setBusy(true);
    setError(null);
    try {
      const { body } = await workspaceJson<StructuredStandardRequestV1>(
        "/api/v1/requests",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("standard-request") },
          body: JSON.stringify(submission),
        },
        session.csrf_token,
      );
      setSourceText("");
      setConditionals([]);
      onCanonical(body);
    } catch (reason) {
      setSourceText("");
      setConditionals([]);
      fail(
        reason instanceof Error ? reason.message : "Canonicalization failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="standard-section" aria-labelledby="intake-heading">
      <p className="eyebrow">Structured intake</p>
      <h1 id="intake-heading" tabIndex={-1}>
        Define the sourcing request
      </h1>
      {error ? (
        <div
          className="error-summary"
          role="alert"
          tabIndex={-1}
          ref={errorRef}
          id="standard-intake-error"
        >
          {error}
        </div>
      ) : null}
      <form onSubmit={(event) => void submit(event)} className="standard-form">
        <fieldset>
          <legend>Transient source requirement</legend>
          <label htmlFor="standard-source-language">Source language</label>
          <select
            id="standard-source-language"
            value={sourceLanguage}
            onChange={(event) => {
              setSourceLanguage(
                event.target.value as "en" | "fa" | "ar" | "es",
              );
              setPack(null);
              setResolution(null);
            }}
          >
            <option value="en">English</option>
            <option value="fa">Persian</option>
            <option value="ar">Arabic</option>
            <option value="es">Spanish</option>
          </select>
          <label htmlFor="standard-source">Source-language input</label>
          <textarea
            id="standard-source"
            ref={sourceRef}
            dir="auto"
            aria-invalid={sourceRequiredError}
            aria-describedby={
              sourceRequiredError
                ? "standard-source-hint standard-intake-error"
                : "standard-source-hint"
            }
            value={sourceText}
            onChange={(event) => {
              setSourceText(event.target.value);
              setPack(null);
              setResolution(null);
            }}
            required
          />
          <p className="field-hint" id="standard-source-hint">
            Validated synchronously, canonicalized to English, then discarded.
          </p>
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={() => void resolveCategory()}
          >
            Resolve product category
          </button>
        </fieldset>
        {resolution?.activation_state === "confirmation_required" ? (
          <div className="validation-summary" role="status">
            <h2>Confirm the product category</h2>
            <p>
              The deterministic resolver needs owner confirmation for{" "}
              {resolution.category_id.replaceAll("_", " ")}.
            </p>
            <button
              type="button"
              className="primary-action"
              onClick={() => void resolveCategory(resolution.category_id)}
            >
              Confirm category
            </button>
          </div>
        ) : null}
        {pack
          ? groups.map((group, index) => (
              <details
                className="standard-disclosure"
                key={group}
                open={index === 0}
              >
                <summary>
                  {index + 1}. {group.replaceAll("_", " ")}
                </summary>
                <div className="standard-field-grid">
                  {fields
                    .filter((field) => field.macro_parameter === group)
                    .map(fieldControl)}
                </div>
              </details>
            ))
          : null}
        {pack ? (
          <>
            <section aria-labelledby="constraints-heading">
              <h2 id="constraints-heading">Hard constraints</h2>
              {constraints.map((constraint, index) => (
                <fieldset key={constraint.id}>
                  <legend>Hard constraint {index + 1}</legend>
                  <label>
                    Constraint field
                    <select
                      value={constraint.field}
                      onChange={(event) =>
                        updateConstraint(constraint.id, {
                          field: event.target.value,
                        })
                      }
                    >
                      <option value="">Select field</option>
                      {fields.map((field) => (
                        <option key={field.field_id} value={field.field_id}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Required value
                    <input
                      dir="auto"
                      value={constraint.value}
                      onChange={(event) =>
                        updateConstraint(constraint.id, {
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Relaxability
                    <select
                      value={constraint.relaxable}
                      onChange={(event) =>
                        updateConstraint(constraint.id, {
                          relaxable: event.target
                            .value as ConstraintDraft["relaxable"],
                        })
                      }
                    >
                      <option value="non_relaxable">Cannot be relaxed</option>
                      <option value="relaxable">May be relaxed</option>
                    </select>
                  </label>
                  {constraint.relaxable === "relaxable" ? (
                    <div className="standard-value-grid">
                      <label>
                        Tolerance
                        <input
                          dir="auto"
                          value={constraint.tolerance}
                          onChange={(event) =>
                            updateConstraint(constraint.id, {
                              tolerance: event.target.value,
                            })
                          }
                          required
                        />
                      </label>
                      <label>
                        Direction
                        <select
                          value={constraint.direction}
                          onChange={(event) =>
                            updateConstraint(constraint.id, {
                              direction: event.target
                                .value as ConstraintDraft["direction"],
                            })
                          }
                        >
                          <option value="exact">Exact alternative</option>
                          <option value="higher_is_acceptable">
                            Higher is acceptable
                          </option>
                          <option value="lower_is_acceptable">
                            Lower is acceptable
                          </option>
                        </select>
                      </label>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setConstraints((current) =>
                        current.filter((item) => item.id !== constraint.id),
                      )
                    }
                  >
                    Remove constraint
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                className="secondary-action"
                onClick={() =>
                  setConstraints((current) => [
                    ...current,
                    {
                      id: crypto.randomUUID(),
                      field: "",
                      value: "",
                      relaxable: "non_relaxable",
                      tolerance: "",
                      direction: "exact",
                    },
                  ])
                }
              >
                Add hard constraint
              </button>
            </section>
            <section aria-labelledby="exclusions-heading">
              <h2 id="exclusions-heading">Named exclusions</h2>
              {exclusions.map((exclusion, index) => (
                <label key={`exclusion-${index}`}>
                  Exclusion {index + 1}
                  <input
                    dir="auto"
                    value={exclusion}
                    onChange={(event) =>
                      setExclusions((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? event.target.value : item,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setExclusions((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    Remove exclusion
                  </button>
                </label>
              ))}
              <button
                type="button"
                className="secondary-action"
                onClick={() => setExclusions((current) => [...current, ""])}
              >
                Add exclusion
              </button>
            </section>
            <section aria-labelledby="conditionals-heading">
              <h2 id="conditionals-heading">Conditional requirements</h2>
              {conditionals.map((conditional, index) => (
                <fieldset key={conditional.id}>
                  <legend>Conditional requirement {index + 1}</legend>
                  <label>
                    Condition
                    <input
                      dir="auto"
                      value={conditional.condition}
                      onChange={(event) =>
                        updateConditional(conditional.id, {
                          condition: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Required result
                    <input
                      dir="auto"
                      value={conditional.result}
                      onChange={(event) =>
                        updateConditional(conditional.id, {
                          result: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Verbatim source substring
                    <textarea
                      dir="auto"
                      value={conditional.source}
                      onChange={(event) =>
                        updateConditional(conditional.id, {
                          source: event.target.value,
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setConditionals((current) =>
                        current.filter((item) => item.id !== conditional.id),
                      )
                    }
                  >
                    Remove conditional requirement
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                className="secondary-action"
                onClick={() =>
                  setConditionals((current) => [
                    ...current,
                    {
                      id: crypto.randomUUID(),
                      condition: "",
                      result: "",
                      source: "",
                    },
                  ])
                }
              >
                Add conditional requirement
              </button>
            </section>
            <div className="form-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={onCancel}
              >
                Cancel
              </button>
              <button className="primary-action" disabled={busy}>
                Prepare canonical English
              </button>
            </div>
          </>
        ) : null}
      </form>
    </section>
  );
}
