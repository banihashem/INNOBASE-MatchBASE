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
  it("admits Demo and Consultant-depth execution after the closed worker-credential marker is verified", () => {
    const admission = loadServerOwnedResearchAdmission(config(true));
    expect(admission.decide("demo")).toMatchObject({
      id: "qualified_live_research",
      liveQualified: true,
    });
    expect(admission.decide("standard")).toMatchObject({
      id: "synthetic_reference",
      liveQualified: false,
    });
    for (const tier of ["consultant", "admin"] as const)
      expect(admission.decide(tier)).toMatchObject({
        id: "qualified_live_research",
        liveQualified: true,
      });
  });

  it.each([false, undefined])(
    "fails closed when worker credentials are not verified (%s)",
    (verified) => {
      const admission = loadServerOwnedResearchAdmission(config(verified));
      expect(admission.isReady()).toBe(false);
      expect(() => admission.decide("demo")).toThrowError(
        expect.objectContaining({
          status: 503,
          code: "MB-503-LIVE-ADMISSION",
        }),
      );
    },
  );

  it("uses the deployment environment rather than the Node runtime label", () => {
    const mismatched: WebConfig = {
      ...config(true),
      deploymentEnvironment: "production",
    };
    const admission = loadServerOwnedResearchAdmission(mismatched);
    expect(admission.isReady()).toBe(false);
    expect(() => admission.decide("demo")).toThrowError(
      expect.objectContaining({ code: "MB-503-LIVE-ADMISSION" }),
    );
  });
});
