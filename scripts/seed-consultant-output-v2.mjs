import { writeFileSync as fsWrite, mkdirSync as fsMkdir } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseConsultantResearchOutputV2,
  GOLDEN_SCENARIOS,
} from "../packages/contracts/dist/src/index.js";
import { standardCompleteResultDocumentSha256 } from "../packages/application/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log(
  "=== Seeding Consultant Deep-Research Output V2 Golden Scenarios ===",
);

// 1. Validate all 15 golden scenarios against contracts
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

// 3. PostgreSQL database seeding
const databaseUrl =
  process.env.MATCHBASE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://matchbase_test:local-synthetic-db-only@127.0.0.1:55432/matchbase_slice1";

console.log(
  `Connecting to PostgreSQL at ${databaseUrl.replace(/:[^:@]+@/, ":***@")}...`,
);

let pg;
try {
  pg = (await import("pg")).default;
} catch {
  pg = (await import("../packages/data/node_modules/pg/lib/index.js")).default;
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  // Ensure Consultant Account and User exist
  const accountId = "a9442670-2db5-447f-8fb4-c71f6e16a893";
  const userId = "2efd403d-823e-4b3f-9fe8-fe3f800c460e";
  const grantorId = "a71f455e-6d88-486e-af98-2dda44887e8d";
  const googleSub = "simulator-consultant-subject-v1:local-unreleased";

  await client.query(
    `INSERT INTO account (account_id, display_name, status)
     VALUES ($1, 'Synthetic Consultant', 'active')
     ON CONFLICT (account_id) DO UPDATE SET display_name = 'Synthetic Consultant', status = 'active'`,
    [accountId],
  );

  await client.query(
    `INSERT INTO app_user (user_id, account_id, google_sub, display_name, email, email_verified, status)
     VALUES ($1, $2, $3, 'Synthetic Consultant', 'consultant@example.invalid', true, 'active')
     ON CONFLICT (user_id) DO UPDATE SET display_name = 'Synthetic Consultant', status = 'active'`,
    [userId, accountId, googleSub],
  );

  await client.query(
    `INSERT INTO app_user (user_id, account_id, google_sub, display_name, email, email_verified, status)
     VALUES ($1, $2, $3, 'Grantor', 'grantor@example.invalid', true, 'active')
     ON CONFLICT (user_id) DO NOTHING`,
    [grantorId, accountId, `${googleSub}:grantor`],
  );

  await client.query(
    `INSERT INTO entitlement_grant
       (grant_id, account_id, user_id, tier, grant_actor_kind, granted_by_user_id, justification, effective_from)
     VALUES ($1, $2, $3, 'consultant', 'user', $4, 'signed consultant simulator fixture', clock_timestamp())
     ON CONFLICT DO NOTHING`,
    ["bcc5451d-5715-46c6-84ec-a194e6532f2d", accountId, userId, grantorId],
  );

  // Reference IDs for model policy and scoring config
  const modelPolicyVersionId = "10000000-0000-4000-8000-000000000001";
  const scoringConfigVersionId = "20000000-0000-4000-8000-000000000001";
  const consultantConfigId = "00000000-0000-4000-8000-000000000620";
  const consultantConfigVersion = "consultant-soft-cap.default-20.v1";
  const consultantConfigSha = Buffer.from(
    "3822131148bb2ff21d0cb81d7f1056a0a235c5d3aef58fca446a124a35e850f9",
    "hex",
  );

  let insertedRuns = 0;

  for (let idx = 0; idx < GOLDEN_SCENARIOS.length; idx++) {
    const scenario = GOLDEN_SCENARIOS[idx];
    const num = String(idx + 1).padStart(2, "0");
    const runId = scenario.run_id;
    const requestId = `00000000-0000-4000-8000-0000000001${num}`;
    const canonicalRunId = `00000000-0000-4000-8000-0000000002${num}`;
    const canonicalVersionId = `00000000-0000-4000-8000-0000000004${num}`;
    const confirmationId = `00000000-0000-4000-8000-0000000005${num}`;

    // 1. Canonicalization execution run
    await client.query(
      `INSERT INTO canonicalization_execution_run
         (canonicalization_run_id, account_id, user_id, subject_request_id, request_correlation_id, started_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
       ON CONFLICT (account_id, canonicalization_run_id) DO NOTHING`,
      [
        canonicalRunId,
        accountId,
        userId,
        requestId,
        `corr-v2-golden-${num}`,
        scenario.generated_at,
      ],
    );

    // 2. Sourcing request
    await client.query(
      `INSERT INTO sourcing_request
         (request_id, account_id, created_by_user_id, canonicalization_run_id, current_version, lifecycle_state, created_at)
       VALUES ($1, $2, $3, $4, 1, 'confirmed', $5::timestamptz)
       ON CONFLICT (account_id, request_id) DO NOTHING`,
      [requestId, accountId, userId, canonicalRunId, scenario.generated_at],
    );

    // 3. Canonical request version
    const requestDocJson = JSON.stringify(scenario.request_snapshot);
    await client.query(
      `INSERT INTO canonical_request_version
         (canonical_request_version_id, request_id, account_id, version, canonical_language,
          canonical_document, match_readiness, created_by_user_id, created_at)
       VALUES ($1, $2, $3, 1, 'en', $4::jsonb, 'ready', $5, $6::timestamptz)
       ON CONFLICT (account_id, canonical_request_version_id) DO NOTHING`,
      [
        canonicalVersionId,
        requestId,
        accountId,
        requestDocJson,
        userId,
        scenario.generated_at,
      ],
    );

    // 4. Canonical confirmation
    await client.query(
      `INSERT INTO canonical_confirmation
         (confirmation_id, canonical_request_version_id, account_id, actor_user_id, accepted, confirmed_at)
       VALUES ($1, $2, $3, $4, true, $5::timestamptz)
       ON CONFLICT (canonical_request_version_id, actor_user_id, confirmed_at) DO NOTHING`,
      [
        confirmationId,
        canonicalVersionId,
        accountId,
        userId,
        scenario.generated_at,
      ],
    );

    // 5. Research run
    const state =
      scenario.research_status === "no_strong_match"
        ? "no_responsible_match"
        : "complete";
    const idempotencyHash = createHash("sha256")
      .update(`consultant-golden-v2-run-${num}`)
      .digest();

    await client.query(
      `INSERT INTO research_run
         (run_id, account_id, canonical_request_version_id, requested_by_user_id,
          tier_at_submission, state, model_policy_version_id, scoring_config_version_id,
          idempotency_key_hash, queued_at, started_at, completed_at)
       VALUES ($1, $2, $3, $4, 'consultant', $5, $6, $7, $8, $9::timestamptz, $9::timestamptz, $9::timestamptz)
       ON CONFLICT (run_id) DO UPDATE
       SET state = $5,
           tier_at_submission = 'consultant',
           canonical_request_version_id = $3,
           completed_at = $9::timestamptz`,
      [
        runId,
        accountId,
        canonicalVersionId,
        userId,
        state,
        modelPolicyVersionId,
        scoringConfigVersionId,
        idempotencyHash,
        scenario.generated_at,
      ],
    );

    // 6. Run result
    const docJson = JSON.stringify(scenario);
    const docSha256 = standardCompleteResultDocumentSha256(scenario);
    const outcome =
      scenario.research_status === "no_strong_match"
        ? "no_responsible_match"
        : "candidates";
    const eligibleCount = scenario.supplier_candidates.length;
    const consideredCount =
      scenario.result_modules.sourcing?.evaluated_supplier_count ??
      eligibleCount;
    const limitationsText =
      scenario.executive_summary.primary_limitation ??
      "Consultant research advisory boundary";

    await client.query(
      `INSERT INTO run_result
         (run_id, account_id, outcome, eligible_count, considered_count, limitations_text,
          complete_result_document, result_sha256, assembled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::timestamptz)
       ON CONFLICT (run_id) DO UPDATE
       SET complete_result_document = $7::jsonb,
           result_sha256 = $8,
           outcome = $3,
           eligible_count = $4,
           considered_count = $5,
           limitations_text = $6,
           assembled_at = $9::timestamptz`,
      [
        runId,
        accountId,
        outcome,
        eligibleCount,
        consideredCount,
        limitationsText,
        docJson,
        docSha256,
        scenario.generated_at,
      ],
    );

    // 7. Consultant projection policy (append-only table)
    await client.query(
      `INSERT INTO consultant_result_projection_policy
         (account_id, run_id, config_id, config_version, soft_cap, config_content_sha256)
       VALUES ($1, $2, $3, $4, 20, $5)
       ON CONFLICT (account_id, run_id) DO NOTHING`,
      [
        accountId,
        runId,
        consultantConfigId,
        consultantConfigVersion,
        consultantConfigSha,
      ],
    );

    insertedRuns++;
  }

  await client.query("COMMIT");
  console.log(
    `✔ Successfully upserted ${insertedRuns} golden scenarios into PostgreSQL.`,
  );

  // Verify count
  const verifyRes = await client.query(
    `SELECT COUNT(*)::int AS count FROM research_run
      WHERE tier_at_submission = 'consultant'
        AND run_id >= '00000000-0000-4000-8000-000000000301'
        AND run_id <= '00000000-0000-4000-8000-000000000315'`,
  );

  const count = verifyRes.rows[0]?.count ?? 0;
  if (count !== 15) {
    throw new Error(
      `Seeding verification failed: Expected 15 runs in PostgreSQL, found ${count}.`,
    );
  }
  console.log(
    `✔ Verified ${count} consultant research runs present in PostgreSQL.`,
  );
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("❌ Fatal database seeding error:", err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}

console.log(
  "\n=== Seeding complete: 15 Consultant Output V2 Scenarios ready for UAT. ===\n",
);
