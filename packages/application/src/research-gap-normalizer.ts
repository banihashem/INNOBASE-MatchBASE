/** MB-UX-LIVE-001 L14: model research notes are not approved buyer requirements. */
export function normalizeResearchGaps(values: unknown, limit = 12): string[] {
  if (!Array.isArray(values)) return [];
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.min(40, Math.trunc(limit)))
    : 12;
  const accepted: string[] = [];
  const seen = new Set<string>();
  for (const value of values.slice(0, 200)) {
    if (accepted.length >= boundedLimit) break;
    if (
      typeof value !== "string" ||
      value.length > 800 ||
      Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
      })
    )
      continue;
    const gap = value.trim().replace(/\s+/gu, " ");
    if (
      !gap ||
      !/\p{L}/u.test(gap) ||
      /[{}]|```|~~~|(?:["']?[\w]+["']\s*:\s*(?:true|false|null|[[{]))/u.test(
        gap,
      )
    )
      continue;
    // Serialized fragments can be valid JSON string values; schema validity is insufficient.
    if (
      /\b(?:evidence_exhausted|summary_ok|remaining_gaps|assigned_candidate_names)["']?\s*:/iu.test(
        gap,
      ) ||
      /(?:[[\]},]\s*){4,}/u.test(gap) ||
      /^(?:[[,\s]*)["'][\w .-]{1,64}["']\s*:/u.test(gap)
    )
      continue;
    const key = gap.normalize("NFKC").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push(gap);
  }
  return accepted;
}
