import {
  CONSULTANT_REPORT_DIMENSIONS,
  CONSULTANT_REPORT_MODEL_VERSION,
  EXPLICIT_EMPTY_TEXT,
  MATCHBASE_BRAND_MANIFEST_VERSION,
  REPORT_SECTION_IDS,
  REPORT_SECTION_REGISTRY,
  type BudgetedTextV1,
  type CitationReferenceV1,
  type ConsultantReportModelV1,
  type ConsultantReportSectionV1,
  type ReportContentBlockV1,
  type ReportSectionId,
  type ReportSourceReferenceV1,
} from "./model.js";
import { canonicalSerialize, canonicalSha256 } from "./canonical.js";

export type ReportGateId =
  | "MODEL"
  | "G4"
  | "G6"
  | "G7"
  | "DECLARED_BUDGET_PREFLIGHT"
  | "HAND-09"
  | "LINEAGE_PREFLIGHT";
export type ReportFailureKind = "schema" | "missing_source" | "content_gate";

export interface ReportValidationFailure {
  readonly kind: ReportFailureKind;
  readonly gate_id: ReportGateId;
  readonly check_key:
    | "model_schema"
    | "citation_completeness"
    | "weight_fidelity"
    | "required_sections_present"
    | "declared_content_length_budget"
    | "plain_text_only"
    | "lineage_preflight";
  readonly code: string;
  readonly path: string;
  readonly section_id?: ReportSectionId;
  readonly claim_id?: string;
}

export interface FoundationCheckResult {
  readonly stage: "report_model_preflight";
  readonly gate_id:
    | "G4"
    | "G6"
    | "G7"
    | "DECLARED_BUDGET_PREFLIGHT"
    | "HAND-09"
    | "LINEAGE_PREFLIGHT";
  readonly check_key:
    | "citation_completeness"
    | "weight_fidelity"
    | "required_sections_present"
    | "declared_content_length_budget"
    | "plain_text_only"
    | "lineage_preflight";
  readonly outcome: "pass";
}

export interface ComposedConsultantReportV1 {
  readonly model: ConsultantReportModelV1;
  readonly canonical_model: string;
  readonly model_sha256: string;
  readonly hash_relationship: {
    readonly algorithm: "sha256";
    readonly encoding: "utf8";
    readonly hashed_value: "canonical_model";
    readonly excluded_from_hash: readonly [
      "model_sha256",
      "hash_relationship",
      "foundation_check_results",
      "authoritative_hand05",
      "full_artifact_g14",
    ];
  };
  readonly foundation_check_results: readonly FoundationCheckResult[];
  readonly authoritative_hand05: {
    readonly outcome: "not_evaluated";
    readonly release_blocked: true;
    readonly reason: "Requires a versioned field-specific trusted budget registry and renderer qualification.";
  };
  readonly full_artifact_g14: {
    readonly outcome: "not_evaluated";
    readonly release_blocked: true;
    readonly reason: "Requires the recorded model hash and the complete G1-G14 artifact QA result set.";
  };
}

export type ComposeConsultantReportResult =
  | { readonly ok: true; readonly value: ComposedConsultantReportV1 }
  | {
      readonly ok: false;
      readonly failures: readonly ReportValidationFailure[];
    };

const topLevelKeys = [
  "schema_version",
  "brand_manifest_version",
  "document_control",
  "lineage",
  "scoring_dimensions",
  "sections",
  "omitted_conditional_sections",
  "claims",
  "citations",
] as const;
const documentControlKeys = [
  "document",
  "prepared_by",
  "prepared_at",
  "classification",
  "status",
  "basis",
] as const;
const lineageKeys = [
  "artifact_version",
  "generating_run_id",
  "canonical_request_version_id",
  "projection_version_id",
  "analyst_decision_set_id",
  "result_sha256",
  "template_version",
  "page_geometry",
  "generated_by_subject_id",
  "composed_at",
] as const;
const citationKeys = [
  "claim_id",
  "url",
  "publisher",
  "published_or_updated",
  "accessed_at",
  "source_tier",
  "verification_status",
  "extracted_support",
  "corroborated_by",
  "retrieval_run_id",
] as const;

const sectionIndex = new Map(
  REPORT_SECTION_IDS.map((sectionId, index) => [sectionId, index]),
);
const sectionDefinition = new Map(
  REPORT_SECTION_REGISTRY.map((definition) => [
    definition.section_id,
    definition,
  ]),
);
const placeholderOnly =
  /^(?:n\/?a|not applicable|tbd|todo|placeholder)[.!]?$/iu;
const sha256Hex = /^[0-9a-f]{64}$/u;
const rfc3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...expected, ...optional]);
  return (
    expected.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMeaningfulString(value: unknown): value is string {
  return isNonEmptyString(value) && !placeholderOnly.test(value.trim());
}

function isStrictRfc3339(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = rfc3339.exec(value);
  if (match === null) return false;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute =
    offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (days[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  );
}

function modelFailure(code: string, path: string): ReportValidationFailure {
  return {
    kind: "schema",
    gate_id: "MODEL",
    check_key: "model_schema",
    code,
    path,
  };
}

function gateFailure(
  gateId: Exclude<ReportGateId, "MODEL">,
  checkKey:
    | "citation_completeness"
    | "weight_fidelity"
    | "required_sections_present"
    | "declared_content_length_budget"
    | "plain_text_only"
    | "lineage_preflight",
  code: string,
  path: string,
  extra: Pick<ReportValidationFailure, "section_id" | "claim_id"> = {},
  kind: ReportFailureKind = "content_gate",
): ReportValidationFailure {
  return { kind, gate_id: gateId, check_key: checkKey, code, path, ...extra };
}

function isBudgetedText(value: unknown): value is BudgetedTextV1 {
  return (
    isObject(value) &&
    hasExactKeys(value, ["value", "max_characters"]) &&
    isNonEmptyString(value.value) &&
    typeof value.max_characters === "number" &&
    Number.isSafeInteger(value.max_characters) &&
    value.max_characters > 0
  );
}

function isMeaningfulBudgetedText(value: BudgetedTextV1): boolean {
  return isMeaningfulString(value.value);
}

function validateContentBlock(value: unknown, path: string): boolean {
  if (!isObject(value) || !isNonEmptyString(value.kind)) return false;
  if (value.kind === "paragraph") {
    return hasExactKeys(value, ["kind", "text"]) && isBudgetedText(value.text);
  }
  if (value.kind === "bullet_list") {
    return (
      hasExactKeys(value, ["kind", "items"]) &&
      Array.isArray(value.items) &&
      value.items.length > 0 &&
      value.items.every(isBudgetedText)
    );
  }
  if (value.kind === "key_value") {
    return (
      hasExactKeys(value, ["kind", "entries"]) &&
      Array.isArray(value.entries) &&
      value.entries.length > 0 &&
      value.entries.every(
        (entry) =>
          isObject(entry) &&
          hasExactKeys(entry, ["label", "value"]) &&
          isBudgetedText(entry.label) &&
          isBudgetedText(entry.value),
      )
    );
  }
  if (value.kind === "table") {
    return (
      hasExactKeys(value, ["kind", "columns", "rows"]) &&
      Array.isArray(value.columns) &&
      value.columns.length > 0 &&
      value.columns.every(isBudgetedText) &&
      Array.isArray(value.rows) &&
      value.rows.length > 0 &&
      value.rows.every(
        (row) =>
          Array.isArray(row) &&
          row.length === (value.columns as unknown[]).length &&
          row.every(isBudgetedText),
      )
    );
  }
  void path;
  return false;
}

function isMeaningfulBlock(block: ReportContentBlockV1): boolean {
  if (block.kind === "paragraph") return isMeaningfulBudgetedText(block.text);
  if (block.kind === "bullet_list")
    return block.items.every(isMeaningfulBudgetedText);
  if (block.kind === "key_value") {
    return block.entries.every(
      ({ label, value }) =>
        isMeaningfulBudgetedText(label) && isMeaningfulBudgetedText(value),
    );
  }
  return (
    block.columns.every(isMeaningfulBudgetedText) &&
    block.rows.every((row) => row.every(isMeaningfulBudgetedText))
  );
}

function validateCitationReference(
  value: unknown,
): value is CitationReferenceV1 {
  return (
    isObject(value) &&
    hasExactKeys(value, ["claim_id", "url", "retrieval_run_id"]) &&
    isNonEmptyString(value.claim_id) &&
    isNonEmptyString(value.url) &&
    isNonEmptyString(value.retrieval_run_id)
  );
}

function validateSourceReference(
  value: unknown,
): value is ReportSourceReferenceV1 {
  const sourceTypes = new Set([
    "engagement",
    "artifact_version",
    "artifact_lineage",
    "canonical_request",
    "analyst_decision",
    "run_record",
    "classifier",
    "contradiction",
    "domain_pack",
    "screening_record",
    "result",
    "evidence",
    "gate_outcome",
    "scoring_charter",
    "versioned_configuration",
  ]);
  return (
    isObject(value) &&
    hasExactKeys(value, ["source_type", "source_id", "field_path"]) &&
    typeof value.source_type === "string" &&
    sourceTypes.has(value.source_type) &&
    isNonEmptyString(value.source_id) &&
    isNonEmptyString(value.field_path)
  );
}

function validateStructure(input: unknown): readonly ReportValidationFailure[] {
  const failures: ReportValidationFailure[] = [];
  if (!isObject(input) || !hasExactKeys(input, topLevelKeys)) {
    return [modelFailure("closed_top_level_schema_required", "$")];
  }
  if (input.schema_version !== CONSULTANT_REPORT_MODEL_VERSION) {
    failures.push(
      modelFailure("unsupported_schema_version", "$.schema_version"),
    );
  }
  if (input.brand_manifest_version !== MATCHBASE_BRAND_MANIFEST_VERSION) {
    failures.push(
      modelFailure("unsupported_brand_manifest", "$.brand_manifest_version"),
    );
  }

  if (
    !isObject(input.document_control) ||
    !hasExactKeys(input.document_control, documentControlKeys)
  ) {
    failures.push(
      modelFailure("invalid_document_control", "$.document_control"),
    );
  } else {
    const control = input.document_control;
    for (const key of [
      "document",
      "prepared_by",
      "classification",
      "basis",
    ] as const) {
      if (!isBudgetedText(control[key])) {
        failures.push(
          modelFailure(
            "invalid_document_control_field",
            `$.document_control.${key}`,
          ),
        );
      }
    }
    if (!isStrictRfc3339(control.prepared_at)) {
      failures.push(
        modelFailure("invalid_prepared_at", "$.document_control.prepared_at"),
      );
    }
    if (
      !["Working Draft", "For Review", "Final", "Superseded"].includes(
        String(control.status),
      )
    ) {
      failures.push(
        modelFailure("invalid_document_status", "$.document_control.status"),
      );
    }
  }

  if (!isObject(input.lineage) || !hasExactKeys(input.lineage, lineageKeys)) {
    failures.push(
      gateFailure(
        "LINEAGE_PREFLIGHT",
        "lineage_preflight",
        "invalid_lineage_schema",
        "$.lineage",
      ),
    );
  }

  if (!Array.isArray(input.scoring_dimensions)) {
    failures.push(
      modelFailure("invalid_scoring_dimensions", "$.scoring_dimensions"),
    );
  } else {
    input.scoring_dimensions.forEach((dimension, index) => {
      if (
        !isObject(dimension) ||
        !hasExactKeys(dimension, ["dimension_id", "weight"]) ||
        !isNonEmptyString(dimension.dimension_id) ||
        typeof dimension.weight !== "number" ||
        !Number.isFinite(dimension.weight)
      ) {
        failures.push(
          modelFailure(
            "invalid_scoring_dimension",
            `$.scoring_dimensions[${index}]`,
          ),
        );
      }
    });
  }
  if (!Array.isArray(input.sections)) {
    failures.push(modelFailure("invalid_sections", "$.sections"));
  } else {
    input.sections.forEach((section, index) => {
      const path = `$.sections[${index}]`;
      if (
        !isObject(section) ||
        !hasExactKeys(
          section,
          ["section_id", "source_references", "blocks"],
          ["explicit_empty_reason"],
        ) ||
        typeof section.section_id !== "string" ||
        !sectionDefinition.has(section.section_id as ReportSectionId) ||
        !Array.isArray(section.source_references) ||
        !Array.isArray(section.blocks)
      ) {
        failures.push(modelFailure("invalid_section", path));
        return;
      }
      if (!section.source_references.every(validateSourceReference)) {
        failures.push(
          modelFailure("invalid_source_reference", `${path}.source_references`),
        );
      }
      section.blocks.forEach((block, blockIndex) => {
        if (!validateContentBlock(block, `${path}.blocks[${blockIndex}]`)) {
          failures.push(
            modelFailure(
              "invalid_content_block",
              `${path}.blocks[${blockIndex}]`,
            ),
          );
        }
      });
      if (
        Object.hasOwn(section, "explicit_empty_reason") &&
        !isNonEmptyString(section.explicit_empty_reason)
      ) {
        failures.push(
          modelFailure(
            "invalid_explicit_empty_reason",
            `${path}.explicit_empty_reason`,
          ),
        );
      }
    });
  }

  if (!Array.isArray(input.omitted_conditional_sections)) {
    failures.push(
      modelFailure(
        "invalid_omitted_conditional_sections",
        "$.omitted_conditional_sections",
      ),
    );
  } else {
    input.omitted_conditional_sections.forEach((omission, index) => {
      const path = `$.omitted_conditional_sections[${index}]`;
      if (
        !isObject(omission) ||
        !hasExactKeys(omission, [
          "section_id",
          "authoritative_condition",
          "non_applicability_reason",
          "source_references",
        ]) ||
        typeof omission.section_id !== "string" ||
        !sectionDefinition.has(omission.section_id as ReportSectionId) ||
        !isNonEmptyString(omission.authoritative_condition) ||
        !isBudgetedText(omission.non_applicability_reason) ||
        !Array.isArray(omission.source_references) ||
        !omission.source_references.every(validateSourceReference)
      ) {
        failures.push(modelFailure("invalid_conditional_omission", path));
      }
    });
  }

  if (!Array.isArray(input.claims)) {
    failures.push(modelFailure("invalid_claims", "$.claims"));
  } else {
    input.claims.forEach((claim, index) => {
      if (
        !isObject(claim) ||
        !hasExactKeys(claim, [
          "claim_id",
          "assertion",
          "materiality",
          "high_risk",
          "section_ids",
        ]) ||
        !isNonEmptyString(claim.claim_id) ||
        !isBudgetedText(claim.assertion) ||
        !["eligibility", "score", "context"].includes(
          String(claim.materiality),
        ) ||
        typeof claim.high_risk !== "boolean" ||
        !Array.isArray(claim.section_ids) ||
        claim.section_ids.length === 0 ||
        !claim.section_ids.every(
          (sectionId) =>
            typeof sectionId === "string" &&
            sectionDefinition.has(sectionId as ReportSectionId),
        )
      ) {
        failures.push(modelFailure("invalid_claim", `$.claims[${index}]`));
      }
    });
  }

  if (!Array.isArray(input.citations)) {
    failures.push(modelFailure("invalid_citations", "$.citations"));
  } else {
    input.citations.forEach((citation, index) => {
      if (!isObject(citation) || !hasExactKeys(citation, citationKeys)) {
        failures.push(
          gateFailure(
            "G4",
            "citation_completeness",
            "citation_requires_exactly_ten_fields",
            `$.citations[${index}]`,
          ),
        );
      } else if (
        !isBudgetedText(citation.publisher) ||
        !isBudgetedText(citation.published_or_updated) ||
        !isBudgetedText(citation.extracted_support) ||
        !Array.isArray(citation.corroborated_by) ||
        !citation.corroborated_by.every(validateCitationReference)
      ) {
        failures.push(
          gateFailure(
            "G4",
            "citation_completeness",
            "invalid_structured_citation_field",
            `$.citations[${index}]`,
          ),
        );
      }
    });
  }
  return failures;
}

interface BudgetedTextEntry {
  readonly text: BudgetedTextV1;
  readonly path: string;
}

function collectBudgetedText(
  model: ConsultantReportModelV1,
): readonly BudgetedTextEntry[] {
  const entries: BudgetedTextEntry[] = [
    {
      text: model.document_control.document,
      path: "$.document_control.document",
    },
    {
      text: model.document_control.prepared_by,
      path: "$.document_control.prepared_by",
    },
    {
      text: model.document_control.classification,
      path: "$.document_control.classification",
    },
    { text: model.document_control.basis, path: "$.document_control.basis" },
  ];
  for (const [sectionIndexValue, section] of model.sections.entries()) {
    for (const [blockIndex, block] of section.blocks.entries()) {
      const path = `$.sections[${sectionIndexValue}].blocks[${blockIndex}]`;
      if (block.kind === "paragraph") {
        entries.push({ text: block.text, path: `${path}.text` });
      } else if (block.kind === "bullet_list") {
        block.items.forEach((text, index) =>
          entries.push({ text, path: `${path}.items[${index}]` }),
        );
      } else if (block.kind === "key_value") {
        block.entries.forEach((entry, index) => {
          entries.push({
            text: entry.label,
            path: `${path}.entries[${index}].label`,
          });
          entries.push({
            text: entry.value,
            path: `${path}.entries[${index}].value`,
          });
        });
      } else {
        block.columns.forEach((text, index) =>
          entries.push({ text, path: `${path}.columns[${index}]` }),
        );
        block.rows.forEach((row, rowIndex) =>
          row.forEach((text, columnIndex) =>
            entries.push({
              text,
              path: `${path}.rows[${rowIndex}][${columnIndex}]`,
            }),
          ),
        );
      }
    }
  }
  model.omitted_conditional_sections.forEach((omission, index) =>
    entries.push({
      text: omission.non_applicability_reason,
      path: `$.omitted_conditional_sections[${index}].non_applicability_reason`,
    }),
  );
  model.claims.forEach((claim, index) =>
    entries.push({
      text: claim.assertion,
      path: `$.claims[${index}].assertion`,
    }),
  );
  model.citations.forEach((citation, index) => {
    entries.push({
      text: citation.publisher,
      path: `$.citations[${index}].publisher`,
    });
    entries.push({
      text: citation.published_or_updated,
      path: `$.citations[${index}].published_or_updated`,
    });
    entries.push({
      text: citation.extracted_support,
      path: `$.citations[${index}].extracted_support`,
    });
  });
  return entries;
}

function validateTextContracts(
  model: ConsultantReportModelV1,
): readonly ReportValidationFailure[] {
  const failures: ReportValidationFailure[] = [];
  const htmlMarkup = /<(?:\/?[A-Za-z][^>]*|![^>]*|\?[^>]*)>/u;
  for (const { text, path } of collectBudgetedText(model)) {
    if (Array.from(text.value).length > text.max_characters) {
      failures.push(
        gateFailure(
          "DECLARED_BUDGET_PREFLIGHT",
          "declared_content_length_budget",
          "declared_content_length_budget_exceeded",
          path,
        ),
      );
    }
  }
  const visitStrings = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (htmlMarkup.test(value)) {
        failures.push(
          gateFailure(
            "HAND-09",
            "plain_text_only",
            "html_or_model_markup_rejected",
            path,
          ),
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((child, index) => visitStrings(child, `${path}[${index}]`));
      return;
    }
    if (isObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        visitStrings(child, `${path}.${key}`);
      }
    }
  };
  visitStrings(model, "$");
  return failures;
}

function validateG4(
  model: ConsultantReportModelV1,
): readonly ReportValidationFailure[] {
  const failures: ReportValidationFailure[] = [];
  const claims = new Map(model.claims.map((claim) => [claim.claim_id, claim]));
  const citedClaims = new Set<string>();
  const seenClaims = new Set<string>();
  const citationsByIdentity = new Map<
    string,
    ConsultantReportModelV1["citations"][number]
  >();
  const sourceTiers = new Set([
    "official_register",
    "primary_vendor_or_company",
    "recognised_trade_or_industry_body",
    "secondary_commentary",
  ]);
  const verificationStatuses = new Set([
    "claimed",
    "externally_verified",
    "inferred",
    "stale",
    "conflicting",
    "unknown",
  ]);
  const sourceTierRank: Readonly<Record<string, number>> = {
    secondary_commentary: 1,
    recognised_trade_or_industry_body: 2,
    primary_vendor_or_company: 3,
    official_register: 4,
  };

  const citationIdentity = (citation: CitationReferenceV1): string =>
    canonicalSerialize({
      claim_id: citation.claim_id,
      retrieval_run_id: citation.retrieval_run_id,
      url: citation.url,
    });
  const publisherIdentity = (
    citation: ConsultantReportModelV1["citations"][number],
  ): string => citation.publisher.value.trim().toLocaleLowerCase("en-US");
  const sourceHostname = (citation: CitationReferenceV1): string | null => {
    try {
      return new URL(citation.url).hostname.toLocaleLowerCase("en-US");
    } catch {
      return null;
    }
  };

  for (const [index, claim] of model.claims.entries()) {
    if (seenClaims.has(claim.claim_id)) {
      failures.push(
        gateFailure(
          "G4",
          "citation_completeness",
          "duplicate_claim_id",
          `$.claims[${index}].claim_id`,
          {
            claim_id: claim.claim_id,
          },
        ),
      );
    }
    seenClaims.add(claim.claim_id);
  }

  for (const [index, citation] of model.citations.entries()) {
    const path = `$.citations[${index}]`;
    const stringFields = [
      "claim_id",
      "url",
      "accessed_at",
      "source_tier",
      "verification_status",
      "retrieval_run_id",
    ] as const;
    if (stringFields.some((key) => !isNonEmptyString(citation[key]))) {
      failures.push(
        gateFailure(
          "G4",
          "citation_completeness",
          "empty_citation_field",
          path,
          {
            claim_id: citation.claim_id,
          },
        ),
      );
      continue;
    }
    const identity = citationIdentity(citation);
    if (citationsByIdentity.has(identity)) {
      failures.push(
        gateFailure(
          "G4",
          "citation_completeness",
          "duplicate_citation_identity",
          path,
          { claim_id: citation.claim_id },
        ),
      );
    } else {
      citationsByIdentity.set(identity, citation);
    }
    try {
      const url = new URL(citation.url);
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new Error("protocol");
    } catch {
      failures.push(
        gateFailure(
          "G4",
          "citation_completeness",
          "invalid_retrieved_url",
          `${path}.url`,
          {
            claim_id: citation.claim_id,
          },
        ),
      );
    }
    if (!isStrictRfc3339(citation.accessed_at)) {
      failures.push(
        gateFailure(
          "G4",
          "citation_completeness",
          "invalid_accessed_at",
          `${path}.accessed_at`,
          {
            claim_id: citation.claim_id,
          },
        ),
      );
    }
    const publicationText = citation.published_or_updated.value;
    if (
      !isMeaningfulString(publicationText) ||
      (publicationText.trim().toLocaleLowerCase("en-US") ===
        "not stated by source" &&
        publicationText !== "not stated by source")
    ) {
      failures.push(
        gateFailure(
          "G4",
          "citation_completeness",
          "invalid_published_or_updated_source_text",
          `${path}.published_or_updated.value`,
          { claim_id: citation.claim_id },
        ),
      );
    }
    if (!sourceTiers.has(citation.source_tier)) {
      failures.push(
        gateFailure(
          "G4",
          "citation_completeness",
          "invalid_source_tier",
          `${path}.source_tier`,
          { claim_id: citation.claim_id },
        ),
      );
    }
    if (!verificationStatuses.has(citation.verification_status)) {
      failures.push(
        gateFailure(
          "G4",
          "citation_completeness",
          "invalid_verification_status",
          `${path}.verification_status`,
          { claim_id: citation.claim_id },
        ),
      );
    }
    if (!claims.has(citation.claim_id)) {
      failures.push(
        gateFailure(
          "G4",
          "citation_completeness",
          "citation_references_unknown_claim",
          `${path}.claim_id`,
          {
            claim_id: citation.claim_id,
          },
        ),
      );
    } else {
      citedClaims.add(citation.claim_id);
    }
    if (
      citation.source_tier === "secondary_commentary" &&
      citation.verification_status === "externally_verified"
    ) {
      failures.push(
        gateFailure(
          "G4",
          "citation_completeness",
          "secondary_source_cannot_externally_verify",
          path,
          {
            claim_id: citation.claim_id,
          },
        ),
      );
    }
  }

  const validCorroborationClaims = new Set<string>();
  for (const [index, citation] of model.citations.entries()) {
    const sourceIdentity = citationIdentity(citation);
    for (const [
      referenceIndex,
      reference,
    ] of citation.corroborated_by.entries()) {
      const path = `$.citations[${index}].corroborated_by[${referenceIndex}]`;
      const target = citationsByIdentity.get(citationIdentity(reference));
      if (target === undefined) {
        failures.push(
          gateFailure(
            "G4",
            "citation_completeness",
            "corroboration_reference_not_closed",
            path,
            { claim_id: citation.claim_id },
          ),
        );
        continue;
      }
      if (
        citationIdentity(target) === sourceIdentity ||
        target.claim_id !== citation.claim_id
      ) {
        failures.push(
          gateFailure(
            "G4",
            "citation_completeness",
            "corroboration_must_reference_another_citation_for_same_claim",
            path,
            { claim_id: citation.claim_id },
          ),
        );
        continue;
      }
      const sourceRank = sourceTierRank[citation.source_tier] ?? 0;
      const targetRank = sourceTierRank[target.source_tier] ?? 0;
      if (targetRank < sourceRank) {
        failures.push(
          gateFailure(
            "G4",
            "citation_completeness",
            "corroborating_source_tier_is_lower",
            path,
            { claim_id: citation.claim_id },
          ),
        );
        continue;
      }
      if (
        publisherIdentity(target) === publisherIdentity(citation) ||
        sourceHostname(target) === sourceHostname(citation)
      ) {
        failures.push(
          gateFailure(
            "G4",
            "citation_completeness",
            "corroborating_source_is_not_independent",
            path,
            { claim_id: citation.claim_id },
          ),
        );
        continue;
      }
      validCorroborationClaims.add(citation.claim_id);
    }
  }

  for (const claim of model.claims) {
    if (claim.materiality !== "context" && !citedClaims.has(claim.claim_id)) {
      failures.push(
        gateFailure(
          "G4",
          "citation_completeness",
          "material_claim_has_no_citation",
          "$.claims",
          {
            claim_id: claim.claim_id,
          },
        ),
      );
    }
    if (claim.high_risk && !validCorroborationClaims.has(claim.claim_id)) {
      failures.push(
        gateFailure(
          "G4",
          "citation_completeness",
          "high_risk_claim_lacks_independent_equal_or_higher_corroboration",
          "$.claims",
          { claim_id: claim.claim_id },
        ),
      );
    }
  }
  return failures;
}

function validateG6(
  model: ConsultantReportModelV1,
): readonly ReportValidationFailure[] {
  if (
    model.scoring_dimensions.length !== CONSULTANT_REPORT_DIMENSIONS.length ||
    model.scoring_dimensions.some((dimension, index) => {
      const charter = CONSULTANT_REPORT_DIMENSIONS[index];
      return (
        charter === undefined ||
        dimension.dimension_id !== charter.dimension_id ||
        dimension.weight !== charter.weight
      );
    })
  ) {
    return [
      gateFailure(
        "G6",
        "weight_fidelity",
        "charter_dimension_mismatch",
        "$.scoring_dimensions",
      ),
    ];
  }
  return [];
}

function validateG7(
  model: ConsultantReportModelV1,
): readonly ReportValidationFailure[] {
  const failures: ReportValidationFailure[] = [];
  const sections = new Map<ReportSectionId, ConsultantReportSectionV1>();
  const omissions = new Map<
    ReportSectionId,
    ConsultantReportModelV1["omitted_conditional_sections"][number]
  >();
  for (const [index, section] of model.sections.entries()) {
    if (sections.has(section.section_id)) {
      failures.push(
        gateFailure(
          "G7",
          "required_sections_present",
          "duplicate_section",
          `$.sections[${index}]`,
          {
            section_id: section.section_id,
          },
        ),
      );
    }
    sections.set(section.section_id, section);
  }
  for (const [
    index,
    omission,
  ] of model.omitted_conditional_sections.entries()) {
    if (omissions.has(omission.section_id)) {
      failures.push(
        gateFailure(
          "G7",
          "required_sections_present",
          "duplicate_conditional_omission",
          `$.omitted_conditional_sections[${index}]`,
          { section_id: omission.section_id },
        ),
      );
    }
    omissions.set(omission.section_id, omission);
  }

  for (const definition of REPORT_SECTION_REGISTRY) {
    const section = sections.get(definition.section_id);
    if (section === undefined) {
      if (definition.status === "conditional") {
        const omission = omissions.get(definition.section_id);
        if (
          omission === undefined ||
          omission.authoritative_condition !==
            definition.authoritative_condition ||
          !isMeaningfulBudgetedText(omission.non_applicability_reason) ||
          omission.source_references.length === 0
        ) {
          failures.push(
            gateFailure(
              "G7",
              "required_sections_present",
              "conditional_omission_requires_exact_condition_sourced_reason",
              "$.omitted_conditional_sections",
              { section_id: definition.section_id },
              omission?.source_references.length === 0
                ? "missing_source"
                : "content_gate",
            ),
          );
        }
      } else {
        failures.push(
          gateFailure(
            "G7",
            "required_sections_present",
            "missing_required_section",
            "$.sections",
            {
              section_id: definition.section_id,
            },
          ),
        );
      }
      continue;
    }
    if (
      definition.status === "conditional" &&
      omissions.has(definition.section_id)
    ) {
      failures.push(
        gateFailure(
          "G7",
          "required_sections_present",
          "conditional_section_cannot_be_present_and_omitted",
          "$.omitted_conditional_sections",
          { section_id: definition.section_id },
        ),
      );
    }
    if (section.source_references.length === 0) {
      failures.push(
        gateFailure(
          "G7",
          "required_sections_present",
          "missing_source_reference",
          "$.sections",
          { section_id: definition.section_id },
          "missing_source",
        ),
      );
    }
    const hasBlocks =
      section.blocks.length > 0 && section.blocks.every(isMeaningfulBlock);
    const expectedEmptyText =
      definition.section_id in EXPLICIT_EMPTY_TEXT
        ? EXPLICIT_EMPTY_TEXT[
            definition.section_id as keyof typeof EXPLICIT_EMPTY_TEXT
          ]
        : undefined;
    const hasEmptyReason = section.explicit_empty_reason === expectedEmptyText;
    if (definition.status === "required_explicit_empty") {
      if (
        hasBlocks === hasEmptyReason ||
        (section.explicit_empty_reason !== undefined && !hasEmptyReason)
      ) {
        failures.push(
          gateFailure(
            "G7",
            "required_sections_present",
            "explicit_empty_section_requires_content_xor_reason",
            "$.sections",
            {
              section_id: definition.section_id,
            },
          ),
        );
      }
    } else if (!hasBlocks || Object.hasOwn(section, "explicit_empty_reason")) {
      failures.push(
        gateFailure(
          "G7",
          "required_sections_present",
          "section_requires_authored_content",
          "$.sections",
          {
            section_id: definition.section_id,
          },
        ),
      );
    }
  }
  for (const omission of model.omitted_conditional_sections) {
    const definition = sectionDefinition.get(omission.section_id);
    if (definition?.status !== "conditional") {
      failures.push(
        gateFailure(
          "G7",
          "required_sections_present",
          "omission_record_only_allowed_for_conditional_section",
          "$.omitted_conditional_sections",
          { section_id: omission.section_id },
        ),
      );
    }
  }
  return failures;
}

function validateLineagePreflight(
  model: ConsultantReportModelV1,
): readonly ReportValidationFailure[] {
  const lineage = model.lineage;
  const failures: ReportValidationFailure[] = [];
  if (
    !Number.isSafeInteger(lineage.artifact_version) ||
    lineage.artifact_version < 1
  ) {
    failures.push(
      gateFailure(
        "LINEAGE_PREFLIGHT",
        "lineage_preflight",
        "invalid_artifact_version",
        "$.lineage.artifact_version",
      ),
    );
  }
  for (const key of [
    "generating_run_id",
    "canonical_request_version_id",
    "projection_version_id",
    "analyst_decision_set_id",
    "template_version",
    "generated_by_subject_id",
  ] as const) {
    if (!isNonEmptyString(lineage[key])) {
      failures.push(
        gateFailure(
          "LINEAGE_PREFLIGHT",
          "lineage_preflight",
          "missing_lineage_field",
          `$.lineage.${key}`,
        ),
      );
    }
  }
  if (!sha256Hex.test(lineage.result_sha256)) {
    failures.push(
      gateFailure(
        "LINEAGE_PREFLIGHT",
        "lineage_preflight",
        "invalid_result_sha256",
        "$.lineage.result_sha256",
      ),
    );
  }
  if (!isStrictRfc3339(lineage.composed_at)) {
    failures.push(
      gateFailure(
        "LINEAGE_PREFLIGHT",
        "lineage_preflight",
        "invalid_composed_at",
        "$.lineage.composed_at",
      ),
    );
  }
  if (lineage.page_geometry !== "a4" && lineage.page_geometry !== "letter") {
    failures.push(
      gateFailure(
        "LINEAGE_PREFLIGHT",
        "lineage_preflight",
        "invalid_page_geometry",
        "$.lineage.page_geometry",
      ),
    );
  }
  return failures;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cloneBlock(block: ReportContentBlockV1): ReportContentBlockV1 {
  return JSON.parse(canonicalSerialize(block)) as ReportContentBlockV1;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeModel(
  model: ConsultantReportModelV1,
): ConsultantReportModelV1 {
  const sections = model.sections
    .map((section) => ({
      section_id: section.section_id,
      source_references: section.source_references
        .map((source) => ({ ...source }))
        .sort((left, right) =>
          compareStrings(
            `${left.source_type}\u0000${left.source_id}\u0000${left.field_path}`,
            `${right.source_type}\u0000${right.source_id}\u0000${right.field_path}`,
          ),
        ),
      blocks: section.blocks.map(cloneBlock),
      ...(section.explicit_empty_reason === undefined
        ? {}
        : { explicit_empty_reason: section.explicit_empty_reason }),
    }))
    .sort(
      (left, right) =>
        (sectionIndex.get(left.section_id) ?? Number.MAX_SAFE_INTEGER) -
        (sectionIndex.get(right.section_id) ?? Number.MAX_SAFE_INTEGER),
    );
  const claims = model.claims
    .map((claim) => ({
      ...claim,
      section_ids: [...claim.section_ids].sort(
        (left, right) =>
          (sectionIndex.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (sectionIndex.get(right) ?? Number.MAX_SAFE_INTEGER),
      ),
    }))
    .sort((left, right) => compareStrings(left.claim_id, right.claim_id));
  const citations = model.citations
    .map((citation) => ({
      ...citation,
      corroborated_by: [...citation.corroborated_by].sort((left, right) =>
        compareStrings(canonicalSerialize(left), canonicalSerialize(right)),
      ),
    }))
    .sort((left, right) =>
      compareStrings(canonicalSerialize(left), canonicalSerialize(right)),
    );
  const omittedConditionalSections = model.omitted_conditional_sections
    .map((omission) => ({
      ...omission,
      source_references: omission.source_references
        .map((source) => ({ ...source }))
        .sort((left, right) =>
          compareStrings(canonicalSerialize(left), canonicalSerialize(right)),
        ),
    }))
    .sort(
      (left, right) =>
        (sectionIndex.get(left.section_id) ?? Number.MAX_SAFE_INTEGER) -
        (sectionIndex.get(right.section_id) ?? Number.MAX_SAFE_INTEGER),
    );
  const normalized = {
    ...model,
    document_control: { ...model.document_control },
    lineage: { ...model.lineage },
    scoring_dimensions: model.scoring_dimensions.map((dimension) => ({
      ...dimension,
    })),
    sections,
    omitted_conditional_sections: omittedConditionalSections,
    claims,
    citations,
  };
  return deepFreeze(
    JSON.parse(canonicalSerialize(normalized)) as ConsultantReportModelV1,
  );
}

export function composeConsultantReportV1(
  input: unknown,
): ComposeConsultantReportResult {
  const structuralFailures = validateStructure(input);
  if (structuralFailures.length > 0) {
    return { ok: false, failures: structuralFailures };
  }

  const model = normalizeModel(input as ConsultantReportModelV1);
  const failures = [
    ...validateTextContracts(model),
    ...validateG4(model),
    ...validateG6(model),
    ...validateG7(model),
    ...validateLineagePreflight(model),
  ];
  if (failures.length > 0) return { ok: false, failures };

  const canonicalModel = canonicalSerialize(model);
  const foundationCheckResults = Object.freeze([
    {
      stage: "report_model_preflight",
      gate_id: "DECLARED_BUDGET_PREFLIGHT",
      check_key: "declared_content_length_budget",
      outcome: "pass",
    },
    {
      stage: "report_model_preflight",
      gate_id: "HAND-09",
      check_key: "plain_text_only",
      outcome: "pass",
    },
    {
      stage: "report_model_preflight",
      gate_id: "G4",
      check_key: "citation_completeness",
      outcome: "pass",
    },
    {
      stage: "report_model_preflight",
      gate_id: "G6",
      check_key: "weight_fidelity",
      outcome: "pass",
    },
    {
      stage: "report_model_preflight",
      gate_id: "G7",
      check_key: "required_sections_present",
      outcome: "pass",
    },
    {
      stage: "report_model_preflight",
      gate_id: "LINEAGE_PREFLIGHT",
      check_key: "lineage_preflight",
      outcome: "pass",
    },
  ] as const satisfies readonly FoundationCheckResult[]);
  const modelSha256 = canonicalSha256(model);
  return {
    ok: true,
    value: {
      model,
      canonical_model: canonicalModel,
      model_sha256: modelSha256,
      hash_relationship: {
        algorithm: "sha256",
        encoding: "utf8",
        hashed_value: "canonical_model",
        excluded_from_hash: [
          "model_sha256",
          "hash_relationship",
          "foundation_check_results",
          "authoritative_hand05",
          "full_artifact_g14",
        ],
      },
      foundation_check_results: foundationCheckResults,
      authoritative_hand05: {
        outcome: "not_evaluated",
        release_blocked: true,
        reason:
          "Requires a versioned field-specific trusted budget registry and renderer qualification.",
      },
      full_artifact_g14: {
        outcome: "not_evaluated",
        release_blocked: true,
        reason:
          "Requires the recorded model hash and the complete G1-G14 artifact QA result set.",
      },
    },
  };
}

export function assertConsultantDimensionParity(): void {
  if (
    CONSULTANT_REPORT_DIMENSIONS.length !== 6 ||
    CONSULTANT_REPORT_DIMENSIONS.reduce(
      (total, dimension) => total + dimension.weight,
      0,
    ) !== 100
  ) {
    throw new Error(
      "Consultant report dimensions differ from @matchbase/contracts",
    );
  }
}
