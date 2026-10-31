# HANDOFF — 2026-10-31 18:10 IST (M2 BUILD 1 = Wave 0 DONE on m2/integration; next: BUILD 2 = Wave 1)
Reason for stopping: the chat's task is done (HANDOFF Next step 1 + the Wave 0b remainder) and context is ~56%
(CLAUDE.md: hand off near 60%). 5-hour window ~5% at stop (it reset at 17:30 IST). Max account.
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
  commit on **`208e5ae`** (dependency advisory fix). CI on draft PR TraceHiring/TraceHiring#14 head `208e5ae`: static,
  rls, security, migrations **pass**.
- **M2 · Scheduling & invites: BUILD 1 = Wave 0 DONE.** `m2/integration` tip **`fa0e7cf`** on trace. Draft CI PR
  **TraceHiring/TraceHiring#16** (`m2/integration → main`, **never merge**): head `fa0e7cf` (run 41201435037) static,
  rls, security, migrations **pass**; `e2e-m2-bulk` skipped (dispatch-only, as designed).
- **Local port block is gone:** `docker port supabase_db_trace` → 54322 at chat start (Docker up, stack healthy).
- Verify-first at chat start matched (m1 `7640e60`, m2 `937da1b`, d1 `1547fd0`, main `da5380d`, clean, verify:fast 0).

## Done this chat
| Branch | Commit | What |
| --- | --- | --- |
| m2 | `498e35d` | db-types regenerated for M2-c (4 tables), pin test first; test:rls 62 files, rls 4401, catalog 153; `.claude/allow-red` removed |
| m1 | `208e5ae` | fix(deps): vitest 4.1.12 + undici override 7.30.1 (workspace and `docs/spikes/d1-day-one` lockfile; spike osv file deleted), happy-dom 20.14.6; new dated ignores happy-dom GHSA-c8p4 (→11-23) and minimatch GHSA-g3hv (→11-30); full serial gate green on m1 |
| m2 | `aa67269` | `chore: merge m1/integration` (deps) |
| m2 | `69b58fb` | R5-9 wiring: `jobs_messaging_login` (LOGIN_ROLES, HYPERDRIVE_PLAN 7/10 + PENDING, retired twin), queue `trace-messages-<env>` + DLQ (batch 10, retries 7), `QUEUE_KINDS`, STAGE_DB `messaging` / `messaging_claim` (`withOrg(null)` list), optional `messagesClaim`, `workers/jobs/src/messaging/stub.ts`, worker types regenerated |
| m2 | `ddfa1d8` | R5-27 allow-list: api+jobs `AWS_WORKERS_ACCESS_KEY_ID`, `AWS_WORKERS_SECRET_ACCESS_KEY`, `SES_TEST_RECIPIENT_HMAC_KEY`; jobs `JOBS_SMOKE_TOKEN`; D1 spec revision 4r |
| m2 | `9b1ae14` | R5-36 eslint element `pii-crypto` (→shared only; api, jobs import it) + api modules README; R5-22 `KeyManager` in VENDOR_INTERFACES |
| m2 | `ae94348` | R5-37 route guard pin (SES webhook passes, `…/confirm` fails); build-notes row "Wave 0b part 2" (lead decisions a–e) |
| m2 | `ac1ebec` | R5-28 dispatch-only `e2e-m2-bulk` job (input `run_m2_bulk`, 40 min) + `e2e-local.mjs --test-scheduled`; **DC-M2-6** recorded (spec §8) |
| m2 | `fa0e7cf` | **DC-M2-4** live scenario "two messaging claims at once" (OK); DC-M2-3/5 moved to Waves 1/2 (build-notes); `docs/progress/m2-wave1-preflight.md` |

Full serial gate on `fa0e7cf`'s tree: typecheck 0, lint 0, unit tests green (edge 29/469 and candidate 21/312 hit
"Timeout starting pool runner" in the long serial run and passed re-run alone; the machine stalled ~2 h once),
scripts 2871+ green (two files re-run alone after a worker-start timeout), test:rls OK, build 0.

## In flight at handoff
- **No agent is running.** No uncommitted work in `m1-integration` or `m2-integration`. No `.claude/allow-red`.
- Unmerged CI-only branches (do not merge): `m1/e2e-specs-2` `b54091e`, `-3` `1dc427e`, `-4` `62215c1`.

## Stream branches
M1 merged (do not delete): `m1/a1-packages` · `m1/a5a-fix-1` · `m1/a5b-fix-1` · `m1/a5c-fix-1` · `m1/a4-edge-delivery` · `m1/a4-fix-1` · `m1/a3a-jobs-v2` · `m1/a3a-fix-1` · `m1/a3a-fix-2` · `m1/a3b-jobs-authoring` · `m1/a3b-fix-1` · `m1/a2b-api-tests` · `m1/a2b-fix-1` · `m1/a2a-api-bank` · `m1/a2a-fix-1` · `m1/a2a-fix-1-r2` · `m1/a7-candidate` `b89e2ea` · `m1/a7-fix-1` `91d91be` · `m1/a5d-wizard` `2489db3` · `m1/a5d-fix-1` `07a21d9` · `m1/a5d-fix-2` `abe6064` · `m1/e2e-specs` `cf90491` · `m1/e2e-specs-fix-1` `57973f1` · `m1/a8-templates-rpc` `701df43` · `m1/a8-fix-1` `88557c1` · `m1/a9-bank-rpc` `a585f41` (all on `trace`). Unmerged by founder answer (b): `m1/a5a-fix-2/-3/-4` (zip reader, M8). **M2: no stream branch yet.**

## Next step (one precise action list)
1. Verify first (below). `pnpm -s verify:fast` (parallel) failed twice at 18:10 on m1 with different flakes: under
   load, timing-sensitive tests (candidate `TestV2` clock, recruiter import 19 s tests; green in the serial gate), and
   once `scripts/test/gitleaks-config.test.mjs` "finds an api_key value starting with true" (its value is random,
   `scripts/test/fixtures/gitleaks-config.mjs:84`; green on two re-runs). Re-run before judging; a small follow-up
   is to make that value deterministic.
2. **M2 BUILD 2 = Wave 1, lead part first** (spec §11.4), from `docs/progress/m2-wave1-preflight.md`, tests first,
   on `m2/integration`: take each "decide" item (record in build-notes): blind-index key type vs
   `hmacSha256Hex`; pii-crypto takes keys as parameters; `HMAC_KEY` text vs `check-boundaries` (exemption or option
   name); Messaging v2 vs D1 callers (keep D1 exports beside v2 until B2); `email_hint` CHECK vs `_`/`-`/`.`; B4
   test-helper ownership. Then add: `packages/pii-crypto` skeleton (item-variants layout) + root tsconfig ref + api/jobs
   deps; `aws4fetch` **1.0.20** (registry: 2024-08-28, MIT, no deps) in the catalog + `packages/vendors`; wrangler
   vars + Env types (`MESSAGING_EMAIL_PROVIDER` api+jobs, `SES_ALLOWED_TEST_RECIPIENT_HMAC` api+jobs, SNS topic ARN api
   (name it; F-4), AWS/SES/smoke secrets in the Env types); edge `mountPortalRoutes` + `routes-portal.ts` stub; wire
   schemas for the manage-OTP verify response and `POST /v1/portal/reschedule`; **the recruiter drive API surface**
   (blocker for B5: drive list/transitions, slots list, upload create/complete/cancel, paged invitations, revoke-all,
   move-to-slot) as `contracts-m2.ts` schemas + `apps/recruiter/src/api/endpoints.ts` + routes/nav + their pins.
3. Then writers B1 (Opus), B4 (Opus), B5 (Sonnet writer, Opus review) with the common brief adapted to m2
   (`docs/progress/m1-writer-brief-common.md`), each in its own worktree reset to an exact `m2/integration` SHA;
   Opus first reviews (spec, security; database where SQL), fixes test first, confirming re-review, merge, test:rls,
   full serial verify, CI on #16. DC-M2-5 with B1's real code.
4. **M1 CLOSE is founder-gated** (D1 CLOSE + go-ahead): then merge `main` into `m1/integration`, re-timestamp M1
   migrations, re-derive the seven replaced guards, full verify, `docs/milestones/M1-summary.md` §9, CLOSE PR, tag
   `m1-reviewed`. Do not start it before both gates.
5. Dependency bumps still owed: fast-uri override 3.1.9 on/after 2026-11-02 (osv ignores expire 11-09); happy-dom
   21.0.4 from 2026-11-03 (ignores GHSA-834v, GHSA-c8p4 expire 11-23); minimatch GHSA-g3hv re-check by 11-30. Lead
   commits on `m1/integration`, then `chore: merge m1/integration` into `m2/integration`.
6. Staging-only checks need a founder-approved staging dispatch: M1 (A2b Low 2 R2 `onlyIf`, DC-M1-1/5/6 staging halves,
   AT-M1-10 on staging, largest from-template call under 8 s); M2 (AT-M2-12, DC-M2-1/2, DC-M2-3/5 staging halves).

## Decisions made this chat (lead, AUTOPILOT §4; build-notes rows 2026-10-31)
- Deps: bump owed versions now; dated ignores for fixes only in a new major (happy-dom 21, minimatch 11).
- R5-9: consumer batch 10; stub consumer until B3; `messagesClaim` unset until B3; cross-org stage list constant.
- R5-27: smoke secret `JOBS_SMOKE_TOKEN`; AWS pair names from F-2; wrangler vars deferred to the Wave 1 lead part.
- R5-22/36/37: KeyManager exports at B1's merge; pii-crypto edges; api ALLOWED entries at B2's merge, edge
  route-inventory test is B4's.
- DC-M2-4 as a permanent concurrency scenario; DC-M2-3/5 measured with B3/B1's real code.

## Founder items
- No new blocking item. The Windows port block resolved itself (no admin action needed now).
- Unchanged M1 items: coverage when tab focus is off (default a); D1 integrity job re-delivered after M1 (default a); M1-15 "shared-device" copy (default: leave out); import cancel keeps rows (default a); M1 staging Hyperdrive configs + secrets; Q-M1-1…Q-M1-4; OPEN-8a Workers Paid; written AI drafts; zip reader answered (b).
- M2 (rows on `m2/integration`'s `docs/progress/FOUNDER-QUEUE.md`): Q-M2-1…Q-M2-4; F-2…F-5 + the `jobs_messaging_login` Hyperdrive config.

## Gotchas
- Worktree guard: no `cd …&&`, `git -C`, `$(...)`, loops, compound or piped git commands, no `powershell`; commit messages via `git commit -F <unique file>` (body lines ≤ 100 chars); merges `chore: merge …`. Use EnterWorktree to switch worktrees. Multi-line edits: a node replace script with a JSON spec file avoids shell quoting.
- `node scripts/db-types.mjs` and `pnpm test:rls` RESET the local database: never while a writer or reviewer runs db-tests.
- **Slow machine:** long serial runs hit vitest "Timeout starting pool runner"; re-run that package alone (`pnpm --filter <pkg> test`) or resume with `pnpm -r --workspace-concurrency=1 --resume-from <pkg> test`. `pnpm lint` can exceed 10 min: run it in the background.
- wrangler dev experiments: a short `--persist-to` path (long paths give SQLITE_CANTOPEN); stopping the task leaves workerd/node children — kill the tree (`taskkill //PID <pid> //T //F`) after checking the image name.
- M2 pgTAP: edit `docs/progress/m2-wave0-drafts/pgtap/{preamble.sql,bodies/*.sql}`, regenerate with `node docs/progress/m2-wave0-drafts/pgtap/gen.mjs . <names>`; never read a table and call a state-changing function in one statement.
- **RAM:** gate serially: `pnpm -r --workspace-concurrency=1 typecheck`, `pnpm lint`, `pnpm -r --workspace-concurrency=1 test`, `pnpm exec vitest run --root scripts --maxWorkers=1`, `pnpm test:rls`, `pnpm -r --workspace-concurrency=1 build`.

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` · `git rev-parse --short trace/m2/integration` (`fa0e7cf`) · `git status` (both worktrees) · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `pnpm -s verify:fast` · `docker port supabase_db_trace` (54322) · CI on #16 (`fa0e7cf`) and #14 (`208e5ae`)
