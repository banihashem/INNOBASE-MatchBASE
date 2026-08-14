import { Buffer } from "node:buffer";
import type { ProtectedSpanV1 } from "@matchbase/contracts";

const persistableToken =
  /\b(?:[A-Z]{2,}(?:-[A-Z0-9]+)*|[A-Z]{1,4}\d[A-Z0-9-]*|\d+(?:\.\d+)?\s?(?:kg|g|cm|mm|m|units?|USD|EUR))\b/gu;

function category(value: string): ProtectedSpanV1["category"] {
  if (/^\d/u.test(value)) return "quantity_unit";
  if (/^[A-Z]{1,4}\d/u.test(value)) return "model";
  if (/^[A-Z]{2,}(?:-[A-Z0-9]+)*$/u.test(value)) return "code_enum";
  return "identifier";
}

export function extractPersistableProtectedSpans(
  sourceText: string,
): ProtectedSpanV1[] {
  return [...sourceText.matchAll(persistableToken)].map((match, index) => {
    const canonicalValue = match[0];
    return {
      placeholder: `PS-${String(index + 1).padStart(4, "0")}`,
      category: category(canonicalValue),
      canonicalValue,
      sourceByteLength: Buffer.byteLength(canonicalValue, "utf8"),
    };
  });
}

export function validateProtectedSpans(
  canonicalText: string,
  spans: readonly ProtectedSpanV1[],
): void {
  for (const span of spans) {
    const occurrences = canonicalText.split(span.canonicalValue).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `Protected span ${span.placeholder} must occur exactly once in canonical text.`,
      );
    }
  }
}
