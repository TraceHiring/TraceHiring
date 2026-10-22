# M0a S1.7 catalog fix pass C: database re-review (`git diff 43d5a30 471b8b9`)

- Date: 2026-10-11, fresh read-only `database-reviewer`. Scope: `supabase/catalog-checks/**` and
  `supabase/tests/catalog_probe.test.sql` at `471b8b9`, against `docs/reviews/M0a-S1.7-catalog-fixes-database-review.md`
  and the spec rev 13 draft of §8.5. Worktree byte-identical to `git archive 471b8b9`.
- Ran (all SQL `begin … rollback` on `supabase_db_trace`, PostgreSQL 17.11): `catalog-run.mjs` 16/16 clean, 84/84
  branches fire, no cross-firing; the D1–D5, D10 repros on old and new; the probe with pgTAP in-transaction 5/5 `ok`;
  10 extensions (pg_net, pg_cron, pg_graphql, pgsodium, vector, pg_trgm, postgis, pgtap, http, pgjwt), false-positive
  controls, a synthetic catalog (150 tables, 600 policies, 600 plpgsql functions); patched scratch copies validating
  the E1/E2 fixes.

## Verdict: PASS WITH FINDINGS
D1 fixed (triggers on `auth.users`, `storage.objects` and a constraint trigger on `auth.identities` hit
`system_table_trigger`; 0 rows at `43d5a30`). D2 fixed (`lo` + `ALTER EXTENSION … ADD` hits `extension_owner`; only
`lo` and `plpgsql` are trusted and outside the supautils list, `plpgsql` is owned by `supabase_admin`). D3 fixed (a
matview in `private` and a `security_invoker=false` view in `extensions` with a column grant hit
`owner_rights_relation`). D4 fixed (both policies hit `auth_only_clause`). D5 fixed (ADMIN-only owner: MT-5a/MT-10
`system_schema_view` and MT-5b `system_schema_function` now fire; before only MT-9). D10 fixed but see E1. D11 fixed.

| # | Sev | file:line (at 471b8b9) | Repro (rolled back) | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| E1 | Medium (rule 1; regression from D10) | `MT-5a.sql:58,304`; `MT-5b.sql:58,301`; `MT-5c.sql:73,289`; `MT-5d.sql:78,358` (comment stripper; `format(`-only literal rule) | Six plpgsql functions in `private`, each `if exists (… integrity.mt_e_f …) then` zeroing `quality.mt_e_s`, hiding the quality write by: (1) `perform pg_catalog.set_config('search_path','quality',true); update mt_e_s …`; (2) `execute 'update ' \|\| quote_ident('quality') \|\| '.mt_e_s …'`; (3) `x := $t$--$t$; update quality.mt_e_s …` on one line; (4) `x := E'\'--'; update quality.mt_e_s …`; (5) `x := $t$/*$t$;` … update … `x := $t$*/$t$;`; (6) `set local search_path = quality;`. All six really zero the score. `43d5a30`: 5/6 caught (MT-5b `prosrc_reference`); `471b8b9`: **0/6 across all 16 checks** | In the shared `caller`: match bodies that contain dollar quotes or `E''` raw (`case when f.prosrc ~ '\$([A-Za-z_][A-Za-z_0-9]*)?\$\|(^\|[^[:alnum:]_$])[eE]''' then f.prosrc else regexp_replace(…) end`); in `reach`: `format[[:space:]]*\(` → `(?:format\|quote_ident\|set_config)[[:space:]]*\(`. Validated: 5/6 flagged, compliant control 0 rows, violation control 6/6, MT-5a–5d clean with all 29 branches firing, timing unchanged. Case (6) needs an MT-7 branch `body_search_path` (or the D7 reviewer rule) | **Fix now**; one proof per shape (1)–(5) |
| E2 | Low (false positive) | `MT-11.sql:93-97,268`; probe copy `catalog_probe.test.sql:376` | `create policy … as restrictive for select to authenticated using ((select auth.jwt() ->> 'aal') = 'aal2');` (Supabase's MFA pattern; build-notes Q8 "RLS requires aal2") hits `auth_only_clause` (0 rows at `43d5a30`) | Add `pol.polpermissive` to `scope_policy` and `and sp.polpermissive` to the no-column finding (a restrictive clause only narrows). Validated: D4 repro 2 rows, aal2 policy 0, MT-11 clean, 11/11 fire. Mirror into the probe copy | **Fix now**; compliant control |
| E3 | Low | `MT-11.sql:64-77` (`scope_rel`); `MT-5d.sql:265-267` (policy hosts limited to `scope_rel`) | `supautils.policy_grants` lets `postgres` create policies on 24 `auth.*`/`storage.*`/`realtime.*` tables: (a) `create policy … on storage.objects for all to public using (true) with check (true)` (and on `realtime.messages`) → 0 rows in all 16 checks; (b) a `storage.objects` policy calling one quality and one integrity `private` function → 0 rows in MT-5d (only MT-5c `definer_bridge` via EXECUTE). No day-one policy exists outside the four schemas | MT-11 branch flagging any policy on a relation in the system-list schemas (Trace uses R2 and Durable Objects, not Supabase Storage/Realtime); MT-5d takes policy hosts from every relation, as for triggers | **Defer → M0b** (database-reviewer, with the MT-10 candidate roles); fixture (a) |

## Answers
1. **D10 trade not acceptable as written**: `set_config('search_path','quality',true)` changes static name resolution
   without `EXECUTE` (the D7 rule misses it; `43d5a30` caught it). Count `set_config(` and `quote_ident(` as well as
   `format(` (E1). No static rule catches a literal in a variable (`v_schema text := 'quality'; execute format('%I.x',
   v_schema)`) or `SET LOCAL search_path = quality`: extend the D7 checklist (M4/M5) to "no EXECUTE and no search_path
   change in a body that names either schema, even as a literal", or add MT-7 `body_search_path` (day one: only
   `extensions.grant_pg_net_access`, owned by `supabase_admin`, mentions search_path, so it would be clean). Spec §8.5
   wording: "as an argument of `format()`, `quote_ident()` or `set_config()`".
2. **The stripper can be fooled** by shapes (3)–(5): deliberate, Low on their own; the fix is one CASE in the shared block (with E1).
3. **MT-11 `public.f()`**: no false positive on planned patterns (helpers live in `private`; MT-7 `outside_private`
   forces definer helpers there; planned policies reference `org_id`/candidate columns). The one real false positive is
   E2. An inline `exists (select 1 from private.staff s where s.user_id = (select auth.uid()))` is flagged
   `auth_only_clause` (acceptable: use a `private` helper). Accepted limit: any `private` function exempts a clause.
4. Copied blocks match (`graph`/`closure` in 5a–5d, `escape` in 5a/5b/5d/10/11, begin lines list exactly their files;
   the probe's MT-11 copy equals `MT-11.sql`). E2 must change the probe copy in step.
5. Performance: no regression (clean 44–48 ms; with 10 extensions MT-5b/5c/5d 1.49–1.53 s new vs 1.55–1.59 s old;
   synthetic catalog MT-5b 2.14 s vs 3.53 s, MT-11 0.62 s vs 0.11 s from the new `tree_call`, others < 0.3 s).

## Not checked
Hosted staging catalog (extension owners, `policy_grants`); PostgreSQL 15/16; `gen-catalog-tests --check` and
`supabase test db` (not run); D6–D8 (deferred); event triggers and publications as hosts; PostGIS with the synthetic catalog.

## Disposition (lead)
PASS WITH FINDINGS. Pass D (writer, on `m0a/s17-assembly`): E1 (incl. an MT-7 `body_search_path` branch for shape 6)
and E2, test-first, then a short database re-review of pass D before `m0a/s17-assembly` merges into integration.
E3 deferred → M0b (database-reviewer; owner M0b). Spec §8.5 wording updated with pass D.
