import type { JsonSchema } from "./openrouter-model-policy.js";

/** L12: keep the focus grammar small; enforce every business limit locally. */
export function researchFocusWireSchema(
  schema: JsonSchema,
  model: string,
): JsonSchema {
  if (!model.startsWith("google/gemini-")) return schema;
  const project = (node: JsonSchema): JsonSchema => {
    const result: Record<string, unknown> = {};
    // Gemini supports a subset of JSON Schema and rejects some complex grammars.
    // Keep shape and enums; lengths, patterns and nested array limits remain in
    // the full prompt and local validator, never in the provider grammar.
    for (const key of ["type", "enum", "required", "additionalProperties"])
      if (Object.hasOwn(node, key)) result[key] = node[key];
    if (node.properties && typeof node.properties === "object")
      result.properties = Object.fromEntries(
        Object.entries(node.properties).map(([key, value]) => [
          key,
          project(value as JsonSchema),
        ]),
      );
    if (node.items && typeof node.items === "object")
      result.items = project(node.items as JsonSchema);
    return result;
  };
  return project(schema);
}
