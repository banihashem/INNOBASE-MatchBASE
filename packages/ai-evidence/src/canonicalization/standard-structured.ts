import {
  extractPersistableProtectedSpans,
  validateProtectedSpans,
} from "./protected-spans.js";

export type StandardStructuredTextKind =
  | "field_value"
  | "constraint_comparand"
  | "exclusion"
  | "condition"
  | "required_result";

export type StandardStructuredSourceLanguage = "en" | "fa" | "ar" | "es";

export interface StandardStructuredCanonicalizationInput {
  kind: StandardStructuredTextKind;
  source_language: StandardStructuredSourceLanguage;
  value: string;
}

export interface StandardStructuredCanonicalizationResult {
  canonical_english: string;
  translated: boolean;
  confidence: number;
  confidence_marker: "high" | "low";
  protected_tokens: string[];
}

interface FixtureEntry {
  kind: StandardStructuredTextKind;
  language: StandardStructuredSourceLanguage;
  source: string;
  canonicalEnglish: string;
  confidence: number;
}

const FIXTURES: readonly FixtureEntry[] = [
  {
    kind: "field_value",
    language: "en",
    source: "Industrial component model MX900",
    canonicalEnglish: "Industrial component model MX900",
    confidence: 1,
  },
  {
    kind: "field_value",
    language: "fa",
    source: "قطعه صنعتی مدل MX900",
    canonicalEnglish: "Industrial component model MX900",
    confidence: 0.99,
  },
  {
    kind: "field_value",
    language: "ar",
    source: "مكوّن صناعي طراز MX900",
    canonicalEnglish: "Industrial component model MX900",
    confidence: 0.99,
  },
  {
    kind: "field_value",
    language: "es",
    source: "Componente industrial modelo MX900",
    canonicalEnglish: "Industrial component model MX900",
    confidence: 0.74,
  },
  {
    kind: "constraint_comparand",
    language: "en",
    source: "At least 45 kg",
    canonicalEnglish: "At least 45 kg",
    confidence: 1,
  },
  {
    kind: "constraint_comparand",
    language: "fa",
    source: "حداقل 45 kg",
    canonicalEnglish: "At least 45 kg",
    confidence: 0.99,
  },
  {
    kind: "constraint_comparand",
    language: "ar",
    source: "ما لا يقل عن 45 kg",
    canonicalEnglish: "At least 45 kg",
    confidence: 0.99,
  },
  {
    kind: "constraint_comparand",
    language: "es",
    source: "Al menos 45 kg",
    canonicalEnglish: "At least 45 kg",
    confidence: 0.98,
  },
  {
    kind: "exclusion",
    language: "en",
    source: "Exclude code HS-CODE",
    canonicalEnglish: "Exclude code HS-CODE",
    confidence: 1,
  },
  {
    kind: "exclusion",
    language: "fa",
    source: "کد HS-CODE حذف شود",
    canonicalEnglish: "Exclude code HS-CODE",
    confidence: 0.99,
  },
  {
    kind: "exclusion",
    language: "ar",
    source: "استبعاد الرمز HS-CODE",
    canonicalEnglish: "Exclude code HS-CODE",
    confidence: 0.99,
  },
  {
    kind: "exclusion",
    language: "es",
    source: "Excluir el código HS-CODE",
    canonicalEnglish: "Exclude code HS-CODE",
    confidence: 0.98,
  },
  {
    kind: "condition",
    language: "en",
    source: "If model MX900 is selected",
    canonicalEnglish: "If model MX900 is selected",
    confidence: 1,
  },
  {
    kind: "condition",
    language: "fa",
    source: "اگر مدل MX900 انتخاب شود",
    canonicalEnglish: "If model MX900 is selected",
    confidence: 0.97,
  },
  {
    kind: "condition",
    language: "ar",
    source: "إذا تم اختيار الطراز MX900",
    canonicalEnglish: "If model MX900 is selected",
    confidence: 0.97,
  },
  {
    kind: "condition",
    language: "es",
    source: "Si se selecciona el modelo MX900",
    canonicalEnglish: "If model MX900 is selected",
    confidence: 0.74,
  },
  {
    kind: "required_result",
    language: "en",
    source: "Certification code ISO-9001 is required",
    canonicalEnglish: "Certification code ISO-9001 is required",
    confidence: 1,
  },
  {
    kind: "required_result",
    language: "fa",
    source: "گواهی با کد ISO-9001 الزامی است",
    canonicalEnglish: "Certification code ISO-9001 is required",
    confidence: 0.98,
  },
  {
    kind: "required_result",
    language: "ar",
    source: "شهادة الرمز ISO-9001 مطلوبة",
    canonicalEnglish: "Certification code ISO-9001 is required",
    confidence: 0.98,
  },
  {
    kind: "required_result",
    language: "es",
    source: "Se requiere la certificación ISO-9001",
    canonicalEnglish: "Certification code ISO-9001 is required",
    confidence: 0.97,
  },
] as const;

function normalized(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function validateFormalEnglish(value: string): void {
  if (
    !value ||
    !/[A-Za-z]/u.test(value) ||
    /\p{Script=Arabic}/u.test(value) ||
    /[áéíóúñü¿¡]/iu.test(value)
  ) {
    throw new Error(
      "Structured canonicalization produced non-English residue.",
    );
  }
}

export function canonicalizeStandardStructuredText(
  input: StandardStructuredCanonicalizationInput,
): StandardStructuredCanonicalizationResult {
  const source = normalized(input.value);
  const fixture = FIXTURES.find(
    (entry) =>
      entry.kind === input.kind &&
      entry.language === input.source_language &&
      normalized(entry.source) === source,
  );
  if (!fixture && input.source_language !== "en") {
    throw new Error("Unsupported structured canonicalization fixture.");
  }
  const canonicalEnglish = normalized(fixture?.canonicalEnglish ?? source);
  validateFormalEnglish(canonicalEnglish);
  const protectedSpans = extractPersistableProtectedSpans(source);
  validateProtectedSpans(canonicalEnglish, protectedSpans);
  const confidence = fixture?.confidence ?? 1;
  return {
    canonical_english: canonicalEnglish,
    translated: fixture ? input.source_language !== "en" : false,
    confidence,
    confidence_marker: confidence < 0.8 ? "low" : "high",
    protected_tokens: protectedSpans.map((span) => span.canonicalValue),
  };
}

export function canonicalizeStandardFieldValue(
  value: string,
  sourceLanguage: StandardStructuredSourceLanguage,
): StandardStructuredCanonicalizationResult {
  return canonicalizeStandardStructuredText({
    kind: "field_value",
    source_language: sourceLanguage,
    value,
  });
}

export function canonicalizeStandardConstraintComparand(
  value: string,
  sourceLanguage: StandardStructuredSourceLanguage,
): StandardStructuredCanonicalizationResult {
  return canonicalizeStandardStructuredText({
    kind: "constraint_comparand",
    source_language: sourceLanguage,
    value,
  });
}

export function canonicalizeStandardExclusion(
  value: string,
  sourceLanguage: StandardStructuredSourceLanguage,
): StandardStructuredCanonicalizationResult {
  return canonicalizeStandardStructuredText({
    kind: "exclusion",
    source_language: sourceLanguage,
    value,
  });
}

export function canonicalizeStandardCondition(
  value: string,
  sourceLanguage: StandardStructuredSourceLanguage,
): StandardStructuredCanonicalizationResult {
  return canonicalizeStandardStructuredText({
    kind: "condition",
    source_language: sourceLanguage,
    value,
  });
}

export function canonicalizeStandardRequiredResult(
  value: string,
  sourceLanguage: StandardStructuredSourceLanguage,
): StandardStructuredCanonicalizationResult {
  return canonicalizeStandardStructuredText({
    kind: "required_result",
    source_language: sourceLanguage,
    value,
  });
}
