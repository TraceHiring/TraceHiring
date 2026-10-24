# HANDOFF — 2026-10-24 08:15 IST (M1 BUILD 3 = Wave 2 part 6: A2a spec review, lead M1-m + M1-n + jobs sweep, A2a fix round 1)
Reason for stopping: the founder asked to wrap up now and continue on another Claude Code account (Max account here;
5-hour window ~79% at the stop). Start from `docs/progress/RESUME-PROMPT.md` §4 on **`m1/integration`** (worktree
`.claude/worktrees/m1-integration`). The repo wins over this file.

## Paused: D1 (founder, 2026-10-22 night: paused, not closed)
D1's remaining steps belong to a D1 chat on `d1/integration` (worktree `.claude/worktrees/d1-integration`). Nothing is committed to `d1/integration` or `main` from M1. Copied from the `d1/integration` HANDOFF (`3c2e42a`, tip `1547fd0`):
- **Next step 1.** Workers Paid answered (2026-10-22 21:20): "not yet"; OPEN-8a stays a founder gate and D1 can close without it. Remaining founder item: **AT-D2 capture**. For it: dispatch staging from `d1/integration` with `run_e2e=true` on the final tip (re-checks AT-D1/AT-D17 after `1d36151`), then the founder runs `pnpm e2e:record` (spec 4p §7.3) with an OS-level screen capture; record file name, SHA-256, `recordedMs`, run id.
- **Next step 2.** Then `docs/milestones/D1-summary.md`, tag the next free `cp/d1-*` number (after `cp/d1-11`, `cp/d1-10`) on the verified tip, and **D1 CLOSE by PR to `main`** only with the founder's go-ahead (AUTOPILOT §2, §6). At the merge the founder adds `e2e-local` back to ruleset 25633431's required checks.
- **Staging re-run already done on the final tip (reuse it):** dispatch **39820502191** on `1547fd0` (run_e2e=true, started before the pause, not touched by M1): all 7 jobs **success** (static, migrations, rls, security, e2e-local, deploy-staging, e2e-staging). Artifact `e2e-staging-results` manifest: spec `d1-slice`, project `staging`, sha `1547fd0…`, 55/55 steps ok, `durationMs` 304726, `recordedMs` 295068 (`record: false`), **AT-D17 `time_to_ready_ms`: A 46307, B 30833, C 69999, D 19441** (max 70.0 s: inside the 90 s gate; the 30 s target is still the M5-owned deviation). If `d1/integration` is still `1547fd0`, this is the "staging re-run on the final tip"; only the AT-D2 capture (record mode) remains.
- **D1 founder items:** AT-D2 screen capture (`pnpm e2e:record`); Workers Paid (OPEN-8a) "not yet", decide before any load test (M3a); Dependabot PRs #7-#12 not merged blind; after D1 merges, `e2e-local` back on the required checks.

## Where we are (verified this chat)
- Milestone **M1 · Test authoring**, phase **BUILD 3 = Wave 2**. Spec `specs/m1-test-authoring.md` rev 5, rows up to
  **R5-64 (n)**. Reviews: `docs/reviews/M1-wave2-first-reviews.md` (A2a: all three first reviews now recorded).
- `m1/integration` tip = this handoff commit on top of **`dbf1d9f`** (last code commit `134ca37`; all pushed).
  `trace/d1/integration` = `1547fd0`, `trace/main` = `da5380d`: unchanged. `pnpm -s verify:fast` **exit 0** on the
  final tree (2026-10-24 08:05 IST, 236 s). Linux CI on PR #14: **security job RED** on the last pushes (runs 40008956066, 40009211471; static, rls,
  migrations green), see In flight 0.
- The last **full serial verify** is still the one on `4fca331` (rls 3716). Since then: lead code `0eb91ac`, `35925e0`
  and this chat's commits below; each was checked by its own package tests / named pgTAP files only (no full verify yet).

## Done this chat (commits on m1/integration, all pushed)
- **A2a Opus spec first review: PASS WITH FIXES** (Medium: library items can never be approved through the api, no
  key-review route; Lows: import variant seeds, `library: null` stats, `MAX_MEMBERS` pool cap, two hollow assertions;
  Note: org-context.ts edit). Recorded in the review report; decisions in spec row **R5-64 (a)-(n)**.
- **Migration M1-m** `20261024010000_m1_bank_fixes.sql` (red `7323091` → green `09bb62b`): D1 key must name a current
  option (`item_version_ready`), D4 `item_versions_one_open_per_item`, D7 `item_versions_bank_page_idx`, D2 view
  `v_pool_item_counts` (security_invoker, select for authenticated), D6 `images_ok` counted by the import guard
  (update grant revoked). New pgTAP `rls_m1_bank_fixes` (23); `rls_m1_imports` D6 cases; `rls_m1_bank` v2 insert moved
  after v1 retires; candidate-denied list + db-types regenerated (view list test).
- **`KeyReviewItemRequest`** contract + test, spec R5-64, review record: `4d8504d`.
- **Migration M1-n** `20261024020000_m1_draft_sweep.sql` (red `76131db` → green `d510bd6`):
  `private.fail_stranded_ai_draft_jobs(limit)` (DEFINER, EXECUTE trace_authoring_worker only; queued > 15 min →
  `failed`/`timeout`). pgTAP `rls_m1_draft_sweep` (12); `rls_roles` and candidate-denied pins.
- **Jobs cron** (red `668f452` → green `134ca37`): `workers/jobs/src/drafting/sweep.ts`, stage `authoring_sweep` in
  `queue/stage-db.ts`, `scheduled()` runs both sweeps (`queue/handlers.ts`), wired in `index.ts`.
- Named pgTAP runs green after M1-m/M1-n: all 15 `rls_m1_*` + `rls_m1_draft_sweep` + `rls_roles` (after the db-types
  reset; a stray committed `import.cancel` audit row in the local DB had broken one imports assertion before it).

## In flight at handoff (check first, trust nothing)
0. **CI security job fails on a NEW advisory, not on M1 code:** `osv-scanner` reports GHSA-mrhx-c7xc-m3w5 (High, CVSS
   8.2) on `zod` 4.4.3 and 4.6.5 in `pnpm-lock.yaml` (and 4.4.3 in `docs/spikes/d1-day-one/package-lock.json`); fixed in
   **4.6.6**. Also: `osv-scanner.toml` has an unused ignore GHSA-vfj7-8cjw-p6xm. Fix first (AUTOPILOT §6: Linux CI before
   other work): read the advisory and the repo's dependency release-age rule (see the vitest ignore reasons in
   `osv-scanner.toml`); if 4.6.6 passes the rule, bump zod in the catalog / lockfile (lead-only: root package.json,
   `pnpm-workspace.yaml` catalog, lockfile) and run the full verify; if not, add a dated, justified ignore exactly like the
   vitest ones (with the bump date) only if the advisory does not reach Trace's use of zod — otherwise FOUNDER-QUEUE.
   Remove the unused ignore. Never merge Dependabot PRs #7-#12 blind.
- **No agent is running.** A2a fix round 1 STOPPED on the lead's order, partly done, tree clean, pushed:
  **`m1/a2a-fix-1` @ `c8c4f60`** on `trace` (base `08b27ce`, merge of `4d8504d` = `03e3a73`, no conflicts). Writer worktree
  `.claude/worktrees/agent-a39cb2868e44c854a` (leave it). Only file outside the five A2a module dirs:
  `services/api/src/modules/tests/org-context.ts` (sanctioned, R5-64 l).
- **Done** (red → green): fix 1 S1 `pathId` lower-case + D5/Note 6 guard texts incl. the library review texts and
  `invite_settled` (`43c9c06` → `d354d4d`); fix 2 S2 message parsed before the job insert, 400 `bad_request`
  (`53aa94c` → `2102995`); spec Low 5 real assertions (`53aa94c`, `10c283e`); fixes 3/4/10 D1 api half, D4 409,
  D8 no clone of a `not_approved` AI draft (`10c283e` → `dde49ad`); fix 6 D6 no `images_ok` (`9eb279e` → `d5624ff`);
  fix 7 D2 `v_pool_item_counts`, no `MAX_MEMBERS` (`6d1dbd7` → `109b946`); fix 8 D3 inner embed (`774c981` → `c8c4f60`).
  Writer checks: touched module suites green (bank 62, five modules 105, modules/tests 172, ai-drafts 7, guard-keys,
  imports, members); api typecheck + lint clean.
- **NOT done:** fix 9 = the library key-review route `POST /v1/orgs/:orgId/bank/item-versions/:versionId/key-review`
  (R5-64 h; contract `KeyReviewItemRequest` exists; its guard texts are already mapped; add it to `A2A_NEW_ROUTES`);
  the whole `@trace/api` vitest run once; a test that targets each new fixture fake (embed, view, images_ok,
  open-version index) by itself.
- Writer choices to confirm in the re-review: a stale key in a PUT is a 400 (contract); a failed key write after the
  content write removes the key (best effort), so submit answers 422 until a PUT stores it; guard codes
  `library_reviewers` / `key_review_own_update` / `library_expert_review` → 409, `key_reviewer_member` /
  `key_reviewer_self` → 403, `pool_item_ineligible` → 409, `invite_settled` → 409. Lead ask: check the D3 embed
  against real PostgREST in E2E.

## Stream branches
Merged (do not delete): `m1/a1-packages` · `m1/a5a-fix-1` · `m1/a5b-fix-1` · `m1/a5c-fix-1` · `m1/a4-edge-delivery` `7f2fb9c` · `m1/a4-fix-1` `a0c1d46` · `m1/a3a-jobs-v2` `74d9891` · `m1/a3a-fix-1` `402a3ac` · `m1/a3a-fix-2` `8af7845` · `m1/a3b-jobs-authoring` `2b706d0` · `m1/a3b-fix-1` `1866c92` · `m1/a2b-api-tests` `8f7b52c` · `m1/a2b-fix-1` `5c2a892` (all on `trace`). Unmerged by founder answer (b): `m1/a5a-fix-2/-3/-4` (zip reader, M8). Open: **`m1/a2a-api-bank` `08b27ce`** (reviews 3/3 done) and **`m1/a2a-fix-1` `c8c4f60`** (fix round 1, 8 of 9 items; see In flight).

## Next step (one precise action list)
1. Verify first (below). Fix the CI security job (In flight 0). Then **finish A2a fix round 1** with one Opus fix writer (Agent isolation "worktree") on
   `m1/a2a-fix-1` from `c8c4f60` (common brief `docs/progress/m1-writer-brief-common.md`, but NO reset: the writer runs
   `git switch -c m1/a2a-fix-1 trace/m1/a2a-fix-1` and confirms the tip is `c8c4f60`): fix 9, the key-review route per
   R5-64 h (tests first: a library member approves after another member's key review; a customer org → 409; the author
   as key reviewer → the mapped 403/409); then the whole api vitest once, typecheck, lint; push each green commit.
2. **One Opus confirming re-review** of `08b27ce..<m1/a2a-fix-1 tip>` (spec + security + database in one agent, a
   verdict per area; the M1-m/M1-n migrations and the jobs sweep `4d3cb7f..134ca37` in the same review, database area).
3. **Merge** `m1/a2a-fix-1` into `m1/integration` (`chore: merge …`) with the lead mounts in `services/api/src/app.ts`:
   `createBankRoutes({ org, variants: () => itemVariantsEngine })`, `createPoolsRoutes({ org })`,
   `createLibraryRoutes({ org, source: libraryFromEnv, limiter: libraryLimiterFromEnv })`,
   `createImportsRoutes({ org, media: itemMediaFromEnv, variants: () => itemVariantsEngine })`,
   `createAiDraftsRoutes({ org, queue: authoringQueueFromEnv })`, with
   `const itemVariantsEngine = { check: (s: unknown) => validateParamSpec(s).ok, generate: generateVariants }`; the
   A2a routes (`A2A_NEW_ROUTES` in `services/api/src/modules/bank/m1-a2a-routes-mount.test.ts`, 25 + key-review = 26)
   in `route-inventory.test.ts` and `log-hygiene.test.ts` (31 → 57 org routes). Red test first for the mounts.
4. Full serial `pnpm verify` (`pnpm -r --workspace-concurrency=1 test` + `vitest run --root scripts`; raise
   `supabase/tests/rls-min-count`, now 3716, to the new count) and Linux CI on PR #14 (TraceHiring/TraceHiring#14).
5. **Lead, owed before the M1 exit:** R5-63 f (publish-read SQL function, atomic `create_test_from_template`,
   `save_bank_draft` RPC, paste rule in the database, template paging); R5-64 g (revoke `id` INSERT grants after a pgTAP
   fixture rewrite); R5-61 h (indexed duplicate hash, jobs `SUPABASE_URL` staging half, drafting lease); R5-62 b (jobs
   db-test, "more than one account" branch); A2b Low 2 staging R2 `onlyIf` check (needs a founder-approved dispatch).
6. Then BUILD 4 = Wave 3 (A7, E2E, measurement) per spec §11.4. DC-M1-2 still to run.

## Notes for Wave 2/3 (carried; not defects now)
- A7 (Wave 3): sends `afterSeq` on every v2 GET (R5-59 d); copy warns that finishing an untimed section is final (R5-59 e).
- A5c N1 (`fromDraftView(view, integrity)` + `onSaved` → `setPasteWritten` → re-save, recruiter app, lead); A5a S7.
- R2-5 gap: re-copying a retired library copy hands back the retired copy. DC-M1-4 — OPEN-8a founder gate.
  `ratelimits` on staging (edge and api) confirmed only by a staging dispatch (ADR-032).
- New jobs cron path: `authoring_sweep` needs `JOBS_AUTHORING_DB` (staging Hyperdrive) — already listed under the M1
  staging founder item.

## Founder items
- Unchanged: coverage when tab focus is off (default a); D1 integrity job re-delivered after M1 (default a); M1-15 "shared-device" copy (default: leave out); import cancel keeps rows (default a); M1 staging Hyperdrive configs + secrets (+ jobs `SUPABASE_URL`, + api `MEMBER_INVITE_PEPPER` ≥ 32 bytes); Q-M1-1…Q-M1-4; OPEN-8a Workers Paid; written AI drafts; zip reader answered (b).

## Gotchas
- Worktree guard: no `cd …&&`, `git -C`, `$(...)`, loops, compound or piped node-script commands; write scripts with the Write tool and run them plainly; commit messages via `git commit -F <unique file>`; merges `chore: merge …`. A refused compound command runs NOTHING.
- `node scripts/db-types.mjs` and `pnpm test:rls` RESET the local database: never while a writer runs db-tests. `pnpm exec supabase migration up --local` applies a new migration without a reset.
- Named pgTAP runs on a non-reset local DB can trip over rows committed by earlier e2e/db-tests (2026-10-24: a stray `import.cancel` audit row); reset (db-types or test:rls) before trusting a failure there.
- D1 pgTAP pins (`rls_d1_*`) change only via an R5-28/R5-50 supersession row and only add-only; a new grant that loosens one needs another design (M1-l).
- RAM: never run workspace tests while writers run; writers run only their own package tests.
- Never hand-edit generated `rls_m1_*.test.sql`: edit `docs/progress/m1-wave0-drafts/pgtap/bodies/*.sql`/`preamble.sql`, run `node docs/progress/m1-wave0-drafts/pgtap/gen.mjs .`, run named files with `node docs/progress/m1-wave0-drafts/pgtap/run.mjs <names>`.

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` · `git status` · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `git branch -a -v --list '*a2a*'` · `gh run list --repo TraceHiring/TraceHiring --branch m1/integration --limit 3` · `pnpm -s verify:fast` · `docker ps` (supabase_db_trace up)
