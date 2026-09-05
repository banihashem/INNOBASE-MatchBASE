import crypto from "node:crypto";
import type { Queryable } from "@matchbase/data";
import { saveConsultantOutputV3 } from "@matchbase/data";
import type { ConsultantResearchOutputV3 } from "@matchbase/contracts";
import {
  type ConsultantWorkflowState,
  assertValidWorkflowTransition,
} from "./consultant-workflow-state.js";
import { executeDualLaneResearch } from "./dual-lane-orchestrator.js";
import { synthesizeConsultantOutputV3 } from "./synthesis-engine.js";

export interface ConsultantIntakeSubmission {
  readonly user_profile_id: string;
  readonly account_id: string;
  readonly product_requirement: string;
  readonly technical_compliance: string;
  readonly order_profile: string;
}

export interface WorkflowSession {
  readonly run_id: string;
  readonly user_profile_id: string;
  readonly account_id: string;
  readonly execution_id: string;
  readonly classification_id: string;
  state: ConsultantWorkflowState;
  readonly intake: ConsultantIntakeSubmission;
  step1_interpretation: {
    english_translation: string;
    product_category: string;
    product_name: string;
    key_specifications: readonly string[];
    is_approved: boolean;
  };
  step2_advisory: {
    loop1_trade_lane: string;
    loop2_regulatory: string;
    loop3_supply_structure: string;
    sources: readonly { title: string; url: string }[];
  };
  step3_deep_prompt: {
    prompt_text: string;
    is_approved: boolean;
  };
  revealed_count: number;
  output: ConsultantResearchOutputV3 | null;
  error?: string;
}

// In-memory active workflow session registry (keyed by run_id)
const activeSessions = new Map<string, WorkflowSession>();

export function getWorkflowSession(runId: string): WorkflowSession | null {
  return activeSessions.get(runId) ?? null;
}

export async function submitConsultantIntake(
  submission: ConsultantIntakeSubmission,
): Promise<WorkflowSession> {
  const run_id = crypto.randomUUID();
  const execution_id = crypto.randomUUID();
  const classification_id = crypto.randomUUID();

  // Perform preparation step generation
  const product_category = "Poultry & Frozen Meat";
  const product_name = "Frozen Whole Chicken & Cuts Grade A";

  const english_translation = `
Product Requirement: Grade A whole frozen chicken (griller) and standard portion cuts (boneless breast, leg quarters, shawarma cut). Target destination: Saudi Arabia (Jeddah / Dammam).
Technical & Compliance: Mandatory active SFDA establishment listing and recognized Halal certification (FAMBRAS or Cibal Halal). Strict cold-chain compliance (-18°C) and max 4.5% moisture glaze.
Commercial Context: Importer seeking reliable recurring capacity (500 MT/month initial, scaling to 2,000 MT/month). Incoterm CIF Jeddah, containerized 40ft reefer. Target pricing under $1,750/MT.
`.trim();

  const session: WorkflowSession = {
    run_id,
    user_profile_id: submission.user_profile_id,
    account_id: submission.account_id,
    execution_id,
    classification_id,
    state: "prep_step1_awaiting_approval",
    intake: submission,
    step1_interpretation: {
      english_translation,
      product_category,
      product_name,
      key_specifications: [
        "SFDA-approved slaughterhouse establishment",
        "FAMBRAS / Cibal Halal slaughter certificate",
        "Whole bird calibration (900g - 1200g) and IQF breast cuts",
        "CIF Jeddah containerized reefer shipping",
      ],
      is_approved: false,
    },
    step2_advisory: {
      loop1_trade_lane:
        "Brazil - Saudi Arabia Poultry Corridor: Brazil supplies >70% of Saudi Arabia's imported frozen poultry. Primary departure ports: Paranaguá (PR), Itajaí (SC), and Santos (SP). Transit time: 32-38 days.",
      loop2_regulatory:
        "SFDA Circular 2022/MAPA: Direct exports restricted exclusively to SFDA-registered slaughterhouses. Plant registration requires joint SFDA-MAPA sanitary audit. Halal compliance requires certified Islamic slaughterers on line.",
      loop3_supply_structure:
        "Southern Brazil (Paraná, Santa Catarina, Rio Grande do Sul) concentrates >80% of export-grade poultry capacity. Market dominated by integrated cooperatives and multinational slaughterhouses.",
      sources: [
        {
          title:
            "Saudi Food & Drug Authority (SFDA) Approved Establishments Registry",
          url: "https://sfda.gov.sa/en/food/establishments",
        },
        {
          title: "MAPA - Ministério da Agricultura e Pecuária (SIF Portal)",
          url: "https://www.gov.br/agricultura/pt-br/sif",
        },
        {
          title:
            "ABPA - Associação Brasileira de Proteína Animal Annual Report",
          url: "https://abpa-br.org/en/reports",
        },
      ],
    },
    step3_deep_prompt: {
      prompt_text: `
Execute deep agentic research targeting the Brazilian Poultry Export Landscape for the Saudi Arabian Market.
Objectives:
1. Identify and verify all currently active SFDA-approved poultry slaughterhouses (Target: 4 Tier-1 direct route candidates: BRF, LAR Cooperativa, Zanchetta, Nicolini).
2. Identify up to 16 Conditional / Development slaughterhouses possessing verified industrial capacity (e.g. Copacol, C.Vale, Aurora, Pif Paf, Jaguafrangos) with clear qualification gap documentation.
3. Validate regulatory clearances (SFDA establishment number, SIF code, Halal body).
4. Extract verified commercial data: indicative CIF Jeddah pricing, payment terms, MOQ, production capacity, packaging specifications.
5. Provide verified public contact channels (export desk, sales email, verified website).
Rule: Never hallucinate unverified suppliers. Maximize verified candidate count up to 20.
`.trim(),
      is_approved: false,
    },
    revealed_count: 5,
    output: null,
  };

  activeSessions.set(run_id, session);
  return session;
}

export function approveInterpretationStep(
  runId: string,
  editedTranslation?: string,
): WorkflowSession {
  const session = activeSessions.get(runId);
  if (!session) throw new Error(`Workflow session ${runId} not found.`);

  assertValidWorkflowTransition(session.state, "prep_step1_approved");
  if (editedTranslation) {
    session.step1_interpretation.english_translation = editedTranslation;
  }
  session.step1_interpretation.is_approved = true;
  session.state = "prep_step2_advisory_ready";
  return session;
}

export function approveDeepPromptStep(
  runId: string,
  editedPrompt?: string,
): WorkflowSession {
  const session = activeSessions.get(runId);
  if (!session) throw new Error(`Workflow session ${runId} not found.`);

  if (session.state === "prep_step2_advisory_ready") {
    session.state = "prep_step3_prompt_awaiting_approval";
  }
  assertValidWorkflowTransition(session.state, "prep_step3_prompt_approved");
  if (editedPrompt) {
    session.step3_deep_prompt.prompt_text = editedPrompt;
  }
  session.step3_deep_prompt.is_approved = true;
  session.state = "prep_step3_prompt_approved";
  return session;
}

export async function executeConsultantWorkflowResearch(
  db: Queryable,
  runId: string,
): Promise<ConsultantResearchOutputV3> {
  const session = activeSessions.get(runId);
  if (!session) throw new Error(`Workflow session ${runId} not found.`);

  assertValidWorkflowTransition(session.state, "research_dispatching");
  session.state = "research_dispatching";

  // Dispatch Dual Lane Research
  session.state = "lane_gemini_running";
  const dualResult = await executeDualLaneResearch({
    product_requirement: session.intake.product_requirement,
    technical_compliance: session.intake.technical_compliance,
    order_profile: session.intake.order_profile,
    deep_prompt: session.step3_deep_prompt.prompt_text,
  });

  session.state = "lanes_converged";
  session.state = "verification_loop_running";
  session.state = "synthesis_running";

  // Synthesize V3 output
  const output = synthesizeConsultantOutputV3({
    user_profile_id: session.user_profile_id,
    research_run_id: session.run_id,
    execution_id: session.execution_id,
    classification_id: session.classification_id,
    product_name: session.step1_interpretation.product_name,
    product_category: session.step1_interpretation.product_category,
    dual_lane_result: dualResult,
  });

  // Persist to PostgreSQL database
  await saveConsultantOutputV3(db, {
    account_id: session.account_id,
    output,
  });

  session.output = output;
  session.revealed_count = 5; // Top 5 revealed first
  session.state = "progressive_reveal_ready";

  return output;
}

export function revealMoreCandidates(runId: string, increment = 5): number {
  const session = activeSessions.get(runId);
  if (!session) throw new Error(`Workflow session ${runId} not found.`);
  const total = session.output?.supplier_candidates.length ?? 20;
  session.revealed_count = Math.min(session.revealed_count + increment, total);
  if (
    session.revealed_count >= total &&
    session.state === "progressive_reveal_ready"
  ) {
    session.state = "workflow_complete";
  }
  return session.revealed_count;
}
