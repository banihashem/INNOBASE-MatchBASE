import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const relative = {
  evidence:
    "evidence/slice3/staging-openrouter-azure-openai-qualification.v2.json",
  evidenceSignature:
    "evidence/slice3/staging-openrouter-azure-openai-qualification.v2.sig",
  publicKey:
    "evidence/slice3/staging-openrouter-azure-openai-qualification.v2.pub.pem",
  manifest:
    "evidence/slice3/staging-openrouter-azure-openai-qualification-manifest.v2.json",
};
const read = async (path) => await readFile(resolve(root, path));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const evidenceBytes = await read(relative.evidence);
const signatureBytes = await read(relative.evidenceSignature);
const publicKeyBytes = await read(relative.publicKey);
const evidence = JSON.parse(evidenceBytes);
if (
  evidence.schemaVersion !==
    "matchbase.staging-openrouter-route-qualification/v2" ||
  evidence.terminalDisposition !== "PASS"
)
  throw new Error("Qualified evidence is invalid.");
const manifest = {
  schemaVersion: "matchbase.staging-route-qualification-manifest/v2",
  authorizationId: evidence.authorization.authorizationId,
  sessionId: evidence.authorization.sessionId,
  environment: evidence.environment,
  policyVersion: evidence.policyBinding.policyVersion,
  policyFileSha256: evidence.policyBinding.policyFileSha256,
  routeId: evidence.policyBinding.routeId,
  outputSchemaCanonicalSha256:
    evidence.policyBinding.outputSchemaCanonicalSha256,
  signingKeyVersion:
    "projects/innobase-matchbase-stg/locations/europe-west2/keyRings/matchbase-staging-evidence/cryptoKeys/checkpoint-signer/cryptoKeyVersions/1",
  signatureAlgorithm: "RSA_SIGN_PKCS1_3072_SHA256",
  artifacts: {
    evidence: {
      path: relative.evidence,
      sha256: sha256(evidenceBytes),
    },
    evidenceSignature: {
      path: relative.evidenceSignature,
      sha256: sha256(signatureBytes),
    },
    publicKey: {
      path: relative.publicKey,
      sha256: sha256(publicKeyBytes),
    },
  },
  terminalDisposition: "PASS",
  recordedAt: evidence.recordedAt,
};
await writeFile(
  resolve(root, relative.manifest),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
process.stdout.write(
  JSON.stringify({ manifestPath: relative.manifest, disposition: "PASS" }),
);
