/** MB-UX-LOGISTICS-001 L01: a lossless proposal, never an approved request. */
export const NARRATIVE_BOXES = [
  "productRequirement",
  "technicalCompliance",
  "orderProfile",
] as const;
export type NarrativeBox = (typeof NARRATIVE_BOXES)[number];
export interface NarrativeUnit {
  id: number;
  start: number;
  end: number;
  text: string;
}
export interface NarrativeAssignment {
  unit_id: number;
  boxes: NarrativeBox[];
}
export interface NarrativeMapping {
  version: "source-sentences.v1";
  units: NarrativeUnit[];
  assignments: NarrativeAssignment[];
  boxes: Record<NarrativeBox, string>;
  unresolved_unit_ids: number[];
}

export function narrativeSourceUnits(text: string): NarrativeUnit[] {
  if (!text.trim() || text.length > 12000)
    throw new Error("Enter a request of 1–12000 characters.");
  // Unicode sentence boundaries retain decimals, direction and compound clauses.
  const segments = [
    ...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(text),
  ];
  if (segments.length > 100)
    throw new Error("Use at most 100 sentences in one request.");
  return segments.map((entry, id) => ({
    id,
    start: entry.index,
    end: entry.index + entry.segment.length,
    text: entry.segment,
  }));
}

export function validateNarrativeMapping(
  text: string,
  value: unknown,
): NarrativeMapping {
  const units = narrativeSourceUnits(text);
  const raw = value as { assignments?: unknown } | null;
  if (
    !raw ||
    !Array.isArray(raw.assignments) ||
    raw.assignments.length !== units.length
  )
    throw new Error(
      "The proposal did not account for every original sentence. Use manual review.",
    );
  const seen = new Set<number>();
  const assignments = raw.assignments
    .map((item: unknown): NarrativeAssignment => {
      const row = item as NarrativeAssignment;
      if (
        !row ||
        !Number.isInteger(row.unit_id) ||
        !units[row.unit_id] ||
        seen.has(row.unit_id) ||
        !Array.isArray(row.boxes) ||
        row.boxes.length > 3 ||
        new Set(row.boxes).size !== row.boxes.length ||
        row.boxes.some((box) => !NARRATIVE_BOXES.includes(box))
      )
        throw new Error(
          "The proposal contains an invalid source assignment. Use manual review.",
        );
      seen.add(row.unit_id);
      return { unit_id: row.unit_id, boxes: [...row.boxes] };
    })
    .sort((a, b) => a.unit_id - b.unit_id);
  const boxes = Object.fromEntries(
    NARRATIVE_BOXES.map((box) => [
      box,
      assignments
        .filter((row) => row.boxes.includes(box))
        .map((row) => units[row.unit_id]!.text)
        .join(""),
    ]),
  ) as Record<NarrativeBox, string>;
  return {
    version: "source-sentences.v1",
    units,
    assignments,
    boxes,
    unresolved_unit_ids: assignments
      .filter((row) => !row.boxes.length)
      .map((row) => row.unit_id),
  };
}
