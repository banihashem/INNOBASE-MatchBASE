/** PostgreSQL jsonb cannot represent NUL or unpaired surrogates. Omit unsafe audit strings, never alter them into new evidence. */
export function serializeWorkflowEventDetail(
  detail: Record<string, unknown>,
): string {
  let omitted = 0;
  const invalid = (text: string) =>
    text.includes("\0") ||
    /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(
      text,
    );
  const copy = (value: unknown): unknown => {
    if (typeof value === "string" && invalid(value)) {
      omitted++;
      return null;
    }
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).flatMap(([key, child]) => {
          if (invalid(key)) {
            omitted++;
            return [];
          }
          return [[key, copy(child)]];
        }),
      );
    return value;
  };
  const safe = copy(detail) as Record<string, unknown>;
  if (omitted)
    safe.storage_content_safety = {
      omitted_unsafe_strings: omitted,
      reason:
        "NUL or unpaired Unicode surrogate; omitted content is not usable evidence",
    };
  return JSON.stringify(safe);
}
