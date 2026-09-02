import process from "node:process";
import pg from "../../packages/data/node_modules/pg/lib/index.js";

const connectionString = process.env.MATCHBASE_EVIDENCE_DATABASE_URL;
if (!connectionString?.startsWith("postgres")) {
  throw new Error("MATCHBASE_EVIDENCE_DATABASE_URL is required.");
}
let query = "";
for await (const chunk of process.stdin) query += chunk;
if (
  !/^\s*SELECT\b/iu.test(query) ||
  /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|COPY)\b/iu.test(
    query,
  )
) {
  throw new Error("Only one closed read-only SELECT is accepted.");
}
const client = new pg.Client({ connectionString });
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const result = await client.query({ text: query, rowMode: "array" });
  if (result.rows.length !== 1 || result.rows[0].length !== 1) {
    throw new Error("Closed evidence query must return one scalar row.");
  }
  const value = result.rows[0][0];
  process.stdout.write(
    typeof value === "string" ? value : JSON.stringify(value),
  );
  await client.query("COMMIT");
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {}
  throw error;
} finally {
  await client.end();
}
