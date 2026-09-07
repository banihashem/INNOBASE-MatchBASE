import type { ApprovedFactOperator } from "./approved-request.js";

interface SupplierRequirement {
  readonly concept: "supplier_profile" | "supplier_operational_presence";
  readonly label: string;
  readonly value: string;
  readonly operator: ApprovedFactOperator;
  readonly qualifiers: Record<string, string>;
}

const locations = [
  ["UAE", /\b(?:UAE|United Arab Emirates)\b|امارات(?:\s+متحده\s+عربی)?/iu],
  ["Oman", /\bOman\b|عمان/iu],
  ["Saudi Arabia", /\bSaudi(?:\s+Arabia)?\b|عربستان(?:\s+سعودی)?/iu],
  ["Qatar", /\bQatar\b|قطر/iu],
  ["Kuwait", /\bKuwait\b|کویت/iu],
  ["Bahrain", /\bBahrain\b|بحرین/iu],
  ["GCC", /\bGCC\b|شورای\s+همکاری\s+خلیج\s+فارس/iu],
] as const;

function jurisdiction(
  text: string,
  first: number,
  last: number,
): string | undefined {
  const following = text.slice(last);
  const inPlace = following.match(
    /(?:\b(?:in|within|across|throughout)\s+|در\s+)([^;؛,.]+)/iu,
  );
  const locationText = inPlace?.[1]
    ?.split(/\b(?:with|for|and|or|must|having)\b|\s(?:با|برای|و|یا)\s/iu)[0]
    ?.trim();
  if (locationText) {
    return (
      locations.find(([, pattern]) => pattern.test(locationText))?.[0] ??
      locationText.replace(/^the\s+/iu, "").toLowerCase()
    );
  }
  // Also support attributive locations, such as "Oman operational network".
  const preceding = text.slice(Math.max(0, first - 50), first);
  return locations.find(([, pattern]) => {
    const match = preceding.match(pattern);
    return (
      match &&
      /^[\s-]*(?:(?:based|local|operational|active)\s*)*$/iu.test(
        preceding.slice(match.index! + match[0].length),
      )
    );
  })?.[0];
}

function requirementOperator(text: string): ApprovedFactOperator {
  return /\b(?:without|exclude|prohibited|no|not\s+(?:required|permitted|allowed|have|need))\b|نباید|بدون|فاقد|ممنوع/iu.test(
    text,
  )
    ? "prohibits"
    : "requires";
}

function alternatives(text: string, start: number, end: number): string {
  const relation = text.slice(start, end);
  if (/\bor\b|یا/iu.test(relation)) return "any";
  return "all";
}

function tokens(
  text: string,
  definitions: readonly (readonly [string, RegExp])[],
) {
  return definitions
    .flatMap(([value, pattern]) => {
      const match = text.match(pattern);
      return match
        ? [{ value, start: match.index!, end: match.index! + match[0].length }]
        : [];
    })
    .sort((a, b) => a.start - b.start);
}

function locationQualifiers(
  text: string,
  members: ReturnType<typeof tokens>,
  kind: "role" | "presence",
): Record<string, string> {
  const last = members.at(-1)!;
  const sharedTrailingPlace = jurisdiction(text, last.start, last.end);
  const places = members.map((member, index) => {
    const branch = text.slice(0, members[index + 1]?.start ?? text.length);
    const branchPlace = jurisdiction(branch, member.start, member.end);
    return { member: member.value, place: branchPlace ?? sharedTrailingPlace };
  });
  const common = places[0]!.place;
  if (places.every(({ place }) => place === common))
    return common ? { jurisdiction: common } : {};
  // A trailing country cannot overwrite another branch's explicit location.
  return {
    [`${kind}_jurisdictions`]: places
      .map(({ member, place }) => `${member}:${place ?? "unspecified"}`)
      .sort()
      .join("|"),
  };
}

/** Parse business role separately from a supplier's local operating presence. */
export function parseSupplierServiceRequirements(
  text: string,
): SupplierRequirement[] {
  const requirements: SupplierRequirement[] = [];
  const roles = tokens(text, [
    ["freight_forwarder", /\bfreight[ -]+forwarders?\b|فورواردر|فورواردری/iu],
    ["nvocc", /\bNVOCC\b/iu],
  ]);
  const presence = tokens(text, [
    ["network", /\bnetworks?\b|شبکه/iu],
    [
      "representative",
      /\b(?:agents?|representatives?|partners?)\b|نماینده|نمایندگی|شریک/iu,
    ],
    ["branch", /\b(?:branches|branch)\b|شعبه/iu],
    ["office", /\boffices?\b|دفتر/iu],
  ]);
  const operational = /\boperational\b|عملیاتی/iu.test(text);
  const presencePrefix = text.slice(0, presence[0]?.start ?? 0);
  const supplierContext =
    /\b(?:supplier|provider|company|manufacturer|distributor|forwarder|NVOCC)\b|تأمین\s*کننده|شرکت|ارائه\s*دهنده/iu.test(
      text,
    );
  const possession =
    /\b(?:have|has|having|maintain|maintains|operates?|with)\b|دارای|دارا|داشته/iu.test(
      presencePrefix,
    );
  const counterpart = presence.some((member) => member.value !== "network");
  const localPlace = presence.length
    ? jurisdiction(text, presence[0]!.start, presence.at(-1)!.end)
    : undefined;
  const hasPresence =
    presence.length > 0 &&
    ((possession &&
      (counterpart || (supplierContext && (operational || localPlace)))) ||
      (supplierContext && operational && localPlace));

  if (roles.length) {
    const first = roles[0]!;
    const last = roles.at(-1)!;
    const roleScope = hasPresence ? text.slice(0, presence[0]!.start) : text;
    requirements.push({
      concept: "supplier_profile",
      label: "Supplier Business Role",
      value: roles
        .map((role) => role.value)
        .sort()
        .join("|"),
      operator: requirementOperator(roleScope),
      qualifiers: {
        role_combination: alternatives(text, first.end, last.start),
        ...locationQualifiers(roleScope, roles, "role"),
        ...(/\bactive\b|فعال/iu.test(roleScope) ? { activity: "active" } : {}),
        ...(/\bexperience\b|سابقه|تجربه/iu.test(roleScope) &&
        /\bGCC\b/iu.test(roleScope)
          ? { experience_jurisdiction: "GCC" }
          : {}),
      },
    });
  }

  if (hasPresence) {
    const first = presence[0]!;
    const last = presence.at(-1)!;
    requirements.push({
      concept: "supplier_operational_presence",
      label: "Supplier Operating Presence",
      value: presence
        .map((mode) => mode.value)
        .sort()
        .join("|"),
      operator: requirementOperator(text),
      qualifiers: {
        presence_combination: alternatives(text, first.end, last.start),
        ...locationQualifiers(text, presence, "presence"),
        ...(operational ? { scope: "operational" } : {}),
      },
    });
  }
  return requirements;
}
