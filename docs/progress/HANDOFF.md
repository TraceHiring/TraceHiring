# HANDOFF — 2026-10-17 ~09:25 IST
Reason for stopping: usage guard (the founder said stop new work at 90% of the 5-hour window; stopped at ~85% so the wrap-up fits; Pro plan, resets 12:30 IST). Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt). The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (no `m*-reviewed` tag, `main` still `fe77a87`). M0a and M0b are built, reviewed and fixed but **not CLOSED**. **D1 ≈ 50%**: **Wave 0 is complete** (`cp/d1-03`); Wave 1 (R1, R3, C1) has started; Waves 2-3, the staging deploy and the D1 review remain.
- **Path to close M0a and M0b:** the founder widens the Cloudflare token (R2 + Queues Edit), runs the key script and sets the `staging` variables (`CANDIDATE_TOKEN_KID`, `CANDIDATE_TOKEN_PUBLIC_JWK`, `API_STAGING_ORIGIN`) and the api secret, per `scripts/ops/README.md`; then a `workflow_dispatch` from `milestone/m0a` / `milestone/m0b` (migrations to trace-staging, H9 smoke user, AT-11/AT-B9 smoke), H11 on trace-dev; re-run `trace-milestone-review` for each, write the summaries, merge `--no-ff` into `main`, tag `m0a-reviewed` / `m0b-reviewed` — **each merge only with the founder's explicit go-ahead**. S2 and S6 (the pre-dispatch Lows) are now fixed. **Ask the founder before the first staging dispatch.**
- **Current phase: D1 BUILD, Wave 1.**

## Where we are (verified)
- **`d1/integration`** (worktree `.claude/worktrees/d1-integration`), clean. Code tip **`c514c7a`** (postgres 3.4.9 in the catalog for api and jobs; verify:fast green). Before it, **`1dff4d6` = `cp/d1-03`**: **full `pnpm verify` exit 0** (scripts 2169 passed + 1 Windows-only skip, rls 2616 = floor, catalog 142, db-types current, build/bundle/headers/scan OK) and **CI green on PR #4** (static, rls, security, migrations, **e2e-local 3 min 18 s**). CI on `c514c7a`: check it.
- Tags: `cp/d1-01` `bbae037`, `cp/d1-02` `97f82dd`, **`cp/d1-03` `1dff4d6`** (pushed).
- Unchanged: `main` `fe77a87` (never commit on or move it), `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`.
- **Wave 1 writer branches (Opus, from `c514c7a`, pushed at wrap-up, NOT merged):**
  - **R1 `d1/r1-band-engine` @ `89a29fe`** (worktree `.claude/worktrees/agent-a9786883cf2eeff90`): band-engine (parseRuleTable, computeBand, canonicalJson, property tests P1-P10) and vendors (LlmGrader mock, Messaging demo outbox). **Spec review PASS WITH FIXES** (`docs/reviews/D1-spec-review-r1.md`); M1, M2, L3, L4, L5 **fixed** in `dd83d32`, `89a29fe` (band-engine 139 tests, vendors 110; each escalation branch mutation-proven); L1, L2 are R2's (map `ms` → `durationMs`, drop null attrs, strip `ContextItem.ruleId`). **Still due:** security-reviewer on the vendors production guard (§11), then merge.
  - **R3 `d1/r3-api`** (worktree `.claude/worktrees/agent-ab9420609f2c22c98`): **stopped by the lead at 83% usage** (tip `064f5fe`), just as it began the media module. Committed: `ec83f46` candidate token module, `5120893` `trace_api` transaction layer + candidate store + demo outbox, `d15f101` `CandidateRpc` (nine lobby/session methods), `064f5fe` org context (Supabase JWT verify, PostgREST as the caller). Not done: media link, tests/invitations/assignments, reports + not_used, route inventory, log hygiene, its report and lead requests. Its worktree may hold uncommitted work (not checked: the worktree guard blocks `git -C`; look there first). **Commit `ec83f46` carries R1's subject but holds R3's own files** (`modules/candidate/{token,encoding,token.test}.ts`): the branch is pushed, so do not reword it (no history rewrite): say so in the `--no-ff` merge commit message. Not reviewed.
  - C1 (edge) not started.

## Done this session (2026-10-17, verified, commit by commit)
- `67ecf0b` Linux CI fix: the S5 ACL-note test faked win32 without a profile (CI on `29eb2fc` was red; green since).
- `59f0fcd` **S6**: ensure-staging-resources matches "exists" only in wrangler's stderr `[ERROR]` block with its kind's code, then confirms with `r2 bucket info --json` (name, location apac) / `queues info` (exact `Queue Name:`).
- `c740713` **S2**: every deploy-staging line naming wrangler and deploy is classified; dry-run line exact; each Worker deploy step's whole run text pinned; cd/pushd/--cwd/-c/--config/dlx/npx refused.
- `e97d611` **`e2e-local` CI job** + `run_e2e` boolean dispatch input, pinned by check-workflows (exact if, 25 min, ubuntu-24.04, no container/services, one exact script step, artifacts only `e2e/playwright-report` + `e2e/test-results`, ≤ 7 days); `actions/cache` v6.1.0, `actions/upload-artifact` v7.0.1 (SHA-pinned).
- `7f9ca97` **`scripts/e2e-local.mjs`** (test-rls lock, supabase start + db reset, both apps built, two `wrangler dev` sessions sharing `--persist-to`: api alone on 8788, edge + jobs on 8787; `vite preview` 5173/5174; Playwright with `E2E_LOCAL=1`; redacted logs; manifest `e2e/test-results/dc-d9.json`) and `e2e/tests/{dc-d6,stack}.spec.ts`. Unit tests were written right after the script, not before (said in the commit).
- `d1039bf` spec §8: **DC-D9 PASS** (CI script 149 s, job 3 min 35 s cold; Windows 69 s) and **DC-D6 PASS on Linux**; lead decision: two wrangler dev sessions (one multi-config session serves only its first Worker); cross-session edge → api binding and shared EVIDENCE reads are for R5 to exercise (fallback named).
- **Opus security review** `docs/reviews/D1-security-review-wave0-tail.md`: **PASS**; L1 (Pages step could still deploy via `de''ploy`/`$d`/continuation) fixed in `8845361` (token-step allow-list, `PAGES_STEP_LINES`, bash-style continuation join); I1 (fork `d1/x` PRs) fixed in `8845361`; L2 (Ctrl+C orphans) fixed in `1dff4d6`.
- `c514c7a` postgres 3.4.9 (ADR-031) in the catalog, api and jobs.
- `b1a9686` interim handoff; `05fd16d` R1 spec review record + spec §5.3 lead decisions.

## Next step (in order)
1. Verify (below). If anything differs from this file, stop and report.
2. **Wave 1:**
   a. **R1:** security-reviewer on `c514c7a..d1/r1-band-engine` (vendors production guard: demo outbox and mock grader refuse production; §5.3, AT-D18); fix; README line in `packages/vendors/README.md` (LlmGrader and Messaging exist from D1; lead); merge `--no-ff`; verify:fast.
   b. **R3:** if its report is not in the repo, resume it from its branch (a new writer: reset its worktree to the branch tip, read its commits, continue the §11 scope in the order given in its brief: token + CandidateRpc, media link, tests/invitations/assignments, reports + not_used, outbox, route inventory + log hygiene). Then spec-reviewer, security-reviewer, database-reviewer; apply its lead requests (the `app.ts`/`index.ts` mount diff); merge `--no-ff`; verify:fast.
   c. Full `pnpm verify` + CI, tag `cp/d1-04`. Then C1 (edge). At most 2 agents at once.
3. Carried DB items still open: m2 m-2 (late `sessionStarted`, R3 decides), m2 n-1 (M3a), m3 n-7 (M4 index), m2 n-7 two-connection mirror test (R2, AT-D16).
4. Wave 2 (R2 needs R1 merged, R4, C2), lead wiring, `e2e-local` with the real flow, Wave 3 (R5), then the founder gates for the first staging dispatch.

## Decisions this session
- Lead: the local E2E stack uses two `wrangler dev` sessions (spec §8, §7.2); `e2e-local` runs on dispatch (`run_e2e`) or a same-repo PR from `d1/**`, never on push; `upload-artifact` v7.0.1 not v7.0.2 (two-week rule); every token-holding deploy-staging step is allow-listed by whole run text.
- Lead (spec §5.3, R1 review): hand-written strict `parseGradeRequest` instead of zod; mock-grader anchors match as phrases, empty/duplicate anchors refused; band `reasons` capped at 10; R1's other choices accepted (reason codes, `connectivity` reserved, duplicate `gseq` throws, coverage capped at 1000‰).
- Writers must use a commit-message file unique to their worktree (two writers shared one: see R3 `ec83f46`).

## Founder items (`docs/progress/FOUNDER-QUEUE.md`)
- **Before the first staging dispatch:** widen the Cloudflare token (R2 + Queues Edit); key script + `staging` variables per `scripts/ops/README.md`; then the autopilot asks before dispatching. S1 residual risk (GitHub Free). H9, H11, SES SMTP, Workers Paid only if DC-D2/D8 need it.

## Gotchas
- **This machine is short of RAM** (often < 1 GB free): run `pnpm verify` / `verify:fast` with `npm_config_workspace_concurrency=1`; a parallel run gave workerd `bad_alloc`/`ECONNRESET` and redactor timing misses (they pass alone). verify:fast took 3-15 min.
- The laptop can sleep during long waits (a db reset "took" 6.9 h): call the keep-awake tool first.
- `wrangler dev --persist-to` on Windows needs a short path (long paths → `SQLITE_CANTOPEN`).
- Usage on Pro: each Opus agent run ≈ 10-15% of the 5-hour window; check `get_usage` after each result.
- Only the lead runs supabase start/stop, db reset, test db, gen types, `pnpm verify`, `test:rls`, and `scripts/e2e-local.mjs` (it resets the local DB): warn running agents first.
- Worktree guard: no `$(…)`, heredocs, loops or `cd` + git chains; write files with the Write tool; commit via `git commit -F <file>`.

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -5 d1/integration` · `git status` (clean) · `docker ps` · `npm_config_workspace_concurrency=1 pnpm -s verify:fast` · `gh pr checks 4 --repo TraceHiring/TraceHiring` · `git worktree list` (the R1/R3 worktrees)
