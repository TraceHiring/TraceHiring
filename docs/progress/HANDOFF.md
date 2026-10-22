# HANDOFF — 2026-10-22 16:35 IST (Chat E3 part 2: Hyperdrive live on staging; e2e-staging red at the candidate step)
Reason for stopping: context ~50% (founder rule) after the first green Hyperdrive deploy. Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`**. The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (`main` still `fe77a87`). M0a and M0b built, reviewed, fixed, **not CLOSED**. The founder now wants them closed (see "M0a/M0b CLOSE").
- **D1 ≈ 98%**: code merged and reviewed; staging deploy green through Hyperdrive; `e2e-staging` (AT-D1) red at steps 5-6; DC-D8, AT-D2, `cp/d1-10` open.

## Where we are (verified this chat)
- **`d1/integration` HEAD = `df85dd4`** (+ this handoff commit). Clean tree. Pushed.
- Last fully green: `df85dd4` in CI dispatch run **39762460219**: static, rls, security, migrations, e2e-local and **deploy-staging** all green. **e2e-staging failed**.
- Full local `pnpm verify` green on `8c3c725` (typecheck, lint, all package suites, scripts 2707 + 1 skipped, test:rls rls 2633 / catalog 144, build + scan-dist).
- Local `verify:fast` on `d491164`: typecheck, lint and 2712 tests green. One fail was the known `scan-dist.test.mjs` random-value flake (passes alone; file unchanged since `6ffe4e1`).
- **Repo TraceHiring/TraceHiring is PUBLIC** (founder, 2026-10-22, to lift a GitHub Actions billing block).
  - Actions run unlimited now.
  - Secret scanning and push protection are on.
  - 16 open secret-scanning alerts are **false positives**: the `gcp-api-key` allowlist in `config/gitleaks-8.30.1/gitleaks.toml:619-634`, identical to upstream v8.30.1 (checked). The founder was asked to close them as false positive.
  - The founder is creating a `main` ruleset. Advised settings: name, Active, target the default branch, PR required, checks static/rls/security/migrations/e2e-local, block force push, restrict deletion. **Not yet saved when checked** (`gh api repos/TraceHiring/TraceHiring/rulesets` returned none).

## Done this chat (all on d1/integration, each with tests)
- `f0be0ff` merge of writer branch `d1/e3-ops-hyperdrive` (`46511ae`): ops script writes the Hyperdrive configs via the Cloudflare API; allow-list without `*_DB_URL`; runbook.
- `2cc718a` ADR-031 **amendment 1** + spec **revision 4o**.
- Opus security review **PASS WITH NOTES** and Opus database review **APPROVE WITH MINOR FIXES**. Fixed test first:
  - `79e2fd9` local-URL guard refuses multi-host or multi-`@` URLs; `[::1]` dropped; mid-transaction loss test.
  - `4826152` login roles get statement_timeout 15s, lock_timeout 10s, idle_in_transaction 30s; test:rls 5d checks 32.
  - `e73a12a` the db-test drives `withStageConnection` on a real login.
  - `ec35987` the db-test harness uses the same guard.
- Sonnet re-reviews CONFIRMED WITH NOTES (all in `docs/reviews/D1-review-chat-e3.md`).
- `8c3c725` + `42f7757` time-boxed osv ignores for `@vitest/mocker` 4.1.11 (GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp), expiry 2026-11-05. **Bump the vitest catalog to 4.1.12 on or after 2026-10-29** and delete both osv entries (root and `docs/spikes/d1-day-one/osv-scanner.toml`).
- Founder ops run:
  - CA uploaded, id `25874502-5895-4d21-b525-f91de4f07a37`.
  - First runs failed with Hyperdrive **2013**: the Supabase pooler caches credentials briefly after the rotation. Fixed by `5fb9a28` (20 s settle wait, then 2013-only retries after 30/45/60 s, at most 8 per run).
  - The final founder run succeeded (each config needed one 30 s wait). The configs, the passwords and `MEDIA_LINK_HMAC_KEY` are in sync; the retired URL secrets are gone.
- `16a6aa1` the four Hyperdrive ids in env.staging (api `API_DB` 1063006219694669b2a7417f307164fd; jobs `JOBS_MIRROR_DB` 784e4dee7f0c4119b482340d48f6089d, `JOBS_QUALITY_DB` 29d5817a3e7f42c5ab5433f56ce0e4d5, `JOBS_INTEGRITY_DB` e7200fda374f4caf9169b3c3163f636f). `wrangler-bindings.test.mjs` now uses `requireStaging: true`.
- `d491164` regenerated `worker-configuration.d.ts` (api, jobs; `--strict-vars=false`).
- `df85dd4` blur test: count the alpha check instead of ~180k expects (it timed out on the GitHub runners).
- Tag **`staging-applied-39762460219`** = `df85dd4` (pushed; the migrations were applied by that dispatch).

## In progress (exact): e2e-staging red (AT-D1)
- **Run 39762460219, `e2e/tests/d1-slice.spec.ts`:** steps 1-4 green. That proves the api reaches Postgres through Hyperdrive: recruiter sign-in, publish, assign, invitations.
- **Steps 5-6 (line ~676) failed:**
  - A and B never showed the heading "Confirm it is you".
  - C, D and E showed it but never "We sent a 6-digit code to your email".
  - Every expect uses the default 5 s timeout.
- Steps 7-10 were skipped.
- **Artifacts:** `e2e-staging-results` (manifest, error-context, 7 videos) on the run. No page snapshot.
- **Diagnosis in progress:** an Opus investigator was running at handoff time; see "Investigator result" below if it is filled in.

## Next step (one precise action)
1. Read the investigator result below (or redo the diagnosis): find why the candidate invite/OTP path fails on staging. The path is candidate app → edge invite/resolve and otp/request → API service binding → CandidateRpc → API_DB through Hyperdrive.
2. Fix it test first, verify:fast, push, CI, and re-dispatch (`gh workflow run ci.yml --repo TraceHiring/TraceHiring --ref d1/integration`).
3. When e2e-staging is green: DC-D8 (CPU per invocation from Cloudflare analytics), then ask the founder for the AT-D2 capture (spec 4n §7.3, `pnpm e2e:record`).
4. Tag `staging-applied-<run id>` per dispatch that applied migrations, then **`cp/d1-10`**, then push.

## M0a/M0b CLOSE (founder asked 2026-10-22; separate chat, one phase per chat)
- M0a was BLOCK only on SEC-1 (branch protection) and SEC-2 (secret scanning). Both are now possible on the public repo; SEC-2 is done. SEC-1 is done once the ruleset is saved and Active (read it back with `gh api`).
- M0b: PASS WITH CONDITIONS. AT-B9 (org sign-in on staging) and AT-B10 (migrations from CI) are met by dispatch 39566827826 and again by 39762460219.
- **Needs the founder's explicit go-ahead in chat before any merge to `main`.** Then:
  1. Update the reviews.
  2. Write `docs/milestones/M0a-summary.md` and `M0b-summary.md`.
  3. Merge `milestone/m0a` into `main` via PR (green checks) and tag `m0a-reviewed`.
  4. Then do the same for `milestone/m0b` and tag `m0b-reviewed`.
- Pre-flight checklist: see "CLOSE pre-flight" below.

## Decisions made this chat
- Staging Postgres only through Hyperdrive: one config per login, verify-full with the uploaded CA, caching off, origin limit 5. URL secrets are local-only and the Worker does no TLS. Recorded in ADR-031 amendment 1 and spec 4o.
- The ops script waits out the Supabase pooler credential cache (spec 4o §7.1, runbook "If it fails").
- osv ignores are time-boxed until vitest 4.1.12 passes the release-age rule (`docs/build-notes.md` Autopilot changes 2026-10-22).

## Founder items
- Save the `main` ruleset (Active, default-branch target) and close the 16 false-positive alerts.
- Go-ahead for the M0a/M0b CLOSE.
- AT-D2 screen capture after e2e-staging is green.
- Optional: Dependency graph and Dependabot alerts on; fork-PR approval for all outside contributors.

## Gotchas
- **Read a command's own exit code:** a background `cmd; echo exit $?` reports the echo. Check the tool's printed result line (`verify:fast: FAILED/OK`). This chat misreported a red verify:fast once.
- After any wrangler binding change, run `pnpm exec wrangler types --strict-vars=false` in that package (typecheck runs `wrangler types --check`).
- Do not re-run `staging-worker-secrets.mjs` without need: it rotates the passwords, and the Supabase pooler caches the old ones (2013). If needed, run it once and let it wait.
- pnpm 12 ignores `npm_config_workspace_concurrency`; run tests with `pnpm -r --workspace-concurrency=1`.
- The worktree guard refuses `cd` + git in one command and heredocs containing "git"; use `git -C <abs path>` and the Edit tool.
- postgres.js 3.4.9 throws an uncaught TypeError from a timer after a mid-transaction connection loss (pinned in `pg-socket.test.ts`); watch for it in the staging Worker logs.

## Verify first
`git fetch trace` · `git log --oneline -3 d1/integration` (this handoff, parent `df85dd4`) · `git status` · `gh run view 39762460219 --repo TraceHiring/TraceHiring` · `gh api repos/TraceHiring/TraceHiring/rulesets` · `npx vitest run --root packages/workers-http` (80)

## Investigator result (e2e-staging)
(pending at handoff time)

## CLOSE pre-flight
(pending at handoff time)
