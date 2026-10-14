# ADR-031: Postgres driver for Workers

- **Status:** Accepted (autopilot, 2026-10-14). A new runtime library needs an ADR (CLAUDE.md stack rule; AUTOPILOT §4). Records `specs/d1-demo-slice.md` §1.5 R-6 and day-one check DC-D7.
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
