import type {
  StandardDimensionId,
  StandardDimensionScoreV1,
  StandardFitBand,
} from "@matchbase/contracts";
import { STANDARD_DIMENSIONS } from "@matchbase/contracts";

const BAND_ORDER: Readonly<Record<StandardFitBand, number>> = {
  low_fit: 0,
  potential_fit: 1,
  strong_fit: 2,
};

export interface StandardScoreResult {
  compatibilityScore: number;
  fitBand: StandardFitBand;
  bandCeiling: StandardFitBand;
  displayedBand: StandardFitBand;
  capReason?: string;
  drivers: StandardScoreExplanation[];
  gaps: StandardScoreExplanation[];
}

export interface StandardScoreExplanation {
  dimensionId: StandardDimensionId;
  explanation: string;
}

export function weightedScoreNumerator(
  ratings: readonly number[],
  weights: readonly number[],
): number {
  if (
    ratings.length !== weights.length ||
    ratings.length === 0 ||
    ratings.some(
      (rating) => !Number.isInteger(rating) || rating < 0 || rating > 100,
    ) ||
    weights.some((weight) => !Number.isInteger(weight) || weight < 0) ||
    weights.reduce((total, weight) => total + weight, 0) !== 100
  )
    throw new Error(
      "Weighted scoring requires equally sized integer ratings and non-negative integer weights totaling 100.",
    );
  return ratings.reduce(
    (total, rating, index) => total + rating * (weights[index] ?? 0),
    0,
  );
}

export function assertStandardDimensions(
  dimensions: readonly StandardDimensionScoreV1[],
): asserts dimensions is [
  StandardDimensionScoreV1,
  StandardDimensionScoreV1,
  StandardDimensionScoreV1,
  StandardDimensionScoreV1,
  StandardDimensionScoreV1,
  StandardDimensionScoreV1,
] {
  if (dimensions.length !== STANDARD_DIMENSIONS.length) {
    throw new Error("A Standard candidate requires exactly six dimensions.");
  }
  STANDARD_DIMENSIONS.forEach((expected, index) => {
    const actual = dimensions[index];
    if (
      !actual ||
      actual.dimension_id !== expected.dimension_id ||
      actual.weight !== expected.weight ||
      !Number.isInteger(actual.score) ||
      actual.score < 0 ||
      actual.score > 100
    ) {
      throw new Error(
        `Standard dimension ${expected.dimension_id} violates order, weight, or integer score bounds.`,
      );
    }
  });
}

export function bandFromScore(score: number): StandardFitBand {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error(
      "Compatibility score must be an integer from 0 through 100.",
    );
  }
  if (score >= 76) return "strong_fit";
  if (score >= 46) return "potential_fit";
  return "low_fit";
}

function minimumBand(
  left: StandardFitBand,
  right: StandardFitBand,
): StandardFitBand {
  return BAND_ORDER[left] <= BAND_ORDER[right] ? left : right;
}

function explanation(
  dimensionId: StandardDimensionId,
  score: number,
  kind: "driver" | "gap",
): StandardScoreExplanation {
  return {
    dimensionId,
    explanation:
      kind === "driver"
        ? `${dimensionId} contributes positively with a deterministic score of ${score}.`
        : `${dimensionId} remains a material limitation with a deterministic score of ${score}.`,
  };
}

export function scoreStandardCandidate(
  dimensions: readonly StandardDimensionScoreV1[],
): StandardScoreResult {
  assertStandardDimensions(dimensions);
  const weightedTotal = weightedScoreNumerator(
    dimensions.map(({ score }) => score),
    dimensions.map(({ weight }) => weight),
  );
  const compatibilityScore = Math.floor((weightedTotal + 50) / 100);
  const fitBand = bandFromScore(compatibilityScore);
  const lowCritical = dimensions.filter((dimension, index) => {
    const definition = STANDARD_DIMENSIONS[index];
    return definition?.critical === true && dimension.score <= 45;
  });
  const bandCeiling: StandardFitBand =
    lowCritical.length >= 2 ? "potential_fit" : "strong_fit";
  const displayedBand = minimumBand(fitBand, bandCeiling);
  const capReason =
    lowCritical.length >= 2
      ? `Band capped at potential_fit because ${lowCritical.length} critical dimensions are low_fit.`
      : undefined;

  const drivers = dimensions
    .map((dimension, index) => ({
      dimension,
      contribution: dimension.weight * (dimension.score - 50),
      index,
    }))
    .filter((item) => item.contribution > 0)
    .sort(
      (left, right) =>
        right.contribution - left.contribution || left.index - right.index,
    )
    .slice(0, 3)
    .map((item) =>
      explanation(item.dimension.dimension_id, item.dimension.score, "driver"),
    );

  const bindingIds = new Set(
    lowCritical.map((dimension) => dimension.dimension_id),
  );
  const gaps = dimensions
    .map((dimension, index) => ({
      dimension,
      binding: bindingIds.has(dimension.dimension_id) ? 1 : 0,
      shortfall: dimension.weight * (100 - dimension.score),
      index,
    }))
    .filter((item) => item.dimension.score < 100)
    .sort(
      (left, right) =>
        right.binding - left.binding ||
        right.shortfall - left.shortfall ||
        left.index - right.index,
    )
    .slice(0, 3)
    .map((item) =>
      explanation(item.dimension.dimension_id, item.dimension.score, "gap"),
    );

  return {
    compatibilityScore,
    fitBand,
    bandCeiling,
    displayedBand,
    ...(capReason === undefined ? {} : { capReason }),
    drivers,
    gaps,
  };
}
