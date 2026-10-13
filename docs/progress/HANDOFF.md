# HANDOFF — 2026-10-13 16:10 IST
Reason for stopping: usage — the 95% rule (wrap-up started at ~80% of the 5-hour window, Pro plan, resets ~18:20 IST; weekly ~54%).
The next session may be a new Claude Code on another account: start from `docs/progress/RESUME-PROMPT.md` on **`m0b/integration`** (its §4 paste prompt).

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M8 = closed beta → M9 … M13)
- Milestones closed: **0 of 17** (no `m*-reviewed` tag). Rough share of the whole build done: ~10% (M0 ≈ 1/9 of the effort).
- **M0a: REVIEW + FIX done, stopped before CLOSE** (founder). `milestone/m0a` @ `7dc8c0d` = `cp/m0a-06`.
- **M0b: BUILD is complete** (B0–B5 all merged into `m0b/integration`). Next phase: **M0b REVIEW** in a fresh session (`trace-milestone-review`). M0b closes only after `m0a-reviewed`.

## Where we are
- **`m0b/integration`** (worktree `.claude/worktrees/m0b-integration`; enter it with `EnterWorktree` path) tip = this handoff commit on top of `3e5ffbe` (fix(ops): libpq variables). **`3e5ffbe` may not be on the remote yet**: the last push failed on a DNS error at 16:07; the wrap-up push below retries it.
- `milestone/m0b` @ `fc20864` = `cp/m0b-01` (B0/B1/B3/B5 merged; full verify + Linux CI green). Not moved since: move it to the new tip (and tag `cp/m0b-02`) only after Linux CI is green on it.
- Draft PR **TraceHiring/TraceHiring#3** (`m0b/integration` → `main`, CI only, never merged; Auto-fix is on in the app). CI on `0fdcf34`: static/security/migrations green, **`rls` red** — AT-B8 `create-org failed` on Linux: libpq ignores a URL in `PGDATABASE`. Fixed in `3e5ffbe` (URL split into PG* variables; proved with a real psql). **First action: push, then confirm `rls` is green.**
- Full local `pnpm verify` green on `0fdcf34` (16:00, no agent running): scripts 1548 + 1 skipped (Windows symlink), packages all green, test:rls catalog 133 / rls 686 + AT-B8 OK, build + check-headers + scan-dist OK. On `3e5ffbe`: scripts 1552 + 1 skipped and `pnpm test:rls` (with AT-B8) green; the full verify was not re-run (only scripts/ changed).
- The local stack now runs **db, auth, kong, rest, mailpit** (the harness keeps them on for AT-B8).
- Stream branches (all merged, keep): `m0b/b0-db` `dc4731a`, `m0b/b2-recruiter-auth` `91092ac`, `m0b/b2-fixes` `8f47fff`, `m0b/b4-smoke-auth` `04013ea`, plus the older `b0-rls-tests`, `b3-token-spike`, `b4-ops-scripts`, `b5-*`.
- `milestone/m0a` @ `7dc8c0d`, `m0a/integration` @ `c619525`, `main` @ `fe77a87` (unchanged).

## Done this session (verified)
- Resume check: repo matched the handoff; `verify:fast` red once on an ESLint cold-load timeout (fixed `fc20864`: warm-up in `beforeAll`).
- B0 Lows DB4, DB6 (`5de28dd`), SEC2, SEC3 (`fd74f50`) fixed test-first; `m0b/b0-db` merged `36d2db5`; full verify green; `cp/m0b-01`; draft PR #3 opened, Linux CI green.
- B4 (lead): supabase-js 2.117.2 (`70a1f4b`); check-headers one origin per entry (`e884e79`); recruiter `_headers.template` + `@trace/config/vite/headers` plugin (`ab99f5c`); check-workflows `BUILD_ONLY_ENV` + smoke secrets, ci.yml build vars + smoke step, M0a spec rev 18 (`d2a0d42`); AT-B8 `scripts/test-auth-local.mjs` in `test:rls` with kong/postgrest/mailpit (`b9c4173`); **auth config bug found by AT-B8 and fixed**: `[auth.email] enable_signup` is the CLI's email-provider switch (now `true`; sign-ups stay off via `[auth] enable_signup = false`, proved live).
- B4 smoke (Sonnet writer): `scripts/smoke-staging-auth.mjs` (AT-B9), merged `f3a34ea`.
- B2 (Opus writer + Sonnet fixer): recruiter sign-in UI, 204 tests; merged `7f64376`. CSS class `.secret` renamed (gitleaks false positive in dist).
- Reviews (Sonnet): B4 security CHANGES REQUIRED → SEC-1, SEC-2 (Medium) fixed, SEC-3 fixed, SEC-5 fixed with the libpq change; B2 security PWF (5 Low), B2 spec PWF (2 Medium fixed + 3 Low fixed). Record: `docs/reviews/M0b-B2-B4-review.md`.
- Spec `specs/m0b-tenancy.md` revisions 6 and 7; build-notes autopilot-changes row.

## Next step (in order)
1. Done at 16:20: `3e5ffbe` and this handoff (`e2e58b3`) pushed; **Linux CI run 38385004124 on `e2e58b3` is green, `rls` with AT-B8 included.**
2. **Done 18:22 IST:** full `pnpm verify` green on `4cb6775` (no agent running) and Linux CI green on it → `milestone/m0b` fast-forwarded to `4cb6775`, tag **`cp/m0b-02`**, both pushed. (Was: move `milestone/m0b` forward only (never rewrite): `git fetch . m0b/integration:milestone/m0b` (git refuses a non-fast-forward), after a full `pnpm verify` with no agent running and green CI on that SHA; tag `cp/m0b-02` there; push both.
3. **M0b REVIEW** in a fresh session: `trace-milestone-review` → `docs/reviews/M0b.md` (Opus reviewers for rules 1–9 areas: RLS/tenancy, auth, audit). Open Lows to carry: B0-DB3, DB5, DB7, SEC4(timebox), SEC5–SEC8, SP3–SP7; B4-SEC-4, SEC-6; B2-SEC-1, SEC-4, SEC-5 (owners in the review records).
4. Do not merge into `main`, tag `m0*-reviewed`, or CLOSE: founder gates (FOUNDER-QUEUE).

## Decisions made this session (HOW-level, AUTOPILOT §4)
- One full verify on the B0 merge commit instead of before and after (stream tip was already green).
- CSP template outside `public/`; its plugin in `@trace/config/vite/headers` (config files may not touch fs).
- Staging smoke script written by a Sonnet writer owning only its two files (scripts/ is lead-only in spec §11; same exception as the ops scripts).
- B2 reviews and fixes by Sonnet (Opus writer for B2 itself) for budget; B2-SEC-5 (account enumeration on the OTP form) left as spec says, FYI to founder.
- Redactor timing tests (`packages/shared/src/log/redact.test.ts`, 50 ms budget) failed 6× at 51–62 ms under load at 15:35; pass when idle (141/141). Not weakened.

## Open questions for the founder (`docs/progress/FOUNDER-QUEUE.md`)
- Unchanged: GitHub plan (row 15, blocks M0a CLOSE); H8–H11 (row 20); URGENT Cloudflare token roll, `CLOUDFLARE_API_TOKEN`, `SUPABASE_STAGING_DB_URL`, H4, H5.
- New (rows added this session): **H8 must keep the email provider ON** with sign-ups OFF on staging; B2-SEC-5 account-enumeration UX (FYI).

## Gotchas / do not touch
- Only the lead runs `supabase start/stop`, `db reset`, `test db`, `gen types`, `pnpm verify`, `pnpm test:rls`; full verify **with no agent running** (timing tests).
- `node scripts/test-auth-local.mjs` standalone needs `pnpm exec supabase db reset --local` first (fixed synthetic users).
- After a config.toml change: `pnpm exec supabase stop` then `pnpm test:rls` (start reloads config).
- Worktree guard: no `git -C`, `$(…)`, loops/pipes around git; plain separate commands. Python/node fixers go in the scratchpad (shell quoting mangles backslashes).
- Run the **full** `vitest --root scripts` after any ci.yml change (deploy-staging-job.test.mjs pins the job).
- Push: `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push trace <refs>`; same `-c` pair for fetch.

## Verify first
- `git fetch trace` (with the `-c` pair) · `git log --oneline -3 m0b/integration` · `git status` · `docker ps` · `pnpm -s verify:fast` · PR #3 checks
