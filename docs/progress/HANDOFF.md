# HANDOFF — 2026-10-27 08:20 IST (M1 REVIEW done: PASS WITH CONDITIONS; M1 FIX next)
Reason for stopping: this chat's task is done (AUTOPILOT §2: exactly one phase per session; REVIEW done). Max account;
5-hour window ~30%, weekly ~61%. Start from `docs/progress/RESUME-PROMPT.md` §4 on **`m1/integration`** (worktree
`.claude/worktrees/m1-integration`). The repo wins.

## Paused: D1 (founder, 2026-10-22 night: paused, not closed)
D1's remaining steps belong to a D1 chat on `d1/integration` (worktree `.claude/worktrees/d1-integration`). Nothing is committed to `d1/integration` or `main` from M1. Copied from the `d1/integration` HANDOFF (`3c2e42a`, tip `1547fd0`):
- **Next step 1.** Workers Paid answered (2026-10-22 21:20): "not yet"; OPEN-8a stays a founder gate and D1 can close without it. Remaining founder item: **AT-D2 capture**. For it: dispatch staging from `d1/integration` with `run_e2e=true` on the final tip (re-checks AT-D1/AT-D17 after `1d36151`), then the founder runs `pnpm e2e:record` (spec 4p §7.3) with an OS-level screen capture; record file name, SHA-256, `recordedMs`, run id.
- **Next step 2.** Then `docs/milestones/D1-summary.md`, tag the next free `cp/d1-*` number (after `cp/d1-11`, `cp/d1-10`) on the verified tip, and **D1 CLOSE by PR to `main`** only with the founder's go-ahead (AUTOPILOT §2, §6). At the merge the founder adds `e2e-local` back to ruleset 25633431's required checks.
- **Staging re-run already done on the final tip (reuse it):** dispatch **39820502191** on `1547fd0` (run_e2e=true, started before the pause, not touched by M1): all 7 jobs **success** (static, migrations, rls, security, e2e-local, deploy-staging, e2e-staging). Artifact `e2e-staging-results` manifest: spec `d1-slice`, project `staging`, sha `1547fd0…`, 55/55 steps ok, `durationMs` 304726, `recordedMs` 295068 (`record: false`), **AT-D17 `time_to_ready_ms`: A 46307, B 30833, C 69999, D 19441** (max 70.0 s: inside the 90 s gate; the 30 s target is still the M5-owned deviation). If `d1/integration` is still `1547fd0`, this is the "staging re-run on the final tip"; only the AT-D2 capture (record mode) remains.
- **D1 founder items:** AT-D2 screen capture (`pnpm e2e:record`); Workers Paid (OPEN-8a) "not yet", decide before any load test (M3a); Dependabot PRs #7-#12 not merged blind; after D1 merges, `e2e-local` back on the required checks.

## Where we are (verified this chat)
- Milestone **M1 · Test authoring**, phase **REVIEW done → FIX next**. Spec rev 5, rows up to R5-71 (a-i).
- `m1/integration` = the handoff commit on `e25b12f` (`docs(reviews): m1 milestone review, pass with conditions`),
  code identical to `acceb02`. `trace/d1/integration` = `1547fd0`, `trace/main` = `da5380d`: unchanged.
- **Review report: `docs/reviews/M1.md`** — verdict **PASS WITH CONDITIONS**; no Critical/High, no rule 1-9 breach.
- Gates run this chat on `21ba378` (code = `acceb02`): `pnpm install --frozen-lockfile` 0; `pnpm -s verify:fast` 0
  (full mode, 255 s, no OOM this time); `pnpm test:rls` 0 (51 files, catalog 150, rls 3893 = floor, db-types current);
  serial build + 4 dist checks 0; `pnpm audit --prod` clean; `gitleaks detect` clean (1,209 commits).
- **Linux CI on `acceb02`: green.** PR #14 run 40436871364 (static, rls, security, migrations) and e2e-local dispatch
  40436931164 (all jobs; D1 slice 54/54; **AT-M1-01 171,048 ms, AT-M1-10 11,700 ms, AT-M1-30 133,499 ms**).
  PR run 40437165987 on `21ba378` (docs only) was still running at review time.

## Done this chat
- M1 REVIEW (`trace-milestone-review`, fresh session): five Opus first reviewers (security api/jobs, security
  edge/apps, database, spec/product rules, reliability/test health) + one Opus adversarial pass (rolled-back probes;
  scratch SQL not committed). All 8 findings CONFIRMED. Report committed `e25b12f`.

## Findings to FIX (docs/reviews/M1.md "Findings"; one commit each, test first, regression test)
| # | Sev | What | Owner |
| --- | --- | --- | --- |
| M1-REV-1 | Medium | `trace_authoring_worker` SELECT on all `item_versions` columns reads `param_spec.correctOptionId` (`m1_bank.sql:1611`); column-list grant + pgTAP pin | **M1 FIX** |
| M1-REV-2 | Medium | library copy reuse returns a retired copy (`m1_bank.sql:1394-1400`, unique index `:310`) → from-template fails for good | **M1 FIX** |
| M1-REV-3 | Medium | candidates get authored option ids, same in every variant/session (relay defence) | **M10** (ABH-39); add a spec note in FIX |
| M1-REV-4 | Low | `authenticated` INSERT (id) still on `items`, `pools`, `library_copy_requests`, `org_integrity_locks` | M1 FIX if cheap, else M5 |
| M1-REV-5 | Low | drafting job stuck `running` after a failed last delivery; sweep takes only `queued`; no `retry_delay` | M5 |
| M1-REV-6 | Low | recruiter summary "may paste or drop" vs drop always blocked (`candidate-summary.ts:70`) | M1 FIX |
| M1-REV-7 | Low | AT-M1-02 pgTAP lacks the `skill_key` and non-AI `approved_by` arms of `item_versions_bank_approved` | M1 FIX |
| M1-REV-8 | Low | `auth_user_id_for_invite` comment overclaims (no `email_hmac` binding) | M1 FIX (doc) |
Plus doc-only fixes to `docs/milestones/M1-summary.md` (G2 stale, header tip/commit count, 19 migrations M1-a…M1-s,
duplicate §5 row "20", final-tip AT times, AT-M1-07 citation) — listed under the findings table in `M1.md`.

## In flight at handoff
- **No agent is running. No uncommitted work.** (`pnpm -s verify:fast` re-run on `e25b12f` at wrap-up: see LOG row.)
- Unmerged CI-only branches (do not merge): `m1/e2e-specs-2` `b54091e`, `-3` `1dc427e`, `-4` `62215c1`.

## Stream branches
Merged (do not delete): `m1/a1-packages` · `m1/a5a-fix-1` · `m1/a5b-fix-1` · `m1/a5c-fix-1` · `m1/a4-edge-delivery` · `m1/a4-fix-1` · `m1/a3a-jobs-v2` · `m1/a3a-fix-1` · `m1/a3a-fix-2` · `m1/a3b-jobs-authoring` · `m1/a3b-fix-1` · `m1/a2b-api-tests` · `m1/a2b-fix-1` · `m1/a2a-api-bank` · `m1/a2a-fix-1` · `m1/a2a-fix-1-r2` · `m1/a7-candidate` `b89e2ea` · `m1/a7-fix-1` `91d91be` · `m1/a5d-wizard` `2489db3` · `m1/a5d-fix-1` `07a21d9` · `m1/a5d-fix-2` `abe6064` · `m1/e2e-specs` `cf90491` · `m1/e2e-specs-fix-1` `57973f1` · `m1/a8-templates-rpc` `701df43` · `m1/a8-fix-1` `88557c1` · `m1/a9-bank-rpc` `a585f41` (all on `trace`). Unmerged by founder answer (b): `m1/a5a-fix-2/-3/-4` (zip reader, M8).

## Next step (one precise action list)
1. Verify first (below).
2. **M1 FIX in a fresh session** (AUTOPILOT §2 FIX): fix M1-REV-1 and M1-REV-2 (Medium) and the M1-FIX Lows
   (-6, -7, -8; -4 if cheap), **one commit per finding, red test first** (migrations by the lead: new files after
   `20261026210000_m1_rpc_fixes.sql`; pgTAP via `docs/progress/m1-wave0-drafts/pgtap/bodies/*.sql` + `gen.mjs`).
   Add the M1-REV-3 → M10 note to the spec (§1.8 new row R5-72) and M1-REV-5 → M5 / -4 (if deferred) to summary §5.
   Apply the summary doc fixes. Then an Opus confirming re-review of the fixes (database + security), test:rls (raise
   the rls floor), full serial verify, Linux CI on PR #14; append the re-review result to `docs/reviews/M1.md`.
3. Then CLOSE per AUTOPILOT §2 — waits for the D1 CLOSE and the founder's go-ahead (R5-1, R5-30: merge `main` in
   first, re-timestamp M1 migrations, re-derive the seven replaced guards). Complete `docs/milestones/M1-summary.md`.
4. Dependency bumps owed (build-notes 2026-10-24): vitest 4.1.12 + undici 7.30.1 on/after 2026-10-29; fast-uri
   3.1.9 on/after 2026-11-02; happy-dom 21.x before 2026-11-23; then delete the matching osv ignores.
5. Staging-only checks need a founder-approved staging dispatch: A2b Low 2 R2 `onlyIf`, DC-M1-1/5/6 staging halves,
   AT-M1-10 on staging, the largest from-template call under the 8 s statement timeout (M1-q DB review 2).

## Founder items
- Unchanged: coverage when tab focus is off (default a); D1 integrity job re-delivered after M1 (default a); M1-15 "shared-device" copy (default: leave out); import cancel keeps rows (default a); M1 staging Hyperdrive configs + secrets (+ jobs `SUPABASE_URL`, + api `MEMBER_INVITE_PEPPER` ≥ 32 bytes); Q-M1-1…Q-M1-4; OPEN-8a Workers Paid; written AI drafts; zip reader answered (b).
- New (information only): M1 REVIEW is PASS WITH CONDITIONS; nothing new needs a founder answer.

## Gotchas
- Worktree guard: no `cd …&&`, `git -C`, `$(...)`, loops, compound or piped node-script commands, no heredocs appending to repo files; write scripts with the Write tool and run them plainly; commit messages via `git commit -F <unique file>`; merges `chore: merge …`. A refused compound command runs NOTHING. `gitleaks git …` is refused (use `gitleaks detect --source . --redact --no-banner`, or `pnpm lint`). `node -e` with `require(<arg>)` is refused.
- `node scripts/db-types.mjs` and `pnpm test:rls` RESET the local database: never while a writer or diagnosis agent runs db-tests or psql probes. `pnpm exec supabase migration up --local` applies a new migration without a reset. Named pgTAP runs on a database that holds committed e2e/concurrency rows can fail on unscoped assertions; `test:rls` resets first.
- A function body's comments are in `pg_get_functiondef` (a pgTAP text pin on the body sees them).
- **RAM:** `pnpm -s verify:fast` passed this chat (255 s) but has OOM-crashed before. Fallback: run the gate serially: `pnpm -r --workspace-concurrency=1 typecheck`, `… lint`, prettier/check scripts/gitleaks, per package `pnpm --filter ./<pkg> exec vitest run --maxWorkers=1`, `pnpm exec vitest run --root scripts --maxWorkers=1`, `pnpm test:rls`, serial build.
- Since M1-p the database derives a draft's navigation default and written paste rule from its settings; pgTAP cases that need a mismatched state turn `sections_settings_derive` off around it. Fixtures inserting import/drafting jobs as org users use `pg_temp.next_id(id)` (test-only trigger in those bodies) — the same pattern fits M1-REV-4.
- A branch checked out in a writer's worktree must not be moved; create a new branch (`git commit-tree` merge + `git branch`).
- e2e-local dispatch from an `m1/**` branch runs no staging job (deploy-staging needs `main`, `d1/**` or `milestone/**`).
- Never hand-edit generated `rls_m1_*.test.sql`: edit `docs/progress/m1-wave0-drafts/pgtap/bodies/*.sql`/`preamble.sql`, run `node docs/progress/m1-wave0-drafts/pgtap/gen.mjs . <name>`, run named files with `node docs/progress/m1-wave0-drafts/pgtap/run.mjs <names>`.
- Rolled-back psql from Git Bash: `docker cp <file> supabase_db_trace:/tmp/x.sql`, then `MSYS_NO_PATHCONV=1 docker exec supabase_db_trace psql -U postgres -X -q -At -v ON_ERROR_STOP=1 -f /tmp/x.sql` (begin … rollback).

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` · `git status` · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `gh run list --repo TraceHiring/TraceHiring --branch m1/integration --limit 3` (latest green) · `pnpm -s verify:fast` (or the serial gate) · `docker ps` (supabase_db_trace up)
