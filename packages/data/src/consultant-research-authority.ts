import { createHash } from "node:crypto";

export type ResearchAuthoritySource = {
  approved_request_revision: unknown;
  deep_prompt_revision: unknown;
  search_dimension_plan?: unknown;
};
const version = "research-authority.v2:";
function digest(serialized: string) {
  return createHash("sha256").update(serialized).digest("hex");
}

/** MB-UX-QUALITY-002 L06: JSONB object order is not an authority change; array order is. */
export function researchAuthorityHash(source: ResearchAuthoritySource): string {
  return (
    version +
    digest(
      JSON.stringify(
        [
          source.approved_request_revision,
          source.deep_prompt_revision,
          source.search_dimension_plan ?? null,
        ],
        (_key, value: unknown) =>
          value && typeof value === "object" && !Array.isArray(value)
            ? Object.fromEntries(
                Object.entries(value).sort(([left], [right]) =>
                  left < right ? -1 : left > right ? 1 : 0,
                ),
              )
            : value,
      ),
    )
  );
}

/** Verify retained authority without rewriting historical plans or dropping current dimensions. */
export function matchesResearchAuthorityHash(
  hash: string,
  source: ResearchAuthoritySource,
): boolean {
  if (typeof hash !== "string") return false;
  if (hash.startsWith(version)) return hash === researchAuthorityHash(source);
  if (!/^[a-f0-9]{64}$/.test(hash)) return false;
  // Historical quotes used JSON.stringify on the restored database projection.
  // Never try the pre-dimensions two-field format when approved dimensions exist.
  return (
    hash ===
    digest(
      JSON.stringify([
        source.approved_request_revision,
        source.deep_prompt_revision,
        ...(source.search_dimension_plan !== undefined &&
        source.search_dimension_plan !== null
          ? [source.search_dimension_plan]
          : []),
      ]),
    )
  );
}
