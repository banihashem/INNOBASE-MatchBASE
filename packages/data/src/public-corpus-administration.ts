import { inTransaction, type ConnectionPool } from "./database.js";

const publicCorpusRoles = (prefix: string) => ({
  owner: `${prefix}_owner`,
  reader: `${prefix}_reader`,
  acquirer: `${prefix}_acquirer`,
  releaser: `${prefix}_releaser`,
});

async function reconcileRoleObjects(
  db: import("./database.js").Queryable,
  roles: ReturnType<typeof publicCorpusRoles>,
) {
  const existing = await db.query<{
    rolname: string;
    safe: boolean;
  }>(
    `SELECT rolname,NOT (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AS safe
     FROM pg_roles WHERE rolname=ANY($1::name[])`,
    [Object.values(roles)],
  );
  if (
    existing.rows.length !== Object.keys(roles).length ||
    existing.rows.some((role) => !role.safe)
  )
    throw new Error("Public corpus capability roles are missing or unsafe");
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
    reader: [
      "lookup",
      "lookup_refs",
      "reader_ready",
      "register_derivative",
      "assert_derivative",
    ],
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
}

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
    const roles = publicCorpusRoles(prefix);
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
    await reconcileRoleObjects(db, roles);
    return roles;
  });
}

/** Re-applies least-privilege ownership and grants after schema migrations add functions. */
export async function reconcilePublicCorpusRoles(
  pool: ConnectionPool,
  prefix = "matchbase_public",
): Promise<ReturnType<typeof publicCorpusRoles>> {
  if (!/^[a-z][a-z0-9_]{2,40}$/u.test(prefix))
    throw new Error("Invalid public role prefix");
  const roles = publicCorpusRoles(prefix);
  await inTransaction(pool, (db) => reconcileRoleObjects(db, roles));
  return roles;
}

/** Binds an externally created LOGIN role to exactly one verified product identity. */
export async function bindPublicCorpusReader(
  pool: ConnectionPool,
  input: {
    database_role: string;
    reader_capability_role: string;
    account_id: string;
    profile_id: string;
    verified_identity_reference: string;
  },
): Promise<void> {
  await inTransaction(pool, async (db) => {
    for (const name of [input.database_role, input.reader_capability_role])
      if (!/^[a-z][a-z0-9_]{2,62}$/u.test(name))
        throw new Error("Invalid public corpus role binding");
    const role = await db.query<{
      safe: boolean;
      can_login: boolean;
      capability_present: boolean;
    }>(
      `SELECT NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
          OR has_table_privilege(r.rolname,'public.consultant_private_observation','SELECT')
          OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname='matchbase_public' AND pg_has_role(r.rolname,n.nspowner,'MEMBER'))) AS safe,
        r.rolcanlogin AS can_login,
        EXISTS(SELECT 1 FROM pg_roles c WHERE c.rolname=$2 AND NOT c.rolcanlogin) AS capability_present
       FROM pg_roles r WHERE r.rolname=$1`,
      [input.database_role, input.reader_capability_role],
    );
    if (
      !role.rows[0]?.safe ||
      !role.rows[0].can_login ||
      !role.rows[0].capability_present ||
      input.verified_identity_reference.length < 8 ||
      input.verified_identity_reference.length > 200
    )
      throw new Error(
        "Public corpus reader identity is not safely provisioned",
      );
    await db.query(
      `GRANT USAGE ON SCHEMA matchbase_public TO ${input.reader_capability_role}`,
    );
    for (const signature of [
      "matchbase_public.lookup(text,text,text,text)",
      "matchbase_public.lookup_refs(jsonb)",
      "matchbase_public.reader_ready(uuid,uuid)",
      "matchbase_public.register_derivative(uuid,text,text,jsonb)",
      "matchbase_public.assert_derivative(uuid)",
    ])
      await db.query(
        `GRANT EXECUTE ON FUNCTION ${signature} TO ${input.reader_capability_role}`,
      );
    await db.query(
      `GRANT ${input.reader_capability_role} TO ${input.database_role}`,
    );
    const current = await db.query(
      "SELECT account_id,profile_id,capability,verified_identity_reference,enabled FROM matchbase_public.principal WHERE database_role=$1",
      [input.database_role],
    );
    if (current.rows[0]) {
      const existing = current.rows[0];
      if (
        existing.account_id !== input.account_id ||
        existing.profile_id !== input.profile_id ||
        existing.capability !== "reader" ||
        existing.verified_identity_reference !==
          input.verified_identity_reference
      )
        throw new Error(
          "Public corpus reader role is already bound differently",
        );
      if (!existing.enabled)
        await db.query(
          "UPDATE matchbase_public.principal SET enabled=true WHERE database_role=$1",
          [input.database_role],
        );
      return;
    }
    await db.query(
      `INSERT INTO matchbase_public.principal(database_role,account_id,profile_id,capability,verified_identity_reference,enabled)
       VALUES($1,$2,$3,'reader',$4,true)`,
      [
        input.database_role,
        input.account_id,
        input.profile_id,
        input.verified_identity_reference,
      ],
    );
  });
}
