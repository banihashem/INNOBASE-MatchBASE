import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { connect } from "node:net";

// Deterministic adapter for boundary qualification; this is not a foundation-model agent.
for (const unavailable of [
  "/oracle/acceptance.mjs",
  "/var/run/docker.sock",
  "/runtime",
  "/root/.config",
]) {
  try {
    await access(unavailable);
    throw new Error(`Unexpected repair access: ${unavailable}`);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EACCES") throw error;
  }
}
if (
  Object.keys(process.env).some((key) =>
    /API_KEY|OPENROUTER|DATABASE|TOKEN|SECRET|PASSWORD/u.test(key),
  )
)
  throw new Error("Runtime credential environment is forbidden.");
try {
  await writeFile("/inputs/source.mjs", "mutation");
  throw new Error("Source mount was writable.");
} catch (error) {
  if (!["EROFS", "EACCES"].includes(error.code)) throw error;
}
await new Promise((resolve, reject) => {
  const socket = connect({ host: "1.1.1.1", port: 443 });
  socket.setTimeout(1000);
  socket.once("connect", () => {
    socket.destroy();
    reject(new Error("Network isolation failed."));
  });
  socket.once("error", () => {
    socket.destroy();
    resolve();
  });
  socket.once("timeout", () => {
    socket.destroy();
    resolve();
  });
});
const source = await readFile("/inputs/source.mjs", "utf8");
if (!source.includes("return consented + 1;"))
  throw new Error("Unknown synthetic defect.");
const content = source.replace("return consented + 1;", "return consented;");
await writeFile(
  "/candidate/proposal.json",
  JSON.stringify({
    version: "repair-proposal.v1",
    changes: [
      {
        path: "src/recovery-policy.mjs",
        original_sha256: createHash("sha256").update(source).digest("hex"),
        content,
      },
    ],
  }),
  { flag: "wx" },
);
console.log(await readFile("/candidate/proposal.json", "utf8"));
