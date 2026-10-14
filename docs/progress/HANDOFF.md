# HANDOFF — 2026-10-14 ~19:35 IST
Reason for stopping: usage (5-hour window 98%, resets ~19:30 UTC+5:30 = 2026-10-14T13:59Z; weekly 7%). Founder said "work to 100%"; stopped at 98% to keep the handoff safe.
Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt).

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13)
- Milestones closed: **0 of 17**. M0a, M0b: built, reviewed, fixed; CLOSE waits for founder gates.
- **D1 BUILD Wave 0 (lead):** AT-D22 Sentry **green and reviewed** (gate D1-18 met); migration 1 + fixes, **migration 2 placed, reviewed and fixed**; migration-3 tests drafted; migration 3 SQL not started.

## Where we are
- **`d1/integration`** (worktree `.claude/worktrees/d1-integration`) tip = this handoff commit; code tip `870e1fd`. Draft PR TraceHiring/TraceHiring#4 (CI only). **Check its CI on the pushed tip first** (last checked green on `5b0d457`; later pushes not yet confirmed).
- Unchanged: `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`, `main` `fe77a87` (never commit on or move `main`).
- Agent branch merged by cherry-pick (keep it, never delete): `worktree-agent-a922084a4ffff55fa` (`.claude/worktrees/agent-a922084a4ffff55fa`, m3 report/sweep drafts).

## Done 2026-10-14 (this session, verified)
- `9581677`, `d8b1b3a`, `a5e5b57`, `97ff585` **AT-D22**: `@trace/shared/sentry` (allow-list scrubber `scrubSentryEvent`/`scrubSentryBreadcrumb`, SDK-free adapter, `sentryOptions`: every `dataCollection` switch off, **no `tracesSampleRate`**, integration allow-list); recruiter (`@sentry/react` 11.1.0) and api/jobs (`@sentry/cloudflare` 11.1.0, `withErrorReporting`, fail closed on any other `SENTRY_*` env var, `infer_ip never`); wiring tests run the real SDKs with a capturing transport; recruiter CSP `__SENTRY_ORIGIN__` + `check-headers`; `ci.yml` passes `VITE_SENTRY_DSN` (build) and `SENTRY_DSN_WORKERS` (jobs, api only); `web-vitals` override 6.2.2 (release age). Security review BLOCK → fixed → **re-review PASS WITH NOTES, notes fixed** (`docs/reviews/D1-AT-D22-security-review.md`).
- `4a2211c` DB review m1 **M-1/m-1 fixed** (fix-forward `20261014093232_d1_authoring_fixes.sql`, `rls_d1_workspace_fence` 23, seen red); m-3 covered; spec revision 4a.
- `a5a85c3` + `9ec85af` **migration 2** `20261014094801_d1_invites_sessions.sql` + 8 `rls_d1_*` files; lead decisions in `docs/progress/d1-wave0-drafts/m2/NOTES.md`; `rls_idempotency` rewritten for L-20; `rls_roles` lists. **DB review APPROVE WITH MINOR FIXES** → M-1, m-1, m-3, m-4, m-5 fixed in place (never applied to a shared DB) — `docs/reviews/D1-db-review-m2.md`.
- `8f7a081`, `870e1fd` m3 test drafts `rls_d1_reports` (122), `rls_d1_sweep` (34) + `m3-tests/NOTES.md`; `rls_d1_cards` (140) rescued from the stopped agent worktree.
- **Checks at `9ec85af`:** `pnpm test:rls` exit 0 (24 files; rls **1840** = floor, catalog 142, db-types current). `pnpm -s verify:fast` exit 0 at `97ff585`; `pnpm test` exit 0 at `a5e5b57`. **Not run: the full `pnpm verify`** (run it first).

## Next step (in order)
1. Verify (below) incl. PR #4 CI and a full `pnpm verify`; fix any Linux failure.
2. **Migration 3** (`<ts3>_d1_results.sql`, spec §3.1 row 3, L-8/L-18/L-33/L-34): place the m3 drafts as `supabase/tests/` (read `m3-tests/NOTES.md`: the cards and results drafts still supply `consents.occurred_at`/`sessions.workspace_id,test_id` — remove them; check their `plan()` counts: results 160 lines vs plan 167, rulesets_m3 101 vs 102), add the moved m2 assertions, write the SQL red-first, then **delete every `D1-M1-SHIM` block**. Fold in from the m2 review: `mirror_session` inserts the `reports` row (draft D-1), global `unique (session_id)` on invitations (n-3), `expires_at > created_at` (n-6). Answer m3 NOTES questions; anything touching rules 1–9 (e.g. Q1 integrity_card_id visibility below cutoff) → FOUNDER-QUEUE.
3. Migration 4 (`media_*` grants, `rls_d1_media_view`), `rls_d1_candidate_denied`, `rls_d1_invariants`; DB review of migration 1 open items m-2, m-4, m-5; m2 review m-2 (late `sessionStarted`), n-1, n-7.
4. Rest of Wave 0 (spec §11): DC-D5/D6/D8/D9, ADR-030 text, `contracts/d1`, `postgres` catalog, skeletons, boundaries, wrangler bindings (`__API_ORIGIN__` CSP, `trace-api-staging` origin), jobs `queue`/`scheduled` wrapped by `withErrorReporting` (AT-D22 re-review NC). **Writers R1/R3/C1 may start only after migrations + contracts are merged** (AT-D22 gate is now met).

## Founder items still open (`docs/progress/FOUNDER-QUEUE.md`)
- Walkthrough step 5 next: **H4 `workers.dev` subdomain**; then R2, `staging` branch rules, GitHub plan, staging-evidence choice, H8, H11, SES, DNS, AWS OIDC, H9. H6 note: keep "Prevent storing IP addresses" + data scrubbing on in both Sentry projects.

## Gotchas
- Only the lead runs `supabase start/stop`, `db reset`, `test db`, `gen types`, `pnpm verify`, `pnpm test:rls`; warn running agents first (a concurrent agent psql once made `test:rls` report a file with "0 ran").
- @sentry/cloudflare caches one client per isolate: tests share one capturing transport; Dedupe drops a repeated identical error.
- JS `String.replace` treats `$'` in the replacement string as a token — use a replacer function in edit scripts. Inline heredocs with backticks break the worktree-guarded shell: write scripts to the scratchpad.
- Worktree guard: no `$(…)`, loops, `cd` + git, or variables in commands; commit via `git commit -F <file>`.
- Agents are costly: 2 Opus reviews + 1 Sonnet writer took ~50% of a Pro 5-hour window.

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` · `git status` · `docker ps` · `pnpm -s verify:fast` · `pnpm -s test` · `gh pr checks 4 --repo TraceHiring/TraceHiring` · then `pnpm verify`
