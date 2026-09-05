import type { RefObject } from "react";
import type { ConsultantResearchOutputV2 } from "@matchbase/contracts";
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
        ) : null}
      </div>

      {/* Header & Badges */}
      <header
        style={{
          marginBottom: "2rem",
          borderBottom: "1px solid #e2e8f0",
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
            }}
          >
            Consultant Deep-Research Output V2
          </span>
          <span
            style={{
              background: "#e2e8f0",
              borderRadius: "4px",
              padding: "2px 8px",
              fontSize: "0.75rem",
              fontWeight: 600,
            }}
          >
            {request_snapshot.primary_query_type.toUpperCase()}
          </span>
          {request_snapshot.secondary_query_types.map((st) => (
            <span
              key={st}
              style={{
                background: "#edf2f7",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "0.75rem",
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
              fontWeight: 600,
              background:
                research_status === "complete"
                  ? "#def7ec"
                  : research_status === "no_strong_match"
                    ? "#fde8e8"
                    : "#fef08a",
              color:
                research_status === "complete"
                  ? "#03543f"
                  : research_status === "no_strong_match"
                    ? "#9b1c1c"
                    : "#713f12",
            }}
          >
            STATUS: {research_status.replace(/_/g, " ").toUpperCase()}
          </span>
          <span
            style={{
              background: "#f1f5f9",
              borderRadius: "4px",
              padding: "2px 8px",
              fontSize: "0.75rem",
              color: "#64748b",
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
          }}
        >
          <bdi dir="auto">{executive_summary.headline}</bdi>
        </h1>
        <p
          className="lede"
          style={{
            fontSize: "1.1rem",
            color: "#334155",
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
            color: "#64748b",
            flexWrap: "wrap",
          }}
        >
          <span>
            <strong>Result ID:</strong> {result_id}
          </span>
          <span>
            <strong>Run ID:</strong> {run_id}
          </span>
          <span>
            <strong>Generated:</strong>{" "}
            {new Date(generated_at).toLocaleString()}
          </span>
          <span>
            <strong>Product:</strong> {request_snapshot.product_name}
          </span>
          {request_snapshot.geographic_scope ? (
            <span>
              <strong>Scope:</strong> {request_snapshot.geographic_scope}
            </span>
          ) : null}
        </div>
      </header>

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
              style={{
                background: "#ffffff",
                padding: "1rem",
                borderRadius: "6px",
                border: "1px solid #fbd5d5",
              }}
            >
              <strong style={{ color: "#9b1c1c" }}>
                Recommended Relaxation:{" "}
              </strong>
              <span>
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
            style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}
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
              color: "#b45309",
              background: "#fef3c7",
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
            }}
          >
            Sourcing & Market Landscape
          </h2>
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "1.25rem",
              marginBottom: "1rem",
            }}
          >
            <p style={{ margin: "0 0 1rem", lineHeight: 1.5 }}>
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
                    color: "#64748b",
                    textTransform: "uppercase",
                  }}
                >
                  Evaluated Suppliers
                </div>
                <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
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
                    color: "#64748b",
                    textTransform: "uppercase",
                  }}
                >
                  Qualified Suppliers
                </div>
                <div
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    color: "#059669",
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
                      color: "#64748b",
                      textTransform: "uppercase",
                    }}
                  >
                    Trade Lane
                  </div>
                  <div
                    style={{
                      fontSize: "0.9rem",
                      fontWeight: 600,
                      marginTop: "4px",
                    }}
                  >
                    {result_modules.sourcing.trade_lane_evaluated}
                  </div>
                </div>
              ) : null}
            </div>

            {result_modules.sourcing.key_bottlenecks.length > 0 ? (
              <div style={{ marginBottom: "0.75rem" }}>
                <strong style={{ fontSize: "0.85rem", color: "#64748b" }}>
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
                    <li key={i}>
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
            }}
          >
            Commercial Pricing & Benchmark Intelligence
          </h2>
          <div
            style={{
              background: "#ffffff",
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
                  }}
                >
                  Official Reference Benchmarks
                </h3>
                <div style={{ overflowX: "auto" }}>
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
                          background: "#f8fafc",
                          textAlign: "left",
                          borderBottom: "2px solid #e2e8f0",
                        }}
                      >
                        <th style={{ padding: "8px 12px" }}>Benchmark Index</th>
                        <th style={{ padding: "8px 12px" }}>Price</th>
                        <th style={{ padding: "8px 12px" }}>Unit</th>
                        <th style={{ padding: "8px 12px" }}>Source</th>
                        <th style={{ padding: "8px 12px" }}>As Of</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result_modules.pricing.benchmarks.map((b, idx) => (
                        <tr
                          key={idx}
                          style={{ borderBottom: "1px solid #e2e8f0" }}
                        >
                          <td style={{ padding: "8px 12px", fontWeight: 600 }}>
                            {b.benchmark_name}
                          </td>
                          <td
                            style={{
                              padding: "8px 12px",
                              color: "#059669",
                              fontWeight: 700,
                            }}
                          >
                            {b.currency} {b.benchmark_price.toLocaleString()}
                          </td>
                          <td style={{ padding: "8px 12px" }}>{b.unit}</td>
                          <td style={{ padding: "8px 12px", color: "#64748b" }}>
                            {b.source}
                          </td>
                          <td style={{ padding: "8px 12px", color: "#64748b" }}>
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
                      style={{
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        padding: "1rem",
                        background: "#fafafa",
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
                            color: "#64748b",
                          }}
                        >
                          {obs.observation_id}
                        </span>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            background: "#e2e8f0",
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
                            color: "#64748b",
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
                <strong style={{ fontSize: "0.85rem", color: "#64748b" }}>
                  Key Price Drivers:{" "}
                </strong>
                {result_modules.pricing.price_factors.map((f, i) => (
                  <span
                    key={i}
                    style={{
                      display: "inline-block",
                      background: "#f1f5f9",
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
            }}
          >
            Formulation & Product Recommendations
          </h2>
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "1.25rem",
            }}
          >
            <p style={{ margin: "0 0 1rem", lineHeight: 1.5 }}>
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
                    style={{
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      padding: "1.25rem",
                      background: "#fafafa",
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
                        color: "#64748b",
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
                      }}
                    >
                      <strong>Use Case Fit: </strong>
                      <bdi dir="auto">{rec.use_case_fit}</bdi>
                    </div>
                    {rec.tradeoffs.length > 0 ? (
                      <div>
                        <strong
                          style={{ fontSize: "0.8rem", color: "#64748b" }}
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
            }}
          >
            Product Catalog & Technical Line Card
          </h2>
          <div
            style={{
              background: "#ffffff",
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
              <h3 style={{ margin: "0 0 0.25rem", fontSize: "1.1rem" }}>
                {result_modules.product_catalog.catalog_name}
              </h3>
              <span style={{ fontSize: "0.85rem", color: "#64748b" }}>
                Supplier:{" "}
                <strong>{result_modules.product_catalog.supplier_name}</strong>{" "}
                ({result_modules.product_catalog.supplier_entity_id}) | As of:{" "}
                {result_modules.product_catalog.as_of_date}
              </span>
            </div>

            <div style={{ overflowX: "auto" }}>
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
                      background: "#f8fafc",
                      textAlign: "left",
                      borderBottom: "2px solid #cbd5e1",
                    }}
                  >
                    <th style={{ padding: "8px" }}>SKU / Model</th>
                    <th style={{ padding: "8px" }}>Family</th>
                    <th style={{ padding: "8px" }}>Variant Description</th>
                    <th style={{ padding: "8px" }}>Certifications</th>
                    <th style={{ padding: "8px" }}>MOQ</th>
                    <th style={{ padding: "8px" }}>Pricing Ref</th>
                    <th style={{ padding: "8px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result_modules.product_catalog.product_lines.map((line) => (
                    <tr
                      key={line.line_id}
                      style={{ borderBottom: "1px solid #e2e8f0" }}
                    >
                      <td style={{ padding: "8px", fontWeight: 700 }}>
                        {line.sku_or_model}
                      </td>
                      <td style={{ padding: "8px" }}>{line.product_family}</td>
                      <td style={{ padding: "8px" }}>{line.variant_name}</td>
                      <td style={{ padding: "8px" }}>
                        {line.certifications_held.join(", ")}
                      </td>
                      <td style={{ padding: "8px" }}>{line.moq ?? "N/A"}</td>
                      <td
                        style={{
                          padding: "8px",
                          color: "#059669",
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
            }}
          >
            Macro Market Overview
          </h2>
          <div
            style={{
              background: "#ffffff",
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
              }}
            >
              <div>
                <strong>Scope:</strong>{" "}
                {result_modules.market_overview.market_scope}
              </div>
              <span
                style={{
                  background: "#f1f5f9",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: "0.8rem",
                }}
              >
                Concentration:{" "}
                {result_modules.market_overview.supply_concentration
                  .replace(/_/g, " ")
                  .toUpperCase()}
              </span>
            </div>
            <p style={{ lineHeight: 1.5, marginBottom: "1rem" }}>
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
                        <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                          {flow.origin_country} &rarr;{" "}
                          {flow.destination_country}
                        </div>
                        <div style={{ fontSize: "0.85rem", color: "#475569" }}>
                          {flow.volume_description}
                        </div>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "#059669",
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
            }}
          >
            Regulatory & Process Architecture
          </h2>
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "1.25rem",
            }}
          >
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.15rem" }}>
              <bdi dir="auto">{result_modules.general_info.topic_title}</bdi>
            </h3>
            <p style={{ lineHeight: 1.5, marginBottom: "1.5rem" }}>
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
                  }}
                >
                  Procedural Execution Roadmap
                </h4>
                <ol style={{ margin: "0 0 0 1.25rem", padding: 0 }}>
                  {result_modules.general_info.procedural_guidance.map(
                    (step, idx) => (
                      <li
                        key={idx}
                        style={{ marginBottom: "0.5rem", lineHeight: 1.4 }}
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
                        <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                          {std.title}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
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
              style={{ fontSize: "1.4rem", fontWeight: 700, margin: 0 }}
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
                  style={{
                    background: "#ffffff",
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
                          }}
                        >
                          <bdi dir="auto">{cand.legal_name}</bdi>
                        </h3>
                        <span
                          style={{
                            background: "#e2e8f0",
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
                      {cand.brand_names.length > 0 ? (
                        <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
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
                            color: "#64748b",
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
                                ? "#059669"
                                : "#d97706",
                          }}
                        >
                          {cand.fit_assessment.compatibility_score}
                          <span
                            style={{
                              fontSize: "0.9rem",
                              fontWeight: 400,
                              color: "#64748b",
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
                            color: "#64748b",
                            textTransform: "uppercase",
                          }}
                        >
                          Evidence
                        </div>
                        <span
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
                                ? "#166534"
                                : cand.fit_assessment.evidence_confidence ===
                                    "medium"
                                  ? "#92400e"
                                  : "#991b1b",
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
                          <li key={i}>
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
                          <li key={i}>
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
                      padding: "0.75rem",
                      borderRadius: "6px",
                      marginBottom: "1rem",
                    }}
                  >
                    <div>
                      <strong>MOQ:</strong> {cand.moq.value} {cand.moq.unit} (
                      {cand.moq.description ?? "standard"})
                    </div>
                    <div>
                      <strong>Capacity:</strong>{" "}
                      {cand.capacity.volume.toLocaleString()}{" "}
                      {cand.capacity.unit} / {cand.capacity.annual_or_monthly}
                    </div>
                    <div>
                      <strong>Incoterms:</strong>{" "}
                      {cand.logistics.supported_incoterms.join(", ")}
                    </div>
                    <div>
                      <strong>Ports:</strong>{" "}
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
                          color: "#64748b",
                        }}
                      >
                        {claim.claim_id} ({claim.claim_type})
                      </span>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            background: "#f1f5f9",
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
                      style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.4 }}
                    >
                      <bdi dir="auto">{claim.claim_text}</bdi>
                    </p>
                    {claim.evidence_ids.length > 0 ? (
                      <div
                        style={{
                          marginTop: "0.25rem",
                          fontSize: "0.75rem",
                          color: "#64748b",
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
                        color: "#64748b",
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
                  <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>
                    {lim.title}
                  </span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      background: "#e2e8f0",
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
              background: "#3b82f6",
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
