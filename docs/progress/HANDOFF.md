# HANDOFF — 2026-10-14 13:10 IST
Reason for stopping: usage. 5-hour window 84% at 13:00 IST (resets 17:10 IST); weekly 66%. D1 BUILD Wave 0 continues (lead-only; H6 Sentry still not done).
The next session may be a new Claude Code on another account. Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt).

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M8 = closed beta → M9 … M13)
- Milestones closed: **0 of 17** (no `m*-reviewed` tag).
- **M0a:** REVIEW and FIX done; stopped before CLOSE (founder gate: GitHub plan). `milestone/m0a` @ `7dc8c0d` = `cp/m0a-06`.
- **M0b:** BUILD, REVIEW, FIX done, no open Medium; CLOSE waits for `m0a-reviewed` and the staging run. `milestone/m0b` @ `56c2641` = `cp/m0b-05`.
- **D1:** SPEC approved (`specs/d1-demo-slice.md` rev 4). **BUILD Wave 0 in progress**: day-one DC-D2/D3/D4/D7 local PASS, ADR-031, and now **migration 1 placed and green**.

## Where we are
- **`d1/integration`** (worktree `.claude/worktrees/d1-integration`; enter with `EnterWorktree` path). Tip = this handoff commit, on top of `72ff693`.
- Draft PR **TraceHiring/TraceHiring#4** (`d1/integration` → `main`, CI only, never merge). Run 38528056136 (`45206c8`): `security` PASS (spike lockfile fix), `rls` PASS (migration 1 on Linux), `migrations` and `static` FAIL → fixed in `d7629a6` (not yet seen on CI; the wrap-up push triggers it — **check it first**).
- Unchanged: `milestone/m0a` @ `7dc8c0d`, `m0a/integration` @ `c619525`, `milestone/m0b` = `m0b/integration` @ `56c2641`, `main` @ `fe77a87`.
- Agent worktrees from this session (branches merged into `d1/integration`, keep them; never delete): `.claude/worktrees/agent-a2698bcfcbabc3f00` (m2 SQL), `agent-a9d0f2f8d65dd62b7` (m2 tests), `agent-a2ea3ebf214b218f5` (m3 tests, **stopped mid-task** for usage; may hold an uncommitted `rls_d1_cards` draft — check `git -C` that worktree's status by hand, do not discard).

## Done this session (verified)
- `382a1b6` fix(spikes): patched sharp 0.35.5 / undici 7.29.1 in the day-one spike lockfile (osv-scanner failed CI `security`). CI security now PASS.
- `512021f` test(db): the five parked migration-1 pgTAP drafts placed as `supabase/tests/rls_d1_{tests,assignments,scoping,rulesets,helpers}.test.sql` (485 assertions), **seen red first** (relation public.tests does not exist). Lead fixed wrong expectations (all org roles share `authenticated` → RLS-hidden `OK 0`, not 42501; freeze on children is the guard's 42501; no UPDATE grant on ruleset_versions; private helpers called as postgres; key guard may answer 23514 before the FK). Each file carries a **`D1-M1-SHIM`** block that emulates L-8 only while `integrity.band_rule_versions` is absent — **delete it when migration 3 lands**. `rls_roles` 4 assertions → exact D1 allow-lists; `catalog_probe` +2 MT-11 controls (job_org_id/api_org_id/my_assigned_test_ids). Floors: rls 697 → **1182**, catalog 140 → **142**.
- `45206c8` feat(db): `supabase/migrations/20261014065417_d1_authoring.sql` (from the draft) with lead changes: INSERT grants + `test_version_id`, `origin` (items), `format` (keys), `scope` (assignments) — all CHECK-pinned or guard-overwritten; `created_by := coalesce(auth.uid(), new.created_by)` on tests/test_versions; any update keeping a version `published` raises. `pnpm db:types` regenerated. **`pnpm test:rls` exit 0 (15 files; catalog 142, rls 1182; db-types current)**.
- `d7629a6` fix(ci): `check-migrations` accepts `_d1_` (tests first: accepts `_d1_`, rejects `_d10_`, `_d1a_`, `_D1_`; 31/31); db-types test expects the 8 M0b + 9 migration-1 tables (`tsc` exit 0). `check-migrations --base main` OK.
- Merged agent drafts (docs only, `docs/progress/d1-wave0-drafts/`): **m2/** migration-2 SQL draft + smoke (181/181, catalog clean) + NOTES (18 deviations, 10 questions) (`a4fc258`); **m2-tests/** 8 files, 633 assertions, red first, NOTES with 15 ambiguities (`8534126`); **m3-tests/** partial: `rls_d1_rulesets_m3`, `rls_d1_results` (`72ff693`).
- `pnpm verify:fast` exit 0 at 12:50 IST on `45206c8`. Full `pnpm verify` NOT run this session.

## Opus database review of migration 1 (this session; record it in `docs/reviews/D1-db-review-m1.md` next session)
Verdict CHANGES REQUIRED: 0 Blocking, **1 Major**, 5 Minor, 4 Notes; no rule 1/2/3/5/6 break, no cross-org leak.
- **M-1 (Major, open):** assignments ignore the workspace fence (M0b D16b). A workspace-A2 reviewer/recruiter can be assigned to an A1 test and then read its items and answer keys (and, in migration 4, evidence). Fix: `assignments_guard` add `and (m.workspace_id is null or m.workspace_id = v_ws)`; `my_assigned_test_ids` add `and (m.workspace_id is null or a.workspace_id = m.workspace_id)`; same filter in the publish auto-assignment select; tests with a workspace-scoped reviewer persona (allowed + denied). Spec-level hole → also note in spec §3.4.
- m-1: replace the `coalesce(auth.uid(), created_by)` fallback with `case when private.is_operator() then new.created_by else auth.uid() end`; add tests that `authenticated` supplying `created_by` gets 42501.
- m-2: auto-assignment re-adds a deliberately removed creator on each publish (only on first publish, or document).
- m-3: the "publish needs a band rule" branch is untested (operator nulls `band_rule_version_id`, expect 42501).
- m-4: the two `trace_api` policies and its column-limited SELECT have no RLS tests (add, or an exact trace_api allow-list in rls_roles).
- m-5: retire is not audited (`test.retire` action?). Notes n-1 (indexes lead with org_id; add `(workspace_id)`/`(test_id)` before M3), n-2 (audit triggers origin-only, as M0b), n-3 (drop `origin` from the grant when M1 widens the CHECK), n-4 (org-level rubrics open across workspaces, per spec).

## Next step (in order)
1. Check PR #4 CI on the pushed tip (expect all green). Fix any Linux failure first.
2. **Fix M-1 and m-1 (tests first, red then green)**, then m-3, m-4 (and decide m-2, m-5 as HOW-level notes); `pnpm test:rls`, raise the floor, commit; write `docs/reviews/D1-db-review-m1.md` with these dispositions.
3. Place migration 2: read `docs/progress/d1-wave0-drafts/m2/NOTES.md` and `m2-tests/NOTES.md` first. Decide: (a) the draft grants **USAGE on schema private to `trace_api` and `trace_worker`** (to call `resolve_invitation_by_hash` / `mirror_session` by name) — departs from M0b DC-1; either accept with an `rls_roles` amendment or wrap the calls in `public`-free definer entry points; (b) the owner keeps `UPDATE (id)` on consents (FK row lock, D-3) — MT-15 must allow it; (c) plain `postgres` is refused on the six tables — pgTAP fixtures must set role/claims; (d) `supabase/tests/rls_idempotency.test.sql` turns red with L-20 and must be updated in the same change. Then `supabase migration new d1_invites_sessions`, tests red first, iterate to green.
4. Finish migration-3 tests (`rls_d1_cards`, `rls_d1_reports`, `rls_d1_sweep`; no shim in m3 files), draft and place migration 3 (then delete every `D1-M1-SHIM`; `mirror_session` gets the reports insert via `create or replace`), then migration 4 + `rls_d1_media_view`, `rls_d1_candidate_denied`, `rls_d1_invariants`.
5. Rest of Wave 0 (spec §11): DC-D5/D6/D8/D9 and staging halves; ADR-030 acceptance text; `@trace/shared/contracts/d1`; `postgres` 3.4.9 in the pnpm catalog; skeletons, boundaries, wrangler bindings, ci.yml; AT-D22 (needs H6). **No writer stream before H6 is done and AT-D22 is green.**

## Decisions made this session (HOW-level, AUTOPILOT §4; record in build-notes "Autopilot changes" next session)
- Migration-1 tests use a temporary `D1-M1-SHIM` (test-only, rolled back, self-disabling) so migration 1 is tested before migration 3.
- CHECK-pinned / guard-overwritten columns may be in INSERT grants so the CHECK, not a missing grant, reports the violation.
- A re-publish of a published version is an error (409-able), not a no-op.
- `check-migrations` name rule widened to `_d1_` (D1 is not an `m<N>` milestone).

## Open questions for the founder (`docs/progress/FOUNDER-QUEUE.md`, unchanged)
- H6 Sentry (blocks writer streams), the GitHub plan (M0a CLOSE), Cloudflare token roll, staging DB URL, R2, H4 subdomain, H3–H5/H8–H11.

## Gotchas / do not touch
- Only the lead runs `supabase start/stop`, `db reset`, `test db`, `gen types`, `pnpm verify`, `pnpm test:rls`. **A `db reset` kills agents' open psql sessions** (all three draft agents stalled at 12:38 when it ran): tell agents first, have them use `set statement_timeout`.
- Fast rolled-back loop used this session: scratch runner = `begin; create extension if not exists pgtap with schema extensions;` + migration file + the test file with its first `begin;` removed, piped to `docker exec -i supabase_db_trace psql -U postgres -X -q -At -v ON_ERROR_STOP=1`.
- Worktree guard: no `$(…)`, no loops/`sh` wrappers with git, no `-C`, no heredoc + git in one command; write commit messages to a file and use `git commit -F`. Prettier runs pre-commit (format `.mjs` tests first).
- Node `String.replace` with a string replacement expands `$$`: use a function replacer.
- Agents are expensive: four agents (1 Opus writer, 2 Sonnet writers, 1 Opus reviewer) took the 5-hour window from ~5% to ~84% in about 75 minutes.

## Verify first
- `git fetch trace` (with the `-c` credential pair) · `git log --oneline -3 d1/integration` · `git status` · `docker ps` · `pnpm -s verify:fast` · `gh pr checks 4 --repo TraceHiring/TraceHiring`
