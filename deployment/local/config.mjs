import { readFile } from "node:fs/promises";
import { isIP } from "node:net";

export function isPrivateIPv4(hostname) {
  if (isIP(hostname) !== 4) return false;
  const [a, b] = hostname.split(".").map(Number);
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}

export function validateLocalConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("Local runtime configuration must be an object.");
  const allowed = new Set([
    "MATCHBASE_DATABASE_URL",
    "DATABASE_URL",
    "MATCHBASE_DIGEST_KEY",
    "MATCHBASE_OPENROUTER_API_KEY",
    "MATCHBASE_PROVIDER_GOOGLE",
    "MATCHBASE_PROVIDER_OPENAI",
    "MATCHBASE_PROVIDER_ROUTES",
    "MATCHBASE_ENVIRONMENT",
    "MATCHBASE_OIDC_SIMULATOR",
    "MATCHBASE_SYNTHETIC_FIXTURE",
    "MATCHBASE_ORIGIN",
  ]);
  for (const [key, value] of Object.entries(config)) {
    if (!allowed.has(key) || typeof value !== "string")
      throw new Error("Unsupported local runtime configuration field.");
  }
  if (
    config.MATCHBASE_ENVIRONMENT !== "test" ||
    config.MATCHBASE_OIDC_SIMULATOR !== "true" ||
    config.MATCHBASE_SYNTHETIC_FIXTURE !== "true"
  )
    throw new Error(
      "This image only supports the local test identity profile.",
    );
  const origin = new URL(config.MATCHBASE_ORIGIN);
  if (
    origin.protocol !== "http:" ||
    (!["localhost", "127.0.0.1"].includes(origin.hostname) &&
      !isPrivateIPv4(origin.hostname)) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error(
      "Local origin must use loopback or private IPv4 HTTP without a path.",
    );
  const database = new URL(config.MATCHBASE_DATABASE_URL);
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    database.hostname !== "postgres" ||
    database.port !== "5432" ||
    database.pathname !== "/matchbase_slice1"
  )
    throw new Error("Local runtime must use its dedicated Compose database.");
  if (config.DATABASE_URL !== config.MATCHBASE_DATABASE_URL)
    throw new Error("Database aliases must match.");
  if (Buffer.byteLength(config.MATCHBASE_DIGEST_KEY ?? "") < 32)
    throw new Error("Runtime digest key is missing or invalid.");
  return config;
}

export async function loadLocalConfig() {
  const config = validateLocalConfig(
    JSON.parse(await readFile("/run/secrets/runtime_config", "utf8")),
  );
  Object.assign(process.env, config);
  return config;
}
