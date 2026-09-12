import type {
  ClaimV3,
  EvidenceSourceV3,
  SupplierEntityV3,
} from "./consultant-research-output.js";

/** Presentation-only missing markers; this does not establish evidence or verification. */
export function displaySupplierText(
  value: unknown,
  fallback = "Not established",
): string {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  return !text ||
    /^(?:unknown|not\s+(?:verified|found|stated|provided|available|established|assessed|recorded|specified)|unverified|n\/?a|null|undefined|[-–—])\.?$/i.test(
      text,
    )
    ? fallback
    : text;
}

/** Show the location actually recorded, without inferring incorporation or goods origin. */
export function getSupplierLocationSummary(
  supplier: Pick<
    SupplierEntityV3,
    | "headquarters_address"
    | "country_of_registration"
    | "manufacturing_locations"
  >,
): { readonly label: string; readonly value: string } {
  const headquarters = displaySupplierText(supplier.headquarters_address, "");
  if (headquarters) return { label: "Headquarters", value: headquarters };
  const registered = displaySupplierText(supplier.country_of_registration, "");
  if (registered) return { label: "Registered country", value: registered };
  const sites = supplier.manufacturing_locations
    .map((value) => displaySupplierText(value, ""))
    .filter(Boolean);
  if (sites.length)
    return {
      label: "Manufacturing location",
      value: [...new Set(sites)].join("; "),
    };
  return { label: "Supplier location", value: "Not established" };
}

/** Explicit product-origin wording only; company locations never establish goods origin. */
export function getSupplierProductOrigin(
  supplier: Pick<SupplierEntityV3, "offering">,
): { readonly label: string; readonly value: string } {
  const canonical = displaySupplierText(
    supplier.offering.country_of_origin,
    "",
  );
  if (canonical) return { label: "Product origin", value: canonical };
  const observations = Object.entries(supplier.offering.specifications).flatMap(
    ([field, raw]) => {
      const key = field.trim().toLowerCase().replace(/\s+/g, "_");
      if (!["origin", "country_of_origin", "place_of_origin"].includes(key))
        return [];
      const values = (Array.isArray(raw) ? raw : [raw])
        .map((value) => displaySupplierText(value, ""))
        .filter(Boolean);
      return values.map((value) => `${field}: ${value}`);
    },
  );
  return observations.length
    ? {
        label: "Origin stated in specifications",
        value: observations.join("; "),
      }
    : { label: "Product origin", value: "Not established" };
}

/** A stored domain is display metadata, not an alternative website or proof of ownership. */
export function getSupplierWebsite(
  supplier: Pick<SupplierEntityV3, "website">,
): { readonly href: string; readonly label: string } | undefined {
  const href = displaySupplierText(supplier.website, "");
  if (!href) return undefined;
  try {
    const url = new URL(href);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return undefined;
    return { href: url.href, label: url.hostname };
  } catch {
    return undefined;
  }
}

export interface SupplierFactAlternatives {
  readonly field_path: string;
  readonly label: string;
  readonly observations: readonly {
    readonly value: string;
    readonly evidence_ids: readonly string[];
  }[];
}

/** Retained alternatives are observations, not proof that different contexts contradict. */
export function getSupplierFactAlternatives(
  supplier: Pick<SupplierEntityV3, "supplier_entity_id">,
  claims: readonly ClaimV3[],
  sources: readonly EvidenceSourceV3[],
): readonly SupplierFactAlternatives[] {
  const groups = new Map<
    string,
    Map<string, { value: string; ids: Set<string> }>
  >();
  const observedStatuses = new Set([
    "externally_verified",
    "supplier_claimed",
    "illustrative",
  ]);
  for (const claim of claims) {
    const path = claim.field_path;
    if (
      claim.supplier_entity_id !== supplier.supplier_entity_id ||
      !observedStatuses.has(claim.status) ||
      !path ||
      !/^(?:country_of_registration|headquarters_address|country_of_origin|commercial\.[a-z_]+|specifications\.[a-z0-9_]+)$/.test(
        path,
      )
    )
      continue;
    const raw =
      claim.normalized_value ??
      (claim.claim_text.startsWith(`${path}: `)
        ? claim.claim_text.slice(path.length + 2)
        : undefined);
    if (raw === undefined) continue;
    const value = displaySupplierText(String(raw), "");
    const evidenceIds = claim.evidence_ids.filter((id) =>
      sources.some(
        (source) =>
          source.evidence_id === id &&
          observedStatuses.has(source.verification_status) &&
          source.supports_claim_ids.includes(claim.claim_id) &&
          !source.contradicts_claim_ids.includes(claim.claim_id),
      ),
    );
    if (!value || !evidenceIds.length) continue;
    const key = value.normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
    const group = groups.get(path) ?? new Map();
    const observation = group.get(key) ?? { value, ids: new Set<string>() };
    evidenceIds.forEach((id) => observation.ids.add(id));
    group.set(key, observation);
    groups.set(path, group);
  }
  const labels: Readonly<Record<string, string>> = {
    country_of_registration: "Registered country",
    headquarters_address: "Headquarters",
    country_of_origin: "Product origin",
  };
  return [...groups]
    .filter(([, group]) => group.size > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, group]) => ({
      field_path: path,
      label:
        labels[path] ??
        path
          .replace(/^commercial\./, "")
          .replace(/^specifications\./, "Specification: ")
          .replaceAll("_", " "),
      observations: [...group]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, observation]) => ({
          value: observation.value,
          evidence_ids: [...observation.ids].sort(),
        })),
    }));
}
