export interface SanitizedResearchEvidence {
  readonly sourceId: string;
  readonly canonicalUrl: string;
  readonly contentSha256: string;
  readonly excerpt: string;
}

export interface QualifiedResearchRequest {
  readonly canonicalLanguage: "en";
  readonly canonicalEnglishRequest: string;
  readonly sanitizedEvidence: readonly SanitizedResearchEvidence[];
  readonly outputSchema: Readonly<Record<string, unknown>>;
}

const REQUEST_FIELDS = new Set([
  "canonicalLanguage",
  "canonicalEnglishRequest",
  "sanitizedEvidence",
  "outputSchema",
]);
const EVIDENCE_FIELDS = new Set([
  "sourceId",
  "canonicalUrl",
  "contentSha256",
  "excerpt",
]);
const NON_ENGLISH_SCRIPT =
  /\p{Script=Arabic}|\p{Script=Cyrillic}|\p{Script=Han}|\p{Script=Hebrew}/u;

function closedObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a closed object.`);
  }
  return value as Record<string, unknown>;
}

function assertFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    throw new Error(
      `${label} contains unsupported fields: ${unknown.join(", ")}.`,
    );
  }
}

function canonicalText(value: unknown, label: string, maximum: number): string {
  const hasControl =
    typeof value === "string" &&
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    });
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maximum ||
    value !== value.normalize("NFC") ||
    value !== value.replace(/\s+/gu, " ").trim() ||
    hasControl
  ) {
    throw new Error(`${label} must be bounded canonical text.`);
  }
  return value;
}

export function validateQualifiedResearchRequest(
  value: unknown,
): QualifiedResearchRequest {
  const request = closedObject(value, "qualified research request");
  assertFields(request, REQUEST_FIELDS, "qualified research request");
  if (request.canonicalLanguage !== "en") {
    throw new Error("Qualified research requires canonical English input.");
  }
  const canonicalEnglishRequest = canonicalText(
    request.canonicalEnglishRequest,
    "canonicalEnglishRequest",
    12_000,
  );
  if (
    !/[A-Za-z]/u.test(canonicalEnglishRequest) ||
    NON_ENGLISH_SCRIPT.test(canonicalEnglishRequest)
  ) {
    throw new Error("Qualified research requires canonical English input.");
  }
  if (!Array.isArray(request.sanitizedEvidence)) {
    throw new Error("sanitizedEvidence must be an array.");
  }
  for (const [index, candidate] of request.sanitizedEvidence.entries()) {
    const evidence = closedObject(candidate, `sanitizedEvidence[${index}]`);
    assertFields(evidence, EVIDENCE_FIELDS, `sanitizedEvidence[${index}]`);
    canonicalText(
      evidence.sourceId,
      `sanitizedEvidence[${index}].sourceId`,
      256,
    );
    const canonicalUrl = canonicalText(
      evidence.canonicalUrl,
      `sanitizedEvidence[${index}].canonicalUrl`,
      2048,
    );
    let url: URL;
    try {
      url = new URL(canonicalUrl);
    } catch {
      throw new Error(`sanitizedEvidence[${index}].canonicalUrl is invalid.`);
    }
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.href !== canonicalUrl
    ) {
      throw new Error(
        `sanitizedEvidence[${index}].canonicalUrl must be canonical HTTPS.`,
      );
    }
    if (
      typeof evidence.contentSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(evidence.contentSha256)
    ) {
      throw new Error(`sanitizedEvidence[${index}].contentSha256 is invalid.`);
    }
    canonicalText(
      evidence.excerpt,
      `sanitizedEvidence[${index}].excerpt`,
      4000,
    );
  }
  const outputSchema = closedObject(request.outputSchema, "outputSchema");
  return {
    canonicalLanguage: "en",
    canonicalEnglishRequest,
    sanitizedEvidence:
      request.sanitizedEvidence as readonly SanitizedResearchEvidence[],
    outputSchema,
  };
}

export function serializeSanitizedEvidence(
  evidence: readonly SanitizedResearchEvidence[],
): string {
  return JSON.stringify({
    kind: "untrusted_sanitized_evidence",
    documents: evidence,
  });
}
