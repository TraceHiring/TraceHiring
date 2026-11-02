# ADR-032: Coarse rate limit on the edge link routes

- **Status:** Accepted (autopilot, 2026-10-19). A new Cloudflare product feature on an existing vendor; recorded under AUTOPILOT §4. Closes `specs/d1-demo-slice.md` §11 OPEN-13 (C1a security review SEC-2, `docs/reviews/D1-review-c1a.md`).
- **Source:** spec revision 4d (OPEN-13), revision 4k; stream branch `d1/open13-edge-limit`.

## Context
`POST /v1/invite/resolve`, `/v1/otp/request` and `/v1/otp/verify` take a raw link token and no Bearer. Every well-formed token reaches api's `CandidateRpc`, which opens a Postgres connection (ADR-031) before it can say the token is unknown. A loop of random tokens can therefore use up database connection slots. The edge holds no secret (spec L-10), so it cannot tell a forged token from a real one without asking api. OTP limits stay keyed by invitation in `InviteOtpDO` (Q47); they only start once a token resolves.

## Decision
1. **Workers Rate Limiting binding** `LINK_LIMITER` on `workers/edge`, in the `dev` and `staging` env blocks (`ratelimits`, `simple`, **300 calls per 10 s**; `namespace_id` 1101 for dev and 1102 for staging, so the envs never share counters). The top-level config binds nothing, as before.
2. **Key: a constant per route** (`link:resolve`, `link:otp_request`, `link:otp_verify`). Never an IP, header, token, invitation id or any request-derived value: no personal data is processed for it, IP/ASN is never a signal in India (rule 7), and Indian mobile CGNAT and campus NATs put many honest candidates behind one IP. It is a database-protection cap, never an integrity signal: nothing is recorded per candidate and nothing reaches api, the database or a report.
3. **Order:** body cap and strict parse first (a malformed body is 400 and does not count), then `limit()`, then the existing api calls.
4. **Refusal:** 429 `rate_limited` with `Retry-After: 10`, no api call. **Fail closed:** a missing binding, a thrown call or a malformed answer is 503 `unavailable`, no api call.
5. **Logs:** `edge.rate_limited` (warn) and `edge.rate_limiter_error` (error) carry only `{ route }`, at most one line per route per 10 s per isolate, so a flood does not flood Workers Logs.

## Consequences
- Counts are per Cloudflare location and eventually consistent (Cloudflare docs), so the cap is roughly 300 per 10 s per route **per location**, not global. It bounds a single-location flood; a distributed flood is bounded per location only.
- **Availability trade-off (security review SEC-W1-1, Medium, accepted for D1, owner M3a):** one key per route and location means a single cheap client (about 31 requests/s of random tokens) uses up a location's budget and every honest candidate served there gets 429 on resolve and OTP for as long as the flood lasts; a large drive told to open its links at the same minute can also pass 300 per 10 s through a few Indian locations on its own. D1 has no drives and only synthetic staging users. The candidate app shows the wait copy and holds Retry for `Retry-After` (SEC-W1-2). **Before pilot (M3a):** size the limit from real drive sizes, and put the real database guard behind api (a concurrency cap in api and a short negative cache for unknown token hashes, or Hyperdrive per the ADR-031 fallback, through an ADR-031 amendment).
- It is a speed bump, not a connection cap. ADR-031 opens one TLS connection to the session pooler per api request; at 30 requests/s per route (about 90/s per location over the three routes) and 50-200 ms per resolve, that is about 5-18 concurrent connections from one location (security review opinion), already near a small project's session-pool size, and a flood spread over several locations multiplies it. The other half of OPEN-13 (the guard behind api above) stays open until M3a.
- Plan availability and the API-token permission for `ratelimits` are confirmed by the first staging `workflow_dispatch`, not by documentation (the Cloudflare page does not state them).

## Rejected alternatives, and why
- **Key on the client IP:** personal data, wrong for shared Indian IPs, and Cloudflare advises against it.
- **A Durable Object counter:** exact, but adds a DO round-trip to every link call and a new hot object.
- **A zone WAF rate-limiting rule:** the staging Workers run on `workers.dev`, which has no zone of ours; it would also move the rule outside the repo.
- **Signing link tokens so the edge can reject forgeries:** the edge holds no secret (L-10); a public-key scheme for links is a larger change for M3a, not D1.
