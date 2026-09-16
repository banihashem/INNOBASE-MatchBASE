import test from "node:test";
import assert from "node:assert/strict";
import { retainedProviderRouteRejections } from "../../../packages/application/dist/index.js";

test("MB-UX-QUALITY-001 L15 retains only the latest definitive no-receipt route rejection", () => {
  const failure = {
    http_status: 404,
    request_format: "text",
    category: "privacy",
  };
  const base = {
    requested_model: "anthropic/claude-sonnet-5",
    dispatched: true,
    provider_dispatch_rejected: true,
    provider_receipt_received: false,
    provider_http_failure: failure,
  };
  assert.deepEqual(
    retainedProviderRouteRejections([
      { phase: "advisory", detail: { ...base, state: "failed" } },
      {
        phase: "discovery_anthropic",
        detail: { ...base, state: "failed", error: "privacy route rejected" },
      },
      {
        phase: "discovery_openai",
        detail: {
          ...base,
          requested_model: "openai/gpt-5.2",
          provider_receipt_received: true,
          state: "failed",
        },
      },
      {
        phase: "discovery_openai",
        detail: { ...base, state: "failed", error: "mismatched phase" },
      },
    ]),
    [
      {
        model: "anthropic/claude-sonnet-5",
        phase: "discovery_anthropic",
        error: "privacy route rejected",
        provider_http_failure: failure,
      },
    ],
  );
  assert.deepEqual(
    retainedProviderRouteRejections([
      {
        phase: "discovery_anthropic",
        detail: { ...base, state: "failed" },
      },
      {
        phase: "discovery_anthropic",
        detail: { ...base, state: "completed" },
      },
    ]),
    [],
  );
});

test("MB-UX-QUALITY-001 L17 retains an exact no-receipt focus privacy rejection", () => {
  const failure = {
    http_status: 404,
    request_format: "json_schema",
    category: "privacy",
  };
  assert.deepEqual(
    retainedProviderRouteRejections([
      {
        phase: "research_focus_analysis",
        detail: {
          requested_model: "anthropic/claude-sonnet-5",
          model: "anthropic/claude-sonnet-5",
          state: "failed",
          dispatched: true,
          provider_dispatch_rejected: true,
          provider_receipt_received: false,
          provider_http_failure: failure,
          error: "Provider rejected the request.",
        },
      },
    ]),
    [
      {
        model: "anthropic/claude-sonnet-5",
        phase: "research_focus_analysis",
        error: "Provider rejected the request.",
        provider_http_failure: failure,
      },
    ],
  );
});
