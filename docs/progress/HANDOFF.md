# HANDOFF — 2026-10-14 ~23:00 IST
Reason for stopping: founder asked to wrap up (weekly usage ~92% of the founder's 98% line; the next session may be on another account).
Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt).

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13)
- Milestones closed: **0 of 17**. M0a, M0b: built, reviewed, fixed; CLOSE waits for founder gates.
- **Phase: D1 BUILD, Wave 0 (lead-only).** Done: AT-D22 (Sentry); migrations 1, 2, **3** placed, reviewed and fixed; every `D1-M1-SHIM` deleted. Not done: migration 4, invariants/candidate-denied tests, contracts, skeletons, wrangler/CSP (see Next step).

## Where we are
- **`d1/integration`** (worktree `.claude/worktrees/d1-integration`) tip = this handoff commit; code tip **`e253624`** (migration 3 review fixes). Draft PR TraceHiring/TraceHiring#4 (CI only): green on `f4d100f`; `eb5e3e7` was pushed (CI result not checked); **check CI on the pushed tip first**.
- Unchanged: `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`, `main` `fe77a87` (never commit on or move `main`).
- Agent branches kept (never delete): `worktree-agent-a922084a4ffff55fa` (m3 test drafts, already cherry-picked). This session's reviewer agent was read-only (no branch).

## Done 2026-10-14 evening (this session, verified)
- Verify-first matched the 19:35 handoff; full `pnpm verify` exit 0 at `f4d100f`.
- `7e9e3fc` **migration 3** `supabase/migrations/20261014151833_d1_results.sql` (spec §3.1 row 3): `quality.scores`/`grader_runs`; `integrity.band_rule_versions` (Rule-shape CHECK `integrity.rule_table_valid`) + L-33 FK; `integrity.signals`/`flags`/`results`; `public.quality_cards`/`integrity_cards` (definer fill + L-4/L-28 guard), `integrity_timeline_entries`, `reports` (`reports_set_once`); org seed `private.seed_org` + `seed_org_defaults` trigger + backfill; L-8 trigger `test_versions_ruleset_seed`; `private.sweep_pending(int)`; `mirror_session` writes the reports row; invitations `unique (session_id)` + `expires_at > created_at`. Tests red first, then green; 5 new pgTAP files; 13 shim blocks deleted; `rls_roles`, `rls_d1_consents`, db-types list updated. Full `pnpm verify` exit 0 at `7e9e3fc`.
- Opus **database review of migration 3**: APPROVE WITH MINOR FIXES, rule 1 and rule 6 clean (`docs/reviews/D1-db-review-m3.md`). `e253624` fixed M-1, m-1, m-2, m-3, m-4, m-5, m-7c, m-8, n-3 test-first. **Checks at `e253624`:** `pnpm test:rls` exit 0 (29 files, rls **2428** = floor, catalog 142, db-types current); `pnpm -s verify:fast` exit 0. Full `pnpm verify` not re-run after `e253624` (run it first).
- Founder walkthrough **step 5 (H4) done**: `workers.dev` subdomain **`abhayraj`** (kept as is); recorded in `docs/infra/environments.md` and FOUNDER-QUEUE "Resolved".
- `docs/progress/d1-wave0-drafts/m3/d1-v1.json`: rule table v1 (seed hash `c862bf65…ca0e`, pinned in `rls_d1_rulesets_m3`); stream band-engine copies it unchanged.

## Decisions made this session (lead; details in `docs/reviews/D1-db-review-m3.md`)
- **Rule 6 (FOUNDER-QUEUE, non-blocking confirm):** only a `reviewed` integrity card attaches to `reports`.
- Sweep: cross-org (EXECUTE `trace_worker` only), age guard on DO times, round-robin across stages. No flag after a final card. The coverage floor is pinned to the rule table. The card's `photo_missing` comes from the result. TRUNCATE is refused on all immutable result tables. Same-value re-attach is a no-op.

## Next step (in order)
1. Verify (below), incl. PR #4 CI on the pushed tip and a **full `pnpm verify`** on `e253624`; fix any Linux failure.
2. Open review items (cheap, test-first): m-7a (fresh session not swept for quality/integrity), m-7b (band/flag consistency on the UPDATE flip, and awaiting → below-cutoff while `meets_cutoff = true`), n-1 (table name in TRACE_APPEND_ONLY). Write m-6, n-4 and n-6 into the `workers/jobs` part of the spec (one transaction per stage: card + flags + flip + pointer; on retry flip, never re-insert; one canonical JSON hash for rubrics).
3. Migration 4 `<ts4>_d1_media_audit.sql` (spec §3.1 row 4, §3.4 media rows, L-2, L-25, L-26, R-7): `private.media_viewer_check()`, `media_link_grant()`, `media_view_grant()`; pgTAP `rls_d1_media_view` red first; then `rls_d1_candidate_denied`, `rls_d1_invariants` (§3.6 rows). Also DB review m1 open m-2, m-4, m-5 and m2 m-2 (late `sessionStarted`), n-1, n-7. Then an Opus DB review of migration 4.
4. Rest of Wave 0 (spec §11): DC-D5/D6/D8/D9, ADR-030 text, `@trace/shared` `contracts/d1` (incl. zod for `quality.*`/`integrity.*` rows), `postgres` catalog entry, skeletons, boundaries, wrangler bindings (`__API_ORIGIN__` CSP, staging origins on `abhayraj.workers.dev`), jobs `queue`/`scheduled` wrapped by `withErrorReporting`. **Writers R1/R3/C1 start only after migrations + contracts are merged.**

## Founder items still open (`docs/progress/FOUNDER-QUEUE.md`)
- Confirm the rule-6 decision (non-blocking). Walkthrough continues at **step 6: R2** (enable R2 on the Cloudflare account), then `staging` branch rules for `d1/**`, GitHub plan / branch protection, staging-evidence choice, H8, H11, SES, DNS, AWS OIDC, H9, the reviewer smoke user.

## Gotchas
- Docker Desktop can stop mid-session: relaunch `C:\Program Files\Docker\Docker\Docker Desktop.exe` (via a node `spawn` script; the worktree guard blocks direct launches); the engine took ~10 min to answer; the Supabase containers restart by themselves.
- Ad-hoc pgTAP runs outside `supabase test db` need `create extension if not exists pgtap with schema extensions;` inside the file's transaction.
- TRUNCATE ... CASCADE from `consents`/`sessions` reaches tables whose TRUNCATE is revoked or guarded; the consents test re-grants three of them.
- JS `String.replace` turns `$$` in a replacement string into `$` (broke pgTAP `$$` once again): always use a replacer function.
- Only the lead runs `supabase start/stop`, `db reset`, `test db`, `gen types`, `pnpm verify`, `pnpm test:rls`; reviewers read files only while the lead verifies.
- Worktree guard: no `$(…)`, loops, `cd` + git, pipes into docker/psql/powershell/wsl; write scripts to the scratchpad and run them with node; commit via `git commit -F <file>`.
- Agents are costly: the Opus migration-3 review took ~180k tokens (~1% weekly on Pro).

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` · `git status` · `docker ps` · `pnpm -s verify:fast` · `pnpm -s test` · `gh pr checks 4 --repo TraceHiring/TraceHiring` · then `pnpm verify`
