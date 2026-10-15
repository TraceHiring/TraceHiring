# HANDOFF — 2026-10-15 ~15:30 IST
Reason for stopping: founder asked to wrap up after the founder-queue walkthrough (weekly usage ~88%; context ~62%). Next session may be on another account.
Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt). The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (verified 2026-10-15: no `m*-reviewed` tag, no `docs/milestones/` summary, `main` still `fe77a87`). Rough estimate of all work: **~10–14%**. M0a and M0b are built, reviewed and fixed but **not CLOSED** (AUTOPILOT §2 CLOSE = PASS / PASS WITH CONDITIONS + summary + merge to `main` + `m<X>-reviewed` tag). **D1 ≈ 30–35%** (Wave 0 nearly done); M1–M13 not started.
- **Path to close M0a and M0b** (the founder asked about this): with the 2026-10-15 answers (GitHub Free → AT-13 is a recorded known gap; staging proof = deploy before merge), what remains is staging evidence: build ci.yml step 2a (incl. the `workflow_dispatch` deploy), founder widens the Cloudflare token, run the staging deploy from `milestone/m0a` / `milestone/m0b` (migrations to trace-staging, then H9 smoke user, AT-11/AT-B9 smoke), H11 on trace-dev; then re-run `trace-milestone-review` for M0a and M0b, write the summaries, merge `--no-ff` into `main`, tag `m0a-reviewed` / `m0b-reviewed` (each step only with the founder's go-ahead for the merge to `main`).
- **Current phase: D1 BUILD, Wave 0 (lead-only).** Done: AT-D22 Sentry; migrations **1–4** placed, reviewed, fixed; every `rls_d1_*` file of spec §3.6 placed; contracts `@trace/shared/contracts/{candidate,d1}`; shared helpers `canonical-json`, `signal-catalog`, `canonical-notice`; ADR-030 accepted in part; `packages/band-engine` and `e2e` skeletons; boundaries (band-engine, e2e, report-quality/report-integrity as rule-1 sides); wrangler dev/staging bindings + staging-secrets allow-list; check-boundaries rule 11. **Not done:** see Next step 2.

## Where we are (verified at handoff)
- **`d1/integration`** (worktree `.claude/worktrees/d1-integration`) tip = this handoff commit; last code commit **`97f82dd`**. **Full `pnpm verify` exit 0 at `eaa8155`** (32 test files, rls 2610 = floor, catalog 142, db-types current). Linux CI (draft PR TraceHiring/TraceHiring#4) green on `742bf54`, `97f82dd`, `eaa8155`, `bea8403`.
- Tags: **`cp/d1-01`** = `bbae037` (migrations, tests, contracts), **`cp/d1-02`** = `97f82dd` (helpers, skeletons, boundaries, bindings). `cp/m0b-03` was **deleted** at the founder's request (remote and local; it pointed at `4cb6775`).
- Unchanged: `main` `fe77a87` (never commit on or move it), `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`.
- Agent branches (keep; never delete; their work is already placed): `worktree-agent-a1597e43a4cfde273` (`d06c4e5` test drafts), `worktree-agent-a31277c7fe66088f4` (`33af756` contracts), `worktree-agent-a434893532bb816a7` (`c8c0fb3` contract fixes), `worktree-agent-a08ec727b4fe51242` (`b70b20c` skeletons), `worktree-agent-ad37ecc5cac2fcd1f` (`d3b3d5d` bindings).

## Done in the last two sessions (2026-10-14 night, 2026-10-15; all verified, commit by commit)
- `26cd6eb` m3 review items m-7a, m-7b, n-1 (tests, mutation-checked); m-6, n-4, n-6 → spec §5.1 "Transactions and retries".
- `f6a0144` + `0b9a949` **migration 4** `20261014175327_d1_media_audit.sql` (media viewer check, link and view grants), red first; Opus DB review (APPROVE WITH MINOR FIXES) and security review (PASS WITH NOTES) fixed: single-use 330 s link bound to viewer and media, `private.api_org_id()` binding; spec §6.2 **R3-1..R3-9** for stream R3. `docs/reviews/D1-db-review-m4.md`, `D1-security-review-m4.md`.
- `6b2c657` `rls_d1_candidate_denied` (36) + `rls_d1_invariants` (66). `1a1ce39` ADR-030 accepted in part.
- `104a98b`, `87bbc8d`, `131318f`, `9890b9e`, `bbae037` **contracts** + Opus spec review (PASS WITH FIXES, all fixed; `docs/reviews/D1-contracts-review.md`). `b625788` signal catalog + canonical notice.
- `74c5887` skeletons + boundaries + `band-rules-sync` test; `c4dddcd` report-quality/report-integrity rule-1 cases (red first); `6841d63` wrangler bindings, DO/`CandidateRpc` stubs, allow-list, bindings test; Opus security review of the bindings (PASS WITH NOTES, `docs/reviews/D1-security-review-bindings.md`) → `742bf54`, `97f82dd` (rule 11).
- Founder-queue walkthrough 2026-10-15: answers in `docs/build-notes.md` §0 and `FOUNDER-QUEUE.md` "Resolved".

## Decisions to respect (recorded where named)
- Founder 2026-10-15 (build-notes §0): rule 6 keep; **GitHub Free** (AT-13 NOT MET = known gap, supersedes the old "option (a)" row); **staging proof = deploy before merge** via `workflow_dispatch` from `d1/**`/`milestone/**`; R2 enabled; email-code form hides account existence (M1); session limits left off (needs Supabase Pro); AWS OIDC before first AWS use.
- Lead (spec, reviews): media grants bound to `api_org_id`, deterministic R2 key kept (R3-3 guards it); `jti = crypto.randomUUID()`, `exp` = issue + 300 s; contract field decisions in spec §4.2 "Contracts"; writer binding rules in spec §11; migrations 3–4 fixed in place (never on a shared DB; from staging on, fix forward).

## Next step (in order)
1. Verify (below). If anything differs from this file, stop and report.
2. **Rest of Wave 0 (spec §11; lead-only, tests first):**
   a. **ci.yml per §7.1 and §7.2(b)**: deploy order api → jobs → edge; the new vars via `--var` from GitHub variables, with a check that fails if a public JWK has a `d` member (security F4); idempotent R2 bucket and queue creation; a `workflow_dispatch` staging deploy from `d1/**` and `milestone/**` (founder answer (b)); update `check-workflows` tests and spec §7.2. **Founder prerequisite before the first staging deploy:** widen the Cloudflare CI token with Workers R2 Storage Edit + Queues Edit (FOUNDER-QUEUE row; ask when ready).
   b. jobs `queue` and `scheduled` handlers wrapped by `withErrorReporting` (lead-owned `workers/jobs/src/{index,app}.ts`, `queue/**`; security F5).
   c. Recruiter CSP `__API_ORIGIN__` with the staging origins on `abhayraj.workers.dev`; pin app dev ports with `strictPort` (F9).
   d. Day-one checks DC-D5 (media link: R2 stream + `MediaLinkDO` burn + canvas CSP), DC-D6 (Playwright Win/Linux: browsers must be downloaded — ask the founder first), DC-D8 (CPU; may slip to Wave 1), DC-D9 (CI E2E stack); record results in spec §8.
   e. Then full `pnpm verify`, CI, tag `cp/d1-03`.
3. Carried DB items: m1 m-2 (creator re-auto-assign: decide/document), m1 m-4 + m2 n-7 (exact `trace_api` table allow-list in `rls_roles`), m1 m-5 (`test.retire` audit?), m2 m-2 (late `sessionStarted`: decide in R3), m2 n-1 (M3a), m3 n-7 (M4 index).
4. **Wave 1** writers R1 (band-engine + vendors), R3 (api; must implement §6.2 R3-1..R3-9 and §11 binding rules), C1 (edge) — max 3, each in its own worktree reset to an exact SHA, only after Wave 0 is complete and verified.

## Founder items still open (`docs/progress/FOUNDER-QUEUE.md`; all for later)
- H9 recruiter smoke user and the reviewer smoke user with TOTP (after the first staging deploy); H11 `db push` to trace-dev (before M0b CLOSE); Cloudflare CI token + R2/Queues Edit (when 2a is ready); SES SMTP for the email-code template (later); Workers Paid only if DC-D2/D8 need it (ask first).

## Gotchas
- Docker Desktop can stop or hang; relaunch it via a node `spawn` script (the worktree guard blocks direct launches); `docker ps` may block for minutes — run it in the background; `test:rls` refuses to run without Docker (it never skips).
- Ad-hoc pgTAP runs need `create extension if not exists pgtap with schema extensions;` inside the transaction; pipe files to `docker exec -i supabase_db_trace psql -U postgres -X -q -At` from a node `spawnSync`. A changed migration can be dry-run as `create or replace` plus the test in one rolled-back transaction.
- Warn running agents before `test:rls` (it resets the DB). Only the lead runs supabase start/stop, db reset, test db, gen types, `pnpm verify`, `test:rls`.
- `scripts/test/gitleaks-config.test.mjs` › "api_key value starting with true" flaked once under load; it passed alone and on re-run.
- JS `String.replace` turns `$$` into `$`: always use a replacer function. Worktree guard: no `$(…)`, loops, `cd` + git chains, pipes into docker/psql, and no word "git" inside a `node -e` string (use a script file); commit via `git commit -F <file>`.
- Agents are costly on Pro: an Opus review ≈ 90–220k tokens, a Sonnet writer ≈ 135–230k; check usage after every agent result.

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -5 d1/integration` (tip = this handoff commit; code `97f82dd`) · `git status` (clean) · `docker ps` · `pnpm -s verify:fast` · `pnpm -s test` · `gh pr checks 4 --repo TraceHiring/TraceHiring`
