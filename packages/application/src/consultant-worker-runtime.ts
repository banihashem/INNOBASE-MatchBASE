import type { Queryable } from "@matchbase/data";
import { getConfiguredProviderRoute } from "./openrouter-byok-policy.js";
import {
  getConfiguredLiveModels,
  getOpenRouterApiKey,
} from "./openrouter-model-policy.js";

/** MB-UX-PILOT-001 L01: local configuration checks never invoke providers. */
export function assertConsultantWorkerConfiguration(): void {
  if (!getOpenRouterApiKey())
    throw new Error(
      "Consultant worker OpenRouter credential is not configured.",
    );
  const models = getConfiguredLiveModels();
  if (
    !models.lane_gemini.startsWith("google/gemini-") ||
    !models.lane_openai.startsWith("openai/")
  )
    throw new Error(
      "Consultant worker requires separate Gemini and OpenAI models.",
    );
  for (const model of Object.values(models)) getConfiguredProviderRoute(model);
}

export async function consultantWorkflowQueueIsReady(
  database: Queryable,
): Promise<boolean> {
  try {
    const result = await database.query<{ ready: boolean }>(`
      SELECT has_table_privilege(current_user, 'consultant_workflow_job', 'SELECT')
         AND has_table_privilege(current_user, 'consultant_workflow_job', 'UPDATE')
         AND has_table_privilege(current_user, 'consultant_workflow_session', 'SELECT')
         AND has_table_privilege(current_user, 'consultant_workflow_session', 'UPDATE')
         AND has_table_privilege(current_user, 'consultant_workflow_event', 'INSERT') AS ready
    `);
    if (result.rows[0]?.ready !== true) return false;
    await database.query(
      "SELECT job_id, execution_id, stage, status, lease_token, lease_until FROM consultant_workflow_job LIMIT 0",
    );
    return true;
  } catch {
    return false;
  }
}
