import process from "node:process";
import { createPool } from "./database.js";
import { migrateDownLatest, migrateUp } from "./migrations.js";
import { backfillPrivateEvidenceCategoryScopes } from "./consultant-category-scopes.js";

const direction = process.argv[2];
if (direction !== "up" && direction !== "down") {
  throw new Error("Usage: node dist/cli.js <up|down>");
}

const connectionString = process.env.MATCHBASE_DATABASE_URL;
if (!connectionString) {
  throw new Error("MATCHBASE_DATABASE_URL is required");
}

const pool = createPool({ connectionString, max: 2 });
try {
  const changed =
    direction === "up"
      ? await migrateUp(pool)
      : (await migrateDownLatest(pool)) !== null;
  const scoped =
    direction === "up" ? await backfillPrivateEvidenceCategoryScopes(pool) : 0;
  process.stdout.write(
    `${direction}:${changed ? "applied" : "unchanged"};category_scopes:${scoped}\n`,
  );
} finally {
  await pool.end();
}
