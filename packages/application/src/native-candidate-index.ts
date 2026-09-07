import {
  LiveResearchError,
  type OpenRouterCompletionResult,
} from "./openrouter-model-policy.js";

export interface CandidateIndex {
  candidates: {
    legal_name: string;
    anchor_quote: string;
    source_urls: string[];
  }[];
  remaining_gaps: string[];
  evidence_exhausted: boolean;
  summary: string;
}
export interface NativeIndexDiagnostics {
  accepted_candidates: number;
  reanchored_names: string[];
  discarded_source_urls: string[];
  rejected_candidates: { legal_name: string; reason: string }[];
}

function nameSpan(text: string, name: string): number {
  let offset = 0;
  while (offset < text.length) {
    const start = text.indexOf(name, offset);
    if (start < 0) return -1;
    const before = Array.from(text.slice(0, start)).at(-1) ?? "";
    const after = Array.from(text.slice(start + name.length))[0] ?? "";
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after))
      return start;
    offset = start + name.length;
  }
  return -1;
}

// MB-UX-LIVE-001 L06: a discovery name span is scope, never identity or fact proof.
export function groundNativeCandidateIndex(
  index: CandidateIndex,
  native: OpenRouterCompletionResult,
): { index: CandidateIndex; diagnostics: NativeIndexDiagnostics } {
  const citations = native.citations ?? [];
  const urls = new Set(citations.map((citation) => citation.url));
  const texts = [
    native.text,
    ...citations.map((citation) => citation.content ?? ""),
  ];
  const diagnostics: NativeIndexDiagnostics = {
    accepted_candidates: 0,
    reanchored_names: [],
    discarded_source_urls: [],
    rejected_candidates: [],
  };
  const unique = new Map<string, CandidateIndex["candidates"][number]>();
  for (const item of index.candidates) {
    const name = item.legal_name;
    const source =
      name.trim() === name && name.length > 0 && name.length <= 200
        ? texts
            .map((text) => ({ text, start: nameSpan(text, name) }))
            .find((hit) => hit.start >= 0)
        : undefined;
    if (!source) {
      diagnostics.rejected_candidates.push({
        legal_name: name.slice(0, 200),
        reason: "Name has no exact bounded occurrence in original native data.",
      });
      continue;
    }
    const originalAnchor =
      item.anchor_quote.length <= 600 &&
      nameSpan(item.anchor_quote, name) >= 0 &&
      texts.some((text) => text.includes(item.anchor_quote));
    // Replace a model-written anchor with a literal source span, not a normalized
    // or stitched quotation. This anchor is never passed to evidence ingestion.
    const anchor = originalAnchor
      ? item.anchor_quote
      : source.text.slice(source.start, source.start + name.length + 160);
    if (!originalAnchor) diagnostics.reanchored_names.push(name);
    const allowedUrls = item.source_urls.filter((url) => urls.has(url));
    diagnostics.discarded_source_urls.push(
      ...item.source_urls.filter((url) => !urls.has(url)),
    );
    const key = name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
    const previous = unique.get(key);
    if (previous)
      previous.source_urls = [
        ...new Set([...previous.source_urls, ...allowedUrls]),
      ];
    else
      unique.set(key, {
        legal_name: name,
        anchor_quote: anchor,
        source_urls: [...new Set(allowedUrls)],
      });
  }
  diagnostics.accepted_candidates = unique.size;
  diagnostics.reanchored_names = [...new Set(diagnostics.reanchored_names)];
  diagnostics.discarded_source_urls = [
    ...new Set(diagnostics.discarded_source_urls),
  ];
  if (index.candidates.length && !unique.size)
    throw new LiveResearchError(
      "MB-422-LIVE-INDEX",
      "No indexed candidate name occurs exactly in the original native research data.",
    );
  return {
    index: {
      ...index,
      candidates: [...unique.values()],
      remaining_gaps: [
        ...index.remaining_gaps,
        ...diagnostics.rejected_candidates.map(
          (item) => `Excluded ungrounded index candidate: ${item.legal_name}`,
        ),
      ],
    },
    diagnostics,
  };
}
