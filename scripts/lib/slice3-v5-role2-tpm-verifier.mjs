import {
  createHash,
  createPublicKey,
  verify,
  X509Certificate,
} from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

export const V5_TPM_CONTRACT = Object.freeze({
  keyId: "ROLE2-PO001-S3-V5-TPM-ECDSA-P256-0AED3F3F66C077CB",
  publicPemSha256:
    "5897804885924CE5499494F9D00471A6B1D918671B6D17F7206C6007AFCDF1E4",
  publicSpkiDerSha256:
    "0AED3F3F66C077CBC8774C9707CB6D52906E4A70FF3D5F339D144C9784433465",
  certificateSha256:
    "5674E94E9D2F27AC16D9F0C793D6222F67C4EE4FFEDA0B10D2F9A09D50F99CFB",
  certificateBytes: 414,
  schemaSha256:
    "66C53191D6552990E528834E35033D8F5208F1FFE7CB32FFCEEC6D14AE07F910",
  schemaBytes: 32_757,
  contractSha256:
    "9C35E4BCEE0A74745C31794A2E42A39ABB97F1A44D171399C86A4F612C2B175F",
  contractBytes: 9_955,
  successorAuthorizationSha256:
    "9627F5CC3FDC6D08B91E0C8C8685C9B409A889067B82B689563B596E9B8B29F8",
  successorAuthorizationBytes: 7_874,
  s2SchemaSha256:
    "761B079C422AD28A8F846A642D1141622EFC1DB9EB5CF18E28A8C4F3903C8B77",
  s2SchemaBytes: 27_650,
  s2ContractSha256:
    "7678893C5AC9FDFB95DF549C6C2AF7BA277DCDADC172B148FCED96757801FD0F",
  s2ContractBytes: 8_520,
  s2AuthorizationSha256:
    "A028A2AEFCA11F0002906F7483821C039E9AD82B272DA5235B531A426AC7E98A",
  s2AuthorizationBytes: 24_178,
  s2IndeterminateArchiveManifestSha256:
    "48B479DADD281D0CFB77A44276DDB7313F27B5BBC316E904D8A9E9EB569B2E72",
  s2IndeterminateArchiveManifestBytes: 3_602,
  s2IndeterminateArchiveAuditSha256:
    "4867AC5D0D06A81312CE0A5FAC0BDFA41D07C6A070DC2CF1D9EC6F6BEBC96B1F",
  s2IndeterminateArchiveAuditBytes: 3_498,
  s2IndeterminateAttemptEvidenceSha256:
    "F976281003E739524FBCA97AEC3FE5E14AF999ED31EFEB112C34D49925B7091B",
  s2IndeterminateAttemptEvidenceBytes: 3_009,
  s2IndeterminateArchivedPayloadSha256:
    "C90205AFF3FF1B3402E0A094F8ED4BE7E3B9468C74764823688941D75EDBF010",
  s2IndeterminateArchivedPayloadBytes: 15_097,
  forensicArchiveAuditSha256:
    "3168FE64F5DC1B73B60E71345533B48141381CAED3D6394F46ECB2BC2CF40043",
  forensicArchiveAuditBytes: 2_321,
  forensicArchiveManifestSha256:
    "21961F79292119938F00E6A1C7888671B021F9821A24C65D08AEC92813E199A9",
  forensicArchiveManifestBytes: 4_940,
  officialDocsEvidenceSha256:
    "F73071B74AC60D557697ACE6278E1B0091185AFEC065D61C7E4D3CC0900607D4",
  officialDocsEvidenceBytes: 3_901,
  officialDocsEvidenceAuditSha256:
    "A01BF254BD41CA0896D43F132E97DBEDE2E736FE0E4A3742EB09B060691584C3",
  officialDocsEvidenceAuditBytes: 1_490,
  rateLimitAmendmentSha256:
    "AFCC3A48B201393EA9E20F8690B5E604571B71B984B5C618FA3F374FA4551566",
  rateLimitAmendmentBytes: 2_771,
  v3SchemaSha256:
    "B9F704789FC30F368D8F297A9A5B18E0F5CDD7CBB6CFBD4486AFC746EFC2A68F",
  v3SchemaBytes: 17_449,
  v3ContractSha256:
    "5865910AE5BE6A9E034B8C13BD4F718B3F845156E1E17172A8CC30194E09DDF1",
  v3ContractBytes: 10_431,
  failedAbortSha256:
    "897F9CC0DE146FE50A8D21D758A8BD212F2740E8F39B3E4C992DBC312BE46DC9",
  failedAbortBytes: 2_342,
  failedAuditSha256:
    "D947ED74204868C0AA24DD3C04BABD399062B837C46E2FF8AAB029CBC606610C",
  failedAuditBytes: 8_847,
  archiveManifestSha256:
    "3B27A207346F5E0E8AD2879F1AA2EC49F72C451102E4CFB58C4AED0507066C00",
  archiveManifestBytes: 2_488,
  archivePayloadSha256:
    "092DD4345C6C2C773588F138D21584588E29D2CCB1942A2596483CF053DB0CF4",
  archivePayloadBytes: 13_317,
  archiveEnvelopeSha256:
    "55AA88224249D105CBC97C0D4EF6828ED32240EC4ABF35D186E1680F29A0D1D0",
  archiveEnvelopeBytes: 407,
  supersessionSha256:
    "E15A8DA74FD84AA758C05B65D84935554AAFEF4DC71C479AF26D0248B650B90E",
  supersessionBytes: 915,
  custodySha256:
    "2E0FF67F9D7E0E9524B101F0EF3BB35B13F788D2FE035A113418031B0B1FD5C1",
  custodyBytes: 4_273,
  transitionSha256:
    "0967EE2C5AB9C7E7779F3E8AD2C2B1EF2AE528B6BC0CD54B7A7955A00246E911",
  transitionBytes: 4_375,
  signatureProtocolVersion: "V1",
  payloadPath:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\V5_OPENROUTER_CREDENTIAL_GET_AUTHORIZATION_PAYLOAD.json",
  envelopePath:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\V5_OPENROUTER_CREDENTIAL_GET_AUTHORIZATION_SIGNATURE.json",
  stateRoot:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-live-qualification-state",
  replayRegistryPath:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.role2-signing-replay-registry\\consumed-v5.jsonl",
  workspaceClaim: "C:\\INNOBASE\\MatchBASE|banihashem/INNOBASE-MatchBASE|main",
  repositoryPath:
    "C:\\INNOBASE\\MatchBASE\\03_Implementation\\INNOBASE-MatchBASE",
  authoritativeRoot: "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources",
  managementLogPath:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\PRODUCT_MANAGEMENT_LOOP_LOG.md",
  decisionId: "PO-001-S3-OPENROUTER-V5-CREDENTIAL-GET-S3",
  sessionId: "v5-DFF5A5718703A502AAF5EA9C",
  nonce: "A971E3541D959B94E9EACF28D5F3D6B9",
  replayPreSignSha256:
    "E28CE25E057EFF410BDCD0812CFC3E43BD6ECBE520DBC07FE1C31BAFA4057A87",
  replayPreSignBytes: 671,
  replayPreSignRecordCount: 1,
  replayPreSignLastSequence: 1,
  replayPreSignTailSha256:
    "D1D0EE0DE2A545D0395427565EB154E0F7B70D93265BF42C3E013D8A705765EB",
  endpoint: "https://openrouter.ai/api/v1/key",
  lifetimeSeconds: 900,
});

const SIGNATURE_DOMAIN_TEXT =
  "INNOBASE-MATCHBASE\0ROLE2\0PO-001-S3-V5-CREDENTIAL-GET-S3\0ECDSA-P256-SHA256\0V1\0";

export const V5_AUTHORITATIVE_SOURCE_PATHS = Object.freeze([
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources\\IB-BrdDev-VisIdn-V1R1.pdf",
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources\\OutputTemplate\\INNOBASE_MatchBASE_Supplier_Landscape_Final_Report_Template_v1.0.pdf",
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources\\ProductDefinationInstruction\\INNOBASE-AI Product Design Framework- V3.0.docx",
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources\\ProductDefinationInstruction\\INNOBASE-MatchBASE Request Structuring Framework.docx",
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources\\ProductDefinationInstruction\\INNOBASE—MatchBASE_Concept_Layer - EBanEdition.pdf",
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources\\ProductDefinationInstruction\\INNOBASE—MatchBASE_Logic_Charter - EBanEdition.pdf",
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources\\ProductDefinationInstruction\\MatchBASE_Industrial_Product_Query_Classifier_Prompt_v2.0.docx",
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources\\Research\\MatchBASE Implementation Blueprint Research.md",
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources\\Research\\compass_artifact_wf-6dbf86d9-4075-558e-8abd-5f033474b5fc_text_markdown.md",
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources\\Samples\\Input\\Brazil-to-Saudi Frozen Poultry Sourcing Opportunity.pdf",
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources\\Samples\\Input\\GCC-to-Saudi Frozen Poultry Sourcing Opportunity.pdf",
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources\\Samples\\Output\\INNOBASE_MatchBASE_Brazil_Saudi_Poultry_Supplier_Landscape.docx",
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources\\Samples\\Output\\INNOBASE_MatchBASE_GCC_Saudi_Poultry_Supplier_Landscape.docx",
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources\\Samples\\Output\\MatchBASE_Ariston_UAE_Supplier_Verification_Report_2026-07-14.docx",
]);

export const V5_DISCIPLINE_AUDIT_PATHS = Object.freeze([
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_SUCCESSOR_3_AUDIT_AI_EVIDENCE.json",
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_SUCCESSOR_3_AUDIT_DATA_MIGRATION.json",
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_SUCCESSOR_3_AUDIT_QA_ACCESSIBILITY.json",
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_SUCCESSOR_3_AUDIT_REPOSITORY_RELEASE_PRESERVATION.json",
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_SUCCESSOR_3_AUDIT_SECURITY_PRIVACY_IAM.json",
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_SUCCESSOR_3_AUDIT_SRE_COST_RECOVERY.json",
]);

export const V5_FIXED_SIGNED_PATHS = Object.freeze({
  candidateManifest:
    "C:\\INNOBASE\\MatchBASE\\03_Implementation\\INNOBASE-MatchBASE\\evidence\\slice3\\candidate-manifest.json",
  candidateWrapper:
    "C:\\INNOBASE\\MatchBASE\\03_Implementation\\INNOBASE-MatchBASE\\evidence\\slice3\\full-wrapper-result.json",
  critic:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_SUCCESSOR_3_FINAL_INTEGRATION_CRITIC.json",
  responseContract:
    "C:\\INNOBASE\\MatchBASE\\03_Implementation\\INNOBASE-MatchBASE\\config\\slice3\\openrouter-key-status-response-contract.v2.json",
});

const PUBLIC_MATERIALS = Object.freeze({
  repositoryPem: resolve("config/slice3/role2-v5-tpm-ecdsa-p256-public.pem"),
  managementPem:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_AUTHORITY_PO_001_SLICE_3_V5_TPM_ECDSA_P256_PUBLIC.pem",
  managementCer:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_AUTHORITY_PO_001_SLICE_3_V5_TPM_ECDSA_P256_PUBLIC.cer",
  schema:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNED_ACCEPTANCE_PAYLOAD_SCHEMA_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V6.json",
  contract:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_CONTRACT_AMENDMENT_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V6.md",
  successorAuthorization:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_S3_SUCCESSOR_REQUIREMENTS_AFTER_S2_LOST_OUTPUT_SIGNING_V1.md",
  s2Schema:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNED_ACCEPTANCE_PAYLOAD_SCHEMA_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V5.json",
  s2Contract:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_CONTRACT_AMENDMENT_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V5.md",
  s2SuccessorAuthorization:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_SUCCESSOR_REQUIREMENTS_AFTER_INVALID_200_SCHEMA_V1.md",
  s2IndeterminateArchiveManifest:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-S2-INDETERMINATE-SIGNING-001\\INDETERMINATE_SESSION_v5-6092A20EE13791B32198C4B6_MANIFEST.json",
  s2IndeterminateArchiveAudit:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_S2_INDETERMINATE_SIGNING_FORENSIC_ARCHIVE_AUDIT_2026-08-23.json",
  s2IndeterminateAttemptEvidence:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-S2-INDETERMINATE-SIGNING-001\\INDETERMINATE_SESSION_v5-6092A20EE13791B32198C4B6_ATTEMPT_EVIDENCE.json",
  s2IndeterminateArchivedPayload:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-S2-INDETERMINATE-SIGNING-001\\INDETERMINATE_SESSION_v5-6092A20EE13791B32198C4B6_PAYLOAD.json",
  forensicArchiveAudit:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_INVALID_200_SCHEMA_FORENSIC_ARCHIVE_AUDIT_2026-08-23.json",
  forensicArchiveManifest:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-INVALID-200-SCHEMA-001\\CONSUMED_SESSION_v5-53676308BAD073D07FFC88B8_MANIFEST.json",
  officialDocsEvidence:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_OPENROUTER_KEY_STATUS_OFFICIAL_DOCS_EVIDENCE_V2_2026-08-23.json",
  officialDocsEvidenceAudit:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_OPENROUTER_KEY_STATUS_OFFICIAL_DOCS_EVIDENCE_V2_AUDIT_2026-08-23.json",
  rateLimitAmendment:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_SUCCESSOR_GOVERNANCE_AMENDMENT_RATE_LIMIT_REQUESTS_V1.md",
  v3Schema:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNED_ACCEPTANCE_PAYLOAD_SCHEMA_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V3.json",
  v3Contract:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_CONTRACT_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V3.md",
  failedAbort:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_PRE_SIGN_ABORT_HOSTED_TIME_BINDING_2026-08-22.md",
  failedAudit:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_INDEPENDENT_AUDIT_PO_001_SLICE_3_V5_SUCCESSOR_PRE_SIGN.md",
  archiveManifest:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-HOSTED-TIME-BINDING-001\\INVALID_SESSION_v5-968A9D69D38203E2E8B1375A_MANIFEST.json",
  archivePayload:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-HOSTED-TIME-BINDING-001\\INVALID_SESSION_v5-968A9D69D38203E2E8B1375A_PAYLOAD.json",
  archiveEnvelope:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-HOSTED-TIME-BINDING-001\\INVALID_SESSION_v5-968A9D69D38203E2E8B1375A_SIGNATURE.json",
  supersession:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_CONTRACT_V2_SUPERSESSION_PO_001_SLICE_3_V5.md",
  custody:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_TPM_ECDSA_P256_CUSTODY_EVIDENCE_PO_001_SLICE_3_V5.json",
  transition:
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\OWNER_DELEGATED_DECISION_PO_001_SLICE_3_V5_TPM_ECDSA_P256_TRANSITION.md",
});

const SHA1 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[A-F0-9]{64}$/u;
const SESSION = /^v5-[A-F0-9]{24}$/u;
const NONCE = /^[A-F0-9]{32}$/u;
const UTC_SECOND =
  /^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/u;
const ABSOLUTE_WINDOWS_PATH = /^[A-Za-z]:\\/u;
const P256_ORDER = BigInt(
  "0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551",
);
const P256_HALF_ORDER = P256_ORDER / 2n;

const TOP_LEVEL_KEYS = Object.freeze([
  "schemaVersion",
  "payloadType",
  "decisionId",
  "sessionId",
  "payloadPath",
  "signatureEnvelopePath",
  "issuedAt",
  "expiresAt",
  "nonce",
  "stateRoot",
  "replayIdentity",
  "repository",
  "candidate",
  "governanceBindings",
  "authoritativeSourceSet",
  "managementLogPrefix",
  "reviewEvidence",
  "authorizationPolicy",
  "preservation",
]);

const ENVELOPE_KEYS = Object.freeze([
  "schemaVersion",
  "sessionId",
  "replayIdentitySha256",
  "payloadSha256",
  "signature",
  "signedAt",
]);

const AFTER_LOCK_RECHECKS = Object.freeze([
  "SIGNATURE_VALID",
  "PAYLOAD_UNEXPIRED",
  "ALL_DIGEST_BINDINGS_CURRENT",
  "REPOSITORY_CLEAN_PARITY_CURRENT",
  "HOSTED_IDENTITY_MATCH",
  "STATE_ROOT_CANONICAL",
  "SESSION_ABSENT",
  "REPLAY_IDENTITY_UNUSED",
  "CALL_COUNTER_ZERO",
  "CREDENTIAL_HANDLE_PRESENT_WITHOUT_VALUE_READ",
]);

const PRE_SEND_RECHECKS = Object.freeze([
  "PARENT_LOCK_STILL_OWNED",
  "SIGNATURE_VALID",
  "PAYLOAD_UNEXPIRED",
  "DURABLE_REPLAY_RESERVATION_PRESENT",
  "DURABLE_ONE_USE_CALL_RESERVATION_PRESENT",
  "SESSION_ID_MATCH",
  "METHOD_URL_POLICY_MATCH",
  "REDIRECT_RETRY_FALLBACK_ZERO",
  "TIMEOUT_10000_MS",
  "BODY_LIMIT_32768",
  "NO_NETWORK_BYTES_PREVIOUSLY_SENT",
]);

const PROHIBITED = Object.freeze([
  "CREDENTIAL_VALUE_OUTPUT",
  "CREDENTIAL_VALUE_PERSISTENCE",
  "AUTHORIZATION_HEADER_LOGGING",
  "RAW_RESPONSE_PERSISTENCE",
  "MODEL_GENERATION",
  "WEB_SEARCH",
  "RETRY",
  "REDIRECT",
  "FALLBACK",
  "CREDENTIAL_MUTATION",
  "ACCOUNT_MUTATION",
  "CLOUD_MUTATION",
  "DEPLOYMENT_MUTATION",
  "REPOSITORY_MUTATION",
]);

export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex").toUpperCase();

async function checkedPublicBytes(path, root, expectedBytes, expectedSha256) {
  const rootReal = await realpath(root);
  const item = await lstat(path);
  const fileReal = await realpath(path);
  const difference = relative(rootReal, fileReal);
  if (
    !item.isFile() ||
    item.isSymbolicLink() ||
    item.nlink !== 1 ||
    !difference ||
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    resolve(rootReal, difference) !== fileReal
  )
    throw new Error("V5 public material escaped its fixed root.");
  const bytes = await readFile(fileReal);
  if (bytes.length !== expectedBytes || sha256(bytes) !== expectedSha256)
    throw new Error("V5 public material digest or size drifted.");
  return bytes;
}

async function assertCanonicalNonReparseDirectory(path) {
  const item = await lstat(path);
  if (
    !item.isDirectory() ||
    item.isSymbolicLink() ||
    (await realpath(path)) !== resolve(path)
  )
    throw new Error("V5 preservation directory identity is invalid.");
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$item=Get-Item -LiteralPath $env:MATCHBASE_V5_PATH -Force; if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){exit 9}",
      ],
      {
        env: { ...process.env, MATCHBASE_V5_PATH: path },
        windowsHide: true,
      },
    );
    if (result.status !== 0)
      throw new Error("V5 preservation directory is reparse-backed.");
  }
}

export async function assertV5ArchiveRootIdentity(path) {
  await assertCanonicalNonReparseDirectory(path);
  return true;
}

function readDerTlv(bytes, offset) {
  if (offset + 2 > bytes.length)
    throw new Error("V5 certificate DER is truncated.");
  const tag = bytes[offset];
  const firstLength = bytes[offset + 1];
  let length;
  let contentOffset;
  if ((firstLength & 0x80) === 0) {
    length = firstLength;
    contentOffset = offset + 2;
  } else {
    const lengthBytes = firstLength & 0x7f;
    if (
      lengthBytes < 1 ||
      lengthBytes > 4 ||
      offset + 2 + lengthBytes > bytes.length
    )
      throw new Error("V5 certificate DER length is invalid.");
    length = 0;
    for (let index = 0; index < lengthBytes; index += 1)
      length = length * 256 + bytes[offset + 2 + index];
    contentOffset = offset + 2 + lengthBytes;
  }
  const end = contentOffset + length;
  if (end > bytes.length)
    throw new Error("V5 certificate DER value is truncated.");
  return Object.freeze({ tag, contentOffset, end, next: end });
}

function derChildren(bytes, tlv) {
  const children = [];
  for (let offset = tlv.contentOffset; offset < tlv.end;) {
    const child = readDerTlv(bytes, offset);
    children.push(child);
    offset = child.next;
  }
  return children;
}

function exactCertificateKeyUsage(certificateBytes) {
  const certificate = readDerTlv(certificateBytes, 0);
  if (certificate.tag !== 0x30 || certificate.end !== certificateBytes.length)
    return false;
  const certificateChildren = derChildren(certificateBytes, certificate);
  const tbs = certificateChildren[0];
  const signatureAlgorithm = certificateChildren[1];
  if (tbs?.tag !== 0x30 || signatureAlgorithm?.tag !== 0x30) return false;
  const signatureOid = derChildren(certificateBytes, signatureAlgorithm)[0];
  if (
    signatureOid?.tag !== 0x06 ||
    certificateBytes
      .subarray(signatureOid.contentOffset, signatureOid.end)
      .toString("hex") !== "2a8648ce3d040302"
  )
    return false;
  const extensions = derChildren(certificateBytes, tbs).find(
    ({ tag }) => tag === 0xa3,
  );
  if (!extensions) return false;
  const extensionSequence = derChildren(certificateBytes, extensions)[0];
  if (extensionSequence?.tag !== 0x30) return false;
  const keyUsage = derChildren(certificateBytes, extensionSequence).find(
    (extension) => {
      if (extension.tag !== 0x30) return false;
      const oid = derChildren(certificateBytes, extension)[0];
      return (
        oid?.tag === 0x06 &&
        certificateBytes
          .subarray(oid.contentOffset, oid.end)
          .toString("hex") === "551d0f"
      );
    },
  );
  if (!keyUsage) return false;
  const fields = derChildren(certificateBytes, keyUsage);
  if (fields.length !== 3 || fields[1].tag !== 0x01 || fields[2].tag !== 0x04)
    return false;
  const critical = certificateBytes.subarray(
    fields[1].contentOffset,
    fields[1].end,
  );
  const encodedUsage = certificateBytes.subarray(
    fields[2].contentOffset,
    fields[2].end,
  );
  const usage = readDerTlv(encodedUsage, 0);
  return (
    critical.length === 1 &&
    critical[0] === 0xff &&
    usage.tag === 0x03 &&
    usage.end === encodedUsage.length &&
    encodedUsage
      .subarray(usage.contentOffset, usage.end)
      .equals(Buffer.from([0x07, 0x80]))
  );
}

export async function verifyPinnedV5PublicMaterials() {
  const repositoryRoot = resolve(".");
  const managementRoot = dirname(PUBLIC_MATERIALS.managementPem);
  const archiveRoot = dirname(PUBLIC_MATERIALS.archiveManifest);
  const invalid200ArchiveRoot = dirname(
    PUBLIC_MATERIALS.forensicArchiveManifest,
  );
  const indeterminateArchiveRoot = dirname(
    PUBLIC_MATERIALS.s2IndeterminateArchiveManifest,
  );
  await Promise.all([
    assertCanonicalNonReparseDirectory(managementRoot),
    assertCanonicalNonReparseDirectory(
      resolve(managementRoot, ".slice3-v5-signing"),
    ),
    assertCanonicalNonReparseDirectory(dirname(archiveRoot)),
    assertCanonicalNonReparseDirectory(archiveRoot),
    assertV5ArchiveRootIdentity(dirname(invalid200ArchiveRoot)),
    assertV5ArchiveRootIdentity(invalid200ArchiveRoot),
    assertV5ArchiveRootIdentity(dirname(indeterminateArchiveRoot)),
    assertV5ArchiveRootIdentity(indeterminateArchiveRoot),
  ]);
  const indeterminateMembers = (
    await readdir(indeterminateArchiveRoot, { withFileTypes: true })
  )
    .map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
    }))
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
  const expectedIndeterminateMembers = [
    "INDETERMINATE_SESSION_v5-6092A20EE13791B32198C4B6_ATTEMPT_EVIDENCE.json",
    "INDETERMINATE_SESSION_v5-6092A20EE13791B32198C4B6_MANIFEST.json",
    "INDETERMINATE_SESSION_v5-6092A20EE13791B32198C4B6_PAYLOAD.json",
  ];
  if (
    indeterminateMembers.length !== expectedIndeterminateMembers.length ||
    indeterminateMembers.some(
      ({ name, isFile, isSymbolicLink }, index) =>
        name !== expectedIndeterminateMembers[index] ||
        !isFile ||
        isSymbolicLink,
    )
  )
    throw new Error("V5 S2 indeterminate archive member set is invalid.");
  const [repositoryPem, managementPem, certificateBytes] = await Promise.all([
    checkedPublicBytes(
      PUBLIC_MATERIALS.repositoryPem,
      repositoryRoot,
      178,
      V5_TPM_CONTRACT.publicPemSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.managementPem,
      managementRoot,
      178,
      V5_TPM_CONTRACT.publicPemSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.managementCer,
      managementRoot,
      V5_TPM_CONTRACT.certificateBytes,
      V5_TPM_CONTRACT.certificateSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.schema,
      managementRoot,
      V5_TPM_CONTRACT.schemaBytes,
      V5_TPM_CONTRACT.schemaSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.contract,
      managementRoot,
      V5_TPM_CONTRACT.contractBytes,
      V5_TPM_CONTRACT.contractSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.successorAuthorization,
      managementRoot,
      V5_TPM_CONTRACT.successorAuthorizationBytes,
      V5_TPM_CONTRACT.successorAuthorizationSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.s2Schema,
      managementRoot,
      V5_TPM_CONTRACT.s2SchemaBytes,
      V5_TPM_CONTRACT.s2SchemaSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.s2Contract,
      managementRoot,
      V5_TPM_CONTRACT.s2ContractBytes,
      V5_TPM_CONTRACT.s2ContractSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.s2SuccessorAuthorization,
      managementRoot,
      V5_TPM_CONTRACT.s2AuthorizationBytes,
      V5_TPM_CONTRACT.s2AuthorizationSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.s2IndeterminateArchiveManifest,
      managementRoot,
      V5_TPM_CONTRACT.s2IndeterminateArchiveManifestBytes,
      V5_TPM_CONTRACT.s2IndeterminateArchiveManifestSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.s2IndeterminateArchiveAudit,
      managementRoot,
      V5_TPM_CONTRACT.s2IndeterminateArchiveAuditBytes,
      V5_TPM_CONTRACT.s2IndeterminateArchiveAuditSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.s2IndeterminateAttemptEvidence,
      managementRoot,
      V5_TPM_CONTRACT.s2IndeterminateAttemptEvidenceBytes,
      V5_TPM_CONTRACT.s2IndeterminateAttemptEvidenceSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.s2IndeterminateArchivedPayload,
      managementRoot,
      V5_TPM_CONTRACT.s2IndeterminateArchivedPayloadBytes,
      V5_TPM_CONTRACT.s2IndeterminateArchivedPayloadSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.forensicArchiveAudit,
      managementRoot,
      V5_TPM_CONTRACT.forensicArchiveAuditBytes,
      V5_TPM_CONTRACT.forensicArchiveAuditSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.forensicArchiveManifest,
      managementRoot,
      V5_TPM_CONTRACT.forensicArchiveManifestBytes,
      V5_TPM_CONTRACT.forensicArchiveManifestSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.officialDocsEvidence,
      managementRoot,
      V5_TPM_CONTRACT.officialDocsEvidenceBytes,
      V5_TPM_CONTRACT.officialDocsEvidenceSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.officialDocsEvidenceAudit,
      managementRoot,
      V5_TPM_CONTRACT.officialDocsEvidenceAuditBytes,
      V5_TPM_CONTRACT.officialDocsEvidenceAuditSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.rateLimitAmendment,
      managementRoot,
      V5_TPM_CONTRACT.rateLimitAmendmentBytes,
      V5_TPM_CONTRACT.rateLimitAmendmentSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.v3Schema,
      managementRoot,
      V5_TPM_CONTRACT.v3SchemaBytes,
      V5_TPM_CONTRACT.v3SchemaSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.v3Contract,
      managementRoot,
      V5_TPM_CONTRACT.v3ContractBytes,
      V5_TPM_CONTRACT.v3ContractSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.failedAbort,
      managementRoot,
      V5_TPM_CONTRACT.failedAbortBytes,
      V5_TPM_CONTRACT.failedAbortSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.failedAudit,
      managementRoot,
      V5_TPM_CONTRACT.failedAuditBytes,
      V5_TPM_CONTRACT.failedAuditSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.archiveManifest,
      managementRoot,
      V5_TPM_CONTRACT.archiveManifestBytes,
      V5_TPM_CONTRACT.archiveManifestSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.archivePayload,
      managementRoot,
      V5_TPM_CONTRACT.archivePayloadBytes,
      V5_TPM_CONTRACT.archivePayloadSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.archiveEnvelope,
      managementRoot,
      V5_TPM_CONTRACT.archiveEnvelopeBytes,
      V5_TPM_CONTRACT.archiveEnvelopeSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.supersession,
      managementRoot,
      V5_TPM_CONTRACT.supersessionBytes,
      V5_TPM_CONTRACT.supersessionSha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.custody,
      managementRoot,
      V5_TPM_CONTRACT.custodyBytes,
      V5_TPM_CONTRACT.custodySha256,
    ),
    checkedPublicBytes(
      PUBLIC_MATERIALS.transition,
      managementRoot,
      V5_TPM_CONTRACT.transitionBytes,
      V5_TPM_CONTRACT.transitionSha256,
    ),
  ]);
  if (
    !repositoryPem.equals(managementPem) ||
    !exactCertificateKeyUsage(certificateBytes)
  )
    throw new Error("V5 certificate/SPKI equality or Key Usage is invalid.");
  const pemKey = createPublicKey(repositoryPem);
  const certificate = new X509Certificate(certificateBytes);
  const pemDer = pemKey.export({ type: "spki", format: "der" });
  const certificateDer = certificate.publicKey.export({
    type: "spki",
    format: "der",
  });
  if (
    pemKey.asymmetricKeyType !== "ec" ||
    pemKey.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
    certificate.publicKey.asymmetricKeyType !== "ec" ||
    certificate.publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
    !pemDer.equals(certificateDer) ||
    sha256(pemDer) !== V5_TPM_CONTRACT.publicSpkiDerSha256 ||
    certificate.fingerprint256.replaceAll(":", "") !==
      V5_TPM_CONTRACT.certificateSha256 ||
    certificate.subject !==
      "CN=INNOBASE MatchBASE Role2 V5 TPM Signing Authority 20260822" ||
    certificate.issuer !== certificate.subject ||
    new Date(certificate.validFrom).toISOString() !==
      "2026-08-22T10:38:41.000Z" ||
    new Date(certificate.validTo).toISOString() !==
      "2027-08-22T10:44:09.000Z" ||
    certificate.verify(certificate.publicKey) !== true
  )
    throw new Error("V5 certificate public identity or metadata is invalid.");
  return Object.freeze({
    publicKeyPem: repositoryPem,
    publicKey: pemKey,
    certificateBytes,
  });
}

function closed(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  )
    throw new Error(`${label} is not closed.`);
}

function assertValidUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new Error("JCS input contains an unpaired surrogate.");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error("JCS input contains an unpaired surrogate.");
    }
  }
}

function jcsValue(value, stack) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JCS number is not finite.");
    return JSON.stringify(value);
  }
  if (!value || typeof value !== "object")
    throw new Error("JCS input contains an unsupported value.");
  if (stack.has(value)) throw new Error("JCS input is cyclic.");
  stack.add(value);
  try {
    if (Array.isArray(value))
      return `[${value.map((item) => jcsValue(item, stack)).join(",")}]`;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error("JCS input is not a plain JSON object.");
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => {
        assertValidUnicode(key);
        return `${JSON.stringify(key)}:${jcsValue(value[key], stack)}`;
      })
      .join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

export function rfc8785Canonicalize(value) {
  return jcsValue(value, new Set());
}

function canonicalUtcMs(value, label) {
  if (typeof value !== "string" || !UTC_SECOND.test(value))
    throw new Error(`${label} is not canonical whole-second UTC.`);
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().replace(".000Z", "Z") !== value
  )
    throw new Error(`${label} is not a valid calendar instant.`);
  return milliseconds;
}

function digestBinding(value, label, expected = {}) {
  closed(value, ["path", "sha256", "bytes"], label);
  if (
    typeof value.path !== "string" ||
    !ABSOLUTE_WINDOWS_PATH.test(value.path) ||
    !SHA256.test(value.sha256) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    (expected.path !== undefined && value.path !== expected.path) ||
    (expected.sha256 !== undefined && value.sha256 !== expected.sha256) ||
    (expected.bytes !== undefined && value.bytes !== expected.bytes)
  )
    throw new Error(`${label} binding is invalid.`);
}

function passBinding(value, label) {
  closed(
    value,
    ["path", "sha256", "bytes", "status", "critical", "major", "minor"],
    label,
  );
  digestBinding(
    { path: value.path, sha256: value.sha256, bytes: value.bytes },
    label,
  );
  if (
    value.status !== "PASS" ||
    value.critical !== 0 ||
    value.major !== 0 ||
    value.minor !== 0
  )
    throw new Error(`${label} is not PASS 0/0/0.`);
}

function historicalLedger(value, label, root, digest) {
  closed(value, ["root", "evidenceDigest", "digestSemantics"], label);
  if (
    value.root !== root ||
    value.evidenceDigest !== digest ||
    value.digestSemantics !==
      "HISTORICAL_IMMUTABLE_LEDGER_DIGEST_AS_RECORDED_IN_GOVERNING_ALLOCATION"
  )
    throw new Error(`${label} binding is invalid.`);
}

function assertExactArray(value, expected, label) {
  if (JSON.stringify(value) !== JSON.stringify(expected))
    throw new Error(`${label} is invalid or reordered.`);
}

function validateReplayIdentity(value, sessionId, nonce) {
  closed(
    value,
    [
      "workspaceClaim",
      "canonicalNonClonedWorkspaceOnly",
      "decisionId",
      "sessionId",
      "nonce",
      "keyId",
      "registryPath",
      "registryPreSignSha256",
      "registryPreSignBytes",
      "registryPreSignRecordCount",
      "registryPreSignLastSequence",
      "registryPreSignTailSha256",
      "nonceAbsentBeforeSign",
    ],
    "V5 replay identity",
  );
  if (
    value.workspaceClaim !== V5_TPM_CONTRACT.workspaceClaim ||
    value.canonicalNonClonedWorkspaceOnly !== true ||
    value.decisionId !== V5_TPM_CONTRACT.decisionId ||
    value.sessionId !== sessionId ||
    value.nonce !== nonce ||
    value.keyId !== V5_TPM_CONTRACT.keyId ||
    value.registryPath !== V5_TPM_CONTRACT.replayRegistryPath ||
    value.registryPreSignSha256 !== V5_TPM_CONTRACT.replayPreSignSha256 ||
    value.registryPreSignBytes !== V5_TPM_CONTRACT.replayPreSignBytes ||
    value.registryPreSignRecordCount !==
      V5_TPM_CONTRACT.replayPreSignRecordCount ||
    value.registryPreSignLastSequence !==
      V5_TPM_CONTRACT.replayPreSignLastSequence ||
    value.registryPreSignTailSha256 !==
      V5_TPM_CONTRACT.replayPreSignTailSha256 ||
    value.nonceAbsentBeforeSign !== true
  )
    throw new Error("V5 replay identity is invalid.");
}

function validateRepository(value) {
  closed(
    value,
    [
      "absolutePath",
      "repository",
      "branch",
      "commit",
      "tree",
      "localOriginRemoteParity",
      "clean",
      "private",
    ],
    "V5 repository",
  );
  if (
    value.absolutePath !== V5_TPM_CONTRACT.repositoryPath ||
    value.repository !== "banihashem/INNOBASE-MatchBASE" ||
    value.branch !== "main" ||
    !SHA1.test(value.commit) ||
    !SHA1.test(value.tree) ||
    value.localOriginRemoteParity !== true ||
    value.clean !== true ||
    value.private !== true
  )
    throw new Error("V5 repository binding is invalid.");
}

function validateGovernance(value) {
  closed(
    value,
    [
      "ownerDecision",
      "oneGetAllocation",
      "transitionDecision",
      "successorAuthorization",
      "s2PayloadSchema",
      "s2SigningContract",
      "s2SuccessorAuthorization",
      "recoveryGovernance",
      "s2IndeterminateArchiveManifest",
      "s2IndeterminateArchiveAudit",
      "s2IndeterminateAttemptEvidence",
      "payloadSchema",
      "signingContract",
      "custodyEvidence",
      "revokedEd25519Record",
      "priorHttp401",
      "forensicArchiveManifest",
      "officialDocsEvidence",
      "officialDocsEvidenceAudit",
      "rateLimitAmendment",
      "forensicArchiveAudit",
      "v1Ledger",
      "v2Ledger",
      "v3Ledger",
      "v4Ledger",
    ],
    "V5 governance bindings",
  );
  digestBinding(value.ownerDecision, "V5 owner decision", {
    path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\OWNER_DECISION_PO_001_SLICE_3_V5_ONE_GET_2026-08-22.md",
    sha256: "7B9DC0E27F2DA3B0E20ED2A4220DFE26AA95B76FA4EC1B37D9B559AE3D0AD916",
    bytes: 4_915,
  });
  digestBinding(value.oneGetAllocation, "V5 one-GET allocation", {
    path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_ALLOCATION_PO_001_SLICE_3_V5_ONE_GET_PRE_EXECUTION_PENDING.md",
    sha256: "484B8F82E08E97CBC40CA0E01115D735FA0446FB19D093DE06F41691CCF1C0C6",
    bytes: 5_876,
  });
  digestBinding(value.transitionDecision, "V5 transition decision", {
    path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\OWNER_DELEGATED_DECISION_PO_001_SLICE_3_V5_TPM_ECDSA_P256_TRANSITION.md",
    sha256: V5_TPM_CONTRACT.transitionSha256,
    bytes: V5_TPM_CONTRACT.transitionBytes,
  });
  digestBinding(value.successorAuthorization, "V5 successor authorization", {
    path: PUBLIC_MATERIALS.successorAuthorization,
    sha256: V5_TPM_CONTRACT.successorAuthorizationSha256,
    bytes: V5_TPM_CONTRACT.successorAuthorizationBytes,
  });
  digestBinding(value.s2PayloadSchema, "V5 S2 payload schema", {
    path: PUBLIC_MATERIALS.s2Schema,
    sha256: V5_TPM_CONTRACT.s2SchemaSha256,
    bytes: V5_TPM_CONTRACT.s2SchemaBytes,
  });
  digestBinding(value.s2SigningContract, "V5 S2 signing contract", {
    path: PUBLIC_MATERIALS.s2Contract,
    sha256: V5_TPM_CONTRACT.s2ContractSha256,
    bytes: V5_TPM_CONTRACT.s2ContractBytes,
  });
  digestBinding(
    value.s2SuccessorAuthorization,
    "V5 S2 successor authorization",
    {
      path: PUBLIC_MATERIALS.s2SuccessorAuthorization,
      sha256: V5_TPM_CONTRACT.s2AuthorizationSha256,
      bytes: V5_TPM_CONTRACT.s2AuthorizationBytes,
    },
  );
  digestBinding(value.recoveryGovernance, "V5 S3 recovery governance", {
    path: PUBLIC_MATERIALS.successorAuthorization,
    sha256: V5_TPM_CONTRACT.successorAuthorizationSha256,
    bytes: V5_TPM_CONTRACT.successorAuthorizationBytes,
  });
  digestBinding(
    value.s2IndeterminateArchiveManifest,
    "V5 S2 indeterminate archive manifest",
    {
      path: PUBLIC_MATERIALS.s2IndeterminateArchiveManifest,
      sha256: V5_TPM_CONTRACT.s2IndeterminateArchiveManifestSha256,
      bytes: V5_TPM_CONTRACT.s2IndeterminateArchiveManifestBytes,
    },
  );
  digestBinding(
    value.s2IndeterminateArchiveAudit,
    "V5 S2 indeterminate archive audit",
    {
      path: PUBLIC_MATERIALS.s2IndeterminateArchiveAudit,
      sha256: V5_TPM_CONTRACT.s2IndeterminateArchiveAuditSha256,
      bytes: V5_TPM_CONTRACT.s2IndeterminateArchiveAuditBytes,
    },
  );
  digestBinding(
    value.s2IndeterminateAttemptEvidence,
    "V5 S2 indeterminate attempt evidence",
    {
      path: PUBLIC_MATERIALS.s2IndeterminateAttemptEvidence,
      sha256: V5_TPM_CONTRACT.s2IndeterminateAttemptEvidenceSha256,
      bytes: V5_TPM_CONTRACT.s2IndeterminateAttemptEvidenceBytes,
    },
  );
  digestBinding(value.payloadSchema, "V5 payload schema", {
    path: PUBLIC_MATERIALS.schema,
    sha256: V5_TPM_CONTRACT.schemaSha256,
    bytes: V5_TPM_CONTRACT.schemaBytes,
  });
  digestBinding(value.signingContract, "V5 signing contract", {
    path: PUBLIC_MATERIALS.contract,
    sha256: V5_TPM_CONTRACT.contractSha256,
    bytes: V5_TPM_CONTRACT.contractBytes,
  });
  digestBinding(value.custodyEvidence, "V5 custody evidence", {
    path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_TPM_ECDSA_P256_CUSTODY_EVIDENCE_PO_001_SLICE_3_V5.json",
    sha256: V5_TPM_CONTRACT.custodySha256,
    bytes: V5_TPM_CONTRACT.custodyBytes,
  });
  digestBinding(value.revokedEd25519Record, "V5 revoked Ed25519 record", {
    path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_AUTHORITY_PO_001_SLICE_3_V5_ED25519_REVOCATION.md",
    sha256: "D38D03154C6C87576DEED07EB97A3557271D47E79EE4227D7005CFE7140A1665",
    bytes: 6_512,
  });
  digestBinding(value.priorHttp401, "V5 prior HTTP 401", {
    path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_OPENROUTER_CREDENTIAL_PREFLIGHT_V4.json",
    sha256: "144E77DE086FF53BFE2FCDD75A4CA750951C4026EA10ECF41FCAE983F9B87C08",
    bytes: 886,
  });
  digestBinding(value.forensicArchiveAudit, "V5 forensic archive audit", {
    path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_INVALID_200_SCHEMA_FORENSIC_ARCHIVE_AUDIT_2026-08-23.json",
    sha256: V5_TPM_CONTRACT.forensicArchiveAuditSha256,
    bytes: V5_TPM_CONTRACT.forensicArchiveAuditBytes,
  });
  digestBinding(value.forensicArchiveManifest, "V5 forensic archive manifest", {
    path: PUBLIC_MATERIALS.forensicArchiveManifest,
    sha256: V5_TPM_CONTRACT.forensicArchiveManifestSha256,
    bytes: V5_TPM_CONTRACT.forensicArchiveManifestBytes,
  });
  digestBinding(value.officialDocsEvidence, "V5 official docs evidence", {
    path: PUBLIC_MATERIALS.officialDocsEvidence,
    sha256: V5_TPM_CONTRACT.officialDocsEvidenceSha256,
    bytes: V5_TPM_CONTRACT.officialDocsEvidenceBytes,
  });
  digestBinding(
    value.officialDocsEvidenceAudit,
    "V5 official docs evidence audit",
    {
      path: PUBLIC_MATERIALS.officialDocsEvidenceAudit,
      sha256: V5_TPM_CONTRACT.officialDocsEvidenceAuditSha256,
      bytes: V5_TPM_CONTRACT.officialDocsEvidenceAuditBytes,
    },
  );
  digestBinding(value.rateLimitAmendment, "V5 rate-limit amendment", {
    path: PUBLIC_MATERIALS.rateLimitAmendment,
    sha256: V5_TPM_CONTRACT.rateLimitAmendmentSha256,
    bytes: V5_TPM_CONTRACT.rateLimitAmendmentBytes,
  });
  historicalLedger(
    value.v1Ledger,
    "V1 ledger",
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-live-qualification-state\\session-7EA6B3997AF42571DBFE9483",
    "D26108B406EBB23615E9A181ADBC40FED85EDFEE504D7BA144A7BC2277930FA8",
  );
  historicalLedger(
    value.v2Ledger,
    "V2 ledger",
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-live-qualification-state\\session-7327E59E65AA787E98E08968",
    "DB247B6E332F02D38E0355B6359F7A3A72A7C02D64A23B6A7B33212D423EF748",
  );
  historicalLedger(
    value.v3Ledger,
    "V3 ledger",
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-live-qualification-state\\session-19AD2D3117AF9064AF90F879",
    "3030B12726EB31DA43BBEBD19E9D5C0E819AB5857371FBC843CF3F7D759F7BC8",
  );
  digestBinding(value.v4Ledger, "V4 SAFE_BLOCKED ledger", {
    path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V4_SAFE_BLOCKED_STATE_2026-08-18.json",
    sha256: "D4A545B7AFB70A08E2ECE3556BA43670FF367F620BF3252648CA5881C05C8A53",
    bytes: 4_971,
  });
}

function validateAuthoritativeSources(value) {
  closed(
    value,
    ["root", "count", "aggregateSha256", "aggregationMethod", "sources"],
    "V5 authoritative source set",
  );
  if (
    value.root !== V5_TPM_CONTRACT.authoritativeRoot ||
    value.count !== 14 ||
    !SHA256.test(value.aggregateSha256) ||
    value.aggregationMethod !== "UTF8_SORTED_ABSOLUTE_PATH_NUL_SHA256_LF_V1" ||
    !Array.isArray(value.sources) ||
    value.sources.length !== 14
  )
    throw new Error("V5 authoritative source set is invalid.");
  value.sources.forEach((source, index) =>
    digestBinding(source, `V5 authoritative source ${index + 1}`),
  );
  const paths = value.sources.map(({ path }) => path);
  if (JSON.stringify(paths) !== JSON.stringify(V5_AUTHORITATIVE_SOURCE_PATHS))
    throw new Error("V5 authoritative source paths are not exact and ordered.");
  const aggregate = sha256(
    value.sources
      .map(({ path, sha256: digest }) => `${path}\0${digest}\n`)
      .join(""),
  );
  if (aggregate !== value.aggregateSha256)
    throw new Error("V5 authoritative source aggregate is invalid.");
}

function validateReviewEvidence(value, repository) {
  closed(
    value,
    ["disciplineAudits", "critic", "hosted", "preSignRole2Audit"],
    "V5 review evidence",
  );
  if (
    !Array.isArray(value.disciplineAudits) ||
    value.disciplineAudits.length !== 6
  )
    throw new Error("V5 discipline audit set is incomplete.");
  value.disciplineAudits.forEach((audit, index) =>
    passBinding(audit, `V5 discipline audit ${index + 1}`),
  );
  const auditPaths = value.disciplineAudits.map(({ path }) => path);
  if (JSON.stringify(auditPaths) !== JSON.stringify(V5_DISCIPLINE_AUDIT_PATHS))
    throw new Error("V5 discipline audit paths are duplicated or reordered.");
  passBinding(value.critic, "V5 integration critic");
  if (value.critic.path !== V5_FIXED_SIGNED_PATHS.critic)
    throw new Error("V5 integration critic path is invalid.");
  passBinding(value.preSignRole2Audit, "V5 pre-sign Role2 audit");
  if (
    value.preSignRole2Audit.path !==
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_INDEPENDENT_AUDIT_PO_001_SLICE_3_V5_SUCCESSOR_PRE_SIGN_LOOP_3.md"
  )
    throw new Error("V5 pre-sign Role2 audit path is invalid.");
  closed(
    value.hosted,
    [
      "observationPath",
      "observationSha256",
      "runId",
      "jobId",
      "commit",
      "tree",
      "status",
      "conclusion",
      "independentAuthentication",
      "authenticatedApiEvidenceSha256",
      "observedAt",
    ],
    "V5 hosted evidence",
  );
  canonicalUtcMs(value.hosted.observedAt, "V5 hosted observedAt");
  if (
    value.hosted.observationPath !==
      "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_GITHUB_HOSTED_OBSERVATION_PO_001_SLICE_3_V5_SUCCESSOR_3.json" ||
    !SHA256.test(value.hosted.observationSha256) ||
    !Number.isSafeInteger(value.hosted.runId) ||
    value.hosted.runId < 1 ||
    !Number.isSafeInteger(value.hosted.jobId) ||
    value.hosted.jobId < 1 ||
    value.hosted.commit !== repository.commit ||
    value.hosted.tree !== repository.tree ||
    value.hosted.status !== "COMPLETED" ||
    value.hosted.conclusion !== "SUCCESS" ||
    value.hosted.independentAuthentication !==
      "GITHUB_API_AUTHENTICATED_READ_ONLY" ||
    !SHA256.test(value.hosted.authenticatedApiEvidenceSha256)
  )
    throw new Error("V5 hosted evidence is invalid.");
}

function validateAuthorizationPolicy(value) {
  closed(
    value,
    [
      "transitionFrom",
      "transitionTo",
      "qualificationAuthorized",
      "method",
      "url",
      "credentialHandle",
      "maximumRequests",
      "retryCount",
      "redirectCount",
      "fallbackCount",
      "modelPosts",
      "searchCalls",
      "billableCalls",
      "maximumUsd",
      "timeoutMs",
      "maximumBodyBytes",
      "responseContentType",
      "responseContract",
      "afterParentLockRechecks",
      "preSendRechecks",
      "firstAttemptConsumes",
      "prohibited",
    ],
    "V5 authorization policy",
  );
  digestBinding(value.responseContract, "V5 response contract");
  if (
    value.transitionFrom !== "BLOCKED_CREDENTIAL" ||
    value.transitionTo !== "CREDENTIAL_GET_AUTHORIZED" ||
    value.qualificationAuthorized !== false ||
    value.method !== "GET" ||
    value.url !== V5_TPM_CONTRACT.endpoint ||
    value.credentialHandle !== "MATCHBASE_OPENROUTER_API_KEY" ||
    value.maximumRequests !== 1 ||
    value.retryCount !== 0 ||
    value.redirectCount !== 0 ||
    value.fallbackCount !== 0 ||
    value.modelPosts !== 0 ||
    value.searchCalls !== 0 ||
    value.billableCalls !== 0 ||
    value.maximumUsd !== 0 ||
    value.timeoutMs !== 10_000 ||
    value.maximumBodyBytes !== 32_768 ||
    value.responseContentType !== "application/json" ||
    value.responseContract.path !== V5_FIXED_SIGNED_PATHS.responseContract ||
    value.firstAttemptConsumes !== true
  )
    throw new Error("V5 authorization policy is invalid.");
  assertExactArray(
    value.afterParentLockRechecks,
    AFTER_LOCK_RECHECKS,
    "V5 after-lock rechecks",
  );
  assertExactArray(
    value.preSendRechecks,
    PRE_SEND_RECHECKS,
    "V5 pre-send rechecks",
  );
  assertExactArray(value.prohibited, PROHIBITED, "V5 prohibited operations");
}

export function validateV5Role2Payload(payload, { nowMs = Date.now() } = {}) {
  closed(payload, TOP_LEVEL_KEYS, "V5 signed payload");
  if (
    payload.schemaVersion !== "matchbase.role2-detached-acceptance/v6" ||
    payload.payloadType !== "V5_OPENROUTER_CREDENTIAL_GET_AUTHORIZATION" ||
    payload.decisionId !== V5_TPM_CONTRACT.decisionId ||
    !SESSION.test(payload.sessionId) ||
    payload.sessionId !== V5_TPM_CONTRACT.sessionId ||
    payload.payloadPath !== V5_TPM_CONTRACT.payloadPath ||
    payload.signatureEnvelopePath !== V5_TPM_CONTRACT.envelopePath ||
    !NONCE.test(payload.nonce) ||
    payload.nonce !== V5_TPM_CONTRACT.nonce ||
    payload.stateRoot !== V5_TPM_CONTRACT.stateRoot
  )
    throw new Error("V5 signed payload identity is invalid.");
  const issuedAtMs = canonicalUtcMs(payload.issuedAt, "V5 issuedAt");
  const expiresAtMs = canonicalUtcMs(payload.expiresAt, "V5 expiresAt");
  if (
    expiresAtMs - issuedAtMs !== V5_TPM_CONTRACT.lifetimeSeconds * 1_000 ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < issuedAtMs ||
    nowMs >= expiresAtMs
  )
    throw new Error("V5 signed payload time window is invalid or expired.");
  validateReplayIdentity(
    payload.replayIdentity,
    payload.sessionId,
    payload.nonce,
  );
  validateRepository(payload.repository);
  closed(
    payload.candidate,
    ["manifest", "aggregateSha256", "fileCount", "wrapper"],
    "V5 candidate",
  );
  digestBinding(payload.candidate.manifest, "V5 candidate manifest");
  digestBinding(payload.candidate.wrapper, "V5 candidate wrapper");
  if (
    payload.candidate.manifest.path !==
      V5_FIXED_SIGNED_PATHS.candidateManifest ||
    payload.candidate.wrapper.path !== V5_FIXED_SIGNED_PATHS.candidateWrapper ||
    !SHA256.test(payload.candidate.aggregateSha256) ||
    !Number.isSafeInteger(payload.candidate.fileCount) ||
    payload.candidate.fileCount < 1
  )
    throw new Error("V5 candidate identity is invalid.");
  validateGovernance(payload.governanceBindings);
  validateAuthoritativeSources(payload.authoritativeSourceSet);
  closed(
    payload.managementLogPrefix,
    ["path", "byteLength", "sha256"],
    "V5 management log prefix",
  );
  if (
    payload.managementLogPrefix.path !== V5_TPM_CONTRACT.managementLogPath ||
    !Number.isSafeInteger(payload.managementLogPrefix.byteLength) ||
    payload.managementLogPrefix.byteLength < 1 ||
    !SHA256.test(payload.managementLogPrefix.sha256)
  )
    throw new Error("V5 management log prefix is invalid.");
  validateReviewEvidence(payload.reviewEvidence, payload.repository);
  validateAuthorizationPolicy(payload.authorizationPolicy);
  closed(
    payload.preservation,
    [
      "v1ToV4Immutable",
      "v3ContractImmutable",
      "failedAttemptArchived",
      "authoritativeSourcesImmutable",
      "priorAuditHistoryImmutable",
      "canonicalWorkspaceOnly",
    ],
    "V5 preservation",
  );
  if (Object.values(payload.preservation).some((value) => value !== true))
    throw new Error("V5 preservation policy is invalid.");
  return Object.freeze({ payload, issuedAtMs, expiresAtMs });
}

export function validateV5Role2Envelope(envelope, payload, payloadSha256) {
  closed(envelope, ENVELOPE_KEYS, "V5 detached signature envelope");
  canonicalUtcMs(envelope.signedAt, "V5 envelope signedAt");
  const replayIdentitySha256 = sha256(
    Buffer.from(rfc8785Canonicalize(payload.replayIdentity), "utf8"),
  );
  if (
    envelope.schemaVersion !== "matchbase.role2-detached-signature/v6" ||
    envelope.sessionId !== payload.sessionId ||
    envelope.replayIdentitySha256 !== replayIdentitySha256 ||
    envelope.payloadSha256 !== payloadSha256 ||
    envelope.signedAt !== payload.issuedAt ||
    typeof envelope.signature !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/u.test(envelope.signature)
  )
    throw new Error("V5 detached signature envelope is invalid.");
  return replayIdentitySha256;
}

function strictBase64Url(value) {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 64 || bytes.toString("base64url") !== value)
    throw new Error("V5 signature is not canonical P1363 base64url.");
  return bytes;
}

function p1363Scalar(bytes, offset) {
  return BigInt(`0x${bytes.subarray(offset, offset + 32).toString("hex")}`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export async function verifyPinnedV5Role2Acceptance({
  payloadBytes,
  envelopeBytes,
  nowMs = Date.now(),
}) {
  if (
    !Buffer.isBuffer(payloadBytes) ||
    payloadBytes.length < 2 ||
    payloadBytes.length > 262_144 ||
    !Buffer.isBuffer(envelopeBytes) ||
    envelopeBytes.length < 2 ||
    envelopeBytes.length > 4_096
  )
    throw new Error("V5 signed input or public trust anchor is invalid.");
  const decoder = new TextDecoder("utf8", { fatal: true });
  const payload = JSON.parse(decoder.decode(payloadBytes));
  const envelope = JSON.parse(decoder.decode(envelopeBytes));
  const validated = validateV5Role2Payload(payload, { nowMs });
  const canonicalPayload = Buffer.from(rfc8785Canonicalize(payload), "utf8");
  if (!payloadBytes.equals(canonicalPayload))
    throw new Error("V5 payload bytes are not exact RFC 8785 JCS bytes.");
  const payloadSha256 = sha256(canonicalPayload);
  const replayIdentitySha256 = validateV5Role2Envelope(
    envelope,
    payload,
    payloadSha256,
  );
  const signature = strictBase64Url(envelope.signature);
  const r = p1363Scalar(signature, 0);
  const s = p1363Scalar(signature, 32);
  if (r <= 0n || r >= P256_ORDER || s <= 0n || s > P256_HALF_ORDER)
    throw new Error("V5 signature is not a valid low-S P-256 signature.");
  const { publicKey } = await verifyPinnedV5PublicMaterials();
  const signedInput = Buffer.concat([
    Buffer.from(SIGNATURE_DOMAIN_TEXT, "utf8"),
    canonicalPayload,
  ]);
  if (
    !verify(
      "sha256",
      signedInput,
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    )
  )
    throw new Error("V5 detached signature is invalid.");
  const frozenPayload = deepFreeze(structuredClone(payload));
  const frozenEnvelope = deepFreeze(structuredClone(envelope));
  return Object.freeze({
    payload: frozenPayload,
    envelope: frozenEnvelope,
    payloadSha256,
    replayIdentitySha256,
    signatureSha256: sha256(signature),
    issuedAtMs: validated.issuedAtMs,
    expiresAtMs: validated.expiresAtMs,
  });
}
