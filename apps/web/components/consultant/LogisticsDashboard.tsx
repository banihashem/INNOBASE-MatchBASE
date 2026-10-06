"use client";
import type {
  ConsultantResearchOutputV3,
  SupplierEntityV3,
  SearchDimensionAssessment,
} from "@matchbase/contracts";

export const LOGISTICS_GROUPS = [
  {
    label: "Direction and route",
    ids: ["lane", "routing_transit", "backup_routing"],
  },
  {
    label: "Service, equipment and cargo",
    ids: [
      "service",
      "equipment",
      "cargo_weight",
      "incoterm",
      "customs",
      "inland",
    ],
  },
  {
    label: "Supplier identity and reach",
    ids: [
      "role",
      "verification",
      "commercial_contact",
      "office_agent",
      "licensing",
      "track_record",
      "compliance",
    ],
  },
  {
    label: "Quote and terms",
    ids: [
      "freight_rate",
      "free_time",
      "local_charges",
      "payment",
      "quote_validity",
    ],
  },
  {
    label: "Evidence and comparison policy",
    ids: [
      "price_comparability",
      "current_evidence",
      "pool",
      "mandatory_filter",
      "market_benchmark",
    ],
  },
] as const;
export function isLogisticsOutput(
  output: ConsultantResearchOutputV3,
  industry?: string,
) {
  return (
    industry === "logistics" ||
    Boolean(
      output.search_dimension_plan?.profiles.some(
        (profile) => profile.id === "logistics.ocean",
      ),
    ) ||
    /\b(?:freight|forwarding|logistics)\b/i.test(
      output.primary_classification.label,
    )
  );
}
function show(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}
function safeHref(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function savedLogisticsAssessment(
  output: ConsultantResearchOutputV3,
  entity: string,
) {
  return output.search_dimension_assessments?.find(
    (entry) =>
      entry.entity_id === entity &&
      entry.plan_hash === output.search_dimension_plan?.plan_hash,
  );
}
export function LogisticsDashboard({
  output,
  suppliers,
}: {
  output: ConsultantResearchOutputV3;
  suppliers: readonly SupplierEntityV3[];
}) {
  const assessments = suppliers.map((supplier) =>
    savedLogisticsAssessment(output, supplier.supplier_entity_id),
  );
  const total = (status: SearchDimensionAssessment["eligibility"]) =>
    assessments.filter((entry) => entry?.eligibility === status).length;
  const plan = output.search_dimension_plan;
  return (
    <section
      aria-labelledby="logistics-decision-heading"
      className="space-y-4 border-y border-slate-600 py-5"
    >
      <h3
        id="logistics-decision-heading"
        className="text-lg font-semibold text-white"
      >
        Logistics decision dashboard
      </h3>
      <p className="text-sm text-slate-200">
        {suppliers.length} supplier profiles ·{" "}
        {assessments.filter(Boolean).length} with saved assessments ·{" "}
        {total("eligible")} eligible · {total("needs_review")} need review ·{" "}
        {total("partial")} partial lot fit · {total("excluded")} excluded ·{" "}
        {assessments.filter((entry) => !entry).length} without a saved logistics
        assessment.
      </p>
      <p className="text-sm text-amber-200">
        Research coverage:{" "}
        {output.executive_summary.research_coverage_status?.replaceAll(
          "_",
          " ",
        ) ?? "not assessed"}
        . Unknown evidence does not establish lane support, booking availability
        or authority to issue documents.
      </p>
      <details className="text-sm">
        <summary className="font-semibold cursor-pointer">
          Approved transport request
        </summary>
        <p dir="auto" className="mt-2 whitespace-pre-wrap break-words">
          {output.approved_request_snapshot?.approved_translation ??
            "Approved request text is unavailable in this historical output. Review the saved request details."}
        </p>
      </details>
      {plan ? (
        <div className="text-sm space-y-2">
          <p>
            Award policy: {plan.configuration.award_policy.replaceAll("_", " ")}
            . Requested direction, alternatives and lot scope below come from
            the approved plan.
          </p>
          <ul className="space-y-2">
            {plan.dimensions
              .filter(
                (entry) =>
                  entry.selection.active &&
                  [
                    "logistics.lane",
                    "logistics.service",
                    "logistics.equipment",
                    "logistics.cargo_weight",
                  ].includes(entry.definition.id),
              )
              .map((entry) => (
                <li key={entry.selection.selection_id}>
                  <strong>{entry.definition.label}:</strong>{" "}
                  {show(entry.selection.expected) ??
                    "Unspecified — research question"}{" "}
                  · {entry.selection.severity} · {entry.selection.scope.lot_id}{" "}
                  / {entry.selection.scope.subject_id}
                </li>
              ))}
          </ul>
        </div>
      ) : (
        <p className="text-amber-200">
          Logistics dimension assessment unavailable for this historical output.
          No assessment has been inferred or backfilled.
        </p>
      )}
      <p className="text-sm text-slate-300">
        Next procurement decision: inspect each lot's mandatory gaps, confirm
        the contracting entity and request a dated, itemized quotation. A market
        benchmark is context; it is not a supplier offer. The price section
        retains its recorded basis and comparability limits.
      </p>
    </section>
  );
}
export function LogisticsSupplierFacts({
  output,
  supplier,
}: {
  output: ConsultantResearchOutputV3;
  supplier: SupplierEntityV3;
}) {
  const assessment = savedLogisticsAssessment(
    output,
    supplier.supplier_entity_id,
  );
  const role = assessment?.dimensions.filter(
    (row) => row.dimension_id === "logistics.role",
  );
  const groupedDimensionIds = new Set<string>(
    LOGISTICS_GROUPS.flatMap((group) =>
      group.ids.map((id) => `logistics.${id}`),
    ),
  );
  const evidenceGroups = LOGISTICS_GROUPS.map((group) => ({
    label: group.label as string,
    rows:
      assessment?.dimensions.filter((row) =>
        group.ids.some((id) => row.dimension_id === `logistics.${id}`),
      ) ?? [],
  }));
  const additionalRows =
    assessment?.dimensions.filter(
      (row) => !groupedDimensionIds.has(row.dimension_id),
    ) ?? [];
  if (additionalRows.length) {
    evidenceGroups.push({
      label: "Additional approved criteria",
      rows: additionalRows,
    });
  }
  return (
    <div className="space-y-2 text-sm my-3">
      <p>
        <strong>Lot eligibility:</strong>{" "}
        {assessment?.eligibility.replaceAll("_", " ") ?? "Not assessed"}. Legacy
        compatibility score is separate.
      </p>
      <p>
        <strong>Evidenced role:</strong>{" "}
        {role?.flatMap((row) => row.observed_values.map(show)).join("; ") ||
          "Not established"}
      </p>
      <p>
        <strong>Registration jurisdiction:</strong>{" "}
        {typeof supplier.country_of_registration === "string" &&
        supplier.country_of_registration.trim()
          ? supplier.country_of_registration
          : "Not established"}
      </p>
      {assessment?.lot_evaluations.map((lot) => (
        <p key={lot.lot_id}>
          {lot.lot_id}: {lot.eligibility.replaceAll("_", " ")} ({lot.outcome})
        </p>
      ))}
      {assessment && (
        <p>
          Admitted observations: {assessment.coverage.grounded}/
          {assessment.coverage.active} active criteria;{" "}
          {assessment.coverage.unknown} unknown;{" "}
          {assessment.coverage.undetermined} applicability undetermined.
        </p>
      )}
      <details>
        <summary className="min-h-11 py-2 cursor-pointer font-semibold">
          Logistics evidence and RFQ gaps
        </summary>
        <div className="space-y-4">
          {evidenceGroups.map((group) => {
            const rows = group.rows;
            return (
              <section key={group.label}>
                <h4 className="font-semibold text-sky-200">{group.label}</h4>
                {!rows.length ? (
                  <p className="text-slate-300">
                    No saved assessment in this group.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {rows.map((row) => (
                      <li
                        key={row.selection_id}
                        className="border-l border-slate-600 pl-3 break-words"
                      >
                        <p>
                          <strong>{row.label}</strong> · {row.outcome} ·{" "}
                          {row.execution_status}
                        </p>
                        <p>
                          Requested: {show(row.expected) ?? "Research question"}
                          {row.unit ? ` ${row.unit}` : ""}. Observed:{" "}
                          {row.observed_values.length
                            ? row.observed_values.map(show).join("; ")
                            : "No admitted observation"}
                          .
                        </p>
                        <p className="text-slate-300">
                          {row.severity}; scope {row.scope.lot_id} /{" "}
                          {row.scope.subject_id}. {row.reason}
                        </p>
                        {output.search_dimension_observations
                          ?.filter(
                            (observation) =>
                              observation.entity_id ===
                                supplier.supplier_entity_id &&
                              row.observation_ids.includes(
                                observation.observation_id,
                              ),
                          )
                          .map((observation) => (
                            <blockquote
                              key={observation.observation_id}
                              className="mt-2 pl-3 border-l border-slate-500"
                            >
                              <p dir="auto">
                                {observation.source.literal_excerpt}
                              </p>
                              <p>
                                Published:{" "}
                                {observation.source.published_at ??
                                  "not recorded"}
                                ; observed: {observation.source.retrieved_at};
                                valid:{" "}
                                {observation.source.valid_from ??
                                  "not recorded"}{" "}
                                to{" "}
                                {observation.source.valid_until ??
                                  "not recorded"}
                                .
                              </p>
                              {safeHref(observation.source.uri) && (
                                <a
                                  className="text-sky-300 underline"
                                  href={safeHref(observation.source.uri)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Source record
                                </a>
                              )}
                            </blockquote>
                          ))}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          <p className="text-amber-200">
            Confirm unresolved mandatory criteria and exact scope before
            procurement. Unexecuted checks remain unexecuted; source absence is
            not proof of failure.
          </p>
        </div>
      </details>
    </div>
  );
}
