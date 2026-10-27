# HANDOFF — 2026-10-27 09:05 IST (M1 FIX done; M1 CLOSE waits for D1 CLOSE + founder; next chat: M2 SPEC refresh)
Reason for stopping: this chat's task is done (AUTOPILOT §2: one phase per session; FIX done). Max account; 5-hour
window ~40%, weekly ~63%. Start from `docs/progress/RESUME-PROMPT.md` §4 on **`m1/integration`** (worktree
`.claude/worktrees/m1-integration`). The repo wins.

## Paused: D1 (founder, 2026-10-22 night: paused, not closed)
D1's remaining steps belong to a D1 chat on `d1/integration` (worktree `.claude/worktrees/d1-integration`). Nothing is committed to `d1/integration` or `main` from M1. Copied from the `d1/integration` HANDOFF (`3c2e42a`, tip `1547fd0`):
- **Next step 1.** Workers Paid answered (2026-10-22 21:20): "not yet"; OPEN-8a stays a founder gate and D1 can close without it. Remaining founder item: **AT-D2 capture**. For it: dispatch staging from `d1/integration` with `run_e2e=true` on the final tip (re-checks AT-D1/AT-D17 after `1d36151`), then the founder runs `pnpm e2e:record` (spec 4p §7.3) with an OS-level screen capture; record file name, SHA-256, `recordedMs`, run id.
- **Next step 2.** Then `docs/milestones/D1-summary.md`, tag the next free `cp/d1-*` number (after `cp/d1-11`, `cp/d1-10`) on the verified tip, and **D1 CLOSE by PR to `main`** only with the founder's go-ahead (AUTOPILOT §2, §6). At the merge the founder adds `e2e-local` back to ruleset 25633431's required checks.
- **Staging re-run already done on the final tip (reuse it):** dispatch **39820502191** on `1547fd0` (run_e2e=true, started before the pause, not touched by M1): all 7 jobs **success** (static, migrations, rls, security, e2e-local, deploy-staging, e2e-staging). Artifact `e2e-staging-results` manifest: spec `d1-slice`, project `staging`, sha `1547fd0…`, 55/55 steps ok, `durationMs` 304726, `recordedMs` 295068 (`record: false`), **AT-D17 `time_to_ready_ms`: A 46307, B 30833, C 69999, D 19441** (max 70.0 s: inside the 90 s gate; the 30 s target is still the M5-owned deviation). If `d1/integration` is still `1547fd0`, this is the "staging re-run on the final tip"; only the AT-D2 capture (record mode) remains.
- **D1 founder items:** AT-D2 screen capture (`pnpm e2e:record`); Workers Paid (OPEN-8a) "not yet", decide before any load test (M3a); Dependabot PRs #7-#12 not merged blind; after D1 merges, `e2e-local` back on the required checks.

## Where we are (verified this chat)
- Milestone **M1 · Test authoring**, phase **FIX done → CLOSE (founder-gated)**. Spec rev 5, rows up to **R5-72** (FIX).
- `m1/integration` = the handoff commit on `3cfbea8` (`docs(reviews): m1 fix record and its confirming re-review`).
  `trace/d1/integration` = `1547fd0`, `trace/main` = `da5380d`: unchanged.
- Review report `docs/reviews/M1.md`: verdict PASS WITH CONDITIONS; section "M1 FIX (2026-10-27) and its confirming
  re-review" records every fix, both re-review verdicts (all CONFIRMED) and what was carried.

## Done this chat (one commit per finding, red test first)
| Finding | Commit | Change | Test |
| --- | --- | --- | --- |
| M1-REV-1 (Medium) | `1a61e89` | migration M1-t `20261027010000_m1_worker_columns.sql`: column-list SELECT for `trace_authoring_worker` | `rls_m1_review_fixes` (5/8 red before); jobs `drafting.db.test.ts` 10/10 |
| M1-REV-2 (Medium) | `2817949` | M1-u `20261027020000_m1_retired_copy.sql`: retired copies never reused; partial unique index | `rls_m1_review_fixes` (3/11 red before) |
| M1-REV-7 (Low) | `037239c` | test only: AT-M1-02 skill_key + approved_by arms | `rls_m1_review_fixes` |
| M1-REV-6 (Low) | `b149b79` | `candidate-summary-2` paste line ("Dropping text is turned off") | 3 pins red first |
| M1-REV-8 (Low) | `445788f` | M1-v `20261027030000_m1_invite_lookup_note.sql`: corrected function comment | comment pin, red first |
| spec + summary | `a3cefec` | spec **R5-72** a-g; summary doc fixes (G2, header, 22 migrations, row 20 duplicate, final-tip AT times, AT-M1-07 citation), rows 22-24 | — |
| re-review notes | `76cb0d4` | trigger restore pinned in the test; fuller M1-v comment (edited in place: comment only, provisional M1 migration); `auth-admin.ts` comment; api fake skips retired copies; rls floor 3893 → **3919** | test:rls |
| record | `3cfbea8` | `docs/reviews/M1.md` FIX section; summary row 25 | — |
- Carried (spec R5-72 f, g; summary §5 rows 22-25): **M1-REV-3 → M10** (ABH-39, per-session opaque option ids);
  **M1-REV-4, M1-REV-5 → M5**; re-review Lows **copy-cap race + retire/copy growth → M5** (two-connection test first).
- Confirming re-review: two Opus agents (database-reviewer, security-reviewer), read-only, rolled-back probes; every
  fix CONFIRMED; no Critical/High/Medium.
- **Gates on the final code** (tip `3cfbea8`): `pnpm -s verify:fast` 0 at session start; serial `typecheck` 0, `pnpm
  lint` 0, `pnpm -r --workspace-concurrency=1 test` 0, `vitest run --root scripts` 0 (2832 passed, 2 skipped platform
  guards), `pnpm test:rls` 0 (52 files, catalog 150, rls 3919, db-types current), serial `build` 0.
  **Linux CI PR #14 run 40443964937 on `3cfbea8`: green** (static, migrations, security, rls).
- e2e-local dispatch **40452291552** on `3cfbea8` (run_e2e=true): see "In flight".

## In flight at handoff
- **No agent is running. No uncommitted work.**
- e2e-local dispatch 40452291552 on `3cfbea8`: result in the LOG row of this chat if it finished before the push;
  otherwise read it first (`gh run view 40452291552 --repo TraceHiring/TraceHiring`). A red e2e is fixed before
  anything else.
- Unmerged CI-only branches (do not merge): `m1/e2e-specs-2` `b54091e`, `-3` `1dc427e`, `-4` `62215c1`.

## Stream branches
Merged (do not delete): `m1/a1-packages` · `m1/a5a-fix-1` · `m1/a5b-fix-1` · `m1/a5c-fix-1` · `m1/a4-edge-delivery` · `m1/a4-fix-1` · `m1/a3a-jobs-v2` · `m1/a3a-fix-1` · `m1/a3a-fix-2` · `m1/a3b-jobs-authoring` · `m1/a3b-fix-1` · `m1/a2b-api-tests` · `m1/a2b-fix-1` · `m1/a2a-api-bank` · `m1/a2a-fix-1` · `m1/a2a-fix-1-r2` · `m1/a7-candidate` `b89e2ea` · `m1/a7-fix-1` `91d91be` · `m1/a5d-wizard` `2489db3` · `m1/a5d-fix-1` `07a21d9` · `m1/a5d-fix-2` `abe6064` · `m1/e2e-specs` `cf90491` · `m1/e2e-specs-fix-1` `57973f1` · `m1/a8-templates-rpc` `701df43` · `m1/a8-fix-1` `88557c1` · `m1/a9-bank-rpc` `a585f41` (all on `trace`). Unmerged by founder answer (b): `m1/a5a-fix-2/-3/-4` (zip reader, M8). No new stream branch this chat (all FIX work was lead work on `m1/integration`).

## Next step (one precise action list)
1. Verify first (below), including the e2e dispatch 40452291552.
2. **M1 CLOSE is founder-gated** (AUTOPILOT §2, R5-1, R5-30): it waits for the D1 CLOSE (founder's AT-D2 capture,
   D1 summary, D1 CLOSE PR with go-ahead) and the founder's go-ahead for M1. Then: merge `main` into `m1/integration`,
   re-timestamp M1 migrations (M1-a … M1-v), re-derive the seven replaced guards, full verify, complete
   `docs/milestones/M1-summary.md` §9, CLOSE PR, tag `m1-reviewed`. Do not start it before both gates.
3. **Next unblocked chat = M2 SPEC refresh** (spec R5-1: "M2 builds after M1's migrations on its own branch (its spec
   revision 4 is refreshed in the M2 SPEC chat; its migrations still sort after M1's and still call
   `private.assert_drive_pool_ratio()`)"; build-order "M1 ∥ M2"; SESSION-PLAN line 44). Refresh
   `specs/m2-scheduling-invites.md` revision 4 → 5 against M1 as built (R5-1 … R5-72, migrations up to M1-v, D1 4p),
   on a new branch `m2/integration` cut from `m1/integration` @ the handoff commit (its own worktree
   `.claude/worktrees/m2-integration`); spec-reviewer + database-reviewer until approved; founder questions to
   FOUNDER-QUEUE (SPEC-M1-M2.md §2 has Q-M2-n with safe defaults). No staging dispatch.
4. Dependency bumps owed (build-notes 2026-10-24): vitest 4.1.12 + undici 7.30.1 on/after 2026-10-29; fast-uri
   3.1.9 on/after 2026-11-02; happy-dom 21.x before 2026-11-23; then delete the matching osv ignores.
5. Staging-only checks need a founder-approved staging dispatch: A2b Low 2 R2 `onlyIf`, DC-M1-1/5/6 staging halves,
   AT-M1-10 on staging, the largest from-template call under the 8 s statement timeout.

## Founder items
- Unchanged: coverage when tab focus is off (default a); D1 integrity job re-delivered after M1 (default a); M1-15 "shared-device" copy (default: leave out); import cancel keeps rows (default a); M1 staging Hyperdrive configs + secrets (+ jobs `SUPABASE_URL`, + api `MEMBER_INVITE_PEPPER` ≥ 32 bytes); Q-M1-1…Q-M1-4; OPEN-8a Workers Paid; written AI drafts; zip reader answered (b).
- New (information only): M1 FIX done, re-review CONFIRMED; **M1 CLOSE needs D1 CLOSE first and your go-ahead**.

## Gotchas
- Worktree guard: no `cd …&&`, `git -C`, `$(...)`, loops, compound or piped node-script commands, no heredocs appending to repo files; write scripts with the Write tool and run them plainly; commit messages via `git commit -F <unique file>`; merges `chore: merge …`. A refused compound command runs NOTHING. `gitleaks git …` is refused (use `gitleaks detect --source . --redact --no-banner`, or `pnpm lint`). `node -e` with `require(<arg>)` is refused.
- `node scripts/db-types.mjs` and `pnpm test:rls` RESET the local database: never while a writer or reviewer runs db-tests or psql probes. `pnpm exec supabase migration up --local` applies a new migration without a reset (it does not re-run an edited one: reset for that).
- A function body's comments are in `pg_get_functiondef` (a pgTAP text pin on the body sees them).
- **RAM:** run the gate serially: `pnpm -r --workspace-concurrency=1 typecheck`, `pnpm lint`, `pnpm -r --workspace-concurrency=1 test`, `pnpm exec vitest run --root scripts --maxWorkers=1`, `pnpm test:rls`, `pnpm -r --workspace-concurrency=1 build` (all green this chat, no OOM).
- `alter table … disable trigger user` in a pgTAP body turns ENABLE ALWAYS triggers back to origin on re-enable; restore each by name (`rls_m1_review_fixes` shows how).
- Since M1-p the database derives a draft's navigation default and written paste rule from its settings; pgTAP cases that need a mismatched state turn `sections_settings_derive` off around it. Fixtures inserting import/drafting jobs as org users use `pg_temp.next_id(id)` — the same pattern fits M1-REV-4 (M5).
- A branch checked out in a writer's worktree must not be moved; create a new branch (`git commit-tree` merge + `git branch`).
- e2e-local dispatch from an `m1/**` branch runs no staging job (deploy-staging needs `main`, `d1/**` or `milestone/**`).
- Never hand-edit generated `rls_m1_*.test.sql`: edit `docs/progress/m1-wave0-drafts/pgtap/bodies/*.sql`/`preamble.sql`, run `node docs/progress/m1-wave0-drafts/pgtap/gen.mjs . <name>`, run named files with `node docs/progress/m1-wave0-drafts/pgtap/run.mjs <names>`.
- Rolled-back psql from Git Bash: `docker cp <file> supabase_db_trace:/tmp/x.sql`, then `MSYS_NO_PATHCONV=1 docker exec supabase_db_trace psql -U postgres -X -q -At -v ON_ERROR_STOP=1 -f /tmp/x.sql` (begin … rollback); `\i /tmp/pre.sql` after copying `preamble.sql` gives the pgTAP fixtures.

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` · `git status` · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `gh run list --repo TraceHiring/TraceHiring --branch m1/integration --limit 3` (latest green) · `gh run view 40452291552 --repo TraceHiring/TraceHiring` (e2e on `3cfbea8`) · `pnpm -s verify:fast` (or the serial gate) · `docker ps` (supabase_db_trace up)
