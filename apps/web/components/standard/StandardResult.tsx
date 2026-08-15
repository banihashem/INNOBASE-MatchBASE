import type { StandardResultProjectionV1 } from "./types";

const label = (value: string) => value.replaceAll("_", " ");

export function StandardResult({
  result,
  onBack,
}: {
  result: StandardResultProjectionV1;
  onBack: () => void;
}) {
  if (result.candidates.length > 3) {
    return (
      <section className="standard-section">
        <div className="error-summary" role="alert">
          The server projection exceeded the Standard disclosure limit. No
          candidate data was rendered.
        </div>
        <button className="secondary-action" onClick={onBack}>
          Return to requests
        </button>
      </section>
    );
  }
  return (
    <section
      className="standard-section standard-results"
      aria-labelledby="results-heading"
    >
      <p className="eyebrow">Standard result</p>
      <h2 id="results-heading">
        {result.outcome === "matched"
          ? "Responsible candidate comparison"
          : "No responsible match"}
      </h2>
      <p className="lede">
        Compatibility scores are deterministic synthetic measures, not
        probabilities or guarantees.
      </p>
      {result.scarcity !== "none" ? (
        <div className="validation-summary" role="status">
          <strong>
            {result.scarcity === "zero"
              ? "No responsible candidate passed the hard gates."
              : "Limited responsible candidate availability."}
          </strong>
          <p>No padding or speculative candidate was added.</p>
        </div>
      ) : null}
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
                    {candidate.display_name}
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
                <h3>
                  <bdi>{candidate.display_name}</bdi>
                </h3>
                <p>{candidate.country_code}</p>
              </div>
              <div className="score-chip">
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
                Band cap: {candidate.band_ceiling_reason}
              </p>
            ) : null}
            <p>{candidate.rationale_extended}</p>
            <div className="driver-grid">
              <section>
                <h4>Positive drivers</h4>
                <ul>
                  {candidate.positive_drivers.map((item) => (
                    <li key={item.claim_id}>{item.explanation}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h4>Limiting gaps</h4>
                <ul>
                  {candidate.limiting_gaps.map((item) => (
                    <li key={item.claim_id}>{item.explanation}</li>
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
                  <h4>
                    <bdi>{citation.title}</bdi>
                  </h4>
                  <p>
                    {citation.publisher} ·{" "}
                    {citation.source_tier.replaceAll("_", " ")} ·{" "}
                    {citation.status}
                  </p>
                  <p>
                    <bdi>{citation.extract}</bdi>
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
                        {value.value} · {label(value.verification_status)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
          </article>
        ))}
      </div>
      <section aria-labelledby="gate-heading">
        <h3 id="gate-heading">Hard-gate eliminations</h3>
        <ul>
          {result.gate_eliminations.map((gate) => (
            <li key={gate.gate_id}>
              {gate.label}: {gate.eliminated_count} eliminated
            </li>
          ))}
        </ul>
      </section>
      <section
        className="limitations-panel"
        aria-labelledby="limitations-heading"
      >
        <h3 id="limitations-heading">Limitations and evidence state</h3>
        <p>
          Unknown values: {result.limitations.unknown_count}. Not asked:{" "}
          {result.limitations.not_asked_count}.
        </p>
        <p>{result.limitations.advisory_boundary}</p>
        <p>{result.limitations.restricted_party_screening_notice}</p>
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
          <p>{result.limitations.cap_notice}</p>
        ) : null}
        <ul>
          {result.limitations.evidence_states.map((state) => (
            <li key={state}>{label(state)}</li>
          ))}
        </ul>
      </section>
      <button className="secondary-action" onClick={onBack}>
        Return to requests
      </button>
    </section>
  );
}
