/** MB-UX-QUALITY-002 L08: independent paths, never a grant of dispatch authority. */
export function requiredResearchDiscoveryPaths(
  models: readonly string[],
): number {
  const families = models.map((model) => model.split("/")[0]);
  if (
    models.some((model) => !/^[a-z0-9-]+\/[^\s/]+$/u.test(model)) ||
    new Set(models).size !== models.length ||
    new Set(families).size !== models.length
  )
    return Infinity;
  // Default, Advanced and Ultra retain two, two and three independent paths.
  // Unknown/custom rosters must complete every path; never infer a weaker tier.
  return models.length === 5
    ? 3
    : models.length === 3
      ? 2
      : Math.max(2, models.length);
}

export function researchDiscoveryPhase(model: string): string {
  const family = model.split("/")[0];
  return `discovery_${family === "google" ? "gemini" : family === "x-ai" ? "xai" : family}`;
}
