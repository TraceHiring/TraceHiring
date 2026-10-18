# HANDOFF — 2026-10-18 ~23:30 IST (end of Chat A)
Reason for stopping: **Chat A's task is done** (C1a merged, verified, tagged). Founder moved to **Claude Max**: one chat = one big task (`docs/progress/SESSION-PLAN.md`; AUTOPILOT §6 first bullet). Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt). The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (no `m*-reviewed` tag, `main` still `fe77a87`). M0a and M0b are built, reviewed and fixed but **not CLOSED** (founder gates, "Path to close" unchanged).
- **D1 ≈ 72%**: Wave 0 (`cp/d1-03`), R1 (`cp/d1-04`), R3 (`cp/d1-05`), **C1a merged (`cp/d1-06`)**. C1b written, not reviewed. Left: C1b review + merge (Chat B), Wave 2 (R2 + R4 Chat C, C2 Chat D), staging (Chat E), D1 REVIEW (F), FIX + CLOSE (G).
- **Current phase: D1 BUILD, Wave 1.** Path to close M0a/M0b unchanged (founder widens the Cloudflare token with R2 + Queues Edit, key script, `staging` vars per `scripts/ops/README.md`; dispatch, smoke, re-review, summaries, `--no-ff` into `main` only with the founder's go-ahead).

## Where we are (verified this chat)
- **`d1/integration`** = `668225c` (merge of `d1/c1a-edge-lobby` @ `596e7d7`, `--no-ff`) + docs commits (spec 4d wording fix, review notes, C1b writer report, RESUME-PROMPT, this handoff). **Full `pnpm verify` exit 0 on `668225c`** (see LOG row for counts). **CI on PR #4 green on `4029a2a`** (static, rls, security, migrations, e2e-local; rls re-run once after a GitHub runner Docker networking failure before any test ran). **Tag `cp/d1-06` → `668225c`** (pushed).
- Before the merge (also this chat): `f9ddea5` spec **revision 4d** (C1a decisions, OPEN-13), `2677cdc` SESSION-PLAN + AUTOPILOT §6 Max rule.
- C1a stream `d1/c1a-edge-lobby` @ `596e7d7` (merged; worktree `.claude/worktrees/agent-aca1caeb85b274390`, clean). Its commits: writer `9b5c1a3..d17b6aa`; lead tests `9db46ef` (AT-D31 `no-secrets.test.ts`, AT-D32 edge `log-hygiene.test.ts`); reviews `78923ac`; fixes `9b395fe..edaf34a`; fix record `596e7d7`.
- Reviews (`docs/reviews/D1-review-c1a.md`): spec review **PASS WITH FIXES**, security review **PASS WITH NOTES**, confirming re-review (Sonnet) **CONFIRMED WITH NOTES**.
- **C1b stream `d1/c1b-session` @ `ea59b0a`** (worktree `.claude/worktrees/agent-a5af1e6c4e791ea3b`, clean; base `d17b6aa` = C1a **before** its fixes): SessionDO, session routes, AT-D24-D27 edge, D35 edge, D37, D11 edge, D29 maxChars; 16 files / 309 edge tests in-package. **Not reviewed, not merged, not run under verify.** Report: `docs/reviews/D1-c1b-writer-report.md`. Pushed to `trace`.
- Unchanged: `main` `fe77a87`, `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`; tags `cp/d1-01..05`.

## Next chat: **Chat B — C1b (SessionDO + session routes)**. Done when `cp/d1-07` is pushed.
## Next step (in order)
1. Verify (below). If anything differs from this file, stop and report.
2. Enter `.claude/worktrees/agent-a5af1e6c4e791ea3b` (EnterWorktree). `git merge d1/integration` into `d1/c1b-session` (no rebase: it is pushed); resolve `edge.test-helpers.ts`, `route-support.ts`, `http.ts`, `app.ts`, `index.ts`, `otp-*.ts`; edge vitest + tsc + eslint + prettier + check-boundaries green; commit.
3. Lead files (lead only, tests first): (a) test-pool bindings so the real `InviteOtpDO`, `SessionDO` (and api's `DemoOutboxDO`, `MediaLinkDO`) run in tests — a second vitest project/config or a test wrangler env; update `no-error-reporter.test.ts` (C1a SR-6, C1b need 2); (b) `fast-check` devDependency for `workers/edge` (catalog) and move AT-D25 to fast-check (C1b need 1); (c) pin `session.package_invalid {sessionId, pkg}` and `session.mirror_failed {sessionId, n}` in `log-hygiene.test.ts` and drive both paths with planted values.
4. Wire **`closePhotos()`** at `session/start` before the photo `head()` (C1a SEC-1) and close the **SEC-1 residual** (get + sha check + pin, see `D1-review-c1a.md` last section), tests first.
5. Reviews in parallel: **spec-reviewer** (AT-D7, D11 edge, D24-D27, D29 maxChars, D35, D37; §4.4, L-12, L-14, L-17, L-21) and **security-reviewer** (session tokens, nonce lifecycle, DO limits, R2 writes, mirror, S12) on `git diff 668225c <tip> -- workers/edge`. Decide the writer's decisions 1-14 (1, 2, 5, 12 flagged) and record them in spec revision 4e.
6. Fix (one commit per finding, tests first), confirming re-review (Sonnet), `--no-ff` merge into `d1/integration`, full `pnpm verify`, push, CI on PR #4, tag **`cp/d1-07`**, wrap-up, print Chat C's prompt (SESSION-PLAN).
7. Carried, due later: **OPEN-13** (SEC-2 volumetric limit for unknown link tokens; before the first staging dispatch, Chat E); r3a #3 `toDetail` half-written draft (before R4, Chat C); security N1 org CORS (R5); N3 wrangler `redact_query_string` warning; db n-4 (M1); m2 n-1 (M3a); m3 n-7 (M4); m2 n-7 two-connection mirror test (R2, AT-D16); SEC-5 deeper JPEG check (M4).

## Decisions this chat
- Max plan workflow (founder): one chat = one big task; SESSION-PLAN.md roadmap A-G to D1 CLOSE; stop at task end, context ~50% or 5-hour window 90%.
- Spec revision 4d (C1a reviews): OTP failures per invitation across codes; "3 per 10 min" = 3 codes; failed send given back; `otp.locked` once; photo byte checks before permit, APP0 only, ends `FF D9`, slot back on failed put, 4th upload 429 without Retry-After, permit org = token org, `closePhotos()` at start; OPEN-13 added.
- Lead: C1b test strategy = core class over injected storage (as C1a); real-DO tests come with the test-pool bindings in Chat B.
- Writer OQ1 (rule 9: refuse `blocked_age`/`expired`/`revoked`, allow `started`/`submitted`): consistent, no founder question.

## Founder items (`docs/progress/FOUNDER-QUEUE.md`)
- Unchanged: before the first staging dispatch, widen the Cloudflare token (R2 + Queues Edit); key script + `staging` variables per `scripts/ops/README.md`. Rule 9 correction question (M3a). S1 residual risk. H9, H11, SES SMTP, Workers Paid only if DC-D2/D8 need it.

## Gotchas
- **commitlint:** body lines ≤ 100 chars, lowercase subject; write long messages to a file and `git commit -F`, then check `git log -1`.
- check-boundaries rules 1 and 10 scan **test files** too: build credential names and `@supabase/…` import text at run time.
- The redactor turns synthetic ids like `44444444-…` into `[REDACTED]-[REDACTED]`: log fixtures must not expect raw ids.
- Worktree guard: no `$(…)`, heredocs, loops, `cd` + git chains in one Bash command; EnterWorktree to move; a session cannot run git with `cd` into another worktree.
- This machine is short of RAM: `npm_config_workspace_concurrency=1` for verify / verify:fast; never two chats running verify or db commands at once.
- Usage on Max (Chat A): 2 Opus reviews + 2 Opus writers + 1 Sonnet re-review ≈ 12-15% of the 5-hour window, ~2% weekly.

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` (tip = this handoff) · `git rev-parse --short cp/d1-06` (`668225c`) · `git log --oneline -1 d1/c1b-session` (`ea59b0a`) · `git status` (clean) · `docker ps` · `npm_config_workspace_concurrency=1 pnpm -s verify:fast` · `gh pr checks 4 --repo TraceHiring/TraceHiring`
