# ADR-031: Postgres driver for Workers

- **Status:** Accepted (autopilot, 2026-10-14); amended 2026-10-22 (amendment 1, Hyperdrive on staging; it wins over Decision 3 there). A new runtime library needs an ADR (CLAUDE.md stack rule; AUTOPILOT §4). Records `specs/d1-demo-slice.md` §1.5 R-6 and day-one check DC-D7.
- **Source:** spec D1-4, R-6, §3.3 (login roles `api_login` and `jobs_*_login` → NOLOGIN worker roles), §8 DC-D7; spike `docs/spikes/d1-day-one/` (`147fd44`).

## Context
D1 is the first milestone where Workers talk to Postgres. `services/api` uses `trace_api` for the invitation lookup, state changes and the consent insert. `workers/jobs` uses three worker roles for the mirror, quality and integrity stages. Each role is entered from its own login role with `SET LOCAL ROLE` inside a transaction, so policies, triggers and MT-14 apply. Supabase's PostgREST cannot do this: it authenticates as `authenticator` with JWT roles, not as these roles. The Workers need a Postgres wire driver over Cloudflare TCP sockets. No such dependency exists in the repo, and ADR-028 lists the M0 runtime libraries.

## Decision
1. Use **`postgres` (porsager), exactly 3.4.9** in `services/api` and `workers/jobs`, over Workers TCP sockets, with `nodejs_compat` (default from compatibility date 2026-08-04) and `fetch_types: false`. The version is pinned in the pnpm catalog, changed only through the lead.
2. Every database call runs `begin; set local role <worker role>; …; commit` on a connection opened as that Worker's login role. Each module receives only its own connection through DI (the rule-1 ESLint wall keeps `quality/` and `integrity/` apart).
3. Connection strings are Worker secrets (`API_DB_URL`; the three jobs URLs in spec §5), listed in `scripts/check-staging-secrets.mjs`. They are never in `workers/edge` or any candidate-serving Durable Object (CLAUDE.md). On staging they point at the Supabase **session** pooler with `sslmode=require` (the transaction pooler breaks `SET LOCAL ROLE` across statements only if a transaction is split, which the driver does not do; the session pooler is the conservative choice).
4. **Fallback** if a staging check fails (TLS to the pooler, CPU limit, connection limits): `pg` 8.23.0 (also passed DC-D7 locally), or Cloudflare Hyperdrive in front of the same driver. Either needs only an amendment to this ADR.

## Evidence (DC-D7, local, 2026-10-14)
- `postgres@3.4.9` in workerd connects to the local Supabase Postgres; `begin; set local role authenticated; select current_user` returns `authenticated`, and after `rollback` returns `postgres`. Bundle cost is about 22 KiB gzip over the baseline Worker.
- `pg@8.23.0` gives the same result at about 40 KiB gzip.
- Every transaction on the shared database was rolled back.

**Not yet run** (staging, BUILD Wave 0):
- TLS to the staging session pooler;
- the real `api_login` and `jobs_*_login` roles;
- CPU per invocation against the Workers Free limit (DC-D8);
- the combination with `nodejs_compat_do_not_populate_process_env`.

## Rejected alternatives, and why
- **PostgREST with a service key from the Workers:** the service role bypasses RLS and would hold every privilege, against the per-role design and rule 1's schema wall.
- **Supabase Edge Functions or a separate Node service:** this is a new compute platform; ADR-027 keeps API and jobs on Workers.
- **`pg` as the primary:** it works too, but costs about twice the bundle size; it stays the fallback.

## Consequences
- New runtime dependency in two Workers. `pnpm audit` and osv-scanner cover it.
- Workers TCP connections per invocation: the jobs stages open one connection each; the api opens per request (Hyperdrive is the scaling answer if connection counts matter at M8 load).

## Amendment 1 (2026-10-22, autopilot): Hyperdrive on staging
- **Status:** Accepted (autopilot). Uses the fallback named in Decision 4; no new vendor (Hyperdrive is part of the Cloudflare account ADR-027 already uses). Spec: `specs/d1-demo-slice.md` revision 4o.
- **Why (staging evidence, dispatch 9, run 39566827826):** a Worker's own TLS client trusts only public roots, and Supabase Postgres presents a certificate that chains to the private "Supabase Root 2021 CA". The TLS handshake never completes, and postgres.js 3.4.9 then reconnects without limit (its Cloudflare `closed()` path calls `reconnect()` on the initial connection), which on jobs ended in "Too many subrequests". Reproduced locally in workerd with both `postgres` and `pg`, so Decision 4's `pg` fallback does not help.

Decision (replaces Decision 3 for staging; local development is unchanged):
1. **Remote Postgres only through Hyperdrive.** On staging each Worker reaches Postgres through Hyperdrive bindings: api `API_DB`; jobs `JOBS_MIRROR_DB`, `JOBS_QUALITY_DB`, `JOBS_INTEGRITY_DB` (`scripts/lib/hyperdrive.mjs` `HYPERDRIVE_PLAN`). Hyperdrive opens the origin connection and verifies it against the uploaded Supabase CA (`wrangler cert upload certificate-authority`) with `sslmode` `verify-full`, or `verify-ca` as the fallback; `require` (no verification) is refused by the ops script.
2. **One config per login role** (`trace-staging-<login>`), so MT-14 holds: no config, and so no binding, reaches two `trace_*` roles. **Caching disabled** on every config: a cached read could be served across role and org scoping. `origin_connection_limit` 5 per config. The account's Free plan allows 10 configs; D1 uses 4.
3. **URL secrets are local only.** `API_DB_URL` and the three `JOBS_*_DB_URL` stay for local runs and are accepted only on a loopback host with no query string (`localDbUrlAllowed` in `@trace/workers-http/pg-socket`). On staging they are retired: `scripts/check-staging-secrets.mjs` no longer allows them, and `scripts/ops/staging-worker-secrets.mjs` deletes any left over. When a binding is present it wins (`pgConnectionString`).
4. **No Worker-side TLS.** The driver always runs with `ssl: false`: to Hyperdrive the hop is inside Cloudflare, and locally the database is on loopback. `apiDbSsl` / `jobsDbSsl` are removed.
5. **Fail fast by construction.** Every client uses the capped transport (`cappedSocket`, postgres.js `socket` option): one TCP connection per client, and a second connect attempt throws `db_connect_refused` instead of looping. A control test proves the bare driver loops (`packages/workers-http/src/pg-socket.test.ts`).
6. **`prepare: false` is kept.** Every query runs inside one explicit transaction (`begin; set local role …; commit`), so Hyperdrive's pooling never splits a statement from its role; to be confirmed by the staging e2e run (AT-D1).
7. **Ids are public and committed.** The four config ids go under `env.staging.hyperdrive` of `services/api` and `workers/jobs` `wrangler.jsonc` (a config id works only inside the owning account). `scripts/check-deploy-vars.mjs` refuses a staging deploy without them, and `scripts/test/wrangler-bindings.test.mjs` allows `hyperdrive` only in `env.staging`, never with `localConnectionString`.
8. **The origin password never reaches a command line.** `staging-worker-secrets.mjs` creates or updates the configs through the Cloudflare API with wrangler's own token (`wrangler auth token --json`, kept in memory), the password only in the HTTPS request body; it prints the ids, never a value.

Consequences: the founder uploads the CA once and runs the ops script (`scripts/ops/README.md`); a password rotation re-runs it and updates the same four configs in place. Hyperdrive is also the M8 scaling answer named above, so production follows the same shape through its own config set.
