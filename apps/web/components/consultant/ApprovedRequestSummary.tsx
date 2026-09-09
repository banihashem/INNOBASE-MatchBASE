import type { ApprovedRequestSnapshotV3 } from "@matchbase/contracts";

export function ApprovedRequestSummary({
  snapshot,
}: {
  readonly snapshot?: ApprovedRequestSnapshotV3 | null | undefined;
}) {
  if (!snapshot)
    return (
      <p className="text-xs">
        The approved request is unavailable for this older result.
      </p>
    );
  return (
    <details className="rounded-lg border border-current/20 p-4 text-sm">
      <summary className="cursor-pointer font-semibold">
        Approved Buyer Requirements
      </summary>
      <p className="mt-2 whitespace-pre-wrap">
        {snapshot.approved_translation}
      </p>
      <p className="mt-2 text-xs">
        Approved {new Date(snapshot.approved_at).toLocaleString()}. Supplier
        observations below are assessed against this saved request.
      </p>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        {snapshot.facts.map((fact) => (
          <div key={fact.fact_id}>
            <dt className="font-semibold">{fact.label}</dt>
            <dd>{fact.source_clause}</dd>
          </div>
        ))}
      </dl>
      {snapshot.unknown_fields.length > 0 && (
        <p className="mt-2 text-xs">
          Not specified:{" "}
          {snapshot.unknown_fields
            .map((field) => field.replaceAll("_", " "))
            .join(", ")}
        </p>
      )}
      <details className="mt-3 workflow-support">
        <summary>Support details</summary>
        <p className="mt-2 break-all font-mono text-[10px]">
          Request revision: {snapshot.revision_id} · Content hash:{" "}
          {snapshot.content_hash}
        </p>
      </details>
    </details>
  );
}
