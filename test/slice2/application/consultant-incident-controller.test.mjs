import test from "node:test";
import assert from "node:assert/strict";
import { classifyConsultantIncident } from "../../../packages/application/dist/consultant-incident-controller.js";
test("L05 actual provider restriction shapes remain authority blocks despite retryable flags", () => {
  for (const field of ["provider_http_failure", "provider_failure"]) {
    for (const category of [
      "authentication",
      "billing",
      "privacy",
      "permission",
      "refusal",
    ]) {
      const value = classifyConsultantIncident(
        {
          code: "MB-502-LIVE-PROVIDER",
          retryable: true,
          [field]: { category, http_status: 403 },
        },
        false,
        true,
      );
      assert.equal(value.disposition, "blocked_by_authority");
    }
  }
  assert.equal(
    classifyConsultantIncident({
      code: "MB-502-LIVE-PROVIDER",
      retryable: true,
      provider_failure: { category: "unknown", http_status: 401 },
    }).disposition,
    "blocked_by_authority",
  );
});
test("L05 retained ambiguous effects override ordinary recovery without granting replay", () => {
  assert.equal(
    classifyConsultantIncident({ code: "MB-422-LIVE-JSON" }, false, true)
      .disposition,
    "outcome_unknown",
  );
  assert.equal(
    classifyConsultantIncident(new Error("private request content")).code,
    "UNCLASSIFIED",
  );
  assert.equal(
    classifyConsultantIncident({}, true, true).disposition,
    "cancelled",
  );
  assert.equal(
    classifyConsultantIncident({
      code: "MB-409-MEMORY-REQUOTE",
      retryable: true,
    }).disposition,
    "blocked_by_authority",
  );
});
