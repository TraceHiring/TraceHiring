# ADR-030: Candidate token (Trace-issued ES256, RLS through a gateway role)

- **Status:** Proposed — implement in M3a (2026-10-12). Becomes Accepted when the M3a SPEC has answered the open questions below and the founder or lead approves.
- **Source:** `docs/build-notes.md` Q6 and Q7 (both "Can-default", accepted) and risk 5; `specs/m0b-tenancy.md` section 8 and 2.3; refines ADR-017 (candidate auth: invite + OTP, Trace-issued token). Evidence: `docs/spikes/m0b-candidate-token/README.md`.

## Context
ADR-017 fixed the shape: a candidate proves control of an invitation with an OTP and receives a Trace-issued token. It left two questions that build-notes Q6 and Q7 answer by default:

- **Who signs it and how RLS understands it (Q6).** If the token were signed with the Supabase project JWT secret, that secret could also mint `service_role` tokens, so it could not live in a candidate-facing Worker (CLAUDE.md, Tenancy). Candidates also must never call PostgREST: the candidate CSP names no Supabase origin (M0b spec 2.7), and candidate reads and writes go through server code.
- **Lifetime (Q7).** Plan section 12's "test duration + 1 h" is overrun by extra time, a lobby and credited outage minutes, and the status page, report and 72-hour response flow happen days later with no token type.

Build-notes risk 5 records that the token and RLS mechanism was unproven. M0b therefore ships only this decision record and a local spike; nothing in the product consumes a candidate token until M3a.

## Decision
1. **Signing.** Tokens are signed with **ES256** (ECDSA, P-256, SHA-256) by a Trace key held **only by a server worker**. Candidate-facing Workers and Durable Objects never hold the private key. The header carries `kid` so keys can rotate.
2. **Verification at the edge** uses the **public** key (JWK) only. The verifier pins `alg = ES256`, checks the signature before reading any claim, then the claim shape, the token type for the route, `exp`, and `iat` with a small clock-skew allowance. `alg: none`, other algorithms, other keys and unknown claims are rejected.
3. **Candidates never call PostgREST** and never use Supabase Auth (ADR-017). All candidate reads and writes go through a dedicated server worker, the **candidate gateway**.
4. **The gateway connects as a dedicated login role `trace_candidate_gateway`**: `NOINHERIT`, `NOBYPASSRLS`, its **only membership `trace_candidate`**, granted `with inherit false, set true` (Q6; M0b creates `trace_candidate_gateway` as NOLOGIN, the login role with a password is created per environment by an operator runbook when the Worker first connects, M0b spec 2.3). It never uses the `postgres` or `service_role` connection and holds no other credentials.
5. **Per request**, inside one transaction, the gateway runs `SET LOCAL ROLE trace_candidate`, then `set_config('request.jwt.claims', <verified claims JSON>, true)` with the claims as a **bound parameter**, then the statements. Candidate RLS policies are real and pgTAP-testable, in the form `to trace_candidate using (candidate_id = ((select auth.jwt()) ->> 'candidate_id')::uuid)`. Anything that needs a claim inside a function body uses a `SECURITY DEFINER` `private` reader (`cand_*()`, `search_path = ''`), not a direct `auth.jwt()` call by the role (a direct call by `trace_candidate` fails with 42501 because it has no USAGE on schema `auth`; the B3 security review's probe shows `postgres` holds that USAGE without grant option, so no migration can grant it) [B3-P3].
6. **Three token types (Q7)**, carried in the `typ` claim and checked per route:

   | `typ` | Purpose | Lifetime |
   | --- | --- | --- |
   | `lobby` | OTP to lobby | set in the M3a SPEC (not fixed by Q7) |
   | `session` | the test itself | current server deadline + 1 h, re-issued whenever the deadline moves: the session Durable Object **asks the issuer worker** over a service binding, passing only the session id and the new deadline; the issuer derives every claim from its own store and signs. The Durable Object never holds the key and never chooses claims (decision 1) [B3-S1, B3-P1] |
   | `portal` | status page, report, 72-hour response: read own data and respond only | 30 minutes; invite link + OTP |

7. **Claim shape** (contract in `@trace/shared`, written in M3a; shown here as the shape the spike enforces, zod 4):

   ```ts
   const CandidateTokenClaims = z
     .strictObject({
       sub: z.uuid(), // = candidate_id
       candidate_id: z.uuid(),
       invitation_id: z.uuid(),
       org_id: z.uuid(),
       typ: z.enum(['lobby', 'session', 'portal']),
       nonce: z.string().min(16),
       iat: z.number().int(),
       exp: z.number().int(),
     })
     .refine((c) => c.sub === c.candidate_id);
   ```

   Spec section 8 gives `{ sub, candidate_id, invitation_id, org_id, typ, nonce, iat, exp }`. The strict object, `nonce` of at least 16 characters, integer times and `sub === candidate_id` are tightenings the spike applies; M3a may adjust them in its SPEC.

No new vendor or library: Web Crypto (built into Workers and Node), Postgres roles and RLS, and zod (ADR-028).

## Rejected alternatives, and why
- **Sign with the Supabase project JWT secret, and let candidates call PostgREST:** the same secret mints `service_role` tokens; it would have to sit in a candidate-facing Worker (Q6).
- **Supabase Auth for candidates:** limits behind shared networks, per-user billing (ADR-017).
- **Gateway on the `postgres` or `service_role` connection:** both bypass RLS, so candidate isolation would depend on application code alone. Rule: candidate policies must be real policies.
- **One long-lived "test duration + 1 h" token:** overruns with extra time, lobby and credited minutes, and has no answer for the after-test pages (Q7).

## Consequences
- Candidate isolation rests on Postgres RLS evaluated for `trace_candidate`, with claims set only after the edge has verified the signature. Postgres itself does not check the token.
- The claims GUC is not protected from the role that reads it: `trace_candidate` can overwrite `request.jwt.claims` both with `set_config` **and** with a plain `SET LOCAL request.jwt.claims = …` (B3 security review probe), so revoking `set_config` cannot close it. Any SQL that runs as `trace_candidate` with attacker-influenced text could forge another candidate's claims (it would need that candidate's UUID): the gateway's statements, and equally a SECURITY INVOKER function, trigger or view reachable by the role that builds SQL with `execute` [B3-S2]. **M3a acceptance tests:** (a) the gateway's DB layer accepts constant SQL text only (claims and values as bound parameters), enforced by a lint rule and a test; (b) a catalog check that no function, trigger or view reachable by `trace_candidate` uses `execute` or `set_config`, with an explicit allow-list; (c) candidate ids are random v4 UUIDs.
- The policy path needs no extra grant for `trace_candidate` beyond the table `SELECT` on the local stack, but it depends on Supabase's PUBLIC `EXECUTE` on `auth.jwt()`, which a migration cannot grant or revoke. M3a's candidate-role pgTAP tests are the guard.
- Rules 1 to 9 are unaffected. The gateway is read and write on candidate data only; no integrity decision is made here (rule 2), and the candidate projection stays a separate view (rule 5).
- Key custody and rotation are a new operational duty, specified in M3a.

## Evidence
`docs/spikes/m0b-candidate-token/README.md` records the run (2026-10-12, local stack, PostgreSQL 17.11): the ES256 token verifies with the public JWK and tampered, expired, `alg=none`, foreign-key and wrong-type tokens are rejected; under `SET LOCAL ROLE trace_candidate` with the verified claims, one row is allowed and one is denied, no claims give zero rows, and swapped claims follow the claims; the grants discovered; and the eight M0b tables reported as skipped because their migrations did not exist yet (to be re-run once they do). Command: `node docs/spikes/m0b-candidate-token/spike.mjs`.

## M3a requirements from the B3 review [B3-S3, B3-S4]
- **`nonce`:** random per issuance, held by the session Durable Object, compared on every request, rotated on re-issue, invalidated on submit.
- **Durable Object id** comes from verified claims only, never from the URL.
- **`kid`:** the verifier looks the key up by `kid`; an unknown `kid` is rejected. Each `typ` has a lifetime cap checked as `exp - iat`.
- **`typ` below the edge:** write-path policies (or the `cand_*()` readers they call) assert `typ`, so a route-table bug cannot let a lobby or portal token reach session writes; every policy names its role (`to …`), because `auth.uid()` returns `sub` = `candidate_id` and a role-less policy would evaluate for candidates; allowed and denied pgTAP cases per `typ`.

## Still to do in M0b (after stream B0's migrations land) [B3-P5, B3-P4]
- Re-run `node docs/spikes/m0b-candidate-token/spike.mjs`; replace the README output block and the Evidence paragraph above; the eight M0b-table lines must then read PASS, not SKIPPED.
- Tighten the spike's M0b-table check first: an empty table must not pass on `rows=0` alone; require `42501`, or `has_table_privilege('trace_candidate', t, 'SELECT') = false`, or a row seeded by the owner inside the transaction.

## Open for the M3a SPEC (nothing here is decided)
- **Direct RLS evaluation.** Whether Supabase's third-party or asymmetric JWT support makes it possible to evaluate Trace-issued tokens directly, without the gateway and `SET LOCAL ROLE`. To be checked against the Supabase docs current at the M3a SPEC; this ADR does not answer it.
- The real connection chain from a Worker: login role as `session_user`, `SET LOCAL ROLE` and `set_config(..., true)` through any pooler, and hosted Supabase behaviour (the spike used `postgres` as a stand-in on the local stack).
- Where the private key lives and how it rotates (`kid`, overlap window).
- The lobby token's lifetime, and the exact route-to-`typ` table.
