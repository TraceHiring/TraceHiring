# HANDOFF — 2026-10-21 14:45 IST (Chat G part 1 + the staging half run from the same chat)
Reason for stopping: hand-off between chats. Chat G part 1 stopped at the usage guard after D1-SPEC-1; the same chat then ran the staging half with the founder (part (b) done) and found a blocking staging defect. Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`**. The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (`main` still `fe77a87`). M0a and M0b are built, reviewed and fixed, but **not CLOSED** (founder gates).
- **D1 ≈ 97%**: code merged up to `cp/d1-09` + Chat E + Chat E2 part 1 + D1-SPEC-1. Left: D1 FIX (Chat G part 2), the Workers-to-Postgres TLS fix (Chat E3), the green staging e2e (`cp/d1-10`), CLOSE.
- **Current phase: D1 FIX** (1 of 4 groups done), plus one staging defect (below).

## Where we are (verified this chat)
- **`d1/integration`** = `5306928` (Chat G part 1 handoff) + this handoff. Code tip `c8a4911` (D1-SPEC-1).
- CI on PR #4, run 39544765317 on `5306928`: static, rls, migrations, security, e2e-local green. verify:fast on `5306928` passed in 267 s (Chat G part 2 attempt, idle).
- **Staging (founder gates all done):** token widened (R2 + Queues on the user token "TraceHiring"); part (b) done 13:05-13:36 IST (private JWK secret; `staging-worker-secrets.mjs --yes`: 4 logins and 5 secrets; recruiter and reviewer smoke users and their six GitHub secrets, names checked with `gh secret list`).
  - Dispatch 8, run 39559543112 (`run_e2e=false`, `5306928`): buckets + queues created, migrations + catalog checks, Workers and Pages deployed. Smoke failed only on the recruiter **per-deployment** Pages URL (first deployment of a new Pages project; both URLs answered 200 a few minutes later).
  - Dispatch 9, run 39566827826 (with e2e, `5306928`): **deploy-staging fully green, including "Smoke test, org sign-in"** (H9 / M0b exit-gate evidence). **e2e-staging red:** steps 1-3 passed (recruiter and reviewer aal2 sign-in, create + publish, assign); step 4 `POST …/invitations` timed out at 20 s; 6 tests did not run.

## Staging finding (blocks e2e-staging; root cause proven)
- **Workers cannot open TLS to Supabase Postgres.** Cloudflare `connect()`/`startTls()` validates the server certificate against public (WebPKI) roots, and both the pooler (`*.pooler.supabase.com`) and the direct host (`db.<ref>.supabase.co`) present certificates from the private **"Supabase Root 2021 CA"** (`openssl s_client -starttls postgres`: verify code 19). psql on the founder's PC works because `sslmode=require` does not verify the CA. ADR-031 listed "TLS to the staging session pooler" as not yet run.
- Effect: the handshake fails; `postgres` 3.4.9 (`cf/src/connection.js` `closed()`: `if (initial) return reconnect()`) reconnects in a loop. Jobs cron: `Too many subrequests by single Worker invocation` at `connect (cloudflare:sockets)` on every minute since the 13:47 deploy (`wrangler tail`, read-only; dashboard: 57 Uncaught Exception, 0 Exceeded CPU, so **Workers Paid is not needed**). The api invitation request (the first `API_DB_URL` use) hangs.
- Local reproduction (probes outside the repo, `wrangler dev --local`, wrong password, no secrets): `postgres` 3.4.9 and `pg` 8.23.0 both fail with TLS ("Network connection lost" / "Connection terminated unexpectedly") and both reach auth without TLS (`28P01`); raw `cloudflare:sockets`: SSLRequest answered `S`, `startTls` "opened", first write → "Network connection lost"; direct TLS to `example.com:443` works. So the ADR-031 driver fallback (`pg`) does not help.
- **Fix (Chat E3): Cloudflare Hyperdrive**, the other ADR-031 fallback. Docs (Context7, developers.cloudflare.com/hyperdrive): included in Workers Free (100,000 queries/day); `wrangler cert upload certificate-authority` + `hyperdrive create … --ca-certificate-id <id> --sslmode verify-full`; `--caching-disabled` (required for role and RLS correctness); Hyperdrive `require` also validates by WebPKI, so the CA upload is required.
- Open questions for Chat E3 (check, do not guess): one Hyperdrive config per login role (MT-14 keeps four logins) and the Free-plan config limit; origin = session pooler or direct host (IPv6); `set local role` and `set_config(…, true)` under Hyperdrive's transaction pooling; local dev and `e2e-local` (`localConnectionString` or the current direct URL); fail fast on a connect error instead of the reconnect loop.

## Done this chat
- **D1-SPEC-1 (High) fixed**: `c8a4911` (`packages/config/test/never-build.test.ts`, 29 cases, seen failing first). `docs/reviews/D1.md` has a "FIX (Chat G, in progress)" table.
- Founder walkthrough: token, part (b), both smoke users; FOUNDER-QUEUE rows moved to Resolved; new open row "D1 staging database: Cloudflare Hyperdrive". The broken table line (rule-9 row glued to rec. 5) is split.

## Next chats (one at a time on this laptop; both write `d1/integration`)
1. **Chat G part 2 — D1 FIX** (code findings only). Start at D1-DB-1.
   - One commit per finding, regression test seen failing first, per `docs/reviews/D1.md` "Findings". Order: ~~D1-SPEC-1~~ (done), D1-DB-1, D1-SPEC-2, then the D1 FIX Lows.
   - D1-DB-1: **forward migration** (the D1 migrations are on staging; spec R-17), pgTAP red first in `rls_d1_cards`; the `X-SOFT-*` fixtures move to an operator-inserted test rule table.
   - D1-SPEC-2: spec revision 4n (§7.3) and a `scripts/test` case for `recordedMs`.
   - Opus re-review (spec, covering `c8a4911` too, plus database for DB-1), full `pnpm verify` with no agent running, Linux CI. Complete "FIX" and add "Re-review of the FIX" in `docs/reviews/D1.md`. Tag `cp/d1-11`.
   - **Do not dispatch staging** in Chat G: a dispatch freezes the new forward migration on staging before review (D1-DB-3).
2. **Chat E3 — Workers-to-Postgres via Hyperdrive, then the staging e2e** (after Chat G, or in its own worktree branch cut from the Chat G tip; never both writing `d1/integration` at once).
   - ADR-031 amendment, spec revision, Hyperdrive bindings (api + jobs, dev/staging), `staging-worker-secrets.mjs` creates or updates the Hyperdrive configs instead of the DB URL secrets, `check-staging-secrets` + wrangler-bindings tests, a test that a TLS/connect failure fails fast (no reconnect loop), a retry for the recruiter per-deployment Pages smoke. Tests first; Opus security + database review.
   - Founder steps (FOUNDER-QUEUE row 2026-10-21): download the Supabase CA (public), upload it, create the configs (exact commands from Chat E3).
   - Then dispatch with e2e: `e2e-staging` green (AT-D1), DC-D8, the AT-D2 recording per D1-SPEC-2; record, tag **`cp/d1-10`**, push. Then the founder deletes the private key file in `trace-keys`.
3. **CLOSE** (merge into `main`, `d1-reviewed`, M0a/M0b CLOSE) only with the founder's explicit go-ahead.

## Carried (beyond D1 FIX; owners in `docs/reviews/D1.md`)
- **M1:** N-1, D1-SEC-3 (c, d), D1-LEAD-1, the concurrency group, `candidate-store` `newOtp`, FR-1 (+ new helpers).
- **M3a:** SEC-W1-1, D1-DB-2, DB-6, DB-12, C2 SEC-3, the token re-mint cap, `MIRROR_TRANSPORT`, earlier M3a carries.
- **M3b:** C2 SEC-6. **M4:** C2 SEC-5. **M5:** DB-7. **M7:** M0B-DB-1 (+ D1 tables), deletion.

## Decisions (Chat F, still valid)
- Staging exit-gate items are INCOMPLETE (founder-gated), as in M0b; not run, not worked around.
- AT-D2 rule proposed: one OS-level screen capture of the headed `pnpm e2e:record`, with `recordedMs` checked at 270-330 s (D1-SPEC-2). It becomes binding when Chat G writes spec revision 4n.
- Skill §5 step 4 (adversarial agent) was replaced by the lead re-proving every Medium and above (Pro usage budget); recorded in the review.

## Founder items (`docs/progress/FOUNDER-QUEUE.md`)
- Done 2026-10-21: token, part (b), both smoke users. **Next:** the Hyperdrive steps when Chat E3 asks, then the go-ahead for CLOSE. Decisions still open (none blocks D1): review recs 1-5, the rule-9 correction question, H11.

## Gotchas
- This account shows plan **Pro**. Chat F used 3 Opus reviews, 20% → ~80% of one 5-hour window, weekly 52% → ~60%.
- On this laptop the gitleaks-driven `scripts` tests and the redactor timing tests fail under load. Run full verify with no agent active, and never loosen a bound.
- Reviewers share the lead's worktree: "git show / git diff only; never checkout". Never run `test:rls` while a database reviewer probes.
- Short RAM: `npm_config_workspace_concurrency=1`; never two chats running verify or db commands at once.
- The D1 migrations are frozen (applied to staging): fix forward only (D1-DB-3 makes `check-migrations` enforce it).
- Windows: `wrangler dev` with its state under the long scratchpad path fails with SQLITE_CANTOPEN; use a short `--persist-to`.
- The staging test users' passwords and TOTP secrets live only in the founder's password manager and GitHub secrets; never ask for them in chat.

## Verify first
- CI on PR #4 for this handoff commit (green) · `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` (tip = this handoff) · `git status` (clean) · `npm_config_workspace_concurrency=1 pnpm -s verify:fast` · `gh pr checks 4 --repo TraceHiring/TraceHiring` · `gh run list --repo TraceHiring/TraceHiring --workflow ci.yml --event workflow_dispatch --limit 3`
