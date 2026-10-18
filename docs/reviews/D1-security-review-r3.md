# D1 security review: stream R3 api (whole stream)

- Date: 2026-10-18. Reviewer: security-reviewer agent (Opus, fresh context), read-only.
- Scope: `git diff 6ffe4e1 cbfe5ac -- services/api` on `d1/r3-merge` (77 files). Single test files run in workerd,
  all green: media-link, media-link-do, no-key-template, org-context, token, candidate-rpc, invitation, outbox-route,
  publish, log-hygiene, route-inventory.

## Verdict: PASS WITH NOTES

No Critical or High finding. #1 (Medium) and #2 (Low) are **due before R3 merges into `d1/integration`**.

| # | Severity | Finding | Fix (due) |
| --- | --- | --- | --- |
| 1 | Medium | `openApiDb` (`modules/candidate/api-db.ts:61-70`) hands `API_DB_URL` to postgres.js without `ssl`; postgres@3.4.9 defaults to no TLS and takes it only from the URL's `sslmode` (`prefer` falls back to plaintext, `require` skips certificate checks). A URL without `sslmode`, or with `prefer`/`disable`, sends the `api_login` password and every trace_api query (contact emails, consent, OTP-flow state, media grants) in plaintext; `prefer` lets an on-path attacker strip TLS. Nothing in code enforces ADR-031's `sslmode=require`. | Fail closed in `openApiDb`: for a non-local host refuse a missing or weak `sslmode` (reuse the rule in `scripts/ops/lib.mjs:125-158`) and pass `ssl: 'require'` explicitly (`verify-full` once the pooler CA is pinned). Test: a URL without `sslmode` gives `null` (503 `unavailable`). |
| 2 | Low | Publish (`modules/tests/routes.ts:227-248`) puts `packages/{draftId}.json` to R2 before anything checks that the caller may publish; an assigned reviewer can do every read before the put (RLS SELECT), so it gets 409 only after an unauthorized R2 write (no rate limit). A put built from an older draft can also land after the legitimate publish's check, leaving R2 bytes that do not match the frozen `content_sha256` (candidate starts then fail closed: a denial of service on the test). | `requireRole(ctx.rest, ctx.caller, orgId, ['org_owner','admin','recruiter'])` before any bucket call; better, write only the package rebuilt from the frozen rows after the guarded UPDATE (identical bytes from every writer) and retire the version if that put fails. Test: a reviewer's publish leaves `bucket.puts` empty. |

## Notes (not findings)
- **N1** `/v1/orgs/**` has no CORS or preflight handling (OPTIONS gets the generic 404). Fail closed, but the recruiter app calls the api cross-origin with `Authorization`, so R5 integration needs an allow-list `cors()` on `ALLOWED_ORIGINS`. `/media` CORS is correct (exact origin, `Vary: Origin`, no credentials).
- **N2** The demo outbox is one DO per org, readable by any owner, admin or recruiter of the org, and holds invite links and OTP codes (cross-workspace inside an org). Matches spec §6.1/§6.2 (dev/staging only, `@example.test` only, 404 before auth otherwise); accepted for D1, must not survive into a real Messaging path.
- **N3** (outside the diff) wrangler warns that `observability.redact_query_string` in `services/api/wrangler.jsonc` is an unexpected field, so query-string redaction may not apply. No exposure today (invocation logs and traces off); check the key or the wrangler version before turning them on (`/media/<jti>?exp=&sig=`, R3-6).

## Checked and clean (summary)
Tenant isolation (`org_id` on every PostgREST read, set after the spread; constant trace_api SQL with bound
parameters; no service-role key; the DOs hold no DB credentials). Supabase JWT (ES256/RS256 pinned to the key's alg,
HS256/none/oct refused, signature before claims, iss/aud/role/exp/aal, JWKS TTL 10 min and unknown-kid refetch at most
every 30 s, the raw JWT only to `/rest/v1`). Candidate tokens (ES256 strict header and claims, typ per method, lifetime
caps, iat skew, re-verify on every lobby method). Rule 9 sticky `blocked_age`, no link or message when blocked. 404 vs
403. RPC only over the service binding, zod in and out, constant codes, 256 KB body cap, 20/min link issuance per viewer.
Media R3-1..R3-9 (grant per transaction before link or bytes, HMAC `v1|jti|exp` with constant-time verify and canonical
sig, exp before the DO, atomic burn before the DB, only the DB key streamed, one 404 for every failure, no-store,
no-referrer, nosniff, CORP, exact ACAO). Logging (one event, SQLSTATE only; log-hygiene passes). Invitations (32-byte
token, SHA-256 stored, `inviteUrl` only in the create response, token in the fragment). Outbox (missing/empty
TRACE_ENV or production → 404 before auth; vendors re-check on every send). Route inventory and rules 1 and 6.

Not checked (other scopes): the SQL bodies of the grant/resolve functions and guard triggers (database-reviewer); the
edge side of the candidate flow (C1); real PostgREST/JWKS/DO/R2 (`e2e-local`); `pnpm audit --prod`.

## Resolution (lead, 2026-10-18, on d1/r3-merge)

- **#1 Medium: fixed** in `05dec63` (apiDbSsl; api-db-tls.test.ts, 16 cases, red first).
- **#2 Low: fixed** in `0cc6f1c` (requireRole org_owner/admin/recruiter before the bucket lookup and every read; a reviewer, a removed membership and an aal1 admin leave `bucket.puts` empty; red first). The "better" option (write only the package rebuilt from the frozen rows) is not taken: the R2 write must precede the guarded UPDATE so a published version always has its package; a stale put by an authorised publisher is still caught by the post-UPDATE re-check (rewrite or retire) and the SessionDO hash check.
- N1 (org CORS) is due with R5; N2 accepted for D1; N3 open (check before turning on invocation logs).
