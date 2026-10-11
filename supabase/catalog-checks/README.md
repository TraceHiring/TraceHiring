# Catalog checks (spec `specs/m0-foundations.md` §8.5)

Each `MT-<id>.sql` file is a plain **violation query**: it returns one row per violation and no rows when the
database is clean. These files are the single source of truth. They run:

- locally and in CI, through the generated pgTAP file `supabase/tests/catalog_meta.test.sql`
  (`node scripts/gen-catalog-tests.mjs`; `--check` in `pnpm lint` fails if it is stale);
- against staging, file by file, with `psql -X -v ON_ERROR_STOP=1 -At` inside
  `begin; set transaction read only; … rollback;` (§7.2 step 4). Fixtures never run there.

`manifest.json` lists the required check IDs and, for each, its **branches**: one per independent predicate.
IDs and branches may only be added, never removed.

## Rules for a check file `MT-<id>.sql`

1. Exactly **one** `SELECT` statement (a leading `WITH` is fine). An optional trailing `;` is stripped by the
   generator; there is no other `;` anywhere in the file, including in comments and string literals. No `$q$`.
2. It returns exactly three columns, in this order: **`branch text, object text, detail text`**.
   - `branch` is one of the branch IDs listed for this check in `manifest.json`;
   - `object` names the violating object (`schema.name`, a role, a policy …);
   - `detail` says what is wrong, in a few words.
3. It is **read-only and self-contained**: no temp tables, no function calls that write, no dependency on pgTAP.
   It must work in a read-only transaction as `postgres` (a non-superuser on Supabase).
4. It is clean (returns no rows) on the baseline migration, with pgTAP installed in `extensions` by
   `supabase_admin` (that is how `supabase test db` installs it), and on hosted Supabase.
5. **Scope** (§8.5): every relation, function, policy, trigger, constraint and type in the schemas `public`,
   `private`, `quality` and `integrity`, plus every member of `pg_partition_tree()` of a partitioned table in
   those schemas, whatever schema the partition lives in.
6. **Skipped:**
   - system schemas: `pg_catalog`, `information_schema`, `pg_toast*`, `pg_temp*`, `auth`, `storage`, `extensions`,
     `realtime`, `_realtime`, `graphql`, `graphql_public`, `supabase_functions`, `supabase_migrations`, `vault`,
     `pgsodium`, `pgsodium_masks`, `net`, `cron`, `pgbouncer`, `_analytics` (checked against the local stack
     on 2026-10-11: no other schema exists);
   - extension members, only when **both** hold: a `pg_depend` row with `deptype = 'e'` matching on `classid`
     **and** `objid`, and the object lives in its extension's own namespace (`pg_extension.extnamespace`).
     An object added to an extension from another schema is still checked.

## Rules for a fixture `fixtures/MT-<id>.<branch>.violation.sql`

1. Plain SQL statements, each ending with `;`. It runs as `postgres` inside a savepoint of the test
   transaction, and is rolled back right after the assertion.
2. No transaction control (`begin`, `commit`, `rollback`, `savepoint`, `release`), no psql meta-commands, no `$q$`.
3. It leaves the role and `search_path` as it found them. (The generator also emits `reset role;` after it.)
4. Every object, role or schema it creates is named with the prefix `mt_<id>_` (for example `mt_5c_reader`),
   so concurrent runs never collide.
5. It makes the check return **at least one row with `branch = '<branch>'`**, and should make no other branch
   of the same check fire. The generated assertion filters on `branch`, so each predicate is proven on its own.

## Day-one facts (local stack, CLI 2.120.0, PostgreSQL 17.11, 2026-10-11)

- `postgres` is **not** a superuser (`supabase_admin` is). Migrations run as `postgres` and the reserved schemas
  are owned by `postgres`.
- `postgres` has CREATE on `extensions` (the MT-9 hand-made fixture can create a function there).
- Non-member functions in `extensions`, all owned by `supabase_admin`: `grant_pg_cron_access`,
  `grant_pg_graphql_access`, `grant_pg_net_access`, `pgrst_ddl_watch`, `pgrst_drop_watch`,
  `set_graphql_placeholder`. No non-member relations.
- Members of `pg_read_all_data`: `postgres` (ADMIN OPTION), `supabase_etl_admin`, `supabase_read_only_user`.
  `pg_write_all_data` has no members, and `postgres` has **no** ADMIN OPTION on it, so the MT-5c
  `read_write_all_data` fixture uses `pg_read_all_data`.
- PostgreSQL accepts `CREATE POLICY` for INSERT without `WITH CHECK` and for SELECT and DELETE without `USING`,
  so no MT-11 branch is `unreachable`.
- `supabase test db` installs pgTAP `with schema extensions`, owned by `supabase_admin`; `anon` and
  `authenticated` keep EXECUTE on it. It recurses into sub-directories and runs every `.sql` file.
