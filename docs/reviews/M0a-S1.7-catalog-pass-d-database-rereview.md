# M0a S1.7 catalog pass D: database re-review (`git diff a014953 72f64b4`)

- Date: 2026-10-11, fresh read-only `database-reviewer` (Sonnet; founder model policy: small re-review). Scope:
  `m0a/s17-assembly` commits `d6c2c13` (E1a), `d378b0b` (E1b), `72f64b4` (E2): `supabase/catalog-checks/MT-5a…5d.sql`,
  `MT-7.sql`, `MT-11.sql`, `manifest.json`, `fixtures/MT-7.body_search_path.violation.sql`,
  `supabase/tests/catalog_probe.test.sql`, `catalog_meta.test.sql` (generated), `catalog-min-count`.
- Scope note (founder, 2026-10-11, build-notes §0 "Backstop scope"): E1 shapes (3)–(5) (literals crafted to fool the
  comment stripper) are intentionally not fixed; they are reviewer-checklist items, not findings.
- Ran (commit `72f64b4` read from the object store into a scratch copy; all SQL `begin … rollback` on
  `supabase_db_trace`; nothing persisted afterwards): `catalog-run.mjs` 16/16 clean, 85/85 branches fire
  (`MT-7.body_search_path` 1 row, `MT-11.auth_only_clause` 2 rows), no cross-firing; the four reach blocks
  byte-identical (md5 equal, 2,053 chars); `gen-catalog-tests.mjs` generate mode byte-identical to the committed
  `catalog_meta.test.sql` (101 assertions); pgTAP in-transaction `catalog_meta` 101 ok / 0 not ok, `catalog_probe`
  11 ok / 0 not ok; the probe's MT-11, MT-5b and MT-7 copy blocks `diff`-identical to their checks; floor
  101 + 11 = 112 (base 100 + 5 = 105); own repros against new and `a014953`; timings unchanged (MT-5b–5d 14–22 ms,
  MT-5a 2.7–6.7 ms, MT-7 ~1.4 ms, MT-11 ~2.3 ms).

## Verdict: PASS
- **E1a PASS**: `'quality'`/`'integrity'` as an argument of `format(`, `quote_ident(` or `set_config(` is counted.
  `set_config('search_path','quality',true)` (lower/upper case, multi-line) and `execute 'update ' ||
  quote_ident('quality') || …` (also `pg_catalog.quote_ident(` multi-line) → 4 MT-5b `prosrc_reference` rows (0 at
  `a014953`); a `'public'` control gives 0 rows. The alternation is disjoint (no backtracking blow-up).
- **E1b PASS**: `body_search_path` uses the same `scope_function` CTE (four schemas, every prokind, extension members
  skipped; the added inner `join pg_language` removes no rows). 11 shapes flagged (`SET LOCAL`, `SET SESSION … TO`,
  plain `set` across newlines, quoted `"search_path"`, `set_config('search_path'` any case or with a newline,
  `execute 'set local search_path …'`, a SQL-language function, a function in `public`, a SECURITY DEFINER function in
  `quality`); not flagged: comments, the function-level `set search_path = ''`, `set_config('app.x', …)`,
  `reset search_path`, identifiers like `reset_search_path`, schemas outside the four. Day-one catalog clean.
- **E2 PASS**: restrictive aal2 policies (select/insert/update/delete) give 0 rows (6 `auth_only_clause` + 1
  `qual_without_column` at `a014953`); permissive aal2 and `auth.role()` policies still hit `auth_only_clause`; the D4
  fixture still gives 2 rows; a restrictive policy with an unwrapped `auth.uid()` still hits `auth_call_unwrapped`.

Writer's question (keep string literals in the MT-7 body): **acceptable for a backstop**: it is the only way to
catch `execute 'set local search_path = …'`, the likeliest honest form. Cost: `raise notice '… search_path …'` and
`on conflict … do update set search_path = excluded.search_path` flag (reword or rename). Optional: add "(also
inside a string literal)" to the detail text.

| # | Sev | file:line | Repro | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| none | | | | | |

## Reviewer checklist (not findings)
- E1 shapes (3)–(5): literals crafted to fool the comment stripper (founder decision: out of scope).
- A schema or setting name held in a variable: `declare k text := 'search_path'; perform set_config(k, 'quality',
  true)` and `execute format('%I.t', v_schema)` are not flagged (reproduced).
- `body_search_path` has no per-function exemption: a DDL generator writing `set search_path` in a literal, or a
  body-level `set local search_path = ''` used as hardening, fails until reworded (consistent with "function-level SET
  only"); add an allowlist only if a real need appears.

## Not checked
`gen-catalog-tests.mjs --check` itself (git-dependent floor and manifest-subset parts), `pnpm lint`/`verify`;
cleanliness of the writer's worktree (the commit was read, not the tree); the C/internal skip (code read only); MT-5a,
5c, 5d against the E1 repro (shared reach block; the runner fires all their branches); unchanged checks beyond the
runner; whether the local stack equals the branch's migration head; role/database-level `ALTER … SET search_path`
(`pg_db_role_setting`, outside pass D).

## Disposition (lead)
PASS accepted. `m0a/s17-assembly` @ `72f64b4` merges into `m0a/integration` (`--no-ff`). Spec revision 14 (`2f15140`)
records the narrowed E1, E2, floor 112 and the checklist items. The optional detail-text wording is left to M0b's
catalog pass with E3.
