# HANDOFF — 2026-10-17 ~08:45 IST (interim; Wave 1 writers running)
Reason for this write: checkpoint after Wave 0 completed (`cp/d1-03`) and the Wave 1 writers R1 and R3 started. If this session ends before the final handoff, resume from here. Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt). The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (no `m*-reviewed` tag, `main` still `fe77a87`). M0a and M0b are built, reviewed and fixed but **not CLOSED**. **D1 ≈ 50%**: **Wave 0 is complete** (`cp/d1-03`); Wave 1 (R1, R3, C1) has started; Waves 2-3, the staging deploy and the D1 review remain.
- **Path to close M0a and M0b:** the founder widens the Cloudflare token (R2 + Queues Edit), runs the key script and sets the `staging` variables (`CANDIDATE_TOKEN_KID`, `CANDIDATE_TOKEN_PUBLIC_JWK`, `API_STAGING_ORIGIN`) and the api secret, per `scripts/ops/README.md`; then a `workflow_dispatch` from `milestone/m0a` / `milestone/m0b` (migrations to trace-staging, H9 smoke user, AT-11/AT-B9 smoke), H11 on trace-dev; re-run `trace-milestone-review` for each, write the summaries, merge `--no-ff` into `main`, tag `m0a-reviewed` / `m0b-reviewed` — **each merge only with the founder's explicit go-ahead**. S2 and S6 (the pre-dispatch Lows) are now fixed. **Ask the founder before the first staging dispatch.**
- **Current phase: D1 BUILD, Wave 1.**

## Where we are (verified)
- **`d1/integration`** (worktree `.claude/worktrees/d1-integration`), clean. Code tip **`c514c7a`** (postgres 3.4.9 in the catalog for api and jobs; verify:fast green). Before it, **`1dff4d6` = `cp/d1-03`**: **full `pnpm verify` exit 0** (scripts 2169 passed + 1 Windows-only skip, rls 2616 = floor, catalog 142, db-types current, build/bundle/headers/scan OK) and **CI green on PR #4** (static, rls, security, migrations, **e2e-local 3 min 18 s**). CI on `c514c7a`: check it.
- Tags: `cp/d1-01` `bbae037`, `cp/d1-02` `97f82dd`, **`cp/d1-03` `1dff4d6`** (pushed).
- Unchanged: `main` `fe77a87` (never commit on or move it), `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`.
- **Writers running (Opus, own worktrees, each reset to `c514c7a`, not pushed):** R1 on branch **`d1/r1-band-engine`** (`packages/band-engine/src/**`, `packages/vendors/src/**`), R3 on branch **`d1/r3-api`** (`services/api/src/modules/**` + `route-inventory.test.ts`, `log-hygiene.test.ts`). Find their worktrees with `git worktree list` (`.claude/worktrees/agent-*`). Neither is reviewed or placed. C1 (edge) not started (Pro plan: at most 2 agents).

## Done this session (2026-10-17, verified, commit by commit)
- `67ecf0b` Linux CI fix: the S5 ACL-note test faked win32 without a profile (CI on `29eb2fc` was red; green since).
- `59f0fcd` **S6**: ensure-staging-resources matches "exists" only in wrangler's stderr `[ERROR]` block with its kind's code, then confirms with `r2 bucket info --json` (name, location apac) / `queues info` (exact `Queue Name:`).
- `c740713` **S2**: every deploy-staging line naming wrangler and deploy is classified; dry-run line exact; each Worker deploy step's whole run text pinned; cd/pushd/--cwd/-c/--config/dlx/npx refused.
- `e97d611` **`e2e-local` CI job** + `run_e2e` boolean dispatch input, pinned by check-workflows (exact if, 25 min, ubuntu-24.04, no container/services, one exact script step, artifacts only `e2e/playwright-report` + `e2e/test-results`, ≤ 7 days); `actions/cache` v6.1.0, `actions/upload-artifact` v7.0.1 (SHA-pinned).
- `7f9ca97` **`scripts/e2e-local.mjs`** (test-rls lock, supabase start + db reset, both apps built, two `wrangler dev` sessions sharing `--persist-to`: api alone on 8788, edge + jobs on 8787; `vite preview` 5173/5174; Playwright with `E2E_LOCAL=1`; redacted logs; manifest `e2e/test-results/dc-d9.json`) and `e2e/tests/{dc-d6,stack}.spec.ts`. Unit tests were written right after the script, not before (said in the commit).
- `d1039bf` spec §8: **DC-D9 PASS** (CI script 149 s, job 3 min 35 s cold; Windows 69 s) and **DC-D6 PASS on Linux**; lead decision: two wrangler dev sessions (one multi-config session serves only its first Worker); cross-session edge → api binding and shared EVIDENCE reads are for R5 to exercise (fallback named).
- **Opus security review** `docs/reviews/D1-security-review-wave0-tail.md`: **PASS**; L1 (Pages step could still deploy via `de''ploy`/`$d`/continuation) fixed in `8845361` (token-step allow-list, `PAGES_STEP_LINES`, bash-style continuation join); I1 (fork `d1/x` PRs) fixed in `8845361`; L2 (Ctrl+C orphans) fixed in `1dff4d6`.
- `c514c7a` postgres 3.4.9 (ADR-031) in the catalog, api and jobs.

## Next step (in order)
1. Verify (below). If anything differs from this file, stop and report.
2. **Wave 1:** when R1 / R3 report: read the report, check the branch (`git log c514c7a..d1/<stream>`), run the package checks, then the reviewers from spec §11 (R1: spec-reviewer + security-reviewer for the production guard; R3: spec-reviewer, security-reviewer, database-reviewer), fix, apply the lead requests (R3's `app.ts`/`index.ts` mount diff, anything else lead-only), merge `--no-ff` into `d1/integration`, verify:fast after each placement, full `pnpm verify` + CI, tag `cp/d1-04`. Then C1 (edge). At most 2 agents at once.
3. Carried DB items still open: m2 m-2 (late `sessionStarted`, R3 decides), m2 n-1 (M3a), m3 n-7 (M4 index), m2 n-7 two-connection mirror test (R2, AT-D16).
4. Wave 2 (R2 needs R1 merged, R4, C2), lead wiring, `e2e-local` with the real flow, Wave 3 (R5), then the founder gates for the first staging dispatch.

## Decisions this session
- Lead: the local E2E stack uses two `wrangler dev` sessions (spec §8, §7.2); `e2e-local` runs on dispatch (`run_e2e`) or a same-repo PR from `d1/**`, never on push; `upload-artifact` v7.0.1 not v7.0.2 (two-week rule); every token-holding deploy-staging step is allow-listed by whole run text.

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
