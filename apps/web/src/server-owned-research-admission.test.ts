import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { WebConfig } from "./config";
import { loadServerOwnedResearchAdmission } from "./server-owned-research-admission";

const stagingPolicyPath = resolve(
  process.cwd(),
  "../../config/slice3/research-route-policy.staging.v1.json",
);

function config(
  liveResearchCredentialsVerified: boolean | undefined,
): WebConfig {
  return {
    environment: "production",
    deploymentEnvironment: "staging",
    origin: "https://matchbase-staging.innobase.app",
    deploymentId: `sha256:${"a".repeat(64)}`,
    databaseUrl: "postgresql://synthetic.invalid/matchbase",
    oidcSimulatorEnabled: false,
    syntheticFixtureEnabled: false,
    liveResearchEnabled: true,
    ...(liveResearchCredentialsVerified === undefined
      ? {}
      : { liveResearchCredentialsVerified }),
    testLivePolicyPath: stagingPolicyPath,
    digestKey: Buffer.alloc(32, 1),
    port: 3000,
  };
}

describe("server-owned live research admission", () => {
  it("admits only Demo after the closed worker-credential marker is verified", () => {
    const admission = loadServerOwnedResearchAdmission(config(true));
    expect(admission.decide("demo")).toMatchObject({
      id: "qualified_live_research",
      liveQualified: true,
    });
    for (const tier of ["standard", "consultant", "admin"] as const) {
      expect(admission.decide(tier)).toMatchObject({
        id: "synthetic_reference",
        liveQualified: false,
      });
    }
  });

  it.each([false, undefined])(
    "fails closed when worker credentials are not verified (%s)",
    (verified) => {
      const admission = loadServerOwnedResearchAdmission(config(verified));
      expect(admission.decide("demo")).toMatchObject({
        id: "synthetic_reference",
        liveQualified: false,
      });
    },
  );

  it("uses the deployment environment rather than the Node runtime label", () => {
    const mismatched: WebConfig = {
      ...config(true),
      deploymentEnvironment: "production",
    };
    expect(
      loadServerOwnedResearchAdmission(mismatched).decide("demo"),
    ).toMatchObject({
      id: "synthetic_reference",
      liveQualified: false,
    });
  });
});
