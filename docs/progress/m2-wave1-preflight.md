# M2 Wave 1 pre-flight (2026-10-31)

Read-only pre-flight (docs/AUTOPILOT.md §2) for streams B1, B4 and B5 of `specs/m2-scheduling-invites.md` §11.3,
run by a Sonnet agent on `m2/integration` after Wave 0b part 2 (`ac1ebec`). Each item: status, what, where, the lead
action. The lead does every item in a lead-only path before the Wave 1 writers start, tests first. Items marked
**decide** need a lead decision (AUTOPILOT §4; build-notes row), none touches rules 1–9.

## B1 crypto + vendors
- **MISSING** `packages/pii-crypto` does not exist. Copy the `packages/item-variants` layout (package.json with
  `@trace/shared`, tsconfig.json, vitest.config.ts with `baseTest` from `@trace/config/vitest`, `src/index.ts`).
  `pnpm-workspace.yaml` globs `packages/*`. Lead adds `{ "path": "./packages/pii-crypto" }` to root `tsconfig.json`
  references, `"@trace/pii-crypto": "workspace:*"` to `services/api/package.json` and `workers/jobs/package.json`,
  and the lockfile update.
- **OK** boundaries element and edges (`packages/config/eslint/boundaries.js`); no script enumerates packages.
- **MISSING** `aws4fetch` is in no package.json, catalog or lockfile. ADR-034 names 1.0.20. Lead adds the catalog
  entry, the `packages/vendors` dependency and the lockfile (check the release-age rule first).
- **decide** `hmacSha256Hex` / `hexEqual` exist (`packages/shared/src/invite-email.ts:11,34`) but take a string key;
  §5 `KeyManager` returns a `CryptoKey` for the blind-index key: add a CryptoKey/bytes variant in `invite-email.ts`
  or have B1 pass raw key material.
- **decide** `pii-crypto` may import only `@trace/shared`, while `KeyManager` lives in `@trace/vendors`: B1 takes
  keys as plain parameters (CryptoKey or bytes) and never imports vendors.
- **decide** `scripts/check-boundaries.mjs:51,67,112` flags the text `HMAC_KEY` anywhere under `packages/`, so
  `SES_TEST_RECIPIENT_HMAC_KEY` in the vendors factory fails: a `CREDENTIAL_PATTERN_EXEMPTIONS` entry (`:79`) or an
  option named without `HMAC_KEY` with the Env wiring in lead-owned files.
- **NOTE** rule 13 (`check-boundaries.mjs:376-400`): every `Mock*` class or `mock*` factory in `packages/vendors/src`
  calls an `assert…Env(` guard.
- **decide** R5-22 changes the Messaging shape (`kind`→`purpose`, `id`→`providerMessageId`); D1-shape callers are
  B2-owned (`services/api/src/modules/outbox/outbox-writer.ts:89-98`, `candidate/service.ts:196`,
  `invitations/routes.ts:204`, outbox tests, `e2e/support/outbox.ts:10`). B1 keeps the D1 exports beside v2 until
  B2, or the lead updates the callers at B1's merge.
- **MISSING** `packages/vendors/src/index.ts` (+ test) is lead-only: B1 lists its exports for the lead's merge; B1
  tests import relative files.
- **decide** `email_hint` CHECK `^[a-z0-9]•••@[a-z0-9.-]+$`
  (`supabase/migrations/20261027040000_m2_contacts.sql:123`) refuses valid addresses starting with `_`, `-` or `.`:
  relax the CHECK (new migration) or define a hint rule (e.g. a fixed first character) in the spec.
- **MISSING** env names the spec never fixes: KMS key id/ARN, SNS topic ARN variable, SES from-address
  (`env.example:13` only), `MESSAGING_SMS_ENABLED` / `MESSAGING_WHATSAPP_ENABLED`.

## B4 edge
- **MISSING** portal mount: `workers/edge/src/app.ts:46-51` mounts invite, lobby, photo, session only. Lead adds
  `mountPortalRoutes(app, routeDeps)` and a minimal `routes-portal.ts` stub; `index.ts` needs no change.
- **OK** no new edge env, binding or var.
- **decide** `PortalRpcSchemas` is outside `CandidateRpcSchemas` (`packages/shared/src/contracts-candidate.ts:1126`,
  pinned at `contracts-candidate.test.ts:809`; typed by `workers/edge/src/rpc.ts:13,58` and
  `services/api/src/modules/candidate/candidate-rpc.ts:18`): B4 extends `rpc.ts` with the portal schemas
  separately; merge into `CandidateRpcSchemas` after Wave 2.
- **MISSING** wire schemas: the `manage` OTP verify response carrying the portal token (`OtpVerifyRes` at
  `contracts-candidate.ts:104-105` is lobby-only) and the public `POST /v1/portal/reschedule` response. Lead adds both.
- **decide** test helpers outside B4's patterns (`edge.test-helpers.ts`, `session.test-helpers.ts`,
  `real.test-helpers.ts`, `vitest.config.ts`, `http.ts`) need portal/purpose support: assign to B4 or edit first.
- **OK** every edge AT file is in B4's paths.

## B5 recruiter app
- **MISSING (blocker)** recruiter wire contracts and route table: `contracts-m2.ts` has create/detail, slots create,
  `SlotView`, batch request/response, `InvitationRow`, `RescheduleRequest`; not found: drive list, drive transitions
  (publish/close/cancel), slots list, upload create/complete/cancel (`uploadId`), paged invitation list with cursor,
  revoke-all-not-started, move-to-slot. The spec names only `/v1/orgs/:p/drives…` (R5-37). Lead designs the api
  surface (B2's routes) as schemas + endpoint builders in `apps/recruiter/src/api/endpoints.ts`; paths avoid the
  guard words (`d1-source-guards.test.ts`).
- **MISSING** lead-only entries: `apps/recruiter/src/routes.tsx` (drive routes behind `gated(isStaff, …)`),
  `shell/nav.ts`, `api/endpoints.ts`, and the exact-list pins `d1-guards.test.tsx:471-490`,
  `tests/m1-guards.test.tsx:182-218`, `shell/shell.test.tsx:29-57`, `api/endpoints.test.ts:445`.
- **OK** R5-59 word lists are the constants in `tests/m1-guards.test.tsx:43-65` (B5 copies them).
- **NOTE** no CSV parser in the repo and no new dependency without an ADR: B5 hand-writes it in `drives/**`.

## Cross-cutting
- **MISSING** wrangler vars and Env types: `MESSAGING_EMAIL_PROVIDER` (api, jobs), `SES_ALLOWED_TEST_RECIPIENT_HMAC`
  var + `SES_TEST_RECIPIENT_HMAC_KEY` secret (api, jobs), `AWS_WORKERS_ACCESS_KEY_ID` /
  `AWS_WORKERS_SECRET_ACCESS_KEY` (api, jobs; allow-listed, no Env type yet), SNS topic ARN (api only; name to choose;
  F-4), `JOBS_SMOKE_TOKEN` (jobs only).
- **MISSING (BUILD 4)** nothing sets `MESSAGING_EMAIL_PROVIDER=loadsim` for AT-M2-01 in `scripts/e2e-local.mjs`.
