# HANDOFF — 2026-10-16 ~17:30 IST
Reason for stopping: usage guard — the founder asked to work to 95% of the 5-hour window; stopped new work at ~83% so the wrap-up fits (Pro plan). Next session may be on another account.
Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt). The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (no `m*-reviewed` tag, `main` still `fe77a87`). M0a and M0b are built, reviewed and fixed but **not CLOSED**. **D1 ≈ 40–45%**: Wave 0 is done except DC-D9 (+ DC-D6 Linux) and three Low hardening items; M1–M13 not started.
- **Path to close M0a and M0b:** the staging deploy is now built (ci.yml + key script + guard). Founder: widen the Cloudflare token (R2 + Queues Edit), run the key script and set the `staging` variables (`CANDIDATE_TOKEN_KID`, `CANDIDATE_TOKEN_PUBLIC_JWK`, `API_STAGING_ORIGIN`) and the api secret; then a `workflow_dispatch` from `milestone/m0a` / `milestone/m0b` (migrations to trace-staging, H9 smoke user, AT-11/AT-B9 smoke), H11 on trace-dev; re-run `trace-milestone-review` for each, write the summaries, merge `--no-ff` into `main`, tag `m0a-reviewed` / `m0b-reviewed` — **each merge only with the founder's explicit go-ahead**. Fix S2 and S6 (below) before the first dispatch.
- **Current phase: D1 BUILD, Wave 0 (lead-only).**

## Where we are (verified at handoff)
- **`d1/integration`** (worktree `.claude/worktrees/d1-integration`), clean; this handoff commit is the tip. Code tip = the `fix(ci): jwk guard allow-list…` commit (S3/S7/S8).
  - **Full `pnpm verify` exit 0 on `6640b42`** (the placed ci rework): scripts 2047 passed + 1 Windows-only skip, rls 2616 = floor, catalog 142, db-types current, build/bundle/headers/scan OK. CI green on `cfd3a67`; CI on `1594c53` (= 6640b42 + docs) was running at handoff — check it.
  - After `6640b42`: scripts-only security fixes (guard 73 tests, workflow + deploy-job + guard 564 passed, check-workflows OK); **`verify:fast` exit 0 on `dc2d08d`** (217 s; typecheck, lint, test). Not yet run in CI: push happened at wrap-up.
- Tags: `cp/d1-01` = `bbae037`, `cp/d1-02` = `97f82dd`. **`cp/d1-03` not yet tagged** (wait for DC-D9 and S2/S6, then full verify + CI on the tip).
- Unchanged: `main` `fe77a87` (never commit on or move it), `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`.
- Playwright Chromium 1.63.0 (`chromium-1243`) installed locally; download approved by the founder (local and CI).
- Writer branches (all placed; keep, never delete; pushed): `worktree-agent-a451893e288445e5c` (key script), `worktree-agent-a5a448b74d436d19a` (ci rework, `256306e`), `worktree-agent-a59431baa68efcdfb` (CSP, `958e1e4`), `worktree-agent-a9c30de5fc651e33c` (DC spike, `6922b28`).

## Done today (2026-10-16, verified, commit by commit)
- `cfd3a67` carried DB items: creator auto-assigned on the test's first publish only (m1 m-2), `test.retire` audit (m1 m-5), exact `trace_api` allow-list (m1 m-4 / m2 n-7); rls 2616; CI green.
- `9429559`, `19152dc`, `e0121f3` **ES256 key ops script** `scripts/ops/candidate-token-key.mjs` + `scripts/ops/README.md`; the public variable is **always a JSON array, signing key first** (spec §4.3).
- `14dea42`, `14782e4`, `511713d`, `0f842cf` **recruiter CSP `__API_ORIGIN__`** (`VITE_API_ORIGIN`, staging-only regex in plugin + check-headers) and **strictPort** 5173/5174 (F9); e2e default URL 5174; new founder variable `API_STAGING_ORIGIN`.
- `3a50093`, `cac21d6`, `6030a30` + spec commit: **DC-D5 PASS** (R2 stream, atomic single-use burn, HMAC, Chromium canvas + `data:` under the recruiter CSP) and **DC-D6 PASS on Windows**; results in spec §8, media findings in R3-6. DC-D8 moved to Waves 1–2 (spec §8).
- `5a775e8`, `6640b42` **staging-deploy rework**: S3B-1 now enforced by `check-workflows` (exact `dist/index.js --no-bundle` deploys, scan before deploy), 15-state chain pinned, array-only JWK guard, `VITE_API_ORIGIN` build var, wrangler `--var` JSON proof. The old revert reason ("re-bundled") was wrong and is corrected (spec §11, `D1-security-review-ci-jobs.md`, m0 spec §7.2 note).
- **Opus security review** `docs/reviews/D1-security-review-wave0-rest.md`: **PASS WITH NOTES**. S3, S7, S8 fixed (`fix(ci): jwk guard allow-list…`); S4 fixed in the runbook (two-phase rotation); S1 Medium = founder gate (GitHub Free known gap, FOUNDER-QUEUE row); **S2, S5, S6 open (Low)**.

## Next step (in order)
1. Verify (below). If anything differs from this file, stop and report.
2. **Finish Wave 0 (lead-only files; tests first; at most 2 agents at once on Pro):**
   a. **S2** (check-workflows): in deploy-staging flag any line with both `wrangler` and `deploy`; pin each Worker deploy step's whole run text; forbid `cd`, `pushd`, `--cwd`, `-c`/`--config`, `dlx`, `npx` in Worker deploy steps. **S6** (`ensure-staging-resources.mjs`): after an "exists" result confirm with `wrangler r2 bucket info` / `wrangler queues info` (check the bucket location); match only wrangler's error line. **S5** (key script): on win32 refuse an out-dir outside `%USERPROFILE%` or apply owner-only `icacls`. Details in the review record.
   b. **DC-D9 + DC-D6 Linux:** an `e2e-local` CI job (Ubuntu; on `workflow_dispatch` and on the draft PR from `d1/**`, not every PR; no secrets) and `scripts/e2e-local.mjs` (supabase start + db reset, the three Workers under one multi-config `wrangler dev`, both apps via `vite preview` on 5173/5174, Playwright with the DC-D6 checks) inside 25 minutes; `run_e2e` input; check-workflows + its tests updated first; record DC-D9 and the DC-D6 Linux half in spec §8.
   c. Full `pnpm verify`, push, CI green, tag **`cp/d1-03`**.
3. Carried DB items still open: m2 m-2 (late `sessionStarted`, decide in R3), m2 n-1 (M3a), m3 n-7 (M4 index), m2 n-7 two-connection mirror test (R2, AT-D16).
4. **Wave 1** writers R1 (band-engine + vendors), R3 (api: §6.2 R3-1..R3-9 incl. the new R3-6 items, §11 binding rules, sign with the private JWK's own `kid`, parse `CANDIDATE_TOKEN_PUBLIC_JWK` as the §4.3 array), C1 (edge) — only after Wave 0 is complete and verified. DC-D8 runs with R2/R3.

## Decisions today
- Founder (2026-10-16): proceed on `09ccfa4`; Chromium download approved (local and CI); work to 95% of the 5-hour window.
- Lead: public JWK var = JSON array, signing key first (spec §4.3); creator auto-assigned on first publish only, `test.retire` audited (spec §3.2/§3.4); no `push: d1/**` trigger (spec §7.1); DC-D8 in Waves 1–2 (spec §8); `API_STAGING_ORIGIN` pinned to `https://trace-api-staging.abhayraj.workers.dev`; two-phase key rotation (README; R3 signs with the private JWK's `kid`).

## Founder items (`docs/progress/FOUNDER-QUEUE.md`)
- **Before the first staging dispatch:** widen the Cloudflare token (R2 + Queues Edit); run `node scripts/ops/candidate-token-key.mjs --kid d1-2026-10 --out-dir <folder in your user profile, outside the repo>` and follow `scripts/ops/README.md`; set `staging` variables `CANDIDATE_TOKEN_KID`, `CANDIDATE_TOKEN_PUBLIC_JWK`, `API_STAGING_ORIGIN`; then the autopilot asks before dispatching.
- S1 residual risk (GitHub Free): required reviewer on `staging` when a paid plan arrives. H9, H11, SES SMTP, Workers Paid only if DC-D2/D8 need it; the five "Review rec." rows (not due).

## Gotchas
- **Usage on Pro:** each Opus/Sonnet agent run or resume costs ~10–15% of the 5-hour window; the lead's own calls cost ~1% each once the context passes ~400k tokens. Run at most 2 agents; check `get_usage` after each result.
- Parallel agents running test suites can exhaust memory (`JS heap out of memory`, `VirtualAlloc failed` in workers/jobs and edge tests): re-run the package alone before suspecting the code.
- A network error (`ENOTFOUND`) can kill all agents at once; `SendMessage` to the agent id resumes it with context.
- Only the lead runs supabase start/stop, db reset, test db, gen types, `pnpm verify`, `test:rls` (warn agents first). Ad-hoc pgTAP: add `create extension if not exists pgtap with schema extensions;` after `begin;`, feed `docker exec -i supabase_db_trace psql -U postgres -X -q -At` from a node `spawnSync`.
- Worktree guard: no `$(…)`, loops, heredocs, `cd` + git chains, or the word "git" inside `node -e`; write files with the Write tool and apply them with a small node script; commit via `git commit -F <file>`; commitlint lines ≤ 100 chars.
- `scripts/test/scan-dist.test.mjs:710` skips on Windows only (symlink EPERM); it runs on Linux CI.

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -5 d1/integration` (tip = this handoff commit) · `git status` (clean) · `docker ps` · `pnpm -s verify:fast` · `gh pr checks 4 --repo TraceHiring/TraceHiring`
