import type {
  ConsultantResearchOutputV3,
  EvidenceSourceV3,
  SupplierEntityV3,
  ClaimV3,
} from "@matchbase/contracts";

export interface SupplierPrice {
  supplier: SupplierEntityV3;
  low: number;
  high: number;
  sources: readonly EvidenceSourceV3[];
  date: string | undefined;
}

export function supplierPrice(
  supplier: SupplierEntityV3,
  evidence: readonly EvidenceSourceV3[],
  claims: readonly ClaimV3[] = [],
): SupplierPrice | undefined {
  const c = supplier.commercial;
  // A one-sided bound is not a complete price or a closed range.
  if (
    c.price_min === undefined ||
    !Number.isFinite(c.price_min) ||
    c.price_min < 0
  )
    return undefined;
  const high = c.price_max ?? c.price_min;
  if (!Number.isFinite(high) || high < c.price_min) return undefined;
  const boundSources = (field: string, amount: number) =>
    claims
      .filter((claim) => {
        if (
          claim.supplier_entity_id !== supplier.supplier_entity_id ||
          claim.field_path !== field ||
          !["externally_verified", "supplier_claimed"].includes(claim.status) ||
          ["conflicting", "disputed"].includes(claim.conflict_status)
        )
          return false;
        const prefix = `${field}:`;
        const literal =
          claim.normalized_value !== undefined
            ? String(claim.normalized_value)
            : claim.claim_text.startsWith(prefix)
              ? claim.claim_text.slice(prefix.length).trim()
              : "";
        return /^\d+(?:\.\d+)?$/.test(literal) && Number(literal) === amount;
      })
      .flatMap((claim) => claim.evidence_ids)
      .filter((id) =>
        evidence.some(
          (source) =>
            source.evidence_id === id &&
            ["externally_verified", "supplier_claimed"].includes(
              source.verification_status,
            ),
        ),
      );
  const lowIds = boundSources("commercial.price_min", c.price_min);
  const highIds =
    c.price_max === undefined
      ? lowIds
      : boundSources("commercial.price_max", high);
  const priceIds =
    lowIds.length && highIds.length
      ? new Set([...lowIds, ...highIds])
      : new Set<string>();
  return {
    supplier,
    low: c.price_min,
    high,
    date: c.price_date,
    sources: evidence.filter((s) => priceIds.has(s.evidence_id)),
  };
}

export function formatPrice(
  low: number,
  high: number,
  currency?: string,
  unit?: string,
): string {
  return `${currency || "Currency not stated"} ${low}${high !== low ? ` – ${high}` : ""}${unit ? ` / ${unit}` : " / unit not stated"}`;
}

export function researchPriceGroups(output: ConsultantResearchOutputV3) {
  const groups = new Map<string, SupplierPrice[]>();
  for (const supplier of output.supplier_candidates) {
    const price = supplierPrice(
      supplier,
      output.evidence_sources,
      output.claims,
    );
    if (!price || (!price.sources.length && output.research_mode !== "fixture"))
      continue;
    const c = supplier.commercial;
    // Do not convert currencies, infer units, or merge different product/basis/date/quantity tiers.
    const basis = [
      supplier.offering.product_name,
      supplier.offering.model_or_sku,
      supplier.offering.brand,
      supplier.offering.grade_or_quality,
      supplier.offering.country_of_origin,
      JSON.stringify(
        Object.entries(supplier.offering.specifications).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ),
      supplier.packaging_and_logistics?.pack_size,
      supplier.packaging_and_logistics?.net_weight,
      c.currency,
      c.unit,
      c.incoterm,
      c.incoterm_location,
      c.moq,
      c.price_type,
      c.price_date,
      c.price_validity,
    ];
    const key = JSON.stringify([
      ...basis.map((value) => value?.trim().toLowerCase() ?? ""),
      !c.currency || !c.unit || !c.incoterm ? supplier.candidate_id : "",
    ]);
    groups.set(key, [...(groups.get(key) ?? []), price]);
  }
  return [...groups.values()].map((prices) => ({
    prices,
    low: Math.min(...prices.map((p) => p.low)),
    high: Math.max(...prices.map((p) => p.high)),
  }));
}

/** Preserve literal price rows that did not become a supplier claim. No entity or product match is inferred. */
export function additionalPriceEvidence(output: ConsultantResearchOutputV3) {
  const assigned = new Set(
    output.supplier_candidates.flatMap(
      (s) =>
        supplierPrice(s, output.evidence_sources, output.claims)?.sources.map(
          (source) => source.evidence_id,
        ) ?? [],
    ),
  );
  return output.evidence_sources.flatMap((source) => {
    if (
      assigned.has(source.evidence_id) ||
      source.source_type === "synthetic_fixture"
    )
      return [];
    const rows = source.excerpt_summary
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(
        (line) =>
          line.length < 500 &&
          /\b(?:USD|AED|EUR|GBP|INR)\s*[\d,]+(?:\.\d+)?\b/i.test(line),
      );
    if (!rows.length) return [];
    // Only explicitly labelled publication/update text; retrieval is never a price date.
    const dateLines = source.excerpt_summary
      .split(/\r?\n/)
      .filter(
        (line) =>
          /\b(?:updated on|published on|price date)\b/i.test(line) &&
          /\d/.test(line) &&
          line.length < 300,
      );
    return [
      {
        source,
        rows: [...new Set(rows)],
        dateText: dateLines.join("; ") || undefined,
      },
    ];
  });
}
