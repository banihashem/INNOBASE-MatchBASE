// MB-UX-QUALITY-001 L04: disclose bounded preparation recovery before approval or retry.
export function PreparationRecoveryNotice() {
  return (
    <p className="my-3 text-xs text-slate-300" aria-label="Preparation usage">
      Preparation uses paid AI calls. Each advisory topic and research-plan step
      can use up to 3 attempts to recover from a service or response error.
      Advisory research may switch between configured Gemini and OpenAI models
      using your provider keys through OpenRouter (BYOK). It will not switch to
      OpenRouter credits. All attempts are recorded in your costs. Supplier
      research still requires your research-plan and cost approval.
    </p>
  );
}
