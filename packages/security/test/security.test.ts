import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool } from "@matchbase/data";
import { describe, expect, it } from "vitest";
import { SOURCE_LANGUAGE_CANARIES } from "../../../config/source-language-canaries.mjs";
import {
  allowlistTelemetry,
  assertNoCanary,
  safeError,
  scanFilesForCanaries,
  scanPostgresForCanaries,
} from "../src/index.js";

describe("privacy and safe error boundaries", () => {
  it("retains only allowlisted scalar telemetry", () => {
    expect(
      allowlistTelemetry({
        run_id: "run-1",
        duration_ms: 12,
        outcome: "ok",
        sourceText: SOURCE_LANGUAGE_CANARIES[0],
        providerPayload: { raw: SOURCE_LANGUAGE_CANARIES[1] },
      }),
    ).toEqual({ run_id: "run-1", duration_ms: 12, outcome: "ok" });
  });

  it("produces closed source-free error envelopes", () => {
    const envelope = safeError({
      code: "CANONICALIZATION_FAILED",
      correlationId: "corr-1",
    });
    expect(Object.keys(envelope.error).sort()).toEqual([
      "code",
      "correlation_id",
      "message",
      "retryable",
    ]);
    expect(() =>
      assertNoCanary(envelope, SOURCE_LANGUAGE_CANARIES),
    ).not.toThrow();
  });

  it("detects all four runtime canaries and scans only contained regular files", async () => {
    const root = await mkdtemp(join(tmpdir(), "matchbase-privacy-"));
    try {
      const safe = join(root, "safe.json");
      const unsafe = join(root, "unsafe.json");
      await writeFile(
        safe,
        JSON.stringify({ canonical: "English canonical content" }),
      );
      await writeFile(
        unsafe,
        JSON.stringify({ body: SOURCE_LANGUAGE_CANARIES[2] }),
      );
      await expect(
        scanFilesForCanaries({
          root,
          paths: [safe],
          canaries: SOURCE_LANGUAGE_CANARIES,
        }),
      ).resolves.toBeUndefined();
      await expect(
        scanFilesForCanaries({
          root,
          paths: [unsafe],
          canaries: SOURCE_LANGUAGE_CANARIES,
        }),
      ).rejects.toThrow(/canary detected/);
      await expect(
        scanFilesForCanaries({
          root,
          paths: [join(root, "..", "outside")],
          canaries: SOURCE_LANGUAGE_CANARIES,
        }),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!process.env.DATABASE_URL)(
    "detects four source-language canaries across PostgreSQL text surfaces",
    async () => {
      const pool = createPool({ connectionString: process.env.DATABASE_URL });
      try {
        await pool.query("CREATE EXTENSION IF NOT EXISTS citext");
        await pool.query(
          "CREATE TABLE IF NOT EXISTS privacy_canary_probe (value text, values text[], identity citext)",
        );
        await pool.query("TRUNCATE privacy_canary_probe");
        await expect(
          scanPostgresForCanaries(pool, SOURCE_LANGUAGE_CANARIES),
        ).resolves.toMatchObject({ tables: expect.any(Number) });
        for (const canary of SOURCE_LANGUAGE_CANARIES) {
          await pool.query(
            "INSERT INTO privacy_canary_probe (value) VALUES ($1)",
            [canary],
          );
          await expect(
            scanPostgresForCanaries(pool, SOURCE_LANGUAGE_CANARIES),
          ).rejects.toThrow(/canary detected/);
          await pool.query("TRUNCATE privacy_canary_probe");
          await pool.query(
            "INSERT INTO privacy_canary_probe (values) VALUES (ARRAY[$1]::text[])",
            [canary],
          );
          await expect(
            scanPostgresForCanaries(pool, SOURCE_LANGUAGE_CANARIES),
          ).rejects.toThrow(/canary detected/);
          await pool.query("TRUNCATE privacy_canary_probe");
          await pool.query(
            "INSERT INTO privacy_canary_probe (identity) VALUES ($1::citext)",
            [canary],
          );
          await expect(
            scanPostgresForCanaries(pool, SOURCE_LANGUAGE_CANARIES),
          ).rejects.toThrow(/canary detected/);
          await pool.query("TRUNCATE privacy_canary_probe");
        }
        await expect(
          scanPostgresForCanaries(pool, SOURCE_LANGUAGE_CANARIES),
        ).resolves.toMatchObject({ columns: expect.any(Number) });
      } finally {
        await pool.query("DROP TABLE IF EXISTS privacy_canary_probe");
        await pool.end();
      }
    },
  );
});
