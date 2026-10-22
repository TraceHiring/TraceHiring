# HANDOFF — 2026-10-22 18:40 IST (M0a/M0b CLOSE done: both milestones merged into main and tagged)
Reason for stopping: the chat's task (M0a then M0b CLOSE) is done. Usage at stop: 5-hour window 34%, weekly 32% (Pro), context 26%. Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`**. The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **2 of 17**. `m0a-reviewed` = `3667678` (PR TraceHiring/TraceHiring#6), `m0b-reviewed` = `da5380d` (PR #13). `main` = `da5380d`.
- **D1 ≈ 98%**: code merged and reviewed; staging deploy green through Hyperdrive; `e2e-staging` (AT-D1) red at steps 5-6 (timeouts, fix known); DC-D8, AT-D2, `cp/d1-10` open.

## Where we are (verified this chat)
- **`d1/integration` HEAD = `74ddc51`** (merge of `main` into d1; only the four CLOSE docs came in) + this handoff commit. Clean tree. Pushed.
- `verify:fast` on `74ddc51`: passed (typecheck, lint, test) in 275 s.
- `milestone/m0a` = `2d051c1`, `milestone/m0b` = `ee3b8e3` (both pushed; both merged into `main`).
- Local worktrees made this chat (keep): `.claude/worktrees/close-m0a` (milestone/m0a), `close-m0b` (milestone/m0b), `close-sec1-probe` (`close/sec1-red-probe`, pushed, PR #5 closed unmerged).
- The local Supabase stack was last reset by `test:rls` on the M0b tree: run `pnpm test:rls` (or `db reset`) on d1 before any d1 DB work.

## Done this chat (M0a/M0b CLOSE)
- Founder decisions in chat (recorded in `docs/build-notes.md` §0 "Public repo and M0a/M0b CLOSE"): `[skip ci]` in the CLOSE merge commits; H11 run by the founder; go-ahead to merge and tag if every gate is green; cherry-pick the osv ignore onto m0a.
- SEC-1 proof: red-PR probe TraceHiring/TraceHiring#5 (`0f124f3`), run 39771691911: static failed on the deliberate test, `mergeStateStatus` BLOCKED; closed unmerged.
- Required `security` was red on the milestone tips (`@vitest/mocker` 4.1.11 advisories). `02368f2` on m0a cherry-picks `8c3c725`'s osv ignore (build-notes row stays on d1 only).
- Fresh Opus re-reviews: M0a PASS, M0b PASS (after H11). Addenda in `docs/reviews/M0a.md`, `docs/reviews/M0b.md`.
- H11 on trace-dev (founder): all six migrations applied; `session_user, role` = `postgres|none` (DC-3, DC-4, DC-9 met). Output in `docs/milestones/M0b-summary.md` §3.
- Full `pnpm verify` (tests with `pnpm -r --workspace-concurrency=1`): green on m0a `02368f2` (scripts 1299 + 1 skipped, catalog 112) and m0b `0349b32` (scripts 1559 + 1 skipped, catalog 140, rls 697). A first m0a run with 3 agents active failed 6 ReDoS timing tests (61 ms vs 50 ms budget); passed alone and on the re-run.
- Summaries: `docs/milestones/M0a-summary.md` (`d3b6a37`), `M0b-summary.md` (`ee3b8e3`).
- PR #6 checks green on `2d051c1` → merged `3667678`; PR #13 checks green on `ee3b8e3` → merged `da5380d`. No ci.yml run on `main` (only GitHub's Dependabot jobs).
- d1: `f0a2606` AUTOPILOT §2 CLOSE via PR, §6 never push `main` directly; build-notes §0 row; FOUNDER-QUEUE row (public repo supersedes "stay on Free").

## In progress (exact): e2e-staging red (AT-D1), unchanged since Chat E3 part 2
- Run 39762460219, `e2e/tests/d1-slice.spec.ts`: steps 1-4 green (api reaches Postgres via Hyperdrive). Steps 5-6 (line ~676) time out: A and B never show "Confirm it is you" within 5 s; C, D, E never show "We sent a 6-digit code". Steps 7-10 skipped.
- **Investigator result (Opus, read-only):** no server failure. Each candidate request takes 5-9 s (runner in Azure westus3, DB in Mumbai, 10-15 sequential DB trips per request); the staging Playwright project in `e2e/playwright.config.ts` has no `expect.timeout`, so `toBeVisible()` in `e2e/support/candidate-ui.ts:275,291,295` uses 5 s. The app's own request timeout is 30 s (`apps/candidate/src/api.ts:282`). Ruled out: connect failures, prepare:false, rate limiter, OTP DO, CORS.

## Next step (one precise action)
1. Test first: in `scripts/test/e2e-playwright-config.test.mjs` assert the staging project's `expect.timeout` ≥ 30 000 and the local project's stays unset; watch it fail; add `expect: { timeout: 30_000 }` to the staging project only.
2. verify:fast (read its result line), push, CI, re-dispatch (`gh workflow run ci.yml --repo TraceHiring/TraceHiring --ref d1/integration`). If AT-D17 (both cards within 90 s) or a later step times out, record per-step `ms` from `d1-manifest.json` first.
3. When e2e-staging is green: DC-D8 (CPU per invocation), then ask the founder for the AT-D2 capture (spec 4n §7.3, `pnpm e2e:record`).
4. Tag `staging-applied-<run id>` for each dispatch that applied migrations, then **`cp/d1-10`**, push.
5. Then D1 REVIEW of the remainder / D1 CLOSE by PR (AUTOPILOT §2). At the D1 merge the founder adds `e2e-local` back to the ruleset's required checks.

## Decisions made this chat
- CLOSE merges go through a PR with green required checks; `[skip ci]` only in the CLOSE merge commit (AUTOPILOT §2, §6; build-notes §0).
- Never push `main` directly; never put the skip-ci marker in a PR-head commit (it skipped PR #6's checks once; fixed by empty commit `2d051c1`).
- The repo is public (founder) and supersedes FOUNDER-QUEUE "(c) stay on Free".

## Founder items
- **After D1 merges:** add `e2e-local` back to ruleset 25633431's required checks.
- **Dependabot PRs #7-#12** opened on `main` after M0a's `dependabot.yml` arrived (zod, @types/node 22→26, react group, wrangler, typescript-eslint, actions/setup-node). **Do not merge them blind:** they may break the two-week release-age rule and pinned versions (`@types/node` 26 is a major jump; node is 22). Decide: close them, or configure Dependabot (cooldown 14 days, ignore majors) in a reviewed PR.
- Optional: strict status checks on the ruleset; required reviewer on the `staging` environment (FOUNDER-QUEUE:10 known gap); fork-PR approval for outside contributors.
- AT-D2 screen capture after e2e-staging is green.

## Gotchas
- Read each command's own result line (`verify:fast: passed/FAILED`, `=== RESULT ... exit=`), never a trailing `echo $?`.
- Timing tests (ReDoS 50 ms budgets) fail under heavy local load; re-run alone before suspecting a regression.
- Bump the vitest catalog to 4.1.12 on or after 2026-10-29 and delete the two osv entries (root `osv-scanner.toml`, `docs/spikes/d1-day-one/osv-scanner.toml`); they expire 2026-11-05 and `main` carries them too.
- After any wrangler binding change: `pnpm exec wrangler types --strict-vars=false` in that package.
- Do not re-run `staging-worker-secrets.mjs` without need (password rotation, pooler cache 2013).
- pnpm 12 ignores `npm_config_workspace_concurrency`; use `pnpm -r --workspace-concurrency=1`.
- The worktree guard refuses writes to other worktrees and complex shell lines; use `EnterWorktree` with the path, plain commands, and the Write/Edit tools.

## Verify first
`git fetch trace` · `git log --oneline -3 d1/integration` (this handoff, parent `74ddc51`) · `git status` · `git ls-remote trace refs/tags/m0a-reviewed refs/tags/m0b-reviewed` · `git rev-parse --short trace/main` (`da5380d`) · `pnpm -s verify:fast`
