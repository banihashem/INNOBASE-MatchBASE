import type { ConnectionPool } from "@matchbase/data";
import { isDeepStrictEqual } from "node:util";
import {
  CONSULTANT_REPORT_DIMENSIONS,
  CONSULTANT_REPORT_MODEL_VERSION,
  EXPLICIT_EMPTY_TEXT,
  MATCHBASE_BRAND_MANIFEST_VERSION,
  REPORT_SECTION_REGISTRY,
  composeConsultantReportV1,
  type ConsultantReportModelV1,
  type ServerOwnedReportInput,
} from "@matchbase/reporting";
import type {
  ConsultantPdfPipeline,
  ConsultantReportModelBuilder,
} from "./consultant-pdf-lifecycle.js";

const text = (value: string, maxCharacters = 500) => ({
  value: value.slice(0, maxCharacters),
  max_characters: maxCharacters,
});

export class DatabaseConsultantReportModelBuilder implements ConsultantReportModelBuilder<
  ConsultantReportModelV1,
  ServerOwnedReportInput
> {
  constructor(private readonly pool: ConnectionPool) {}

  async build(source: Parameters<ConsultantPdfPipeline["run"]>[0]) {
    const selected = await this.pool.query<{
      canonical_document: Readonly<Record<string, unknown>>;
      complete_result_document: Readonly<Record<string, unknown>>;
      result_sha256_hex: string;
      assembled_at: Date;
      candidate_count: number;
      evidence_count: number;
      score_count: number;
      outcome: "candidates" | "scarcity" | "no_responsible_match";
      eligible_count: number;
      limitations_text: string;
      candidate_rows: readonly Record<string, unknown>[];
      evidence_rows: readonly Record<string, unknown>[];
      score_rows: readonly Record<string, unknown>[];
      claim_rows: readonly Record<string, unknown>[];
      excluded_candidate_rows: readonly Record<string, unknown>[];
      unknown_field_rows: readonly Record<string, unknown>[];
    }>(
      `SELECT c.canonical_document,x.complete_result_document,x.outcome,x.eligible_count,x.limitations_text,encode(x.result_sha256,'hex') AS result_sha256_hex,x.assembled_at,
        (SELECT count(*)::int FROM candidate WHERE account_id=r.account_id AND run_id=r.run_id) AS candidate_count,
        (SELECT count(*)::int FROM evidence_item WHERE account_id=r.account_id AND run_id=r.run_id) AS evidence_count,
        (SELECT count(*)::int FROM candidate_score WHERE account_id=r.account_id AND run_id=r.run_id) AS score_count
        ,COALESCE((SELECT jsonb_agg(jsonb_build_object('candidate_id',candidate_id,'name',canonical_name,'country',country_code,'eligible',eligible,'rank',deterministic_rank) ORDER BY deterministic_rank NULLS LAST,candidate_id) FROM candidate WHERE account_id=r.account_id AND run_id=r.run_id),'[]'::jsonb) AS candidate_rows
        ,COALESCE((SELECT jsonb_agg(jsonb_build_object('evidence_item_id',evidence_item_id,'title',title,'publisher_domain',publisher_domain,'url',url,'retrieved_at',retrieved_at,'verification',verification_disposition) ORDER BY evidence_item_id) FROM evidence_item WHERE account_id=r.account_id AND run_id=r.run_id),'[]'::jsonb) AS evidence_rows
        ,COALESCE((SELECT jsonb_agg(jsonb_build_object('candidate_id',candidate_id,'score',compatibility_score,'fit_band',fit_band,'confidence',evidence_confidence) ORDER BY compatibility_score DESC,candidate_id) FROM candidate_score WHERE account_id=r.account_id AND run_id=r.run_id),'[]'::jsonb) AS score_rows
        ,COALESCE((SELECT jsonb_agg(jsonb_build_object('claim_id',q.claim_id,'assertion',q.assertion_text,'decision_bearing',q.decision_bearing,'verification',q.verification_status,'url',e.url,'publisher',e.publisher_domain,'retrieved_at',e.retrieved_at,'title',e.title) ORDER BY q.claim_id) FROM claim q LEFT JOIN LATERAL (SELECT i.url,i.publisher_domain,i.retrieved_at,i.title FROM claim_evidence ce JOIN evidence_item i ON i.account_id=ce.account_id AND i.evidence_item_id=ce.evidence_item_id WHERE ce.account_id=q.account_id AND ce.claim_id=q.claim_id AND ce.relation='supports' AND i.url IS NOT NULL ORDER BY i.retrieved_at DESC,i.evidence_item_id LIMIT 1) e ON true WHERE q.account_id=r.account_id AND q.run_id=r.run_id),'[]'::jsonb) AS claim_rows
        ,COALESCE((SELECT jsonb_agg(jsonb_build_object('candidate_id',c2.candidate_id,'name',c2.canonical_name,'reason',rc.exclusion_reason_code,'rank',rc.rank) ORDER BY rc.rank) FROM result_candidate rc JOIN candidate c2 ON c2.account_id=rc.account_id AND c2.candidate_id=rc.candidate_id WHERE rc.account_id=r.account_id AND rc.run_id=r.run_id AND rc.eligible=false AND length(btrim(COALESCE(rc.exclusion_reason_code,'')))>0),'[]'::jsonb) AS excluded_candidate_rows
        ,COALESCE((SELECT jsonb_agg(jsonb_build_object('field_key',rf.field_key,'value_state',rf.value_state,'macro_parameter',rf.macro_parameter) ORDER BY rf.macro_parameter,rf.field_key) FROM request_field rf WHERE rf.account_id=r.account_id AND rf.canonical_request_version_id=r.canonical_request_version_id AND rf.value_state IN ('explicitly_unknown','not_asked','empty')),'[]'::jsonb) AS unknown_field_rows
       FROM research_run r
       JOIN canonical_request_version c ON c.account_id=r.account_id AND c.canonical_request_version_id=r.canonical_request_version_id
       JOIN run_result x ON x.account_id=r.account_id AND x.run_id=r.run_id
       WHERE r.account_id=$1 AND r.run_id=$2 AND r.canonical_request_version_id=$3
         AND r.scoring_config_version_id=$4 AND r.model_policy_version_id=$5
         AND x.result_sha256=$6 AND r.state IN ('complete','no_responsible_match')`,
      [
        source.accountId,
        source.runId,
        source.canonicalRequestVersionId,
        source.scoringConfigVersionId,
        source.modelPolicyVersionId,
        Buffer.from(source.resultSha256, "hex"),
      ],
    );
    const row = selected.rows[0];
    if (!row || row.result_sha256_hex !== source.resultSha256)
      throw new Error("Consultant report source lineage is unavailable.");
    if (!isDeepStrictEqual(row.complete_result_document, source.result))
      throw new Error("Consultant report result source drifted.");

    const sourceReference = Object.freeze({
      source_type: "result" as const,
      source_id: source.runId,
      field_path: "complete_result_document",
    });
    const landscape =
      row.complete_result_document.landscape !== null &&
      typeof row.complete_result_document.landscape === "object"
        ? (row.complete_result_document.landscape as Record<string, unknown>)
        : {};
    const scarcityApplies =
      (typeof landscape.eligible_count === "number" &&
        landscape.eligible_count < 3) ||
      landscape.truncated === true;
    const canonicalContradictions = row.canonical_document.contradictions;
    const contradictionApplies =
      Array.isArray(canonicalContradictions) &&
      canonicalContradictions.length > 0;
    const includedConditional = (sectionId: string) =>
      (sectionId === "SEC-09.3" && scarcityApplies) ||
      (sectionId === "SEC-05.2" && contradictionApplies);
    if (row.evidence_count < 1)
      throw new Error(
        "Consultant report requires at least one evidence record.",
      );
    const display = (value: unknown) =>
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : JSON.stringify(value);
    const canonicalSummary = Object.entries(row.canonical_document)
      .map(([key, value]) => `${key.replaceAll("_", " ")}: ${display(value)}`)
      .join("; ")
      .slice(0, 1200);
    const candidateSummary =
      row.candidate_rows
        .map(
          (candidate) =>
            `${display(candidate.name)} (${display(candidate.country ?? "country not stated")}); eligible: ${display(candidate.eligible)}; rank: ${display(candidate.rank ?? "not ranked")}`,
        )
        .join(" | ")
        .slice(0, 1600) ||
      "No candidate record survived the governed eligibility process.";
    const evidenceSummary = row.evidence_rows
      .map(
        (evidence) =>
          `${display(evidence.title)} — ${display(evidence.publisher_domain)} — ${display(evidence.verification)}${evidence.url ? ` — ${display(evidence.url)}` : ""}`,
      )
      .join(" | ")
      .slice(0, 1800);
    const completeEvidence = Array.isArray(
      row.complete_result_document.evidence,
    )
      ? (row.complete_result_document.evidence as readonly Record<
          string,
          unknown
        >[])
      : [];
    const excludedEvidence = completeEvidence.filter(
      (item) =>
        item.verification_disposition === "excluded" &&
        typeof item.exclusion_reason === "string" &&
        item.exclusion_reason.trim().length > 0,
    );
    const missingRfqSummary = (row.unknown_field_rows ?? [])
      .map(
        (field) =>
          `${display(field.field_key)} (${display(field.value_state)})`,
      )
      .join("; ");
    const reserveSummary = (row.excluded_candidate_rows ?? [])
      .map(
        (candidate) =>
          `${display(candidate.name)} — excluded: ${display(candidate.reason)}`,
      )
      .join(" | ");
    const excludedEvidenceSummary = excludedEvidence
      .map(
        (item) =>
          `${display(item.title ?? item.evidence_id)} — ${display(item.exclusion_reason)}`,
      )
      .join(" | ");
    const scoreSummary = row.score_rows
      .map(
        (score) =>
          `${display(score.candidate_id)}: score ${display(score.score)}, band ${display(score.fit_band)}, evidence confidence ${display(score.confidence)}`,
      )
      .join(" | ")
      .slice(0, 1400);
    const sectionContent = (sectionId: string, title: string): string => {
      if (sectionId === "SEC-00")
        return `${title}. Run ${source.runId}; result digest ${source.resultSha256}; prepared ${row.assembled_at.toISOString()}.`;
      if (sectionId === "SEC-01")
        return `${title}. Confidential; generated by the server-owned reporting pipeline for account ${source.accountId}.`;
      if (sectionId === "SEC-02")
        return `${title}. The governed registry contains ${REPORT_SECTION_REGISTRY.length} section definitions; conditional sections appear only when their stored condition is present.`;
      if (["SEC-05", "SEC-05.1"].includes(sectionId))
        return `${title}. Canonical request: ${canonicalSummary}`;
      if (["SEC-09", "SEC-09.1", "SEC-11", "SEC-11.2"].includes(sectionId))
        return `${title}. Candidate records: ${candidateSummary}`;
      if (["SEC-06", "SEC-06.1", "SEC-06.2", "SEC-10"].includes(sectionId))
        return `${title}. Server-owned scoring records: ${scoreSummary}`;
      if (sectionId === "SEC-06.3")
        return `${title}. Scoring configuration ${source.scoringConfigVersionId} is bound to this result. Production SME validation is not claimed by this report.`;
      if (["SEC-07", "SEC-07.1"].includes(sectionId))
        return `${title}. The retained record contains ${row.candidate_count} candidates, ${row.evidence_count} evidence items, ${row.score_count} candidate scores, and ${row.claim_rows.length} claims. Verification status is preserved without elevation.`;
      if (sectionId === "SEC-08")
        return `${title}. Considered candidate landscape: ${candidateSummary}`;
      if (sectionId === "SEC-09.2")
        return `${title}. Comparable stored score facts: ${scoreSummary}`;
      if (sectionId === "SEC-10.1")
        return `${title}. No independent sensitivity run is recorded. The exact scoring configuration is ${source.scoringConfigVersionId}; no alternative weights are represented as tested.`;
      if (["SEC-19", "SEC-22"].includes(sectionId))
        return `${title}. Retrieved evidence register: ${evidenceSummary}`;
      if (sectionId === "SEC-09.3")
        return `${title}. Eligible count is ${String(landscape.eligible_count ?? "unknown")}; truncation is ${String(landscape.truncated === true)}.`;
      if (sectionId === "SEC-05.2")
        return `${title}. Recorded contradictions: ${JSON.stringify(canonicalContradictions).slice(0, 900)}.`;
      if (sectionId === "SEC-21")
        return `${title}. Stored limitations: ${row.limitations_text}`;
      if (sectionId === "SEC-11.1")
        return `${title}. RFQ questions must close these stored unknowns before award: ${missingRfqSummary || "none recorded"}. Supplier claims remain unverified unless the evidence register says otherwise.`;
      if (sectionId === "SEC-13")
        return `${title}. Issue the canonical requirement (${canonicalSummary}) with the unresolved RFQ fields explicitly marked: ${missingRfqSummary || "none recorded"}.`;
      if (sectionId === "SEC-14")
        return `${title}. Validate legal identity, authority, capacity, stock, route feasibility, sanctions, quality documentation, and commercial terms against the retained source register. This report does not claim those checks were executed.`;
      if (sectionId === "SEC-15")
        return `${title}. Contact eligible ranked candidates first; retain excluded candidates only with their recorded reason. Eligible count: ${row.eligible_count}.`;
      if (sectionId === "SEC-16")
        return `${title}. Before engagement, close RFQ unknowns; then validate identity and evidence, issue the RFQ, reconcile responses against mandatory gates, and record the decision. No execution is claimed.`;
      if (sectionId === "SEC-18")
        return `${title}. Immutable lineage binds canonical request ${source.canonicalRequestVersionId}, projection ${source.projectionVersionId}, result ${source.resultSha256}, scoring ${source.scoringConfigVersionId}, and model policy ${source.modelPolicyVersionId}.`;
      if (sectionId === "SEC-23")
        return `${title}. Governed outcome: ${row.outcome}; eligible candidates: ${row.eligible_count}. Apply the recorded limitations and complete due diligence before any supplier engagement.`;
      if (["SEC-03", "SEC-03.1", "SEC-03.2", "SEC-17"].includes(sectionId))
        return `${title}. Governed outcome: ${row.outcome}; eligible candidates: ${row.eligible_count}. ${candidateSummary}`;
      return `${title}. This section is based on canonical request ${source.canonicalRequestVersionId}, result digest ${source.resultSha256}, and ${row.evidence_count} retained evidence records.`;
    };
    const sections = REPORT_SECTION_REGISTRY.map((definition) => {
      if (
        definition.status === "conditional" &&
        !includedConditional(definition.section_id)
      )
        return null;
      if (definition.status === "required_explicit_empty") {
        const governedContent =
          definition.section_id === "SEC-05.3"
            ? missingRfqSummary
            : definition.section_id === "SEC-12"
              ? reserveSummary
              : excludedEvidenceSummary;
        if (governedContent)
          return Object.freeze({
            section_id: definition.section_id,
            source_references: Object.freeze([sourceReference]),
            blocks: Object.freeze([
              Object.freeze({
                kind: "paragraph" as const,
                text: text(governedContent, 1800),
              }),
            ]),
          });
        return Object.freeze({
          section_id: definition.section_id,
          source_references: Object.freeze([sourceReference]),
          blocks: Object.freeze([]),
          explicit_empty_reason:
            EXPLICIT_EMPTY_TEXT[
              definition.section_id as keyof typeof EXPLICIT_EMPTY_TEXT
            ],
        });
      }
      return Object.freeze({
        section_id: definition.section_id,
        source_references: Object.freeze([sourceReference]),
        blocks: Object.freeze([
          Object.freeze({
            kind: "paragraph" as const,
            text: text(sectionContent(definition.section_id, definition.title)),
          }),
        ]),
      });
    }).filter((section) => section !== null);
    const omitted = REPORT_SECTION_REGISTRY.filter(
      (definition) =>
        definition.status === "conditional" &&
        !includedConditional(definition.section_id),
    ).map((definition) =>
      Object.freeze({
        section_id: definition.section_id,
        authoritative_condition:
          "authoritative_condition" in definition
            ? definition.authoritative_condition
            : "",
        non_applicability_reason: text(
          "No server-owned condition record authorizes this conditional section.",
          160,
        ),
        source_references: Object.freeze([sourceReference]),
      }),
    );
    const preparedAt = row.assembled_at.toISOString();
    const model: ConsultantReportModelV1 = {
      schema_version: CONSULTANT_REPORT_MODEL_VERSION,
      brand_manifest_version: MATCHBASE_BRAND_MANIFEST_VERSION,
      document_control: {
        document: text("MatchBASE Consultant Report", 80),
        prepared_by: text("MatchBASE server-owned reporting pipeline", 80),
        prepared_at: preparedAt,
        classification: text("Confidential", 40),
        status: "For Review",
        basis: text(
          `Canonical request ${source.canonicalRequestVersionId} and research run ${source.runId}`,
          180,
        ),
      },
      lineage: {
        artifact_version: 1,
        generating_run_id: source.runId,
        canonical_request_version_id: source.canonicalRequestVersionId,
        projection_version_id: source.projectionVersionId,
        analyst_decision_set_id: source.analystDecisionSetId,
        result_sha256: source.resultSha256,
        template_version: source.templateVersion,
        page_geometry: source.pageGeometry,
        generated_by_subject_id: source.generatedByUserId,
        composed_at: preparedAt,
      },
      scoring_dimensions: CONSULTANT_REPORT_DIMENSIONS,
      sections,
      omitted_conditional_sections: omitted,
      claims: Object.freeze(
        row.claim_rows
          .filter((claim) => typeof claim.url === "string")
          .map((claim) => ({
            claim_id: String(claim.claim_id),
            assertion: text(String(claim.assertion), 500),
            materiality:
              claim.decision_bearing === true
                ? ("eligibility" as const)
                : ("context" as const),
            high_risk: claim.decision_bearing === true,
            section_ids: Object.freeze([
              "SEC-09" as const,
              "SEC-11.2" as const,
            ]),
          })),
      ),
      citations: Object.freeze(
        row.claim_rows
          .filter((claim) => typeof claim.url === "string")
          .map((claim) => ({
            claim_id: String(claim.claim_id),
            url: String(claim.url),
            publisher: text(
              String(claim.publisher ?? "publisher not stated"),
              120,
            ),
            published_or_updated: text("not stated by source", 40),
            accessed_at: new Date(String(claim.retrieved_at)).toISOString(),
            source_tier: "secondary_commentary" as const,
            verification_status:
              claim.verification === "synthetic"
                ? ("unknown" as const)
                : (claim.verification as
                    | "claimed"
                    | "externally_verified"
                    | "inferred"
                    | "stale"
                    | "conflicting"
                    | "unknown"),
            extracted_support: text(
              String(claim.title ?? claim.assertion),
              500,
            ),
            corroborated_by: Object.freeze([]),
            retrieval_run_id: source.runId,
          })),
      ),
    };
    const composed = composeConsultantReportV1(model);
    if (!composed.ok)
      throw new Error(
        `Consultant report composition failed: ${composed.failures.map((failure) => failure.code).join(",")}`,
      );
    return Object.freeze({
      reportModel: composed.value.model,
      modelSha256: composed.value.model_sha256,
      report: Object.freeze({
        title: "MatchBASE Consultant Report",
        sections: Object.freeze(
          composed.value.model.sections.map((section) =>
            Object.freeze({
              heading:
                REPORT_SECTION_REGISTRY.find(
                  (definition) => definition.section_id === section.section_id,
                )?.title ?? section.section_id,
              paragraphs: Object.freeze(
                section.blocks.length > 0
                  ? section.blocks.flatMap((block) => {
                      if (block.kind === "paragraph") return [block.text.value];
                      if (block.kind === "bullet_list")
                        return block.items.map((item) => item.value);
                      if (block.kind === "key_value")
                        return block.entries.map(
                          (entry) =>
                            `${entry.label.value}: ${entry.value.value}`,
                        );
                      return block.rows.map((row) =>
                        row.map((cell) => cell.value).join(" | "),
                      );
                    })
                  : [
                      section.explicit_empty_reason ??
                        "No content was authorized for this section.",
                    ],
              ),
            }),
          ),
        ),
      }),
    });
  }
}
