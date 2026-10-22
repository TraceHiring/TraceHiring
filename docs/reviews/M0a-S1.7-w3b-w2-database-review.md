# M0a S1.7 database review: W3b catalog checks and W2 harness

- Date: 2026-10-11, fresh `database-reviewer` agent, read-only; all SQL in BEGIN … ROLLBACK on `supabase_db_trace`.
- Scope: W3b `git diff f8da8a4..0f62de8` plus MT-5a (branch `worktree-agent-a5a761e3d78529f6f`); W2 `git diff 8c5ef5f..6ab99c6 -- scripts` and `gen-catalog-tests.mjs` from `0d35d0b` (branch `worktree-agent-a9809baf595fe8b13`, tip `aabef91`, which adds only the TAP-count tests).
- Already-known items from `M0a-S1.7-database-review.md` were not re-reported.

## W3b (MT-5a, 5b, 5c, 5d, 10, 11, 12): BLOCK
The runner passes 32/32 (7 clean checks, 25 branch controls); each fixture fires only its own branch, and all are safe in the savepoint. Every check faithfully reads §8.5, so the misses are **spec gaps for revision 12**. Each repro returned 0 rows from all 16 checks (W3a + W3b).

| # | Sev | Where (`supabase/catalog-checks/`) | Problem |
| --- | --- | --- | --- |
| 1 | High | `MT-5d.sql:48-57` (hosts are triggers and policies only); `MT-5a.sql:52` (roots are `v`/`m` only) | A rewrite rule on a table is never inspected: an integrity table can write quality through a rule (and rules run with the owner's rights, so it is also an RLS bypass) |
| 2 | High | closure edges in `MT-5a.sql:31-47`, `MT-5b.sql:32-48`, `MT-5d.sql:58-79` | A plpgsql function calling another plpgsql function is not followed (trigger on integrity → `public.f()` → `public.g()` updating quality) |
| 3 | High | `MT-5c.sql:57-95` | A role holding one schema reads the other through an MT-7-compliant SECURITY DEFINER function in `private` |
| 4 | Medium | `MT-5d.sql:48-57`; `MT-5a.sql:41-47` | Column defaults, generated columns, CHECK constraints and index expressions are not hosts; operators and casts are not followed (`pg_operator`/`pg_cast` filtered out) |
| 5 | Medium | `MT-5d.sql:43-44, 52, 56` | The host must itself be in quality/integrity: a policy on a `public` table that reads both schemas escapes, and so does a `public` table with FKs into both |
| 6 | Medium | `MT-5c.sql:111, 138` | ADMIN-only memberships are not expanded, yet such a member can grant itself inherit and set (confirmed) |
| 7 | Low | `MT-11.sql:143-148` | False positive: `(select (auth.jwt() ->> 'org_id')::uuid)` (deparsed `( SELECT ((auth.jwt() ->> 'org_id'::text))::uuid AS uuid)`) is flagged as unwrapped; M0b JWT-claim policies will trip it |
| 8 | Low | `MT-11.sql:121` | `literal_true` matches only the text `true`; `using (1 = 1)` and `with check (not false)` pass |

Repros (synthetic):
```sql
-- common
create table quality.s (org_id uuid not null, session_id uuid, points int);   alter table quality.s enable row level security;
create table integrity.f (org_id uuid not null, session_id uuid, confirmed bool); alter table integrity.f enable row level security;
-- 1
create rule r as on update to integrity.f where new.confirmed do also update quality.s set points = 0 where session_id = new.session_id;
-- 2
create function public.zero(p uuid) returns void language plpgsql set search_path='' as $$begin update quality.s set points=0 where session_id=p; end$$;
create function public.on_flag() returns trigger language plpgsql set search_path='' as $$begin perform public.zero(new.session_id); return new; end$$;
create trigger t after update on integrity.f for each row execute function public.on_flag();
-- 3
create role qw nologin; grant select on quality.s to qw;
create function private.band(p uuid) returns text language plpgsql stable security definer set search_path='' as $$begin return (select confirmed::text from integrity.f where session_id = p); end$$;
revoke execute on function private.band(uuid) from public, anon, authenticated, service_role;
grant usage on schema private to qw; grant execute on function private.band(uuid) to qw;
-- 4 (default); also: operator public.#~# backed by a plpgsql function reading quality, used in a view over integrity.f
create function public.n() returns int language plpgsql stable set search_path='' as $$begin return (select count(*) from integrity.f); end$$;
create table quality.s2 (org_id uuid not null, penalty int default public.n());
-- 6
-- grant mt_q to w; grant mt_i to w with admin true, inherit false, set false;  then as w: grant mt_i to w with inherit true, set true;  (succeeds)
```
Suggested fixes (each with a new branch and fixture):
- #1: flag any `pg_rewrite` row with `rulename <> '_RETURN'` on an in-scope relation (Trace never needs table rules).
- #2: closure edges from a non-C function to every `pg_proc` named in its `prosrc` (qualified `schema.name(`, unqualified resolved through the `proconfig` search_path, all overloads). Branches e.g. MT-5b `prosrc_call`, MT-5d `trigger_call_chain`.
- #3: EXECUTE on a SECURITY DEFINER function counts as holding every schema its MT-5a closure reaches. Branch `definer_bridge`.
- #4: hosts `pg_attrdef`, `pg_constraint` (contype `c`), index expressions; follow `pg_operator.oprcode`, `pg_cast.castfunc`, domain constraints.
- #5: flag a policy or trigger on any host whose closure reaches both schemas, and a relation with FKs into both; references to `public` tables stay allowed. **Needs a spec decision first:** check the plan's report data model (the report shows both results side by side, rule 5), so a legitimate report/projection table must not be blocked; ask the founder if the plan does not settle it.
- #6: also expand memberships with `admin_option`.
- #7: read `polqual` as a node tree and require every `FUNCEXPR` for `auth.uid`/`auth.jwt` to sit inside an `EXPR_SUBLINK`; add a negative control to the probe file (the generator has no negative-control mechanism).
- #8: also flag a qual whose `pg_depend` rows show no column of `polrelid` and no function.

Shared-code note: the `pg_inherits` fix from the first review is also needed in `rel_reach`/`scope_rel` at `MT-5a.sql:17-30`, `MT-5b.sql:18-31`, `MT-5c.sql:28-41`, `MT-5d.sql:22-35`, `MT-11.sql:26-36`. The system-list escape also applies to the roots at `MT-5a.sql:53-59`, `MT-5b.sql:55-61`, and the four-schema scopes at `MT-10.sql:21`, `MT-11.sql:24`.

Stream decisions judged sound: MT-5c not following members of `postgres` (`postgres` has no ADMIN on itself and no members); MT-5c treating an empty ACL as `acldefault`; MT-5d not skipping extension members; MT-11 relying on `pg_depend`; MT-10 role list.

## W2 harness: PASS
`test-rls.mjs` fails closed on every §8.3 case (Docker down, lock timeout/takeover/unreadable/release, start/reset failure with redacted tail, non-zero exit, `not ok`, TODO/SKIP, plan mismatch, zero tests, bail-out, bad file names, file-set mismatch, floor files, prefix counts, byte-exact db-types drift without overwriting); `test db`/`gen types` stderr is never printed; tests at `scripts/test/test-rls.test.mjs:115-819`. `db-types` running `db reset` is acceptable (same lock, `--local`), but **document** that it wipes local data and leaves the shared stack on that checkout's migrations. `gen-catalog-tests.mjs` is solid.

| # | Sev | Where | Problem and fix |
| --- | --- | --- | --- |
| W2-1 | Low | `scripts/test-rls.mjs:415-425` with `:372-380` | Two runs taking over the same stale lock at once: between `removeIfUnchanged`'s re-read and `unlinkSync`, run B can delete run A's fresh lock. Fix: rename the stale file to a unique name, check its content, then retry the `wx` create; test with an injected interleaving. |
| W2-2 | Low | `scripts/test-rls.mjs:68-76` | The exclude list (kong, postgrest, …) has never run from a cold start; `supabase start` on a running stack is a no-op. Fix: at the S1.7 checkpoint run `supabase stop`, then `pnpm test:rls --stop` once, and record the result. |

## Not checked
MT-12 beyond the spec rule; MAINTAIN on materialized views in MT-10 (same gap as MT-4); hosted staging; `aabef91`; `test db`/`db reset` with services excluded; the `package.json` wiring.
