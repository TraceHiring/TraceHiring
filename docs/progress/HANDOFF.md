# HANDOFF — 2026-10-21 22:45 IST (Chat E3 part 1: Hyperdrive code, lead half done)
Reason for stopping: usage guard (Pro 5-hour window 93% at 22:40 IST, resets ~01:40 IST). Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`**. The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (`main` still `fe77a87`). M0a and M0b built, reviewed, fixed, **not CLOSED** (founder gates).
- **D1 ≈ 98%**: code merged, D1 FIX complete (`cp/d1-11` = `fd9b31c`). Left: Chat E3 (Hyperdrive, staging e2e, `cp/d1-10`), then CLOSE (founder go-ahead).

## Where we are (verified this chat)
- Verify-first at start: tip `c6c65df`, clean, CI on PR #4 green (run 39630421356). Local: typecheck, lint, scripts 2602+1 skipped, every package suite green except worker start-up failures under RAM pressure (candidate forks, api ECONNRESET); re-runs: candidate 246, recruiter 381, edge 417, jobs 240, api 337 of its files (rest did not start). No assertion failed.
- **`d1/integration` HEAD = `fe67309`** (+ this handoff commit). Five commits this chat, each with its tests green locally (package-level runs, not full `pnpm verify`):
  - `069391e` feat(ops): `scripts/lib/hyperdrive.mjs` — HYPERDRIVE_PLAN (api `API_DB`; jobs `JOBS_MIRROR_DB`, `JOBS_QUALITY_DB`, `JOBS_INTEGRITY_DB`; configs `trace-staging-<login>`), pinned account `94fef930c2ecd2e37fbd5dc3151d99ba`, sslmodes verify-full|verify-ca, origin limit 5, `hyperdriveProblems`/`allHyperdriveProblems`. Test `scripts/test/hyperdrive-plan.test.mjs` (12).
  - `059fee3` feat(workers-http): `packages/workers-http/src/pg-socket.ts` `cappedSocket`/`cappedSocketOption` — the postgres.js `socket` option, one TCP connection per client, second attempt throws `db_connect_refused` (root cause: postgres.js cf `closed()` → `if (initial) return reconnect()` with no limit). `postgres` added as devDependency of workers-http (lockfile). Test `pg-socket.test.ts`: control proves the bare driver loops (>5 connects/s), capped = 1 connect and fails < 2 s.
  - `62fed49` feat(db): api `openApiDb(env)` and jobs `withStageConnection` use `pgConnectionString(binding, url)`: Hyperdrive binding wins; URL secret only on a loopback host with no query (`localDbUrlAllowed`); `ssl: false` always (Worker never does TLS itself); capped transport. `apiDbSsl`/`jobsDbSsl` removed. Env types: `services/api/src/modules/candidate/env.ts`, `workers/jobs/src/queue/env.ts`. Tests: `api-db-tls.test.ts` (21 with api-db, incl. a real refused connect in workerd < 3 s), `stage-db.test.ts` (77 in src/queue), `workers/jobs/db-test/transport.db.test.ts` (real local DB through the capped transport, 1 connection, 2 transactions). `pg-socket-node.ts` = Node test helper (export `./pg-socket-node`).
  - `bbbb2b5` fix(ci): `scripts/smoke-staging.mjs` `DEFAULTS.deploymentAttempts` 48 (4 min) for per-deployment Pages URLs (dispatch 8 failure). `smoke-staging.test.mjs` 39.
  - `fe67309` feat(ci): `check-deploy-vars.mjs` also requires the staging Hyperdrive bindings (`loadWranglerConfigs`, `requireStaging: true`) — **it fails on the repo today by design** until the ids are committed. `wrangler-bindings.test.mjs` allows `hyperdrive` in env.staging only (`requireStaging: false` until the ids land). wrangler.jsonc header comments updated.
- **Writer branch `d1/e3-ops-hyperdrive` @ `46511ae`** (worktree `.claude/worktrees/agent-ad44684bc48434f44`, Opus writer, from `069391e`): `5239daf` allow-list (api: CANDIDATE_TOKEN_PRIVATE_JWK, MEDIA_LINK_HMAC_KEY; jobs: none), `e496b3b` `staging-worker-secrets.mjs` creates/updates the four Hyperdrive configs via the Cloudflare API (token from `wrangler auth token --json`, password never on a command line), sets MEDIA_LINK_HMAC_KEY, deletes the retired `*_DB_URL` secrets, prints the ids; `46511ae` README founder runbook. **Not reviewed, not merged; its final report did not arrive before the stop — check its tests yourself.** Its brief is the spec of record for that half (scripts/ops/README.md on that branch).

## Next step (in order)
1. Verify-first (below). Then on the writer branch: `npx vitest run --root scripts test/staging-worker-secrets.test.mjs test/check-staging-secrets.test.mjs`; read the diff `git diff 069391e..d1/e3-ops-hyperdrive`.
2. Merge `d1/e3-ops-hyperdrive` into `d1/integration` with `--no-ff` (the writer owned files the lead did not touch).
3. Docs (lead): **ADR-031 amendment 1** (Hyperdrive on staging, one config per login, CA verify-full/verify-ca, caching disabled, limit 5, URL secrets local-only, plain TCP, capped transport, `prepare: false` kept because every query is inside one explicit transaction — confirm on the staging e2e; Free plan 10 configs/account), **spec revision 4o** (L-10, §3 Roles/Secrets, §4.2 table, §5, §7.1 allow-list + runbook, §8 DC-D7), FOUNDER-QUEUE row.
4. Opus security-reviewer + database-reviewer on `c6c65df..HEAD` (incl. the merged writer branch); fix findings test first; re-review.
5. Full `pnpm verify` (tests with `pnpm -r --workspace-concurrency=1 --if-present test && npx vitest run --root scripts`, then `pnpm test:rls`, `pnpm build`), push, Linux CI on PR #4 (e2e-local proves the capped transport in workerd).
6. Ask the founder for the Hyperdrive steps (README on the writer branch): download the Supabase CA (Dashboard → Project Settings → Database → SSL Configuration), `cd services/api; pnpm exec wrangler cert upload certificate-authority --ca-cert <file> --name trace-supabase-staging-ca`, then `node scripts/ops/staging-worker-secrets.mjs --env staging --ca-certificate-id <ID> --dry-run` and `--yes` (fallback `--sslmode verify-ca`); founder sends the four printed ids.
7. Commit the ids into env.staging of both wrangler.jsonc and switch `wrangler-bindings.test.mjs` to `requireStaging: true` in the same commit; verify:fast; push.
8. Dispatch with e2e: e2e-staging green (AT-D1), DC-D8, AT-D2 capture per spec 4n §7.3 (`e2e:record` exit 0); tag the dispatched commit `staging-applied-<run id>` (applies `20261021091905`), push; record; tag **`cp/d1-10`**; push. CLOSE only with the founder's go-ahead.

## Decisions made this chat (to record in ADR-031 amendment 1 / spec 4o — step 3)
- Remote Postgres only through Hyperdrive; URL secrets local-only (loopback, no query); no Worker-side TLS at all.
- Fail fast by construction: capped transport (one TCP connection per client) instead of a timeout race.
- Hyperdrive ids are committed in wrangler.jsonc (public); the deploy refuses missing ids (check-deploy-vars).
- Ops script talks to the Cloudflare API directly so the origin password never reaches a command line.
- Retired staging secrets are deleted by the ops script (founder runs it).

## Founder items
- None asked yet; step 6 is the next founder action. Decisions still open (none blocks D1): review recs 1-5, the rule-9 correction question, H11.

## Gotchas
- pnpm 12 ignores `npm_config_workspace_concurrency`; run tests with `--workspace-concurrency=1`. Workers pools may fail to start under RAM pressure (ECONNRESET / fork timeout): re-run that package alone.
- The worktree guard refuses shell commands that mix git with heredocs/python text containing the word "git"; use the Edit tool or plain commands.
- Root `scripts/` are not in the eslint run; running eslint on them directly shows two old errors (smoke-staging.mjs:30, its test:31).
- `20261021091905` not on staging yet; frozen set = `m*-reviewed` + `staging-applied-*`.

## Verify first
`git fetch trace` · `git log --oneline -3 d1/integration` (this handoff, parent `fe67309`) · `git status` · `git log --oneline -4 d1/e3-ops-hyperdrive` (`46511ae`) · `gh pr checks 4 --repo TraceHiring/TraceHiring` · `npx vitest run --root packages/workers-http` (73)
