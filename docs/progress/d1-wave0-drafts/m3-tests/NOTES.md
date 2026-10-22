# D1 migration 3 pgTAP drafts (`supabase/tests/`, not placed): notes for the lead

Target: `<ts3>_d1_results.sql` on top of migrations 1, 1-fixes and 2 (spec `specs/d1-demo-slice.md` §3.1 row 3, §3.2, §3.3, §3.4, §3.6).
All files are RED first and write nothing outside a rolled-back transaction. Personas, ids and emails are synthetic (`@example.test`).
No file contains a `D1-M1-SHIM` block (migration 3 brings the real L-8 trigger). `rls_d1_rulesets_m3` mentions "no shim" in a comment only.

## Files

| File | `plan(N)` | Coverage |
| --- | --- | --- |
| `rls_d1_reports.test.sql.draft` | 122 | `public.reports` structure (ids only, FKs into public cards only, no internal-schema reference, RLS, indexes, unique per session); `trace_api` has no SELECT on the four result tables (moved from migration 2, (a)); per-worker column grants; `trace_worker` pointer insert; each worker attaches only its own FK, set-once, either order, foreign-session card refused, `quality.scores` / `integrity.results` ids refused as card ids, cross-org and no-job-org; `reports_set_once` for the operator; SELECT arms (OW, AD, RC with OTP, RC password-only, workspace RC, assigned RV at aal2 and aal1, unassigned RV, HM, removed, suspended, cross-org both ways); app-role and candidate DML denied; `mirror_session` writes exactly one `reports` row with both FKs null, replay and dead invitation write none ((b), draft m2 NOTES D-1) |
| `rls_d1_sweep.test.sql.draft` | 34 | `private.sweep_pending(integer)` catalogue (STABLE DEFINER, empty `search_path`, EXECUTE owner + `trace_worker` only, no `quality.`/`integrity.` in the body), seven denied callers, the three stages for crafted states (exact set, cross-org rows carry their org), complete sessions return nothing, fresh started invitation not listed, `p_limit` 0/1/2/large, writes nothing, convergence after a stage completes |
| `rls_d1_cards.test.sql.draft` | 140 (existing) | not touched |
| `rls_d1_results.test.sql.draft` | 167 (existing) | not touched |
| `rls_d1_rulesets_m3.test.sql.draft` | 102 (existing) | not touched |

My two files were generated, so `plan(N)` equals the number of assertion statements (122 and 34). Both were run to completion against a scratch prototype of the migration-3 pieces they touch (kept outside the repo): 122/122 and 34/34 ok. A bare `grep -c "^select (is|matches|ok|…)("` gives 160 for `rls_d1_results` (plan 167) and 101 for `rls_d1_rulesets_m3` (plan 102). I did not edit or analyse those two; the difference may be assertions not at line start, but please check the plans when they are placed.

Fixture grants (after the lead's 2026-10-14 migration 2 change): my two files do not supply `consents.occurred_at`, `sessions.workspace_id` or `sessions.test_id` (the guards set them). Both were re-run against the freshly reset DB (122/122 and 34/34 on the prototype). **`rls_d1_cards` and `rls_d1_results` still supply those columns in their fixtures** (`occurred_at` in the consent inserts, `workspace_id, test_id` in the `sessions` inserts) and will hit `42501 permission denied` once migration 3 lets them get that far; I did not touch them.

## Red run (local DB has migrations 1, 1-fixes, 2; rolled back)

Both files stop at the same first failure, because the L-8 trigger does not exist yet and the operator-path publish needs the pinned ruleset:

```
ERROR:  TRACE_GUARD: publish needs the pinned ruleset and notice
CONTEXT:  PL/pgSQL function private.test_versions_guard() line 82 at RAISE
STATEMENT:  update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id in ('f1000000-...-000000000001', ...);
```

A second pass without `ON_ERROR_STOP` produced only that error followed by "current transaction is aborted" for every later statement, so there is no syntax error anywhere in the files.

## What each file needs from migration 3

Common to both (fixtures): the `test_versions` BEFORE INSERT L-8 trigger (sorts after `test_versions_guard`, sets `ruleset_version_id` and `notice_version_id`); the org seed (`notice_versions`, `integrity.band_rule_versions` v1); `quality.scores`, `integrity.results` with the columns listed in `rls_d1_cards` (same fixtures); `public.quality_cards` and `public.integrity_cards` insertable by id columns alone (`org_id, session_id, quality_score_id` / `org_id, session_id, integrity_result_id, review_state, photo_missing`); `integrity_cards` accepting `reviewed` with zero flags when `meets_cutoff = true` (and `not_reviewed_below_cutoff` and `awaiting_quality` with zero flags, per L-28); the integrity worker reading `sessions(ruleset_version_id)` and `ruleset_versions(band_rule_version_id)` (as in `rls_d1_cards`); `sessions` still insertable only by `trace_worker` (migration 2).

`rls_d1_reports` additionally assumes:
- Table `public.reports` with exactly the columns `id, org_id, workspace_id, test_id, session_id, quality_card_id, integrity_card_id, created_at` (the assertion lists them sorted; an added audit column fails it on purpose, per "no number, band, state or text column").
- Composite FKs `(org_id, quality_card_id, session_id) -> public.quality_cards` and `(org_id, integrity_card_id, session_id) -> public.integrity_cards`; every FK of `reports` targets a `public` table; unique `(org_id, session_id)`; indexes `(org_id, test_id)` and `(org_id, workspace_id)`.
- No FOR ALL policy, no policy to PUBLIC, no trigger function, CHECK or policy text matching `quality.<x>` or `integrity.<x>`.
- `workspace_id` and `test_id` copied from the session on insert (trigger), as the other scoped tables.
- Grants: `trace_worker` SELECT plus INSERT on `(org_id, session_id)` only, no UPDATE, no DELETE; `trace_quality_worker` SELECT exactly `(id, org_id, session_id, quality_card_id)` and UPDATE `(quality_card_id)`; `trace_integrity_worker` the mirror image; `authenticated` SELECT only; `anon`, `service_role`, `trace_api`, both candidate roles nothing; `trace_api` nothing on `quality_cards`, `integrity_cards`, `integrity_timeline_entries`, `reports`.
- Policies: workers by `job_org_id()` (a hidden row on UPDATE gives `OK 0`, not an error), `authenticated` by the workspace arm and the assigned-reviewer arm. The reports arms do not depend on the card `review_state`.
- Error codes: unique violation `23505`; composite FK violation `23503`; privilege and RLS-insert `42501`; the set-once / immutability guard must raise a message starting `TRACE_GUARD` with `42501` (or `P0001`), as migration 2 guards do. For the operator (postgres) the same guard must fire (`ENABLE ALWAYS`), because the test clears an attached FK as `postgres`.
- `private.mirror_session` re-created to `insert into public.reports (org_id, session_id) … on conflict do nothing` before it marks the invitation `submitted`, still returning `'stored'` / `'duplicate'` / `'dead_invitation'` (the first assertion only requires "not duplicate and not dead_invitation", like `rls_d1_sessions`).

`rls_d1_sweep` additionally assumes:
- `private.sweep_pending(integer)`; the test calls it by `(org_id, session_id, ruleset_version_id, stage)` and does not depend on `stage`'s type (text or enum both work with `stage || ':'`).
- Stage names exactly `session_mirror`, `quality_score`, `integrity_band`.
- `session_mirror` rows carry the invitation's `session_id` and the test version's `ruleset_version_id`; a started invitation with `started_at` in 2020 and no `sessions` row is listed, one started at `now()` is not.
- The age test uses DO-supplied times only (invitation `started_at`; session `submitted_at` / `started_at` / `server_deadline_at`, all 2020 in the fixtures), never `sessions.created_at`: `created_at` has no INSERT grant and is immutable, so a fixture cannot age it (spec §10-DB "clock skew" also says only DO times are compared).
- The function is callable with no job org set. The test with a job org set only checks that the call works.

## Spec ambiguities I hit (nothing resolved; items touching rules 1–9 marked **RULE**)

1. **RULE 6 / 1 (not asserted).** `reports.integrity_card_id` is visible to org roles on a `reports` row whatever the card `review_state`. If the integrity job attaches the FK for a `not_reviewed_below_cutoff` or `awaiting_quality` card, a recruiter or reviewer learns that an integrity card exists below the cutoff. §3.2 says readiness is derived by the api "from which cards exist and are visible" but the `reports` policy has no `review_state` clause. The fixtures attach only `reviewed` cards, so no assertion depends on the answer. Needs a lead decision (attach only for `reviewed` cards, or hide the FK).
2. **RULE 1.** `reports` lets one table row hold both card pointers, while §3.3 forbids any role reaching both internal schemas. The test asserts only the column-grant split between workers and that `reports` references public cards. It does not assert that an org role may not read both pointers at once (the spec grants it).
3. Same-value re-attach: §3.2 says each FK goes null to non-null once and "a second attach or a change is refused". Whether an UPDATE that sets the stored value again is a refused second attach or an accepted no-op (as L-17 for `started_at`) is not stated. The test covers clear-to-null and change-to-another-card only.
4. `reports_set_once` and the operator: §3.2 does not say it is `ENABLE ALWAYS` with no operator bypass (the freeze triggers are). The test assumes it is.
5. Supplying a card FK in the worker's INSERT: the matrix says `trace_worker` inserts "both FKs null". The test accepts any `42501` (column grant or guard); a trigger raising `P0001` would fail it.
6. `sweep_pending` and orgs: §3.4 returns `org_id` per row and the jobs cron re-enqueues them, so the test assumes a cross-org sweep with no job org set. If the function must be bound to `job_org_id()` the exact-set assertion and the org B rows fail. Tenancy question; please confirm.
7. `sweep_pending` age basis: §3.4 says the threshold is a constant but not which timestamp, nor whether it applies to `quality_score` and `integrity_band` or only `session_mirror`. The test lists only 2020-dated sessions and never asserts a fresh session without cards.
8. A session with no cards at all: does it appear as `quality_score` only, or also `integrity_band`? The text ("integrity_band: a session without an integrity card") reads as both. The test asserts only the `quality_score` row for it (sessions SA and SG) and excludes both from the exact-set check.
9. `integrity_cards` guard with zero flags: `reviewed` and `not_reviewed_below_cutoff` are taken to hold vacuously when there are no flags (same assumption as `rls_d1_cards`).
10. `mirror_session` return value for a first call is `'stored'` in migration 2, but the spec does not list it; the first assertion uses a negative pattern.
11. Counts that depend on fixtures (8 org A reports, 7 on T1, 1 on workspace A2) are written into the descriptions; changing the fixtures means editing them.
12. `has_any_column_privilege(...)` strings treat table-level grants as covering all columns, which is the intended reading of the column-grant rows.
