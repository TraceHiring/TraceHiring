# HANDOFF — 2026-10-31 07:55 IST (M2 BUILD 1 Wave 0b part 1 + candidate contracts on m2/integration; db-types and the full gate wait on a local port block)
Reason for stopping: context ~58% (CLAUDE.md: hand off near 60%). Earlier stop 00:35 IST was the usage guard. Update
07:55: the founder ran `net stop winnat` / `net start winnat`, but 54282-54381 was reserved again (still blocked);
`docker desktop start` was needed again. Then **`937da1b`** feat(shared): m2 candidate contract changes (R5-23; tests
first; shared 2195, candidate app 312, edge 469 tests, workspace typecheck 0) — pushed; `m2/integration` tip = `937da1b`.
Fix to try next (admin, founder): `wsl --shutdown`, `net stop winnat`, `netsh int ipv4 add excludedportrange
protocol=tcp startport=54320 numberofports=10`, `net start winnat`, then `docker desktop start`.
Start from `docs/progress/RESUME-PROMPT.md` §4 on **`m1/integration`** (worktree `.claude/worktrees/m1-integration`);
M2 work lives on **`m2/integration`** (worktree `.claude/worktrees/m2-integration`). The repo wins.

## Paused: D1 (founder, 2026-10-22: paused, not closed)
D1's remaining steps belong to a D1 chat on `d1/integration` (worktree `.claude/worktrees/d1-integration`). Nothing is committed to `d1/integration` or `main` from M1 or M2. Copied from the `d1/integration` HANDOFF (`3c2e42a`, tip `1547fd0`):
- **Next step 1.** Workers Paid answered (2026-10-22 21:20): "not yet"; OPEN-8a stays a founder gate and D1 can close without it. Remaining founder item: **AT-D2 capture**. For it: dispatch staging from `d1/integration` with `run_e2e=true` on the final tip (re-checks AT-D1/AT-D17 after `1d36151`), then the founder runs `pnpm e2e:record` (spec 4p §7.3) with an OS-level screen capture; record file name, SHA-256, `recordedMs`, run id.
- **Next step 2.** Then `docs/milestones/D1-summary.md`, tag the next free `cp/d1-*` number (after `cp/d1-11`, `cp/d1-10`) on the verified tip, and **D1 CLOSE by PR to `main`** only with the founder's go-ahead (AUTOPILOT §2, §6). At the merge the founder adds `e2e-local` back to ruleset 25633431's required checks.
- **Staging re-run already done on the final tip (reuse it):** dispatch **39820502191** on `1547fd0` (run_e2e=true): all 7 jobs **success**; artifact `e2e-staging-results`: spec `d1-slice`, 55/55 steps ok, `durationMs` 304726, `recordedMs` 295068 (`record: false`), **AT-D17 `time_to_ready_ms`: A 46307, B 30833, C 69999, D 19441** (max 70.0 s, inside the 90 s gate; the 30 s target is the M5-owned deviation). If `d1/integration` is still `1547fd0`, only the AT-D2 capture (record mode) remains.
- **D1 founder items:** AT-D2 screen capture (`pnpm e2e:record`); Workers Paid (OPEN-8a) "not yet", decide before any load test (M3a); Dependabot PRs #7-#12 not merged blind; after D1 merges, `e2e-local` back on the required checks.

## Where we are (verified this chat)
- **M1 · Test authoring:** FIX done → **CLOSE founder-gated** (D1 CLOSE + go-ahead). `m1/integration` = this handoff
  commit on `b78ce97` (no M1 code changed this chat). CI stays on draft PR TraceHiring/TraceHiring#14.
- **M2 · Scheduling & invites: BUILD 1 = Wave 0; 0a done, 0b part 1 done.** `m2/integration` tip **`e9df567`** on trace.
  Draft CI PR **TraceHiring/TraceHiring#16** (`m2/integration → main`, **never merge**).
- Verify-first at chat start: m1 `b78ce97` = trace, m2 `2d5d98a` = trace, d1 `1547fd0`, main `da5380d`, both trees
  clean, `pnpm -s verify:fast` exit 0 on m1 (second run; the first hit worker-pool ECONNRESET while Docker booted).
  CI on #16 head `2d5d98a`: static, rls, security, migrations **pass**.
- **LOCAL BLOCKER (machine, not code):** after a reboot Windows reserved TCP **54282-54381** (`netsh interface ipv4
  show excludedportrange protocol=tcp`), which covers the stack's 54321/54322: Docker cannot publish them, so the
  Supabase CLI (`test db`, `db reset`, `gen types`, `migration up`), `pnpm test:rls`, `pnpm verify`, `node
  scripts/db-types.mjs` and e2e cannot run. Fix (admin, founder): `net stop winnat` then `net start winnat`, then
  `docker restart supabase_db_trace supabase_rest_trace supabase_inbucket_trace supabase_auth_trace supabase_kong_trace`
  and check `docker port supabase_db_trace` shows 54322. Docker Desktop was down at chat start (`docker desktop start`).
- Workaround used this chat: pgTAP through `docker exec psql` (a scratch runner that wraps each file with
  `create extension pgtap` inside its own rolled-back transaction); M2-c applied with `docker exec psql
  --single-transaction` plus a `supabase_migrations.schema_migrations` row `20261027060000`.

## Done this chat (all on `m2/integration`)
| Commit | What |
| --- | --- |
| `0387440` | Red pgTAP first: new `rls_m2_messages` body; `rls_m2_invitations` (AT-M2-20 rotation), `rls_m2_drives` (AT-M2-35 auto-close), `rls_m2_candidate_denied` (M2-c tables and functions); `rls_roles` EXECUTE set (R5-8: added values only) |
| `83185ff` | **wip** Migration **M2-c** `supabase/migrations/20261027060000_m2_messaging.sql` (templates + EN seed, outbound_messages, message_events, message_events_unmatched, planner trigger, claim/close/purge, send context, rotate, record_send, record_send_failure, record_message_event, drive_invitations); RLS floor 4249 → **4401** |
| `494ab5a` | AT-M2-08 last-seat race in `scripts/test-concurrency-local.mjs` (`M2_SCENARIOS`), unit tests first; live run OK with all M0b/M1 scenarios |
| `c3c00e2` | `packages/shared/src/contracts-m2.ts` (`./contracts/m2`) + 35 contract tests (written first) |
| `e9df567` | build-notes "Autopilot changes" row 2026-10-30 (M2-c lead decisions a-g) |

Checked green this chat (docker runner): every `rls_m2_*` (messages 127, invitations 80, drives 69, candidate_denied
13, others unchanged), every `rls_d1_*`, `rls_m1_*`, `rls_roles` (70), `catalog_meta` (133), `catalog_probe`;
`rls_d1_scoping` 3 and 48 fail only on a leftover `org-conc-draft-*` row from an earlier concurrency run (a fresh
`db reset` clears it). `vitest --root scripts test/test-concurrency-local.test.mjs` 15 passed; `@trace/shared` test
2169 passed, typecheck 0. **Not run:** full serial gate, `pnpm test:rls`, `db-types` regeneration.

## In flight at handoff
- **No agent is running.** No uncommitted work in `m1-integration` or `m2-integration`.
- **`.claude/allow-red` exists in `m2-integration`** (gitignored): `packages/db-types/src/database.ts` is NOT
  regenerated for M2-c, so CI on #16 for `e9df567` will fail the rls job's db-types drift check (expected).
- Unmerged CI-only branches (do not merge): `m1/e2e-specs-2` `b54091e`, `-3` `1dc427e`, `-4` `62215c1`.

## Stream branches
M1 merged (do not delete): `m1/a1-packages` · `m1/a5a-fix-1` · `m1/a5b-fix-1` · `m1/a5c-fix-1` · `m1/a4-edge-delivery` · `m1/a4-fix-1` · `m1/a3a-jobs-v2` · `m1/a3a-fix-1` · `m1/a3a-fix-2` · `m1/a3b-jobs-authoring` · `m1/a3b-fix-1` · `m1/a2b-api-tests` · `m1/a2b-fix-1` · `m1/a2a-api-bank` · `m1/a2a-fix-1` · `m1/a2a-fix-1-r2` · `m1/a7-candidate` `b89e2ea` · `m1/a7-fix-1` `91d91be` · `m1/a5d-wizard` `2489db3` · `m1/a5d-fix-1` `07a21d9` · `m1/a5d-fix-2` `abe6064` · `m1/e2e-specs` `cf90491` · `m1/e2e-specs-fix-1` `57973f1` · `m1/a8-templates-rpc` `701df43` · `m1/a8-fix-1` `88557c1` · `m1/a9-bank-rpc` `a585f41` (all on `trace`). Unmerged by founder answer (b): `m1/a5a-fix-2/-3/-4` (zip reader, M8). **M2: no stream branch yet** (`m2/integration` only).

## Next step (one precise action list)
1. Verify first (below). If the port block is gone (`docker port supabase_db_trace` shows 54322): in `m2-integration`
   run `node scripts/db-types.mjs` (resets the DB), extend `packages/db-types/src/index.test.ts` with the four M2-c
   tables, commit `feat(db-types): …`, run `pnpm test:rls` (expect rls 4401, catalog 153; the reset clears the
   leftover org-conc row), delete `.claude/allow-red`, push, check CI on #16. If it is still blocked: keep using the
   docker runner for pgTAP and do step 2's non-DB items; the gate waits.
2. **Wave 0b remainder on `m2/integration`** (lead only, spec §11.2). Candidate contracts are DONE (`937da1b`; the
   portal RPCs are `PortalRpcSchemas`, merged into `CandidateRpcSchemas` by B2/B4 when they implement them). Left:
   wiring R5-9 (LOGIN_ROLES, HYPERDRIVE_PLAN + PENDING, staging-worker-secrets, check-deploy-vars,
   test-staging-roles-local, jobs wrangler/env/stage-db, cron `messaging_claim` with `withOrg(null)`, queue
   `trace-messages-<env>` + DLQ, `QUEUE_KINDS`); R5-27 secrets lists + D1 spec 4r row; R5-36 pii-crypto boundaries +
   module README; `KeyManager` in `VENDOR_INTERFACES`; R5-28 `e2e-m2-bulk` job + `e2e-local.mjs --test-scheduled`
   (tests first) + DC-M2-6; R5-37 route inventory ALLOWED entries; DC-M2-3…5 measured and recorded in spec §8; then
   the Wave 1 pre-flight agent. Full serial verify, CI green on #16.
3. **M1 CLOSE is founder-gated** (D1 CLOSE + go-ahead): then merge `main` into `m1/integration`, re-timestamp M1
   migrations, re-derive the seven replaced guards, full verify, `docs/milestones/M1-summary.md` §9, CLOSE PR, tag
   `m1-reviewed`. Do not start it before both gates.
4. Dependency bumps owed (M2 R5-33): vitest 4.1.12 + undici 7.30.1 (due since 2026-10-29); fast-uri 3.1.9 on/after
   2026-11-02; happy-dom 21.x before 2026-11-23; lead commits on `m1/integration`, then `chore: merge m1/integration`
   into `m2/integration`; delete the matching osv ignores (they expire 2026-11-05, -09, -23).
5. Staging-only checks need a founder-approved staging dispatch: M1 (A2b Low 2 R2 `onlyIf`, DC-M1-1/5/6 staging halves,
   AT-M1-10 on staging, largest from-template call under 8 s); M2 (AT-M2-12, DC-M2-1/2, DC-M2-3/5 staging halves).

## Decisions made this chat (lead, AUTOPILOT §4; M2-c header and build-notes 2026-10-30)
- (a) The messaging worker reads only its org keys directly; `private.message_send_context` (claim-bound) and
  `private.record_send_failure` replace §3.4's ciphertext SELECT and a direct UPDATE grant. (b) `rotate_link_for_send`
  and `record_send` take the claim id (R3-6). (c) The claim returns `reclaimed` and skips rows with 8 attempts.
  (d) The planner also fires on `invite_resend_no`. (e) A cancelled drive cancels planned messages. (f) Unmatched
  events keep the bounce kind. Not yet reviewed: the Wave 0 reviews come with the Wave 1 pre-flight (spec §11.4).

## Founder items
- **New (local machine):** free the reserved ports (`net stop winnat`, `net start winnat` in an admin terminal).
- Unchanged M1 items: coverage when tab focus is off (default a); D1 integrity job re-delivered after M1 (default a); M1-15 "shared-device" copy (default: leave out); import cancel keeps rows (default a); M1 staging Hyperdrive configs + secrets; Q-M1-1…Q-M1-4; OPEN-8a Workers Paid; written AI drafts; zip reader answered (b).
- M2 (rows on `m2/integration`'s `docs/progress/FOUNDER-QUEUE.md`): Q-M2-1…Q-M2-4; F-2…F-5 + the `jobs_messaging_login` Hyperdrive config.

## Gotchas
- Worktree guard: no `cd …&&`, `git -C`, `$(...)`, `xargs`, loops, compound or piped node-script commands; quoted-path executables and `powershell` are refused too (`docker desktop start` works); commit messages via `git commit -F <unique file>`; merges `chore: merge …`. Use EnterWorktree to switch worktrees.
- `node scripts/db-types.mjs` and `pnpm test:rls` RESET the local database: never while a writer or reviewer runs db-tests.
- M2 pgTAP: edit `docs/progress/m2-wave0-drafts/pgtap/{preamble.sql,bodies/*.sql}`, regenerate with `node docs/progress/m2-wave0-drafts/pgtap/gen.mjs . <names>` (or `run.mjs`, which also runs them through the CLI). In a body, never read a table and call a state-changing function in ONE statement (the statement snapshot hides the change), and compute ids as the operator before switching to a role that cannot read them.
- PG regex repetition counts stop at 255 (`{1,256}` is an error, raised only when the CHECK first runs).
- `invitations_guard` identifies callers only by `current_setting('role')`; never design a "trusted caller" GUC (R5-42).
- **RAM:** run the gate serially: `pnpm -r --workspace-concurrency=1 typecheck`, `pnpm lint`, `pnpm -r --workspace-concurrency=1 test`, `pnpm exec vitest run --root scripts --maxWorkers=1`, `pnpm test:rls`, `pnpm -r --workspace-concurrency=1 build`.
- e2e-local dispatch from an `m1/**` or `m2/**` branch runs no staging job.

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` · `git rev-parse --short trace/m2/integration` (`937da1b`) · `git status` (both worktrees) · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `pnpm -s verify:fast` · `docker ps` + `docker port supabase_db_trace` (54322 published?) · CI on PR #16 (rls expected red on db-types until step 1)
