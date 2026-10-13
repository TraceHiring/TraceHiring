# M0b candidate-token spike

Spec: `specs/m0b-tenancy.md` section 8 (build-notes Q6 and Q7). Decision record: `docs/adr/ADR-030-candidate-token.md` (Proposed, implement in M3a). Stream B3, 2026-10-12.

## Purpose

Build-notes risk 5 says the candidate token and RLS mechanism is unproven. This spike checks the part that can be checked in M0b, on the local stack, with no library and no production data:

1. A Trace key (ES256 / P-256) mints a candidate token, and an edge that holds only the **public** JWK verifies it. A tampered, an expired, an `alg=none`, a foreign-key and a wrong-type token are all rejected.
2. The **verified** claims, handed to Postgres as `request.jwt.claims` after `SET LOCAL ROLE trace_candidate`, drive a candidate-keyed RLS policy: one row is allowed and one is denied.
3. Which extra grants `trace_candidate` needs to evaluate `auth.jwt()` (an input for M3a).
4. `trace_candidate` is refused (`42501`) on every M0b table.

It does not test the real gateway connection chain, hosted Supabase, or a pooler. See "Not covered".

## How to run

```
node docs/spikes/m0b-candidate-token/spike.mjs
```

Needs Node 22, Docker and the shared local stack container `supabase_db_trace` (already running; the spike never starts, stops or resets it). The script exits 0 when no check failed, 1 on any `FAIL`, and reports `FAIL` if the container is not running.

What it does to the database: one `begin; ... rollback;` through `docker exec -i supabase_db_trace psql -U postgres -X -q -At -v ON_ERROR_STOP=1`, SQL on stdin. It creates `trace_candidate` (NOLOGIN, NOBYPASSRLS) only if it does not exist, a throwaway `public.spike_cand` with RLS and one SELECT policy, two harness probe functions, and nothing survives the rollback (the script checks that in a second read-only call). Everything that varies (the verified claims JSON, the other candidate id, the M0b table names) reaches SQL through psql variables (`:'claims'`), never by interpolation into the SQL text.

Secrets: the private key is generated at run time, is non-extractable, and is never written or printed. No full token is printed or sent to psql. Only the decoded claims are shown, and they hold synthetic UUIDs.

## Output of the run (2026-10-13, local stack, PostgreSQL 17.11, after the M0b migrations)

Contains no secret: a throwaway public key id, a random nonce and decoded synthetic claims. `kid`, `nonce`, `iat` and `exp` change on every run.

```
== Part 1: ES256 token (WebCrypto, no library) ==
key: EC P-256 alg=ES256 kid=P7rVONo-K9R1W6aV (private key is non-extractable and is never printed)
PASS: exported JWK is public only (no "d" member)
PASS: private key cannot be exported (extractable = false)
minted: header.payload.signature, 540 chars (token not printed)
PASS: valid token verifies with the public JWK
decoded claims: {"sub":"00000000-0000-4000-8000-0000000000c1","candidate_id":"00000000-0000-4000-8000-0000000000c1","invitation_id":"00000000-0000-4000-8000-0000000000b1","org_id":"00000000-0000-4000-8000-0000000000a1","typ":"session","nonce":"gjW85mDXSyPCDO2ekUxzFw","iat":1791898212,"exp":1791903612}
PASS: verified claims equal the minted claims
PASS: tampered payload is rejected (bad_signature)
PASS: expired token is rejected (signature itself is valid) (expired)
PASS: alg=none token is rejected (bad_alg)
PASS: token signed by a different key is rejected (bad_signature)
PASS: portal token is rejected on a session route (wrong_token_type)

== Part 2: RLS under SET LOCAL ROLE trace_candidate (one rolled-back transaction) ==
PASS: trace_candidate is NOLOGIN, NOBYPASSRLS and holds no SUPERUSER/CREATEROLE/CREATEDB/REPLICATION (login=false,bypassrls=false,super=false,createrole=false,createdb=false,replication=false)
FINDING: trace_candidate already existed on this stack (reused as is)
PASS: postgres holds trace_candidate with inherit false, set true (grantor=postgres inherit=false set=true; grantor=supabase_admin inherit=false set=false)
PASS: fixture holds two rows, one per candidate (owner sees 2)
PASS: SET LOCAL ROLE trace_candidate took effect (trace_candidate)
PASS: request.jwt.claims set from the verified token claims
PASS: RLS: exactly ONE row allowed (token candidate) and ONE denied (other candidate) (visible total=1 own=1 other=0)
PASS: RLS follows the claims: the other candidate's claims see only the other row (row-for-other-candidate)
PASS: no claims: zero rows (fail closed) (rows=0)
-- grant discovery (input for M3a) --
FINDING: before any extra grant: USAGE on schema auth=false, EXECUTE on auth.jwt()=true (via PUBLIC=true), USAGE on schema public=true
PASS: auth.jwt() inside the policy evaluates with NO grant beyond SELECT on the table (rows=1)
FINDING: a direct call of auth.jwt() by trace_candidate: refused sqlstate=42501
FINDING: GRANT USAGE ON SCHEMA auth / EXECUTE ON auth.jwt() issued by postgres: USAGE afterwards=false, explicit ACL rows for trace_candidate on auth.jwt()=0 (both grants were silent no-ops)
FINDING: direct call of auth.jwt() after those grants: refused sqlstate=42501
-- M0b tables as trace_candidate --
PASS: trace_candidate on public.orgs (refused (42501))
PASS: trace_candidate on public.workspaces (refused (42501))
PASS: trace_candidate on public.teams (refused (42501))
PASS: trace_candidate on public.memberships (refused (42501))
PASS: trace_candidate on public.audit_log (refused (42501))
PASS: trace_candidate on public.platform_staff (refused (42501))
PASS: trace_candidate on public.staff_access_grants (refused (42501))
PASS: trace_candidate on public.idempotency_keys (refused (42501))
PASS: rolled back: spike table, probe functions and the role created by the spike are gone

RESULT: 27 passed, 0 failed, 0 skipped
```

The first run (2026-10-12, stream B3) reported the eight M0b tables as `SKIPPED` because their migrations did not exist yet. This re-run (M0b FIX, review finding M0B-SP-1) follows the B0 migrations, and the probe was tightened first: only a refusal (`42501`) passes, and a table that merely reads zero rows fails, since an empty table proves nothing about grants or policies. All eight are refused. `supabase/tests/rls_roles.test.sql` pins the same property in CI. The probe was also exercised by hand against stand-in tables (no grant: `42501`; SELECT granted, RLS on, no policy: zero rows, now a FAIL; partitioned table: `42501`; missing: `absent`).

## Grants `trace_candidate` needed (input for M3a)

Tested by running the policy path with nothing but the SELECT grant on the table, not assumed.

| Need | Needed? | How it is satisfied locally |
| --- | --- | --- |
| `SELECT` on the candidate table | **Yes, explicit** | `grant select on public.spike_cand to trace_candidate` (by design, per table or column) |
| `EXECUTE` on `auth.jwt()` | **Yes, but already present** | PUBLIC holds it (`=X/supabase_auth_admin`). `postgres` cannot grant or revoke it: `GRANT`/`REVOKE` print `no privileges were granted/revoked` and change nothing |
| `USAGE` on schema `public` | **Yes, but already present** | PUBLIC holds it (`=U/pg_database_owner`) |
| `USAGE` on schema `auth` | **No, for the policy path** | A policy stores the OID of `auth.jwt()`, so the schema is not looked up at run time (same mechanism as DC-1 for `private`). Without it, a **direct** call of `auth.jwt()` by `trace_candidate` fails with `42501` |

So the answer to "what is the minimum extra grant" is: **none beyond the table SELECT grant**, on the current local stack. Two consequences for M3a:

1. A direct call of `auth.jwt()` as `trace_candidate` (ad hoc SQL, a `SECURITY INVOKER` SQL or plpgsql function, a trigger) is refused, and `postgres` **cannot** fix that with a migration: `GRANT USAGE ON SCHEMA auth` is a silent no-op because `postgres` holds that privilege without grant option. Claim readers must therefore be `SECURITY DEFINER` `private` functions (as build-notes already plans: `cand_*()` readers, `search_path = ''`), or the claim must be read inside a policy expression (views were not tested here).
2. The policy path depends on a Supabase default (PUBLIC `EXECUTE` on `auth.jwt()`) that no migration of ours controls. M3a's candidate-role pgTAP tests are the guard: if a Supabase upgrade or hosted setting removes it, they fail. This spike could not test that removal, because `postgres` cannot revoke it.

(The harness also grants `EXECUTE` on its two probe functions to `trace_candidate`. That is test machinery that is rolled back, not a grant the role needs.)

## Findings

- **The mechanism works as assumed** (build-notes Q6): a verified Trace-issued token, turned into `request.jwt.claims` after `SET LOCAL ROLE trace_candidate`, makes a plain `candidate_id = ((select auth.jwt()) ->> 'candidate_id')::uuid` policy return exactly the token holder's row.
- **Fail closed:** with no claims the policy returns zero rows; with the other candidate's claims it returns only the other row (the policy follows the claims, not a constant).
- **The claims are not protected from the role that reads them.** The "other candidate's claims" check runs `set_config('request.jwt.claims', ...)` while already `trace_candidate`, and it works: `set_config` is callable by every role. So Postgres trusts whoever runs SQL as `trace_candidate`. This is acceptable only because candidates never run SQL: the gateway worker issues fixed, parameterised statements. M3a must treat any dynamic SQL in the gateway as a tenant-isolation bug and test for it.
- **The creator-membership row is visible:** with `postgres` creating the role, `pg_auth_members` shows `grantor=supabase_admin inherit=false set=false` (the PostgreSQL 16+ ADMIN-only creator row of spec 2.3, S5/D4) next to the explicit `grantor=postgres inherit=false set=true` row.
- **Token verification order matters:** header (`alg` pinned to `ES256`, `typ` `JWT`), then signature length and signature, then the strict claim shape, the route's token type, `exp` and `iat`. The spike never reads a claim before the signature has verified.

## Not covered (open for M3a, written down so nobody assumes it was tested)

- **Whether Supabase third-party or asymmetric JWT support could evaluate Trace tokens directly**, making the gateway and `SET LOCAL ROLE` unnecessary. Not investigated here. To be checked against the current Supabase docs at the M3a SPEC.
- The real chain: a gateway **login** role as `session_user` (NOINHERIT, only membership `trace_candidate`, `inherit false, set true`), connecting from a Worker, directly or through a pooler. The spike stands in `postgres` for the gateway. In particular, `SET LOCAL ROLE` plus `set_config(..., true)` inside an explicit transaction through a transaction-mode pooler is unverified.
- Hosted Supabase (supautils, hosted ACLs of `auth.jwt()`), and the cost of the extra transaction round trips.
- Storage and rotation of the private key (the spike puts a `kid` in the header and uses a fresh key per run).
- The lobby token's lifetime (Q7 gives session and portal; lobby is open).
- The M0b tables: skipped until stream B0 lands (see above).
