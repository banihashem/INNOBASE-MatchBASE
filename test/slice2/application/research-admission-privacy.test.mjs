import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildResearchRoundPlan } from "../../../packages/application/dist/consultant-research-cost.js";

// MB-UX-QUALITY-002 L04: synthetic metadata only; inference is forbidden.
for (const cause of ["privacy", "mixed-pricing", "mixed-unknown"]) {
  test(`MB-UX-QUALITY-002 L04 Ultra admission preserves ${cause} and never substitutes a configured BYOK route`, async (t) => {
    const settings = {
      MATCHBASE_OPENROUTER_API_KEY: randomUUID(),
      MATCHBASE_PROVIDER_ROUTES: "{}",
      MATCHBASE_PROVIDER_GOOGLE: "google-ai-studio",
      MATCHBASE_PROVIDER_OPENAI: "openai",
      MATCHBASE_PROVIDER_ANTHROPIC: "anthropic",
      MATCHBASE_ANTHROPIC_BYOK_RETENTION_ALLOWED: "false",
      MATCHBASE_PROVIDER_DEEPSEEK: "",
      MATCHBASE_PROVIDER_XAI: "",
      MATCHBASE_MODEL_GEMINI: "google/gemini-3.8-flash",
      MATCHBASE_MODEL_OPENAI: "openai/gpt-5.2",
      MATCHBASE_MODEL_PREPARATION: "openai/gpt-5.2",
      MATCHBASE_MODEL_SYNTHESIS: "openai/gpt-5.2",
    };
    const previous = Object.fromEntries(
      Object.keys(settings).map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, settings);
    t.after(() => {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
    const models = [
      settings.MATCHBASE_MODEL_GEMINI,
      settings.MATCHBASE_MODEL_OPENAI,
      "anthropic/claude-sonnet-5",
      "anthropic/claude-sonnet-4.6",
      "deepseek/deepseek-v4-pro-0813",
      "x-ai/grok-4.3",
    ];
    const pricing = { prompt: "0.000001", completion: "0.000002" };
    const supported_parameters = [
      "max_tokens",
      "reasoning",
      "structured_outputs",
    ];
    const provider = (id) =>
      ({
        google: "google-ai-studio",
        openai: "openai",
        anthropic: "anthropic",
        deepseek: "ionstream",
        "x-ai": "xai",
      })[id.split("/")[0]];
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (target, options) => {
      assert.equal(options?.method ?? "GET", "GET");
      const url = String(target);
      assert.ok(
        !url.includes("chat/completions"),
        "Admission must not invoke paid inference",
      );
      calls++;
      if (url.endsWith("/models/user"))
        return Response.json({
          data: models.map((id) => ({ id, pricing, supported_parameters })),
        });
      if (url.endsWith("/endpoints/zdr"))
        return Response.json({
          data: models.map((id) => ({
            model_id: id,
            tag: id.startsWith("anthropic/")
              ? "amazon-bedrock/global"
              : provider(id),
          })),
        });
      assert.ok(url.endsWith("/endpoints"));
      const id = decodeURIComponent(
        new URL(url).pathname.split("/models/")[1].replace(/\/endpoints$/, ""),
      );
      if (id === "anthropic/claude-sonnet-4.6" && cause === "mixed-unknown")
        throw new Error("Synthetic unavailable metadata");
      const endpoints = [
        {
          model_id: id,
          tag: provider(id),
          status: 0,
          pricing,
          supported_parameters,
        },
      ];
      if (id.startsWith("anthropic/")) {
        // A priced hosted credit route exists, but the explicit BYOK selection must not change.
        if (id === "anthropic/claude-sonnet-4.6" && cause === "mixed-pricing")
          endpoints.length = 0;
        endpoints.push({
          model_id: id,
          tag: "amazon-bedrock/global",
          status: 0,
          pricing,
          supported_parameters,
        });
      }
      return Response.json({ data: { endpoints } });
    });
    const input = {
      mode: "live",
      round_number: 1,
      depth: "simple",
      request_hash: "synthetic-approved-request",
      focus_requirements: [],
    };
    if (cause === "privacy")
      await t.test(
        "MB-UX-QUALITY-002 L05 explicit opt-in quotes all five Ultra families while preserving Anthropic BYOK",
        async () => {
          process.env.MATCHBASE_ANTHROPIC_BYOK_RETENTION_ALLOWED = "true";
          const { plan } = await buildResearchRoundPlan({
            ...input,
            research_tier: "ultra",
          });
          assert.equal(plan.research_tier, "ultra");
          assert.deepEqual(
            plan.research_models.map((id) => id.split("/")[0]),
            ["google", "openai", "anthropic", "deepseek", "x-ai"],
          );
          const anthropic = plan.rates.find((rate) =>
            rate.model.startsWith("anthropic/"),
          );
          assert.equal(anthropic.provider, "anthropic");
          assert.equal(anthropic.billing_mode, "byok");
          process.env.MATCHBASE_ANTHROPIC_BYOK_RETENTION_ALLOWED = "false";
        },
      );
    await assert.rejects(
      buildResearchRoundPlan({ ...input, research_tier: "ultra" }),
      (error) => {
        assert.equal(error.status, 422);
        assert.equal(
          error.code,
          cause === "privacy"
            ? "MB-422-RESEARCH-TIER-PRIVACY"
            : "MB-422-RESEARCH-TIER-UNAVAILABLE",
        );
        if (cause === "privacy") {
          assert.match(
            error.message,
            /Anthropic BYOK route is blocked by the current privacy policy/,
          );
          assert.match(
            error.message,
            /Select another available coverage option and request a new estimate/,
          );
        } else
          assert.doesNotMatch(
            error.message,
            /blocked by the current privacy policy/,
          );
        return true;
      },
    );
    for (const tier of ["default", "advanced"]) {
      const { plan } = await buildResearchRoundPlan({
        ...input,
        research_tier: tier,
      });
      assert.equal(plan.research_tier, tier);
      assert.equal(plan.research_models.length, tier === "default" ? 2 : 3);
      assert.ok(
        plan.research_models.every((id) => !id.startsWith("anthropic/")),
      );
    }
    assert.ok(calls > 0);
    assert.equal(process.env.MATCHBASE_PROVIDER_ANTHROPIC, "anthropic");
  });
}
