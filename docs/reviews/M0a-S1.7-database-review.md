# M0a S1.7 database review (foundation + W3a catalog checks)

- Date: 2026-10-11, fresh `database-reviewer` agent, read-only. Every repro ran in BEGIN … ROLLBACK on the local stack (`supabase_db_trace`, PostgreSQL 17.11).
- Scope: `cf8626d` (config, baseline migration, seed, manifest, README, floors, `catalog_probe.test.sql`, MT-8b) and `905be8f` (`packages/db-types`), plus stream W3a `git diff cf8626d..37adfd9` (MT-1, 2, 3, 4, 6, 7, 8, 9 and 25 fixtures; branch `worktree-agent-a66ca65381173c087`).
- Not in scope: W3b (MT-5a–5d, 10, 11, 12; still being written), `gen-catalog-tests.mjs`, `test-rls.mjs`.

## Verdict: BLOCK

The baseline migration matches §8.2 exactly and is safe. The block is about the catalog checks: several miss violations they are meant to catch, and the worst one lets an object escape every check. In the W3a checkout the dev runner passes 35/35 (9 clean checks, 26 branch controls), with and without pgTAP, and each fixture fires only its own branch.

| # | Severity | Where (W3a `supabase/catalog-checks/`) | Problem |
| --- | --- | --- | --- |
| 1 | Blocking | `MT-8b.sql:10-14`; the shared `scope_rel` CTE in `MT-1.sql:10-20`, `MT-2.sql:17-27`, `MT-3.sql:11-21`, `MT-4.sql:13-23`, `MT-9.sql:11-21`; `MT-9.sql:74` | An object escapes every check through a schema on the system list, or as an `INHERITS` child |
| 2 | High | `MT-9.sql:75`, `:92`; `MT-7.sql:15`, `:42` | A SECURITY DEFINER function owned by `service_role` and executable by PUBLIC goes unnoticed in `extensions`; MT-7 scans only public/quality/integrity, but §8.5 says any schema outside `private` |
| 3 | Medium | `MT-1.sql:31`, `MT-2.sql:33` | Foreign tables in scope cannot have RLS, and they pass |
| 4 | Low | `MT-3.sql:28`, `MT-6.sql:17-27` | MT-3 and MT-6 do not look inside composite or range types |
| 5 | Low | `MT-4.sql:65`, `:98-102` | MT-4 ignores MAINTAIN and column-level REFERENCES (`attacl`); the MT-4b probe does include MAINTAIN |
| 6 | Low | `README.md:49-63` | Day-one facts incomplete, one wrong |
| 7 | Low | `fixtures/MT-9.extension_in_scope.violation.sql:2` | The fixture breaks once `pg_trgm` is installed for real |

### 1. Blocking: escape through system-list schemas and inheritance
Local facts: `postgres` has CREATE on `_realtime` and `supabase_migrations` (owns them), `supabase_functions` (via `supabase_functions_admin`) and `extensions`, and CREATE on the database. Five listed names do not exist locally (`cron`, `net`, `pgsodium`, `pgsodium_masks`, `_analytics`), so a migration can create them and MT-8b skips them. The scope CTE follows `pg_partition_tree` only, not `pg_inherits`.
With the following, MT-1, 2, 3, 4, 6, 7, 8, 8b and 9 all return 0 rows:
```sql
create schema cron;
create table cron.mt_jobs (id int);
grant select, truncate on cron.mt_jobs to anon;
create function cron.mt_rpc() returns int language sql security definer as 'select 1';
grant execute on function cron.mt_rpc() to anon;
create type cron.mt_outcome as enum ('auto_reject');
create table _realtime.mt_scores (honesty_score int, dob date);
create function supabase_functions.mt_rpc() returns int language sql security definer as 'select 1';
create table public.mt_parent (org_id uuid not null);
alter table public.mt_parent enable row level security;
create table supabase_migrations.mt_child () inherits (public.mt_parent);
```

### 2. High: SECURITY DEFINER function owned by `service_role` in `extensions`
`postgres` owns `extensions` and is an ADMIN/SET member of `anon`, `authenticated` and `service_role`:
```sql
grant create on schema extensions to service_role;
set role service_role;
create function extensions.mt_9_bypass() returns bigint language sql security definer as 'select 1::bigint';
reset role;
revoke create on schema extensions from service_role;
```
The function is owned by `service_role` (bypasses RLS), `proacl` is NULL so PUBLIC can execute it, and MT-4, MT-7 and MT-9 all return 0 rows. The same goes for a function handed to `authenticated` or a future worker role.

### 3. Medium: foreign tables
```sql
create extension postgres_fdw with schema extensions;
create server mt_srv foreign data wrapper postgres_fdw options (dbname 'postgres');
create foreign table public.mt_ft (org_id uuid not null) server mt_srv;
grant select on public.mt_ft to authenticated;
-- enable row level security -> ERROR: not supported for foreign tables
```
MT-1, MT-2, MT-9 and MT-4 (anon only) return 0 rows. A foreign-table partition of an in-scope parent escapes the same way.

### 4. Low: composite and range types
```sql
create type public.mt_3_person as (date_of_birth date, honesty_score int);
create table public.mt_3_people (org_id uuid not null, person public.mt_3_person);   -- MT-3: 0 rows
create type public.mt_6_st as enum ('ok','rejected');
create type public.mt_6_wrap as (s public.mt_6_st);
create table integrity.mt_6_x (org_id uuid not null, w public.mt_6_wrap);           -- MT-6: 0 rows
```
Ranges and multiranges over that enum are also missed.

### 5. Low: MT-4 privileges
`grant maintain on public.t to anon;`, `grant maintain … to authenticated;` and `grant references (org_id) on public.t to authenticated;` all give 0 rows.

### 6. Low: README day-one facts
- Missing: the §8.2 record that revoking the `service_role` defaults doesn't break the Supabase services M0b needs.
- Not always true: "postgres owns what migrations create". `create type public.x as range (subtype = int4)` run as `postgres` makes constructor functions owned by `supabase_admin`, executable by PUBLIC, `anon`, `authenticated` and `service_role` (from `supabase_admin`'s default privileges in `public`, which `postgres` cannot change). MT-4 and MT-9 catch it, but `postgres` can neither revoke nor take ownership, so custom range types can never be used in scope. Record this.
- Missing: `postgres` has CREATE on `_realtime`, `supabase_functions` and `supabase_migrations`; the five schemas above are absent locally.

### 7. Low: MT-9 `extension_in_scope` fixture
`create extension pg_trgm with schema private` fails with "already exists" once a migration installs `pg_trgm`, which aborts the whole generated test file (loud, not silent). Use an extension Trace will not install.

## Checked and clean
- Baseline matches §8.2 exactly (diffed); timestamp `20261011015904` is UTC; no tables, functions or SECURITY DEFINER functions; LF endings.
- After the baseline: reserved schemas have ACL `{postgres=UC/postgres}`; no CREATE on `public` for PUBLIC, `anon`, `authenticated`, `service_role`; `postgres`'s global function default is `{postgres=X/postgres}` and its `public` defaults grant only to `postgres`; API roles have no CREATE on the database. Remaining risk: `supabase_admin`'s per-schema defaults grant ALL in `public` to the API roles (MT-4 and MT-9 catch the affected objects).
- MT-4b: 4/4 pass, and each assertion fails under its own default-ACL mutation.
- Fixtures: transactional, names prefixed `mt_<id>_`, no role or search_path change left behind.
- MT-7: `set search_path = ''` is stored as `search_path=""`.
- README facts confirmed: `postgres` is not a superuser and has CREATE on `extensions`; the 6 non-member helpers in `extensions` are owned by `supabase_admin`; `pg_read_all_data` members as listed, `pg_write_all_data` none; all four CREATE POLICY forms accepted; pgTAP created as `postgres` is owned by `supabase_admin` and `anon`/`authenticated` keep EXECUTE.
- Manifest 16 IDs / 51 branches; floors 71 and 0 match §8.5. `config.toml`: `project_id`, Studio off, major 17; `private`/`quality`/`integrity` not exposed. `seed.sql` empty. db-types covers `public` only and is pinned by tests. Quoted or case-variant schema names (`"Cron"`) fire MT-8b.

## Not checked
W3b; `gen-catalog-tests.mjs`, `catalog_meta.test.sql`, `test-rls.mjs`, db-types drift; README:63 (`supabase test db` recursing into sub-directories; needs `test db`); the staging catalog; the effect of revoking `service_role` defaults on Supabase services.

## Fix plan (lead, 2026-10-11; test-first, one commit per finding, then a fresh database-reviewer re-review)
Needs a §8.5 amendment (spec revision 12): new branches raise the manifest and `catalog-min-count`. Every distinct escape path gets its own branch and positive-control fixture (the generator allows one fixture per branch). Proposed:
1. **Scope:** the shared scope CTE (in every check that uses it, W3b's included) adds `pg_inherits` descendants of in-scope tables, like partitions. New branch MT-1 `inheritance_without_rls` (an INHERITS child in a system schema with RLS off).
   **MT-8b** new branch `system_schema_owner`: a system-list schema whose owner differs from the day-one list (`extensions`, `_realtime`, `supabase_migrations` → `postgres`; `pgbouncer` → `pgbouncer`; all others, including the five absent ones → `supabase_admin`). Fixture: `create schema cron`.
   **MT-9:** the hand-made rule covers every system schema where `postgres` can create (`extensions`, `_realtime`, `supabase_migrations`, `supabase_functions`) and flags relations, functions **and types** that are not extension members and whose owner is not on a recorded Supabase-owner allow-list (allow-list `supabase_migrations.schema_migrations`, `seed_files` and their keys). New branch `handmade_in_system_schema` (fixture: a table in `_realtime`).
2. **MT-9** hand-made: owner *not in* the allow-list (not `= 'postgres'`). New branch `handmade_nonadmin_owner` (fixture: the `service_role` snippet). **MT-7 `outside_private`:** scan every schema, skipping extension members and functions owned by recorded Supabase roles; new branch `definer_in_system_schema` (fixture: the same snippet).
3. **MT-1** new branch `foreign_table_in_scope` (relkind `f` anywhere in scope, partition trees included).
4. **MT-3:** add relkind `c`; new branch `composite_type_column`. **MT-6:** recurse through composites (`typrelid`) and ranges/multiranges (`pg_range`); new branches `composite_column`, `range_column`.
5. **MT-4:** add MAINTAIN to (a) and (b); (b) also reads `aclexplode(attacl)` for REFERENCES; new branch `column_references`.
6. **README:** add the three facts above.
7. **MT-9 `extension_in_scope` fixture:** switch to an extension Trace will not install (check `pg_available_extensions`).

After the fixes: update the manifest, `supabase/tests/catalog-min-count` (exact new assertion count) and spec §8.5 thresholds (revision 12; spec-reviewer + database-reviewer).
