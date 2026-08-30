import type { ReactNode, RefObject } from "react";
import type { StandardResultProjectionV1 } from "./types";

const label = (value: string) => value.replaceAll("_", " ");

export function StandardResult({
  result,
  onBack,
  headingRef,
  disclosureCandidateLimit = 3,
  eyebrow = "Standard result",
  heading,
  backLabel = "Return to requests",
  contextBanner,
}: {
  result: Omit<
    StandardResultProjectionV1,
    "schema_version" | "projection_version"
  > & { schema_version: string; projection_version: number };
  onBack: () => void;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  disclosureCandidateLimit?: number;
  eyebrow?: string;
  heading?: string;
  backLabel?: string;
  contextBanner?: ReactNode;
}) {
  if (result.candidates.length > disclosureCandidateLimit) {
    return (
      <section
        className="standard-section"
        aria-labelledby="result-refusal-heading"
      >
        <p className="eyebrow">Standard result refused</p>
        <h1 id="result-refusal-heading" ref={headingRef} tabIndex={-1}>
          Result disclosure refused
        </h1>
        <div className="error-summary" role="alert">
          The server projection exceeded the Standard disclosure limit. No
          candidate data was rendered.
        </div>
        <button className="secondary-action" onClick={onBack}>
          {backLabel}
        </button>
      </section>
    );
  }
  return (
    <section
      className="standard-section standard-results"
      aria-labelledby="results-heading"
    >
      <p className="eyebrow">{eyebrow}</p>
      <h1 id="results-heading" ref={headingRef} tabIndex={-1}>
        {heading ??
          (result.outcome === "matched"
            ? "Responsible candidate comparison"
            : "No responsible match")}
      </h1>
      {contextBanner}
      {result.scarcity !== "none" ? (
        <div className="scarcity-summary" role="status">
          <strong>
            {result.scarcity === "zero"
              ? "No candidate met the mandatory constraints for this request."
              : `${result.candidates.length} ${result.candidates.length === 1 ? "candidate" : "candidates"} met all mandatory constraints. Fewer than three met them, so fewer than three are shown.`}
          </strong>
          <p>No padding or speculative candidate was added.</p>
        </div>
      ) : null}
      <p className="lede">
        Compatibility scores are deterministic synthetic measures, not
        probabilities or guarantees.
      </p>
      {result.candidates.length > 0 ? (
        <div
          className="standard-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Six-dimension candidate comparison"
        >
          <table className="standard-table comparison-table">
            <caption>
              Deterministic scores across the six fixed dimensions
            </caption>
            <thead>
              <tr>
                <th scope="col">Dimension</th>
                {result.candidates.map((candidate) => (
                  <th scope="col" key={candidate.display_name}>
                    <bdi dir="auto">{candidate.display_name}</bdi>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.candidates[0]!.dimension_scores.map(
                (dimension, index) => (
                  <tr key={dimension.dimension_id}>
                    <th scope="row">
                      {label(dimension.dimension_id)} ({dimension.weight}%)
                    </th>
                    {result.candidates.map((candidate) => (
                      <td key={candidate.display_name}>
                        {candidate.dimension_scores[index]!.score}{" "}
                        <small>
                          {candidate.dimension_scores[index]!.confidence}
                        </small>
                      </td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="candidate-grid">
        {result.candidates.map((candidate, index) => (
          <article
            className="candidate-card"
            key={`${candidate.display_name}-${candidate.country_code}`}
          >
            <div className="candidate-heading">
              <div>
                <p className="eyebrow">Candidate {index + 1}</p>
                <h2>
                  <bdi dir="auto">{candidate.display_name}</bdi>
                </h2>
                <p>{candidate.country_code}</p>
              </div>
              <div
                className="score-chip"
                role="meter"
                aria-label={`${candidate.display_name} compatibility score`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={candidate.compatibility_score}
                aria-valuetext={`${candidate.compatibility_score} of 100, ${label(candidate.fit_band)}`}
              >
                <strong>{candidate.compatibility_score}</strong>
                <span> of 100</span>
              </div>
            </div>
            <dl className="result-facts">
              <div>
                <dt>Fit band</dt>
                <dd>{label(candidate.fit_band)}</dd>
              </div>
              <div>
                <dt>Displayed band</dt>
                <dd>{label(candidate.displayed_band)}</dd>
              </div>
              <div>
                <dt>Evidence confidence</dt>
                <dd>{candidate.evidence_confidence}</dd>
              </div>
              <div>
                <dt>Freshness</dt>
                <dd>{candidate.freshness}</dd>
              </div>
            </dl>
            {candidate.band_ceiling_reason ? (
              <p className="cap-notice">
                Band cap: <bdi dir="auto">{candidate.band_ceiling_reason}</bdi>
              </p>
            ) : null}
            <p>
              <bdi dir="auto">{candidate.rationale_extended}</bdi>
            </p>
            <div className="driver-grid">
              <section>
                <h3>Positive drivers</h3>
                <ul>
                  {candidate.positive_drivers.map((item, itemIndex) => (
                    <li key={`positive-${item.claim_id}-${itemIndex}`}>
                      <bdi dir="auto">{item.explanation}</bdi>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>Limiting gaps</h3>
                <ul>
                  {candidate.limiting_gaps.map((item, itemIndex) => (
                    <li key={`limiting-${item.claim_id}-${itemIndex}`}>
                      <bdi dir="auto">{item.explanation}</bdi>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <details>
              <summary>
                Evidence and citations ({candidate.citations.length})
              </summary>
              {candidate.citations.map((citation) => (
                <article className="evidence-card" key={citation.evidence_id}>
                  <h3>
                    <bdi dir="auto">{citation.title}</bdi>
                  </h3>
                  <p>
                    <bdi dir="auto">{citation.publisher}</bdi> ·{" "}
                    {citation.source_tier.replaceAll("_", " ")} ·{" "}
                    {citation.status}
                  </p>
                  <p>
                    <bdi dir="auto">{citation.extract}</bdi>
                  </p>
                  {"exact_url" in citation ? (
                    <p>
                      <a
                        href={citation.exact_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open evidence source (opens in a new tab)
                      </a>
                    </p>
                  ) : null}
                  <p>
                    <time dateTime={citation.published_or_updated}>
                      Published/updated {citation.published_or_updated}
                    </time>{" "}
                    ·{" "}
                    <time dateTime={citation.accessed_at}>
                      accessed {citation.accessed_at}
                    </time>
                  </p>
                  <small>
                    {citation.access_state} · {citation.provenance}
                  </small>
                </article>
              ))}
            </details>
            {[
              ...(candidate.contact_details ?? []),
              ...(candidate.plant_identifiers ?? []),
              ...(candidate.approval_identifiers ?? []),
              ...(candidate.capacity_figures ?? []),
            ].length > 0 ? (
              <details>
                <summary>Evidence-supported organization values</summary>
                <dl className="result-facts">
                  {[
                    ...(candidate.contact_details ?? []),
                    ...(candidate.plant_identifiers ?? []),
                    ...(candidate.approval_identifiers ?? []),
                    ...(candidate.capacity_figures ?? []),
                  ].map((value, valueIndex) => (
                    <div key={`${value.kind}-${valueIndex}`}>
                      <dt>{label(value.kind)}</dt>
                      <dd>
                        <bdi dir="auto">{value.value}</bdi> ·{" "}
                        {label(value.verification_status)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
          </article>
        ))}
      </div>
      {result.scarcity === "zero" ? (
        <section aria-labelledby="unmet-constraints-heading">
          <h2 id="unmet-constraints-heading">
            Which mandatory constraints could not be met
          </h2>
          <ul>
            {result.scarcity_analysis.unmet_mandatory_constraints.map(
              (constraint) => (
                <li key={constraint.constraint_id}>
                  <bdi dir="auto">{constraint.label}</bdi>
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}
      {result.scarcity !== "none" ? (
        <section aria-labelledby="relaxations-heading">
          <h2 id="relaxations-heading">What you could relax</h2>
          {result.scarcity_analysis.permitted_relaxations.length > 0 ? (
            <ul>
              {result.scarcity_analysis.permitted_relaxations.map(
                (constraint) => (
                  <li key={constraint.constraint_id}>
                    <bdi dir="auto">{constraint.label}</bdi>. Requester-marked
                    direction: {label(constraint.direction)}; tolerance:{" "}
                    <bdi dir="auto">{constraint.tolerance}</bdi>.
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p>No requester-marked relaxable constraint is available.</p>
          )}
        </section>
      ) : null}
      {result.scarcity !== "none" ? (
        <section aria-labelledby="gate-heading">
          <h2 id="gate-heading">
            {result.scarcity === "zero"
              ? "How the candidate set was reduced"
              : "Which constraints reduced the set"}
          </h2>
          {result.scarcity_analysis.reducing_constraints.length > 0 ? (
            <ul>
              {result.scarcity_analysis.reducing_constraints.map(
                (constraint) => (
                  <li key={constraint.constraint_id}>
                    <bdi dir="auto">{constraint.label}</bdi>:{" "}
                    {constraint.eliminated_count} eliminated
                  </li>
                ),
              )}
            </ul>
          ) : null}
          <h3>Hard-gate elimination counts</h3>
          <ul>
            {result.gate_eliminations.map((gate) => (
              <li key={gate.gate_id}>
                <bdi dir="auto">{gate.label}</bdi>: {gate.eliminated_count}{" "}
                eliminated
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section
        className="limitations-panel"
        aria-labelledby="limitations-heading"
      >
        <h2 id="limitations-heading">Limitations and evidence state</h2>
        <p>
          Unknown values: {result.limitations.unknown_count}. Not asked:{" "}
          {result.limitations.not_asked_count}.
        </p>
        <p>
          <bdi dir="auto">{result.limitations.advisory_boundary}</bdi>
        </p>
        <p>
          <bdi dir="auto">
            {result.limitations.restricted_party_screening_notice}
          </bdi>
        </p>
        {result.limitations.affected_low_confidence_dimensions.length > 0 ? (
          <p>
            Low-confidence dimensions:{" "}
            {result.limitations.affected_low_confidence_dimensions
              .map(label)
              .join(", ")}
            .
          </p>
        ) : null}
        {result.limitations.cap_notice ? (
          <p>
            <bdi dir="auto">{result.limitations.cap_notice}</bdi>
          </p>
        ) : null}
        <ul>
          {result.limitations.evidence_states.map((state) => (
            <li key={state}>{label(state)}</li>
          ))}
        </ul>
      </section>
      <button className="secondary-action" onClick={onBack}>
        {backLabel}
      </button>
    </section>
  );
}
