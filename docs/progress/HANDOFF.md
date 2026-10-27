# HANDOFF — 2026-10-27 07:45 IST (M1 BUILD 5 done: lead's owed items merged; BUILD complete, M1 REVIEW next)
Reason for stopping: this chat's task is done (HANDOFF 2026-10-26 Next step 2 closed, step 3 drafted). Max account;
5-hour window ~8% (after the 05:30 IST reset; the machine slept ~6 h mid-session), weekly ~58%. Start from
`docs/progress/RESUME-PROMPT.md` §4 on **`m1/integration`** (worktree `.claude/worktrees/m1-integration`). The repo wins.

## Paused: D1 (founder, 2026-10-22 night: paused, not closed)
D1's remaining steps belong to a D1 chat on `d1/integration` (worktree `.claude/worktrees/d1-integration`). Nothing is committed to `d1/integration` or `main` from M1. Copied from the `d1/integration` HANDOFF (`3c2e42a`, tip `1547fd0`):
- **Next step 1.** Workers Paid answered (2026-10-22 21:20): "not yet"; OPEN-8a stays a founder gate and D1 can close without it. Remaining founder item: **AT-D2 capture**. For it: dispatch staging from `d1/integration` with `run_e2e=true` on the final tip (re-checks AT-D1/AT-D17 after `1d36151`), then the founder runs `pnpm e2e:record` (spec 4p §7.3) with an OS-level screen capture; record file name, SHA-256, `recordedMs`, run id.
- **Next step 2.** Then `docs/milestones/D1-summary.md`, tag the next free `cp/d1-*` number (after `cp/d1-11`, `cp/d1-10`) on the verified tip, and **D1 CLOSE by PR to `main`** only with the founder's go-ahead (AUTOPILOT §2, §6). At the merge the founder adds `e2e-local` back to ruleset 25633431's required checks.
- **Staging re-run already done on the final tip (reuse it):** dispatch **39820502191** on `1547fd0` (run_e2e=true, started before the pause, not touched by M1): all 7 jobs **success** (static, migrations, rls, security, e2e-local, deploy-staging, e2e-staging). Artifact `e2e-staging-results` manifest: spec `d1-slice`, project `staging`, sha `1547fd0…`, 55/55 steps ok, `durationMs` 304726, `recordedMs` 295068 (`record: false`), **AT-D17 `time_to_ready_ms`: A 46307, B 30833, C 69999, D 19441** (max 70.0 s: inside the 90 s gate; the 30 s target is still the M5-owned deviation). If `d1/integration` is still `1547fd0`, this is the "staging re-run on the final tip"; only the AT-D2 capture (record mode) remains.
- **D1 founder items:** AT-D2 screen capture (`pnpm e2e:record`); Workers Paid (OPEN-8a) "not yet", decide before any load test (M3a); Dependabot PRs #7-#12 not merged blind; after D1 merges, `e2e-local` back on the required checks.

## Where we are (verified this chat)
- Milestone **M1 · Test authoring**, phase **BUILD complete** (BUILD 5 = the lead's owed items). Spec rev 5, rows up to
  **R5-71 (a-i)**. `m1/integration` = the handoff commit on `acceb02` (`fix(db-types): pin the two m1-q public functions…`, on the gate commit `5d6f37b`),
  pushed. `trace/d1/integration` = `1547fd0`, `trace/main` = `da5380d`: unchanged (nothing committed to either).
- **Full serial gate green on the merged tree** (2026-10-27): typecheck, eslint, prettier, boundaries, workflows,
  catalog, migrations, gitleaks, every package's tests with `--maxWorkers=1` (incl. edge 464, jobs 504), scripts,
  `test:rls` **51 files / catalog 150 / rls 3893** (floor raised 3784 → 3893), db-types current, build + dist checks.
- **Linux CI:** on `5d6f37b` the `static` job failed (db-types type test missed the two M1-q functions) → fixed `acceb02`; PR #14 run and e2e-local dispatch **40436931164** on `acceb02` started at hand-off — see "In flight".
- New migrations (all lead, tests first): M1-p `20261026180000_m1_atomic_writes.sql`, M1-q `…190000_m1_atomic_rpcs.sql`,
  M1-r `…200000_m1_lock_order.sql`, M1-s `…210000_m1_rpc_fixes.sql`. New pgTAP: `rls_m1_atomic` (48), `rls_m1_rpcs` (60).

## Done this chat (all on m1/integration, pushed)
- **M1-p** (red `2ed0d6c`, `58e20a2` → `0031fac`): D1 shape re-checked inside `save_test_draft` under its row lock
  (R5-70 re-review Low 1); navigation default + written paste rule derived in the database, integrity PUT one write
  (R5-63 f); `id` out of the import/drafting job insert grants (R5-64 g). Opus reviews: DB APPROVE WITH FIXES, security
  and spec PASS WITH FIXES → fix round **M1-r** (red `0316b9c` → `5504e4d`): one lock order (ruleset, then version), a
  two-connection scenario "draft save during a settings write" in `scripts/test-concurrency-local.mjs`, 40P01 → 409.
  Confirming re-reviews: DB CONFIRMED WITH NOTES, security CONFIRMED.
- **M1-q** (red `7e9defe` → `16c58c4`): atomic `create_test_from_template` and `save_bank_draft` RPCs (R5-71 d, e).
  Reviews: DB APPROVE WITH FIXES, security PASS WITH FIXES → **M1-s** (red `170a869` → `66a2674`): 0-10 sections,
  ≤ 2,000 ids a call, de-dup, flag default, role/edge pgTAP. Confirming re-review CONFIRMED WITH NOTES (notes fixed `5d6f37b`).
- **Stream a9** `m1/a9-bank-rpc` `a585f41` (Opus writer; review PASS) merged. **Stream a8** `m1/a8-templates-rpc`
  `701df43` + `m1/a8-fix-1` `88557c1` (from-template one RPC, template list paging; review PASS WITH FIXES, fixed,
  CONFIRMED WITH NOTES) merged `1a3ad2b`. Lead: R5-71 i `skippedSections` widened (red `fe169d1` → `1b9c19d`).
- Lead decisions R5-71 g (template cursor = PageCursor with a fixed marker time), h (M1 E2E stays in `e2e-local`,
  amends R5-27), i; 2d E2E library seeding deferred gate; 2e carried Info deferred to REVIEW.
- Records: `docs/reviews/M1-build5-reviews.md`; summary draft `docs/milestones/M1-summary.md` (AT map: all 32
  AT-M1-xx covered with files; gaps G2, G4-G10 and 23 deferred gates listed for REVIEW).

## In flight at handoff
- **No agent is running. No uncommitted work.**
- **CI not yet read:** PR #14 checks on `acceb02` (bound to the app session) and e2e-local dispatch **40436931164**
  (`gh run view 40436931164 --repo TraceHiring/TraceHiring`; AT-M1-01/30 now go through `create_test_from_template`).
  The next session reads both first; a red run is fixed before anything else (AUTOPILOT §6).
- Unmerged CI-only branches (do not merge): `m1/e2e-specs-2` `b54091e`, `-3` `1dc427e`, `-4` `62215c1`.

## Stream branches
Merged (do not delete): `m1/a1-packages` · `m1/a5a-fix-1` · `m1/a5b-fix-1` · `m1/a5c-fix-1` · `m1/a4-edge-delivery` · `m1/a4-fix-1` · `m1/a3a-jobs-v2` · `m1/a3a-fix-1` · `m1/a3a-fix-2` · `m1/a3b-jobs-authoring` · `m1/a3b-fix-1` · `m1/a2b-api-tests` · `m1/a2b-fix-1` · `m1/a2a-api-bank` · `m1/a2a-fix-1` · `m1/a2a-fix-1-r2` · `m1/a7-candidate` `b89e2ea` · `m1/a7-fix-1` `91d91be` · `m1/a5d-wizard` `2489db3` · `m1/a5d-fix-1` `07a21d9` · `m1/a5d-fix-2` `abe6064` · `m1/e2e-specs` `cf90491` · `m1/e2e-specs-fix-1` `57973f1` · **`m1/a8-templates-rpc` `701df43` · `m1/a8-fix-1` `88557c1` · `m1/a9-bank-rpc` `a585f41`** (all on `trace`). Unmerged by founder answer (b): `m1/a5a-fix-2/-3/-4` (zip reader, M8).

## Next step (one precise action list)
1. Verify first (below), including both CI results above; fix any Linux CI failure first.
2. **M1 REVIEW in a fresh session** (AUTOPILOT §2: a session that did not write the code): run the
   `trace-milestone-review` skill on `m1/integration`, write `docs/reviews/M1.md`; input `docs/milestones/M1-summary.md`
   (§0 gaps G2-G10, §5 deferred gates incl. 20a-20c), `docs/reviews/M1-build5-reviews.md` (accepted/deferred items).
3. Then FIX (Blocking findings, one commit each with a regression test) and CLOSE per AUTOPILOT §2 — CLOSE waits for
   the D1 CLOSE and the founder's go-ahead (R5-1, R5-30: merge `main` in first, re-timestamp M1 migrations).
4. Dependency bumps owed (build-notes 2026-10-24): vitest 4.1.12 + undici 7.30.1 on/after 2026-10-29; fast-uri
   3.1.9 on/after 2026-11-02; happy-dom 21.x before 2026-11-23; then delete the matching osv ignores.
5. Staging-only checks need a founder-approved staging dispatch: A2b Low 2 R2 `onlyIf`, DC-M1-1/5/6 staging halves,
   AT-M1-10 on staging, the largest from-template call under the 8 s statement timeout (M1-q DB review 2).

## Founder items
- Unchanged: coverage when tab focus is off (default a); D1 integrity job re-delivered after M1 (default a); M1-15 "shared-device" copy (default: leave out); import cancel keeps rows (default a); M1 staging Hyperdrive configs + secrets (+ jobs `SUPABASE_URL`, + api `MEMBER_INVITE_PEPPER` ≥ 32 bytes); Q-M1-1…Q-M1-4; OPEN-8a Workers Paid; written AI drafts; zip reader answered (b).
- New (information only): BUILD 5 closed the lead's owed list; nothing new needs a founder answer.

## Gotchas
- Worktree guard: no `cd …&&`, `git -C`, `$(...)`, loops, compound or piped node-script commands, no heredocs appending to repo files; write scripts with the Write tool and run them plainly; commit messages via `git commit -F <unique file>`; merges `chore: merge …`. A refused compound command runs NOTHING.
- `node scripts/db-types.mjs` and `pnpm test:rls` RESET the local database: never while a writer or diagnosis agent runs db-tests or psql probes. `pnpm exec supabase migration up --local` applies a new migration without a reset. Named pgTAP runs on a database that holds committed e2e/concurrency rows can fail on unscoped assertions; `test:rls` resets first.
- A function body's comments are in `pg_get_functiondef` (a pgTAP text pin on the body sees them).
- **RAM:** `pnpm -s verify:fast` and `pnpm lint` crash with OOM here. Run the gate serially: `pnpm -r --workspace-concurrency=1 typecheck`, `… lint`, prettier/check scripts/gitleaks, per package (apps, packages, services **and workers**) `pnpm --filter ./<pkg> exec vitest run --maxWorkers=1`, `pnpm exec vitest run --root scripts --maxWorkers=1`, `pnpm test:rls`, serial build (~15 min, all green).
- Since M1-p the database derives a draft's navigation default and written paste rule from its settings; pgTAP cases that need a mismatched state turn `sections_settings_derive` off around it. Fixtures inserting import/drafting jobs as org users use `pg_temp.next_id(id)` (test-only trigger in those bodies).
- A branch checked out in a writer's worktree must not be moved; create a new branch (`git commit-tree` merge + `git branch`).
- e2e-local dispatch from an `m1/**` branch runs no staging job (deploy-staging needs `main`, `d1/**` or `milestone/**`).
- Never hand-edit generated `rls_m1_*.test.sql`: edit `docs/progress/m1-wave0-drafts/pgtap/bodies/*.sql`/`preamble.sql`, run `node docs/progress/m1-wave0-drafts/pgtap/gen.mjs . <name>`, run named files with `node docs/progress/m1-wave0-drafts/pgtap/run.mjs <names>`.

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` · `git status` · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `gh run list --repo TraceHiring/TraceHiring --branch m1/integration --limit 3` · `gh run view 40436931164 --repo TraceHiring/TraceHiring` · the serial gate from Gotchas (or `pnpm -s verify:fast` on a machine with RAM) · `docker ps` (supabase_db_trace up)
