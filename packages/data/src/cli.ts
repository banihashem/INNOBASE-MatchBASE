import process from "node:process";
import { createPool } from "./database.js";
import { migrateDownLatest, migrateUp } from "./migrations.js";

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
  process.stdout.write(`${direction}:${changed ? "applied" : "unchanged"}\n`);
} finally {
  await pool.end();
}
