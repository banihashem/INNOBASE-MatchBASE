import type {
  LiveCandidateRecord,
  LiveDiscoveryPayload,
  RetrievedPrimaryEvidence,
} from "./live-supplier-evidence.js";
import type { OpenRouterCitation } from "./openrouter-model-policy.js";
import { normalizeResearchGaps } from "./research-gap-normalizer.js";

function host(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
function literalPassage(text: string, value: string): string | null {
  if (value.trim().length < 4 || /^(unknown|not specified)$/i.test(value))
    return null;
  const index = text.toLowerCase().indexOf(value.toLowerCase());
  if (
    index < 0 ||
    /[\p{L}\p{N}]/u.test(text[index - 1] ?? "") ||
    /[\p{L}\p{N}]/u.test(text[index + value.length] ?? "")
  )
    return null;
  return text.slice(
    Math.max(0, index - 60),
    Math.min(text.length, index + value.length + 100),
  );
}

/** L14: repair transcription only from exact, already fetched company text.
 * No new company, alias, capability, price, country or requirement is inferred.
 */
export function repairSourceTranscription(
  records: readonly LiveCandidateRecord[],
  citations: readonly OpenRouterCitation[],
  retrieved: ReadonlyMap<string, RetrievedPrimaryEvidence | null>,
): LiveDiscoveryPayload {
  const candidates = structuredClone([...records]);
  const evidence: LiveDiscoveryPayload["evidence"] = [];
  const sources = citations.flatMap((citation) => {
    const page = retrieved.get(citation.url);
    return page ? [{ citation, page }] : [];
  });
  for (const candidate of candidates) {
    candidate.unknowns = normalizeResearchGaps(candidate.unknowns, 40);
    candidate.risks = normalizeResearchGaps(candidate.risks, 40);
    const ownHost = candidate.website ? host(candidate.website) : null;
    if (!ownHost) continue;
    const own = sources.filter(
      ({ citation, page }) =>
        host(citation.url) === ownHost && host(page.url) === ownHost,
    );
    const identity = own
      .map((source) => ({
        ...source,
        quote: literalPassage(source.page.text, candidate.legal_name),
      }))
      .find((source) => source.quote);
    if (!identity?.quote) continue;
    const recordEvidence = (source: (typeof own)[number], quote: string) => {
      evidence.push({
        url: source.citation.url,
        title: source.citation.title,
        publisher: candidate.legal_name,
        source_type: "official_website",
        excerpt: quote,
      });
      return {
        status: "verified" as const,
        source_urls: [source.citation.url],
        quote,
      };
    };
    if (candidate.identity.status === "unmet") continue;
    candidate.identity = recordEvidence(identity, identity.quote);
    // A full existing offering name/quote must occur on a source the model
    // already assigned to this offering. Only observed www aliases are matched.
    const productSources = own.filter(({ citation }) =>
      candidate.product.source_urls.some((url) => {
        try {
          return (
            host(url) === ownHost &&
            new URL(url).pathname === new URL(citation.url).pathname &&
            new URL(url).search === new URL(citation.url).search
          );
        } catch {
          return false;
        }
      }),
    );
    const product =
      candidate.product.status === "verified"
        ? productSources.flatMap((source) => {
            const quote =
              literalPassage(source.page.text, candidate.product.quote) ??
              literalPassage(source.page.text, candidate.product_name);
            return quote ? [{ ...source, quote }] : [];
          })[0]
        : undefined;
    if (product) candidate.product = recordEvidence(product, product.quote);
    const addFact = (
      source: (typeof own)[number],
      field_path: string,
      value: string,
      quote: string,
      claim_type: LiveCandidateRecord["facts"][number]["claim_type"] = "identity",
    ) => {
      if (candidate.facts.some((fact) => fact.field_path === field_path))
        return;
      const proof = recordEvidence(source, quote);
      candidate.facts.push({
        field_path,
        value,
        claim_type,
        source_urls: proof.source_urls,
        quote,
      });
    };
    for (const source of own) {
      for (const match of source.page.text.matchAll(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      )) {
        const email = match[0];
        if (email.split("@")[1]?.toLowerCase() !== ownHost) continue;
        const field = /^sales@/i.test(email)
          ? "contacts.sales_email"
          : /^export@/i.test(email)
            ? "contacts.export_email"
            : /^(info|contact|enquiry|enquiries|support)@/i.test(email)
              ? "contacts.general_email"
              : null;
        const quote = literalPassage(source.page.text, email);
        if (field && quote) addFact(source, field, email, quote);
      }
      const phone = source.page.text.match(
        /\b(?:Phone|Telephone|Tel|Call(?: us)?)\s*[:.]?\s*(\+\d[\d ()-]{7,22}\d)/i,
      );
      if (phone?.[1]) addFact(source, "contacts.phone", phone[1], phone[0]);
      // Header contact numbers can be adjacent to the company's public email.
      const headerPhone = source.page.text.match(
        /(\+\d[\d ()-]{7,22}\d)(?:,\s*\+\d[\d ()-]{7,22}\d)?\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
      );
      if (
        headerPhone?.[1] &&
        headerPhone[2]?.split("@")[1]?.toLowerCase() === ownHost
      )
        addFact(source, "contacts.phone", headerPhone[1], headerPhone[0]);
    }
    if (product) {
      const observations = [
        ...product.page.text.matchAll(
          /\b(?:Regular price|Sale price|Price)\s*:?\s*(AED|USD|EUR|GBP)\s+(\d+(?:\.\d{1,2})?)(?![\d,.])/g,
        ),
      ];
      const prices = new Set(
        observations.map((match) => `${match[1]}:${match[2]}`),
      );
      const observed = observations[0];
      const range = observations.some((match) =>
        /^\s*(?:[-–—/]|to\b|through\b)/i.test(
          product.page.text.slice((match.index ?? 0) + match[0].length),
        ),
      );
      const existingConflict = candidate.facts.some(
        (fact) =>
          (fact.field_path === "commercial.currency" &&
            fact.value !== observed?.[1]) ||
          (["commercial.price_min", "commercial.price_max"].includes(
            fact.field_path,
          ) &&
            fact.value !== observed?.[2]),
      );
      // Conflicting sale/list prices, ranges and locale-formatted numbers need
      // interpretation; a deterministic repair must not choose between them.
      if (
        prices.size === 1 &&
        !range &&
        !existingConflict &&
        observed?.[1] &&
        observed[2] &&
        Number(observed[2]) > 0
      ) {
        addFact(
          product,
          "commercial.price_min",
          observed[2],
          observed[0],
          "pricing",
        );
        addFact(
          product,
          "commercial.currency",
          observed[1],
          observed[0],
          "pricing",
        );
        const notice =
          "The observed price is a retained public listing, not a current supplier quotation, confirmed stock or order-specific rate.";
        if (!candidate.risks.includes(notice)) candidate.risks.push(notice);
      }
    }
    if (product && /\b(?:sold out|out of stock)\b/i.test(product.page.text)) {
      const availability = product.page.text.match(
        /\b(?:sold out|out of stock)\b/i,
      )![0];
      addFact(
        product,
        "specifications.availability",
        availability,
        availability,
        "product_spec",
      );
      const warning =
        "The retained product page states sold out or out of stock. Current availability and a quotation require supplier confirmation.";
      if (!candidate.risks.includes(warning)) candidate.risks.push(warning);
    }
  }
  return {
    candidates,
    evidence,
    remaining_gaps: [],
    evidence_exhausted: false,
    summary:
      "Literal transcription repaired from retained cited sources; no new research or inferred supplier facts.",
  };
}
