# HANDOFF — 2026-10-19 ~00:45 IST (end of Chat B)
Reason for stopping: **Chat B's task is done** (C1b merged, verified, tagged `cp/d1-07`). Claude Max: one chat = one big task (`docs/progress/SESSION-PLAN.md`; AUTOPILOT §6 first bullet). Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt). The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (no `m*-reviewed` tag, `main` still `fe77a87`). M0a and M0b are built, reviewed and fixed but **not CLOSED** (founder gates, "Path to close" unchanged).
- **D1 ≈ 80%**: Wave 0 (`cp/d1-03`), R1 (`cp/d1-04`), R3 (`cp/d1-05`), C1a (`cp/d1-06`), **C1b merged (`cp/d1-07`)**. Left: Wave 2 (R2 jobs + R4 recruiter app, Chat C; C2 candidate app, Chat D), staging (Chat E), D1 REVIEW (F), FIX + CLOSE (G).
- **Current phase: D1 BUILD, Wave 1 done → Wave 2 next.** Path to close M0a/M0b unchanged (founder widens the Cloudflare token with R2 + Queues Edit, key script, `staging` vars per `scripts/ops/README.md`; dispatch, smoke, re-review, summaries, `--no-ff` into `main` only with the founder's go-ahead).

## Where we are (verified this chat)
- **`d1/integration`** = `8a4873a` (merge of `d1/c1b-session` @ `3490a6a`, `--no-ff`) + this handoff. **Full `pnpm verify` exit 0 on `8a4873a`** (counts in the LOG row). **CI on PR #4 green on `8a4873a`** (static, rls, security, migrations, e2e-local). **Tag `cp/d1-07` → `8a4873a`** (pushed).
- C1b stream `d1/c1b-session` @ `3490a6a` (merged; worktree `.claude/worktrees/agent-a5af1e6c4e791ea3b`, clean): writer `3bf142f..ea59b0a`; merge of integration `99829b8`; reviews + spec 4e `2dffb66`; three Opus fix writers placed with `--no-ff` (W1 `4ff20fa`, `31fdd84`, `2287c0c`, `d488b65`; W2 `df24dae`, `af43006`, `e2a5657`, `8d00508`; W3 `8c953a8`, `56acbd1`, `e4fffa7`); fix record `67d9d1f`; lead fix `7041b14`; re-review record `3490a6a`. Writer branches `worktree-agent-a9cb0ceaf40bef2a9`, `worktree-agent-a38797ba171f6fcad`, `worktree-agent-a144a23a76291de02` (merged, keep).
- Reviews (`docs/reviews/D1-review-c1b.md`): spec **PASS WITH FIXES**, security **PASS WITH NOTES** (3 Medium, all fixed), Sonnet confirming re-review **CONFIRMED WITH NOTES** (note 1 fixed `7041b14`, 2-3 accepted, 4 carried).
- New test infrastructure: vitest projects `edge`/`edge-do` (`workers/edge/vitest.config.ts`) and `api`/`api-do` (`services/api/vitest.config.ts`) bind the real `SessionDO`, `InviteOtpDO`, `DemoOutboxDO`, `MediaLinkDO` through miniflare options only (no wrangler change, nothing deployable); `*.real.test.ts` run there; `no-error-reporter.test.ts` pins each pool's exact binding set. `fast-check` is a devDependency of `workers/edge` (AT-D25).
- Edge after C1b: 22 files / 385 tests; api 33 / 379.
- Unchanged: `main` `fe77a87`, `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`; tags `cp/d1-01..06`.

## Next chat: **Chat C — Wave 2a: R2 jobs ∥ R4 recruiter app**. Done when `cp/d1-08` is pushed.
## Next step (in order)
1. Verify (below). If anything differs from this file, stop and report.
2. Read spec `specs/d1-demo-slice.md` §5 (R2: mirror pipeline, quality, integrity, sweep in `workers/jobs`) and §6 (R4: `apps/recruiter`), §11 streams; r3a #3 `toDetail` half-written draft is due before R4.
3. Two writers in parallel, each in its own worktree reset to the `d1/integration` tip with strict directories: **R2** (Opus; `workers/jobs/src/{mirror,quality,integrity,sweep}/**`, tests first: AT-D3, D5, D6, D14-D16, D27 incl. `mirror/pipeline.test.ts` and `sweep/sweep.test.ts`, the AT-D16 two-stream case, m2 n-7 two-connection mirror test; replaces the placeholder stages in `workers/jobs/src/queue/**`) and **R4** (Sonnet writer, Opus first review; `apps/recruiter/src/**` except `auth/**` and `error-reporting.test.ts`; AT-D3, D13, D14, D19). Then the lead wires `queue/consumer.ts`, `index.ts` (queue and cron) and `app.ts` (spec §11 order). Lead-only: migrations, contracts, wrangler, root package files.
4. Carried into R2 from C1b: the mirror stage `head`s the canonical `start_photo.jpg` and writes `media_objects` only when it exists with the mirrored `sha256` (C1b photo residuals a, b); measure finalise memory in workerd at the 20 MB cap (re-review note 4).
5. Reviews per stream: spec-reviewer + security-reviewer, **database-reviewer** for any SQL; fixes test-first; `--no-ff` merges; full `pnpm verify`; CI on PR #4; tag **`cp/d1-08`**; wrap-up; print Chat D's prompt (SESSION-PLAN).
6. Carried, due later: **OPEN-13** (SEC-2 volumetric limit for unknown link tokens; before the first staging dispatch, Chat E); `MIRROR_TRANSPORT='service'` only if DC-D2 picks it (C1b SR-1, OPEN-9); M7: SessionDO storage deletion and media-prefix retention (SEC-C1b-6, residual c); security N1 org CORS (R5); N3 wrangler `redact_query_string` warning; db n-4 (M1); m2 n-1 (M3a); m3 n-7 (M4); SEC-5 deeper JPEG check (M4).

## Decisions this chat (spec revision 4e; `docs/reviews/D1-review-c1b.md`)
- Writer decisions 1, 2, 5, 12 stand; 3, 4, 6-11, 13 confirmed; 14 fails closed (production uses `queue`). Resume without `adultConfirmed` stays refused.
- After submit: read-only token answers the receipt only (`answers: []`); older tokens 401 `superseded`; items 410 after `deadline_at`.
- SEC-1 residual: uploads go to the working key `start_photo.upload.jpg`; only `session/start` writes the canonical `start_photo.jpg` with bytes of the hash the DO stored once; the working copy is removed on every successful start (skip path too).
- Per-session caps: 50 000 stored events, 20 MB stored payload (413), heartbeats thinned by a bucket of 12 refilling one per 5 s; mirror attempts counted and the 24 h give-up checked when the lease is taken.
- Test-pool design: miniflare options in vitest projects (not a test wrangler file), so generated types and deploy configs never change.

## Founder items (`docs/progress/FOUNDER-QUEUE.md`)
- Unchanged: before the first staging dispatch, widen the Cloudflare token (R2 + Queues Edit); key script + `staging` variables (`CANDIDATE_TOKEN_KID`, `CANDIDATE_TOKEN_PUBLIC_JWK`, `API_STAGING_ORIGIN`) per `scripts/ops/README.md`. Rule 9 correction question (M3a). S1 residual risk. H9, H11, SES SMTP, Workers Paid only if DC-D2/D8 need it.

## Gotchas
- **commitlint:** type must be in the enum (`merge:` is refused; use `chore: merge …`); body and footer lines ≤ 100 chars; lowercase subject.
- Worktree guard: no `$(…)`, heredocs, loops, chained `git` calls or `cd` + git + other commands in one Bash call; EnterWorktree to move between worktrees.
- check-boundaries rules 1, 10, 11 scan test and helper files too (rule 11: never write `PACKAGES` in a helper outside the allowed get/head).
- The redactor turns synthetic ids like `44444444-…` into `[REDACTED]-[REDACTED]`.
- Each Worker's `test` now starts two workerd pools: more RAM and time; `api-do` has a 30 s test timeout (cold first call).
- This machine is short of RAM: `npm_config_workspace_concurrency=1` for verify / verify:fast; never two chats running verify or db commands at once.
- Usage on Max (Chat B): 2 Opus reviews + 3 Opus writers + 1 Sonnet re-review ≈ 15% of the 5-hour window, ~2% weekly.

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` (tip = this handoff) · `git rev-parse --short cp/d1-07` (`8a4873a`) · `git status` (clean) · `docker ps` · `npm_config_workspace_concurrency=1 pnpm -s verify:fast` · `gh pr checks 4 --repo TraceHiring/TraceHiring`
