# HANDOFF — 2026-10-24 10:00 IST (M1 BUILD 3 closed: A2a merged + mounted; BUILD 4 started: A7 built, reviews owed)
Reason for stopping: usage guard (Max account; 5-hour window 88% when the A7 writer returned; one Opus review ≈ 15%,
so no review was started). Start from `docs/progress/RESUME-PROMPT.md` §4 on **`m1/integration`** (worktree
`.claude/worktrees/m1-integration`). The repo wins over this file.

## Paused: D1 (founder, 2026-10-22 night: paused, not closed)
D1's remaining steps belong to a D1 chat on `d1/integration` (worktree `.claude/worktrees/d1-integration`). Nothing is committed to `d1/integration` or `main` from M1. Copied from the `d1/integration` HANDOFF (`3c2e42a`, tip `1547fd0`):
- **Next step 1.** Workers Paid answered (2026-10-22 21:20): "not yet"; OPEN-8a stays a founder gate and D1 can close without it. Remaining founder item: **AT-D2 capture**. For it: dispatch staging from `d1/integration` with `run_e2e=true` on the final tip (re-checks AT-D1/AT-D17 after `1d36151`), then the founder runs `pnpm e2e:record` (spec 4p §7.3) with an OS-level screen capture; record file name, SHA-256, `recordedMs`, run id.
- **Next step 2.** Then `docs/milestones/D1-summary.md`, tag the next free `cp/d1-*` number (after `cp/d1-11`, `cp/d1-10`) on the verified tip, and **D1 CLOSE by PR to `main`** only with the founder's go-ahead (AUTOPILOT §2, §6). At the merge the founder adds `e2e-local` back to ruleset 25633431's required checks.
- **Staging re-run already done on the final tip (reuse it):** dispatch **39820502191** on `1547fd0` (run_e2e=true, started before the pause, not touched by M1): all 7 jobs **success** (static, migrations, rls, security, e2e-local, deploy-staging, e2e-staging). Artifact `e2e-staging-results` manifest: spec `d1-slice`, project `staging`, sha `1547fd0…`, 55/55 steps ok, `durationMs` 304726, `recordedMs` 295068 (`record: false`), **AT-D17 `time_to_ready_ms`: A 46307, B 30833, C 69999, D 19441** (max 70.0 s: inside the 90 s gate; the 30 s target is still the M5-owned deviation). If `d1/integration` is still `1547fd0`, this is the "staging re-run on the final tip"; only the AT-D2 capture (record mode) remains.
- **D1 founder items:** AT-D2 screen capture (`pnpm e2e:record`); Workers Paid (OPEN-8a) "not yet", decide before any load test (M3a); Dependabot PRs #7-#12 not merged blind; after D1 merges, `e2e-local` back on the required checks.

## Where we are (verified this chat)
- Milestone **M1 · Test authoring**. BUILD 3 (Wave 2: A2a, A2b, A3a, A3b, A4) is **merged**; BUILD 4 (Wave 3) has
  started: A7 built, not yet reviewed. Spec `specs/m1-test-authoring.md` rev 5, rows up to **R5-66**.
- `m1/integration` tip = this handoff commit on top of **`c439617`** (all pushed). `trace/d1/integration` = `1547fd0`,
  `trace/main` = `da5380d`: unchanged.
- **Full serial verify green on `d973099`** (2026-10-24 09:35 IST: typecheck, lint, `pnpm -r --workspace-concurrency=1
  test`, `vitest --root scripts`, test:rls 49 files / rls 3784 / catalog 150, build). Floor raised to 3784 (`4ea5de5`).
  The first verify run was stopped by Claude Code for low system memory (not a code failure); the rerun passed.
- **Linux CI on PR #14 green on `d973099`** (run 40057846238: static, security, migrations, rls) and on `1cef9de`
  (run 40056456816). CI on `c439617` (spec + floor only) not checked.

## Done this chat (commits on m1/integration, all pushed)
- **CI security fixed:** zod 4.6.6 (GHSA-mrhx-c7xc-m3w5, one-day release-age exception, `b397a29`); dated osv ignores
  for new dev-tooling advisories undici, fast-uri, happy-dom (`2d91744`); build-notes rows for both.
- **A2a fix 9** (library key-review route) by an Opus writer: `m1/a2a-fix-1-r2` @ `55f7d2d` (api 633/633).
- **Opus confirming re-review** (spec, security, database) of A2a `08b27ce..55f7d2d` + M1-m, M1-n, sweep, M1-o: all
  **CONFIRMED WITH NOTES**, no rule 1-9 issue (recorded `c250f3d` in `docs/reviews/M1-wave2-first-reviews.md`).
- **Merged** `m1/a2a-fix-1-r2` → `ae19cbf`; **lead mounts** in `services/api/src/app.ts` (red `17de28f` → `d973099`):
  bank, pools, library, imports, ai-drafts; route inventory + log hygiene 57 org routes.
- **R5-65 / migration M1-o** `20261024030000_m1_publish_source.sql`: `public.publish_source_v2` (INVOKER; one call per
  package build). pgTAP `rls_m1_publish_source` 32 (red `0498fdc`, `a78da74`, `13f039f` → green `1cef9de`, `3bc1e11`,
  `556402c`); api switched (`99916c7` red → `f616d5d`). Measured locally: 5,001 members 72 ms, exposure read indexed.
- **R5-66** A7 lead decisions (`c439617`) from a Sonnet pre-flight.
- **A7 writer (Opus)**: `m1/a7-candidate` @ **`b89e2ea`** (red `6aca734`), pushed. Writer checks: candidate 290/290 (last
  full run 1 fail then fixed; only `candidate-guards.test.ts` re-run, 36/36), typecheck, lint, never-build 37/37, build;
  bundle 83.1 kB gzip of 150 kB.

## In flight at handoff
- **No agent is running.** `m1/a7-candidate` @ `b89e2ea` (base `c439617`), writer worktree
  `.claude/worktrees/agent-ae41a300bf165cf7c` (leave it). **Reviews not started.**
- A7 writer's lead ask: a 409 `out_of_order` gap path in `workers/edge/src/session-core.ts` that stored part of a batch
  does not report that part's `refusedSeqs`; suggested: optional `refusedSeqs` on `OutOfOrderBody`
  (`packages/shared/src/contracts-candidate.ts` ~:388) returned from the gap path (lead: contract + edge, test first).
- A7 writer's question (not rules 1-9, lead decides): the rules step says "each section shows its own paste rule", but a
  v1 (D1) session shows no section rules; proposal: v1 shows one line "pasting is turned off in this test" (D1 blocks
  paste). Writer choices to confirm in review: "Finish this section" only with >1 section; forward-only nav allows only
  the highest served and the next item; 409 retry ≤ 3 with `afterSeq` = acked seq after flush; attach backoff 1/2/4/8/10 s;
  signals between streams held for the new stream; `Test.tsx` 554 lines.

## Stream branches
Merged (do not delete): `m1/a1-packages` · `m1/a5a-fix-1` · `m1/a5b-fix-1` · `m1/a5c-fix-1` · `m1/a4-edge-delivery` · `m1/a4-fix-1` · `m1/a3a-jobs-v2` · `m1/a3a-fix-1` · `m1/a3a-fix-2` · `m1/a3b-jobs-authoring` · `m1/a3b-fix-1` · `m1/a2b-api-tests` · `m1/a2b-fix-1` · `m1/a2a-api-bank` `08b27ce` · `m1/a2a-fix-1` `c8c4f60` · `m1/a2a-fix-1-r2` `55f7d2d` (all on `trace`). Unmerged by founder answer (b): `m1/a5a-fix-2/-3/-4` (zip reader, M8). Open: **`m1/a7-candidate` `b89e2ea`** (reviews owed).

## Next step (one precise action list)
1. Verify first (below). Then **A7 Opus first reviews** per spec §11.3 (spec + security; one agent each, or one agent
   with a verdict per area), diff `c439617..b89e2ea`, told the writer's choices and question above and R5-66.
2. Lead, test first: the `OutOfOrderBody.refusedSeqs` contract + edge gap path (above); decide the v1 rules line.
3. A7 fix round (Opus writer, fixes test first, branch `m1/a7-fix-1` from `b89e2ea`), one confirming re-review, merge
   into `m1/integration` (`chore: merge …`), full serial verify, Linux CI on PR #14.
4. Then BUILD 4 rest: `e2e/tests/m1-*.spec.ts` (AT-M1-01, 10, 30; lead + Sonnet, `local` project), the AT-M1-10
   500-item measurement on Linux CI recorded in spec §8, AT-M1-28 D1 E2E.
5. **Lead, owed before the M1 exit:** R5-63 f rest (atomic `create_test_from_template`, `save_bank_draft` RPC — also
   re-review Low 4, paste rule in the database, template paging); R5-64 g (revoke `id` INSERT grants after a pgTAP
   fixture rewrite); R5-61 h (indexed duplicate hash, jobs `SUPABASE_URL` staging half, drafting lease); R5-62 b (jobs
   db-test, "more than one account" branch); A2b Low 2 staging R2 `onlyIf` check (needs a founder-approved dispatch).
6. Dependency bumps owed (build-notes 2026-10-24): vitest 4.1.12 + undici 7.30.1 on/after 2026-10-29; fast-uri 3.1.9
   on/after 2026-11-02; happy-dom 21.x before 2026-11-23; then delete the matching osv ignores.

## Notes for Wave 3 (carried; not defects now)
- A5c N1 (`fromDraftView(view, integrity)` + `onSaved` → `setPasteWritten` → re-save, recruiter app, lead); A5a S7.
- R2-5 gap: re-copying a retired library copy hands back the retired copy. DC-M1-4 — OPEN-8a founder gate.
  `ratelimits` on staging (edge and api) confirmed only by a staging dispatch (ADR-032).
- New jobs cron path: `authoring_sweep` needs `JOBS_AUTHORING_DB` (staging Hyperdrive) — listed under the M1 staging
  founder item. Re-review notes kept open: D11 (reviewers see `exposureCount` 0), D12 (lost insert response leaves a
  key-less draft), fakes not modelling `variant_key_missing`/`variants_numbering`/approver workspace.

## Founder items
- Unchanged: coverage when tab focus is off (default a); D1 integrity job re-delivered after M1 (default a); M1-15 "shared-device" copy (default: leave out); import cancel keeps rows (default a); M1 staging Hyperdrive configs + secrets (+ jobs `SUPABASE_URL`, + api `MEMBER_INVITE_PEPPER` ≥ 32 bytes); Q-M1-1…Q-M1-4; OPEN-8a Workers Paid; written AI drafts; zip reader answered (b).
- New (information only): zod bumped one day before the two-week release-age rule for a High advisory (build-notes 2026-10-24).

## Gotchas
- Worktree guard: no `cd …&&`, `git -C`, `$(...)`, loops, compound or piped node-script commands, no heredocs appending to repo files; write scripts with the Write tool and run them plainly; commit messages via `git commit -F <unique file>`; merges `chore: merge …`. A refused compound command runs NOTHING.
- `node scripts/db-types.mjs` and `pnpm test:rls` RESET the local database: never while a writer runs db-tests. `pnpm exec supabase migration up --local` applies a new migration without a reset; an edited, already-applied migration needs a drop + `psql -f` of the file locally.
- A function body's comments are in `pg_get_functiondef` (a pgTAP text pin on the body sees them).
- RAM: never run workspace tests while writers run; Claude Code may stop a long background verify when memory is short (rerun it; it is not a code failure).
- Never hand-edit generated `rls_m1_*.test.sql`: edit `docs/progress/m1-wave0-drafts/pgtap/bodies/*.sql`/`preamble.sql`, run `node docs/progress/m1-wave0-drafts/pgtap/gen.mjs . <name>`, run named files with `node docs/progress/m1-wave0-drafts/pgtap/run.mjs <names>`.

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` · `git status` · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `git rev-parse --short trace/m1/a7-candidate` (`b89e2ea`) · `gh run list --repo TraceHiring/TraceHiring --branch m1/integration --limit 3` · `pnpm -s verify:fast` · `docker ps` (supabase_db_trace up)
