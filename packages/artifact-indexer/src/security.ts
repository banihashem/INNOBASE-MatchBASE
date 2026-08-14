import { isAbsolute, relative, resolve, sep } from "node:path";

export class PathPolicyError extends Error {
  public readonly code = "PATH_POLICY_VIOLATION";

  public constructor(message: string) {
    super(message);
    this.name = "PathPolicyError";
  }
}

export interface RedactionResult {
  readonly text: string;
  readonly count: number;
}

type RedactionReplacement = string | ((match: string) => string);

const REDACTION_RULES: readonly [RegExp, RedactionReplacement][] = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[REDACTED:PRIVATE_KEY]",
  ],
  [
    /\b(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    "[REDACTED:GITHUB_TOKEN]",
  ],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, "[REDACTED:API_KEY]"],
  [/\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}\b/g, "[REDACTED:API_KEY]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED:AWS_ACCESS_KEY]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED:SLACK_TOKEN]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, "Bearer [REDACTED:ACCESS_TOKEN]"],
  [
    /(https?:\/\/)([^\s:/]+):([^\s@/]+)@/gi,
    "$1[REDACTED:USER]:[REDACTED:PASSWORD]@",
  ],
  [
    /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["']?[^\s,"'};]{4,}["']?/gi,
    (match: string) => {
      const separatorIndex = Math.max(match.indexOf(":"), match.indexOf("="));
      return `${match.slice(0, separatorIndex + 1)} [REDACTED:CREDENTIAL]`;
    },
  ],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED:EMAIL]"],
  [
    /(?<!\w)(?:\+\d[\d ().-]{7,}\d|(?:\(\d{2,4}\)|\d{2,4}[-. ])\d{3,4}[-. ]\d{3,4})(?!\w)/g,
    "[REDACTED:PHONE]",
  ],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED:IP_ADDRESS]"],
];

/** Redacts likely credentials and direct identifiers. Never returns the original match. */
export function redactSensitiveText(input: string): RedactionResult {
  let text = input;
  let count = 0;

  for (const [pattern, replacement] of REDACTION_RULES) {
    text = text.replace(pattern, (...args: unknown[]) => {
      count += 1;
      if (typeof replacement === "function") {
        return replacement(String(args[0]));
      }
      return replacement.replace(/\$(\d+)/g, (_token, group: string) =>
        String(args[Number(group)] ?? ""),
      );
    });
  }

  return { text, count };
}

/** True only when candidate is root itself or a descendant. */
export function isWithinRoot(root: string, candidate: string): boolean {
  const rootResolved = resolve(root);
  const candidateResolved = resolve(candidate);
  const delta = relative(rootResolved, candidateResolved);
  return (
    delta === "" ||
    (!delta.startsWith(`..${sep}`) && delta !== ".." && !isAbsolute(delta))
  );
}

export function assertAbsolutePath(candidate: string, label: string): void {
  if (!isAbsolute(candidate)) {
    throw new PathPolicyError(`${label} must be an absolute path`);
  }
}

export function assertAllowedPath(
  candidate: string,
  allowedRoots: readonly string[],
): void {
  assertAbsolutePath(candidate, "candidate");
  if (!allowedRoots.some((root) => isWithinRoot(root, candidate))) {
    throw new PathPolicyError(
      "candidate resolves outside all configured source roots",
    );
  }
}

export function containsForbiddenMepSegment(candidate: string): boolean {
  return resolve(candidate)
    .split(/[\\/]+/u)
    .some(
      (segment) =>
        /(?:^|[-_. ])mep(?:$|[-_. ])/iu.test(segment) ||
        /minimum[-_ ]?executable[-_ ]?product/iu.test(segment),
    );
}
