import { inTransaction, type ConnectionPool } from "./database.js";

/** Administrative provisioning only. Never called by an application request or environment flag. */
export async function provisionPublicCorpusRoles(
  pool: ConnectionPool,
  prefix = "matchbase_public",
): Promise<{
  owner: string;
  reader: string;
  acquirer: string;
  releaser: string;
}> {
  return inTransaction(pool, async (db) => {
    if (!/^[a-z][a-z0-9_]{2,40}$/u.test(prefix))
      throw new Error("Invalid public role prefix");
    const roles = {
      owner: `${prefix}_owner`,
      reader: `${prefix}_reader`,
      acquirer: `${prefix}_acquirer`,
      releaser: `${prefix}_releaser`,
    };
    for (const role of Object.values(roles)) {
      const existing = await db.query<{ present: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) AS present",
        [role],
      );
      if (existing.rows[0]?.present)
        throw new Error(
          "Public corpus role already exists; inspect it before provisioning",
        );
    }
    for (const role of Object.values(roles))
      await db.query(
        `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`,
      );
    await db.query(`ALTER SCHEMA matchbase_public OWNER TO ${roles.owner}`);
    const tables = await db.query<{ name: string }>(
      "SELECT quote_ident(tablename) AS name FROM pg_tables WHERE schemaname='matchbase_public'",
    );
    for (const table of tables.rows)
      await db.query(
        `ALTER TABLE matchbase_public.${table.name} OWNER TO ${roles.owner}`,
      );
    const functions = await db.query<{ signature: string; name: string }>(
      "SELECT p.oid::regprocedure::text AS signature,p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='matchbase_public'",
    );
    const capabilities: Record<string, string[]> = {
      reader: ["lookup", "register_derivative", "assert_derivative"],
      acquirer: ["acquire"],
      releaser: [
        "authorize_acquisition",
        "release",
        "withdraw",
        "begin_restore",
        "reconcile_tombstones",
      ],
    };
    for (const role of [roles.reader, roles.acquirer, roles.releaser])
      await db.query(`GRANT USAGE ON SCHEMA matchbase_public TO ${role}`);
    for (const fn of functions.rows) {
      await db.query(`ALTER FUNCTION ${fn.signature} OWNER TO ${roles.owner}`);
      await db.query(`REVOKE ALL ON FUNCTION ${fn.signature} FROM PUBLIC`);
      for (const capability of ["reader", "acquirer", "releaser"] as const) {
        if (capabilities[capability]?.includes(fn.name))
          await db.query(
            `GRANT EXECUTE ON FUNCTION ${fn.signature} TO ${roles[capability]}`,
          );
      }
    }
    return roles;
  });
}
