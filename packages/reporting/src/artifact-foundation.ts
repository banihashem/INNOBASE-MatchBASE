import { createHash, randomUUID } from "node:crypto";

export const P4_QA_CHECK_KEYS = Object.freeze([
  "band_label_equals_render_band",
  "wave_separated_from_band",
  "overflow_collision",
  "citation_completeness",
  "prohibited_phrase_scan",
  "weight_fidelity",
  "required_sections_present",
  "template_content_leakage",
  "truncation_disclosure",
  "contradiction_declaration",
  "tagged_structure",
  "doc_title_flag",
  "veraPDF",
  "contrast_ratio",
  "page_geometry_both",
  "hash_and_lineage",
] as const);

export type P4QaCheckKey = (typeof P4_QA_CHECK_KEYS)[number];
export type ArtifactQaOutcome = "pass" | "fail" | "warn";
export type ArtifactVersionState =
  "rendering" | "render_failed" | "qa_failed" | "released";

export interface ArtifactByteStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export interface ArtifactLineageInput {
  readonly result_version: string;
  readonly result_sha256: string;
  readonly canonical_request_version_id: string;
  readonly projection_version_id: string;
  readonly analyst_decision_set_id: string;
  readonly scoring_config_version_id: string;
  readonly model_policy_version_id: string;
  readonly template_version: string;
  readonly renderer: string;
  readonly renderer_version: string;
  readonly page_geometry: "a4" | "letter";
  readonly generated_by_subject_id: string;
}

export interface CreateArtifactVersionInput extends ArtifactLineageInput {
  readonly artifact_id: string;
  readonly account_id: string;
  readonly run_id: string;
}

export interface ArtifactQaCheck {
  readonly check_key: P4QaCheckKey;
  readonly outcome: ArtifactQaOutcome;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly checked_at: string;
}

export interface ArtifactVersionRecord extends ArtifactLineageInput {
  readonly artifact_version_id: string;
  readonly artifact_id: string;
  readonly account_id: string;
  readonly run_id: string;
  readonly version: number;
  readonly state: ArtifactVersionState;
  readonly qa_checks: readonly ArtifactQaCheck[];
  readonly file_sha256: string | null;
  readonly byte_size: number | null;
  readonly page_count: number | null;
  readonly failure_class: "render_failure" | "qa_failure" | null;
  readonly failure_detail: Readonly<Record<string, unknown>> | null;
  readonly created_at: string;
  readonly released_at: string | null;
}

export interface ArtifactRetrievalAuditEvent {
  readonly event_id: string;
  readonly event_type: "artifact.download";
  readonly account_id: string;
  readonly subject_id: string;
  readonly subject_tier: "consultant" | "admin";
  readonly artifact_version_id: string;
  readonly outcome: "allow" | "deny" | "error";
  readonly fields_released: readonly ["artifact_bytes"] | readonly [];
  readonly expected_sha256: string | null;
  readonly observed_sha256: string | null;
  readonly justification: string | null;
  readonly occurred_at: string;
}

export interface RetrieveArtifactInput {
  readonly artifact_version_id: string;
  readonly account_id: string;
  readonly subject_id: string;
  readonly subject_tier: "consultant" | "admin";
  readonly justification?: string;
}

interface MutableArtifactVersion extends ArtifactLineageInput {
  artifact_version_id: string;
  artifact_id: string;
  account_id: string;
  run_id: string;
  version: number;
  state: ArtifactVersionState;
  qa_checks: Map<P4QaCheckKey, ArtifactQaCheck>;
  file_sha256: string | null;
  byte_size: number | null;
  page_count: number | null;
  failure_class: "render_failure" | "qa_failure" | null;
  failure_detail: Readonly<Record<string, unknown>> | null;
  created_at: string;
  released_at: string | null;
}

interface ArtifactIdentity {
  readonly account_id: string;
  readonly run_id: string;
  current_version: number;
}

export interface ArtifactFoundationOptions {
  readonly clock?: () => Date;
  readonly id_factory?: () => string;
}

const sha256Hex = /^[0-9a-f]{64}$/u;
const qaKeySet = new Set<string>(P4_QA_CHECK_KEYS);

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function copyDetail(
  detail: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze(structuredClone(detail));
}

function requireText(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required.`);
}

function validateCreateInput(input: CreateArtifactVersionInput): void {
  for (const field of [
    "artifact_id",
    "account_id",
    "run_id",
    "result_version",
    "canonical_request_version_id",
    "projection_version_id",
    "analyst_decision_set_id",
    "scoring_config_version_id",
    "model_policy_version_id",
    "template_version",
    "renderer",
    "renderer_version",
    "generated_by_subject_id",
  ] as const)
    requireText(input[field], field);
  if (!sha256Hex.test(input.result_sha256))
    throw new Error("result_sha256 must be a lowercase SHA-256 digest.");
}

function publicRecord(record: MutableArtifactVersion): ArtifactVersionRecord {
  return Object.freeze({
    artifact_version_id: record.artifact_version_id,
    artifact_id: record.artifact_id,
    account_id: record.account_id,
    run_id: record.run_id,
    version: record.version,
    state: record.state,
    result_version: record.result_version,
    result_sha256: record.result_sha256,
    canonical_request_version_id: record.canonical_request_version_id,
    projection_version_id: record.projection_version_id,
    analyst_decision_set_id: record.analyst_decision_set_id,
    scoring_config_version_id: record.scoring_config_version_id,
    model_policy_version_id: record.model_policy_version_id,
    template_version: record.template_version,
    renderer: record.renderer,
    renderer_version: record.renderer_version,
    page_geometry: record.page_geometry,
    generated_by_subject_id: record.generated_by_subject_id,
    qa_checks: Object.freeze(
      [...record.qa_checks.values()].map((check) =>
        Object.freeze({ ...check, detail: copyDetail(check.detail) }),
      ),
    ),
    file_sha256: record.file_sha256,
    byte_size: record.byte_size,
    page_count: record.page_count,
    failure_class: record.failure_class,
    failure_detail:
      record.failure_detail === null ? null : copyDetail(record.failure_detail),
    created_at: record.created_at,
    released_at: record.released_at,
  });
}

/**
 * Isolated-local reference repository for the TASK-155 state contract.
 * Production persistence is the 0007 artifact/artifact_version schema; this
 * implementation keeps the same fail-closed semantics without external I/O.
 */
export class ArtifactFoundationRepository {
  readonly #store: ArtifactByteStore;
  readonly #clock: () => Date;
  readonly #idFactory: () => string;
  readonly #artifacts = new Map<string, ArtifactIdentity>();
  readonly #versions = new Map<string, MutableArtifactVersion>();
  readonly #auditEvents: ArtifactRetrievalAuditEvent[] = [];

  constructor(
    store: ArtifactByteStore,
    options: ArtifactFoundationOptions = {},
  ) {
    this.#store = store;
    this.#clock = options.clock ?? (() => new Date());
    this.#idFactory = options.id_factory ?? randomUUID;
  }

  createVersion(input: CreateArtifactVersionInput): ArtifactVersionRecord {
    validateCreateInput(input);
    const existing = this.#artifacts.get(input.artifact_id);
    if (
      existing !== undefined &&
      (existing.account_id !== input.account_id ||
        existing.run_id !== input.run_id)
    )
      throw new Error(
        "Artifact identity cannot be rebound to another account or run.",
      );
    const identity = existing ?? {
      account_id: input.account_id,
      run_id: input.run_id,
      current_version: 0,
    };
    identity.current_version += 1;
    this.#artifacts.set(input.artifact_id, identity);
    const artifactVersionId = this.#idFactory();
    if (this.#versions.has(artifactVersionId))
      throw new Error("Artifact version identity collision.");
    const record: MutableArtifactVersion = {
      ...input,
      artifact_version_id: artifactVersionId,
      version: identity.current_version,
      state: "rendering",
      qa_checks: new Map(),
      file_sha256: null,
      byte_size: null,
      page_count: null,
      failure_class: null,
      failure_detail: null,
      created_at: this.#clock().toISOString(),
      released_at: null,
    };
    this.#versions.set(artifactVersionId, record);
    return publicRecord(record);
  }

  getVersion(artifactVersionId: string): ArtifactVersionRecord {
    return publicRecord(this.#requireVersion(artifactVersionId));
  }

  recordQaCheck(
    artifactVersionId: string,
    check: Omit<ArtifactQaCheck, "checked_at">,
  ): ArtifactVersionRecord {
    const record = this.#requireRendering(artifactVersionId);
    if (!qaKeySet.has(check.check_key))
      throw new Error("Unknown blocking artifact QA check.");
    if (record.qa_checks.has(check.check_key))
      throw new Error(`Artifact QA check is append-only: ${check.check_key}.`);
    const normalized = Object.freeze({
      check_key: check.check_key,
      outcome: check.outcome,
      detail: copyDetail(check.detail),
      checked_at: this.#clock().toISOString(),
    });
    record.qa_checks.set(check.check_key, normalized);
    if (check.outcome !== "pass") {
      record.state = "qa_failed";
      record.failure_class = "qa_failure";
      record.failure_detail = copyDetail({
        check_key: check.check_key,
        outcome: check.outcome,
        ...check.detail,
      });
    }
    return publicRecord(record);
  }

  async failRender(
    artifactVersionId: string,
    detail: Readonly<Record<string, unknown>>,
  ): Promise<ArtifactVersionRecord> {
    const record = this.#requireRendering(artifactVersionId);
    await this.#store.delete(record.artifact_version_id);
    record.state = "render_failed";
    record.failure_class = "render_failure";
    record.failure_detail = copyDetail(detail);
    return publicRecord(record);
  }

  async release(
    artifactVersionId: string,
    bytes: Uint8Array,
    pageCount: number,
  ): Promise<ArtifactVersionRecord> {
    const record = this.#requireRendering(artifactVersionId);
    if (bytes.byteLength === 0) throw new Error("Artifact bytes are empty.");
    if (!Number.isSafeInteger(pageCount) || pageCount < 1)
      throw new Error("Artifact page count must be a positive integer.");
    const missing = P4_QA_CHECK_KEYS.filter(
      (key) => record.qa_checks.get(key)?.outcome !== "pass",
    );
    if (missing.length > 0)
      throw new Error(
        `Artifact release requires all sixteen blocking QA checks to pass: ${missing.join(", ")}.`,
      );
    const immutableBytes = Uint8Array.from(bytes);
    try {
      await this.#store.put(record.artifact_version_id, immutableBytes);
    } catch (error) {
      await this.#store.delete(record.artifact_version_id);
      record.state = "render_failed";
      record.failure_class = "render_failure";
      record.failure_detail = copyDetail({ stage: "artifact_byte_store" });
      throw error;
    }
    record.file_sha256 = digest(immutableBytes);
    record.byte_size = immutableBytes.byteLength;
    record.page_count = pageCount;
    record.released_at = this.#clock().toISOString();
    record.state = "released";
    return publicRecord(record);
  }

  async retrieve(input: RetrieveArtifactInput): Promise<Uint8Array> {
    const record = this.#versions.get(input.artifact_version_id);
    const justification = input.justification?.trim() || null;
    if (input.subject_tier === "admin" && justification === null) {
      this.#appendAudit(input, "deny", null, null, justification);
      throw new Error("Admin artifact retrieval requires justification.");
    }
    if (
      record === undefined ||
      record.account_id !== input.account_id ||
      record.state !== "released" ||
      record.file_sha256 === null
    ) {
      this.#appendAudit(
        input,
        "deny",
        record?.file_sha256 ?? null,
        null,
        justification,
      );
      throw new Error("Artifact version is not downloadable.");
    }
    const stored = await this.#store.get(record.artifact_version_id);
    const observed = stored === null ? null : digest(stored);
    if (stored === null || observed !== record.file_sha256) {
      this.#appendAudit(
        input,
        "error",
        record.file_sha256,
        observed,
        justification,
      );
      throw new Error("Artifact byte integrity verification failed.");
    }
    this.#appendAudit(
      input,
      "allow",
      record.file_sha256,
      observed,
      justification,
    );
    return Uint8Array.from(stored);
  }

  auditEvents(): readonly ArtifactRetrievalAuditEvent[] {
    return Object.freeze(
      this.#auditEvents.map((event) =>
        Object.freeze({
          ...event,
          fields_released: Object.freeze([...event.fields_released]) as
            readonly ["artifact_bytes"] | readonly [],
        }),
      ),
    );
  }

  #requireVersion(artifactVersionId: string): MutableArtifactVersion {
    const record = this.#versions.get(artifactVersionId);
    if (record === undefined) throw new Error("Unknown artifact version.");
    return record;
  }

  #requireRendering(artifactVersionId: string): MutableArtifactVersion {
    const record = this.#requireVersion(artifactVersionId);
    if (record.state !== "rendering")
      throw new Error(
        `Artifact version is immutable in state ${record.state}.`,
      );
    return record;
  }

  #appendAudit(
    input: RetrieveArtifactInput,
    outcome: "allow" | "deny" | "error",
    expectedSha256: string | null,
    observedSha256: string | null,
    justification: string | null,
  ): void {
    this.#auditEvents.push(
      Object.freeze({
        event_id: this.#idFactory(),
        event_type: "artifact.download",
        account_id: input.account_id,
        subject_id: input.subject_id,
        subject_tier: input.subject_tier,
        artifact_version_id: input.artifact_version_id,
        outcome,
        fields_released:
          outcome === "allow"
            ? (Object.freeze(["artifact_bytes"]) as readonly ["artifact_bytes"])
            : (Object.freeze([]) as readonly []),
        expected_sha256: expectedSha256,
        observed_sha256: observedSha256,
        justification,
        occurred_at: this.#clock().toISOString(),
      }),
    );
  }
}
