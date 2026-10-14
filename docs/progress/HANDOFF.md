# HANDOFF — 2026-10-14 14:45 IST
Reason for stopping: usage (5-hour window 92%, resets ~17:10 IST; weekly 67%). The founder will continue on **another Claude Code account**. D1 BUILD Wave 0 continues (lead-only). **H6 Sentry is now DONE** (founder walkthrough step 2).
Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt).

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M8 = closed beta → M9 … M13)
- Milestones closed: **0 of 17** (no `m*-reviewed` tag; nothing in `docs/milestones/` yet — summaries are written only at CLOSE).
- **M0a:** REVIEW + FIX done; stopped before CLOSE (founder gate: GitHub plan). `milestone/m0a` @ `7dc8c0d` = `cp/m0a-06`.
- **M0b:** BUILD, REVIEW, FIX done; CLOSE waits for `m0a-reviewed` + staging run. `milestone/m0b` @ `56c2641` = `cp/m0b-05`.
- **D1:** SPEC approved (rev 4). **BUILD Wave 0 in progress**: DC-D2/D3/D4/D7 local PASS, ADR-031, **migration 1 placed and green**, migration-2 SQL + tests drafted, migration-3 tests partly drafted.

## Where we are
- **`d1/integration`** (worktree `.claude/worktrees/d1-integration`; enter it with `EnterWorktree` path). Tip = this handoff commit; code tip `1ceefa2`.
- Draft PR **TraceHiring/TraceHiring#4** (`d1/integration` → `main`, CI only, never merge). Run 38529308297 (on `2cc96ac`): `migrations`, `rls`, `security` PASS; `static` FAIL (db-types enum list) → fixed in `1ceefa2` (db-types tests 3/3, `pnpm typecheck` exit 0); **the wrap-up push triggers CI on it — check it first.**
- Unchanged: `milestone/m0a` @ `7dc8c0d`, `m0a/integration` @ `c619525`, `milestone/m0b` = `m0b/integration` @ `56c2641`, `main` @ `fe77a87` (never commit on or move `main`).
- Agent worktrees of 2026-10-14 (branches merged into `d1/integration`; keep them, never delete): `.claude/worktrees/agent-a2698bcfcbabc3f00` (m2 SQL), `agent-a9d0f2f8d65dd62b7` (m2 tests), `agent-a2ea3ebf214b218f5` (m3 tests, **stopped mid-task**; it may hold an uncommitted `rls_d1_cards` draft — look, do not discard; copy anything useful).
- Tag note: `cp/m0b-03` (= `4cb6775`) was pushed by `git push trace --tags` this session (FOUNDER-QUEUE FYI row). Never delete or move tags.

## Done 2026-10-14 (verified)
- `382a1b6` spike lockfile: patched sharp/undici → CI `security` PASS.
- `512021f` migration-1 pgTAP (485 assertions) placed, **seen red first**; lead fixed wrong draft expectations; **`D1-M1-SHIM`** in each file (emulates L-8 only while `integrity.band_rule_versions` is absent; **delete when migration 3 lands**); `rls_roles` exact D1 allow-lists; `catalog_probe` +2 MT-11 controls; floors rls **1182**, catalog **142**.
- `45206c8` `supabase/migrations/20261014065417_d1_authoring.sql` + `pnpm db:types`. **`pnpm test:rls` exit 0** (15 files; catalog 142, rls 1182; db-types current).
- `d7629a6` + `1ceefa2` CI fixes: `check-migrations` accepts `_d1_` (tests first, 31/31); db-types test lists the 9 D1 tables and 2 D1 enums.
- Drafts merged (docs only, `docs/progress/d1-wave0-drafts/`): `m2/` (migration-2 SQL, smoke 181/181, catalog clean, NOTES: 18 deviations, 10 questions); `m2-tests/` (8 files, 633 assertions, red, NOTES: 15 ambiguities); `m3-tests/` (`rls_d1_rulesets_m3`, `rls_d1_results` only).
- Opus DB review of migration 1 → **`docs/reviews/D1-db-review-m1.md`** (CHANGES REQUIRED: **Major M-1 open**, Minor m-1…m-5 open).
- **Founder walkthrough steps 1–4 done and verified by name** (FOUNDER-QUEUE "Resolved", `docs/infra/environments.md` "Verified 2026-10-14", ADR-027 region, build-notes §0): Cloudflare token rolled → `CLOUDFLARE_API_TOKEN`; **H6 Sentry, EU region**, vars `VITE_SENTRY_DSN` + `SENTRY_DSN_WORKERS`; `SUPABASE_STAGING_DB_URL` (old name deleted); staging ref `vsugnnxeahjtgzmgmyfu` (Postgres 17.11), dev ref `fjvaogxoxapenoqqykem`; autopilot set `SUPABASE_STAGING_URL`, `SUPABASE_STAGING_PUBLISHABLE_KEY`, `SUPABASE_STAGING_PROJECT_REF` (Auth health 200).
- On `1ceefa2` (14:40 IST): `pnpm typecheck` exit 0; `pnpm test` exit 0 (35 files, 1562 passed, 1 skipped = the known Windows-only symlink case K4). Not run: the full `pnpm verify` (run it before any merge).

## Next step (in order)
1. Verify (below). Check PR #4 CI on the pushed tip; fix any Linux failure first.
2. **AT-D22 (AT-9-sentry), lead-only, now unblocked by H6:** `scrubSentryEvent` in `packages/shared/src/log/sentry-scrub.ts` + its Vitest, and the wiring tests `services/api/src/error-reporting.test.ts`, `workers/jobs/src/error-reporting.test.ts`, `apps/recruiter/src/error-reporting.test.ts` (spec `specs/m0-foundations.md` §9.2 "Before D1: the Sentry adapter", AT-9-sentry; `specs/d1-demo-slice.md` D1-18, L-24). Adding `@sentry/*` packages changes the lockfile (lead-only; check versions are ≥ 2 weeks old). Tests first.
3. **Fix M-1 and m-1** (then m-3, m-4; decide m-2, m-5) per `docs/reviews/D1-db-review-m1.md`, tests red first; `pnpm test:rls`; raise the floor; update the review's dispositions.
4. **Place migration 2** from `docs/progress/d1-wave0-drafts/m2/` (read both NOTES first). Decide: (a) the draft grants USAGE on schema `private` to `trace_api` and `trace_worker` — departs from M0b DC-1 (amend `rls_roles` or use another entry path); (b) owner keeps `UPDATE (id)` on `consents` (FK row lock, D-3; MT-15 must allow it); (c) plain `postgres` is refused on the six tables (fixtures set role/claims); (d) `supabase/tests/rls_idempotency.test.sql` turns red with L-20 — update it in the same change. `pnpm exec supabase migration new d1_invites_sessions`, tests red first, iterate to green.
5. Finish m3 tests (`rls_d1_cards`, `rls_d1_reports`, `rls_d1_sweep`; no shim in m3 files), migration 3 (then delete every `D1-M1-SHIM`), migration 4 + `rls_d1_media_view`, `rls_d1_candidate_denied`, `rls_d1_invariants`.
6. Rest of Wave 0 (spec §11): DC-D5/D6/D8/D9 + staging halves; ADR-030 acceptance text; `@trace/shared/contracts/d1`; `postgres` 3.4.9 in the pnpm catalog; skeletons, boundaries, wrangler bindings, ci.yml. **Writer streams (R1, R3, C1) only after the migrations + contracts are merged and AT-D22 is green.**

## Founder items still open (`docs/progress/FOUNDER-QUEUE.md`)
- **Walkthrough step 5 next: H4 `workers.dev` subdomain** (the founder will do it later). Then: R2 enable; `staging` branch rules `d1/**`, `milestone/**`; GitHub plan (a/b/c); staging-evidence choice (a/b); H8 auth settings + session lifetime; H11 dev `db push`; SES status; DNS host + demo upload; optional AWS OIDC; later H9 + reviewer smoke user and branch protection. Do them one at a time with the founder, verify each by name (never read secret values), then record in FOUNDER-QUEUE "Resolved" and `docs/infra/environments.md`.

## Gotchas / do not touch
- Only the lead runs `supabase start/stop`, `db reset`, `test db`, `gen types`, `pnpm verify`, `pnpm test:rls`. **`db reset` kills agents' psql sessions** — warn agents first; agents use `set statement_timeout`.
- `pnpm verify:fast` does **not** run the package unit tests; run `pnpm test` too (that is how the db-types enum failure reached CI).
- Fast rolled-back loop: `begin; create extension if not exists pgtap with schema extensions;` + migration + test file without its first `begin;`, piped to `docker exec -i supabase_db_trace psql -U postgres -X -q -At -v ON_ERROR_STOP=1`.
- Worktree guard: no `$(…)`, loops, `sh` wrappers or heredoc + git in one command; commit messages via a file and `git commit -F`; push with `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push trace <refs>`. Prettier runs pre-commit.
- Agents are expensive (4 agents: ~5% → 84% of a Pro 5-hour window in 75 min). Max 3 writers; check `get_usage` after each result.

## Verify first
- `git fetch trace` (with the `-c` pair) · `git log --oneline -3 d1/integration` · `git status` · `docker ps` · `pnpm -s verify:fast` · `pnpm -s test` · `gh pr checks 4 --repo TraceHiring/TraceHiring`
