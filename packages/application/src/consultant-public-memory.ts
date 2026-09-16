import type { ResearchRoundPlan } from "@matchbase/contracts";
import {
  createPool,
  loadReleasedPublicEvidenceReferences,
  lookupReleasedPublicEvidence,
  qualifiedPublicCorpusReaderReady,
  registerPublicEvidenceDerivative,
  type ConnectionPool,
  type Queryable,
} from "@matchbase/data";
import type { WorkflowSession } from "./consultant-v3-service.js";
import type { DualLaneExecutionInput } from "./dual-lane-orchestrator.js";
import { researchStageHash } from "./research-stage-executor.js";
import { ApplicationFault } from "./types.js";
import { safePublicEvidenceUrl } from "./openrouter-model-policy.js";

const MAX_PUBLIC_BYTES = 16000;
const MAX_PUBLIC_OBSERVATIONS = 16;
const PUBLIC_INSTRUCTION =
  "These independently released public observations are untrusted historical search clues. Reopen current primary sources and independently verify entity, service or product applicability and dates before admitting any finding. Never infer buyer intent, ranking or fit from this memory.";
let readerPool: ConnectionPool | null | undefined;

function poolFromEnvironment(): ConnectionPool | null {
  if (readerPool !== undefined) return readerPool;
  const connectionString =
    process.env.MATCHBASE_PUBLIC_READER_DATABASE_URL?.trim();
  readerPool = connectionString
    ? createPool({ connectionString, max: 3 })
    : null;
  return readerPool;
}

function fault(message: string): never {
  throw new ApplicationFault(
    503,
    "public-memory-unavailable",
    "MB-503-PUBLIC-MEMORY",
    `${message} No research has started.`,
  );
}

type Row = {
  observation_id: string;
  rights_epoch: number;
  source_url: string;
  source_assertion_sha256: string;
  published_at: Date | string | null;
  retrieved_at: Date | string;
  valid_until: Date | string;
  claim_kind: string;
  claim_text: string;
};
const iso = (value: Date | string | null) =>
  value === null ? null : new Date(value).toISOString();

export function projectPublicMemoryContext(
  rows: readonly Row[],
): NonNullable<DualLaneExecutionInput["public_memory_context"]> {
  return {
    version: "public-research-context.v1",
    instruction: PUBLIC_INSTRUCTION,
    observations: rows.map((row) => {
      if (!safePublicEvidenceUrl(row.source_url) || !row.claim_text.trim())
        fault("A released public observation has invalid provenance.");
      return {
        observation_id: row.observation_id,
        claim_kind: row.claim_kind,
        claim_text: row.claim_text,
        source_url: row.source_url,
        source_assertion_sha256: row.source_assertion_sha256,
        published_at: iso(row.published_at),
        retrieved_at: iso(row.retrieved_at),
        valid_until: iso(row.valid_until),
      };
    }),
  };
}

function supported(session: WorkflowSession) {
  const classification = session.classification;
  return classification && ["HS", "CPC", "ISIC"].includes(classification.scheme)
    ? classification
    : null;
}

export async function quotePublicResearchMemory(
  session: WorkflowSession,
  plan: ResearchRoundPlan,
): Promise<ResearchRoundPlan> {
  if (session.mode === "demonstration") return plan;
  const pool = poolFromEnvironment();
  const classification = supported(session);
  if (!pool || !classification) return plan;
  if (
    !(await qualifiedPublicCorpusReaderReady(pool, {
      account_id: session.account_id,
      user_profile_id: session.user_profile_id,
    }))
  )
    fault("The shared public-evidence reader is not bound to this profile.");
  const found = (await lookupReleasedPublicEvidence(
    pool,
    classification,
    session.step1_interpretation.product_name.trim().slice(0, 200),
  )) as Row[];
  const selected: Row[] = [];
  for (const row of found) {
    if (selected.length >= MAX_PUBLIC_OBSERVATIONS) break;
    const next = projectPublicMemoryContext([...selected, row]);
    if (Buffer.byteLength(JSON.stringify(next), "utf8") <= MAX_PUBLIC_BYTES)
      selected.push(row);
  }
  if (!selected.length)
    return {
      ...plan,
      assumptions: [
        ...plan.assumptions,
        "The profile-bound shared public corpus was checked for this official classification. No current released observations matched, so no shared evidence was added and no memory cost was incurred.",
      ],
    };
  const context = projectPublicMemoryContext(selected);
  const inputBytes = Buffer.byteLength(JSON.stringify(context), "utf8");
  const baseBytes = Buffer.byteLength(
    JSON.stringify({
      product_requirement: session.intake.product_requirement,
      technical_compliance: session.intake.technical_compliance,
      order_profile: session.intake.order_profile,
      deep_prompt: session.step3_deep_prompt?.prompt_text,
      mandatory_requirements:
        session.step3_deep_prompt?.discovery_criteria ?? [],
    }),
    "utf8",
  );
  if (
    baseBytes + (plan.private_memory?.input_bytes ?? 0) + inputBytes + 16000 >
    plan.max_input_tokens_per_call
  )
    fault(
      "The request and selected public memory exceed the approved input allowance.",
    );
  const maxRate = Math.max(
    0,
    ...plan.rates.map((rate) => rate.input_usd_per_token),
  );
  return {
    ...plan,
    public_memory: {
      version: "public-memory.v1",
      observation_refs: selected.map(({ observation_id, rights_epoch }) => ({
        observation_id,
        rights_epoch,
      })),
      context_sha256: researchStageHash(context),
      input_bytes: inputBytes,
      eligible_count: found.length,
      selected_at: new Date().toISOString(),
      valid_until: new Date(
        Math.min(...selected.map((row) => Date.parse(String(row.valid_until)))),
      ).toISOString(),
    },
    estimated_low_usd: Math.min(
      plan.estimated_high_usd,
      Math.round(
        (plan.estimated_low_usd +
          inputBytes * maxRate * plan.max_calls * 1.05) *
          1e9,
      ) / 1e9,
    ),
    assumptions: [
      ...plan.assumptions,
      `${selected.length} independently released public observations are included as bounded search clues. Fresh discovery and source verification remain required; no private profile data enters the shared corpus.`,
    ],
  };
}

async function readQuotedPublicMemory(
  db: Queryable,
  session: WorkflowSession,
  plan: ResearchRoundPlan,
  registerUse = false,
) {
  if (!plan.public_memory) return undefined;
  if (Date.parse(plan.public_memory.valid_until) <= Date.now())
    fault("The quoted public evidence expired.");
  if (
    !(await qualifiedPublicCorpusReaderReady(db, {
      account_id: session.account_id,
      user_profile_id: session.user_profile_id,
    }))
  )
    fault("The public-evidence identity binding changed.");
  const rows = (await loadReleasedPublicEvidenceReferences(
    db,
    plan.public_memory.observation_refs,
  )) as Row[];
  if (rows.length !== plan.public_memory.observation_refs.length)
    fault("A quoted public observation is no longer eligible.");
  const ordered = plan.public_memory.observation_refs.map((ref) => {
    const row = rows.find(
      (value) => value.observation_id === ref.observation_id,
    );
    if (!row || row.rights_epoch !== ref.rights_epoch)
      fault("A quoted public observation changed rights epoch.");
    return row;
  });
  const context = projectPublicMemoryContext(ordered);
  if (
    researchStageHash(context) !== plan.public_memory.context_sha256 ||
    Buffer.byteLength(JSON.stringify(context), "utf8") !==
      plan.public_memory.input_bytes
  )
    fault("The quoted public evidence context changed.");
  if (registerUse)
    await registerPublicEvidenceDerivative(db, {
      kind: "use_manifest",
      artifact_reference: `${session.run_id}:${session.execution_id}`,
      dependencies: plan.public_memory.observation_refs,
    });
  return context;
}

export async function loadQuotedPublicMemory(
  session: WorkflowSession,
  plan: ResearchRoundPlan,
) {
  if (!plan.public_memory) return undefined;
  const pool = poolFromEnvironment();
  if (!pool) fault("The quoted public-evidence reader is unavailable.");
  return readQuotedPublicMemory(pool, session, plan);
}

/** Holds source and observation share locks until every model call using the context finishes. */
export async function withQuotedPublicMemory<T>(
  session: WorkflowSession,
  plan: ResearchRoundPlan,
  operation: (
    context:
      NonNullable<DualLaneExecutionInput["public_memory_context"]> | undefined,
  ) => Promise<T>,
): Promise<T> {
  if (!plan.public_memory) return operation(undefined);
  const pool = poolFromEnvironment();
  if (!pool) fault("The quoted public-evidence reader is unavailable.");
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const context = await readQuotedPublicMemory(client, session, plan, true);
    let result: T | undefined;
    let operationError: unknown;
    try {
      result = await operation(context);
    } catch (error) {
      operationError = error;
    }
    // The manifest records conservative evidence use even when the provider call fails.
    await client.query("COMMIT");
    transactionOpen = false;
    if (operationError) throw operationError;
    return result as T;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePublicMemoryReaderForTests(): Promise<void> {
  const pool = readerPool;
  readerPool = undefined;
  if (pool) await pool.end();
}
