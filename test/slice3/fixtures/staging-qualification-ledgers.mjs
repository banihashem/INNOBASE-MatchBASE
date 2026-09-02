import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LEDGERS = Object.freeze({
  "v6-40CB8BEE95ABACB012107300": Object.freeze({
    "00-authorization.json": {
      schemaVersion: "matchbase.slice3-staging-live-qualification-session/v1",
      authorizationId: "OWNER-SLICE3-STAGING-LIVE-QUALIFICATION-2026-08-30-V1",
      sessionId: "v6-40CB8BEE95ABACB012107300",
      syntheticOnly: true,
      fixtureId: "S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN",
      maximumExternalHttpCalls: 50,
      maximumProviderModelPosts: 2,
      maximumCostUsd: 100,
      sourceBinding: {
        authorizationSha256:
          "9E61AFB728AE0F77C3E2E129B212D8E82C0D701357BB6B6478D144E70F4A0174",
        productionPolicySha256:
          "46FCAF0C2D2B66F8BAB8526C48E448A24B2E9F65B065AAA99135CA6AF048DB23",
        executorSha256:
          "7F3AB59D6633A324D6AFCF3A1D04077B8004DFB5342EBD69444482131ABE8E3C",
        runnerSha256:
          "B01CD9A96C6A524630CC6987B443D37E55BA903794719D2C98C4290B815ACEE3",
      },
      credentialValuesPersisted: false,
    },
    "1-gemini_direct-reserved.json": {
      schemaVersion:
        "matchbase.slice3-staging-live-qualification-reservation/v1",
      authorizationId: "OWNER-SLICE3-STAGING-LIVE-QUALIFICATION-2026-08-30-V1",
      sessionId: "v6-40CB8BEE95ABACB012107300",
      callNumber: 1,
      routePath: "gemini_direct",
      requestDigest:
        "B1119E253E7D3848B8BC78E113BAFF9125D48468AF75D758B33223FF93584D8D",
      syntheticOnly: true,
      retries: 0,
      fallbacks: 0,
      reservedAt: "2026-08-30T13:12:52.735Z",
    },
    "2-gemini_direct-result.json": {
      schemaVersion: "matchbase.slice3-staging-live-qualification-failure/v1",
      terminalDisposition: "FAIL",
      routePath: "gemini_direct",
      reasonCode: "QUALIFICATION_SEARCH_GROUNDING_FAILED",
      phase: "SEARCH_GROUNDING",
      callOccurred: true,
      httpStatus: 200,
      costState: "conservative_estimate",
      costAmountUsd: 0.011487,
      requestDigest:
        "B1119E253E7D3848B8BC78E113BAFF9125D48468AF75D758B33223FF93584D8D",
      externalHttpCalls: 1,
      providerModelPosts: 1,
      credentialValuesDisclosed: false,
      rawProviderPayloadPersisted: false,
      recordedAt: "2026-08-30T13:13:02.444Z",
    },
  }),
  "v6-4FA7336D74F38010CBEE9D66": Object.freeze({
    "00-authorization.json": {
      schemaVersion:
        "matchbase.slice3-staging-live-qualification-successor-session/v2",
      authorizationId: "OWNER-SLICE3-STAGING-LIVE-QUALIFICATION-2026-08-30-V2",
      sessionId: "v6-4FA7336D74F38010CBEE9D66",
      predecessorSessionId: "v6-40CB8BEE95ABACB012107300",
      syntheticOnly: true,
      maximumExternalHttpCalls: 50,
      maximumProviderModelPosts: 2,
      maximumCostUsd: 99.988513,
      sourceBinding: {
        authorizationSha256:
          "B03158CF54485B1F59D5E96FA8C10FCE5B348B3055A05F0F3F9A55187445BB5F",
        productionPolicySha256:
          "46FCAF0C2D2B66F8BAB8526C48E448A24B2E9F65B065AAA99135CA6AF048DB23",
        predecessorLedgerSha256:
          "DA4F6075133A448C021B49E4FF0CE520FF62FBA0A61D3B64744F4B2CB4504588",
        executorSha256:
          "25C130AD494089DD34D037ACBE3177DBD4B26558EDAFEFD63DFDC4B6019F2E0F",
        runnerSha256:
          "ECBB21C6BAFFA7426D0AC2B6C85BF4670D7C2206736D28B9252923C87310F8C8",
        policyBuilderSha256:
          "7F3AB59D6633A324D6AFCF3A1D04077B8004DFB5342EBD69444482131ABE8E3C",
      },
      credentialValuesPersisted: false,
    },
    "05-terminal-summary.json": {
      schemaVersion:
        "matchbase.slice3-staging-live-qualification-successor-terminal/v2",
      authorizationId: "OWNER-SLICE3-STAGING-LIVE-QUALIFICATION-2026-08-30-V2",
      sessionId: "v6-4FA7336D74F38010CBEE9D66",
      disposition: "FAIL",
      passedRoutePaths: [],
      failedRoutePaths: ["gemini_direct", "openrouter"],
      externalHttpCalls: 4,
      providerModelPosts: 2,
      currentCostUsd: 0.0219995,
      cumulativeProviderModelPosts: 3,
      cumulativeCostUsd: 0.0334865,
      credentialValuesDisclosed: false,
      rawProviderPayloadPersisted: false,
      productionPolicyMutated: false,
      cloudMutations: 0,
      completedAt: "2026-08-30T13:18:09.492Z",
    },
    "1-gemini_direct-reserved.json": {
      schemaVersion:
        "matchbase.slice3-staging-live-qualification-successor-reservation/v2",
      authorizationId: "OWNER-SLICE3-STAGING-LIVE-QUALIFICATION-2026-08-30-V2",
      sessionId: "v6-4FA7336D74F38010CBEE9D66",
      callNumber: 1,
      routePath: "gemini_direct",
      requestDigest:
        "884CC4DB44F0896AE90EAB1081A2C1E845ACD50CB2BB6CC44B95280B37893CFD",
      syntheticOnly: true,
      retries: 0,
      fallbacks: 0,
      reservedAt: "2026-08-30T13:18:00.280Z",
    },
    "2-gemini_direct-result.json": {
      schemaVersion:
        "matchbase.slice3-staging-live-qualification-successor-failure/v2",
      terminalDisposition: "FAIL",
      routePath: "gemini_direct",
      reasonCode: "QUALIFICATION_RESPONSE_PARSE_FAILED",
      phase: "RESPONSE_PARSE",
      callOccurred: true,
      httpStatus: 200,
      searchQueryCount: 1,
      costState: "conservative_estimate",
      costAmountUsd: 0.0219995,
      requestDigest:
        "884CC4DB44F0896AE90EAB1081A2C1E845ACD50CB2BB6CC44B95280B37893CFD",
      externalHttpCalls: 1,
      providerModelPosts: 1,
      credentialValuesDisclosed: false,
      rawProviderPayloadPersisted: false,
      recordedAt: "2026-08-30T13:18:08.631Z",
    },
    "3-openrouter-reserved.json": {
      schemaVersion:
        "matchbase.slice3-staging-live-qualification-successor-reservation/v2",
      authorizationId: "OWNER-SLICE3-STAGING-LIVE-QUALIFICATION-2026-08-30-V2",
      sessionId: "v6-4FA7336D74F38010CBEE9D66",
      callNumber: 2,
      routePath: "openrouter",
      requestDigest:
        "A9B031FD7D09CAE2B2F788135D6979AEB7C640CAFAA8CE0F3AAE382C0B7CB5CB",
      syntheticOnly: true,
      retries: 0,
      fallbacks: 0,
      reservedAt: "2026-08-30T13:18:08.642Z",
    },
    "4-openrouter-result.json": {
      schemaVersion:
        "matchbase.slice3-staging-live-qualification-successor-failure/v2",
      terminalDisposition: "FAIL",
      routePath: "openrouter",
      reasonCode: "QUALIFICATION_HTTP_STATUS_FAILED",
      phase: "HTTP_STATUS",
      callOccurred: true,
      httpStatus: 402,
      searchQueryCount: null,
      costState: "unknown",
      costAmountUsd: null,
      requestDigest:
        "A9B031FD7D09CAE2B2F788135D6979AEB7C640CAFAA8CE0F3AAE382C0B7CB5CB",
      externalHttpCalls: 4,
      providerModelPosts: 2,
      credentialValuesDisclosed: false,
      rawProviderPayloadPersisted: false,
      recordedAt: "2026-08-30T13:18:09.490Z",
    },
  }),
});

export async function materializeQualificationPredecessor(
  stateRoot,
  sessionId,
) {
  const ledger = LEDGERS[sessionId];
  if (!ledger) throw new Error("Unknown qualification predecessor fixture.");
  const directory = join(stateRoot, sessionId);
  await mkdir(directory, { recursive: true });
  await Promise.all(
    Object.entries(ledger).map(([name, value]) =>
      writeFile(join(directory, name), `${JSON.stringify(value, null, 2)}\n`, {
        flag: "wx",
      }),
    ),
  );
  return directory;
}
