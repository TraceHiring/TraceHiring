# HANDOFF — 2026-10-21 15:40 IST (Chat G part 2: D1 FIX done)
Reason for stopping: task done (D1 FIX code findings fixed and re-reviewed) and the usage guard (Pro 5-hour window 86%). Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`**. The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (`main` still `fe77a87`). M0a and M0b are built, reviewed and fixed, but **not CLOSED** (founder gates).
- **D1 ≈ 98%**: code merged and **D1 FIX complete** (every code finding fixed or dispositioned, two Opus re-reviews CONFIRMED WITH NOTES, notes applied). Left: the Workers-to-Postgres TLS fix and the green staging e2e (Chat E3, `cp/d1-10`), then CLOSE (founder go-ahead).
- **Current phase: D1 FIX done** → next is Chat E3 (staging), then CLOSE.

## Where we are (verified this chat)
- **`d1/integration`** code tip `fd9b31c` docs(reviews): d1 fix complete and its re-review; then this handoff commit. Pushed to `trace` (`fd9b31c`).
- **Full `pnpm verify` green on `fd9b31c`** (15:15-15:30 IST), in two runs because of RAM: run 1 typecheck + lint (prettier, check-boundaries, check-workflows, gen-catalog-tests 126, check-migrations "OK against main", gitleaks "no leaks found"), its tests OOM'd (see Gotchas); run 2 with `--workspace-concurrency=1`: config 502, band-engine 139, db-types 3, shared 1180, ui 67, vendors 110, workers-http 43, candidate 246, recruiter 381, api 403, edge 417, jobs 240, scripts 2602 + 1 skipped (K4); `test:rls` "rls_* 2633 (floor 2633), catalog_* 144"; `pnpm build` exit 0 (bundle, headers, no-demo-outbox, scan-dist OK).
- CI on PR #4, run 39578472076 on `da5f01e`: e2e-local, rls, migrations, security pass (static was pending when last read). **CI on `fd9b31c`: not yet read** — check first (Verify first).
- **`cp/d1-11`: NOT tagged yet** — tag `fd9b31c` once CI on it is green (Next step 1).
- Tag **`staging-applied-39566827826`** on `5306928` (pushed): freezes the five D1 migrations in `check-migrations` (D1-DB-3).

## Done this chat (verified; one commit per finding; docs/reviews/D1.md "FIX" + "Re-review of the FIX")
- D1-DB-1 (Medium): forward migration `supabase/migrations/20261021091905_d1_flags_rule_table.sql` — `6b428de`, re-review notes `8d37232` (guard raises 23514 itself; v3 scoping and raw-media cases). Tests: `rls_d1_cards` section "D1-DB-1" (17 assertions, operator test rule table v2), 11 red first. **Not on staging** (not dispatched).
- D1-SPEC-2 (Medium): AT-D2 = one OS-level capture of headed `pnpm e2e:record`; manifest `recordedMs`; `e2e:record` exits 1 outside 270 000-330 000 — `2f0e249`; `scripts/test/e2e-staging-preflight.test.mjs` (5 red first).
- Lows: D1-SPEC-4 `22a791b`, D1-DB-3 `f6f4793`, D1-SPEC-5 `7a32247`, README step 2/6 `bab2544`, flag-family sync `285a6da`, never-build single-token words `1a73ce7`; Sonnet writer merged `da5f01e`: D1-SEC-1 `9b5e80d`, D1-SEC-2 `a0a1d53`, D1-SEC-3 (a, b) `cd2cffe`, D1-SPEC-3 **false positive** pinned `d65d2f9`.
- Spec `specs/d1-demo-slice.md` **revision 4n** (DB-1, SPEC-5, DB-3, SPEC-2, AT-D21 row).
- Re-reviews: Opus database-reviewer (DB-1) and Opus spec-reviewer (c8a4911 + whole FIX range): both **CONFIRMED WITH NOTES**, all notes applied or accepted (D1.md).

## Staging finding (unchanged; blocks e2e-staging; root cause proven in Chat G part 1)
- Workers cannot open TLS to Supabase Postgres: Cloudflare `connect()`/`startTls()` validates against public roots; Supabase presents the private "Supabase Root 2021 CA". `postgres` 3.4.9 reconnect-loops (jobs: "Too many subrequests"); `pg` fails the same way. Fix = **Cloudflare Hyperdrive** with the CA uploaded (`wrangler cert upload certificate-authority`, `hyperdrive create … --ca-certificate-id … --sslmode verify-full --caching-disabled`).
- Open questions for Chat E3 (check, do not guess): one Hyperdrive config per login role (four logins, MT-14) and the Free-plan config limit; origin = session pooler or direct host (IPv6); `set local role` / `set_config(…, true)` under Hyperdrive transaction pooling; local dev and `e2e-local` (`localConnectionString`); fail fast instead of the reconnect loop.

## Next step (in order)
1. **Verify-first**, then read CI on PR #4 for `fd9b31c` (and the handoff commit). If green: `git tag cp/d1-11 fd9b31c` and `git push trace cp/d1-11`; record in LOG. If red: fix Linux CI first.
2. **Chat E3 — Workers-to-Postgres via Hyperdrive, then the staging e2e** (on `d1/integration`; one chat writing it at a time):
   - ADR-031 amendment, spec revision 4o, Hyperdrive bindings (api + jobs, dev/staging), `staging-worker-secrets.mjs` creates/updates the Hyperdrive configs instead of the DB URL secrets, `check-staging-secrets` + wrangler-bindings tests, a test that a TLS/connect failure fails fast (no reconnect loop), a retry for the recruiter per-deployment Pages smoke. Tests first; Opus security + database review.
   - Founder steps (FOUNDER-QUEUE row 2026-10-21): download the Supabase CA (public), upload it, create the configs (exact commands from Chat E3).
   - Then dispatch with e2e (this also applies `20261021091905` to staging: **tag that commit `staging-applied-<run id>` and push it**, scripts/ops/README.md): `e2e-staging` green (AT-D1), DC-D8, the AT-D2 capture per spec 4n §7.3 (`e2e:record` must exit 0); record, tag **`cp/d1-10`**, push. Then the founder deletes the private key file in `trace-keys`.
3. **CLOSE** (D1 summary, merge into `main`, `d1-reviewed`, M0a/M0b CLOSE) only with the founder's explicit go-ahead.

## Carried (beyond D1 FIX; owners in `docs/reviews/D1.md`)
- **M1:** N-1, D1-SEC-3 (c, d), D1-LEAD-1, the concurrency group, `candidate-store` `newOtp`, FR-1 (+ new helpers).
- **M3a:** D1-DB-2, SEC-W1-1, DB-6, DB-12, C2 SEC-3, the token re-mint cap, `MIRROR_TRANSPORT`, earlier M3a carries.
- **M3b:** C2 SEC-6. **M4:** C2 SEC-5. **M5:** DB-7. **M7:** M0B-DB-1 (+ D1 tables), deletion.

## Decisions made this chat
- D1-DB-1 guard order: rule-table check first, then card-final, quality card, not_used (migration header); T1/T2 untrusted/raw_media → 23514 from the guard.
- D1-DB-3: `staging-applied-<run id>` tags (not a file) mark applied migrations; frozen set = `m*-reviewed` + `staging-applied-*`.
- D1-SPEC-3 recorded as a false positive (both re-reviewers agree); D1-SPEC-5 resolved by dropping the reference.
- Writer use: one Sonnet writer for the e2e-side Lows (owned `e2e/**`, one recruiter test, two new scripts tests), merged `--no-ff`.

## Founder items (`docs/progress/FOUNDER-QUEUE.md`)
- No new item. Next: the Hyperdrive steps when Chat E3 asks, then the go-ahead for CLOSE. Decisions still open (none blocks D1): review recs 1-5, the rule-9 correction question, H11.

## Gotchas
- **pnpm 12.11.2 ignores `npm_config_workspace_concurrency`**: `pnpm verify` / `verify:fast` ran the Workers test pools in parallel and OOM'd (workerd "JavaScript heap out of memory", ~2.5 GB free of 16 GB). Run the test step as `pnpm -r --workspace-concurrency=1 --if-present test && npx vitest run --root scripts`, then `pnpm test:rls`, `pnpm build` (or try `pnpm_config_workspace_concurrency=1`; unverified).
- The worktree guard refuses shell commands that mix variables, loops or `cd $VAR` with git/docker; use literal paths and split commands.
- pgTAP one file locally: `sed '0,/^begin;/s//begin;\ncreate extension if not exists pgtap;/' <file> > <tmp>` then `docker exec -i supabase_db_trace psql -U postgres -X -q -At -v ON_ERROR_STOP=1 < <tmp>`.
- The D1 migrations 1-5 (`…065417` to `…175327`) are frozen (tag `staging-applied-39566827826`); `20261021091905` is **not** applied to staging yet and not frozen until its dispatch is tagged.
- Reviewers share the lead's worktree: "git show / git diff only; never checkout". Never run `test:rls` while a database reviewer probes.
- The staging test users' passwords and TOTP secrets live only in the founder's password manager and GitHub secrets; never ask for them in chat.
- Windows: `wrangler dev` state under the long scratchpad path fails with SQLITE_CANTOPEN; use a short `--persist-to`.

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` (tip = this handoff, parent `fd9b31c`) · `git status` (clean) · `git tag --list "cp/d1-1*" "staging-applied-*"` · `gh pr checks 4 --repo TraceHiring/TraceHiring` (head = this handoff) · tests per Gotchas with `--workspace-concurrency=1`
