# HANDOFF — 2026-10-18 ~20:55 IST
Reason for stopping: usage guard (Pro plan; founder stop at 95% of the 5-hour window; wrap-up started at 81%; the window resets ~00:50 IST 2026-10-19). Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt). The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (no `m*-reviewed` tag, `main` still `fe77a87`). M0a and M0b are built, reviewed and fixed but **not CLOSED** (founder gates, "Path to close" unchanged).
- **D1 ≈ 65%**: Wave 0 complete (`cp/d1-03`), R1 merged (`cp/d1-04`), **R3 merged, reviewed and fixed (`cp/d1-05`)**. C1a (edge lobby half) written on a stream branch, **not reviewed, not merged**. Left: C1a finish + reviews, C1b (SessionDO), Wave 2 (R2, R4, C2), lead wiring, Wave 3 (R5), staging deploy, D1 review.
- **Current phase: D1 BUILD, Wave 1.**
- **Path to close M0a and M0b (unchanged):** founder widens the Cloudflare token with R2 + Queues Edit, runs the key script and sets the `staging` variables per `scripts/ops/README.md`; then a `workflow_dispatch`, smoke, re-review, summaries, `--no-ff` into `main` and the `m*-reviewed` tags — each merge only with the founder's explicit go-ahead. Ask the founder before the first staging dispatch.

## Where we are (verified this session)
- **`d1/integration` @ `76f3d69`** (+ this handoff commit) = **`cp/d1-05`**: merge of `d1/r3-merge` @ `172dab1` (`--no-ff`; the message records that `ec83f46` carries R1's subject but R3's candidate token files). **Full `pnpm verify` exit 0 on `76f3d69`** (typecheck, lint, 2172 tests + 1 skipped, test:rls: 32 files, catalog 142 ≥ 142, rls 2616 ≥ 2616, db-types current, build). **CI green on PR #4 for `76f3d69`** (static, rls, security, migrations, e2e-local; deploy-staging skipped).
- Unchanged: `main` `fe77a87`, `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`. Tags `cp/d1-01..04` unchanged; **new `cp/d1-05` → `76f3d69`** (pushed).
- **C1a stream: `d1/c1a-edge-lobby` @ `d17b6aa`** (worktree `.claude/worktrees/agent-aca1caeb85b274390`, clean; base `76f3d69`): 5 commits (`9b5c1a3` common rules + CandidateRpc client, `4da8c41` token verify AT-D23, `093c9d5` InviteOtpDO + invite/otp routes AT-D28, `3663af0` lobby age/notice/consent, `d17b6aa` photo upload AT-D29 photo half). Writer-run in `workers/edge`: vitest 9 files / 219 tests, tsc, eslint, prettier, check-boundaries OK. **Not run by the lead: verify:fast, full verify. Not reviewed.** Report: `docs/reviews/D1-c1a-writer-report.md` (decisions 1-10, open questions).
- Writer/stream branches kept (local + pushed): `d1/r3-merge` `172dab1`, `d1/r3-api` `064f5fe`, `d1/r3-api-r3a` `51667f6`, `d1/r3-api-r3a2` `f3f9c52`, `d1/r3-reports` `7f6965c`, `d1/c1a-edge-lobby` `d17b6aa`.

## Done this session (all on `d1/r3-merge`, then merged; tests first unless noted)
- Security review r3 **#2** publish role check before any R2 write (`0cc6f1c`).
- Spec review r3 reports: **4b** results list + review queue fail closed past 500 (`cd2618f`); **5** log hygiene over all 18 org routes, invitations, outbox, media (`88be6b8`, mutation-checked); **3** spec rev 4b (`5709fad`); resolutions (`0c1c9f8`).
- New reviews: **spec review of the R3a half PASS WITH FIXES** (`docs/reviews/D1-spec-review-r3a.md`); **database review of R3 APPROVE WITH MINOR FIXES** (`docs/reviews/D1-db-review-r3.md`) (`8ed6e88`).
- Fixes from them: r3a **#4** authoring role on POST/PUT tests (`76f203d`); r3a **#2** losing publish restores the frozen R2 package (`ffe674a`); db **m-1** lazy `expired` commits before `link_expired` (FailAfterCommit; candidate fake made transactional) (`f37b812`); db **m-2** demo outbox closed to a suspended org (`c26753f`); db **m-4** failed draft insert archives the test (`3d50ee2`); db **m-3** tests/invitations/assignments lists cap+1 fail closed, chunked `in.()` (`71469ce`); db **n-2** lobbyMint refuses when its move lost to a revoke (`9fcdbe6`); r3a **#5b** createOrgDeps default-fetch test (`2c11bb5`). Spec **revision 4c** records every accepted decision; resolution tables in both review files; FOUNDER-QUEUE rule 9 row (`172dab1`).
- verify:fast once failed on `scan-dist` real-gitleaks 60 s timeout while two review agents loaded the machine; it passes alone (101 passed); full verify later green.

## Next step (in order)
1. Verify (below). If anything differs from this file, stop and report.
2. **C1a** (enter `.claude/worktrees/agent-aca1caeb85b274390` with EnterWorktree; branch `d1/c1a-edge-lobby`):
   a. Finish step 6, tests first: `workers/edge/src/no-secrets.test.ts` (AT-D31 edge part: no secret, no DB credential name — build names at run time, check-boundaries rule 1 scans tests; `PACKAGES` only `get`/`head`) and `workers/edge/src/log-hygiene.test.ts` (AT-D32 edge half: planted lobby/session tokens, OTP codes, link tokens never in a log line). A writer or the lead.
   b. Lead: run `npm_config_workspace_concurrency=1 pnpm -s verify:fast` on the branch.
   c. Reviews: **spec-reviewer** (AT-D23, D28, D29, D31, D32 edge; §4.1-4.3, §4.5) and **security-reviewer** (tokens, OTP, media upload, S12) on `git diff 76f3d69 <tip> -- workers/edge`. Decide the writer's open questions (rule 9 minor: otp refuses blocked_age/expired/revoked from inviteResolve's state, allows started/submitted; test-pool DO bindings request).
   d. Merge `--no-ff` into `d1/integration` (or keep it open and merge together with C1b — lead's choice), full verify, CI, tag `cp/d1-06`.
3. **C1b** (Opus writer, own worktree reset to the integration tip, owned dir `workers/edge/src/**`): SessionDO (`gseq`, autosave, timer, mirror, clock), `session/start|attach|items|events|submit` (AT-D24-D27, D35 edge `start.test.ts`, D37 `clock.test.ts`), reusing C1a's `route-support.ts`, `http.ts`, `token.ts`, `otp-do.ts` (`clearLobbyNonce` at grant), `routes-photo.ts`. Lead first decides the test-pool bindings (vitest config + `no-error-reporter.test.ts`; lead files).
4. Then Wave 2 (R2, R4, C2), lead wiring, `e2e-local` with the real flow (also closes r3a review #1: the real trace_api SQL), Wave 3 (R5), founder gates for the first staging dispatch. At most 2 agents at once.
5. Carried, due later: r3a #3 `toDetail` must tolerate a half-written draft (before R4 integrates the editor; lead contract decision); security N1 org CORS (R5); N3 wrangler `redact_query_string` warning; db n-4 migration comment (M1); m2 n-1 (M3a), m3 n-7 (M4 index), m2 n-7 two-connection mirror test (R2, AT-D16); real-DO tests of `DemoOutboxDO`/`MediaLinkDO`/`InviteOtpDO` need test-pool bindings.

## Decisions this session
- All recorded in `specs/d1-demo-slice.md` revisions 4b and 4c (list caps 500 fail closed, invite TTL 7 days, response bodies, invite failure paths, aal2_required, authoring roles, outbox org visibility, lazy-expired commit, m2 m-2 closed option 1 api-side, AT-D33 wording).
- Lead: the publish "better option" (write only after the UPDATE) is not taken; the losing attempt repairs R2 instead (security review resolution note).
- Lead: C1 is split into C1a (lobby) and C1b (session), run one after the other because they share `workers/edge/src` helpers.

## Founder items (`docs/progress/FOUNDER-QUEUE.md`)
- New (not blocking D1): **rule 9, may a candidate correct "adult" to "under 18"?** (M3a).
- Unchanged: before the first staging dispatch, widen the Cloudflare token (R2 + Queues Edit); key script + `staging` variables per `scripts/ops/README.md`. S1 residual risk (GitHub Free). H9, H11, SES SMTP, Workers Paid only if DC-D2/D8 need it.

## Gotchas
- **commitlint:** body lines ≤ 100 chars; `git commit -m` with a long body fails silently under a grep filter — write the message to a file, `git commit -F`, then check `git log -1`. Subject lowercase.
- **Never `git checkout -- <file>` to undo a mutation test** on a file with uncommitted edits (it reverts them too); commit first or mutate a committed file only.
- The shell eats backticks inside `node -e "…"` strings; write code with the Write/Edit tools.
- This machine is short of RAM: `npm_config_workspace_concurrency=1` for verify / verify:fast (3-8 min); a review agent running at the same time can time out the 60 s real-gitleaks `scan-dist` test.
- Worktree guard: no `$(…)`, heredocs, loops, `cd` + git or chained git calls in one Bash command; EnterWorktree to move between worktrees.
- Usage on Pro: two Opus reviews ran ~15% together; one Opus writer took 58% → 81% in ~25 minutes.
- Only the lead runs supabase start/stop, db reset, test db, gen types, `pnpm verify`, `test:rls`, `scripts/e2e-local.mjs`.

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` (tip = this handoff, parent `76f3d69`) · `git log --oneline -1 d1/c1a-edge-lobby` (`d17b6aa`) · `git status` (clean) · `docker ps` · `npm_config_workspace_concurrency=1 pnpm -s verify:fast` · `gh pr checks 4 --repo TraceHiring/TraceHiring`
