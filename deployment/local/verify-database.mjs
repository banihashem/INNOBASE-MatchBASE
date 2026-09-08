// MB-UX-OPS-002 L01: compare complete retained data without printing row contents.
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createPool } from "../../packages/data/dist/index.js";

if (
  !process.env.MATCHBASE_SOURCE_DATABASE_URL ||
  !process.env.MATCHBASE_TARGET_DATABASE_URL
)
  throw new Error(
    "Source and target database URLs are required in the process environment.",
  );
const source = createPool({
  connectionString: process.env.MATCHBASE_SOURCE_DATABASE_URL,
});
const target = createPool({
  connectionString: process.env.MATCHBASE_TARGET_DATABASE_URL,
});
async function fingerprint(pool) {
  const { rows: tables } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
  );
  const result = {};
  for (const { table_name: name } of tables) {
    const quoted = '"' + name.replaceAll('"', '""') + '"';
    const { rows } = await pool.query(
      `SELECT to_jsonb(t)::text AS value FROM public.${quoted} t ORDER BY to_jsonb(t)::text COLLATE "C"`,
    );
    const hash = createHash("sha256");
    for (const { value } of rows) hash.update(value).update("\n");
    result[name] = { count: rows.length, sha256: hash.digest("hex") };
  }
  return result;
}
try {
  const before = await fingerprint(source);
  const after = await fingerprint(target);
  const differences = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].filter(
    (name) => JSON.stringify(before[name]) !== JSON.stringify(after[name]),
  );
  const report = {
    activity: "MB-UX-OPS-002 L01",
    checked_at: new Date().toISOString(),
    identical: differences.length === 0,
    differences,
    source: before,
    target: after,
  };
  if (process.argv[2])
    await writeFile(process.argv[2], JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      identical: report.identical,
      tables: Object.keys(before).length,
      rows: Object.values(before).reduce((sum, table) => sum + table.count, 0),
      differences,
    }),
  );
  if (differences.length) process.exitCode = 1;
} finally {
  await source.end();
  await target.end();
}
