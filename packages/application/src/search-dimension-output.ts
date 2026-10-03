import {
  projectSearchDimensionOutput,
  type ConsultantResearchOutputV3,
  type SearchDimensionOutputFields,
  type SearchDimensionPlan,
} from "@matchbase/contracts";

/** MB-SEARCH-DIMENSIONS-002 L01: retain source-bound coverage without changing legacy ranks. */
export function buildSearchDimensionOutput(
  plan: SearchDimensionPlan,
  output: ConsultantResearchOutputV3,
): SearchDimensionOutputFields {
  return projectSearchDimensionOutput(plan, output);
}
