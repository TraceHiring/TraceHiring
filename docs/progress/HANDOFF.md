# HANDOFF — 2026-10-26 23:45 IST (M1 BUILD 4 = Wave 3 merged: A7, A5d wizard, E2E AT-M1-01/10/30 green on Linux CI)
Reason for stopping: this chat's BUILD 4 work is done and context is at ~75% (wrap-up before compaction). Max account;
5-hour window ~5% after its 22:30 IST reset, weekly ~54%. Start from `docs/progress/RESUME-PROMPT.md` §4 on
**`m1/integration`** (worktree `.claude/worktrees/m1-integration`). The repo wins over this file.

## Paused: D1 (founder, 2026-10-22 night: paused, not closed)
D1's remaining steps belong to a D1 chat on `d1/integration` (worktree `.claude/worktrees/d1-integration`). Nothing is committed to `d1/integration` or `main` from M1. Copied from the `d1/integration` HANDOFF (`3c2e42a`, tip `1547fd0`):
- **Next step 1.** Workers Paid answered (2026-10-22 21:20): "not yet"; OPEN-8a stays a founder gate and D1 can close without it. Remaining founder item: **AT-D2 capture**. For it: dispatch staging from `d1/integration` with `run_e2e=true` on the final tip (re-checks AT-D1/AT-D17 after `1d36151`), then the founder runs `pnpm e2e:record` (spec 4p §7.3) with an OS-level screen capture; record file name, SHA-256, `recordedMs`, run id.
- **Next step 2.** Then `docs/milestones/D1-summary.md`, tag the next free `cp/d1-*` number (after `cp/d1-11`, `cp/d1-10`) on the verified tip, and **D1 CLOSE by PR to `main`** only with the founder's go-ahead (AUTOPILOT §2, §6). At the merge the founder adds `e2e-local` back to ruleset 25633431's required checks.
- **Staging re-run already done on the final tip (reuse it):** dispatch **39820502191** on `1547fd0` (run_e2e=true, started before the pause, not touched by M1): all 7 jobs **success** (static, migrations, rls, security, e2e-local, deploy-staging, e2e-staging). Artifact `e2e-staging-results` manifest: spec `d1-slice`, project `staging`, sha `1547fd0…`, 55/55 steps ok, `durationMs` 304726, `recordedMs` 295068 (`record: false`), **AT-D17 `time_to_ready_ms`: A 46307, B 30833, C 69999, D 19441** (max 70.0 s: inside the 90 s gate; the 30 s target is still the M5-owned deviation). If `d1/integration` is still `1547fd0`, this is the "staging re-run on the final tip"; only the AT-D2 capture (record mode) remains.
- **D1 founder items:** AT-D2 screen capture (`pnpm e2e:record`); Workers Paid (OPEN-8a) "not yet", decide before any load test (M3a); Dependabot PRs #7-#12 not merged blind; after D1 merges, `e2e-local` back on the required checks.

## Where we are (verified this chat)
- Milestone **M1 · Test authoring**, phase **BUILD** (BUILD 4 = Wave 3 done: A7, A5d, E2E). Spec rev 5, rows up to
  **R5-70**. `m1/integration` tip = this handoff commit on `3fcafcc` (`chore: merge m1/e2e-specs-fix-1`), all pushed.
  `trace/d1/integration` = `1547fd0`, `trace/main` = `da5380d`: unchanged.
- **Full serial verify green** on `0a7199f` (2026-10-26, 842 s: typecheck, eslint, prettier, boundaries, workflows,
  catalog, migrations, gitleaks, every package's tests with `--maxWorkers=1`, scripts, test:rls 49 files / rls 3784 /
  catalog 150, build) and on `985febc`, `eaba02a` and the final merge **`3fcafcc`** (893 s; recruiter 1044, api 657).
- **Linux CI:** PR #14 green on `eaba02a` and `9c1bdb0`; **e2e-local dispatch green** on `m1/e2e-specs-fix-1`
  `57973f1` (run 40372592727: every local spec incl. D1 slice, candidate, AT-M1-01/10/30) and on `62215c1`
  (run 40368988267, the recorded measurements). **AT-M1-28 E2E half** green (D1 slice local on M1).
- **Measured (spec §8):** AT-M1-10 500 items + 500 images `elapsed_ms` 10,002 / 14,899; AT-M1-01 170,943; AT-M1-30
  133,409 (all ≤ 300,000; known proxy limits recorded in §8).

## Done this chat (all on m1/integration, pushed)
- R5-67 (red `51a1077`, `a3cb473` → `0db5907`, `6a07a60`): `OutOfOrderBody.refusedSeqs`; refused seqs re-listed on a
  resend after a lost ack (stream keeps them within 100 seqs).
- never-build scans `src/test` dirs (`b7695ee` → `ecb53c0`); jobs db-test "two Auth accounts" (`826d864`, R5-62 owed).
- e2e-local: api starts alone (SQLITE_BUSY race, `373d04a` → `b2b1b8a`); M1 recruiters (`3e5af5c` → `addfb6c`).
- R5-68 / R5-69 / R5-70 lead decisions; `IntegritySettingsView.stored` (`c9e8cab` → `d3c50d4`, fixups `4cc4173`,
  `9c1bdb0`).
- **A7 merged** (`m1/a7-fix-1` `91d91be`, merge commit before `eaba02a`): Opus first reviews PASS WITH FIXES, two fix
  rounds, re-review spec CONFIRMED WITH NOTES / security CONFIRMED. **A5d merged** (`985febc`, then `m1/a5d-fix-2`
  `abe6064`): wizard steps 2-4 on `/tests/:id`, v2 save/publish, Edit as new version, expected version on all draft
  and integrity PUTs. **E2E specs merged** (`3fcafcc`).
- **Two real bugs the E2E runs found (also on staging):** `062e0b8` jsonb double-encoding of `amr` (every library
  reference read 503); `0a7199f` REST name check refused `publish_source_v2` (every v2 publish 400). Guards:
  `services/api/src/sql-params.test.ts`, `foundation.test.ts`.
- Review record: `docs/reviews/M1-wave3-first-reviews.md`.

## In flight at handoff
- **No agent is running.** No uncommitted work. Unmerged CI-only branches (do not merge): `m1/e2e-specs-2` `b54091e`,
  `-3` `1dc427e`, `-4` `62215c1` (each = the E2E specs + an integration tip, used for dispatch runs).

## Stream branches
Merged (do not delete): `m1/a1-packages` · `m1/a5a-fix-1` · `m1/a5b-fix-1` · `m1/a5c-fix-1` · `m1/a4-edge-delivery` · `m1/a4-fix-1` · `m1/a3a-jobs-v2` · `m1/a3a-fix-1` · `m1/a3a-fix-2` · `m1/a3b-jobs-authoring` · `m1/a3b-fix-1` · `m1/a2b-api-tests` · `m1/a2b-fix-1` · `m1/a2a-api-bank` · `m1/a2a-fix-1` · `m1/a2a-fix-1-r2` · `m1/a7-candidate` `b89e2ea` · `m1/a7-fix-1` `91d91be` · `m1/a5d-wizard` `2489db3` · `m1/a5d-fix-1` `07a21d9` · `m1/a5d-fix-2` `abe6064` · `m1/e2e-specs` `cf90491` · `m1/e2e-specs-fix-1` `57973f1` (all on `trace`). Unmerged by founder answer (b): `m1/a5a-fix-2/-3/-4` (zip reader, M8).

## Next step (one precise action list)
1. Verify first (below).
2. **Lead, owed before the M1 exit** (no writer needed for most; migrations and pgTAP are lead-only):
   a. R5-70 re-review Low 1: D1-shape re-check inside `save_test_draft` under its row lock (migration + pgTAP).
   b. R5-63 f rest: atomic `create_test_from_template` RPC; atomic `save_bank_draft` RPC (also re-review Low 4);
      the written paste rule derived in the database; template list paging.
   c. R5-64 g: revoke the `id` INSERT grants (import_jobs, ai_draft_jobs, …) after rewriting ~35 pgTAP fixture
      inserts in `docs/progress/m1-wave0-drafts/pgtap/bodies/{rls_m1_ai_drafts,rls_m1_imports}.sql` (+ preamble).
   d. E2E library seeding (spec §8 known limit): a local-only route/script that seeds library content so AT-M1-01
      exercises the from-template library copy — or record it as a deferred gate in the M1 summary.
   e. Carried Info (decide or defer to REVIEW): A7 hand-over total time budget (~127 s worst case); uncapped
      `Retry-After` on the outbox 429 and item-GET 429 paths; integrity PUT "invalid body + stale version" test.
3. Then BUILD is complete: run the M1 AT list (spec §12) against the code, draft `docs/milestones/M1-summary.md`
   (deferred gates §13 + the items above), and hand M1 **REVIEW** to a fresh session (AUTOPILOT §2:
   `trace-milestone-review`, `docs/reviews/M1.md`).
4. Dependency bumps owed (build-notes 2026-10-24): vitest 4.1.12 + undici 7.30.1 on/after 2026-10-29; fast-uri
   3.1.9 on/after 2026-11-02; happy-dom 21.x before 2026-11-23; then delete the matching osv ignores.
5. A2b Low 2 staging R2 `onlyIf` check and DC-M1-1/6 staging halves need a founder-approved staging dispatch.

## Founder items
- Unchanged: coverage when tab focus is off (default a); D1 integrity job re-delivered after M1 (default a); M1-15 "shared-device" copy (default: leave out); import cancel keeps rows (default a); M1 staging Hyperdrive configs + secrets (+ jobs `SUPABASE_URL`, + api `MEMBER_INVITE_PEPPER` ≥ 32 bytes); Q-M1-1…Q-M1-4; OPEN-8a Workers Paid; written AI drafts; zip reader answered (b).
- New (information only): the two api bugs above would have broken templates, presets, library browse and every v2
  publish on staging too; both are fixed on `m1/integration` (no staging deploy happened).
- New (information only): this machine runs out of RAM on parallel lint/tests (see Gotchas); CI is unaffected.

## Gotchas
- Worktree guard: no `cd …&&`, `git -C`, `$(...)`, loops, compound or piped node-script commands, no heredocs appending to repo files; write scripts with the Write tool and run them plainly; commit messages via `git commit -F <unique file>`; merges `chore: merge …`. A refused compound command runs NOTHING.
- `node scripts/db-types.mjs` and `pnpm test:rls` RESET the local database: never while a writer or diagnosis agent runs db-tests or psql probes. `pnpm exec supabase migration up --local` applies a new migration without a reset.
- A function body's comments are in `pg_get_functiondef` (a pgTAP text pin on the body sees them).
- **RAM (worse this chat):** `pnpm -s verify:fast` and `pnpm lint` crash with OOM here (all workspaces at once). Run the
  gate serially instead: `pnpm -r --workspace-concurrency=1 typecheck`, `pnpm -r --workspace-concurrency=1 lint`,
  prettier/check scripts/gitleaks, then per package `pnpm --filter ./<pkg> exec vitest run --maxWorkers=1`,
  `pnpm exec vitest run --root scripts --maxWorkers=1`, `pnpm test:rls`, serial build (~14 min, all green).
- A branch checked out in a writer's worktree must not be moved; create a new branch (`git commit-tree` merge + `git branch`).
- e2e-local dispatch from an `m1/**` branch runs no staging job (deploy-staging needs `main`, `d1/**` or `milestone/**`).
- Never hand-edit generated `rls_m1_*.test.sql`: edit `docs/progress/m1-wave0-drafts/pgtap/bodies/*.sql`/`preamble.sql`, run `node docs/progress/m1-wave0-drafts/pgtap/gen.mjs . <name>`, run named files with `node docs/progress/m1-wave0-drafts/pgtap/run.mjs <names>`.

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` · `git status` · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `gh run list --repo TraceHiring/TraceHiring --branch m1/integration --limit 3` · the serial gate from Gotchas (or `pnpm -s verify:fast` on a machine with RAM) · `docker ps` (supabase_db_trace up)
