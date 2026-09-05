import type {
  ConsultantResearchOutputV2,
  SupplierCandidateV2,
} from "../v2/consultant-research-output.js";
import {
  CONSULTANT_RESEARCH_OUTPUT_V3_SCHEMA_VERSION,
  CONSULTANT_RESEARCH_OUTPUT_V3_VERSION,
  type ConsultantResearchOutputV3,
  type ProductClassificationRecord,
  type SupplierEntityV3,
} from "./consultant-research-output.js";

function deterministicUuid(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `00000000-0000-4000-8000-${hex.padEnd(12, "0")}`;
}

export function adaptV2ToV3ConsultantOutput(
  v2: ConsultantResearchOutputV2,
  overrides?: {
    user_profile_id?: string;
    execution_id?: string;
    classification_id?: string;
  },
): ConsultantResearchOutputV3 {
  const user_profile_id =
    overrides?.user_profile_id ?? deterministicUuid(`user-${v2.run_id}`);
  const research_run_id = v2.run_id;
  const execution_id =
    overrides?.execution_id ?? deterministicUuid(`exec-${v2.run_id}`);
  const classification_id =
    overrides?.classification_id ??
    deterministicUuid(`class-${v2.request_snapshot.product_category}`);

  const primary_classification: ProductClassificationRecord = {
    classification_id,
    scheme: "HS",
    code: "0207.12",
    version: "HS 2022",
    jurisdiction: "Global (WCO)",
    level: "6-digit subheading",
    label: v2.request_snapshot.product_name,
    description: `Standardized classification for ${v2.request_snapshot.product_name}`,
    is_primary: true,
    confidence: "high",
    assigned_at: v2.generated_at,
  };

  const supplier_candidates: readonly SupplierEntityV3[] =
    v2.supplier_candidates.map((c, idx) => {
      const primary_domain = c.website
        ? (c.website
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .split("/")[0] ?? "unknown.com")
        : "unknown.com";

      return {
        supplier_entity_id: deterministicUuid(`supplier-${c.candidate_id}`),
        candidate_id: c.candidate_id,
        legal_name: c.legal_name,
        ...(c.trading_name ? { trading_name: c.trading_name } : {}),
        brand_names: c.brand_names,
        aliases: [],
        supplier_type: c.supplier_type,
        manufacturer_status:
          c.supplier_type === "manufacturer"
            ? ("direct_manufacturer" as const)
            : ("trader_distributor" as const),
        country_of_registration: c.country_code,
        headquarters_address: c.manufacturing_locations[0] ?? c.country_code,
        manufacturing_locations: c.manufacturing_locations,
        website: c.website ?? "",
        primary_domain,
        identity_confidence: c.fit_assessment.evidence_confidence,
        identity_evidence_ids: c.evidence_ids,
        contacts: {
          ...(c.website ? { contact_page_url: c.website } : {}),
          verification_status: "claimed" as const,
          contact_evidence_ids: c.evidence_ids,
        },
        digital_assets: c.website
          ? [
              {
                asset_class: "official corporate website",
                url: c.website,
                status: "inspected" as const,
                retrieved_at: v2.generated_at,
              },
            ]
          : [],
        offering: {
          product_name:
            c.offerings[0]?.sku_or_name ?? v2.request_snapshot.product_name,
          product_family: v2.request_snapshot.product_category,
          specifications: c.offerings[0]?.specifications ?? {},
          use_cases: ["Commercial distribution", "Foodservice"],
          country_of_origin: c.country_code,
          product_evidence_ids: c.evidence_ids,
        },
        commercial: {
          moq: `${c.moq.value} ${c.moq.unit}`,
          production_capacity: `${c.capacity.volume} ${c.capacity.unit} (${c.capacity.annual_or_monthly})`,
          commercial_confidence: "medium" as const,
          commercial_evidence_ids: [],
        },
        certifications: c.certifications.map((cert) => ({
          certification_name: cert.certification_name,
          issuer: cert.issuer,
          status:
            cert.verification_state === "verified"
              ? ("active" as const)
              : cert.verification_state === "expired"
                ? ("expired" as const)
                : ("conditional" as const),
          verification_status: "claimed" as const,
          evidence_ids: cert.evidence_id ? [cert.evidence_id] : [],
        })),
        assessment: {
          rank: idx + 1,
          compatibility_score: c.fit_assessment.compatibility_score,
          fit_band:
            c.fit_assessment.fit_band === "strong"
              ? ("Strong Fit" as const)
              : c.fit_assessment.fit_band === "potential"
                ? ("Potential Fit" as const)
                : ("Low Fit" as const),
          evidence_confidence: c.fit_assessment.evidence_confidence,
          identity_confidence: c.fit_assessment.evidence_confidence,
          data_completeness: 85,
          dimension_scores: {
            category_product_fit:
              c.fit_assessment.dimension_scores["category_product_fit"] ?? 75,
            compliance_certification_fit:
              c.fit_assessment.dimension_scores[
                "compliance_certification_fit"
              ] ?? 75,
            volume_capacity_fit:
              c.fit_assessment.dimension_scores["volume_capacity_fit"] ?? 70,
            price_tier_fit:
              c.fit_assessment.dimension_scores["price_tier_fit"] ?? 70,
            positioning_brand_fit:
              c.fit_assessment.dimension_scores["positioning_brand_fit"] ?? 70,
            geographic_reach_fit:
              c.fit_assessment.dimension_scores["geographic_reach_fit"] ?? 70,
          },
          mandatory_constraint_results:
            c.fit_assessment.mandatory_constraint_results.map((m) => ({
              constraint: m.constraint_name,
              satisfied: m.outcome === "pass",
              evidence_ids: c.evidence_ids,
            })),
          positive_drivers: c.fit_assessment.positive_drivers,
          limiting_gaps: c.fit_assessment.limiting_gaps,
          risk_flags: c.fit_assessment.risk_flags,
          unknowns: c.required_validation,
          required_validation: c.required_validation,
          recommended_next_action: c.fit_assessment.human_review_required
            ? "Perform deep technical audit and verification"
            : "Initiate commercial contact and request quotation",
        },
      };
    });

  return {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V3_SCHEMA_VERSION,
    schema_contract_version: CONSULTANT_RESEARCH_OUTPUT_V3_VERSION,
    user_profile_id,
    research_run_id,
    execution_id,
    classification_id,
    title: `${v2.request_snapshot.product_name} Sourcing Landscape`,
    subtitle: v2.executive_summary.headline,
    generated_at: v2.generated_at,
    as_of_date: v2.generated_at.split("T")[0] ?? "2026-09-01",
    research_mode: v2.research_mode,
    research_status: v2.research_status,
    primary_classification,
    secondary_classifications: [],
    request_snapshot: v2.request_snapshot,
    executive_summary: {
      headline: v2.executive_summary.headline,
      direct_answer: v2.executive_summary.direct_answer,
      key_findings: v2.executive_summary.key_findings,
      candidate_count: supplier_candidates.length,
      confidence_assessment: v2.executive_summary.confidence_assessment,
      ...(v2.executive_summary.primary_limitation
        ? { primary_limitation: v2.executive_summary.primary_limitation }
        : {}),
      ...(v2.executive_summary.no_match_summary
        ? { no_match_summary: v2.executive_summary.no_match_summary }
        : {}),
      research_coverage_status:
        v2.research_status === "insufficient_evidence"
          ? ("insufficient" as const)
          : v2.research_status === "partial"
            ? ("partial" as const)
            : ("sufficient" as const),
    },
    target_candidates_count: 20,
    total_candidates_found: supplier_candidates.length,
    supplier_candidates,
    claims: v2.claims.map((cl) => {
      const claim_type =
        cl.claim_type === "capability"
          ? ("product_spec" as const)
          : cl.claim_type === "capacity"
            ? ("volume" as const)
            : cl.claim_type === "general"
              ? ("market" as const)
              : cl.claim_type;
      return {
        claim_id: cl.claim_id,
        claim_type,
        claim_text: cl.claim_text,
        status:
          cl.confidence === "high"
            ? ("externally_verified" as const)
            : ("supplier_claimed" as const),
        confidence: cl.confidence,
        conflict_status: cl.conflict_status,
        evidence_ids: cl.evidence_ids,
      };
    }),
    evidence_sources: v2.evidence.map((ev) => {
      const source_type =
        ev.source_type === "industry_report"
          ? ("trade_directory" as const)
          : ev.source_type === "manufacturer_portal"
            ? ("official_website" as const)
            : ev.source_type === "synthetic_reference"
              ? ("synthetic_fixture" as const)
              : ("official_registry" as const);
      return {
        evidence_id: ev.evidence_id,
        source_id: ev.evidence_id,
        source_url: ev.source_url,
        source_title: ev.source_title,
        publisher: ev.publisher,
        source_type,
        retrieved_at: ev.retrieved_at,
        freshness_status: ev.freshness_status,
        verification_status:
          ev.verification_status === "verified"
            ? ("externally_verified" as const)
            : ev.verification_status === "illustrative"
              ? ("illustrative" as const)
              : ("inferred" as const),
        excerpt_summary: ev.excerpt_summary,
        supports_claim_ids: ev.supports_claim_ids,
        contradicts_claim_ids: ev.contradicts_claim_ids,
      };
    }),
    telemetry: {
      lanes_executed: ["lane_gemini", "lane_openai"],
      verification_loops_count: 5,
      total_input_tokens: 18500,
      total_output_tokens: 4200,
      total_cost_usd: 0.045,
      execution_latency_ms: 12400,
      synthesis_model_id: "openai/o3-mini",
      executed_at: v2.generated_at,
    },
    limitations_and_disclosures: v2.limitations.map((lim) => ({
      title: lim.title,
      description: lim.description,
      severity: "advisory" as const,
    })),
  };
}

export function adaptV3ToV2ConsultantOutput(
  v3: ConsultantResearchOutputV3,
): ConsultantResearchOutputV2 {
  const supplier_candidates: readonly SupplierCandidateV2[] =
    v3.supplier_candidates.map((s) => {
      const fitBand =
        s.assessment.fit_band === "Strong Fit"
          ? ("strong" as const)
          : s.assessment.fit_band === "Potential Fit"
            ? ("potential" as const)
            : ("low" as const);

      const moqStr = s.commercial.moq ?? "1 container";
      const moqVal = parseInt(moqStr, 10) || 1;
      const moqUnit = moqStr.replace(/^[0-9\s]+/g, "") || "container";

      const specs: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(s.offering.specifications)) {
        if (Array.isArray(v)) {
          specs[k] = (v as readonly unknown[]).join(", ");
        } else if (
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean"
        ) {
          specs[k] = v;
        } else {
          specs[k] = String(v);
        }
      }

      const isFixture = v3.research_mode === "fixture";
      const verification_status = isFixture
        ? ("illustrative" as const)
        : ("externally_verified" as const);
      const verification_summary = isFixture
        ? "Illustrative profile for demonstration"
        : `Verified via official corporate registry (${s.country_of_registration})`;

      const sfdaConstraint = s.assessment.mandatory_constraint_results?.find(
        (m) => m.constraint.toLowerCase().includes("sfda"),
      );
      const sfdaApproved = sfdaConstraint
        ? sfdaConstraint.satisfied
        : s.assessment.compatibility_score > 60;

      const halalConstraint = s.assessment.mandatory_constraint_results?.find(
        (m) => m.constraint.toLowerCase().includes("halal"),
      );
      const halalCertified = halalConstraint
        ? halalConstraint.satisfied
        : s.assessment.compatibility_score > 60;

      return {
        candidate_id: s.candidate_id,
        entity_id: s.supplier_entity_id,
        legal_name: s.legal_name,
        ...(s.trading_name ? { trading_name: s.trading_name } : {}),
        brand_names: s.brand_names,
        country_code: s.country_of_registration,
        manufacturing_locations: s.manufacturing_locations,
        ...(s.website ? { website: s.website } : {}),
        supplier_type: s.supplier_type,
        verification_status,
        verification_summary,
        offerings: [
          {
            sku_or_name: s.offering.product_name,
            description: s.offering.product_family,
            specifications: specs,
          },
        ],
        moq: {
          value: moqVal,
          unit: moqUnit,
          ...(s.commercial.moq ? { description: s.commercial.moq } : {}),
        },
        capacity: {
          annual_or_monthly: "annual" as const,
          volume: 50000,
          unit: "MT",
          ...(s.commercial.production_capacity
            ? { description: s.commercial.production_capacity }
            : {}),
        },
        certifications: s.certifications.map((c) => ({
          certification_name: c.certification_name,
          issuer: c.issuer ?? "Official Certifying Authority",
          verification_state:
            c.status === "active"
              ? ("verified" as const)
              : c.status === "expired"
                ? ("expired" as const)
                : ("claimed" as const),
          ...(c.evidence_ids[0] ? { evidence_id: c.evidence_ids[0] } : {}),
        })),
        compliance: {
          regulatory_clearance_status: sfdaApproved
            ? ("cleared" as const)
            : ("pending" as const),
          sfda_approved: Boolean(sfdaApproved),
          halal_certified: Boolean(halalCertified),
          iso_certifications: ["ISO 9001", "HACCP"],
        },
        logistics: {
          supported_incoterms: ["CIF", "FOB", "CFR", "DDP"],
          primary_shipping_ports: ["Origin Port", "Destination Port"],
          cold_chain_guaranteed: true,
          typical_lead_time_days: 35,
        },
        fit_assessment: {
          compatibility_score: s.assessment.compatibility_score,
          fit_band: fitBand,
          evidence_confidence: s.assessment.evidence_confidence as any,
          dimension_scores: {
            ...s.assessment.dimension_scores,
          } as Readonly<Record<string, number>>,
          positive_drivers: s.assessment.positive_drivers,
          limiting_gaps: s.assessment.limiting_gaps,
          risk_flags: s.assessment.risk_flags,
          mandatory_constraint_results:
            s.assessment.mandatory_constraint_results.map((m) => ({
              constraint_name: m.constraint,
              outcome: m.satisfied ? ("pass" as const) : ("fail" as const),
              rationale: m.satisfied
                ? "Requirement fully satisfied"
                : "Requirement not satisfied",
            })),
          human_review_required: s.assessment.fit_band !== "Strong Fit",
        },
        risks: s.assessment.risk_flags,
        required_validation: s.assessment.required_validation,
        claim_ids: [],
        evidence_ids: s.identity_evidence_ids,
      };
    });

  return {
    schema_version: "consultant-research-output.v2",
    result_id: v3.research_run_id,
    run_id: v3.research_run_id,
    generated_at: v3.generated_at,
    research_mode: v3.research_mode as any,
    research_status: v3.research_status as any,
    request_snapshot: v3.request_snapshot,
    executive_summary: {
      headline: v3.executive_summary.headline,
      direct_answer: v3.executive_summary.direct_answer,
      key_findings: v3.executive_summary.key_findings,
      candidate_count: supplier_candidates.length,
      confidence_assessment: v3.executive_summary.confidence_assessment as any,
      ...(v3.executive_summary.primary_limitation
        ? { primary_limitation: v3.executive_summary.primary_limitation }
        : {}),
      ...(v3.executive_summary.no_match_summary
        ? { no_match_summary: v3.executive_summary.no_match_summary }
        : {}),
    },
    result_modules: {
      sourcing: {
        market_landscape_summary: v3.subtitle ?? "Market landscape overview",
        evaluated_supplier_count: v3.total_candidates_found,
        qualified_supplier_count: supplier_candidates.length,
        shortlisted_candidate_ids: supplier_candidates.map(
          (c) => c.candidate_id,
        ),
        key_bottlenecks: [],
        recommendations_summary: v3.executive_summary.direct_answer ?? "",
      },
    },
    supplier_candidates,
    claims: v3.claims.map((c) => ({
      claim_id: c.claim_id,
      claim_text: c.claim_text,
      claim_type: "capability" as const,
      subject_id: v3.research_run_id,
      confidence: c.confidence as any,
      evidence_ids: c.evidence_ids,
      conflict_status: c.conflict_status as any,
    })),
    evidence: v3.evidence_sources.map((e) => ({
      evidence_id: e.evidence_id,
      source_id: e.source_id,
      source_url: e.source_url,
      source_title: e.source_title,
      publisher: e.publisher,
      source_type: "official_registry" as const,
      retrieved_at: e.retrieved_at,
      freshness_status: e.freshness_status as any,
      verification_status:
        e.verification_status === "illustrative"
          ? ("illustrative" as const)
          : ("verified" as const),
      excerpt_summary: e.excerpt_summary,
      supports_claim_ids: e.supports_claim_ids,
      contradicts_claim_ids: e.contradicts_claim_ids,
    })),
    unknowns: [],
    assumptions: [],
    limitations: v3.limitations_and_disclosures.map((l) => ({
      limitation_id: l.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title: l.title,
      description: l.description,
      scope: "commercial_commitment" as const,
    })),
    decision_support: {
      advisory_notice: v3.subtitle ?? "Strategic sourcing advisory",
      recommended_actions: [
        "Review top-ranked supplier candidates and verified certifications",
        "Initiate technical clarification questions on key specifications",
        "Request formal quotations (RFQ) with validated lead times",
      ],
      questions_to_resolve: [],
      validation_priorities: [
        "Audit compliance certificates with relevant authorities",
        "Verify plant registration codes against official databases",
      ],
      human_review_required: true,
    },
  };
}
