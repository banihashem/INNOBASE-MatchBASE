import { describe, expect, it, vi } from "vitest";
import {
  CONSULTANT_DOMAIN_PACK_ID,
  CONSULTANT_DUE_DILIGENCE_CHECKS,
  CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
  CONSULTANT_SOURCE_POLICY_ID,
  CONSULTANT_SOURCE_POLICY_VERSION,
  CONSULTANT_SYNTHETIC_RFQ_QUESTIONS,
  contractSha256Hex,
} from "@matchbase/contracts";
import { handleConsultantRoute } from "./consultant-route-core";

const context = {
  accountId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  tier: "consultant" as const,
  adminSubRoles: [],
  correlationId: "correlation-consultant-route",
  deploymentId: "test",
};

const consultantBody = {
  schema_version: "consultant-result-projection.v1" as const,
  run_id: "00000000-0000-4000-8000-000000000137",
  outcome: "no_responsible_match" as const,
  scarcity: "zero" as const,
  candidates: [],
  gate_eliminations: [],
  scarcity_analysis: {
    reducing_constraints: [],
    unmet_mandatory_constraints: [],
    permitted_relaxations: [],
  },
  limitations: {
    unknown_count: 0,
    not_asked_count: 0,
    affected_low_confidence_dimensions: [],
    evidence_states: [],
    restricted_party_screening_notice: "Not a screening result.",
    advisory_boundary: "Advisory output only.",
  },
  synthetic_warning: "Synthetic route fixture.",
  landscape: {
    eligible_count: 0,
    displayed_count: 0,
    soft_cap: 20,
    truncated: false,
    scarcity_override_applied: false,
  },
  consultant_source_readiness: {
    state: "limited" as const,
    notice: "Consultant sources are not released.",
  },
  projection_version: 5 as const,
};

const routeConfigSha256 = "b".repeat(64);
const routeWaveInstanceId = contractSha256Hex(
  [
    consultantBody.run_id,
    CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
    routeConfigSha256,
    "RFQ_WAVE_INITIAL",
    "1",
    "",
  ].join("|"),
);
const routeAuditEventId = contractSha256Hex(
  `${routeWaveInstanceId}|2026-08-25T00:00:00.000Z|SYNTHETIC_WAVE_SNAPSHOT_PROJECTED`,
);

const consultantBodyV2 = {
  ...Object.fromEntries(
    Object.entries(consultantBody).filter(
      ([key]) => key !== "consultant_source_readiness",
    ),
  ),
  schema_version: "consultant-result-projection.v2" as const,
  source_policy: {
    policy_id: CONSULTANT_SOURCE_POLICY_ID,
    policy_version: CONSULTANT_SOURCE_POLICY_VERSION,
    content_sha256: CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
    domain_pack_id: CONSULTANT_DOMAIN_PACK_ID,
    mode: "agent_researched_synthetic_qualification" as const,
    production_state: "blocked_pending_attributable_sme_validation" as const,
  },
  configuration_release: {
    config_id: "00000000-0000-4000-8000-000000000620",
    config_version: "consultant-soft-cap.test.v1",
    content_sha256: routeConfigSha256,
    bound_at: "2026-08-25T00:00:00.000Z",
    effective_release_at: "2026-08-24T00:00:00.000Z",
    soft_cap: 20,
  },
  agent_authorship: {
    prepared_by: "matchbase_agent_research_and_implementation_team" as const,
    mode: "agent_researched_synthetic_qualification" as const,
    human_consultant_authorship: "not_claimed" as const,
    production_sme_validation: "not_claimed" as const,
  },
  rfq_questions: CONSULTANT_SYNTHETIC_RFQ_QUESTIONS.map(
    ([question_id, required_response], index) => ({
      order: index + 1,
      question_id,
      required_response,
      response_state: "not_collected" as const,
    }),
  ),
  wave_recommendations: [
    {
      wave_id: "RFQ_WAVE_INITIAL" as const,
      action: "no_eligible_candidates" as const,
      selection_rule: "first_min_initial_wave_size_displayed" as const,
      candidates: [],
    },
  ],
  eligible_ranking: [],
  rfq_execution_snapshot: {
    state: "synthetic_planning_only" as const,
    contact_state: "not_contacted" as const,
    response_state: "not_collected" as const,
    qualified_response_count: 0 as const,
    expansion_model: {
      initial_wave_size: 3 as const,
      subsequent_wave_size: 2 as const,
      expansion_threshold: 3 as const,
      effective_expansion_threshold: 0,
    },
    wave_id: "RFQ_WAVE_INITIAL" as const,
    wave_sequence: 1 as const,
    wave_instance_id: routeWaveInstanceId,
    selected_candidates: [],
    remaining_displayed_queue: [],
    stop_state: "exhausted_displayed_queue" as const,
    next_reserve_promotion: {
      state: "exhausted" as const,
      candidate: null,
      promotion_mode: "one_next_ranked_eligible_only" as const,
    },
    audit_identity: {
      event_type: "SYNTHETIC_WAVE_SNAPSHOT_PROJECTED" as const,
      event_id: routeAuditEventId,
      actor_type: "agent" as const,
      actor_id: "matchbase_agent_research_and_implementation_team" as const,
      occurred_at: "2026-08-25T00:00:00.000Z",
      policy_id: CONSULTANT_SOURCE_POLICY_ID,
      policy_version: CONSULTANT_SOURCE_POLICY_VERSION,
      policy_content_sha256: CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
      config_id: "00000000-0000-4000-8000-000000000620",
      config_version: "consultant-soft-cap.test.v1",
      config_content_sha256: routeConfigSha256,
    },
  },
  reserve_candidates: [],
  due_diligence_checklist: CONSULTANT_DUE_DILIGENCE_CHECKS.map(
    ([check_id, label], index) => ({
      order: index + 1,
      check_id,
      label,
      state: "not_executed" as const,
      required_before_production: true as const,
    }),
  ),
  source_facts: [],
  excluded_evidence: [],
  full_limitations: {
    qualification_scope: "synthetic_only" as const,
    human_consultant_authorship: "not_claimed" as const,
    production_sme_validation: "not_claimed" as const,
    production_release: "blocked" as const,
    restricted_party_clearance: "not_claimed" as const,
    due_diligence_completeness: "not_executed" as const,
    notices: [
      "Synthetic only.",
      "No human Consultant authorship.",
      "No production SME validation.",
      "No legal or compliance clearance.",
      "Due diligence was not executed.",
    ] as const,
  },
  projection_version: 6 as const,
};

const standardBody = {
  ...Object.fromEntries(
    Object.entries(consultantBody).filter(
      ([key]) => key !== "landscape" && key !== "consultant_source_readiness",
    ),
  ),
  schema_version: "standard-result-projection.v1" as const,
  projection_version: 4 as const,
};

const demoBody = {
  schema_version: "demo-projection.v1" as const,
  run_id: "00000000-0000-4000-8000-000000000137",
  outcome: "no_responsible_match" as const,
  scarcity: "zero" as const,
  candidates: [],
  unmet_mandatory_constraints: [],
  limitations_notice: "Historical Demo projection.",
  projection_version: 1 as const,
};

describe("Consultant result route", () => {
  it("serves owner-scoped Consultant run history on its dedicated route", async () => {
    const listRuns = vi.fn(async () => ({
      schema_version: "consultant-run-history.v1" as const,
      items: [
        {
          run_id: "00000000-0000-4000-8000-000000000137",
          request_id: "00000000-0000-4000-8000-000000000138",
          state: "completed" as const,
          updated_at: "2026-08-25T00:00:00.000Z",
          result_available: true,
          outcome: "matched" as const,
        },
      ],
    }));
    const response = await handleConsultantRoute({
      method: "GET",
      pathname: "/api/v1/consultant/runs",
      context,
      application: { listRuns } as never,
    });
    expect(response).toMatchObject({
      status: 200,
      body: { schema_version: "consultant-run-history.v1" },
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
    expect(listRuns).toHaveBeenCalledWith(context);
  });

  it("does not expose the Consultant history route to other tiers", async () => {
    const listRuns = vi.fn();
    await expect(
      handleConsultantRoute({
        method: "GET",
        pathname: "/api/v1/consultant/runs",
        context: { ...context, tier: "standard" },
        application: { listRuns } as never,
      }),
    ).resolves.toBeNull();
    expect(listRuns).not.toHaveBeenCalled();
  });

  it("serves only the unified result route for Consultant", async () => {
    const getResult = vi.fn(async () => ({
      projectionTier: "consultant" as const,
      body: consultantBody,
    }));
    const runId = "00000000-0000-4000-8000-000000000137";
    const response = await handleConsultantRoute({
      method: "GET",
      pathname: `/api/v1/runs/${runId}/result`,
      context,
      application: { getResult } as never,
    });
    expect(response).toMatchObject({
      status: 200,
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
    expect(getResult).toHaveBeenCalledWith(context, runId);
  });

  it("serves the additive closed Consultant v2 source-facts contract", async () => {
    const getResult = vi.fn(async () => ({
      projectionTier: "consultant" as const,
      body: consultantBodyV2,
    }));
    const runId = "00000000-0000-4000-8000-000000000137";
    const response = await handleConsultantRoute({
      method: "GET",
      pathname: `/api/v1/runs/${runId}/result`,
      context,
      application: { getResult } as never,
    });
    expect(response).toMatchObject({ status: 200 });
    expect(response!.body).toMatchObject({
      schema_version: "consultant-result-projection.v2",
      projection_version: 6,
      source_policy: {
        policy_id: "task137-rfq-wave-due-diligence.v1",
      },
      agent_authorship: { human_consultant_authorship: "not_claimed" },
    });
  });

  for (const [tier, body] of [
    ["standard", standardBody],
    ["demo", demoBody],
  ] as const)
    it(`parses immutable historical ${tier} output at the route boundary`, async () => {
      const getResult = vi.fn(async () => ({
        projectionTier: tier,
        body,
      }));
      const response = await handleConsultantRoute({
        method: "GET",
        pathname: "/api/v1/runs/00000000-0000-4000-8000-000000000137/result",
        context,
        application: { getResult } as never,
      });
      expect(response?.body).toMatchObject({
        schema_version: body.schema_version,
      });
    });

  it("rejects widened historical output at the route boundary", async () => {
    const getResult = vi.fn(async () => ({
      projectionTier: "demo" as const,
      body: { ...demoBody, hidden_supplier_score: 99 },
    }));
    await expect(
      handleConsultantRoute({
        method: "GET",
        pathname: "/api/v1/runs/00000000-0000-4000-8000-000000000137/result",
        context,
        application: { getResult } as never,
      }),
    ).rejects.toThrow(/not closed/iu);
  });

  it("rejects unknown Consultant fields at the HTTP serialization boundary", async () => {
    const getResult = vi.fn(async () => ({
      projectionTier: "consultant" as const,
      body: { ...consultantBody, hidden_supplier_score: 99 },
    }));
    await expect(
      handleConsultantRoute({
        method: "GET",
        pathname: "/api/v1/runs/00000000-0000-4000-8000-000000000137/result",
        context,
        application: { getResult } as never,
      }),
    ).rejects.toThrow(/not closed/iu);
  });

  it("rejects a result whose identity differs from the route", async () => {
    const getResult = vi.fn(async () => ({
      projectionTier: "consultant" as const,
      body: {
        ...consultantBody,
        run_id: "00000000-0000-4000-8000-000000000999",
      },
    }));
    await expect(
      handleConsultantRoute({
        method: "GET",
        pathname: "/api/v1/runs/00000000-0000-4000-8000-000000000137/result",
        context,
        application: { getResult } as never,
      }),
    ).rejects.toThrow(/identity is invalid/iu);
  });

  it("does not intercept Standard and fails closed on malformed identifiers", async () => {
    const application = { getResult: vi.fn() } as never;
    await expect(
      handleConsultantRoute({
        method: "GET",
        pathname: "/api/v1/runs/not-a-uuid/result",
        context,
        application,
      }),
    ).rejects.toMatchObject({ status: 403, code: "MB-403-RESOURCE" });
    await expect(
      handleConsultantRoute({
        method: "GET",
        pathname: "/api/v1/runs/00000000-0000-4000-8000-000000000137/result",
        context: { ...context, tier: "standard" },
        application,
      }),
    ).resolves.toBeNull();
  });
});
