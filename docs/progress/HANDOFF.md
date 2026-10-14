# HANDOFF — 2026-10-14 ~21:45 IST
Reason for stopping: usage (weekly 91% of the founder's 96% line; 5-hour window 6%, weekly resets 2026-10-15 09:30 IST). Past 90% no new agent starts, so the Opus database review of migration 3 is the next session's first agent.
Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt).

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13)
- Milestones closed: **0 of 17**. M0a, M0b: built, reviewed, fixed; CLOSE waits for founder gates.
- **D1 BUILD Wave 0 (lead):** AT-D22 green and reviewed; migrations 1 and 2 placed and reviewed; **migration 3 placed and green, NOT yet reviewed**; every `D1-M1-SHIM` block deleted.

## Where we are
- **`d1/integration`** (worktree `.claude/worktrees/d1-integration`) tip = this handoff commit; code tip **`7e9e3fc`** (migration 3). Draft PR TraceHiring/TraceHiring#4 (CI only): green on `f4d100f`; **check CI on the pushed tip first**.
- Unchanged: `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`, `main` `fe77a87` (never commit on or move `main`).
- Agent branch kept (never delete): `worktree-agent-a922084a4ffff55fa` (m3 test drafts, already cherry-picked).

## Done 2026-10-14 evening (this session, verified)
- Verify-first matched the old handoff: `f4d100f`, clean, verify:fast 0, `pnpm test` 0 (1571 passed, 1 skipped), PR #4 CI green; **full `pnpm verify` exit 0 at `f4d100f`** (rls 1840, catalog 142).
- `7e9e3fc` **migration 3** `supabase/migrations/20261014151833_d1_results.sql` (spec §3.1 row 3): `integrity.band` + `integrity.rule_table_valid` (Rule-shape CHECK); `integrity.band_rule_versions` (immutable always) + L-33 FK/index; `quality.scores` (cutoff pin, immutable), `quality.grader_runs`, `integrity.signals` (append-only, TRUNCATE revoked from owner); `integrity.flags` (rule-6 guard reads `public.quality_cards.meets_cutoff` only), `integrity.results` (pinned ruleset guard); `public.quality_cards` / `integrity_cards` (definer fill triggers, L-4/L-28 guard), `integrity_timeline_entries` (reviewed cards only, append-only), `reports` (`reports_set_once`); `private.seed_org` + `seed_org_defaults` trigger + backfill; L-8 trigger `test_versions_ruleset_seed`; `private.sweep_pending(int)`; `mirror_session` writes the reports row (D-1); invitations `unique (session_id)` (n-3) and `expires_at > created_at` (n-6); grants and policies per §3.3.
- Tests: red first (all six files stopped at "publish needs the pinned ruleset and notice"), then green. Placed `rls_d1_cards` 140, `rls_d1_results` 167, `rls_d1_reports` 122, `rls_d1_rulesets_m3` 102, `rls_d1_sweep` 34 (the plan counts were right). Fixture fixes: removed `consents.occurred_at`/`workspace_id`/`test_id`, `sessions.workspace_id`/`test_id`, `session_items.workspace_id`/`test_id` (no INSERT grant; guards set them); `::jsonb` casts on the oversized-json cases. Deleted all 13 `D1-M1-SHIM` blocks. `rls_roles` lists, `rls_d1_consents` (re-grant TRUNCATE on the three new append-only tables so the CASCADE reaches the consents trigger) and `packages/db-types` table list updated; `rls-min-count` 1840 → **2405**.
- **Checks at `7e9e3fc`:** `pnpm test:rls` exit 0 (29 files, rls 2405, catalog 142 floor 142, db-types current); `pnpm -s verify:fast` exit 0. **Full `pnpm verify` exit 0 at `7e9e3fc`** (unit 1571 passed / 1 skipped, rls 2405 floor 2405, catalog 142, build, bundle-size, headers, scan-dist OK).
- `docs/progress/d1-wave0-drafts/m3/d1-v1.json`: rule table v1; the seed stores `content_sha256` `c862bf65…ca0e` = SHA-256 of its canonical JSON (sorted keys, whole table). Stream band-engine copies it to `packages/band-engine/src/rules/d1-v1.json` unchanged.

## Decisions made this session (lead)
- **Rule 6 (FOUNDER-QUEUE row, built):** `reports.integrity_card_id` may be attached only for a `reviewed` card (`reports_set_once`); the api derives "Not reviewed (below cutoff)" from `quality_cards.meets_cutoff`.
- m3 NOTES Q3: re-attaching the same card id is accepted as a no-op (only a change or a clear is refused). Q4: `reports_set_once` is ENABLE ALWAYS, no operator bypass. Q6: `sweep_pending` is cross-org (each row carries its org; EXECUTE `trace_worker` only). Q7: age guard on every stage, DO times only (deadline + 30 min for `session_mirror`, submit + 15 min for card stages). Q8: a session with no cards is listed for both `quality_score` and `integrity_band`. Q9: zero-flag `reviewed` / `not_reviewed_below_cutoff` hold vacuously. Band/flag consistency is skipped for `awaiting_quality` (flags arrive after the quality card, L-4).
- L-8 picks the org's highest `band_rule_versions.version_no` and newest notice; fails closed (42501) when either is missing.

## Next step (in order)
1. Verify (below) incl. PR #4 CI on the pushed tip and a full `pnpm verify`; fix any Linux failure.
2. **Opus `database-reviewer` on migration 3** (`7e9e3fc`), and a `security-reviewer` pass on `reports_set_once`, the card policies and `sweep_pending` (rule 1/6 surface). Fix findings test-first; record in `docs/reviews/D1-db-review-m3.md`.
3. Migration 4 (`media_*` grant functions, `rls_d1_media_view`), `rls_d1_candidate_denied`, `rls_d1_invariants`; DB review m1 open items m-2, m-4, m-5; m2 review m-2 (late `sessionStarted`), n-1, n-7.
4. Rest of Wave 0 (spec §11): DC-D5/D6/D8/D9, ADR-030 text, `contracts/d1` (incl. hand-written zod shapes for `quality.*`/`integrity.*`), `postgres` catalog, skeletons, boundaries, wrangler bindings, jobs `queue`/`scheduled` wrapped by `withErrorReporting`. **Writers R1/R3/C1 start only after migrations + contracts are merged.**

## Founder items still open (`docs/progress/FOUNDER-QUEUE.md`)
- New: confirm the rule-6 decision above (non-blocking). Walkthrough step 5 next: **H4 `workers.dev` subdomain**; then R2, `staging` branch rules, GitHub plan, staging-evidence choice, H8, H11, SES, DNS, AWS OIDC, H9.

## Gotchas
- Docker Desktop stopped mid-session (engine pipe missing); relaunching `Docker Desktop.exe` took ~10 minutes before `docker ps` answered, and the stack restarted on its own.
- Ad-hoc pgTAP runs outside `supabase test db` need `create extension if not exists pgtap with schema extensions;` inside the file's transaction.
- A TRUNCATE ... CASCADE from `consents`/`sessions` now reaches tables whose TRUNCATE is revoked from the owner (`integrity.signals`, `quality.grader_runs`, `integrity_timeline_entries`): expect 42501 unless re-granted.
- Only the lead runs `supabase start/stop`, `db reset`, `test db`, `gen types`, `pnpm verify`, `pnpm test:rls`; warn running agents first.
- Worktree guard: no `$(…)`, loops, `cd` + git, pipes into docker/psql/powershell/wsl; put scripts in the scratchpad and run them with node; commit via `git commit -F <file>`.
- Agents are costly: one Opus review ≈ 5–17% of a Pro 5-hour window.

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` · `git status` · `docker ps` · `pnpm -s verify:fast` · `pnpm -s test` · `gh pr checks 4 --repo TraceHiring/TraceHiring` · then `pnpm verify`
