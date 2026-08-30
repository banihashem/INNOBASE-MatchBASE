import { createHash } from "node:crypto";

export const DIRECTIONAL_SCORE_STATEMENT =
  "Scores are directional and designed for shortlisting. They do not replace formal RFQ, factory documentation review, legal import checks, or live availability confirmation." as const;

export const ADVISORY_BOUNDARY =
  "MatchBASE is a Decision Advisory System. Final decisions remain under explicit human authority. MatchBASE performs no contractual action or binding commitment." as const;

export const RESTRICTED_PARTY_NOTICE =
  "Restricted-party screening was not performed." as const;

export type FitBand = "low_fit" | "potential_fit" | "strong_fit";

export interface RenderedBandOccurrence {
  readonly occurrence_id: string;
  readonly score: number;
  readonly band_ceiling: FitBand;
  readonly displayed_band: FitBand;
}

export interface P4ReportQualificationFixture {
  readonly fixture_id: "GF-PDF-013" | "GF-PDF-019a" | "GF-PDF-019b";
  readonly supplier_name: string;
  readonly role_description: string;
  readonly bands: readonly RenderedBandOccurrence[];
  readonly zero_eligible: boolean;
  readonly negative_result?: ZeroEligibleReportRecord;
}

export interface ZeroEligibleReportRecord {
  readonly search_performed: {
    readonly search_id: string;
    readonly scope: string;
    readonly source_ids: readonly string[];
  };
  readonly candidates_considered: readonly {
    readonly candidate_id: string;
    readonly exclusion_reason: string;
  }[];
  readonly relaxation_options: readonly {
    readonly option_id: string;
    readonly description: string;
    readonly preserves_hard_gates: true;
  }[];
}

const bandRank: Readonly<Record<FitBand, number>> = Object.freeze({
  low_fit: 0,
  potential_fit: 1,
  strong_fit: 2,
});

export function bandFromScore(score: number): FitBand {
  if (!Number.isInteger(score) || score < 0 || score > 100)
    throw new RangeError(
      "Compatibility score must be an integer from 0 to 100.",
    );
  if (score >= 76) return "strong_fit";
  if (score >= 46) return "potential_fit";
  return "low_fit";
}

export function renderBand(score: number, bandCeiling: FitBand): FitBand {
  const scoreBand = bandFromScore(score);
  return bandRank[scoreBand] <= bandRank[bandCeiling] ? scoreBand : bandCeiling;
}

export function assertRenderedBands(
  occurrences: readonly RenderedBandOccurrence[],
): void {
  if (occurrences.length === 0)
    throw new Error("At least one rendered band occurrence is required.");
  const ids = new Set<string>();
  for (const occurrence of occurrences) {
    if (!occurrence.occurrence_id.trim() || ids.has(occurrence.occurrence_id))
      throw new Error(
        "Rendered band occurrence identity is empty or duplicated.",
      );
    ids.add(occurrence.occurrence_id);
    const expected = renderBand(occurrence.score, occurrence.band_ceiling);
    if (occurrence.displayed_band !== expected)
      throw new Error(
        `GF-PDF-013 mismatch at ${occurrence.occurrence_id}: expected ${expected}, received ${occurrence.displayed_band}.`,
      );
  }
}

export function p4QualificationFixtures(): readonly P4ReportQualificationFixture[] {
  const boundaryBands = [
    [45, "low_fit"],
    [46, "potential_fit"],
    [75, "potential_fit"],
    [76, "strong_fit"],
    [77, "strong_fit"],
    [100, "strong_fit"],
  ] as const;
  const bands: RenderedBandOccurrence[] = boundaryBands.map(
    ([score, displayedBand]) => ({
      occurrence_id: `boundary-${score}`,
      score,
      band_ceiling: "strong_fit",
      displayed_band: displayedBand,
    }),
  );
  bands.push({
    occurrence_id: "uncertainty-cap-score-78",
    score: 78,
    band_ceiling: "potential_fit",
    displayed_band: "potential_fit",
  });
  const longSupplier =
    "Gulf Advanced Industrial Processing Equipment Manufacturing and International Distribution Company Limited";
  const longRole =
    "Manufacturer, systems integrator, installation supervisor, commissioning partner, spare-parts custodian, training provider, and documented after-sales service coordinator";
  return Object.freeze([
    Object.freeze({
      fixture_id: "GF-PDF-013" as const,
      supplier_name: "Synthetic Boundary Supplier",
      role_description: "Synthetic deterministic band-boundary qualification",
      bands: Object.freeze(bands.map((item) => Object.freeze({ ...item }))),
      zero_eligible: false,
    }),
    Object.freeze({
      fixture_id: "GF-PDF-019a" as const,
      supplier_name: longSupplier,
      role_description: "Primary synthetic supplier-role fixture",
      bands: Object.freeze([
        Object.freeze({
          occurrence_id: "long-supplier-band",
          score: 77,
          band_ceiling: "strong_fit" as const,
          displayed_band: "strong_fit" as const,
        }),
      ]),
      zero_eligible: false,
    }),
    Object.freeze({
      fixture_id: "GF-PDF-019b" as const,
      supplier_name: "Synthetic Zero-Eligible Search Record",
      role_description: longRole,
      bands: Object.freeze([
        Object.freeze({
          occurrence_id: "long-role-band",
          score: 45,
          band_ceiling: "low_fit" as const,
          displayed_band: "low_fit" as const,
        }),
      ]),
      zero_eligible: true,
      negative_result: Object.freeze({
        search_performed: Object.freeze({
          search_id: "synthetic-search-zero-eligible-001",
          scope:
            "Synthetic industrial supplier search across the configured official-register and primary-source route set",
          source_ids: Object.freeze([
            "synthetic-official-register-001",
            "synthetic-primary-source-001",
          ]),
        }),
        candidates_considered: Object.freeze([
          Object.freeze({
            candidate_id: "synthetic-candidate-001",
            exclusion_reason:
              "Excluded because the mandatory product-scope gate was not evidenced.",
          }),
          Object.freeze({
            candidate_id: "synthetic-candidate-002",
            exclusion_reason:
              "Excluded because the destination-service capability was contradicted by current evidence.",
          }),
          Object.freeze({
            candidate_id: "synthetic-candidate-003",
            exclusion_reason:
              "Excluded because the required authoritative-registry identity could not be established.",
          }),
        ]),
        relaxation_options: Object.freeze([
          Object.freeze({
            option_id: "relax-commercial-preference",
            description:
              "Widen the non-mandatory commercial-preference range while preserving every hard gate.",
            preserves_hard_gates: true as const,
          }),
          Object.freeze({
            option_id: "expand-geography",
            description:
              "Expand the permitted sourcing geography while preserving product, regulatory, and evidence gates.",
            preserves_hard_gates: true as const,
          }),
        ]),
      }),
    }),
  ]);
}

export function assertStructuredZeroEligibleFixture(
  fixture: P4ReportQualificationFixture,
): asserts fixture is P4ReportQualificationFixture & {
  readonly zero_eligible: true;
  readonly negative_result: ZeroEligibleReportRecord;
} {
  if (!fixture.zero_eligible || fixture.negative_result === undefined)
    throw new Error(
      "A zero-eligible report requires structured negative-result detail.",
    );
  const detail = fixture.negative_result;
  if (
    !detail.search_performed.search_id.trim() ||
    !detail.search_performed.scope.trim() ||
    detail.search_performed.source_ids.length === 0
  )
    throw new Error(
      "The zero-eligible report must document the search performed.",
    );
  if (
    detail.candidates_considered.length === 0 ||
    detail.candidates_considered.some(
      ({ candidate_id, exclusion_reason }) =>
        !candidate_id.trim() || !exclusion_reason.trim(),
    )
  )
    throw new Error(
      "The zero-eligible report must record every considered candidate and exclusion reason.",
    );
  if (
    detail.relaxation_options.length === 0 ||
    detail.relaxation_options.some(
      ({ option_id, description, preserves_hard_gates }) =>
        !option_id.trim() || !description.trim() || !preserves_hard_gates,
    )
  )
    throw new Error(
      "The zero-eligible report must provide relaxation options that preserve hard gates.",
    );
}

export function fixtureSetSha256(
  fixtures: readonly P4ReportQualificationFixture[],
): string {
  return createHash("sha256")
    .update(JSON.stringify(fixtures), "utf8")
    .digest("hex");
}

export function fitBandLabel(band: FitBand): string {
  return {
    low_fit: "Low Fit",
    potential_fit: "Potential Fit",
    strong_fit: "Strong Fit",
  }[band];
}
