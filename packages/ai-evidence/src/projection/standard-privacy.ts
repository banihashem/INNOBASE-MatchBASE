import type { StandardEvidenceGraphV1 } from "@matchbase/contracts";
import { standardContentSha256 } from "../evidence/standard.js";

export const STANDARD_PII_RELEASE_POLICY_VERSION =
  "standard-pii-release.v1" as const;

export interface StandardPiiSecurityEvent {
  event_type: "standard.pii_withheld" | "standard.pii_release_denied";
  policy_version: typeof STANDARD_PII_RELEASE_POLICY_VERSION;
  field_path: string;
  action: "redacted" | "denied";
  finding_count: number;
}

interface Span {
  start: number;
  end: number;
}

const GIVEN_NAMES = new Set([
  "ahmad",
  "ali",
  "claude",
  "ehsan",
  "jane",
  "jean",
  "john",
  "mary",
  "mohammad",
  "muhammad",
  "samir",
  "احمد",
  "علي",
  "رضا",
  "محمد",
  "سمير",
]);
const FAMILY_NAMES = new Set([
  "damme",
  "haddad",
  "hashem",
  "public",
  "smith",
  "neil",
  "حسيني",
  "رضايي",
  "حداد",
]);
const NAME_PARTICLES = new Set(["al", "bin", "da", "de", "del", "van", "von"]);
const NAME_TITLES = new Set(["dr", "mr", "mrs", "ms", "prof", "دكتر", "السيد"]);
const ORGANIZATION_WORDS = new Set([
  "ac",
  "agriculture",
  "agricultural",
  "alvest",
  "arp",
  "atm",
  "aviation",
  "axa",
  "bpa",
  "bps",
  "cavotec",
  "ce",
  "co",
  "coa",
  "company",
  "components",
  "cooperative",
  "corp",
  "corporation",
  "corpus",
  "dc",
  "dgac",
  "engineering",
  "equipment",
  "evidence",
  "export",
  "exporter",
  "exporters",
  "exports",
  "fat",
  "fcr",
  "feed",
  "fixture",
  "foods",
  "gcc",
  "generator",
  "generators",
  "glass",
  "global",
  "gmbh",
  "gmp",
  "gpu",
  "gpus",
  "group",
  "gse",
  "gsm",
  "haccp",
  "hitzinger",
  "hobart",
  "hz",
  "iata",
  "industries",
  "international",
  "iso",
  "itw",
  "limited",
  "llc",
  "ltd",
  "machinery",
  "manufacturer",
  "manufacturing",
  "marine",
  "matchbase",
  "middle",
  "mill",
  "mills",
  "moq",
  "nuts",
  "oem",
  "paper",
  "pistachio",
  "pistachios",
  "pos",
  "power",
  "processing",
  "producer",
  "producers",
  "products",
  "qa",
  "qc",
  "reach",
  "repository",
  "sae",
  "sgs",
  "sku",
  "sla",
  "slas",
  "solutions",
  "standard",
  "supplier",
  "suppliers",
  "synthetic",
  "systems",
  "technologies",
  "technology",
  "thd",
  "trading",
  "tuv",
  "v",
  "vac",
]);
const CONFUSABLES: Readonly<Record<string, string>> = {
  Α: "A",
  Β: "B",
  Ε: "E",
  Η: "H",
  Ι: "I",
  Κ: "K",
  Μ: "M",
  Ν: "N",
  Ο: "O",
  Ρ: "P",
  Τ: "T",
  Χ: "X",
  α: "a",
  ε: "e",
  ι: "i",
  ο: "o",
  ρ: "p",
  χ: "x",
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  Х: "X",
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  х: "x",
};

function skeleton(value: string): string {
  return [...value]
    .map((character) => CONFUSABLES[character] ?? character)
    .join("")
    .normalize("NFKC");
}

interface ComparableText {
  value: string;
  sourceOffsets: Array<{ start: number; end: number }>;
  ambiguous: boolean;
}

const FORMAT_CONTROL = /\p{Cf}/u;
const FORMAT_CONTROLS = /\p{Cf}/gu;
const AMBIGUOUS_INVISIBLE_MARK = /[\u034F\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;
const LETTER = /\p{L}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;
const ARABIC_LETTER = /\p{Script=Arabic}/u;

function hasClosedScriptViolation(value: string): boolean {
  for (const character of value) {
    if (
      LETTER.test(character) &&
      !LATIN_LETTER.test(character) &&
      !ARABIC_LETTER.test(character)
    )
      return true;
  }
  return [...value.matchAll(/\p{L}+/gu)].some((match) => {
    let hasLatin = false;
    let hasArabic = false;
    for (const character of match[0]) {
      hasLatin ||= LATIN_LETTER.test(character);
      hasArabic ||= ARABIC_LETTER.test(character);
    }
    return hasLatin && hasArabic;
  });
}

function comparableText(value: string): ComparableText {
  let comparable = "";
  const sourceOffsets: ComparableText["sourceOffsets"] = [];
  let ambiguous = false;
  for (const match of value.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
    const segment = match[0];
    const start = match.index;
    const end = start + segment.length;
    const withSeparators = segment.replace(FORMAT_CONTROLS, " ");
    const normalized = [...withSeparators]
      .map((character) => CONFUSABLES[character] ?? character)
      .join("")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .normalize("NFKC");
    if (withSeparators && !normalized) ambiguous = true;
    comparable += normalized;
    for (let index = 0; index < normalized.length; index += 1)
      sourceOffsets.push({ start, end });
  }
  if (sourceOffsets.length !== comparable.length) ambiguous = true;
  return { value: comparable, sourceOffsets, ambiguous };
}

function normalizedWord(value: string): string {
  return skeleton(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[أإآ]/gu, "ا")
    .replace(/[ىيی]/gu, "ي")
    .replace(/[كک]/gu, "ك")
    .replace(/[ةۀ]/gu, "ه")
    .replace(/[.'’]/gu, "");
}

function wordParts(value: string): string[] {
  return value
    .split(/[-'’.]+/u)
    .map(normalizedWord)
    .filter(Boolean);
}

function isInitial(value: string): boolean {
  return /^\p{L}\.?$/u.test(value);
}

function isTitleCase(value: string): boolean {
  const first = [...value][0];
  return (
    first !== undefined &&
    first === first.toUpperCase() &&
    first !== first.toLowerCase()
  );
}

function isGovernedCultivarSpan(
  value: string,
  start: number,
  end: number,
  parts: readonly string[],
): boolean {
  if (parts.join(" ") !== "ahmad aghaei") return false;
  return (
    /^\s+(?:pistachio(?:s)?|cultivar|variety)\b/iu.test(value.slice(end)) ||
    /\b(?:pistachio(?:s)?|cultivar|variety)\s+$/iu.test(value.slice(0, start))
  );
}

function directPersonSpans(value: string): Span[] {
  if (
    FORMAT_CONTROL.test(value) ||
    AMBIGUOUS_INVISIBLE_MARK.test(value) ||
    hasClosedScriptViolation(value)
  )
    return value ? [{ start: 0, end: value.length }] : [];
  const mapped = comparableText(value);
  if (mapped.ambiguous) return value ? [{ start: 0, end: value.length }] : [];
  const comparable = mapped.value;
  const tokens = [...comparable.matchAll(/\p{L}+(?:[-'’]\p{L}+)*\.?/gu)].map(
    (match) => {
      const comparableStart = match.index;
      const comparableEnd = comparableStart + match[0].length;
      const first = mapped.sourceOffsets[comparableStart];
      const last = mapped.sourceOffsets[comparableEnd - 1];
      if (!first || !last)
        return {
          raw: match[0],
          start: 0,
          end: value.length,
          comparableStart,
          comparableEnd,
          parts: wordParts(match[0]),
          ambiguous: true,
        };
      return {
        raw: match[0],
        start: first.start,
        end: last.end,
        comparableStart,
        comparableEnd,
        parts: wordParts(match[0]),
        ambiguous: false,
      };
    },
  );
  if (tokens.some(({ ambiguous }) => ambiguous))
    return value ? [{ start: 0, end: value.length }] : [];
  const spans: Span[] = [];
  for (let start = 0; start < tokens.length; start += 1) {
    for (
      let end = start + 1;
      end < Math.min(tokens.length, start + 6);
      end += 1
    ) {
      const window = tokens.slice(start, end + 1);
      const gapsAreNameLike = window
        .slice(1)
        .every((token, index) =>
          /^[\s,.'’()-]*$/u.test(
            comparable.slice(
              window[index]!.comparableEnd,
              token.comparableStart,
            ),
          ),
        );
      if (!gapsAreNameLike) break;
      const parts = window.flatMap((token) => token.parts);
      const given = parts.filter((part) => GIVEN_NAMES.has(part)).length;
      const family = parts.filter((part) => FAMILY_NAMES.has(part)).length;
      const title = parts.some((part) => NAME_TITLES.has(part));
      const compatible = window.every((token) =>
        token.parts.every(
          (part) =>
            GIVEN_NAMES.has(part) ||
            FAMILY_NAMES.has(part) ||
            NAME_PARTICLES.has(part) ||
            NAME_TITLES.has(part) ||
            isInitial(part),
        ),
      );
      const knownName =
        compatible &&
        ((given >= 1 && family >= 1) || given >= 2 || (title && given >= 1));
      const titleCaseWords = window.filter((token) => isTitleCase(token.raw));
      const ambiguousTitleCaseName =
        titleCaseWords.length >= 2 &&
        window.every(
          (token) =>
            !token.parts.some((part) => ORGANIZATION_WORDS.has(part)) &&
            (isTitleCase(token.raw) ||
              token.parts.every((part) => NAME_PARTICLES.has(part))),
        );
      const governedCultivar = isGovernedCultivarSpan(
        value,
        window[0]!.start,
        window.at(-1)!.end,
        parts,
      );
      if ((knownName || ambiguousTitleCaseName) && !governedCultivar) {
        spans.push({ start: window[0]!.start, end: window.at(-1)!.end });
        break;
      }
    }
  }
  const ordered = spans.sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  const merged: Span[] = [];
  for (const span of ordered) {
    const previous = merged.at(-1);
    if (
      previous &&
      /^[\s,.'’()-]*$/u.test(value.slice(previous.end, span.start))
    ) {
      previous.end = Math.max(previous.end, span.end);
    } else merged.push({ ...span });
  }
  return merged;
}

function hasEncodedPerson(value: string): boolean {
  let decoded = value;
  for (let depth = 0; depth < 2; depth += 1) {
    let changed = false;
    try {
      if (/%[0-9a-f]{2}/iu.test(decoded)) {
        decoded = decodeURIComponent(decoded);
        changed = true;
      }
      decoded = decoded.replace(
        /&#(?:x([0-9a-f]{1,6})|(\d{1,7}));/giu,
        (
          entity,
          hexadecimal: string | undefined,
          decimal: string | undefined,
        ) => {
          const codePoint = Number.parseInt(
            hexadecimal ?? decimal ?? "",
            hexadecimal ? 16 : 10,
          );
          if (!Number.isSafeInteger(codePoint) || codePoint > 0x10ffff)
            throw new Error(`Invalid numeric entity: ${entity}`);
          changed = true;
          return String.fromCodePoint(codePoint);
        },
      );
    } catch {
      return true;
    }
    if (!changed) return false;
    if (directPersonSpans(decoded).length > 0) return true;
  }
  return /%[0-9a-f]{2}|&#(?:x[0-9a-f]{1,6}|\d{1,7});/iu.test(decoded);
}

export function standardPiiFindings(value: string): Span[] {
  return directPersonSpans(value);
}

function redact(value: string, spans: readonly Span[]): string {
  let result = value;
  const withheld = "[personal data withheld]";
  for (const span of [...spans].sort((left, right) => right.start - left.start))
    result = `${result.slice(0, span.start)}${withheld}${result.slice(span.end)}`;
  if (result.length <= 600) return result;
  const intersectingToken = result.lastIndexOf(withheld, 599);
  if (intersectingToken >= 0 && intersectingToken + withheld.length > 600)
    return `${result.slice(0, 600 - withheld.length).trimEnd()}${withheld}`;
  return result.slice(0, 600);
}

export function assertStandardPiiReleaseSafe(value: unknown): void {
  const visit = (item: unknown, path: string): void => {
    if (typeof item === "string") {
      if (directPersonSpans(item).length > 0 || hasEncodedPerson(item))
        throw new Error(
          `Standard PII release membrane rejected personal data at ${path}.`,
        );
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (item && typeof item === "object")
      Object.entries(item).forEach(([key, child]) =>
        visit(child, path ? `${path}.${key}` : key),
      );
  };
  visit(value, "projection");
}

export function sanitizeStandardEvidenceGraphForRelease(
  graph: StandardEvidenceGraphV1,
): {
  graph: StandardEvidenceGraphV1;
  security_events: StandardPiiSecurityEvent[];
} {
  const safe = structuredClone(graph);
  const securityEvents: StandardPiiSecurityEvent[] = [];
  safe.evidence.forEach((evidence, index) => {
    const fieldPath = `evidence[${index}].extract`;
    const spans = directPersonSpans(evidence.extract);
    if (hasEncodedPerson(evidence.extract)) {
      securityEvents.push({
        event_type: "standard.pii_release_denied",
        policy_version: STANDARD_PII_RELEASE_POLICY_VERSION,
        field_path: fieldPath,
        action: "denied",
        finding_count: 1,
      });
      throw new Error(
        "Standard PII release membrane rejected encoded personal data.",
      );
    }
    if (spans.length === 0) return;
    evidence.extract = redact(evidence.extract, spans);
    evidence.content_sha256 = standardContentSha256(evidence.extract);
    securityEvents.push({
      event_type: "standard.pii_withheld",
      policy_version: STANDARD_PII_RELEASE_POLICY_VERSION,
      field_path: fieldPath,
      action: "redacted",
      finding_count: spans.length,
    });
  });
  try {
    assertStandardPiiReleaseSafe(safe);
  } catch {
    securityEvents.push({
      event_type: "standard.pii_release_denied",
      policy_version: STANDARD_PII_RELEASE_POLICY_VERSION,
      field_path: "evidence_graph",
      action: "denied",
      finding_count: 1,
    });
    throw new Error(
      "Standard PII release membrane rejected personal data outside a redactable excerpt.",
    );
  }
  return { graph: safe, security_events: securityEvents };
}
