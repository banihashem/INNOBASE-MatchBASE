import type { RefObject } from "react";
import type {
  ConsultantResultProjectionV1,
  ConsultantResultProjectionV2,
  ConsultantResearchOutputV2,
  DemoProjectionV1,
} from "@matchbase/contracts";
import { StandardResult } from "../standard/StandardResult";
import type { StandardResultProjectionV1 } from "../standard/types";
import { ConsultantResearchOutputView } from "./ConsultantResearchOutputView";

export type ConsultantVisibleResult =
  | DemoProjectionV1
  | StandardResultProjectionV1
  | ConsultantResultProjectionV1
  | ConsultantResultProjectionV2
  | ConsultantResearchOutputV2;

export interface ResultArtifactDownload {
  readonly run_id: string;
  readonly artifact_version_id: string;
  readonly version: number;
  readonly href: string;
}

export function ConsultantResultView({
  result,
  onBack,
  headingRef,
  artifactDownload,
}: {
  result: ConsultantVisibleResult;
  onBack: () => void;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  artifactDownload?: ResultArtifactDownload | null | undefined;
}) {
  if (result.schema_version === "consultant-research-output.v2")
    return (
      <ConsultantResearchOutputView
        result={result}
        onBack={onBack}
        {...(headingRef ? { headingRef } : {})}
        {...(artifactDownload ? { artifactDownload } : {})}
      />
    );
  if (result.schema_version === "standard-result-projection.v1")
    return (
      <StandardResult
        result={result}
        onBack={onBack}
        {...(headingRef ? { headingRef } : {})}
        backLabel="Return to runs"
      />
    );
  if (
    result.schema_version !== "consultant-result-projection.v1" &&
    result.schema_version !== "consultant-result-projection.v2"
  ) {
    const demo = result as DemoProjectionV1;
    return (
      <section
        className="standard-section"
        aria-labelledby="demo-history-heading"
      >
        <p className="eyebrow">Historical Demo projection</p>
        <h1 id="demo-history-heading" ref={headingRef} tabIndex={-1}>
          Original disclosure depth preserved
        </h1>
        <p className="lede">{demo.limitations_notice}</p>
        <div className="candidate-grid">
          {demo.candidates.map((candidate) => (
            <article
              className="candidate-card"
              key={`${candidate.display_name}-${candidate.country_code}`}
            >
              <h2>
                <bdi dir="auto">{candidate.display_name}</bdi>
              </h2>
              <p>{candidate.country_code}</p>
              <p>
                <bdi dir="auto">{candidate.rationale_short}</bdi>
              </p>
            </article>
          ))}
        </div>
        <button className="secondary-action" onClick={onBack}>
          Return to runs
        </button>
      </section>
    );
  }
  const consultant = result as
    ConsultantResultProjectionV1 | ConsultantResultProjectionV2;
  const expanded =
    consultant.schema_version === "consultant-result-projection.v2"
      ? consultant
      : null;
  const agricultural =
    expanded?.source_policy.domain_pack_id ===
    "MATCHBASE-FOOD-AGRICULTURAL-COMMODITIES-V1";
  return (
    <StandardResult
      result={consultant}
      onBack={onBack}
      {...(headingRef ? { headingRef } : {})}
      disclosureCandidateLimit={consultant.landscape.soft_cap}
      eyebrow="Consultant result"
      heading="Eligible candidate landscape"
      backLabel="Return to runs"
      contextBanner={
        <>
          {artifactDownload ? (
            <p>
              <a
                className="secondary-action"
                href={artifactDownload.href}
                download
                data-matchbase-artifact-run-id={artifactDownload.run_id}
                data-matchbase-artifact-version-id={
                  artifactDownload.artifact_version_id
                }
                data-matchbase-artifact-version={artifactDownload.version}
                aria-label={`Download PDF report for run ${artifactDownload.run_id}, artifact version ${artifactDownload.version}`}
              >
                Download PDF report
              </a>
            </p>
          ) : null}
          <dl
            className="result-facts"
            aria-label="Candidate landscape disclosure"
          >
            <div>
              <dt>Eligible candidates</dt>
              <dd>{consultant.landscape.eligible_count}</dd>
            </div>
            <div>
              <dt>Displayed candidates</dt>
              <dd>{consultant.landscape.displayed_count}</dd>
            </div>
            <div>
              <dt>Configured soft cap</dt>
              <dd>{consultant.landscape.soft_cap}</dd>
            </div>
            <div>
              <dt>Truncated</dt>
              <dd>{consultant.landscape.truncated ? "Yes" : "No"}</dd>
            </div>
          </dl>
          {consultant.landscape.truncation_notice ? (
            <div className="scarcity-summary" role="status">
              {consultant.landscape.truncation_notice}
            </div>
          ) : null}
          {consultant.landscape.scarcity_override_applied ? (
            <p className="cap-notice">
              Fewer than three candidates are eligible, so the safety scarcity
              rule overrides the documented minimum. Every eligible candidate is
              shown; no padding was added.
            </p>
          ) : null}
          {expanded ? (
            <>
              <div className="error-summary" role="status">
                <strong>Production release remains blocked.</strong> This is
                {agricultural
                  ? " agent-researched agricultural qualification content. "
                  : " agent-researched synthetic qualification content. "}
                Human Consultant authorship and production SME validation are
                not claimed.
              </div>
              <section aria-labelledby="consultant-source-policy-heading">
                <h2 id="consultant-source-policy-heading">Source policy</h2>
                <dl className="result-facts">
                  <div>
                    <dt>Policy</dt>
                    <dd>{expanded.source_policy.policy_id}</dd>
                  </div>
                  <div>
                    <dt>Policy version</dt>
                    <dd>{expanded.source_policy.policy_version}</dd>
                  </div>
                  <div>
                    <dt>Domain pack</dt>
                    <dd>{expanded.source_policy.domain_pack_id}</dd>
                  </div>
                </dl>
              </section>
              <section aria-labelledby="consultant-wave-heading">
                <h2 id="consultant-wave-heading">
                  {agricultural
                    ? "Agricultural RFQ wave recommendation"
                    : "Synthetic RFQ wave recommendation"}
                </h2>
                <p>Wave 1 action: {expanded.wave_recommendations[0].action}</p>
                <ol>
                  {expanded.wave_recommendations[0].candidates.map(
                    (candidate) => (
                      <li key={candidate.candidate_id}>
                        Rank {candidate.rank}: {candidate.display_name} (
                        {candidate.country_code})
                      </li>
                    ),
                  )}
                </ol>
                <h3>Next-ranked eligible reserves</h3>
                {expanded.reserve_candidates.length ? (
                  <ol start={expanded.landscape.displayed_count + 1}>
                    {expanded.reserve_candidates.map((candidate) => (
                      <li key={candidate.candidate_id}>
                        Rank {candidate.rank}: {candidate.display_name} (
                        {candidate.country_code})
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>
                    No eligible reserve candidate remains after the displayed
                    wave.
                  </p>
                )}
              </section>
              <section aria-labelledby="consultant-rfq-state-heading">
                <h2 id="consultant-rfq-state-heading">
                  {agricultural
                    ? "Agricultural RFQ execution snapshot"
                    : "Synthetic RFQ execution snapshot"}
                </h2>
                <p>
                  Planning only: no supplier was contacted and no response was
                  collected.
                </p>
                <dl className="result-facts">
                  <div>
                    <dt>Wave</dt>
                    <dd>
                      {expanded.rfq_execution_snapshot.wave_id} sequence{" "}
                      {expanded.rfq_execution_snapshot.wave_sequence}
                    </dd>
                  </div>
                  <div>
                    <dt>Initial / subsequent / threshold</dt>
                    <dd>3 / 2 / 3</dd>
                  </div>
                  <div>
                    <dt>Wave instance SHA-256</dt>
                    <dd className="break-anywhere">
                      {expanded.rfq_execution_snapshot.wave_instance_id}
                    </dd>
                  </div>
                  <div>
                    <dt>Stop state</dt>
                    <dd>{expanded.rfq_execution_snapshot.stop_state}</dd>
                  </div>
                </dl>
                <p>
                  Next reserve promotion:{" "}
                  {expanded.rfq_execution_snapshot.next_reserve_promotion.state}
                  ; one next-ranked eligible candidate only.
                </p>
              </section>
              <details>
                <summary>Bound configuration release</summary>
                <dl>
                  <div>
                    <dt>Configuration</dt>
                    <dd>{expanded.configuration_release.config_id}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>{expanded.configuration_release.config_version}</dd>
                  </div>
                  <div>
                    <dt>Content SHA-256</dt>
                    <dd className="break-anywhere">
                      {expanded.configuration_release.content_sha256}
                    </dd>
                  </div>
                  <div>
                    <dt>Bound at</dt>
                    <dd>{expanded.configuration_release.bound_at}</dd>
                  </div>
                  <div>
                    <dt>Effective release</dt>
                    <dd>
                      {expanded.configuration_release.effective_release_at}
                    </dd>
                  </div>
                </dl>
              </details>
              <details>
                <summary>
                  {agricultural ? "Agricultural" : "Synthetic"} RFQ question set
                  ({expanded.rfq_questions.length})
                </summary>
                <ol>
                  {expanded.rfq_questions.map((question) => (
                    <li key={question.question_id}>
                      <strong>{question.question_id}</strong>:{" "}
                      {question.required_response}
                      <span> — Not collected</span>
                    </li>
                  ))}
                </ol>
              </details>
              <details>
                <summary>
                  Due-diligence checklist (
                  {expanded.due_diligence_checklist.length})
                </summary>
                <ol>
                  {expanded.due_diligence_checklist.map((check) => (
                    <li key={check.check_id}>
                      <strong>{check.label}</strong>: Not executed; required
                      before production.
                    </li>
                  ))}
                </ol>
              </details>
              <details>
                <summary>Source facts ({expanded.source_facts.length})</summary>
                <p>
                  Supplier title and publisher are display claims only. Fetch
                  success does not establish external verification.
                </p>
                <ul>
                  {expanded.source_facts.map((evidence) => (
                    <li key={evidence.evidence_id}>
                      <strong>{evidence.title}</strong> — {evidence.publisher}
                      {"exact_url" in evidence
                        ? ` (${evidence.publisher_domain})`
                        : " (repository fixture)"}
                      <dl>
                        <div>
                          <dt>Evidence ID</dt>
                          <dd>{evidence.evidence_id}</dd>
                        </div>
                        <div>
                          <dt>Retrieved</dt>
                          <dd>
                            <time dateTime={evidence.accessed_at}>
                              {evidence.accessed_at}
                            </time>
                          </dd>
                        </div>
                        <div>
                          <dt>Content SHA-256</dt>
                          <dd>{evidence.content_sha256}</dd>
                        </div>
                        <div>
                          <dt>Disposition</dt>
                          <dd>{evidence.verification_disposition}</dd>
                        </div>
                      </dl>
                      {"exact_url" in evidence ? (
                        <p>
                          Canonical URL:{" "}
                          <a
                            className="break-anywhere"
                            href={evidence.exact_url}
                          >
                            {evidence.exact_url}
                          </a>
                        </p>
                      ) : (
                        <p>Fixture identity: {evidence.fixture_identity}</p>
                      )}
                      <p>{evidence.extract}</p>
                    </li>
                  ))}
                </ul>
              </details>
              <details>
                <summary>
                  Excluded evidence ({expanded.excluded_evidence.length})
                </summary>
                {expanded.excluded_evidence.length ? (
                  <ul>
                    {expanded.excluded_evidence.map((evidence) => (
                      <li key={evidence.evidence_id}>
                        <strong>{evidence.title}</strong>:{" "}
                        {evidence.exclusion_reason}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    No evidence was excluded in this{" "}
                    {agricultural ? "agricultural" : "synthetic"} result.
                  </p>
                )}
              </details>
              <section aria-labelledby="consultant-limitations-heading">
                <h2 id="consultant-limitations-heading">Full limitations</h2>
                <ul>
                  {expanded.full_limitations.notices.map((notice) => (
                    <li key={notice}>{notice}</li>
                  ))}
                </ul>
              </section>
            </>
          ) : (
            <div className="error-summary" role="status">
              <strong>Consultant source readiness: limited.</strong>{" "}
              {
                (consultant as ConsultantResultProjectionV1)
                  .consultant_source_readiness.notice
              }
            </div>
          )}
        </>
      }
    />
  );
}
