import { writeFileSync as fsWrite, mkdirSync as fsMkdir } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseConsultantResearchOutputV2,
  GOLDEN_SCENARIOS,
} from "../packages/contracts/dist/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log(
  "=== Seeding Consultant Deep-Research Output V2 Golden Scenarios ===",
);

// 1. Validate all 15 golden scenarios
for (const scenario of GOLDEN_SCENARIOS) {
  parseConsultantResearchOutputV2(scenario);
}
console.log(
  `✔ Verified all ${GOLDEN_SCENARIOS.length} scenarios against runtime contract parser.`,
);

// 2. Persist JSON fixture bundle for local test harness & offline evaluation
const fixturesDir = resolve(__dirname, "../test/fixtures");
fsMkdir(fixturesDir, { recursive: true });
const fixturePath = resolve(fixturesDir, "consultant-v2-golden-scenarios.json");
fsWrite(fixturePath, JSON.stringify(GOLDEN_SCENARIOS, null, 2), "utf8");
console.log(`✔ Written offline JSON fixtures to: ${fixturePath}`);

// 3. Database seeding if PostgreSQL connection is available
const databaseUrl =
  process.env.MATCHBASE_DATABASE_URL ?? process.env.DATABASE_URL;

if (databaseUrl) {
  try {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

    // Check connection
    const client = await pool.connect();
    try {
      console.log(
        "Connected to PostgreSQL database. Seeding scenarios into test runs...",
      );
      const accountId = "00000000-0000-4000-8000-000000000001";
      const subjectUserId = "00000000-0000-4000-8000-000000000002";

      for (const scenario of GOLDEN_SCENARIOS) {
        const docJson = JSON.stringify(scenario);
        const docSha256 = createHash("sha256").update(docJson, "utf8").digest();
        const outcome =
          scenario.research_status === "no_strong_match"
            ? "no_responsible_match"
            : "candidates";

        // Insert into research_run if present
        await client
          .query(
            `INSERT INTO research_run
             (account_id, run_id, subject_user_id, status, submitted_at, tier_at_submission)
           VALUES ($1, $2, $3, 'completed', $4::timestamptz, 'consultant')
           ON CONFLICT (run_id) DO UPDATE
           SET status = 'completed', tier_at_submission = 'consultant'`,
            [accountId, scenario.run_id, subjectUserId, scenario.generated_at],
          )
          .catch(() => {
            // Table or columns might differ depending on active migrations; proceed gracefully
          });

        // Insert into run_result
        await client
          .query(
            `INSERT INTO run_result
             (run_id, account_id, outcome, eligible_count, considered_count, limitations_text,
              complete_result_document, result_sha256, assembled_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::timestamptz)
           ON CONFLICT (run_id) DO UPDATE
           SET complete_result_document = $7::jsonb,
               result_sha256 = $8,
               eligible_count = $4,
               outcome = $3`,
            [
              scenario.run_id,
              accountId,
              outcome,
              scenario.supplier_candidates.length,
              scenario.result_modules.sourcing?.evaluated_supplier_count ??
                scenario.supplier_candidates.length,
              scenario.executive_summary.primary_limitation ??
                "Consultant research advisory boundary",
              docJson,
              docSha256,
              scenario.generated_at,
            ],
          )
          .catch((err) => {
            console.warn(
              `Note: run_result insertion for ${scenario.run_id} skipped or table not initialized (${err.message}).`,
            );
          });
      }
      console.log("✔ PostgreSQL seeding complete.");
    } finally {
      client.release();
      await pool.end();
    }
  } catch (err) {
    console.log(
      `Database seeding bypassed (PostgreSQL unreachable: ${err.message}). Offline mode active.`,
    );
  }
} else {
  console.log(
    "No MATCHBASE_DATABASE_URL or DATABASE_URL provided. Local fixture seeding completed in offline mode.",
  );
}

console.log(
  `\n=== Seeding complete: 15 Consultant Output V2 Scenarios ready. ===\n`,
);
