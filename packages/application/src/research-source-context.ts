import type { OpenRouterCitation } from "./openrouter-model-policy.js";
import type { RetrievedPrimaryEvidence } from "./live-supplier-evidence.js";
import type { CandidateIndex } from "./native-candidate-index.js";

/** L14: retain source provenance independently of successful fact extraction. */
export function researchCitationInventory(
  current: readonly OpenRouterCitation[],
  retained: readonly OpenRouterCitation[],
  retrieved: ReadonlyMap<string, RetrievedPrimaryEvidence | null>,
): OpenRouterCitation[] {
  const inventory = new Map(retained.map((source) => [source.url, source]));
  // Legacy continuations stored only native-cited retrievals, including pages
  // that yielded no accepted facts. They remain observations, never new searches.
  for (const [url, page] of retrieved) {
    if (page && !inventory.has(url))
      inventory.set(url, {
        url,
        title: "Previously cited source",
        content: "",
      });
  }
  for (const source of current) inventory.set(source.url, source);
  return [...inventory.values()];
}

/** Each excerpt is a separate literal passage; separators cannot prove a fact. */
export function selectResearchSourceExcerpt(
  text: string,
  relevance: string,
): string {
  if (text.length <= 5800) return text;
  const terms = [
    ...new Set(
      relevance.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{3,}/gu) ?? [],
    ),
  ];
  const windows: {
    start: number;
    text: string;
    score: number;
    kind: string;
  }[] = [];
  for (let start = 0; start < text.length; start += 700) {
    const span = text.slice(start, start + 1000);
    const contact =
      /[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:tel|phone|contact us)\b/i.test(span);
    const commercial =
      /\b(?:price|AED|USD|EUR|sold out|out of stock|in stock|availability)\b/i.test(
        span,
      );
    const identity =
      /\b(?:gmbh|limited|l\.?l\.?c|inc\.|company name|legal|imprint|registered)\b/i.test(
        span,
      );
    const score = terms.filter((term) =>
      span.toLowerCase().includes(term),
    ).length;
    windows.push({
      start,
      text: span,
      score: score + (identity ? 4 : 0),
      kind: contact
        ? "contact"
        : commercial
          ? "commercial"
          : identity
            ? "identity"
            : "product",
    });
  }
  const chosen = new Map<number, (typeof windows)[number]>();
  for (const kind of ["identity", "contact", "commercial", "product"]) {
    const hit = windows
      .filter((window) => window.kind === kind)
      .sort((a, b) => b.score - a.score || a.start - b.start)[0];
    if (hit) chosen.set(hit.start, hit);
  }
  for (const window of windows.sort(
    (a, b) => b.score - a.score || a.start - b.start,
  )) {
    if (chosen.size >= 5) break;
    chosen.set(window.start, window);
  }
  return [...chosen.values()]
    .sort((a, b) => a.start - b.start)
    .map((window) => window.text)
    .join("\n[Separate source excerpt]\n");
}

function host(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function candidateSourceCitations(
  candidate: CandidateIndex["candidates"][number],
  citations: readonly OpenRouterCitation[],
): OpenRouterCitation[] {
  const assigned = new Set(candidate.source_urls);
  const named = citations.filter((source) =>
    source.content?.toLowerCase().includes(candidate.legal_name.toLowerCase()),
  );
  const namedHosts = new Set(
    named.map((source) => host(source.url)).filter(Boolean),
  );
  return citations.filter(
    (source) => assigned.has(source.url) || namedHosts.has(host(source.url)),
  );
}
