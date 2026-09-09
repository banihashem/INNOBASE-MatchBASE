import { createHash, randomUUID } from "node:crypto";
import type {
  ClaimV3,
  EvidenceSourceV3,
  SupplierEntityV3,
} from "@matchbase/contracts";
import {
  objectSchema,
  stringSchema,
  stringListSchema,
  nullableStringSchema,
} from "./live-json-schema.js";
import {
  safePublicEvidenceUrl,
  type OpenRouterCitation,
} from "./openrouter-model-policy.js";

const supportedSourceTypes = [
  "official_website",
  "official_registry",
  "government_trade_portal",
  "catalog_pdf",
  "trade_directory",
  "press_release",
  "secondary_market",
] as const;
export const LIVE_FACT_FIELD_PATHS = [
  "country_of_registration",
  "headquarters_address",
  "manufacturing_location",
  "country_of_origin",
  "contacts.sales_email",
  "contacts.export_email",
  "contacts.general_email",
  "contacts.phone",
  "contacts.contact_page_url",
  "commercial.moq",
  "commercial.production_capacity",
  "commercial.lead_time",
  "commercial.payment_terms",
  "commercial.incoterm",
  "commercial.incoterm_location",
  "commercial.price_date",
  "commercial.price_validity",
  "commercial.currency",
  "commercial.unit",
  "commercial.price_min",
  "commercial.price_max",
] as const;
const liveFactFieldPattern = `^(?:${LIVE_FACT_FIELD_PATHS.map((path) => path.replaceAll(".", "\\.")).join("|")}|specifications\\.[a-z][a-z0-9_]{0,63})$`;
export const LIVE_FACT_FIELD_INSTRUCTIONS = `Use only these facts[].field_path values: ${LIVE_FACT_FIELD_PATHS.join(", ")}, or specifications.<lowercase_snake_case_key> (1-64 letters/digits/underscores, starting with a letter). Product name/family belong in the required candidate product_name/product_family fields. Do not create presence, identity.country, product.name, facts.*, or offering.* paths. Extract every explicitly published useful business contact and commercial term using the canonical paths, not a combined prose fact. Keep each value a literal substring of its exact source quote. Numeric price values must be plain decimal numbers without currency symbols; record the source currency separately. commercial.price_date is the explicit publication/update/as-of date attached to a price, copied literally with its date wording in the quote and cited from the same price source. It is never the research date, retrieval date, copyright date or quotation expiry. commercial.price_validity is a separately published validity/expiry period; do not use it for a publication/update date. Never infer stock or delivery availability from a model listing or a public price. Keep unpublished commercial terms unknown and require an RFQ.`;
const proofSchema = objectSchema({
  status: { type: "string", enum: ["verified", "unmet", "unknown"] },
  source_urls: stringListSchema,
  quote: stringSchema,
});
export const LIVE_DISCOVERY_SCHEMA = objectSchema({
  candidates: {
    type: "array",
    maxItems: 40,
    items: objectSchema({
      legal_name: { type: "string", minLength: 1 },
      country: stringSchema,
      headquarters: stringSchema,
      website: nullableStringSchema,
      supplier_type: {
        type: "string",
        enum: [
          "manufacturer",
          "distributor",
          "trading_company",
          "cooperative",
          "service_provider",
          "unknown",
        ],
      },
      manufacturer_status: {
        type: "string",
        enum: [
          "direct_manufacturer",
          "oem_manufacturer",
          "trader_distributor",
          "unknown",
        ],
      },
      identity: proofSchema,
      product_name: stringSchema,
      product_family: stringSchema,
      product_origin: stringSchema,
      product: proofSchema,
      facts: {
        type: "array",
        items: objectSchema({
          field_path: {
            type: "string",
            pattern: liveFactFieldPattern,
            minLength: 1,
            maxLength: 96,
          },
          value: stringSchema,
          claim_type: {
            type: "string",
            enum: [
              "identity",
              "product_spec",
              "compliance",
              "pricing",
              "volume",
              "logistics",
              "market",
            ],
          },
          source_urls: stringListSchema,
          quote: stringSchema,
        }),
      },
      certifications: {
        type: "array",
        items: objectSchema({
          name: stringSchema,
          issuer: nullableStringSchema,
          certificate_number: nullableStringSchema,
          scope: stringSchema,
          status: {
            type: "string",
            enum: ["active", "conditional", "expired", "unknown"],
          },
          valid_from: nullableStringSchema,
          valid_until: nullableStringSchema,
          source_urls: stringListSchema,
          quote: stringSchema,
        }),
      },
      constraints: {
        type: "array",
        items: objectSchema({
          constraint: stringSchema,
          dimension: {
            type: "string",
            enum: [
              "product",
              "compliance",
              "volume",
              "price",
              "positioning",
              "geography",
            ],
          },
          status: { type: "string", enum: ["verified", "unmet", "unknown"] },
          source_urls: stringListSchema,
          quote: stringSchema,
        }),
      },
      unknowns: stringListSchema,
      risks: stringListSchema,
    }),
  },
  evidence: {
    type: "array",
    items: objectSchema({
      url: stringSchema,
      title: stringSchema,
      publisher: stringSchema,
      source_type: { type: "string", enum: supportedSourceTypes },
      excerpt: stringSchema,
    }),
  },
  remaining_gaps: stringListSchema,
  evidence_exhausted: { type: "boolean" },
  summary: stringSchema,
});
interface LiveProof {
  status: "verified" | "unmet" | "unknown";
  source_urls: string[];
  quote: string;
}
export interface LiveCandidateRecord {
  legal_name: string;
  country: string;
  headquarters: string;
  website: string | null;
  supplier_type: SupplierEntityV3["supplier_type"];
  manufacturer_status: SupplierEntityV3["manufacturer_status"];
  identity: LiveProof;
  product_name: string;
  product_family: string;
  product_origin: string;
  product: LiveProof;
  facts: {
    field_path: string;
    value: string;
    claim_type: ClaimV3["claim_type"];
    source_urls: string[];
    quote: string;
  }[];
  certifications: {
    name: string;
    issuer: string | null;
    certificate_number: string | null;
    scope: string;
    status: "active" | "conditional" | "expired" | "unknown";
    valid_from: string | null;
    valid_until: string | null;
    source_urls: string[];
    quote: string;
  }[];
  constraints: (LiveProof & {
    constraint: string;
    dimension:
      | "product"
      | "compliance"
      | "volume"
      | "price"
      | "positioning"
      | "geography";
  })[];
  unknowns: string[];
  risks: string[];
}
export interface LiveDiscoveryPayload {
  candidates: LiveCandidateRecord[];
  evidence: {
    url: string;
    title: string;
    publisher: string;
    source_type: (typeof supportedSourceTypes)[number];
    excerpt: string;
  }[];
  remaining_gaps: string[];
  evidence_exhausted: boolean;
  summary: string;
}
export interface LiveEvidenceRecord {
  source: EvidenceSourceV3;
  native_citation: OpenRouterCitation;
  authoritative_text: string;
  verified_excerpts?: readonly {
    excerpt: string;
    authoritative_text: string;
    source_type: EvidenceSourceV3["source_type"];
  }[];
}
export interface RetrievedPrimaryEvidence {
  readonly url: string;
  readonly text: string;
  readonly content_sha256: string;
  readonly retrieved_at: string;
}
function conservativeSourceType(
  previous: EvidenceSourceV3["source_type"] | undefined,
  next: EvidenceSourceV3["source_type"],
): EvidenceSourceV3["source_type"] {
  if (!previous || previous === next) return next;
  const authority = (type: EvidenceSourceV3["source_type"]): number =>
    type === "official_registry" || type === "government_trade_portal"
      ? 2
      : type === "official_website" || type === "catalog_pdf"
        ? 1
        : 0;
  // A later batch must not upgrade the authority of an earlier excerpt.
  return authority(previous) <= authority(next) ? previous : next;
}
export function stableCandidateKey(candidate: LiveCandidateRecord): string {
  const website = candidate.website && safePublicEvidenceUrl(candidate.website);
  return website
    ? new URL(website).hostname.replace(/^www\./, "")
    : `${candidate.legal_name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")}:${candidate.country.toLowerCase()}`;
}
function knownCountry(country: string): string | undefined {
  const value = country.normalize("NFKC").trim().toLowerCase();
  return ["", "unknown", "unspecified", "not specified"].includes(value)
    ? undefined
    : value;
}
function companyHost(raw: string | null): string | undefined {
  const url = raw && safePublicEvidenceUrl(raw);
  return url ? new URL(url).hostname.replace(/^www\./, "") : undefined;
}
function relatedCompanyHosts(a: string, b: string): boolean {
  // Explicit parent/subdomain relationships only; never guess registrable domains.
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}
export function sameLiveCandidateIdentity(
  a: LiveCandidateRecord,
  b: LiveCandidateRecord,
): boolean {
  const name = (value: string) =>
    value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  if (!name(a.legal_name) || name(a.legal_name) !== name(b.legal_name))
    return false;
  if (
    knownCountry(a.country) &&
    knownCountry(b.country) &&
    knownCountry(a.country) !== knownCountry(b.country)
  )
    return false;
  const aHost = companyHost(a.website),
    bHost = companyHost(b.website);
  if (aHost && bHost) return relatedCompanyHosts(aHost, bHost);
  const established = aHost ?? bHost;
  if (!established) return true;
  const other = aHost ? b : a;
  const proofHosts = [
    ...other.identity.source_urls,
    ...other.product.source_urls,
  ]
    .map(companyHost)
    .filter((host): host is string => Boolean(host));
  return (
    !proofHosts.length ||
    proofHosts.some((host) => relatedCompanyHosts(established, host))
  );
}
export function reconcileLiveCandidateRecords(
  records: readonly LiveCandidateRecord[],
  evidence: Map<string, LiveEvidenceRecord>,
): LiveCandidateRecord[] {
  const result: LiveCandidateRecord[] = [];
  const supported = (proof: Pick<LiveProof, "source_urls" | "quote">) =>
    proofSources(proof, evidence).length > 0;
  const bestProof = (a: LiveProof, b: LiveProof) => {
    const rank = (proof: LiveProof) =>
      proof.status !== "unknown" && supported(proof)
        ? 2
        : proof.status !== "unknown"
          ? 1
          : 0;
    return rank(b) > rank(a) ? b : a;
  };
  for (const record of records) {
    const next = structuredClone(record);
    const matches = result.filter((candidate) =>
      sameLiveCandidateIdentity(candidate, next),
    );
    const old = matches.length === 1 ? matches[0] : undefined;
    if (!old) {
      result.push(next);
      continue;
    }
    const identity = bestProof(old.identity, next.identity);
    const product = bestProof(old.product, next.product);
    const facts = [...old.facts];
    for (const fact of next.facts) {
      const index = facts.findIndex(
        (item) => item.field_path === fact.field_path,
      );
      if (index < 0) facts.push(fact);
      else if (!supported(facts[index]!) && supported(fact))
        facts[index] = fact;
    }
    const constraints = new Map<
      string,
      LiveCandidateRecord["constraints"][number]
    >();
    for (const constraint of [...old.constraints, ...next.constraints]) {
      const previous = constraints.get(constraint.constraint);
      const rank = (value: typeof constraint) =>
        supported(value)
          ? value.status === "unmet"
            ? 3
            : value.status === "verified"
              ? 2
              : 0
          : 0;
      if (!previous || rank(constraint) > rank(previous))
        constraints.set(constraint.constraint, constraint);
    }
    const certifications = [...old.certifications];
    for (const cert of next.certifications) {
      const index = certifications.findIndex((item) => item.name === cert.name);
      if (index < 0) certifications.push(cert);
      else if (!supported(certifications[index]!) && supported(cert))
        certifications[index] = cert;
    }
    Object.assign(old, {
      country: knownCountry(old.country) ? old.country : next.country,
      headquarters: knownCountry(old.headquarters)
        ? old.headquarters
        : next.headquarters,
      website: old.website ?? next.website,
      identity,
      product,
      ...(product === next.product
        ? {
            product_name: next.product_name,
            product_family: next.product_family,
            product_origin: next.product_origin,
          }
        : {}),
      facts,
      constraints: [...constraints.values()],
      certifications,
      unknowns: [...new Set([...old.unknowns, ...next.unknowns])],
      risks: [...new Set([...old.risks, ...next.risks])],
    });
  }
  return result;
}

function normalizedEvidence(text: string): string {
  let literal = text.trim();
  for (const [left, right] of [
    ["“", "”"],
    ["‘", "’"],
    ['"', '"'],
    ["'", "'"],
  ]) {
    if (
      literal.length > 1 &&
      literal.startsWith(left!) &&
      literal.endsWith(right!)
    ) {
      literal = literal.slice(left!.length, -right!.length).trim();
      break;
    }
  }
  return literal.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}
function candidateProofQuotes(
  records: readonly LiveCandidateRecord[],
): Map<string, string[]> {
  const quotes = new Map<string, string[]>();
  for (const candidate of records) {
    for (const proof of [
      candidate.identity,
      candidate.product,
      ...candidate.facts,
      ...candidate.certifications,
      ...candidate.constraints,
    ]) {
      if (!normalizedEvidence(proof.quote)) continue;
      for (const raw of proof.source_urls) {
        const url = safePublicEvidenceUrl(raw);
        if (url)
          quotes.set(url, [
            ...new Set([...(quotes.get(url) ?? []), proof.quote]),
          ]);
      }
    }
  }
  return quotes;
}
function publishedExcerptSummary(
  excerpts: readonly { excerpt: string }[],
): string {
  const unique = [...new Set(excerpts.map((item) => item.excerpt))];
  return unique.length === 1
    ? unique[0]!
    : unique
        .map((excerpt, index) => `Verified excerpt ${index + 1}:\n${excerpt}`)
        .join("\n\n");
}
// The legacy record joined page text and native snippets. Never accept a quote
// that crosses that artificial boundary when recovering retained evidence.
function retainedAuthoritySegments(
  text: string,
  nativeContent?: string,
): string[] {
  if (nativeContent && text.endsWith(`\n${nativeContent}`))
    return [text.slice(0, -(nativeContent.length + 1)), nativeContent].filter(
      Boolean,
    );
  return [text];
}
export function revalidateRetainedLiveEvidence(
  roster: readonly LiveCandidateRecord[],
  evidence: Map<string, LiveEvidenceRecord>,
): void {
  for (const [url, quotes] of candidateProofQuotes(roster)) {
    const record = evidence.get(url);
    if (
      !record ||
      record.source.source_url !== url ||
      record.source.verification_status !== "externally_verified" ||
      !safePublicEvidenceUrl(record.native_citation.url)
    )
      continue;
    const contexts = record.verified_excerpts ?? [
      {
        excerpt: record.source.excerpt_summary,
        authoritative_text: record.authoritative_text,
        source_type: record.source.source_type,
      },
    ];
    // Invalid selected excerpts do not invalidate their retained source text.
    // Filter published quotations separately from authoritative contexts.
    const verified = contexts.flatMap((item) =>
      retainedAuthoritySegments(
        item.authoritative_text,
        record.native_citation.content,
      )
        .filter(
          (segment) =>
            normalizedEvidence(item.excerpt).length > 0 &&
            normalizedEvidence(segment).includes(
              normalizedEvidence(item.excerpt),
            ),
        )
        .map((segment) => ({ ...item, authoritative_text: segment })),
    );
    for (const quote of quotes) {
      for (const context of contexts) {
        const sourceType = conservativeSourceType(
          record.source.source_type,
          context.source_type,
        );
        for (const authoritative of retainedAuthoritySegments(
          context.authoritative_text,
          record.native_citation.content,
        )) {
          if (
            !normalizedEvidence(authoritative).includes(
              normalizedEvidence(quote),
            )
          )
            continue;
          if (
            !verified.some(
              (item) =>
                item.excerpt === quote &&
                item.authoritative_text === authoritative &&
                item.source_type === sourceType,
            )
          )
            verified.push({
              excerpt: quote,
              authoritative_text: authoritative,
              source_type: sourceType,
            });
        }
      }
    }
    evidence.set(url, {
      ...record,
      source: {
        ...record.source,
        excerpt_summary: publishedExcerptSummary(verified),
      },
      verified_excerpts: verified,
    });
  }
}

export function ingestLiveEvidence(
  payload: LiveDiscoveryPayload,
  citations: readonly OpenRouterCitation[],
  evidence: Map<string, LiveEvidenceRecord>,
  retrieved: ReadonlyMap<string, RetrievedPrimaryEvidence | null> = new Map(),
): void {
  const native = new Map(citations.map((citation) => [citation.url, citation]));
  for (const citation of citations) {
    const actual = retrieved.get(citation.url);
    if (actual) native.set(actual.url, citation);
  }
  const proofQuotes = candidateProofQuotes(payload.candidates);
  for (const entry of payload.evidence.flatMap((entry) => [
    entry,
    ...(proofQuotes.get(safePublicEvidenceUrl(entry.url) ?? "") ?? []).map(
      (excerpt) => ({ ...entry, excerpt }),
    ),
  ])) {
    const url = safePublicEvidenceUrl(entry.url);
    const citation = url ? native.get(url) : undefined;
    if (!url || !citation || !normalizedEvidence(entry.excerpt)) continue;
    const actual = retrieved.get(citation.url);
    const authoritative = [actual?.text, citation.content]
      .filter((text): text is string => Boolean(text))
      .find((text) =>
        normalizedEvidence(text).includes(normalizedEvidence(entry.excerpt)),
      );
    if (!authoritative) continue;
    const id = `evidence-${createHash("sha256").update(url).digest("hex").slice(0, 20)}`;
    const previous = evidence.get(url);
    const verifiedExcerpts = [
      ...(previous?.verified_excerpts ??
        (previous
          ? [
              {
                excerpt: previous.source.excerpt_summary,
                authoritative_text: previous.authoritative_text,
                source_type: previous.source.source_type,
              },
            ]
          : [])),
    ];
    if (
      !verifiedExcerpts.some(
        (item) =>
          item.excerpt === entry.excerpt &&
          item.authoritative_text === authoritative &&
          item.source_type === entry.source_type,
      )
    )
      verifiedExcerpts.push({
        excerpt: entry.excerpt,
        authoritative_text: authoritative,
        source_type: entry.source_type,
      });
    evidence.set(url, {
      source: {
        evidence_id: id,
        source_id: id,
        source_url: url,
        source_title: entry.title || citation.title,
        publisher: entry.publisher || new URL(url).hostname,
        source_type: conservativeSourceType(
          previous?.source.source_type,
          entry.source_type,
        ),
        retrieved_at: actual?.retrieved_at ?? new Date().toISOString(),
        freshness_status: "current",
        verification_status: "externally_verified",
        excerpt_summary: publishedExcerptSummary(verifiedExcerpts),
        supports_claim_ids: [],
        contradicts_claim_ids: [],
      },
      native_citation: citation,
      authoritative_text: authoritative,
      verified_excerpts: verifiedExcerpts,
    });
  }
}
const primaryTypes = new Set([
  "official_website",
  "official_registry",
  "government_trade_portal",
  "catalog_pdf",
]);
function proofSources(
  proof: Pick<LiveProof, "source_urls" | "quote">,
  evidence: Map<string, LiveEvidenceRecord>,
): EvidenceSourceV3[] {
  if (!normalizedEvidence(proof.quote)) return [];
  const normalize = normalizedEvidence;
  return proof.source_urls.flatMap((raw) => {
    const url = safePublicEvidenceUrl(raw);
    const record = url ? evidence.get(url) : undefined;
    if (!record || !primaryTypes.has(record.source.source_type)) return [];
    const excerpts = record.verified_excerpts ?? [
      {
        excerpt: record.source.excerpt_summary,
        authoritative_text: record.authoritative_text,
        source_type: record.source.source_type,
      },
    ];
    if (
      !excerpts.some(
        (item) =>
          primaryTypes.has(item.source_type) &&
          normalize(item.excerpt).includes(normalize(proof.quote)) &&
          normalize(item.authoritative_text).includes(normalize(proof.quote)),
      )
    )
      return [];
    return [record.source];
  });
}
export function evaluateLiveCandidate(
  candidate: LiveCandidateRecord,
  requirements: readonly string[],
  evidence: Map<string, LiveEvidenceRecord>,
): string[] {
  const problems: string[] = [];
  const website = candidate.website && safePublicEvidenceUrl(candidate.website);
  if (!website) problems.push("No valid official company website.");
  const identitySources = proofSources(candidate.identity, evidence);
  if (candidate.identity.status !== "verified" || !identitySources.length)
    problems.push("Corporate identity lacks primary native-search evidence.");
  const normalizeIdentity = (value: string) =>
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  if (
    !normalizeIdentity(candidate.identity.quote).includes(
      normalizeIdentity(candidate.legal_name),
    )
  )
    problems.push(
      "The legal company name is absent from its identity quotation.",
    );
  if (
    website &&
    !identitySources.some(
      (source) =>
        new URL(source.source_url).hostname.replace(/^www\./, "") ===
        new URL(website).hostname.replace(/^www\./, ""),
    )
  )
    problems.push("The company website has not been evidenced as official.");
  const productSources = proofSources(candidate.product, evidence);
  if (candidate.product.status !== "verified" || !productSources.length)
    problems.push("Product capability lacks primary native-search evidence.");
  const host = companyHost(candidate.website);
  const ownSource = (source: EvidenceSourceV3) => {
    const sourceHost = companyHost(source.source_url);
    return Boolean(host && sourceHost && relatedCompanyHosts(host, sourceHost));
  };
  const namedRelationship = normalizeIdentity(candidate.product.quote).includes(
    normalizeIdentity(candidate.legal_name),
  );
  const ownProductRelationship = candidate.facts.some((fact) => {
    if (
      ![
        "specifications.model",
        "specifications.model_number",
        "specifications.part_number",
        "specifications.product_name",
      ].includes(fact.field_path)
    )
      return false;
    const value = normalizedEvidence(fact.value);
    if (value.length < 3 || !normalizedEvidence(fact.quote).includes(value))
      return false;
    const productName = normalizedEvidence(candidate.product_name);
    const productQuote = normalizedEvidence(candidate.product.quote);
    const productTokens = (text: string) => text.split(/[^\p{L}\p{N}_+-]+/u);
    const exactProduct =
      fact.field_path === "specifications.product_name"
        ? productName === value && productQuote.includes(value)
        : productTokens(productName).includes(value) &&
          productTokens(productQuote).includes(value);
    return exactProduct && proofSources(fact, evidence).some(ownSource);
  });
  if (
    productSources.length &&
    !productSources.some(ownSource) &&
    !namedRelationship &&
    !ownProductRelationship
  )
    problems.push(
      "Product evidence has no grounded relationship to this supplier.",
    );
  for (const requirement of requirements) {
    const matches = candidate.constraints.filter(
      (item) => item.constraint === requirement,
    );
    if (
      matches.some(
        (item) =>
          item.status === "unmet" &&
          (item.dimension === "product" || item.dimension === "compliance") &&
          proofSources(item, evidence).length,
      )
    )
      problems.push(
        `Mandatory technical or compliance mismatch: ${requirement}`,
      );
  }
  return problems;
}

export function assembleLiveSuppliers(
  records: readonly LiveCandidateRecord[],
  requirements: readonly string[],
  evidence: Map<string, LiveEvidenceRecord>,
  limit: number,
  entityIds = new Map<string, string>(),
) {
  const candidates: SupplierEntityV3[] = [];
  const claims: ClaimV3[] = [];
  const excluded: { legal_name: string; reason: string }[] = [];
  const sourceClaims = new Map<string, string[]>();
  const assignedKeys = new Map<string, string>();
  for (const candidate of records) {
    const problems = evaluateLiveCandidate(candidate, requirements, evidence);
    if (problems.length) {
      excluded.push({
        legal_name: candidate.legal_name,
        reason: problems.join(" "),
      });
      continue;
    }
    if (candidates.length >= limit) continue;
    const baseKey = stableCandidateKey(candidate);
    const identity = `${candidate.legal_name.normalize("NFKC").trim().toLowerCase()}:${knownCountry(candidate.country) ?? "unknown"}`;
    const previousIdentity = assignedKeys.get(baseKey);
    const distinctKey = `${baseKey}:${createHash("sha256").update(identity).digest("hex").slice(0, 12)}`;
    const key =
      entityIds.has(distinctKey) ||
      (previousIdentity && previousIdentity !== identity)
        ? distinctKey
        : baseKey;
    if (key === baseKey) assignedKeys.set(baseKey, identity);
    const entityId = entityIds.get(key) ?? randomUUID();
    entityIds.set(key, entityId);
    const makeClaim = (
      text: string,
      proof: Pick<LiveProof, "source_urls" | "quote">,
      type: ClaimV3["claim_type"],
      field: string,
      status: ClaimV3["status"] = "externally_verified",
    ): string[] => {
      const sources = proofSources(proof, evidence);
      if (!sources.length) return [];
      const claimId = randomUUID();
      for (const source of sources)
        sourceClaims.set(source.evidence_id, [
          ...(sourceClaims.get(source.evidence_id) ?? []),
          claimId,
        ]);
      claims.push({
        claim_id: claimId,
        supplier_entity_id: entityId,
        claim_type: type,
        field_path: field,
        claim_text: text,
        status,
        // Multiple URLs or a company's own social profiles are not independent origins.
        // The current contract does not establish independent ownership, so do not infer it.
        confidence: "medium",
        conflict_status: "single_source",
        evidence_ids: sources.map((source) => source.evidence_id),
      });
      return sources.map((source) => source.evidence_id);
    };
    const identityIds = makeClaim(
      candidate.legal_name,
      candidate.identity,
      "identity",
      "legal_name",
    );
    const productIds = makeClaim(
      candidate.product_name,
      candidate.product,
      "product_spec",
      "offering.product_name",
    );
    const facts = new Map<string, { value: string; evidence_ids: string[] }>();
    for (const fact of candidate.facts) {
      if (
        !fact.value.trim() ||
        !fact.quote.toLowerCase().includes(fact.value.toLowerCase())
      )
        continue;
      if (fact.field_path === "commercial.price_date") {
        const dateSources = proofSources(fact, evidence);
        const priceSources = candidate.facts
          .filter(
            (entry) =>
              ["commercial.price_min", "commercial.price_max"].includes(
                entry.field_path,
              ) &&
              /^\d+(?:\.\d+)?$/.test(entry.value) &&
              entry.quote.includes(entry.value),
          )
          .flatMap((entry) => proofSources(entry, evidence));
        // A crawl timestamp or validity deadline is not the date of a price.
        if (
          !/\b(?:updated|published|as of|dated|price date|quotation date|quoted on|effective from)\b/i.test(
            fact.quote,
          ) ||
          /\b(?:retrieved|accessed|crawled|copyright|valid until|expires?)\b/i.test(
            fact.quote,
          ) ||
          !dateSources.some((source) =>
            priceSources.some(
              (price) => price.evidence_id === source.evidence_id,
            ),
          )
        )
          continue;
      }
      const ids = makeClaim(
        `${fact.field_path}: ${fact.value}`,
        fact,
        fact.claim_type,
        fact.field_path,
      );
      if (ids.length)
        facts.set(fact.field_path, { value: fact.value, evidence_ids: ids });
    }
    const pendingRequirements: string[] = [];
    const constraints = requirements.map((requirement) => {
      const matches = candidate.constraints.filter(
        (entry) => entry.constraint === requirement,
      );
      const item = matches.length === 1 ? matches[0] : undefined;
      const supported =
        item?.status === "verified" && proofSources(item, evidence).length > 0;
      if (!supported)
        pendingRequirements.push(`Requires confirmation: ${requirement}`);
      return {
        constraint: requirement,
        satisfied: supported,
        evidence_ids: supported
          ? makeClaim(
              requirement,
              item!,
              "product_spec",
              "assessment.mandatory_constraint_results",
            )
          : [],
      };
    });
    const website = safePublicEvidenceUrl(candidate.website!)!;
    const productSpecs: Record<string, string> = {};
    for (const [path, fact] of facts)
      if (path.startsWith("specifications."))
        productSpecs[path.slice("specifications.".length)] = fact.value;
    const optionalValue = (path: string) => facts.get(path)?.value;
    const contactPaths = [
      "contacts.sales_email",
      "contacts.export_email",
      "contacts.general_email",
      "contacts.phone",
      "contacts.contact_page_url",
    ];
    const contactFields = Object.fromEntries(
      contactPaths.flatMap((path) =>
        facts.has(path) ? [[path.split(".")[1]!, facts.get(path)!.value]] : [],
      ),
    );
    const commercialPaths = [
      "commercial.moq",
      "commercial.production_capacity",
      "commercial.lead_time",
      "commercial.payment_terms",
      "commercial.incoterm",
      "commercial.incoterm_location",
      "commercial.price_date",
      "commercial.price_validity",
      "commercial.currency",
      "commercial.unit",
    ];
    const commercialFields = Object.fromEntries(
      commercialPaths.flatMap((path) =>
        facts.has(path) ? [[path.split(".")[1]!, facts.get(path)!.value]] : [],
      ),
    );
    const pricePaths = ["commercial.price_min", "commercial.price_max"];
    const observedPrices: { price_min?: number; price_max?: number } = {};
    for (const path of pricePaths) {
      const fact = facts.get(path);
      const raw = candidate.facts.find((entry) => entry.field_path === path);
      if (
        !fact ||
        !raw?.quote.includes(fact.value) ||
        !/^\d+(?:\.\d+)?$/.test(fact.value)
      )
        continue;
      const number = Number(fact.value);
      if (Number.isFinite(number) && number >= 0)
        observedPrices[
          path === "commercial.price_min" ? "price_min" : "price_max"
        ] = number;
    }
    if (
      observedPrices.price_min !== undefined &&
      observedPrices.price_max !== undefined &&
      observedPrices.price_min > observedPrices.price_max
    ) {
      delete observedPrices.price_min;
      delete observedPrices.price_max;
    }
    const hasPublicPrice =
      observedPrices.price_min !== undefined ||
      observedPrices.price_max !== undefined;
    const companyHost = new URL(website).hostname.replace(/^www\./, "");
    const certifications = candidate.certifications.flatMap((certification) => {
      const sources = proofSources(certification, evidence);
      if (!sources.length) return [];
      const independentlyEvidenced = sources.some(
        (source) =>
          source.source_type === "official_registry" ||
          source.source_type === "government_trade_portal" ||
          new URL(source.source_url).hostname.replace(/^www\./, "") !==
            companyHost,
      );
      const ids = makeClaim(
        `${certification.name}: ${certification.scope}`,
        certification,
        "compliance",
        "certifications",
        independentlyEvidenced ? "externally_verified" : "supplier_claimed",
      );
      return [
        {
          certification_name: certification.name,
          issuer: certification.issuer,
          certificate_number: certification.certificate_number,
          scope: certification.scope,
          status: certification.status,
          ...(certification.valid_from
            ? { valid_from: certification.valid_from }
            : {}),
          ...(certification.valid_until
            ? { valid_until: certification.valid_until }
            : {}),
          verification_status: independentlyEvidenced
            ? ("verified" as const)
            : ("claimed" as const),
          evidence_ids: ids,
        },
      ];
    });
    const unknownDimensions = [
      "Volume/capacity fit requires buyer and supplier confirmation.",
      "Price fit requires a current quotation.",
      "Positioning and geographic service scope require transaction-specific validation.",
    ];
    const dimensionScore = (
      dimension: LiveCandidateRecord["constraints"][number]["dimension"],
    ) => {
      const checks = candidate.constraints.filter(
        (item) =>
          item.dimension === dimension &&
          requirements.includes(item.constraint),
      );
      if (!checks.length) return dimension === "product" ? 100 : 0;
      return Math.round(
        (100 *
          checks.filter(
            (item) =>
              item.status === "verified" && proofSources(item, evidence).length,
          ).length) /
          checks.length,
      );
    };
    const dimensions = {
      category_product_fit: dimensionScore("product"),
      compliance_certification_fit: dimensionScore("compliance"),
      volume_capacity_fit: dimensionScore("volume"),
      price_tier_fit: dimensionScore("price"),
      positioning_brand_fit: dimensionScore("positioning"),
      geographic_reach_fit: dimensionScore("geography"),
    };
    const score = Math.round(
      dimensions.category_product_fit * 0.25 +
        dimensions.compliance_certification_fit * 0.2 +
        dimensions.volume_capacity_fit * 0.15 +
        dimensions.price_tier_fit * 0.15 +
        dimensions.positioning_brand_fit * 0.15 +
        dimensions.geographic_reach_fit * 0.1,
    );
    candidates.push({
      supplier_entity_id: entityId,
      candidate_id: `cand-${String(candidates.length + 1).padStart(2, "0")}`,
      legal_name: candidate.legal_name,
      brand_names: [],
      aliases: [],
      entity_basis: "live_verified",
      evidence_basis: "live_evidence",
      verification_status: "externally_verified",
      supplier_type: candidate.supplier_type,
      manufacturer_status: candidate.manufacturer_status,
      country_of_registration:
        optionalValue("country_of_registration") ?? "Not verified",
      headquarters_address:
        optionalValue("headquarters_address") ?? "Not verified",
      manufacturing_locations: optionalValue("manufacturing_location")
        ? [optionalValue("manufacturing_location")!]
        : [],
      website,
      primary_domain: new URL(website).hostname,
      identity_confidence: identityIds.length > 1 ? "high" : "medium",
      identity_evidence_ids: identityIds,
      contacts: {
        ...contactFields,
        verification_status: contactPaths.some((path) => facts.has(path))
          ? "verified"
          : "unverified",
        contact_evidence_ids: [
          ...new Set(
            contactPaths.flatMap((path) => facts.get(path)?.evidence_ids ?? []),
          ),
        ],
      },
      digital_assets: [
        ...new Set(
          claims
            .filter((claim) => claim.supplier_entity_id === entityId)
            .flatMap((claim) => claim.evidence_ids),
        ),
      ].flatMap((id) => {
        const source = [...evidence.values()].find(
          (entry) => entry.source.evidence_id === id,
        )?.source;
        return source
          ? [
              {
                asset_class:
                  source.source_type === "catalog_pdf"
                    ? "Product catalog or technical document"
                    : source.source_type === "official_registry"
                      ? "Official registry"
                      : "Official company, product or contact source",
                url: source.source_url,
                status: "inspected" as const,
                retrieved_at: source.retrieved_at,
              },
            ]
          : [];
      }),
      offering: {
        product_name: candidate.product_name,
        product_family: candidate.product_family,
        specifications: productSpecs,
        use_cases: [],
        country_of_origin: optionalValue("country_of_origin") ?? "Not verified",
        product_evidence_ids: productIds,
      },
      commercial: {
        ...commercialFields,
        ...observedPrices,
        ...(hasPublicPrice
          ? {
              price_type:
                "Public supplier indication; current transaction quotation required",
            }
          : {}),
        quotation_required: true,
        commercial_confidence:
          commercialPaths.some((path) => facts.has(path)) || hasPublicPrice
            ? "medium"
            : "not_assessed",
        commercial_evidence_ids: [
          ...new Set(
            [...commercialPaths, ...(hasPublicPrice ? pricePaths : [])].flatMap(
              (path) => facts.get(path)?.evidence_ids ?? [],
            ),
          ),
        ],
      },
      certifications,
      assessment: {
        rank: candidates.length + 1,
        compatibility_score: pendingRequirements.length
          ? Math.min(60, score)
          : score,
        fit_band: pendingRequirements.length
          ? "Potential Fit"
          : score >= 75
            ? "Strong Fit"
            : "Potential Fit",
        evidence_confidence: "medium",
        identity_confidence: "medium",
        data_completeness: Math.round(
          ((2 + facts.size) /
            (2 + facts.size + candidate.unknowns.length + 3)) *
            100,
        ),
        dimension_scores: dimensions,
        mandatory_constraint_results: constraints,
        positive_drivers: [
          "Official identity and product capability supported by native web primary citations.",
          `${constraints.filter((item) => item.satisfied).length} of ${requirements.length} mandatory criteria have supporting primary citations.`,
        ],
        limiting_gaps: [
          ...candidate.unknowns,
          ...pendingRequirements,
          ...unknownDimensions,
        ],
        risk_flags: [
          ...candidate.risks,
          ...(pendingRequirements.length
            ? [
                "Conditional match: unverified requirements require confirmation before procurement.",
              ]
            : []),
        ],
        unknowns: [...candidate.unknowns, ...pendingRequirements],
        required_validation: [
          "Confirm current documents, commercial terms and supply availability directly before procurement.",
        ],
        recommended_next_action:
          "Request a current quotation and verify cited documents before commitment.",
      },
    });
  }
  const sources = [...evidence.values()].map(({ source }) => ({
    ...source,
    supports_claim_ids: sourceClaims.get(source.evidence_id) ?? [],
  }));
  return {
    candidates,
    claims,
    evidence_sources: sources,
    excluded_candidates: excluded,
  };
}
