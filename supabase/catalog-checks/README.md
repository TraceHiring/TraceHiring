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
   those schemas and every `pg_inherits` descendant (recursive) of a relation in scope, whatever schema the
   partition or child lives in. The checks that need it share one CTE text (`scope_schema`, `scope_rel`, under
   `with recursive`); keep it identical in every file.
6. **Skipped:**
   - system schemas: `pg_catalog`, `information_schema`, `pg_toast*`, `pg_temp*`, `auth`, `storage`, `extensions`,
     `realtime`, `_realtime`, `graphql`, `graphql_public`, `supabase_functions`, `supabase_migrations`, `vault`,
     `pgsodium`, `pgsodium_masks`, `net`, `cron`, `pgbouncer`, `_analytics` (checked against the local stack
     on 2026-10-11: no other schema exists). They are out of scope, not unchecked: MT-8b checks their owners, and
     MT-7 and MT-9 report SECURITY DEFINER functions and hand-made objects in them;
   - extension members, only when **both** hold: a `pg_depend` row with `deptype = 'e'` matching on `classid`
     **and** `objid`, and the object lives in its extension's own namespace (`pg_extension.extnamespace`).
     An object added to an extension from another schema is still checked.

## Rules for a fixture `fixtures/MT-<id>.<branch>.violation.sql`

1. Plain SQL statements, each ending with `;`. It runs as `postgres` inside a savepoint of the test
   transaction, and is rolled back right after the assertion.
2. No transaction control (`begin`, `commit`, `rollback`, `savepoint`, `release`), no psql meta-commands, no `$q$`.
3. It leaves the role and `search_path` as it found them. (The generator also emits `reset role;` after it.)
4. Every object, role or schema it creates is named with the prefix `mt_<id>_` (for example `mt_5c_reader`),
   so concurrent runs never collide. The one exception is `MT-8b.system_schema_owner`, which has to create a
   schema with a system-list name (`cron`; Trace never installs `pg_cron`). A fixture that needs an extension
   uses one Trace never installs, or `create extension if not exists` when the extension's schema does not matter.
5. It makes the check return **at least one row with `branch = '<branch>'`**, and should make no other branch
   of the same check fire. The generated assertion filters on `branch`, so each predicate is proven on its own.

## PostgreSQL version

The checks need **PostgreSQL 17 or later**:

- MT-4 tests the `MAINTAIN` privilege, which PostgreSQL 17 added;
- MT-5c reads `pg_auth_members.inherit_option` and `set_option` (PostgreSQL 16);
- MT-5a, 5b, 5d, 10 and 11 follow the PostgreSQL 16 role model: a role that `postgres` creates gives `postgres`
  ADMIN OPTION only (no INHERIT, no SET), and an ADMIN-only member can grant itself SET, so they test
  `pg_has_role('postgres', …, 'MEMBER')`. Fixtures use the PostgreSQL 16 `grant … with inherit …, set …` syntax.

On an older major the checks fail with an error rather than pass: on 16, MT-4 rejects the unknown privilege
`MAINTAIN`; on 15, MT-5c and the fixtures that use `with inherit …, set …` fail too. This follows from the release
notes and was not run (only a 17 stack is available). The local stack runs 17.11. Staging's major version is
reported with H5 (spec §8.1), and AT-18, the first run of the checks on staging, confirms that staging runs
PostgreSQL 17. MT-11 reads the stored node trees of policy clauses as text, and that format can change between
major versions: run its fixtures again after any major upgrade.

## Day-one facts (local stack, CLI 2.120.0, PostgreSQL 17.11, 2026-10-11)

- `postgres` is **not** a superuser (`supabase_admin` is). Migrations run as `postgres` and the reserved schemas
  are owned by `postgres`.
- Not everything a migration creates is owned by `postgres`: `create type public.x as range (subtype = int4)`
  run as `postgres` creates the type owned by `postgres`, but its five range and multirange constructor functions
  owned by `supabase_admin`, with EXECUTE for PUBLIC, `anon`, `authenticated` and `service_role`. `postgres`
  cannot fix that: `revoke` only warns "no privileges could be revoked", and `alter function … owner to postgres`
  fails with "must be owner of function". MT-4 and MT-9 report those functions, so custom range types cannot be
  used in scope.
- Schema owners: `extensions`, `_realtime`, `supabase_migrations` and the reserved schemas are owned by `postgres`
  (`public` by `pg_database_owner`), `pgbouncer` by `pgbouncer`, and every other system schema by
  `supabase_admin`. PostgreSQL creates `pg_temp_N` and `pg_toast_temp_N` owned by `supabase_admin` (the bootstrap
  superuser). `cron`, `net`, `pgsodium`, `pgsodium_masks` and `_analytics` do not exist locally, and `postgres`
  has CREATE on the database, so a migration could create them; MT-8b expects `supabase_admin` for them.
- `postgres` has CREATE on `extensions`, `_realtime` and `supabase_migrations` (it owns them) and on
  `supabase_functions` (through its membership in `supabase_functions_admin`), and on no other system schema.
- `postgres` is a member (inherit and set) of `anon`, `authenticated`, `service_role`, `authenticator`,
  `pg_create_subscription`, `pg_monitor`, `pg_read_all_data` and `pg_signal_backend` (all with ADMIN OPTION), and
  of `supabase_functions_admin` and `supabase_privileged_role` (without). It has BYPASSRLS. It is not a member of
  `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`, `supabase_realtime_admin`,
  `supabase_replication_admin`, `supabase_etl_admin`, `supabase_read_only_user`, `dashboard_user` or `pgbouncer`,
  and all of them are on `supautils.reserved_memberships`, so only a superuser can grant them (`grant
  supabase_auth_admin to postgres` fails with "role memberships are reserved, only superusers can grant them").
  MT-7 and MT-9 therefore trust objects these roles own (the `supabase_owner` list). Every installed extension is
  owned by `supabase_admin` (locally; on hosted Supabase see "Hosted facts" below).
- Non-member objects in the system schemas where `postgres` can create (relations, functions, and types other
  than relation row types and arrays):
  - `extensions`: functions `grant_pg_cron_access`, `grant_pg_graphql_access`, `grant_pg_net_access`,
    `pgrst_ddl_watch`, `pgrst_drop_watch` and `set_graphql_placeholder`, all owned by `supabase_admin`. No
    relations.
  - `_realtime`: tables `extensions`, `feature_flags`, `schema_migrations` and `tenants` and their indexes, owned
    by `supabase_admin`.
  - `supabase_functions`, owned by `supabase_functions_admin`: tables `hooks` and `migrations`, sequence
    `hooks_id_seq`, indexes `hooks_pkey`, `migrations_pkey`, `supabase_functions_hooks_h_table_id_h_name_idx` and
    `supabase_functions_hooks_request_id_idx`, and the SECURITY DEFINER function `http_request()`.
  - `supabase_migrations`, owned by `postgres`: tables `schema_migrations` and `seed_files` and their primary keys
    `schema_migrations_pkey` and `seed_files_pkey`. No sequences.

  A migration can act as `postgres` or `supabase_functions_admin`, so objects they own are trusted only by name,
  through the literal `supabase_object` list that MT-7 and MT-9 share.
- SECURITY DEFINER functions outside the four schemas that are not extension members:
  `pgbouncer.get_auth(text)` (`supabase_admin`) and `supabase_functions.http_request()` (`supabase_functions_admin`).
- Revoking the `service_role` defaults (baseline) does not touch the Supabase services. This was checked in the
  catalog only; the services were not exercised end to end. The baseline's default-ACL changes apply only to
  objects that `postgres` creates: functions anywhere, and tables, sequences and functions in the four in-scope
  schemas, which hold no Supabase object. The services' objects are owned by their own roles, never by `postgres`
  (`auth`: `supabase_auth_admin`; `storage`: `supabase_storage_admin`; `realtime`: `supabase_realtime_admin` and
  `supabase_admin`; `vault` and `graphql_public`: `supabase_admin`). `service_role` keeps its privileges on
  `storage.objects`, `storage.buckets` and `realtime.messages` and USAGE on `auth` and `storage`. It holds no
  direct privilege on `auth.users` (owned by `supabase_auth_admin`); that is Supabase's own setup, not the
  baseline's.
- `postgres_fdw` and `seg` are available and on the supautils privileged list, so `postgres` can create them (the
  MT-1 `foreign_table_in_scope` and MT-9 `extension_in_scope` fixtures).
- Extensions on the supautils privileged list are owned by `supabase_admin` even when `postgres` creates them
  (checked for `pg_net`, `pg_cron`, `pg_graphql`, `postgis`, `pgtap`, `vector`, `pg_trgm`). `lo` is trusted but not
  privileged, so `postgres` can create it and owns it (the MT-9 `extension_owner` fixture).
- `postgres` holds TRIGGER on 43 Supabase relations outside the four schemas (26 in `auth`, 8 in `realtime`, 7 in
  `storage`, 2 in `extensions`), so a migration can put a trigger on `auth.users` (the MT-5d
  `system_table_trigger` fixture).
- `create role` run as `postgres` records a membership of `postgres` in the new role with ADMIN OPTION only
  (grantor `supabase_admin`, no INHERIT, no SET). The MT-5a and MT-10 `system_schema_view` fixtures grant
  `postgres` SET for a moment to create the view as that role, then revoke that grant.
- Members of `pg_read_all_data`: `postgres` (ADMIN OPTION), `supabase_etl_admin`, `supabase_read_only_user`.
  `pg_write_all_data` has no members, and `postgres` has **no** ADMIN OPTION on it, so the MT-5c
  `read_write_all_data` fixture uses `pg_read_all_data`.
- PostgreSQL accepts `CREATE POLICY` for INSERT without `WITH CHECK` and for SELECT and DELETE without `USING`,
  so no MT-11 branch is `unreachable`.
- `supabase test db` installs pgTAP `with schema extensions`, owned by `supabase_admin`; `anon` and
  `authenticated` keep EXECUTE on it. It recurses into sub-directories and runs every `.sql` file.

## Hosted facts (staging, 2026-10-20; specs/d1-demo-slice.md revision 4m)

The day-one facts above are from the local stack. The first catalog run against hosted staging (dispatch 4, run
39376946373) differed in two ways, both platform objects, not ours:

- `pg_stat_statements`, `uuid-ossp` and `pgcrypto` are pre-installed in `extensions` and **owned by `postgres`**
  (locally `supabase_admin`). The image's init scripts create extensions as `postgres` while it is still a
  superuser, so their members are probably owned by `postgres` too; this account cannot see them. MT-9 skips
  exactly these three in `extension_owner` (`hosted_extension`: name, schema and owner pinned) and trusts only
  members whose code `postgres` cannot have made or replaced (`hosted_member`: C functions loaded from the extension's own
  library without SECURITY DEFINER or SET, the two `pg_stat_statements` views whose rules depend only on the
  extension's functions, and their row and array types). Every other member not owned by a Supabase service role
  fails `extension_added_member`; a member of any other catalog of an extension `postgres` controls fails
  `extension_other_member`.
- `supabase_migrations.schema_migrations_idempotency_key_key` (an index the Supabase CLI adds, owned by `postgres`)
  is on the `supabase_object` list, pinned to relkind `i`.

`scripts/test-catalog-hosted-local.mjs` (`test:rls` step 5e) runs these predicates for real: it makes the local
stack look hosted inside rolled-back superuser transactions (the three extensions and all their members owned by
`postgres`) and runs MT-9 and MT-7 as `postgres` against nine scenarios (clean, an added function, a replaced
function, SECURITY DEFINER, SET, a replaced view, a moved extension, a text search member, a table named like the
index). If Trace ever installs `pgmq` (Supabase Queues), its after-create script re-owns it and its members to
`postgres`, so `extension_owner` and `extension_added_member` fire by design.
