import { createHash } from "node:crypto";
import { createPool } from "./database.js";

const databaseUrl =
  process.env.MATCHBASE_DATABASE_URL ?? process.env.DATABASE_URL;
if (
  !databaseUrl ||
  !["local", "test"].includes(process.env.MATCHBASE_ENVIRONMENT ?? "") ||
  process.env.MATCHBASE_SYNTHETIC_FIXTURE !== "true"
) {
  throw new Error(
    "Local synthetic seed configuration is invalid or prohibited.",
  );
}

function digest(value: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest();
}

const modelPolicy = {
  mode: "synthetic_fixture_only",
  capabilities: ["translate", "research", "score"],
  liveProvidersEnabled: false,
};
const scoring = {
  weights_bp: { mandatory_gate: 10_000 },
  gate_definitions: { all_mandatory_constraints_required: true },
};

const pool = createPool({ connectionString: databaseUrl, max: 1 });
try {
  await pool.query(
    `INSERT INTO model_policy_version
       (model_policy_version_id, version, capability_map, content_sha256, released_at)
     VALUES ('10000000-0000-4000-8000-000000000001',1,$1::jsonb,$2,clock_timestamp())
     ON CONFLICT (version) DO NOTHING`,
    [JSON.stringify(modelPolicy), digest(modelPolicy)],
  );
  await pool.query(
    `INSERT INTO scoring_config_version
       (scoring_config_version_id, version, weights_bp, gate_definitions, content_sha256,
        released_at, product_owner_approval_ref, sme_approval_ref, evaluation_run_ref)
     VALUES ('20000000-0000-4000-8000-000000000001',1,$1::jsonb,$2::jsonb,$3,
             clock_timestamp(),'S1-PO-OVERLAY','S1-SYNTHETIC-SME','S1-LOCAL-EVAL')
     ON CONFLICT (version) DO NOTHING`,
    [
      JSON.stringify(scoring.weights_bp),
      JSON.stringify(scoring.gate_definitions),
      digest(scoring),
    ],
  );
  process.stdout.write("seed:local-synthetic-ready\n");
} finally {
  await pool.end();
}
