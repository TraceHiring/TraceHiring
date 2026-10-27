# HANDOFF — 2026-10-27 11:30 IST (M2 SPEC refresh done = revision 5 approved; next chat: M2 BUILD 1 = Wave 0)
Reason for stopping: this chat's task is done (AUTOPILOT §2: one phase per session; the M2 SPEC phase is done).
Max account; 5-hour window ~78% at stop (reset 11:30 IST), weekly ~68%. Start from `docs/progress/RESUME-PROMPT.md`
§4 on **`m1/integration`** (worktree `.claude/worktrees/m1-integration`); M2 work lives on **`m2/integration`**
(worktree `.claude/worktrees/m2-integration`). The repo wins.

## Paused: D1 (founder, 2026-10-22: paused, not closed)
D1's remaining steps belong to a D1 chat on `d1/integration` (worktree `.claude/worktrees/d1-integration`). Nothing is committed to `d1/integration` or `main` from M1 or M2. Copied from the `d1/integration` HANDOFF (`3c2e42a`, tip `1547fd0`):
- **Next step 1.** Workers Paid answered (2026-10-22 21:20): "not yet"; OPEN-8a stays a founder gate and D1 can close without it. Remaining founder item: **AT-D2 capture**. For it: dispatch staging from `d1/integration` with `run_e2e=true` on the final tip (re-checks AT-D1/AT-D17 after `1d36151`), then the founder runs `pnpm e2e:record` (spec 4p §7.3) with an OS-level screen capture; record file name, SHA-256, `recordedMs`, run id.
- **Next step 2.** Then `docs/milestones/D1-summary.md`, tag the next free `cp/d1-*` number (after `cp/d1-11`, `cp/d1-10`) on the verified tip, and **D1 CLOSE by PR to `main`** only with the founder's go-ahead (AUTOPILOT §2, §6). At the merge the founder adds `e2e-local` back to ruleset 25633431's required checks.
- **Staging re-run already done on the final tip (reuse it):** dispatch **39820502191** on `1547fd0` (run_e2e=true): all 7 jobs **success**; artifact `e2e-staging-results`: spec `d1-slice`, 55/55 steps ok, `durationMs` 304726, `recordedMs` 295068 (`record: false`), **AT-D17 `time_to_ready_ms`: A 46307, B 30833, C 69999, D 19441** (max 70.0 s, inside the 90 s gate; the 30 s target is the M5-owned deviation). If `d1/integration` is still `1547fd0`, only the AT-D2 capture (record mode) remains.
- **D1 founder items:** AT-D2 screen capture (`pnpm e2e:record`); Workers Paid (OPEN-8a) "not yet", decide before any load test (M3a); Dependabot PRs #7-#12 not merged blind; after D1 merges, `e2e-local` back on the required checks.

## Where we are (verified this chat)
- **M1 · Test authoring:** FIX done → **CLOSE founder-gated** (waits for the D1 CLOSE and the founder's go-ahead).
  `m1/integration` = this handoff commit on `7c33f48` (no M1 code changed this chat).
- **M2 · Scheduling & invites:** **SPEC done** — `specs/m2-scheduling-invites.md` **revision 5 approved by autopilot
  reviewers** (binding rows §1.8 **R5-1…R5-66**). Branch **`m2/integration`** cut from `m1/integration` @ `7c33f48`,
  tip **`7b73de0`** on trace. Next phase: **M2 BUILD 1 = Wave 0** (M2 spec §11.2, §11.4).
- `trace/d1/integration` = `1547fd0`, `trace/main` = `da5380d`: unchanged.
- Verify-first at chat start: m1 `7c33f48` = trace, clean, `pnpm -s verify:fast` exit 0, docker `supabase_db_trace`
  healthy. **In-flight e2e dispatch 40452291552 on `3cfbea8`: success** (static, migrations, rls, security,
  e2e-local; deploy/e2e-staging skipped as expected from `m1/**`).

## Done this chat (docs only; all on `m2/integration`)
| Commit | What |
| --- | --- |
| `4f39b42` | Revision 5 from three read-only Opus audits of rev 4 vs M1 as built (DB, runtime/security, process; 15 High): R5-1…R5-40 + in-place §0, §1.2, §1.3, §3, §6, §8, §11 (new §11.1-§11.4), §12 (AT-M2-28…34), §13, §14; `SPEC-M1-M2.md` status + **Q-M2-4**; FOUNDER-QUEUE rows (M2 questions; M2 staging prerequisites F-2…F-5 + Hyperdrive) |
| `63b5578` | Opus database review (BLOCK, 4 High) + Opus spec review (BLOCK, 2 High) fixed: R5-41…R5-62, AT-M2-35/36 |
| `028ae11` | Confirming re-reviews (both BLOCK): **R5-63 returns to D1's start path + a start-window check** (the prepare-at-consent redesign failed two reviews); R5-64, R5-65 (backfill disables the guard explicitly) |
| `1716f58` | Final re-review (BLOCK, 1 High) fixed: R5-66 (`session_grant_exp` formula, `SessionDO.peek()`, `invitation_window`, lobby caps) |
| `7b73de0` | Re-check APPROVE WITH FIXES (3 Lows fixed); approval recorded in §14 and `SPEC-M1-M2.md` |
Key revision-5 decisions (all binding rows): CSV only, XLSX invite files wait for founder Q-M2-4 (R5-20); `aws4fetch` = ADR-034 (R5-2); M2 migrations provisional, re-timestamped before M2 CLOSE (R5-3); AT-M2-01 runs in a new dispatch-only CI job `e2e-m2-bulk` (R5-28); staging-only checks founder-gated, off the CLOSE path (R5-29); D1's deferred list pagination taken by M2 with a score-first keyset (R5-31, R5-44, R5-65 b); dependency bumps land on `m1/integration` first, then merged into m2 (R5-33).

## In flight at handoff
- **No agent is running. No uncommitted work** in `m1-integration` or `m2-integration`.
- Unmerged CI-only branches (do not merge): `m1/e2e-specs-2` `b54091e`, `-3` `1dc427e`, `-4` `62215c1`.
- No draft PR exists yet for `m2/integration → main` (BUILD 1 opens one for Linux CI only, never merged).

## Stream branches
M1 merged (do not delete): `m1/a1-packages` · `m1/a5a-fix-1` · `m1/a5b-fix-1` · `m1/a5c-fix-1` · `m1/a4-edge-delivery` · `m1/a4-fix-1` · `m1/a3a-jobs-v2` · `m1/a3a-fix-1` · `m1/a3a-fix-2` · `m1/a3b-jobs-authoring` · `m1/a3b-fix-1` · `m1/a2b-api-tests` · `m1/a2b-fix-1` · `m1/a2a-api-bank` · `m1/a2a-fix-1` · `m1/a2a-fix-1-r2` · `m1/a7-candidate` `b89e2ea` · `m1/a7-fix-1` `91d91be` · `m1/a5d-wizard` `2489db3` · `m1/a5d-fix-1` `07a21d9` · `m1/a5d-fix-2` `abe6064` · `m1/e2e-specs` `cf90491` · `m1/e2e-specs-fix-1` `57973f1` · `m1/a8-templates-rpc` `701df43` · `m1/a8-fix-1` `88557c1` · `m1/a9-bank-rpc` `a585f41` (all on `trace`). Unmerged by founder answer (b): `m1/a5a-fix-2/-3/-4` (zip reader, M8). **M2: no stream branch yet** (`m2/integration` only).

## Next step (one precise action list)
1. Verify first (below), including `trace/m2/integration` = `7b73de0`.
2. **M2 BUILD 1 = Wave 0 on `m2/integration`** (enter `.claude/worktrees/m2-integration` with EnterWorktree; on a new
   machine `git worktree add -b m2/integration .claude/worktrees/m2-integration trace/m2/integration`, then
   `pnpm install --frozen-lockfile`). Do M2 spec **§11.2 in full**, lead only, no writers: pgTAP bodies red first in
   `docs/progress/m2-wave0-drafts/pgtap/` (`.claude/allow-red`), then migrations M2-a…c until green; `rls_roles` /
   `rls_d1_api` / `rls_d1_invariants` list extensions only (R5-8, R5-41, R5-64 d, R5-66 d); MT-15 + floors (R5-16);
   `contracts-m2.ts` + candidate contract changes; db-types; ADR-034 + ADR-030 amendment (R5-21 as narrowed by R5-63,
   R5-66 f); login/Hyperdrive/queue/cron wiring (R5-9); secrets lists + D1 spec 4r row (R5-27); pii-crypto boundaries
   (R5-36); `KeyManager` in `VENDOR_INTERFACES`; `e2e-m2-bulk` job + `e2e-local.mjs --test-scheduled` + DC-M2-6
   (R5-28); DC-M2-3…5 measured locally; build-notes "Autopilot changes" rows (R5-1 branch, R5-20 CSV only). Full serial
   verify, then open a **draft PR `m2/integration → main` (CI only, never merged)** and get Linux CI green. Split 0a/0b
   at the migration boundary if one chat cannot hold it.
3. **M1 CLOSE is founder-gated** (D1 CLOSE + go-ahead): then merge `main` into `m1/integration`, re-timestamp M1
   migrations (M1-a … M1-v), re-derive the seven replaced guards, full verify, `docs/milestones/M1-summary.md` §9,
   CLOSE PR, tag `m1-reviewed`. Do not start it before both gates.
4. Dependency bumps owed (M2 R5-33; build-notes 2026-10-24): vitest 4.1.12 + undici 7.30.1 on/after 2026-10-29;
   fast-uri 3.1.9 on/after 2026-11-02; happy-dom 21.x before 2026-11-23; lead commits on `m1/integration`, then
   `chore: merge m1/integration` into `m2/integration`; delete the matching osv ignores.
5. Staging-only checks need a founder-approved staging dispatch: M1 (A2b Low 2 R2 `onlyIf`, DC-M1-1/5/6 staging halves,
   AT-M1-10 on staging, largest from-template call under 8 s); M2 (AT-M2-12, DC-M2-1/2, DC-M2-3/5 staging halves).

## Founder items
- Unchanged M1 items: coverage when tab focus is off (default a); D1 integrity job re-delivered after M1 (default a); M1-15 "shared-device" copy (default: leave out); import cancel keeps rows (default a); M1 staging Hyperdrive configs + secrets; Q-M1-1…Q-M1-4; OPEN-8a Workers Paid; written AI drafts; zip reader answered (b).
- **New (rows on `m2/integration`'s `docs/progress/FOUNDER-QUEUE.md`):** Q-M2-1…Q-M2-4 (**Q-M2-4 new: Excel invite files; default CSV only**); M2 staging prerequisites F-2…F-5 (F-2 now via `wrangler secret put`, no AWS keys in GitHub; **F-5 SES production access can be requested now**, not blocking) + the `jobs_messaging_login` Hyperdrive config. None blocks M2 BUILD.

## Gotchas
- Worktree guard: no `cd …&&`, `git -C`, `$(...)`, loops, compound or piped node-script commands, no heredocs appending to repo files; write scripts with the Write tool and run them plainly; commit messages via `git commit -F <unique file>`; merges `chore: merge …`. A refused compound command runs NOTHING. A session isolated in one worktree cannot write another: use EnterWorktree to switch.
- `node scripts/db-types.mjs` and `pnpm test:rls` RESET the local database: never while a writer or reviewer runs db-tests or psql probes. `pnpm exec supabase migration up --local` applies a new migration without a reset.
- `invitations_guard` identifies callers only by `current_setting('role')` (stays the caller's inside a DEFINER) and any role can set a custom GUC: never design a "trusted caller" flag (M2 R5-42). It is ENABLE ALWAYS; restore triggers by name after `disable trigger` in pgTAP.
- **RAM:** run the gate serially: `pnpm -r --workspace-concurrency=1 typecheck`, `pnpm lint`, `pnpm -r --workspace-concurrency=1 test`, `pnpm exec vitest run --root scripts --maxWorkers=1`, `pnpm test:rls`, `pnpm -r --workspace-concurrency=1 build`.
- Never hand-edit generated `rls_m*_*.test.sql`: edit the `bodies/*.sql`/`preamble.sql` drafts and run the `gen.mjs` (M1: `docs/progress/m1-wave0-drafts/pgtap/`; M2 copies it to `m2-wave0-drafts`).
- e2e-local dispatch from an `m1/**` or `m2/**` branch runs no staging job (deploy-staging needs `main`, `d1/**` or `milestone/**`).
- Rolled-back psql from Git Bash: `docker cp <file> supabase_db_trace:/tmp/x.sql`, then `MSYS_NO_PATHCONV=1 docker exec supabase_db_trace psql -U postgres -X -q -At -v ON_ERROR_STOP=1 -f /tmp/x.sql` (begin … rollback).

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` · `git rev-parse --short trace/m2/integration` (`7b73de0`) · `git status` (both worktrees) · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `pnpm -s verify:fast` · `docker ps` (supabase_db_trace up)
