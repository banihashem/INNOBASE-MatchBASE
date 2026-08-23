import { readFile, writeFile } from "node:fs/promises";

const source =
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNED_ACCEPTANCE_PAYLOAD_SCHEMA_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V5.json";
const target =
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNED_ACCEPTANCE_PAYLOAD_SCHEMA_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V6.json";
const schema = JSON.parse(await readFile(source, "utf8"));

schema.$id =
  "https://matchbase.innobase.app/schemas/role2-detached-acceptance-v6.json";
schema.title =
  "MatchBASE Role 2 V5 Successor-3 Single-GET Detached Acceptance Payload v6";
schema.properties.schemaVersion.const =
  "matchbase.role2-detached-acceptance/v6";
schema.properties.decisionId.const =
  "PO-001-S3-OPENROUTER-V5-CREDENTIAL-GET-S3";
schema.properties.sessionId.const = "v5-DFF5A5718703A502AAF5EA9C";
schema.properties.nonce.const = "A971E3541D959B94E9EACF28D5F3D6B9";

const replay = schema.properties.replayIdentity;
replay.properties.decisionId.const = schema.properties.decisionId.const;
replay.properties.sessionId.const = schema.properties.sessionId.const;
replay.properties.nonce.const = schema.properties.nonce.const;
replay.properties.registryPreSignSha256.const =
  "E28CE25E057EFF410BDCD0812CFC3E43BD6ECBE520DBC07FE1C31BAFA4057A87";
replay.properties.registryPreSignBytes = { const: 671 };
replay.properties.registryPreSignRecordCount = { const: 1 };
replay.properties.registryPreSignLastSequence = { const: 1 };
replay.properties.registryPreSignTailSha256 = {
  const: "D1D0EE0DE2A545D0395427565EB154E0F7B70D93265BF42C3E013D8A705765EB",
};

const governance = schema.properties.governanceBindings;
const newGovernanceKeys = [
  "s2PayloadSchema",
  "s2SigningContract",
  "s2SuccessorAuthorization",
  "recoveryGovernance",
  "s2IndeterminateArchiveManifest",
  "s2IndeterminateArchiveAudit",
  "s2IndeterminateAttemptEvidence",
];
governance.required.splice(
  governance.required.indexOf("forensicArchiveAudit"),
  0,
  ...newGovernanceKeys,
);
for (const key of newGovernanceKeys)
  governance.properties[key] = { $ref: `#/$defs/${key}Binding` };

const binding = (path, sha256, bytes) => ({
  allOf: [
    { $ref: "#/$defs/digestBinding" },
    {
      properties: {
        path: { const: path },
        sha256: { const: sha256 },
        bytes: { const: bytes },
      },
    },
  ],
});
schema.$defs.s2PayloadSchemaBinding = binding(
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNED_ACCEPTANCE_PAYLOAD_SCHEMA_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V5.json",
  "761B079C422AD28A8F846A642D1141622EFC1DB9EB5CF18E28A8C4F3903C8B77",
  27_650,
);
schema.$defs.s2SigningContractBinding = binding(
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_CONTRACT_AMENDMENT_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V5.md",
  "7678893C5AC9FDFB95DF549C6C2AF7BA277DCDADC172B148FCED96757801FD0F",
  8_520,
);
schema.$defs.recoveryGovernanceBinding = binding(
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_S3_SUCCESSOR_REQUIREMENTS_AFTER_S2_LOST_OUTPUT_SIGNING_V1.md",
  "9627F5CC3FDC6D08B91E0C8C8685C9B409A889067B82B689563B596E9B8B29F8",
  7_874,
);
schema.$defs.successorAuthorizationBinding = binding(
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_S3_SUCCESSOR_REQUIREMENTS_AFTER_S2_LOST_OUTPUT_SIGNING_V1.md",
  "9627F5CC3FDC6D08B91E0C8C8685C9B409A889067B82B689563B596E9B8B29F8",
  7_874,
);
schema.$defs.s2IndeterminateArchiveManifestBinding = binding(
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-S2-INDETERMINATE-SIGNING-001\\INDETERMINATE_SESSION_v5-6092A20EE13791B32198C4B6_MANIFEST.json",
  "48B479DADD281D0CFB77A44276DDB7313F27B5BBC316E904D8A9E9EB569B2E72",
  3_602,
);
schema.$defs.s2IndeterminateArchiveAuditBinding = binding(
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_S2_INDETERMINATE_SIGNING_FORENSIC_ARCHIVE_AUDIT_2026-08-23.json",
  "4867AC5D0D06A81312CE0A5FAC0BDFA41D07C6A070DC2CF1D9EC6F6BEBC96B1F",
  3_498,
);
schema.$defs.s2IndeterminateAttemptEvidenceBinding = binding(
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-S2-INDETERMINATE-SIGNING-001\\INDETERMINATE_SESSION_v5-6092A20EE13791B32198C4B6_ATTEMPT_EVIDENCE.json",
  "F976281003E739524FBCA97AEC3FE5E14AF999ED31EFEB112C34D49925B7091B",
  3_009,
);
schema.$defs.s2SuccessorAuthorizationBinding = binding(
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_SUCCESSOR_REQUIREMENTS_AFTER_INVALID_200_SCHEMA_V1.md",
  "A028A2AEFCA11F0002906F7483821C039E9AD82B272DA5235B531A426AC7E98A",
  24_178,
);
schema.$defs.forensicArchiveManifestBinding = binding(
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-INVALID-200-SCHEMA-001\\CONSUMED_SESSION_v5-53676308BAD073D07FFC88B8_MANIFEST.json",
  "21961F79292119938F00E6A1C7888671B021F9821A24C65D08AEC92813E199A9",
  4_940,
);
schema.$defs.forensicArchiveAuditBinding = binding(
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_INVALID_200_SCHEMA_FORENSIC_ARCHIVE_AUDIT_2026-08-23.json",
  "3168FE64F5DC1B73B60E71345533B48141381CAED3D6394F46ECB2BC2CF40043",
  2_321,
);
schema.$defs.officialDocsEvidenceBinding = binding(
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_OPENROUTER_KEY_STATUS_OFFICIAL_DOCS_EVIDENCE_V2_2026-08-23.json",
  "F73071B74AC60D557697ACE6278E1B0091185AFEC065D61C7E4D3CC0900607D4",
  3_901,
);
schema.$defs.officialDocsEvidenceAuditBinding = binding(
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_OPENROUTER_KEY_STATUS_OFFICIAL_DOCS_EVIDENCE_V2_AUDIT_2026-08-23.json",
  "A01BF254BD41CA0896D43F132E97DBEDE2E736FE0E4A3742EB09B060691584C3",
  1_490,
);
schema.$defs.rateLimitAmendmentBinding = binding(
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_SUCCESSOR_GOVERNANCE_AMENDMENT_RATE_LIMIT_REQUESTS_V1.md",
  "AFCC3A48B201393EA9E20F8690B5E604571B71B984B5C618FA3F374FA4551566",
  2_771,
);
schema.$defs.schemaBinding.allOf[1].properties.path.const = target;
schema.$defs.contractBinding.allOf[1].properties.path.const =
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_CONTRACT_AMENDMENT_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V6.md";
schema.properties.reviewEvidence.properties.preSignRole2Audit.allOf[1].properties.path.const =
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_INDEPENDENT_AUDIT_PO_001_SLICE_3_V5_SUCCESSOR_PRE_SIGN_LOOP_3.md";
schema.properties.reviewEvidence.properties.hosted.properties.observationPath.const =
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_GITHUB_HOSTED_OBSERVATION_PO_001_SLICE_3_V5_SUCCESSOR_3.json";
schema.$defs.detachedSignatureEnvelope.properties.schemaVersion.const =
  "matchbase.role2-detached-signature/v6";
schema.$defs.detachedSignatureEnvelope.properties.sessionId.const =
  schema.properties.sessionId.const;

await writeFile(target, `${JSON.stringify(schema, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
