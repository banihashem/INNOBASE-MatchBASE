"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getSearchDimensionRegistry,
  type SearchDimensionConfiguration,
  type SearchDimensionDefinition,
  type SearchDimensionSelection,
} from "@matchbase/contracts";
import { workflowMutationHeaders } from "./workflow-request";
import { errorMessage } from "./workflow-response";
import "./search-dimensions.css";

type ValueType = SearchDimensionDefinition["value_type"];
type Severity = SearchDimensionSelection["severity"];

interface SearchDimensionsPanelProps {
  runId: string;
  configuration: SearchDimensionConfiguration | null;
  revision: string | null;
  editable: boolean;
  onPendingChange: (pending: boolean) => void;
  onSaved: (session: any) => void;
}

const registry = getSearchDimensionRegistry();
const kinds: Array<{ id: SearchDimensionDefinition["kind"]; label: string }> = [
  { id: "capability", label: "Supplier and service fit" },
  { id: "commercial", label: "Price and terms" },
  { id: "evidence_policy", label: "Evidence checks" },
  { id: "comparison_policy", label: "Comparison rules" },
  { id: "search_policy", label: "Search coverage" },
];

function selectionFor(
  configuration: SearchDimensionConfiguration,
  definition: SearchDimensionDefinition,
): SearchDimensionSelection {
  return (
    configuration.selections.find(
      (selection) => selection.dimension_id === definition.id,
    ) ?? {
      selection_id: definition.id,
      dimension_id: definition.id,
      active: definition.default_active,
      severity: definition.default_severity,
      operator: "research",
      scope: { lot_id: "default", subject_id: "request" },
    }
  );
}

function expectedText(value: SearchDimensionSelection["expected"]): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object")
    return `${value.min ?? ""}..${value.max ?? ""}`;
  return String(value);
}

function expectedValue(
  text: string,
  type: ValueType,
): SearchDimensionSelection["expected"] {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (type === "number") return Number(trimmed);
  if (type === "boolean") return trimmed === "true";
  if (type === "string_set")
    return trimmed
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  if (type === "range") {
    const parts = trimmed.split("..");
    const min = Number(parts[0]);
    const max = Number(parts[1]);
    return { min, max };
  }
  return trimmed;
}

export function SearchDimensionsPanel({
  runId,
  configuration,
  revision,
  editable,
  onPendingChange,
  onSaved,
}: SearchDimensionsPanelProps) {
  const [draft, setDraft] = useState<SearchDimensionConfiguration | null>(
    configuration,
  );
  const [baseRevision, setBaseRevision] = useState(revision);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customType, setCustomType] = useState<ValueType>("text");
  const [customProfile, setCustomProfile] = useState("core");
  const [customExpected, setCustomExpected] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const [valueDrafts, setValueDrafts] = useState<Record<string, string>>({});
  const [valueErrors, setValueErrors] = useState<Record<string, string>>({});

  const serverChanged = dirty && revision !== baseRevision;
  useEffect(() => {
    if (!dirty && !saving) {
      setDraft(configuration);
      setBaseRevision(revision);
    }
  }, [configuration, revision, dirty, saving]);
  useEffect(() => {
    onPendingChange(
      editable && (dirty || saving || !draft || !baseRevision || serverChanged),
    );
  }, [
    dirty,
    saving,
    draft,
    baseRevision,
    editable,
    serverChanged,
    onPendingChange,
  ]);

  const definitions = useMemo(() => {
    if (!draft) return [];
    return [...registry.definitions, ...draft.custom_definitions].filter(
      (definition) =>
        definition.profile_ids.includes("core") ||
        definition.profile_ids.some((id) => draft.profile_ids.includes(id)),
    );
  }, [draft]);
  const selectedCount = draft
    ? definitions.filter((definition) => selectionFor(draft, definition).active)
        .length
    : 0;
  const visible = definitions.filter((definition) => {
    if (selectedOnly && !selectionFor(draft!, definition).active) return false;
    const term = query.trim().toLowerCase();
    return (
      !term ||
      `${definition.label} ${definition.description}`
        .toLowerCase()
        .includes(term)
    );
  });

  function mutate(next: SearchDimensionConfiguration) {
    setDraft(next);
    setDirty(true);
    setError(null);
  }

  function editExpected(definition: SearchDimensionDefinition, text: string) {
    setValueDrafts((current) => ({ ...current, [definition.id]: text }));
    const validRange = /^\s*-?\d+(?:\.\d+)?\s*\.\.\s*-?\d+(?:\.\d+)?\s*$/.test(
      text,
    );
    const invalid =
      definition.value_type === "range" &&
      text.trim() &&
      (!validRange ||
        (() => {
          const parts = text.split("..").map(Number);
          return parts[0]! > parts[1]!;
        })());
    const invalidNumber =
      definition.value_type === "number" &&
      text.trim() &&
      !Number.isFinite(Number(text));
    if (invalid || invalidNumber) {
      setValueErrors((current) => ({
        ...current,
        [definition.id]: "Enter a valid expected value.",
      }));
      setDirty(true);
      return;
    }
    setValueErrors((current) => {
      const next = { ...current };
      delete next[definition.id];
      return next;
    });
    const expected = expectedValue(text, definition.value_type);
    updateSelection(definition, {
      operator: expected === undefined ? "research" : "equals",
      ...(expected === undefined ? {} : { expected }),
    });
  }

  function updateSelection(
    definition: SearchDimensionDefinition,
    changes: Partial<SearchDimensionSelection>,
  ) {
    if (
      !draft ||
      !editable ||
      definition.locked ||
      configuration?.selections.some(
        (item) =>
          item.dimension_id === definition.id && item.original_requirement,
      )
    )
      return;
    const existing = selectionFor(draft, definition);
    const nextSelection = { ...existing, ...changes };
    if (nextSelection.operator === "research") delete nextSelection.expected;
    if (changes.severity && changes.severity !== "mandatory")
      delete nextSelection.original_requirement;
    mutate({
      ...draft,
      selections: [
        ...draft.selections.filter(
          (item) => item.dimension_id !== definition.id,
        ),
        nextSelection,
      ],
    });
  }

  function selectVisible(
    kind: SearchDimensionDefinition["kind"],
    active: boolean,
  ) {
    if (!draft || !editable) return;
    const eligible = visible.filter(
      (definition) =>
        definition.kind === kind &&
        !definition.locked &&
        selectionFor(draft, definition).severity !== "mandatory" &&
        !configuration?.selections.some(
          (item) =>
            item.dimension_id === definition.id && item.original_requirement,
        ),
    );
    const ids = new Set(eligible.map((definition) => definition.id));
    if (!eligible.length) return;
    mutate({
      ...draft,
      selections: [
        ...draft.selections.filter(
          (selection) => !ids.has(selection.dimension_id),
        ),
        ...eligible.map((definition) => ({
          ...selectionFor(draft, definition),
          active,
        })),
      ],
    });
    if (selectedOnly && !active)
      requestAnimationFrame(() =>
        document.getElementById("search-dimension-query")?.focus(),
      );
  }

  function toggleProfile(profileId: string, active: boolean) {
    if (!draft || !editable) return;
    if (
      !active &&
      (draft.custom_definitions.some((definition) =>
        definition.profile_ids.includes(profileId),
      ) ||
        draft.selections.some(
          (selection) =>
            selection.original_requirement &&
            registry.definitions
              .find((definition) => definition.id === selection.dimension_id)
              ?.profile_ids.includes(profileId),
        ))
    ) {
      setError(
        "This profile has a custom or explicit request dimension. Keep it selected to preserve that requirement.",
      );
      return;
    }
    const profileIds = active
      ? [...draft.profile_ids, profileId]
      : draft.profile_ids.filter((id) => id !== profileId);
    const definitions = registry.definitions.filter((definition) =>
      definition.profile_ids.some((id) => profileIds.includes(id)),
    );
    setValueDrafts({});
    setValueErrors({});
    mutate({
      ...draft,
      profile_ids: profileIds,
      selections: [
        ...definitions.map((definition) => selectionFor(draft, definition)),
        ...draft.selections.filter((selection) =>
          draft.custom_definitions.some(
            (definition) => definition.id === selection.dimension_id,
          ),
        ),
      ],
    });
  }

  function addCustom() {
    if (!draft || !editable) return;
    if (draft.custom_definitions.length >= 16) {
      setCustomError(
        "At most sixteen private dimensions are available in this category.",
      );
      return;
    }
    const label = customLabel.trim();
    const description = customDescription.trim();
    if (
      label.length < 3 ||
      label.length > 80 ||
      description.length < 10 ||
      description.length > 300
    ) {
      setCustomError(
        "Use a 3–80 character label and a 10–300 character description.",
      );
      return;
    }
    if (
      customExpected.trim() &&
      customType === "number" &&
      !Number.isFinite(Number(customExpected))
    ) {
      setCustomError("Enter a valid number.");
      return;
    }
    if (
      customExpected.trim() &&
      customType === "range" &&
      !/^\s*-?\d+(?:\.\d+)?\s*\.\.\s*-?\d+(?:\.\d+)?\s*$/.test(customExpected)
    ) {
      setCustomError("Enter a range as minimum..maximum.");
      return;
    }
    const id = `custom.d${Array.from(
      crypto.getRandomValues(new Uint32Array(4)),
      (value) => value.toString(16).padStart(8, "0"),
    ).join("")}`;
    const profile = draft.profile_ids.includes(customProfile)
      ? customProfile
      : "core";
    const definition: SearchDimensionDefinition = {
      id,
      revision: 1,
      label,
      description,
      kind: "capability",
      value_type: customType,
      profile_ids: [profile],
      default_active: true,
      default_severity: "preferred",
      applicability: "always",
      locked: false,
      allowed_operators: ["research", "equals"],
    };
    const expected = expectedValue(customExpected, customType);
    mutate({
      ...draft,
      custom_definitions: [...draft.custom_definitions, definition],
      selections: [
        ...draft.selections,
        {
          selection_id: id,
          dimension_id: id,
          active: true,
          severity: "preferred",
          operator: expected === undefined ? "research" : "equals",
          ...(expected === undefined ? {} : { expected }),
          scope: { lot_id: "default", subject_id: "request" },
        },
      ],
    });
    setCustomLabel("");
    setCustomDescription("");
    setCustomExpected("");
    setCustomError(null);
    setCustomOpen(false);
  }

  async function save() {
    if (!draft || !editable || saving || serverChanged) return;
    if (Object.keys(valueErrors).length) {
      setError("Correct the expected values before saving.");
      return;
    }
    if (
      draft.selections.some(
        (selection) =>
          selection.active &&
          selection.severity === "mandatory" &&
          !selection.original_requirement?.trim(),
      )
    ) {
      setError(
        "Every mandatory dimension needs exact wording from your submitted request.",
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: workflowMutationHeaders(),
        body: JSON.stringify({
          action: "save_search_dimensions",
          run_id: runId,
          expected_revision: baseRevision,
          configuration: draft,
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.success || !body.session) {
        throw new Error(
          errorMessage(body, "Search dimensions could not be saved."),
        );
      }
      setDraft(body.session.search_dimensions);
      setBaseRevision(body.session.search_dimension_revision ?? null);
      setDirty(false);
      setValueDrafts({});
      onSaved(body.session);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Search dimensions could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return (
      <section className="search-dimensions" aria-label="Search dimensions">
        <h3>Search dimensions</h3>
        <p>
          {editable
            ? "Preparing search dimensions…"
            : "This saved research has no dimension settings."}
        </p>
      </section>
    );
  }

  return (
    <section
      className="search-dimensions"
      aria-labelledby="search-dimensions-heading"
    >
      <div className="search-dimensions-heading">
        <div>
          <p className="search-dimensions-eyebrow">Research scope</p>
          <h3 id="search-dimensions-heading">Search dimensions</h3>
          <p>
            Choose what to investigate. Your three-box request and required
            checks remain part of the approved plan.
          </p>
        </div>
        <span className="search-dimensions-count">
          {selectedCount} selected
        </span>
      </div>
      <div className="search-dimensions-profile">
        <p className="search-dimensions-profile-label">
          Industry research profiles
        </p>
        <p>
          Suggested profiles are provisional. Select relevant research
          checklists; this does not change the saved request classification or
          assign lots.
        </p>
        <div className="search-dimensions-profile-choices">
          {registry.profiles
            .filter((profile) => profile.id !== "core")
            .map((profile) => (
              <label key={profile.id}>
                <input
                  type="checkbox"
                  checked={draft.profile_ids.includes(profile.id)}
                  disabled={!editable || saving}
                  onChange={(event) =>
                    toggleProfile(profile.id, event.target.checked)
                  }
                />
                <span>{profile.label}</span>
              </label>
            ))}
        </div>
      </div>
      {draft.requirement_expression && (
        <p className="search-dimensions-grouping-note">
          This request has approved mandatory grouping. Change its
          interpretation to revise mandatory rules.
        </p>
      )}
      <details className="search-dimensions-browser">
        <summary>Review dimensions and add priorities</summary>
        <div className="search-dimensions-tools">
          <label htmlFor="search-dimension-query">Find a dimension</label>
          <input
            id="search-dimension-query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or description"
          />
          <label className="search-dimensions-selected-only">
            <input
              type="checkbox"
              checked={selectedOnly}
              onChange={(event) => setSelectedOnly(event.target.checked)}
            />
            Show selected only
          </label>
          <p role="status">
            {visible.length} shown · {selectedCount} selected
          </p>
        </div>
        {kinds.map((kind) => {
          const group = visible.filter(
            (definition) => definition.kind === kind.id,
          );
          if (!group.length) return null;
          const optional = group.filter(
            (definition) =>
              !definition.locked &&
              selectionFor(draft, definition).severity !== "mandatory" &&
              !configuration?.selections.some(
                (selection) =>
                  selection.dimension_id === definition.id &&
                  selection.original_requirement,
              ),
          );
          return (
            <div className="search-dimensions-group" key={kind.id}>
              <div className="search-dimensions-group-heading">
                <h4>
                  {kind.label} <span>({group.length})</span>
                </h4>
                {editable && optional.length > 0 && (
                  <div className="search-dimensions-bulk">
                    <button
                      type="button"
                      onClick={() => selectVisible(kind.id, true)}
                    >
                      Select shown optional
                    </button>
                    <button
                      type="button"
                      onClick={() => selectVisible(kind.id, false)}
                    >
                      Clear shown optional
                    </button>
                  </div>
                )}
              </div>
              {group.map((definition) => {
                const selection = selectionFor(draft, definition);
                const protectedRequirement = Boolean(
                  configuration?.selections.some(
                    (item) =>
                      item.dimension_id === definition.id &&
                      item.original_requirement,
                  ),
                );
                return (
                  <div className="search-dimensions-row" key={definition.id}>
                    <label className="search-dimensions-choice">
                      <input
                        type="checkbox"
                        checked={selection.active || definition.locked}
                        disabled={
                          !editable ||
                          saving ||
                          definition.locked ||
                          protectedRequirement ||
                          selection.severity === "mandatory"
                        }
                        onChange={(event) =>
                          updateSelection(definition, {
                            active: event.target.checked,
                          })
                        }
                      />
                      <span>
                        <strong dir="auto">{definition.label}</strong>
                        <small dir="auto">{definition.description}</small>
                      </span>
                    </label>
                    {definition.locked && (
                      <span className="search-dimensions-locked">
                        Required check · cannot be removed
                      </span>
                    )}
                    {protectedRequirement && (
                      <span className="search-dimensions-locked">
                        Explicit request requirement · cannot be removed here
                      </span>
                    )}
                    {!definition.locked &&
                      selection.active &&
                      editable &&
                      !protectedRequirement && (
                        <div className="search-dimensions-row-controls">
                          <label>
                            Priority
                            <select
                              value={selection.severity}
                              disabled={saving}
                              onChange={(event) =>
                                updateSelection(definition, {
                                  severity: event.target.value as Severity,
                                })
                              }
                            >
                              <option value="informational">Investigate</option>
                              <option value="preferred">Preferred</option>
                              <option
                                value="mandatory"
                                disabled={Boolean(draft.requirement_expression)}
                              >
                                Mandatory
                              </option>
                            </select>
                          </label>
                          {definition.value_type !== "boolean" && (
                            <label>
                              Expected value (optional)
                              <input
                                type={
                                  definition.value_type === "number"
                                    ? "number"
                                    : "text"
                                }
                                value={
                                  valueDrafts[definition.id] ??
                                  expectedText(selection.expected)
                                }
                                disabled={saving}
                                placeholder={
                                  definition.value_type === "range"
                                    ? "minimum..maximum"
                                    : "Leave blank to investigate"
                                }
                                onChange={(event) =>
                                  editExpected(definition, event.target.value)
                                }
                              />
                              {valueErrors[definition.id] && (
                                <span className="search-dimensions-error">
                                  {valueErrors[definition.id]}
                                </span>
                              )}
                            </label>
                          )}
                          {selection.severity === "mandatory" && (
                            <label className="search-dimensions-requirement">
                              Exact wording from your submitted request
                              <input
                                value={selection.original_requirement ?? ""}
                                maxLength={3000}
                                disabled={saving}
                                onChange={(event) =>
                                  updateSelection(definition, {
                                    original_requirement: event.target.value,
                                  })
                                }
                              />
                            </label>
                          )}
                        </div>
                      )}
                    {selection.active && !editable && (
                      <p className="search-dimensions-saved-value">
                        {selection.severity === "mandatory"
                          ? "Mandatory"
                          : selection.severity === "preferred"
                            ? "Preferred"
                            : "Investigate"}
                        {selection.expected === undefined
                          ? ""
                          : ` · Expected: ${expectedText(selection.expected)}`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="search-dimensions-empty">
            No dimensions match this filter.
          </p>
        )}
      </details>
      {editable && (
        <details
          className="search-dimensions-custom"
          open={customOpen}
          onToggle={(event) => setCustomOpen(event.currentTarget.open)}
        >
          <summary>Add a custom dimension</summary>
          <div className="search-dimensions-custom-grid">
            <label>
              Label
              <input
                maxLength={80}
                value={customLabel}
                dir="auto"
                onChange={(event) => setCustomLabel(event.target.value)}
              />
            </label>
            <label>
              Description
              <textarea
                maxLength={300}
                rows={2}
                value={customDescription}
                dir="auto"
                onChange={(event) => setCustomDescription(event.target.value)}
              />
            </label>
            <label>
              Value type
              <select
                value={customType}
                onChange={(event) =>
                  setCustomType(event.target.value as ValueType)
                }
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Yes or no</option>
                <option value="string_set">List</option>
                <option value="range">Number range</option>
              </select>
            </label>
            <label>
              Research profile
              <select
                value={
                  draft.profile_ids.includes(customProfile)
                    ? customProfile
                    : "core"
                }
                onChange={(event) => setCustomProfile(event.target.value)}
              >
                {registry.profiles
                  .filter((profile) => draft.profile_ids.includes(profile.id))
                  .map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Expected value (optional)
              {customType === "boolean" ? (
                <select
                  value={customExpected}
                  dir="auto"
                  onChange={(event) => setCustomExpected(event.target.value)}
                >
                  <option value="">Investigate</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <input
                  value={customExpected}
                  dir="auto"
                  onChange={(event) => setCustomExpected(event.target.value)}
                  placeholder={
                    customType === "range"
                      ? "minimum..maximum"
                      : "Leave blank to investigate"
                  }
                />
              )}
            </label>
          </div>
          {customError && (
            <p role="alert" className="search-dimensions-error">
              {customError}
            </p>
          )}
          <button
            type="button"
            className="search-dimensions-add"
            onClick={addCustom}
          >
            Add dimension to this request
          </button>
        </details>
      )}
      <div className="search-dimensions-footer">
        <p role="status">
          {serverChanged
            ? "These settings changed in another view. Reload the saved version before editing."
            : saving
              ? "Saving dimensions…"
              : dirty
                ? "Unsaved dimension changes. Save before approving."
                : editable && !baseRevision
                  ? "Save these dimensions before approving."
                  : "Dimension settings are saved."}
        </p>
        {serverChanged && (
          <button
            type="button"
            onClick={() => {
              setDraft(configuration);
              setBaseRevision(revision);
              setDirty(false);
              setError(null);
            }}
          >
            Load saved settings
          </button>
        )}
        {editable && (
          <button
            type="button"
            className="search-dimensions-save"
            disabled={
              (!dirty && Boolean(baseRevision)) || saving || serverChanged
            }
            onClick={() => void save()}
          >
            Save dimensions
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="search-dimensions-error">
          {error} Your changes remain on this page.
        </p>
      )}
      {!editable && (
        <p className="search-dimensions-readonly">
          These dimensions belong to the saved research plan and can no longer
          be edited.
        </p>
      )}
    </section>
  );
}
