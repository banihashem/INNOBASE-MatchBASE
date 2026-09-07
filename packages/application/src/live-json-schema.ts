import {
  LiveResearchError,
  type JsonSchema,
} from "./openrouter-model-policy.js";
export const stringSchema = { type: "string" } as const;
export const stringListSchema = { type: "array", items: stringSchema } as const;
export const nullableStringSchema = { type: ["string", "null"] } as const;
export function objectSchema(properties: Record<string, unknown>): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
function matchesType(value: unknown, type: unknown): boolean {
  if (Array.isArray(type))
    return type.some((entry) => matchesType(value, entry));
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object")
    return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer")
    return typeof value === "number" && Number.isInteger(value);
  if (type === "number")
    return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}
export function validateJsonSchema(
  value: unknown,
  schema: JsonSchema,
  path = "response",
): void {
  const fail = () => {
    throw new LiveResearchError(
      "MB-422-LIVE-SCHEMA",
      `Structured response failed validation at ${path}.`,
    );
  };
  if (schema.type && !matchesType(value, schema.type)) fail();
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) fail();
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) fail();
    if (typeof schema.maximum === "number" && value > schema.maximum) fail();
  }
  if (
    typeof value === "string" &&
    typeof schema.minLength === "number" &&
    value.length < schema.minLength
  )
    fail();
  if (Array.isArray(value)) {
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      fail();
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      fail();
    if (schema.items && typeof schema.items === "object")
      value.forEach((entry, index) =>
        validateJsonSchema(
          entry,
          schema.items as JsonSchema,
          `${path}[${index}]`,
        ),
      );
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const properties = schema.properties as
      Record<string, JsonSchema> | undefined;
    if (
      Array.isArray(schema.required) &&
      schema.required.some((key) => typeof key !== "string" || !(key in record))
    )
      fail();
    for (const [key, child] of Object.entries(record)) {
      if (properties?.[key])
        validateJsonSchema(child, properties[key], `${path}.${key}`);
      else if (schema.additionalProperties === false) fail();
    }
  }
}
export function parseLiveJson<T>(text: string, schema: JsonSchema): T {
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch {
    // Native-search providers can wrap an otherwise valid object in a Markdown
    // fence or append citation markers. Extract one balanced object; validate it
    // against the exact schema below. No prose or partial fields are inferred.
    const start = text.indexOf("{");
    let depth = 0;
    let quoted = false;
    let escaped = false;
    let end = -1;
    for (let index = start; start >= 0 && index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === "{") depth++;
      else if (character === "}" && --depth === 0) {
        end = index + 1;
        break;
      }
    }
    if (start < 0 || end < 0)
      throw new LiveResearchError(
        "MB-422-LIVE-SCHEMA",
        "Provider did not return a complete JSON object.",
      );
    try {
      value = JSON.parse(text.slice(start, end));
    } catch {
      throw new LiveResearchError(
        "MB-422-LIVE-SCHEMA",
        "Provider returned malformed structured JSON.",
      );
    }
  }
  validateJsonSchema(value, schema);
  return value as T;
}
