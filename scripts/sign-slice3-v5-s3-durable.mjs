import { runDurableV5TpmSigning } from "./lib/slice3-v5-durable-tpm-signer.mjs";

if (process.argv.length !== 3 || process.argv[2] !== "--execute-once") {
  process.stderr.write(
    "S3 durable TPM signer is inert. Exact audited --execute-once clearance is required.\n",
  );
  process.exitCode = 2;
} else {
  const result = await runDurableV5TpmSigning();
  process.stdout.write(
    `${JSON.stringify({
      status: "SIGNED_ONCE",
      envelopeBytes: result.envelopeBytes,
      envelopeSha256: result.envelopeSha256,
      signatureSha256: result.signatureSha256,
    })}\n`,
  );
}
