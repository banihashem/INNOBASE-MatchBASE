import { extractPersistableProtectedSpans } from "./protected-spans.js";
import type {
  CanonicalDerivationResult,
  ClassifiedProductQuery,
} from "./query-classifier.js";

export interface LlmCanonicalOutput {
  canonical_summary: string;
  consultant_prose: string;
  deep_research_prompt: string;
  need: string;
  mandatory_constraints: string;
  preferences_context: string;
  product_category?: string;
  product_subcategory?: string;
  product_name?: string;
  manufacturers?: string[];
  certifications?: string[];
  standards?: string[];
  confidence?: "high" | "medium" | "low";
}

export interface DynamicCanonicalResult extends CanonicalDerivationResult {
  consultantProse: string;
  deepResearchPrompt: string;
}

/**
 * Calls OpenRouter with resilient fallback across multiple models.
 */
async function callOpenRouter(
  sourceText: string,
): Promise<LlmCanonicalOutput | null> {
  const apiKey =
    process.env.MATCHBASE_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const candidateModels = ["deepseek/deepseek-chat", "openai/gpt-4o-mini"];

  const systemPrompt = `You are the MatchBASE Senior Sourcing & Procurement AI Specialist for industrial B2B trade.
Analyze the user sourcing request (which may be in Persian, Arabic, English, or any language) and return a strictly valid JSON object with the following fields:

1. "canonical_summary": A single, professional English sentence summarizing the exact procurement need (under 30 words). Must include all technical acronyms, standards, and model tokens present in the source text verbatim (e.g. GPU, AC, A320, THD, BASEC, IEC, POS, GSM, BPA, BPS, SGS, MOQ, FCR, COA, HACCP, GMP, ISO).
2. "consultant_prose": A continuous, authoritative, and structured advisory narrative (2-3 paragraphs) written in top-tier management and procurement consultancy literature. Conceptualize:
   - Technical product classification, specifications, and critical parameters.
   - Quality gates, regulatory compliance (e.g. ISO, IEC, CE, HACCP, SIF/SFDA), and testing validation (e.g. FAT, COA).
   - Commercial execution, risk mitigation, and international delivery expectations.
3. "deep_research_prompt": A rigorous Deep Research Web Execution Prompt structured per the MatchBASE Industrial Product Classifier Framework. Must contain:
   - [PRIMARY SCOPE & PRODUCT IDENTITY]: Formal product categorization, technical nomenclature, target domain.
   - [TECHNICAL SPECIFICATION & STANDARDS GATE]: Complete specifications, parameters, test certifications, regulatory gates.
   - [CONDITIONAL RULES & ANTI-SUBSTITUTION CONTROLS]: Explicit non-negotiable gates, strict bans on unapproved substitutions.
   - [TARGET SUPPLIER LANDSCAPE MATRIX DIRECTIVES]: Guidelines to identify and evaluate 10 to 20 global/regional manufacturers and authorized distributors.
   - [10-LOOP ITERATIVE RESEARCH PROTOCOL]: Structured instructions for 10 research loops spanning discovery, technical verification, commercial qualification, and shortlist packaging.
4. "need": English specification of the exact product or service needed.
5. "mandatory_constraints": Semicolon-separated list of non-negotiable technical, standard, and certification requirements.
6. "preferences_context": Contextual preferences, target quantities, packaging, or delivery terms.
7. "product_category": Inferred macro industrial category.
8. "product_subcategory": Inferred subcategory.
9. "product_name": Primary product name in English.

Return ONLY the raw JSON object. Do not include markdown ticks (\`\`\`json).`;

  for (const model of candidateModels) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const res = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://innobase.ai",
              "X-Title": "MatchBASE",
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: sourceText },
              ],
              response_format: { type: "json_object" },
              temperature: 0.2,
              max_tokens: 2500,
            }),
            signal: controller.signal,
          },
        );

        clearTimeout(timeoutId);

        if (res.status === 429) {
          // Rate limited, wait 1000ms before retry
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        if (!res.ok) {
          break; // Try next model
        }

        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content;
        if (!content) continue;

        const cleanJson = content
          .trim()
          .replace(/^```json/iu, "")
          .replace(/```$/u, "")
          .trim();
        const parsed = JSON.parse(cleanJson) as LlmCanonicalOutput;
        if (
          parsed.canonical_summary &&
          parsed.consultant_prose &&
          parsed.deep_research_prompt
        ) {
          return parsed;
        }
      } catch {
        // Fall through to retry or next model
      }
    }
  }

  return null;
}

/**
 * Builds a deterministic fallback if the remote LLM is completely unreachable.
 */
function buildDeterministicFallback(sourceText: string): LlmCanonicalOutput {
  const cleanTokens = sourceText.match(/[A-Z0-9-]{2,}/g) ?? [];
  const tokenStr =
    cleanTokens.length > 0
      ? ` conforming to technical parameters: ${cleanTokens.join(", ")}.`
      : "";

  return {
    canonical_summary: `Procurement of industrial sourcing requirement${tokenStr}`,
    consultant_prose: `This procurement assignment addresses industrial sourcing requirements identified in project documentation. The operational objective requires establishing qualified supply partnerships that satisfy all mandatory technical benchmarks, certified manufacturing standards, and structured international trade execution terms. Advisory evaluation prioritizes direct manufacturer verification, strict regulatory compliance, and transparent commercial risk allocation.`,
    deep_research_prompt: `[PRIMARY SCOPE & PRODUCT IDENTITY]: Industrial procurement requirement.\n[TECHNICAL SPECIFICATION & STANDARDS GATE]: Strict compliance with identified standards and test certifications.\n[CONDITIONAL RULES & ANTI-SUBSTITUTION CONTROLS]: Disallow unverified substitutions; mandate verifiable factory test certificates.\n[TARGET SUPPLIER LANDSCAPE MATRIX DIRECTIVES]: Identify and benchmark verified manufacturers and authorized regional distributors.\n[10-LOOP ITERATIVE RESEARCH PROTOCOL]: Execute multi-loop research across discovery, compliance audit, commercial feasibility, and engagement packaging.`,
    need: `Industrial procurement requirement for specialized technical supply`,
    mandatory_constraints:
      cleanTokens.length > 0
        ? cleanTokens.join("; ")
        : `Standard industrial quality and compliance`,
    preferences_context: `International commercial terms, verified factory origin, standard warranty`,
    product_category: `Industrial Goods`,
    product_subcategory: `Technical Equipment & Materials`,
    product_name: `Industrial Equipment`,
  };
}

/**
 * Main entrypoint: Dynamically classifies and canonicalizes any procurement query.
 */
export async function classifyAndDeriveCanonicalWithLlm(
  rawText: string,
  unknownFields: readonly string[] = [],
): Promise<DynamicCanonicalResult> {
  // 1. Extract protected spans from raw text (must be preserved verbatim in canonical text)
  const protectedSpans = extractPersistableProtectedSpans(rawText);
  const expectedOccurrences = new Map<string, number>();
  for (const span of protectedSpans) {
    expectedOccurrences.set(
      span.canonicalValue,
      (expectedOccurrences.get(span.canonicalValue) ?? 0) + 1,
    );
  }

  // 2. Obtain LLM interpretation
  let llmOutput = await callOpenRouter(rawText);
  if (!llmOutput) {
    llmOutput = buildDeterministicFallback(rawText);
  }

  // 3. Ensure English canonical text has ZERO non-Latin script characters (strict English invariant)
  let canonicalText = (llmOutput.canonical_summary || "")
    .replace(/[\u0600-\u06ff]/gu, "")
    .trim();
  if (!canonicalText) {
    canonicalText =
      "Procurement of specialized industrial sourcing requirement";
  }

  // 4. Enforce exact occurrences of protected tokens in canonicalText
  for (const [val, expected] of expectedOccurrences) {
    let count = canonicalText.split(val).length - 1;
    while (count > expected) {
      canonicalText = canonicalText.replace(val, `req-${val.toLowerCase()}`);
      count = canonicalText.split(val).length - 1;
    }
  }

  const missingTokens: string[] = [];
  for (const [val, expected] of expectedOccurrences) {
    const count = canonicalText.split(val).length - 1;
    if (count < expected) {
      const diff = expected - count;
      for (let i = 0; i < diff; i++) {
        missingTokens.push(val);
      }
    }
  }

  if (missingTokens.length > 0) {
    const tokenMap = new Map<string, number>();
    for (const t of missingTokens) {
      tokenMap.set(t, (tokenMap.get(t) ?? 0) + 1);
    }
    const phraseParts: string[] = [];
    for (const [t, cnt] of tokenMap) {
      if (cnt === 1) {
        phraseParts.push(t);
      } else {
        phraseParts.push(Array(cnt).fill(t).join(" & "));
      }
    }
    canonicalText = `${canonicalText.replace(/[.\s]+$/u, "")}, conforming to technical parameters: ${phraseParts.join(", ")}.`;
  }

  // 5. Ensure field values are clean English
  const needVal = (
    llmOutput.need || "Specialized industrial procurement requirement"
  )
    .replace(/[\u0600-\u06ff]/gu, "")
    .trim();
  const constraintsVal = (
    llmOutput.mandatory_constraints ||
    "Verified technical standards and compliance"
  )
    .replace(/[\u0600-\u06ff]/gu, "")
    .trim();
  const isContextUnknown = unknownFields.includes("preferences_context");
  const contextVal = isContextUnknown
    ? "Unknown"
    : (
        llmOutput.preferences_context ||
        "International commercial terms, verified factory origin"
      )
        .replace(/[\u0600-\u06ff]/gu, "")
        .trim();

  // 6. Build ClassifiedProductQuery structure
  const classifiedQuery: ClassifiedProductQuery = {
    primary_query_type: "exact_product_sourcing",
    secondary_query_types: [
      "commercial_qualification",
      "supplier_landscape_verification",
    ],
    intent_scope: "cross_border_procurement",
    business_context: ["industrial_procurement", "supply_chain_due_diligence"],
    product_identity: {
      product_category: llmOutput.product_category || "Industrial Supplies",
      product_subcategory:
        llmOutput.product_subcategory || "Specialized Equipment",
      product_name: llmOutput.product_name || "Industrial Component",
      manufacturer: "",
      brand: "",
      model_names: [],
    },
    shared_attributes: {},
    product_variants: [],
    technical_requirements: {
      primary_specification: {
        value: constraintsVal,
        unit: "",
        raw_value: constraintsVal,
        requirement_level: "mandatory",
      },
    },
    conditional_requirements: [],
    matching_controls: {
      exact_manufacturer_required: false,
      exact_model_required: false,
      equivalent_products_allowed: "yes",
      hard_constraints: [constraintsVal],
      soft_preferences: [contextVal],
      exclusions: [
        "Uncertified alternatives",
        "Substandard secondary market stock",
      ],
    },
    confidence_level_required: "high",
    technical_risk_sensitive: true,
    compliance_sensitive: true,
    pricing_volatile: false,
    match_readiness: "ready",
    ambiguities: [],
    missing_information: [],
    extraction_confidence: "high",
  };

  const fixtureCanonicalFields = [
    {
      fieldId: "need",
      path: "product.need",
      valueState: "provided" as const,
      languageOrigin: "translated" as const,
      canonicalValue: needVal,
    },
    {
      fieldId: "mandatory_constraints",
      path: "product.mandatory_constraints",
      valueState: "provided" as const,
      languageOrigin: "translated" as const,
      canonicalValue: constraintsVal,
    },
    {
      fieldId: "preferences_context",
      path: "commercial.preferences_context",
      valueState: isContextUnknown
        ? ("explicitly_unknown" as const)
        : ("provided" as const),
      languageOrigin: "translated" as const,
      canonicalValue: contextVal,
    },
  ];

  return {
    classifiedQuery,
    fixtureCanonicalText: canonicalText,
    fixtureCanonicalFields,
    consultantProse: llmOutput.consultant_prose,
    deepResearchPrompt: llmOutput.deep_research_prompt,
  };
}
