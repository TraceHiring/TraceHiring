# M0a S1.7 catalog fix passes A and B: database re-review (`git diff 9bac676 43d5a30`)

- Date: 2026-10-11, fresh `database-reviewer`, read-only (files extracted with `git show`; no worktrees made).
- Scope: `supabase/catalog-checks/**` and `supabase/tests/catalog_probe.test.sql` at `43d5a30` against spec rev 12
  §8.2–§8.5, `docs/reviews/M0a-S1.7-database-review.md` (items 1–7), `docs/reviews/M0a-S1.7-w3b-w2-database-review.md`
  (#1–#8) and the build-notes §0 rule-1 answer.
- Ran (all SQL in `begin … rollback` on `supabase_db_trace`, PostgreSQL 17.11): `catalog-run.mjs` (read first; rolled
  back only); every repro from both earlier reviews against all 16 checks; the probe with pgTAP created in-transaction;
  18 extensions one at a time; timing on a synthetic catalog (150 tables, 600 policies, 600 plpgsql functions) and with
  PostGIS; patched copies of MT-5c, MT-5d, MT-9 and MT-11 to validate the proposed fixes.

## Verdict: BLOCK
First review items 1–7: **all fixed** (item 1 → MT-1 `inheritance_without_rls`, MT-7 `definer_in_system_schema`, MT-8b
`system_schema_owner`, MT-9 `handmade_in_system_schema`; 2 → MT-7 + MT-9 `handmade_nonadmin_owner`; 3 →
`foreign_table_in_scope`; 4 → MT-3 `composite_type_column`, MT-6 `composite_column`; 5 → MAINTAIN and
`column_references`; 6 → README has all three facts; 7 → fixture uses `seg`). W3b #1–#8: **all fixed** (repros fire
`table_rule`, `trigger_call_chain`, `definer_bridge`, `column_default`, `outside_host_both`, `admin_membership`,
`qual_without_column`; #7 jwt form → 0 rows; the probe negative control passes). `outside_host_both` matches the founder
answer (a `public` table with FKs into both schemas → 0 rows). Runner 16/16 clean, 80/80 branches fire, no
cross-firing; probe 5/5; pgtap, pg_graphql, pg_net, pg_cron, pgsodium, vector, pg_trgm, pgjwt, http, PostGIS and others
→ 0 rows except pg_tle (MT-8b `unknown_schema`, intended); slowest check 0.65 s at scale.
**BLOCK because of D1**, a rule-1 escape that all 16 checks miss through a common Supabase pattern; D2–D5 have small
validated fixes and belong in the same pass.

| # | Sev | file:line (at 43d5a30) | Repro (rolled back) | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| D1 | High | `MT-5d.sql:243` (trigger hosts limited to `scope_rel`) | `postgres` holds TRIGGER on 43 Supabase relations (`auth.*`, `storage.*`, `realtime.*`, `extensions.pg_stat_statements*`). With RLS-on `quality.mt_s`, `integrity.mt_f`: a `private.mt_is_flagged(uuid)` SQL function reading `integrity.mt_f`; a plpgsql trigger function `private.mt_zero()` doing `update quality.mt_s set points = 0 where user_id = new.id`; `create trigger mt_t after update on auth.users for each row when (private.mt_is_flagged(new.id)) execute function private.mt_zero();` → all 16 checks 0 rows (an integrity condition edits a quality score) | Drop the `scope_rel` filter for **trigger** hosts only (other hosts need ownership). Validated: fires `outside_host_both`; 0 rows on clean, PostGIS + pg_net + pg_cron + pg_graphql, and the 150-table catalog | New branch `system_table_trigger`, the repro as fixture |
| D2 | Medium | `MT-9.sql:82-89,100-107,120-127`, `MT-7.sql:69-76` (skip any extension member) | `create extension lo with schema extensions;` (trusted, not supautils-privileged → owned by `postgres`); a `security definer` `extensions.mt_q2_bypass()` granted to `anon`; `alter extension lo add function extensions.mt_q2_bypass();` → 0 rows. Same with a view/function in `extensions` joining both schemas | MT-9 branch `extension_owner`: `pg_extension` where `pg_has_role('postgres', extowner, 'MEMBER')` (ADD needs extension ownership). Validated: 0 rows clean, 1 row (`lo`) after | Fixture `create extension lo with schema extensions;` |
| D3 | Medium | `MT-5c.sql:193-199` (seeds are definer functions only), `:313-318` | Role `mt_q3_qworker` with usage on `quality` + select on `quality.mt_s`; `create materialized view private.mt_q3_flags as select session_id, confirmed from integrity.mt_f;` granted to it (plus usage on `private`) → 0 rows | Seed matviews and views without `security_invoker=true` outside quality/integrity; read their `relacl` (or `acldefault('r')`) as owner-rights holders. Validated: flags the role; 0 rows on clean, PostGIS and scale | New branch `owner_rights_relation`, the repro as fixture |
| D4 | Medium | `MT-11.sql:246-257` (any function with oid ≥ 16384 exempts the clause) | `create policy p_a on quality.s for select to authenticated using ((select auth.uid()) is not null); create policy p_b on quality.s for delete to authenticated using (auth.role() = 'authenticated');` → 0 rows (every logged-in user of any org sees every row) | Count only functions in schema `private` (join `pg_proc`/`pg_namespace` by name, not `'private'::regnamespace`). Validated: both flagged; a `(select private.is_staff())` policy and the scale catalog stay clean | New branch `auth_only_clause`, the repro as fixture |
| D5 | Low | `'SET'` at MT-5a:178,182,210; MT-5b:178,182,207; MT-5d:194,198,216; MT-10:33,37,58; MT-11:49,53,67 | `create role mt_q1_owner nologin;` gives `postgres` ADMIN only (no SET); then `grant … with set true`, create `extensions.mt_q1_both` joining both schemas as that role, revoke the SET grant → only MT-9 `handmade_nonadmin_owner` fires (with SET kept, MT-5a and MT-10 `system_schema_view` fire too) | `'SET'` → `'MEMBER'` on all 15 lines, comments, and spec §8.5 wording (Answer 1) | `MT-5a.system_schema_view` and `MT-10.system_schema_view` fixtures create the view as an ADMIN-only role |
| D6 | Medium (defer) | closure `code_edge` (`MT-5a.sql:76-150`, same in 5b/5c/5d): no relation → trigger edge | RLS-on `public.mt_reports` with an after-update trigger calling `private.mt_zero()` (updates quality); a plpgsql `private.mt_publish(uuid)` updating `public.mt_reports` when an `integrity.mt_f` flag is confirmed → 0 rows | Name-based relation edges from bodies (`schema.table` after INSERT/UPDATE/DELETE) plus relation → non-internal triggers and rules | **Owner M6** (`reports` junction); database-reviewer checks by hand in M4/M5 |
| D7 | Low (defer) | same closure | `create operator private.#~# (… function = private.mt_q_lookup)` (reads quality) used in a plpgsql body with `set search_path = private` that also reads `integrity.mt_f` → 0 rows; casts, domains and `EXECUTE` strings likewise | Edges to operators whose `oprname` appears in a body; dynamic SQL becomes a reviewer rule: no `EXECUTE` in functions that name either schema | Owner M4/M5 database-reviewer checklist |
| D8 | Low (defer) | `MT-5d.sql:225-236` (FKs only between the two schemas) | `integrity.mt_flag` ← `public.mt_report` (on delete cascade) ← `quality.mt_score` (on delete cascade), RLS on → 0 rows: deleting a flag deletes a score | Recursive CTE over cascading FKs (`confdeltype`/`confupdtype` in c, n, d) from one schema reaching the other | Owner M6 |
| D9 | Low | `catalog_probe.test.sql:108-404`; `shared:graph/closure/escape` blocks; `scope_rel` in MT-1, 3, 4, 9 | Not SQL: the marker block equals `MT-11.sql` today and all shared blocks hash the same, but `git grep "MT-11 copy\|shared:"` in `scripts/` on `m0a/integration` and `m0a/s17-assembly` finds nothing: no check keeps them identical | `gen-catalog-tests --check` compares each `-- X begin/end` block after LF and trailing-`;` normalisation; better, generate the negative controls from `fixtures/MT-11.<name>.compliant.sql` and delete the copy | Unit test: a one-character drift fails `--check` |
| D10 | Low (false positive) | `MT-5a.sql:284-286` (same in 5b/5c/5d) | A plpgsql `private.mt_fp_label(text)` whose body is `case p when 'quality' then 1 when 'integrity' then 2 else 0 end` → MT-5b `prosrc_reference`; a comment such as "data quality." matches too | Strip comments and accept the `'quality'` literal only inside `format(` as §8.5 says; or document a naming workaround | A compliant control |
| D11 | Low | `MT-4.sql:73,110` (MAINTAIN, PG 17); MT-5c `inherit_option`/`set_option` and `pg_has_role(…,'SET')` (PG 16+) | Not runnable here (only a 17.11 stack; the staging major is not recorded in `docs/infra/environments.md`). On 15/16 these checks error (loud, not silent) | README states PostgreSQL ≥ 17; AT-18 confirms staging is on 17 | AT-18 |

Also noted: `catalog-min-count` is 71 at `43d5a30` and 101 on `m0a/s17-assembly` (`79b5986`), as intended.

## Answers
1. **The passes disagree.** Pass A trusts an owner only if it is on the literal list and `postgres` is not a MEMBER;
   pass B treats as ours only owners `postgres` can SET to. In PostgreSQL 17 `create role` run as `postgres` grants
   ADMIN only (inherit f, set f; checked), so every migration-created role, future worker roles included, falls outside
   pass B's scope (D5). MEMBER is right per §8.5 (rev 12's own MT-5c rule says an ADMIN-only member can grant itself
   SET). Change: `'SET'` → `'MEMBER'` on the 15 lines in D5; §8.5 MT-5a/10/11 wording "can SET ROLE to" → "is a member
   of (INHERIT, SET or ADMIN)". Pass A stays. MT-9 backstops relations, functions and types today, hence only Low.
2. **Real escape for rule 1 and tenancy, Medium (D2).** Only through `lo`, the one trusted extension outside the
   supautils privileged list (`plpgsql` is owned by `supabase_admin`; pg_tle trips MT-8b). Needs a deliberate
   `ALTER EXTENSION … ADD`; `extensions` is not exposed through PostgREST, but a `public` RPC could route through it.
   Fix now: one branch.
3. (a) Matviews / non-invoker views: real, Medium (D3); fix now (validated, small; latest safe point is before M0b's
   worker-role migration). (b) Trigger side effects: Medium, defer to M6 (D6); operators/casts/domains in bodies: Low,
   M4/M5 database-reviewer checklist (D7); dynamic SQL: undecidable statically → reviewer rule (D7); cascading FK
   chains: D8, owner M6. (c) The MT-11 copy: nothing keeps it identical on any branch; Low, fix now in the generator (D9).
4. No false positives on Supabase's own objects with 18 extensions (the one real false positive is D10). No
   non-determinism (MT-11 depends on the node-tree text format: re-run its fixtures on any major upgrade). Worst
   0.65 s (MT-11) and 0.52 s (MT-5b) on the synthetic catalog; < 0.12 s with PostGIS. Major-version breakage: D11.
   No branch that can never fire (80/80 fire alone). A trusted-by-name object can change under the same name:
   `create or replace function supabase_functions.http_request()` keeps MT-7/MT-9 trust; it returns `trigger`, so it
   is not directly callable (Low; noted).

## Not checked
The hosted staging catalog (owners, extra roles, MT-8b day-one owners, the MT-9 literal list on hosted); PostgreSQL 15
and 16; the 22k-line generated `catalog_meta.test.sql`, `supabase test db` and the harness (not allowed to run; the
probe prints "planned 5 but ran 4" because the savepoint rolls back, all 5 TAP lines are `ok`); event triggers,
publications, FDW servers, user mappings and text-search objects as code hosts; MT-2, MT-8, MT-12 beyond the runner.

## Disposition (lead)
BLOCK accepted. Fix pass C on a branch from `43d5a30` (`supabase/catalog-checks/**`, `catalog_probe.test.sql`):
D1, D2, D3, D4, D5, D10, D11, test-first, one commit each. D9 is fixed in `scripts/gen-catalog-tests.mjs` on top of
`m0a/s17-assembly`. Deferred with owners: D6 → M6 (reviewer checks by hand in M4/M5), D7 → M4/M5 database-reviewer
checklist (incl. the no-`EXECUTE` rule), D8 → M6. Spec §8.5 wording for D5 and the new branch names go into spec rev 13.
Then a short database re-review of pass C before `m0a/s17-assembly` merges into integration.
