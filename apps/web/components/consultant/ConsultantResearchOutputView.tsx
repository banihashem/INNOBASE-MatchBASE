import type { RefObject } from "react";
import {
  type ConsultantResearchOutputV2,
  CANONICAL_MATCH_DIMENSIONS_V2,
} from "@matchbase/contracts";
import type { ResultArtifactDownload } from "./ConsultantResult";

export function ConsultantResearchOutputView({
  result,
  onBack,
  headingRef,
  artifactDownload,
}: {
  result: ConsultantResearchOutputV2;
  onBack: () => void;
  headingRef?: RefObject<HTMLHeadingElement | null> | undefined;
  artifactDownload?: ResultArtifactDownload | null | undefined;
}) {
  const {
    result_id,
    run_id,
    generated_at,
    research_mode,
    research_status,
    request_snapshot,
    executive_summary,
    result_modules,
    supplier_candidates,
    claims,
    evidence,
    unknowns,
    assumptions,
    limitations,
    decision_support,
  } = result;

  const isNoMatch = research_status === "no_strong_match";

  return (
    <div
      className="standard-section consultant-v2-container"
      style={{ maxWidth: "1200px", margin: "0 auto", padding: "1.5rem 1rem" }}
    >
      {/* Top Bar with Back Action & Download */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <button className="secondary-action" onClick={onBack} type="button">
          &larr; Return to runs
        </button>
        {artifactDownload ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              flexWrap: "wrap",
            }}
          >
            <a
              className="secondary-action"
              href={artifactDownload.href}
              download
              data-matchbase-artifact-run-id={artifactDownload.run_id}
              data-matchbase-artifact-version-id={
                artifactDownload.artifact_version_id
              }
              data-matchbase-artifact-version={artifactDownload.version}
              aria-label={`Download PDF report for run ${artifactDownload.run_id}`}
              style={{ fontWeight: 600 }}
            >
              Download PDF report
            </a>
          </div>
        ) : null}
      </div>

      {/* Header & Badges */}
      <header
        style={{
          marginBottom: "2rem",
          borderBottom: "1px solid #334155",
          paddingBottom: "1.5rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          <span
            className="eyebrow"
            style={{
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "#93c5fd",
            }}
          >
            Consultant Deep-Research Output V2
          </span>
          <span
            className="badge-query-type"
            style={{
              background: "#e2e8f0",
              color: "#0f172a",
              borderRadius: "4px",
              padding: "2px 8px",
              fontSize: "0.75rem",
              fontWeight: 700,
            }}
          >
            {request_snapshot.primary_query_type.toUpperCase()}
          </span>
          {request_snapshot.secondary_query_types.map((st) => (
            <span
              key={st}
              className="badge-query-type"
              style={{
                background: "#e2e8f0",
                color: "#0f172a",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "0.75rem",
                fontWeight: 600,
              }}
            >
              +{st}
            </span>
          ))}
          <span
            style={{
              borderRadius: "4px",
              padding: "2px 8px",
              fontSize: "0.75rem",
              fontWeight: 700,
              background:
                research_status === "complete"
                  ? "#def7ec"
                  : research_status === "no_strong_match"
                    ? "#fde8e8"
                    : "#fef3c7",
              color:
                research_status === "complete"
                  ? "#03543f"
                  : research_status === "no_strong_match"
                    ? "#9b1c1c"
                    : "#78350f",
            }}
          >
            {research_status === "insufficient_evidence"
              ? "RESEARCH COVERAGE: INSUFFICIENT"
              : `STATUS: ${research_status.replace(/_/g, " ").toUpperCase()}`}
          </span>
          <span
            style={{
              background: "#1e293b",
              borderRadius: "4px",
              padding: "2px 8px",
              fontSize: "0.75rem",
              color: "#f8fafc",
              fontWeight: 600,
            }}
          >
            MODE: {research_mode}
          </span>
        </div>

        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{
            fontSize: "1.75rem",
            fontWeight: 700,
            lineHeight: 1.3,
            marginBottom: "0.75rem",
            color: "#f8fafc",
          }}
        >
          <bdi dir="auto">{executive_summary.headline}</bdi>
        </h1>
        <p
          className="lede"
          style={{
            fontSize: "1.1rem",
            color: "#cbd5e1",
            lineHeight: 1.5,
            marginBottom: "1rem",
          }}
        >
          <bdi dir="auto">{executive_summary.direct_answer}</bdi>
        </p>

        {/* Metadata Details */}
        <div
          style={{
            display: "flex",
            gap: "1.5rem",
            fontSize: "0.85rem",
            color: "#cbd5e1",
            flexWrap: "wrap",
          }}
        >
          <span>
            <strong style={{ color: "#f8fafc" }}>Result ID:</strong> {result_id}
          </span>
          <span>
            <strong style={{ color: "#f8fafc" }}>Run ID:</strong> {run_id}
          </span>
          <span>
            <strong style={{ color: "#f8fafc" }}>Generated:</strong>{" "}
            {new Date(generated_at).toLocaleString()}
          </span>
          <span>
            <strong style={{ color: "#f8fafc" }}>Product:</strong>{" "}
            {request_snapshot.product_name}
          </span>
          {request_snapshot.geographic_scope ? (
            <span>
              <strong style={{ color: "#f8fafc" }}>Scope:</strong>{" "}
              {request_snapshot.geographic_scope}
            </span>
          ) : null}
        </div>
      </header>

      {/* Insufficient Evidence Alert Notice (F08) */}
      {research_status === "insufficient_evidence" ? (
        <section
          role="alert"
          style={{
            background: "#fffbeb",
            border: "2px solid #fde68a",
            borderRadius: "8px",
            padding: "1.25rem 1.5rem",
            marginBottom: "2rem",
            color: "#92400e",
          }}
        >
          <h2
            style={{
              color: "#78350f",
              fontSize: "1.15rem",
              margin: "0 0 0.5rem",
              fontWeight: 700,
            }}
          >
            Market coverage: Insufficient
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: "0.95rem",
              lineHeight: 1.5,
              color: "#92400e",
            }}
          >
            <bdi dir="auto">
              This candidate is supported by strong evidence, but the available
              market coverage is too limited to conclude that the shortlist is
              complete.
            </bdi>
          </p>
        </section>
      ) : null}

      {/* No-Match Alert Notice (First-Class State) */}
      {isNoMatch ? (
        <section
          role="alert"
          style={{
            background: "#fff5f5",
            border: "2px solid #feb2b2",
            borderRadius: "8px",
            padding: "1.5rem",
            marginBottom: "2rem",
          }}
        >
          <h2
            style={{
              color: "#9b1c1c",
              fontSize: "1.25rem",
              margin: "0 0 0.5rem",
            }}
          >
            No Responsible Match Identified
          </h2>
          <p
            style={{
              color: "#742a2a",
              margin: "0 0 1rem",
              fontSize: "1rem",
              lineHeight: 1.5,
            }}
          >
            <bdi dir="auto">
              {executive_summary.no_match_summary ??
                "Zero candidates in the target market satisfy all mandatory constraints. The platform intentionally avoids fabricating speculative or unqualified matches."}
            </bdi>
          </p>
          {result_modules.sourcing?.recommendations_summary ? (
            <div
              className="surface-light-card"
              style={{
                background: "#ffffff",
                color: "#334155",
                padding: "1rem",
                borderRadius: "6px",
                border: "1px solid #fbd5d5",
              }}
            >
              <strong style={{ color: "#9b1c1c" }}>
                Recommended Relaxation:{" "}
              </strong>
              <span style={{ color: "#334155" }}>
                <bdi dir="auto">
                  {result_modules.sourcing.recommendations_summary}
                </bdi>
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Executive Summary Card */}
      <section
        aria-labelledby="executive-summary-heading"
        style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: "8px",
          padding: "1.5rem",
          marginBottom: "2rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <h2
            id="executive-summary-heading"
            style={{
              margin: 0,
              fontSize: "1.25rem",
              fontWeight: 700,
              color: "#0f172a",
            }}
          >
            Executive Synthesis
          </h2>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <span
              style={{
                background: "#e0e7ff",
                color: "#3730a3",
                padding: "3px 10px",
                borderRadius: "12px",
                fontSize: "0.8rem",
                fontWeight: 600,
              }}
            >
              Confidence:{" "}
              {executive_summary.confidence_assessment.toUpperCase()}
            </span>
            <span
              style={{
                background: "#f1f5f9",
                color: "#0f172a",
                padding: "3px 10px",
                borderRadius: "12px",
                fontSize: "0.8rem",
                fontWeight: 600,
              }}
            >
              Candidates: {executive_summary.candidate_count}
            </span>
          </div>
        </div>

        {executive_summary.key_findings.length > 0 ? (
          <ul style={{ margin: "0 0 1rem 1.25rem", padding: 0 }}>
            {executive_summary.key_findings.map((finding, idx) => (
              <li
                key={idx}
                style={{
                  marginBottom: "0.5rem",
                  color: "#1e293b",
                  lineHeight: 1.5,
                }}
              >
                <bdi dir="auto">{finding}</bdi>
              </li>
            ))}
          </ul>
        ) : null}

        {executive_summary.primary_limitation ? (
          <div
            style={{
              fontSize: "0.85rem",
              color: "#78350f",
              background: "#fef3c7",
              border: "1px solid #fde68a",
              padding: "0.75rem 1rem",
              borderRadius: "6px",
              marginTop: "0.75rem",
            }}
          >
            <strong>Primary Limitation: </strong>
            <bdi dir="auto">{executive_summary.primary_limitation}</bdi>
          </div>
        ) : null}
      </section>

      {/* MODULE: SOURCING */}
      {result_modules.sourcing ? (
        <section
          aria-labelledby="sourcing-module-heading"
          style={{ marginBottom: "2rem" }}
        >
          <h2
            id="sourcing-module-heading"
            style={{
              fontSize: "1.35rem",
              fontWeight: 700,
              marginBottom: "1rem",
              color: "#f8fafc",
            }}
          >
            Sourcing & Market Landscape
          </h2>
          <div
            className="surface-light-card"
            style={{
              background: "#ffffff",
              color: "#334155",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "1.25rem",
              marginBottom: "1rem",
            }}
          >
            <p
              style={{ margin: "0 0 1rem", lineHeight: 1.5, color: "#334155" }}
            >
              <bdi dir="auto">
                {result_modules.sourcing.market_landscape_summary}
              </bdi>
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "1rem",
                marginBottom: "1rem",
              }}
            >
              <div
                style={{
                  background: "#f8fafc",
                  padding: "0.75rem 1rem",
                  borderRadius: "6px",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#475569",
                    textTransform: "uppercase",
                    fontWeight: 600,
                  }}
                >
                  Evaluated Suppliers
                </div>
                <div
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    color: "#0f172a",
                  }}
                >
                  {result_modules.sourcing.evaluated_supplier_count}
                </div>
              </div>
              <div
                style={{
                  background: "#f8fafc",
                  padding: "0.75rem 1rem",
                  borderRadius: "6px",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#475569",
                    textTransform: "uppercase",
                    fontWeight: 600,
                  }}
                >
                  Qualified Suppliers
                </div>
                <div
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    color: "#15803d",
                  }}
                >
                  {result_modules.sourcing.qualified_supplier_count}
                </div>
              </div>
              {result_modules.sourcing.trade_lane_evaluated ? (
                <div
                  style={{
                    background: "#f8fafc",
                    padding: "0.75rem 1rem",
                    borderRadius: "6px",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "#475569",
                      textTransform: "uppercase",
                      fontWeight: 600,
                    }}
                  >
                    Trade Lane
                  </div>
                  <div
                    style={{
                      fontSize: "0.9rem",
                      fontWeight: 600,
                      marginTop: "4px",
                      color: "#0f172a",
                    }}
                  >
                    {result_modules.sourcing.trade_lane_evaluated}
                  </div>
                </div>
              ) : null}
            </div>

            {result_modules.sourcing.key_bottlenecks.length > 0 ? (
              <div style={{ marginBottom: "0.75rem" }}>
                <strong style={{ fontSize: "0.85rem", color: "#475569" }}>
                  Key Supply Bottlenecks:
                </strong>
                <ul
                  style={{
                    margin: "0.25rem 0 0 1.25rem",
                    padding: 0,
                    fontSize: "0.9rem",
                  }}
                >
                  {result_modules.sourcing.key_bottlenecks.map((b, i) => (
                    <li key={i} style={{ color: "#334155" }}>
                      <bdi dir="auto">{b}</bdi>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {result_modules.sourcing.recommendations_summary ? (
              <div
                style={{
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  padding: "0.75rem 1rem",
                  borderRadius: "6px",
                  fontSize: "0.9rem",
                  color: "#166534",
                }}
              >
                <strong>Strategic Recommendation: </strong>
                <bdi dir="auto">
                  {result_modules.sourcing.recommendations_summary}
                </bdi>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* MODULE: PRICING */}
      {result_modules.pricing ? (
        <section
          aria-labelledby="pricing-module-heading"
          style={{ marginBottom: "2rem" }}
        >
          <h2
            id="pricing-module-heading"
            style={{
              fontSize: "1.35rem",
              fontWeight: 700,
              marginBottom: "1rem",
              color: "#f8fafc",
            }}
          >
            Commercial Pricing & Benchmark Intelligence
          </h2>
          <div
            className="surface-light-card"
            style={{
              background: "#ffffff",
              color: "#334155",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "1.25rem",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1rem",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
            >
              <p style={{ margin: 0, fontWeight: 600, color: "#334155" }}>
                <bdi dir="auto">{result_modules.pricing.overview}</bdi>
              </p>
              <span
                style={{
                  borderRadius: "12px",
                  padding: "4px 12px",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  background:
                    result_modules.pricing.volatility_rating === "high"
                      ? "#fee2e2"
                      : result_modules.pricing.volatility_rating === "medium"
                        ? "#fef3c7"
                        : "#dcfce7",
                  color:
                    result_modules.pricing.volatility_rating === "high"
                      ? "#991b1b"
                      : result_modules.pricing.volatility_rating === "medium"
                        ? "#92400e"
                        : "#166534",
                }}
              >
                VOLATILITY:{" "}
                {result_modules.pricing.volatility_rating.toUpperCase()}
              </span>
            </div>

            {/* Benchmarks Table */}
            {result_modules.pricing.benchmarks.length > 0 ? (
              <div style={{ marginBottom: "1.5rem" }}>
                <h3
                  style={{
                    fontSize: "1rem",
                    fontWeight: 600,
                    marginBottom: "0.5rem",
                    color: "#0f172a",
                  }}
                >
                  Official Reference Benchmarks
                </h3>
                <div
                  className="table-responsive-container"
                  style={{ overflowX: "auto" }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.9rem",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: "#f1f5f9",
                          textAlign: "left",
                          borderBottom: "2px solid #cbd5e1",
                        }}
                      >
                        <th
                          style={{
                            padding: "8px 12px",
                            color: "#0f172a",
                            fontWeight: 700,
                          }}
                        >
                          Benchmark Index
                        </th>
                        <th
                          style={{
                            padding: "8px 12px",
                            color: "#0f172a",
                            fontWeight: 700,
                          }}
                        >
                          Price
                        </th>
                        <th
                          style={{
                            padding: "8px 12px",
                            color: "#0f172a",
                            fontWeight: 700,
                          }}
                        >
                          Unit
                        </th>
                        <th
                          style={{
                            padding: "8px 12px",
                            color: "#0f172a",
                            fontWeight: 700,
                          }}
                        >
                          Source
                        </th>
                        <th
                          style={{
                            padding: "8px 12px",
                            color: "#0f172a",
                            fontWeight: 700,
                          }}
                        >
                          As Of
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result_modules.pricing.benchmarks.map((b, idx) => (
                        <tr
                          key={idx}
                          style={{ borderBottom: "1px solid #e2e8f0" }}
                        >
                          <td
                            style={{
                              padding: "8px 12px",
                              fontWeight: 600,
                              color: "#0f172a",
                            }}
                          >
                            {b.benchmark_name}
                          </td>
                          <td
                            style={{
                              padding: "8px 12px",
                              color: "#15803d",
                              fontWeight: 700,
                            }}
                          >
                            {b.currency} {b.benchmark_price.toLocaleString()}
                          </td>
                          <td style={{ padding: "8px 12px", color: "#334155" }}>
                            {b.unit}
                          </td>
                          <td style={{ padding: "8px 12px", color: "#475569" }}>
                            {b.source}
                          </td>
                          <td style={{ padding: "8px 12px", color: "#475569" }}>
                            {b.as_of_date}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {/* Observations Grid */}
            {result_modules.pricing.pricing_observations.length > 0 ? (
              <div>
                <h3
                  style={{
                    fontSize: "1rem",
                    fontWeight: 600,
                    marginBottom: "0.75rem",
                    color: "#0f172a",
                  }}
                >
                  Observed Market Quotations
                </h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                    gap: "1rem",
                  }}
                >
                  {result_modules.pricing.pricing_observations.map((obs) => (
                    <div
                      key={obs.observation_id}
                      className="surface-light-card"
                      style={{
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        padding: "1rem",
                        background: "#fafafa",
                        color: "#334155",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: "0.5rem",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            color: "#475569",
                          }}
                        >
                          {obs.observation_id}
                        </span>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            background: "#e2e8f0",
                            color: "#0f172a",
                            fontWeight: 600,
                            padding: "1px 6px",
                            borderRadius: "4px",
                          }}
                        >
                          {obs.price_type}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: "1.3rem",
                          fontWeight: 700,
                          color: "#0f172a",
                          marginBottom: "0.5rem",
                        }}
                      >
                        {obs.currency}{" "}
                        {obs.amount_min !== undefined &&
                        obs.amount_max !== undefined
                          ? `${obs.amount_min} - ${obs.amount_max}`
                          : (obs.amount_min ?? obs.amount_max)}{" "}
                        <span
                          style={{
                            fontSize: "0.85rem",
                            color: "#475569",
                            fontWeight: 400,
                          }}
                        >
                          / {obs.unit}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: "0.85rem",
                          color: "#475569",
                          lineHeight: 1.4,
                        }}
                      >
                        {obs.incoterm ? (
                          <div>
                            <strong>Incoterm:</strong> {obs.incoterm}
                          </div>
                        ) : null}
                        {obs.location_basis ? (
                          <div>
                            <strong>Location:</strong> {obs.location_basis}
                          </div>
                        ) : null}
                        {obs.quantity_basis ? (
                          <div>
                            <strong>Basis:</strong> {obs.quantity_basis}
                          </div>
                        ) : null}
                        {obs.notes ? (
                          <div
                            style={{
                              marginTop: "0.25rem",
                              fontStyle: "italic",
                            }}
                          >
                            <bdi dir="auto">{obs.notes}</bdi>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {result_modules.pricing.price_factors.length > 0 ? (
              <div
                style={{
                  marginTop: "1rem",
                  paddingTop: "1rem",
                  borderTop: "1px solid #f1f5f9",
                }}
              >
                <strong style={{ fontSize: "0.85rem", color: "#475569" }}>
                  Key Price Drivers:{" "}
                </strong>
                {result_modules.pricing.price_factors.map((f, i) => (
                  <span
                    key={i}
                    style={{
                      display: "inline-block",
                      background: "#f1f5f9",
                      color: "#0f172a",
                      borderRadius: "4px",
                      padding: "2px 8px",
                      fontSize: "0.8rem",
                      margin: "2px 4px",
                    }}
                  >
                    {f}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* MODULE: PRODUCT RECOMMENDATION */}
      {result_modules.product_recommendation ? (
        <section
          aria-labelledby="recommendation-module-heading"
          style={{ marginBottom: "2rem" }}
        >
          <h2
            id="recommendation-module-heading"
            style={{
              fontSize: "1.35rem",
              fontWeight: 700,
              marginBottom: "1rem",
              color: "#f8fafc",
            }}
          >
            Formulation & Product Recommendations
          </h2>
          <div
            className="surface-light-card"
            style={{
              background: "#ffffff",
              color: "#334155",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "1.25rem",
            }}
          >
            <p
              style={{ margin: "0 0 1rem", lineHeight: 1.5, color: "#334155" }}
            >
              <bdi dir="auto">
                {result_modules.product_recommendation.overview}
              </bdi>
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: "1.25rem",
              }}
            >
              {result_modules.product_recommendation.recommendations.map(
                (rec) => (
                  <div
                    key={rec.product_id}
                    className="surface-light-card"
                    style={{
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      padding: "1.25rem",
                      background: "#fafafa",
                      color: "#334155",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: "0.5rem",
                      }}
                    >
                      <h3
                        style={{
                          margin: 0,
                          fontSize: "1.1rem",
                          fontWeight: 700,
                          color: "#0f172a",
                        }}
                      >
                        <bdi dir="auto">{rec.product_name}</bdi>
                      </h3>
                      <span
                        style={{
                          background: "#dbeafe",
                          color: "#1e40af",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                        }}
                      >
                        {rec.functional_equivalency
                          .replace(/_/g, " ")
                          .toUpperCase()}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: "#475569",
                        marginBottom: "0.75rem",
                      }}
                    >
                      {rec.brand_or_maker} | {rec.category}
                    </div>
                    <p
                      style={{
                        fontSize: "0.9rem",
                        lineHeight: 1.4,
                        margin: "0 0 0.75rem",
                        color: "#334155",
                      }}
                    >
                      <bdi dir="auto">{rec.description}</bdi>
                    </p>
                    <div
                      style={{
                        background: "#f8fafc",
                        padding: "0.75rem",
                        borderRadius: "6px",
                        fontSize: "0.85rem",
                        marginBottom: "0.75rem",
                        color: "#334155",
                      }}
                    >
                      <strong>Use Case Fit: </strong>
                      <bdi dir="auto">{rec.use_case_fit}</bdi>
                    </div>
                    {rec.tradeoffs.length > 0 ? (
                      <div>
                        <strong
                          style={{ fontSize: "0.8rem", color: "#475569" }}
                        >
                          Engineering Tradeoffs:
                        </strong>
                        <ul
                          style={{
                            margin: "0.25rem 0 0 1.25rem",
                            padding: 0,
                            fontSize: "0.85rem",
                            color: "#475569",
                          }}
                        >
                          {rec.tradeoffs.map((t, idx) => (
                            <li key={idx}>
                              <bdi dir="auto">{t}</bdi>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ),
              )}
            </div>
          </div>
        </section>
      ) : null}

      {/* MODULE: PRODUCT CATALOG */}
      {result_modules.product_catalog ? (
        <section
          aria-labelledby="catalog-module-heading"
          style={{ marginBottom: "2rem" }}
        >
          <h2
            id="catalog-module-heading"
            style={{
              fontSize: "1.35rem",
              fontWeight: 700,
              marginBottom: "1rem",
              color: "#f8fafc",
            }}
          >
            Product Catalog & Technical Line Card
          </h2>
          <div
            className="surface-light-card"
            style={{
              background: "#ffffff",
              color: "#334155",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "1.25rem",
            }}
          >
            <div
              style={{
                marginBottom: "1rem",
                paddingBottom: "0.75rem",
                borderBottom: "1px solid #e2e8f0",
              }}
            >
              <h3
                style={{
                  margin: "0 0 0.25rem",
                  fontSize: "1.1rem",
                  color: "#0f172a",
                }}
              >
                {result_modules.product_catalog.catalog_name}
              </h3>
              <span style={{ fontSize: "0.85rem", color: "#475569" }}>
                Supplier:{" "}
                <strong>{result_modules.product_catalog.supplier_name}</strong>{" "}
                ({result_modules.product_catalog.supplier_entity_id}) | As of:{" "}
                {result_modules.product_catalog.as_of_date}
              </span>
            </div>

            <div
              className="table-responsive-container"
              style={{ overflowX: "auto" }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.85rem",
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "#f1f5f9",
                      textAlign: "left",
                      borderBottom: "2px solid #cbd5e1",
                    }}
                  >
                    <th
                      style={{
                        padding: "8px",
                        color: "#0f172a",
                        fontWeight: 700,
                      }}
                    >
                      SKU / Model
                    </th>
                    <th
                      style={{
                        padding: "8px",
                        color: "#0f172a",
                        fontWeight: 700,
                      }}
                    >
                      Family
                    </th>
                    <th
                      style={{
                        padding: "8px",
                        color: "#0f172a",
                        fontWeight: 700,
                      }}
                    >
                      Variant Description
                    </th>
                    <th
                      style={{
                        padding: "8px",
                        color: "#0f172a",
                        fontWeight: 700,
                      }}
                    >
                      Certifications
                    </th>
                    <th
                      style={{
                        padding: "8px",
                        color: "#0f172a",
                        fontWeight: 700,
                      }}
                    >
                      MOQ
                    </th>
                    <th
                      style={{
                        padding: "8px",
                        color: "#0f172a",
                        fontWeight: 700,
                      }}
                    >
                      Pricing Ref
                    </th>
                    <th
                      style={{
                        padding: "8px",
                        color: "#0f172a",
                        fontWeight: 700,
                      }}
                    >
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result_modules.product_catalog.product_lines.map((line) => (
                    <tr
                      key={line.line_id}
                      style={{ borderBottom: "1px solid #e2e8f0" }}
                    >
                      <td
                        style={{
                          padding: "8px",
                          fontWeight: 700,
                          color: "#0f172a",
                        }}
                      >
                        {line.sku_or_model}
                      </td>
                      <td style={{ padding: "8px", color: "#334155" }}>
                        {line.product_family}
                      </td>
                      <td style={{ padding: "8px", color: "#334155" }}>
                        {line.variant_name}
                      </td>
                      <td style={{ padding: "8px", color: "#334155" }}>
                        {line.certifications_held.join(", ")}
                      </td>
                      <td style={{ padding: "8px", color: "#334155" }}>
                        {line.moq ?? "N/A"}
                      </td>
                      <td
                        style={{
                          padding: "8px",
                          color: "#15803d",
                          fontWeight: 600,
                        }}
                      >
                        {line.pricing_reference ?? "On inquiry"}
                      </td>
                      <td style={{ padding: "8px" }}>
                        <span
                          style={{
                            background:
                              line.availability === "in_production"
                                ? "#dcfce7"
                                : "#fef3c7",
                            color:
                              line.availability === "in_production"
                                ? "#14532d"
                                : "#78350f",
                            fontWeight: 600,
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                          }}
                        >
                          {line.availability.replace(/_/g, " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {/* MODULE: MARKET OVERVIEW */}
      {result_modules.market_overview ? (
        <section
          aria-labelledby="market-overview-heading"
          style={{ marginBottom: "2rem" }}
        >
          <h2
            id="market-overview-heading"
            style={{
              fontSize: "1.35rem",
              fontWeight: 700,
              marginBottom: "1rem",
              color: "#f8fafc",
            }}
          >
            Macro Market Overview
          </h2>
          <div
            className="surface-light-card"
            style={{
              background: "#ffffff",
              color: "#334155",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "1.25rem",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "1rem",
                flexWrap: "wrap",
                color: "#334155",
              }}
            >
              <div>
                <strong>Scope:</strong>{" "}
                {result_modules.market_overview.market_scope}
              </div>
              <span
                style={{
                  background: "#f1f5f9",
                  color: "#0f172a",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                }}
              >
                Concentration:{" "}
                {result_modules.market_overview.supply_concentration
                  .replace(/_/g, " ")
                  .toUpperCase()}
              </span>
            </div>
            <p
              style={{
                lineHeight: 1.5,
                marginBottom: "1rem",
                color: "#334155",
              }}
            >
              <bdi dir="auto">
                {result_modules.market_overview.supply_structure_summary}
              </bdi>
            </p>

            {/* Trade Flows */}
            {result_modules.market_overview.trade_flows.length > 0 ? (
              <div style={{ marginBottom: "1rem" }}>
                <h3
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    marginBottom: "0.5rem",
                    color: "#0f172a",
                  }}
                >
                  Key Trade Corridors
                </h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                    gap: "0.75rem",
                  }}
                >
                  {result_modules.market_overview.trade_flows.map(
                    (flow, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: "#f8fafc",
                          padding: "0.75rem",
                          borderRadius: "6px",
                          border: "1px solid #e2e8f0",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: "0.9rem",
                            color: "#0f172a",
                          }}
                        >
                          {flow.origin_country} &rarr;{" "}
                          {flow.destination_country}
                        </div>
                        <div style={{ fontSize: "0.85rem", color: "#475569" }}>
                          {flow.volume_description}
                        </div>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "#15803d",
                            marginTop: "2px",
                          }}
                        >
                          Trend: {flow.trend}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* MODULE: GENERAL INFO */}
      {result_modules.general_info ? (
        <section
          aria-labelledby="general-info-heading"
          style={{ marginBottom: "2rem" }}
        >
          <h2
            id="general-info-heading"
            style={{
              fontSize: "1.35rem",
              fontWeight: 700,
              marginBottom: "1rem",
              color: "#f8fafc",
            }}
          >
            Regulatory & Process Architecture
          </h2>
          <div
            className="surface-light-card"
            style={{
              background: "#ffffff",
              color: "#334155",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "1.25rem",
            }}
          >
            <h3
              style={{
                margin: "0 0 0.5rem",
                fontSize: "1.15rem",
                color: "#0f172a",
              }}
            >
              <bdi dir="auto">{result_modules.general_info.topic_title}</bdi>
            </h3>
            <p
              style={{
                lineHeight: 1.5,
                marginBottom: "1.5rem",
                color: "#334155",
              }}
            >
              <bdi dir="auto">{result_modules.general_info.topic_summary}</bdi>
            </p>

            {/* Procedural Steps */}
            {result_modules.general_info.procedural_guidance.length > 0 ? (
              <div style={{ marginBottom: "1.5rem" }}>
                <h4
                  style={{
                    fontSize: "1rem",
                    fontWeight: 600,
                    marginBottom: "0.5rem",
                    color: "#0f172a",
                  }}
                >
                  Procedural Execution Roadmap
                </h4>
                <ol style={{ margin: "0 0 0 1.25rem", padding: 0 }}>
                  {result_modules.general_info.procedural_guidance.map(
                    (step, idx) => (
                      <li
                        key={idx}
                        style={{
                          marginBottom: "0.5rem",
                          lineHeight: 1.4,
                          color: "#334155",
                        }}
                      >
                        <bdi dir="auto">{step}</bdi>
                      </li>
                    ),
                  )}
                </ol>
              </div>
            ) : null}

            {/* Governing Frameworks */}
            {result_modules.general_info.regulatory_standards.length > 0 ? (
              <div style={{ marginBottom: "1.5rem" }}>
                <h4
                  style={{
                    fontSize: "1rem",
                    fontWeight: 600,
                    marginBottom: "0.5rem",
                    color: "#0f172a",
                  }}
                >
                  Governing Regulatory Standards
                </h4>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                    gap: "0.75rem",
                  }}
                >
                  {result_modules.general_info.regulatory_standards.map(
                    (std, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: "#f8fafc",
                          padding: "0.75rem",
                          borderRadius: "6px",
                          border: "1px solid #e2e8f0",
                        }}
                      >
                        <div style={{ fontWeight: 700, color: "#1e40af" }}>
                          {std.standard_code}
                        </div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: "0.9rem",
                            color: "#0f172a",
                          }}
                        >
                          {std.title}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "#475569" }}>
                          {std.issuing_body}
                        </div>
                        <p
                          style={{
                            fontSize: "0.85rem",
                            margin: "0.25rem 0 0",
                            color: "#334155",
                          }}
                        >
                          <bdi dir="auto">{std.summary}</bdi>
                        </p>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : null}

            {/* Pitfalls */}
            {result_modules.general_info.frequently_encountered_pitfalls
              .length > 0 ? (
              <div
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  padding: "1rem",
                  borderRadius: "6px",
                }}
              >
                <strong style={{ color: "#b45309", fontSize: "0.9rem" }}>
                  Frequently Encountered Compliance Pitfalls:
                </strong>
                <ul
                  style={{
                    margin: "0.5rem 0 0 1.25rem",
                    padding: 0,
                    fontSize: "0.85rem",
                    color: "#92400e",
                  }}
                >
                  {result_modules.general_info.frequently_encountered_pitfalls.map(
                    (pit, idx) => (
                      <li key={idx} style={{ marginBottom: "0.25rem" }}>
                        <bdi dir="auto">{pit}</bdi>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* SUPPLIER CANDIDATES (When Present) */}
      {supplier_candidates.length > 0 ? (
        <section
          aria-labelledby="candidates-heading"
          style={{ marginBottom: "2.5rem" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1rem",
            }}
          >
            <h2
              id="candidates-heading"
              style={{
                fontSize: "1.4rem",
                fontWeight: 700,
                margin: 0,
                color: "#f8fafc",
              }}
            >
              Qualified Supplier Candidates ({supplier_candidates.length})
            </h2>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: "1.5rem",
            }}
          >
            {supplier_candidates.map((cand) => {
              const isDecoupledAlert =
                cand.fit_assessment.compatibility_score >= 80 &&
                cand.fit_assessment.evidence_confidence === "low";

              return (
                <article
                  key={cand.candidate_id}
                  className="surface-light-card"
                  style={{
                    background: "#ffffff",
                    color: "#334155",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    padding: "1.5rem",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                  }}
                >
                  {/* Candidate Header */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: "1rem",
                      marginBottom: "1rem",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          marginBottom: "0.25rem",
                        }}
                      >
                        <h3
                          style={{
                            margin: 0,
                            fontSize: "1.3rem",
                            fontWeight: 700,
                            color: "#0f172a",
                          }}
                        >
                          <bdi dir="auto">{cand.legal_name}</bdi>
                        </h3>
                        <span
                          style={{
                            background: "#e2e8f0",
                            color: "#0f172a",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                          }}
                        >
                          {cand.country_code}
                        </span>
                        <span
                          style={{
                            background: "#f1f5f9",
                            color: "#0f172a",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                          }}
                        >
                          {cand.supplier_type}
                        </span>
                        <span
                          style={{
                            background:
                              cand.verification_status === "externally_verified"
                                ? "#dcfce7"
                                : "#fef3c7",
                            color:
                              cand.verification_status === "externally_verified"
                                ? "#166534"
                                : "#854d0e",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                          }}
                        >
                          {cand.verification_status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#475569",
                          marginBottom: "0.25rem",
                          display: "flex",
                          gap: "0.5rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <span>
                          Candidate ID: <code>{cand.candidate_id}</code>
                        </span>
                        <span>&bull;</span>
                        <span>
                          Entity ID: <code>{cand.entity_id}</code>
                        </span>
                      </div>
                      {cand.brand_names.length > 0 ? (
                        <div style={{ fontSize: "0.85rem", color: "#475569" }}>
                          Brands: {cand.brand_names.join(", ")}
                        </div>
                      ) : null}
                    </div>

                    {/* Compatibility Score & Confidence Badges */}
                    <div
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ textAlign: "right" }}>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "#475569",
                            textTransform: "uppercase",
                          }}
                        >
                          Fit Score
                        </div>
                        <div
                          style={{
                            fontSize: "1.6rem",
                            fontWeight: 800,
                            color:
                              cand.fit_assessment.compatibility_score >= 80
                                ? "#15803d"
                                : "#d97706",
                          }}
                        >
                          {cand.fit_assessment.compatibility_score}
                          <span
                            style={{
                              fontSize: "0.9rem",
                              fontWeight: 400,
                              color: "#475569",
                            }}
                          >
                            /100
                          </span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right", marginLeft: "0.5rem" }}>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "#334155",
                            fontWeight: 600,
                            textTransform: "uppercase",
                          }}
                        >
                          Candidate Evidence
                        </div>
                        <span
                          aria-label={`Candidate Evidence: ${cand.fit_assessment.evidence_confidence.toUpperCase()}`}
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "0.8rem",
                            fontWeight: 700,
                            background:
                              cand.fit_assessment.evidence_confidence === "high"
                                ? "#dcfce7"
                                : cand.fit_assessment.evidence_confidence ===
                                    "medium"
                                  ? "#fef3c7"
                                  : "#fee2e2",
                            color:
                              cand.fit_assessment.evidence_confidence === "high"
                                ? "#14532d"
                                : cand.fit_assessment.evidence_confidence ===
                                    "medium"
                                  ? "#78350f"
                                  : "#7f1d1d",
                          }}
                        >
                          {cand.fit_assessment.evidence_confidence.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Decoupled Score Alert */}
                  {isDecoupledAlert ? (
                    <div
                      style={{
                        background: "#fff7ed",
                        border: "1px solid #fdba74",
                        borderRadius: "6px",
                        padding: "0.75rem 1rem",
                        marginBottom: "1rem",
                        color: "#9a3412",
                        fontSize: "0.85rem",
                      }}
                    >
                      <strong>
                        High Technical Fit with Low Evidence Confidence:{" "}
                      </strong>
                      This candidate matches theoretical technical criteria
                      well, but data is based on unverified self-claims or
                      sparse sources. Physical audit is mandatory before
                      commercial commitment.
                    </div>
                  ) : null}

                  {/* Verification Summary */}
                  <p
                    style={{
                      fontSize: "0.9rem",
                      color: "#334155",
                      margin: "0 0 1rem",
                      background: "#f8fafc",
                      padding: "0.75rem",
                      borderRadius: "6px",
                    }}
                  >
                    <strong>Verification Basis: </strong>
                    <bdi dir="auto">{cand.verification_summary}</bdi>
                  </p>

                  {/* Canonical 6-Dimension Score Breakdown */}
                  {cand.fit_assessment.dimension_scores &&
                  Object.keys(cand.fit_assessment.dimension_scores).length >
                    0 ? (
                    <div
                      style={{
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: "6px",
                        padding: "0.75rem 1rem",
                        marginBottom: "1rem",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.85rem",
                          fontWeight: 700,
                          color: "#334155",
                          marginBottom: "0.5rem",
                        }}
                      >
                        Compatibility Dimension Breakdown (100% Weight Matrix)
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(200px, 1fr))",
                          gap: "0.5rem 1rem",
                        }}
                      >
                        {CANONICAL_MATCH_DIMENSIONS_V2.map((dim) => {
                          const score =
                            cand.fit_assessment.dimension_scores[
                              dim.dimension_id
                            ] ?? 0;
                          const barColor =
                            score >= 80
                              ? "#15803d"
                              : score >= 60
                                ? "#d97706"
                                : "#dc2626";
                          return (
                            <div
                              key={dim.dimension_id}
                              style={{
                                background: "#ffffff",
                                border: "1px solid #e2e8f0",
                                borderRadius: "4px",
                                padding: "0.5rem",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  fontSize: "0.75rem",
                                  fontWeight: 600,
                                  marginBottom: "0.25rem",
                                }}
                              >
                                <span style={{ color: "#1e293b" }}>
                                  {dim.label}
                                </span>
                                <span style={{ color: "#475569" }}>
                                  {dim.weight}%
                                </span>
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.5rem",
                                }}
                              >
                                <div
                                  style={{
                                    flex: 1,
                                    height: "6px",
                                    background: "#e2e8f0",
                                    borderRadius: "3px",
                                    overflow: "hidden",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: `${Math.min(100, Math.max(0, score))}%`,
                                      height: "100%",
                                      background: barColor,
                                    }}
                                  />
                                </div>
                                <span
                                  style={{
                                    fontSize: "0.8rem",
                                    fontWeight: 700,
                                    color: barColor,
                                    minWidth: "1.8rem",
                                    textAlign: "right",
                                  }}
                                >
                                  {score}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {/* Positive Drivers & Limiting Gaps */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "1rem",
                      marginBottom: "1rem",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: "0.85rem", color: "#166534" }}>
                        Positive Fit Drivers:
                      </strong>
                      <ul
                        style={{
                          margin: "0.25rem 0 0 1.25rem",
                          padding: 0,
                          fontSize: "0.85rem",
                        }}
                      >
                        {cand.fit_assessment.positive_drivers.map((d, i) => (
                          <li key={i} style={{ color: "#334155" }}>
                            <bdi dir="auto">{d}</bdi>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong style={{ fontSize: "0.85rem", color: "#991b1b" }}>
                        Limiting Gaps & Constraints:
                      </strong>
                      <ul
                        style={{
                          margin: "0.25rem 0 0 1.25rem",
                          padding: 0,
                          fontSize: "0.85rem",
                        }}
                      >
                        {cand.fit_assessment.limiting_gaps.map((g, i) => (
                          <li key={i} style={{ color: "#334155" }}>
                            <bdi dir="auto">{g}</bdi>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Commercial Specifications */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(200px, 1fr))",
                      gap: "0.75rem",
                      fontSize: "0.85rem",
                      background: "#f8fafc",
                      color: "#334155",
                      padding: "0.75rem",
                      borderRadius: "6px",
                      marginBottom: "1rem",
                    }}
                  >
                    <div>
                      <strong style={{ color: "#0f172a" }}>MOQ:</strong>{" "}
                      {cand.moq.value} {cand.moq.unit} (
                      {cand.moq.description ?? "standard"})
                    </div>
                    <div>
                      <strong style={{ color: "#0f172a" }}>Capacity:</strong>{" "}
                      {cand.capacity.volume.toLocaleString()}{" "}
                      {cand.capacity.unit} / {cand.capacity.annual_or_monthly}
                    </div>
                    <div>
                      <strong style={{ color: "#0f172a" }}>Incoterms:</strong>{" "}
                      {cand.logistics.supported_incoterms.join(", ")}
                    </div>
                    <div>
                      <strong style={{ color: "#0f172a" }}>Ports:</strong>{" "}
                      {cand.logistics.primary_shipping_ports.join(", ") ||
                        "Standard"}
                    </div>
                  </div>

                  {/* Required Validation */}
                  {cand.required_validation.length > 0 ? (
                    <div style={{ fontSize: "0.85rem", color: "#475569" }}>
                      <strong>Pre-Commitment Validation Steps: </strong>
                      {cand.required_validation.join("; ")}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* CLAIMS & EVIDENCE TRACEABILITY */}
      {claims.length > 0 || evidence.length > 0 ? (
        <section
          aria-labelledby="traceability-heading"
          style={{ marginBottom: "2.5rem" }}
        >
          <h2
            id="traceability-heading"
            style={{
              fontSize: "1.35rem",
              fontWeight: 700,
              marginBottom: "1rem",
              color: "#f8fafc",
            }}
          >
            Evidence & Fact Traceability
          </h2>

          {/* Claims List */}
          {claims.length > 0 ? (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3
                style={{
                  fontSize: "1rem",
                  fontWeight: 600,
                  marginBottom: "0.5rem",
                  color: "#f8fafc",
                }}
              >
                Attributed Research Claims
              </h3>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                {claims.map((claim) => (
                  <div
                    key={claim.claim_id}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "6px",
                      padding: "0.75rem 1rem",
                      background:
                        claim.conflict_status === "conflicting"
                          ? "#fff5f5"
                          : "#ffffff",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "0.25rem",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          color: "#475569",
                        }}
                      >
                        {claim.claim_id} ({claim.claim_type})
                      </span>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            background: "#f1f5f9",
                            color: "#0f172a",
                            padding: "1px 6px",
                            borderRadius: "4px",
                          }}
                        >
                          Confidence: {claim.confidence}
                        </span>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            borderRadius: "4px",
                            padding: "1px 6px",
                            background:
                              claim.conflict_status === "conflicting"
                                ? "#fee2e2"
                                : "#dcfce7",
                            color:
                              claim.conflict_status === "conflicting"
                                ? "#991b1b"
                                : "#166534",
                          }}
                        >
                          {claim.conflict_status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.9rem",
                        lineHeight: 1.4,
                        color: "#1e293b",
                      }}
                    >
                      <bdi dir="auto">{claim.claim_text}</bdi>
                    </p>
                    {claim.evidence_ids.length > 0 ? (
                      <div
                        style={{
                          marginTop: "0.25rem",
                          fontSize: "0.75rem",
                          color: "#475569",
                        }}
                      >
                        Supported by: {claim.evidence_ids.join(", ")}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Evidence Registry */}
          {evidence.length > 0 ? (
            <div>
              <h3
                style={{
                  fontSize: "1rem",
                  fontWeight: 600,
                  marginBottom: "0.5rem",
                  color: "#f8fafc",
                }}
              >
                Cited Primary Sources & Excerpts
              </h3>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                }}
              >
                {evidence.map((ev) => (
                  <div
                    key={ev.evidence_id}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "6px",
                      padding: "0.75rem 1rem",
                      background: "#f8fafc",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: "0.25rem",
                      }}
                    >
                      <a
                        href={ev.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontWeight: 700,
                          fontSize: "0.95rem",
                          color: "#1d4ed8",
                          textDecoration: "none",
                        }}
                      >
                        {ev.source_title} &rarr;
                      </a>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          background: "#e2e8f0",
                          color: "#0f172a",
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: "4px",
                        }}
                      >
                        {ev.source_type}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "#475569",
                        marginBottom: "0.5rem",
                      }}
                    >
                      Publisher: {ev.publisher} | Retrieved:{" "}
                      {new Date(ev.retrieved_at).toLocaleDateString()} | Status:{" "}
                      {ev.verification_status}
                    </div>
                    <blockquote
                      style={{
                        margin: 0,
                        padding: "0.5rem 0.75rem",
                        background: "#ffffff",
                        borderLeft: "3px solid #cbd5e1",
                        fontSize: "0.85rem",
                        fontStyle: "italic",
                        color: "#334155",
                      }}
                    >
                      <bdi dir="auto">&ldquo;{ev.excerpt_summary}&rdquo;</bdi>
                    </blockquote>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* UNKNOWNS, ASSUMPTIONS & LIMITATIONS */}
      {unknowns.length > 0 ||
      assumptions.length > 0 ||
      limitations.length > 0 ? (
        <section
          aria-labelledby="limitations-heading"
          style={{ marginBottom: "2.5rem" }}
        >
          <h2
            id="limitations-heading"
            style={{
              fontSize: "1.35rem",
              fontWeight: 700,
              marginBottom: "1rem",
              color: "#f8fafc",
            }}
          >
            Disclosed Unknowns, Assumptions & Boundary Limitations
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "1rem",
            }}
          >
            {unknowns.map((u, i) => (
              <div
                key={i}
                style={{
                  border: "1px solid #fde68a",
                  background: "#fffbeb",
                  borderRadius: "6px",
                  padding: "1rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "0.25rem",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: "0.85rem",
                      color: "#92400e",
                    }}
                  >
                    Unknown: {u.field_or_topic}
                  </span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      background: "#fef3c7",
                      color: "#78350f",
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    {u.impact}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: "0.85rem",
                    margin: "0 0 0.5rem",
                    color: "#78350f",
                  }}
                >
                  <bdi dir="auto">{u.reason}</bdi>
                </p>
                <div style={{ fontSize: "0.8rem", color: "#92400e" }}>
                  <strong>Recommended Validation: </strong>
                  <bdi dir="auto">{u.recommended_validation}</bdi>
                </div>
              </div>
            ))}

            {assumptions.map((a) => (
              <div
                key={a.assumption_id}
                style={{
                  border: "1px solid #e0e7ff",
                  background: "#f5f3ff",
                  borderRadius: "6px",
                  padding: "1rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "0.25rem",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: "0.85rem",
                      color: "#5b21b6",
                    }}
                  >
                    Assumption: {a.assumption_id}
                  </span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      background: "#ede9fe",
                      color: "#5b21b6",
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    {a.sensitivity}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: "0.85rem",
                    margin: "0 0 0.5rem",
                    color: "#4c1d95",
                  }}
                >
                  <bdi dir="auto">{a.description}</bdi>
                </p>
                <div style={{ fontSize: "0.8rem", color: "#6d28d9" }}>
                  <strong>Rationale: </strong>
                  <bdi dir="auto">{a.rationale}</bdi>
                </div>
              </div>
            ))}

            {limitations.map((lim) => (
              <div
                key={lim.limitation_id}
                style={{
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  borderRadius: "6px",
                  padding: "1rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "0.25rem",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: "0.85rem",
                      color: "#0f172a",
                    }}
                  >
                    {lim.title}
                  </span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      background: "#e2e8f0",
                      color: "#0f172a",
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    {lim.scope}
                  </span>
                </div>
                <p style={{ fontSize: "0.85rem", margin: 0, color: "#475569" }}>
                  <bdi dir="auto">{lim.description}</bdi>
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Secondary / Advanced Data Export Section (F03) */}
      <section
        style={{
          marginTop: "2rem",
          marginBottom: "1rem",
          background: "#f8fafc",
          border: "1px solid #cbd5e1",
          borderRadius: "8px",
          padding: "1rem 1.25rem",
        }}
      >
        <details>
          <summary
            style={{
              fontWeight: 600,
              fontSize: "0.95rem",
              color: "#0f172a",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            Technical Details & Data Export
          </summary>
          <div
            style={{
              marginTop: "1rem",
              paddingTop: "1rem",
              borderTop: "1px solid #e2e8f0",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "1rem",
              }}
            >
              <div>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => {
                    const dataStr =
                      "data:text/json;charset=utf-8," +
                      encodeURIComponent(JSON.stringify(result, null, 2));
                    const downloadAnchor = document.createElement("a");
                    downloadAnchor.setAttribute("href", dataStr);
                    downloadAnchor.setAttribute(
                      "download",
                      `consultant-v2-${result.run_id}.json`,
                    );
                    document.body.appendChild(downloadAnchor);
                    downloadAnchor.click();
                    downloadAnchor.remove();
                  }}
                  aria-label="Export structured data (JSON)"
                  style={{
                    fontWeight: 600,
                    color: "#0f172a",
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                  }}
                >
                  Export structured data (JSON)
                </button>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.85rem",
                  color: "#475569",
                  fontStyle: "italic",
                }}
              >
                Demonstration dataset — not live market evidence
              </p>
            </div>
            <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
              <span>Schema: {result.schema_version}</span> &bull;{" "}
              <span>Run ID: {result.run_id}</span>
            </div>
          </div>
        </details>
      </section>

      {/* DECISION SUPPORT / ADVISORY BOUNDARY */}
      <footer
        style={{
          background: "#0f172a",
          color: "#f8fafc",
          borderRadius: "8px",
          padding: "1.5rem",
          marginTop: "2rem",
        }}
      >
        <div style={{ marginBottom: "1rem" }}>
          <h3
            style={{
              fontSize: "1.1rem",
              margin: "0 0 0.5rem",
              color: "#60a5fa",
            }}
          >
            Decision Support & Advisory Boundary
          </h3>
          <p
            style={{
              fontSize: "0.95rem",
              color: "#cbd5e1",
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            <bdi dir="auto">{decision_support.advisory_notice}</bdi>
          </p>
        </div>

        {decision_support.recommended_actions.length > 0 ? (
          <div style={{ marginBottom: "1rem" }}>
            <h4
              style={{
                fontSize: "0.9rem",
                color: "#93c5fd",
                margin: "0 0 0.25rem",
              }}
            >
              Recommended Next Actions:
            </h4>
            <ul
              style={{
                margin: "0 0 0 1.25rem",
                padding: 0,
                fontSize: "0.85rem",
                color: "#e2e8f0",
              }}
            >
              {decision_support.recommended_actions.map((act, i) => (
                <li key={i} style={{ marginBottom: "0.25rem" }}>
                  <bdi dir="auto">{act}</bdi>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {decision_support.questions_to_resolve.length > 0 ? (
          <div style={{ marginBottom: "1rem" }}>
            <h4
              style={{
                fontSize: "0.9rem",
                color: "#93c5fd",
                margin: "0 0 0.25rem",
              }}
            >
              Critical Supplier Questions to Resolve:
            </h4>
            <ul
              style={{
                margin: "0 0 0 1.25rem",
                padding: 0,
                fontSize: "0.85rem",
                color: "#e2e8f0",
              }}
            >
              {decision_support.questions_to_resolve.map((q, i) => (
                <li key={i} style={{ marginBottom: "0.25rem" }}>
                  <bdi dir="auto">{q}</bdi>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "1.5rem",
            paddingTop: "1rem",
            borderTop: "1px solid #334155",
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
            MatchBASE Deep Research Engine &bull; AI proposes; humans choose.
          </span>
          <button
            onClick={onBack}
            type="button"
            style={{
              background: "#1d4ed8",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              padding: "8px 16px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Return to runs
          </button>
        </div>
      </footer>
    </div>
  );
}
