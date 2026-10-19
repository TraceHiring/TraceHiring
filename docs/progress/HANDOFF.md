# HANDOFF — 2026-10-19 15:45 IST (end of Chat E, part 1)
Reason for stopping: **blocked on the founder staging gates** (AUTOPILOT §3.1) with everything unblocked done: Chat E's lead work and R5 are merged, verified and green; the first staging dispatch waits for the founder. Claude Max: one chat = one big task (`docs/progress/SESSION-PLAN.md`). Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt). The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (no `m*-reviewed` tag, `main` still `fe77a87`). M0a and M0b are built, reviewed and fixed but **not CLOSED** (founder gates, "Path to close" unchanged).
- **D1 ≈ 96%**: Wave 0 (`cp/d1-03`) … C2 + e2e-local (`cp/d1-09`), **Chat E lead work + R5 merged (no tag yet)**. Left: the staging half of Chat E (founder gates → dispatch → smoke → DC-D8 → e2e-staging → `cp/d1-10`), D1 REVIEW (F), FIX + CLOSE (G).
- **Current phase: D1 BUILD, Chat E — staging half next ("Chat E2").**

## Where we are (verified this chat)
- **`d1/integration`** = `1887400` + this handoff (pushed). **Full `pnpm verify` exit 0 on `1887400`** (candidate 246, recruiter 366, edge 417, api 403, jobs 240, shared 1180, scripts 2531 + 1 skipped; test:rls 32 files, rls 2616, catalog 142, jobs db tests, new step 5d staging login-role SQL; build, bundle, headers, no-demo-outbox, scan-dist OK). **e2e-local on this machine: 27 passed incl. all 10 D1 slice steps** (trial merge, 1.4 min). **CI on PR #4 for `1887400`:** e2e-local (incl. the slice, Linux) pass, rls pass, security pass, migrations pass, **static was still running at handoff** — check it first.
- No `cp/d1-10` tag yet: the founder defined it as "staging deployed and smoked, AT-D1/D2 E2E green".
- Review record: **`docs/reviews/D1-review-chat-e.md`** (all streams, verdicts, dispositions). ADR-032. Spec revisions **4k** (`5cbb26a`) and **4l** (`e3f8923`).

## Done this session (merged into d1/integration, each with spec + security review, fixes test first, confirming re-review)
- **W1 OPEN-13** (`d1/open13-edge-limit` → merges `502737e`, `2704e1b`): Workers Rate Limiting binding `LINK_LIMITER` (dev ns 1101, staging 1102, 300/10 s) on `invite/resolve`, `otp/request|verify`, constant per-route keys (never IP), 429 `rate_limited` + Retry-After 10, fail closed 503, throttled logs; candidate app waits Retry-After on a rate-limited resolve (cap 60 s). Lead: ADR-032 (`b4ee74e`, `2db2226`), wrangler-bindings test (`c2ccf66`). **SEC-W1-1 (Medium, availability per location) accepted for D1, owner M3a.**
- **W2 R4 note 1 + local headers** (`d1/recruiter-env-local` → `f0d6749`): recruiter `main.tsx` named env fields; outbox only with `VITE_DEMO_OUTBOX=1` AND `VITE_TRACE_ENV` exactly `dev`/`staging` (allow-list; staging Build sets `VITE_TRACE_ENV: staging`, pinned); headers template accepts loopback origins only for `VITE_TRACE_ENV=dev`; e2e-local builds the recruiter with sign-in config (no anon-key fallback).
- **W3 staging logins + secrets** (`d1/staging-secrets-script` → `653def6`): `scripts/ops/staging-worker-secrets.mjs` (four login roles create-or-alter with a local SCRAM verifier, TR001/TR002, pooler URLs, pinned staging ref, wrangler log env hardened, values only on stdin); README "First staging deploy" checklist. Lead: `test:rls` step 5d runs the real SQL rolled back (`f3af009`).
- **W4 org CORS (N1)** (`d1/api-org-cors` → `4a11c66`): exact-origin CORS + preflight on `/v1/orgs/*`.
- **R5** (`d1/r5-slice` → `3222a82`; `d1/r5-ci` → `2823c7a`): `e2e/tests/d1-slice.spec.ts` (steps 1-10, rules 1, 2, 5-9 asserted, AT-D8/10/11(b)/12/13/14/17), helpers `e2e/support/{candidate-ui,recruiter-ui,report,caption,manifest,slice-env}.ts`, projects `local`/`staging`, record mode; CI job **`e2e-staging`** (dispatch only, `run_e2e`, `concurrency: deploy-staging`, preflight + Playwright, secrets on one step, artifact without zips), `scripts/e2e-staging-preflight.mjs` (`pnpm e2e:staging:preflight`, `pnpm e2e:record`), `enrol-smoke-user --roles reviewer`. Security review of W5 was BLOCK for staging (password in error-context, outbox by label) → fixed and CONFIRMED.
- Writer worktrees (keep): `agent-a00623ef953836b7a` (W1), `agent-a56dd7613548239b3` (W2), `agent-a502ecb867f8ae3d4` (W3), `agent-aa321bae80dc5e2f9` (W4), `agent-a7285839046a60212` (W5), `agent-a49c5849f1408769b` (W6), docs `agent-a8aef1e25800cf567`, `agent-a38413a59952a1716`. Scratch branch `d1/r5-trial` (local only, keep).
- Unchanged: `main` `fe77a87`, `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`; tags `cp/d1-01..09`.

## Next chat: **Chat E2 — staging half of Chat E.** Done when staging is deployed and smoked, DC-D8 measured, AT-D1 E2E green on staging (`e2e-staging`), `cp/d1-10` pushed.
## Next step (in order)
1. Verify (below). Check CI on PR #4 for `1887400` (static was pending at handoff); fix any Linux failure first.
2. **Founder gate, part (a)** — ask if not done (names only: `gh variable list --env staging`): widen the Cloudflare CI token (Account · Workers R2 Storage · Edit, Account · Queues · Edit); key script and the `staging` variables `CANDIDATE_TOKEN_KID`, `CANDIDATE_TOKEN_PUBLIC_JWK`; `API_STAGING_ORIGIN` = `https://trace-api-staging.abhayraj.workers.dev`. At handoff none of the three was set.
3. With the founder's OK: `gh workflow run ci.yml --repo TraceHiring/TraceHiring --ref d1/integration -f run_e2e=false`. Watch deploy-staging (the org sign-in smoke step stays red until H9). Unknowns proven here: `ratelimits` deploy permission/plan (ADR-032), R2/Queues creation.
4. **Founder gate, part (b)** (`scripts/ops/README.md` "First staging deploy"): private JWK `wrangler secret put` (only now: a missing Worker would be created as a draft); `staging-worker-secrets.mjs --dry-run` then `--yes` (proves DC-D7 staging half: Supavisor `<login>.<ref>`, TLS, `postgres` admin on `trace_*`); H9 recruiter smoke user + `STAGING_SMOKE_*`; reviewer smoke user `smoke-reviewer+staging@example.com` (`enrol-smoke-user --roles reviewer`) + `STAGING_REVIEWER_*`.
5. Dispatch again with E2E (`run_e2e` default true): deploy-staging green incl. org sign-in smoke; `e2e-staging` green (AT-D1 on staging); DC-D8 (CPU per invocation of mirror/quality/integrity/sweep/api RPC vs the Workers Free 10 ms limit; a Workers Paid need is founder gate OPEN-8a). Record results in `docs/reviews/D1-review-chat-e.md`, then tag **`cp/d1-10`**, push.
6. Carried, due later: **D1 REVIEW (Chat F):** SR-R5-3 (AT-D2: which recording file(s) form the 5-minute deliverable); re-review notes (no automated test for the SEC-W5-6 origin pin and SEC-W5-1 config switch; `D1_FLAG_FAMILIES` hand-copied; "IP address" regex unanchored; concurrency group not a perfect mutex, fails safe); `candidate-store.spec.ts` OTP lookup by label; `candidate-ui.spec.ts` token in goto URL (local only); README step 2 wording vs the red H9 smoke step. **M3a:** SEC-W1-1 (size the link limit from drives; guard behind api: concurrency cap / negative cache / Hyperdrive via ADR-031 amendment) plus the earlier M3a carries. All other carries from Chat D unchanged (C2 SEC-3/SEC-5/SEC-6, DB-6/7/12, C1b note 4, F3, RR-2/RR-4, h.stop, SEC-E4, M7 deletion, N3, n-4, n-1, n-7, O2, `MIRROR_TRANSPORT='service'`).

## Decisions this chat (ADR-032; spec revisions 4k, 4l; review record `D1-review-chat-e.md`)
- Edge link limit keyed per route, never per IP (rule 7, Indian CGNAT); fail closed; per-location trade-off accepted for D1.
- Demo outbox build: allow-list `dev`/`staging`, not "anything but production".
- Staging secrets: one operator script after the first deploy; the first dispatch runs with `run_e2e=false`.
- e2e-staging: dispatch only, shares the `deploy-staging` concurrency group, credentials on one step, no traces or zips in the artifact, verified TOTP checked before any page, every element's SHA checked at start and end.

## Founder items (`docs/progress/FOUNDER-QUEUE.md`)
- **Due now (Chat E2):** part (a) and part (b) above. Unchanged: Rule 9 correction question (M3a); S1 residual risk; H11, SES SMTP, Workers Paid only if DC-D8 needs it.

## Gotchas
- **Reviewers share the lead's worktree:** every brief says "git show / git diff only; never checkout, switch, stash or reset". The lead used `git switch -C d1/r5-trial` for trial merges and switched back before reviewers ran.
- Worktree guard: no heredocs, `$(…)`, loops or chained git in one command; `cd` into the worktree path, never computed paths. Node one-liners that write regexes: `\r?\n` inside a JS string in a bash single-quoted `node -e` becomes real CR/LF — use the Edit tool.
- commitlint: body lines ≤ 100 (a failed merge commit leaves MERGE_HEAD: finish with `git commit`).
- e2e-local ≈ 2 min here (27 tests); CI e2e-local ≈ 5 min.
- Short RAM: `npm_config_workspace_concurrency=1`; never two chats running verify or db commands at once.
- Usage (Chat E part 1): 4 Opus writers + 2 Opus R5 writers, 2 Sonnet docs writers, 5 Opus reviews, 2 Sonnet re-reviews, 1 Sonnet pre-flight, 3 e2e-local runs, 2 verify:fast, 1 full verify: 25% → 69% of one 5-hour window; weekly 18% → 24%; context ~42%.

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` (tip = this handoff) · `git rev-parse --short "cp/d1-09^{commit}"` (`986540f`) · `git status` (clean) · `docker ps` · `npm_config_workspace_concurrency=1 pnpm -s verify:fast` · `gh pr checks 4 --repo TraceHiring/TraceHiring` · `gh variable list --env staging --repo TraceHiring/TraceHiring` (names only)
