# D1 stream R3 "api", writers R3a and R3a2: report

Branch `d1/r3-api-r3a2` (from `51667f6`, the tip of `d1/r3-api-r3a`, with `d1/integration` `6ffe4e1` merged in for
`createMessaging`). Scope: `services/api/src/modules/{tests,assignments,invitations,outbox,media,candidate}/**`.
Spec: `specs/d1-demo-slice.md` §6.2, §6.3, §4.2, §9. Nothing outside those directories was changed except this file.

## Commits (on top of `c514c7a`)

| SHA | Subject | Writer |
| --- | --- | --- |
| `ec83f46` | feat(band-engine): … (holds the candidate token files; wrong subject, not reworded) | R3a |
| `5120893` | feat(api): trace_api transaction layer, candidate store and the demo outbox | R3a |
| `d15f101` | feat(api): candidaterpc entrypoint with the nine lobby and session methods | R3a |
| `064f5fe` | feat(api): org context with supabase jwt verification and postgrest as the caller | R3a |
| `58503d8` | feat(api): media link module carried over from the previous r3 writer | R3a |
| `0fedd8b` | fix(api): media link passes amr verbatim and adds the r3-3 key scan | R3a |
| `51667f6` | wip(api): tests module draft left uncommitted by writer r3a at the usage limit | lead (saved) |
| `fc253c8` | chore(api): merge d1/integration 6ffe4e1 into r3a2 for the vendors messaging mock | R3a2 |
| `8230c4b` | feat(api): tests router as createtestsroutes with contract-checked answers | R3a2 |
| `9e8774a` | feat(api): assignments module with the l-16 recruiter gate | R3a2 |
| `98acfeb` | feat(api): demo outbox writes through the vendors messaging mock | R3a2 |
| `c58d087` | feat(api): invitations module with the rule 9 block and sent after the outbox | R3a2 |
| `ff4b27b` | fix(api): media fetch accepts only the canonical sig encoding | R3a2 |
| `7734f06` | fix(api): org context never calls fetch as a method | R3a2 |
| `7f8370b` | feat(api): demo outbox route and the r3a router mount test | R3a2 |

## Verification (this session, this branch)

- `pnpm --filter @trace/api typecheck`: green (wrangler types up to date, both tsconfigs).
- `eslint --max-warnings=0 .` in `services/api`: green.
- `vitest run` in `services/api`: **17 files, 247 tests, all passed**. Not run: `pnpm verify`, RLS tests, other
  packages (brief).
- Rolled-back psql probes on the local stack (`docker exec -i supabase_db_trace psql …`, `begin; … rollback;`),
  synthetic personas only, exactly the statements the modules send:
  - authoring as a recruiter (aal1, OTP): insert test (`org_id, workspace_id, name`) and draft
    (`org_id, test_id, total_time_seconds, quality_cutoff`; L-8 pins the ruleset and notice), draft update, rename,
    sections, rubric (`max_points`, `min_hits` accepted by `rubric_criteria_valid`), items, key, the replace deletes,
    publish with the api hash (published_at set, creator auto-assigned as `recruiter`), a draft-filtered update of a
    published version touches 0 rows, retire;
  - assignments: assigned recruiter inserts a reviewer row (OK), duplicate 23505, a recruiter row 42501 (RLS), a
    member without the role or of another org 42501 (guard), unknown test 23503 (guard), may not delete its own
    recruiter row (0 rows), deletes the reviewer row; a second recruiter **can read** the test's assignments (so the
    L-16 gate in the api is needed) but cannot write; a reviewer sees only its own rows; an owner at aal1 sees nothing,
    at aal2 writes any row; audit rows `assignment.create/delete` carry the caller;
  - invitations: insert as the recruiter (label `Candidate 1`, `created`), `false` → `blocked_age`, live-contact
    23505, non-`@example.test` 23514, an org user setting `sent` 42501, trace_api `created → sent` with
    `api_org_id` set (a blocked row does not move), revoke from `sent`, a blocked row is invisible to the revoke
    USING clause, re-invite after revoke OK, a reviewer insert 42501, audit `invitation.create/revoke`.

## AT ids covered (api parts)

| AT | Test file | Tests |
| --- | --- | --- |
| AT-D10 (media link) | `modules/media/media-link.test.ts` | 21 (incl. the new non-canonical `sig` case) |
| AT-D10 (atomic burn) | `modules/media/media-link-do.test.ts` | 8 |
| AT-D10 / R3-3 key scan | `modules/media/no-key-template.test.ts` | 3 |
| AT-D10 (assignments, L-16) | `modules/assignments/assignment.test.ts` | 11 |
| AT-D12 (inviter under 18) | `modules/invitations/invitation.test.ts` | 18 (3 rule-9 cases; the rest §6.2 invitations) |
| AT-D12, AT-D33–D35 | `modules/candidate/candidate-rpc.test.ts` | 36 (R3a; unchanged, re-run green over the new outbox path) |
| AT-D14/AT-D15 (api: cutoff 400/422, 409, hash mismatch retires) | `modules/tests/publish.test.ts` | 14 |
| §6.2 tests rows | `modules/tests/tests.test.ts` | 11 |
| AT-D18 (api half) | `modules/outbox/outbox.test.ts`, `modules/outbox/outbox-route.test.ts` | 15 + 6 |
| AT-D13 (R3a part of the allow-list) | `modules/tests/org-routes-mount.test.ts` | 3 |
| org context / R3-1 | `modules/tests/org-context.test.ts` | 14 (incl. 2 new unbound-fetch cases) |
| m0b §2.2 gate | `modules/tests/membership.test.ts` | 16 |
| candidate tokens / api-db | `modules/candidate/token.test.ts`, `api-db.test.ts` | 29 + 5 |

## What each module does (R3a2 part)

- **tests** (`modules/tests/routes.ts`, `createTestsRoutes({ org, packages })`): the five §6.2 rows. PUT: draft only
  (409), `qualityCutoff` missing/null/fractional/out of range → 400 `cutoff_required`. Publish: 409 unless the id is
  the open draft; 422 `cutoff_required`; 422 `draft_incomplete` (the guard's own preconditions, checked before any
  write); package to R2 `packages/{id}.json`; guarded UPDATE with the api `content_sha256`; rebuild from the frozen rows
  and compare, mismatch retires and answers 500 `internal`. Every answer is parsed against its contract (`unavailable`
  otherwise).
- **assignments** (`createAssignmentsRoutes(org)`): owner/admin any test; a recruiter only with its own `recruiter`
  assignment on the test and only reviewer rows; everyone else 404. Writes as the caller (RLS, guard, audit).
- **invitations** (`createInvitationsRoutes({ org, delivery })`): see the commit `c58d087`; `blocked_age` → no URL, no
  message; outbox write then `sent` as trace_api (L-1); the URL only in the create response.
- **outbox**: every write now goes through `createMessaging(env.TRACE_ENV, …)` (missing/empty `TRACE_ENV` refused);
  `demoOutboxEnabled` accepts only `dev`/`staging`; `GET /v1/orgs/:orgId/demo-outbox` is the generic 404 before
  auth anywhere else.
- **tests/membership.ts**: the caller's own membership (S18) and the `membership_counts_for` truth table, used only to
  answer 404 / 403 `aal2_required` before RLS; it never widens anything.
- Paths are exactly the brief's list (the spec names the same ones): see `org-routes-mount.test.ts`.

## Mount diff the lead applies

`services/api/src/app.ts` (the reports routers of `d1/r3-reports` mount next to these with the same `org`):

```diff
@@
 import { createHttpApp, NO_STORE } from '@trace/workers-http';
 import type { Hono } from 'hono';
+import { createAssignmentsRoutes } from './modules/assignments/routes.js';
+import { createInvitationsRoutes, deliveryFromEnv } from './modules/invitations/routes.js';
+import { createMediaRoutes, mediaFromEnv } from './modules/media/routes.js';
+import { createOutboxRoutes, outboxReaderFromEnv } from './modules/outbox/routes.js';
+import { createOrgDeps, type OrgDeps } from './modules/tests/org-context.js';
+import { createTestsRoutes, packagesFromEnv } from './modules/tests/routes.js';
@@
   /** Where log lines go. Defaults to the logger's own sink (console). Tests inject their own. */
   sink?: (line: string) => void;
+  /** The org routes' caller context. Defaults to createOrgDeps() (Supabase JWKS, PostgREST as the caller). */
+  org?: OrgDeps;
 }
@@
   app.get('/health', (c) =>
     c.json(healthBody(SERVICE, resolveVersion(c.env.VERSION), now()), 200, NO_STORE),
   );
 
+  const org = deps.org ?? createOrgDeps();
+  app.route('/', createTestsRoutes({ org, packages: packagesFromEnv }));
+  app.route('/', createAssignmentsRoutes(org));
+  app.route('/', createInvitationsRoutes({ org, delivery: deliveryFromEnv }));
+  app.route('/', createOutboxRoutes({ org, reader: outboxReaderFromEnv }));
+  app.route('/', createMediaRoutes({ org, media: mediaFromEnv }));
+
   return app;
 };
```

`services/api/src/index.ts` (replaces the three Wave 0 stubs; then run `pnpm --filter @trace/api types:gen` so the
generated `Env` types `OUTBOX`/`MEDIA_LINKS` with the real classes):

```diff
@@
-import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
 import { createApp } from './app.js';
 import { sentryReporter, withErrorReporting } from './error-reporting.js';
 
 const app = createApp({ reporter: sentryReporter });
 
-// Wave 0 stubs (specs/d1-demo-slice.md §4.2): wrangler needs these classes exported to build the
-// `migrations` block and the service binding the edge declares. The candidate-runtime and api
-// streams replace them with the real DemoOutboxDO, MediaLinkDO (§4.5) and CandidateRpc (§4.2
-// methods); until then any use throws.
-export class DemoOutboxDO extends DurableObject<Env> {
-  override fetch(): Promise<Response> {
-    throw new Error('not implemented');
-  }
-}
-
-export class MediaLinkDO extends DurableObject<Env> {
-  override fetch(): Promise<Response> {
-    throw new Error('not implemented');
-  }
-}
-
-export class CandidateRpc extends WorkerEntrypoint<Env> {
-  inviteResolve(): Promise<never> {
-    throw new Error('not implemented');
-  }
-}
+// The Durable Objects and the edge's service-binding entrypoint (spec §4.2); index exports only these and default.
+export { CandidateRpc } from './modules/candidate/candidate-rpc.js';
+export { MediaLinkDO } from './modules/media/media-link-do.js';
+export { DemoOutboxDO } from './modules/outbox/outbox-do.js';
```

## Not done / for the lead

- Real-DO tests of `DemoOutboxDO` and `MediaLinkDO` need the bindings in the vitest pool config (lead file); both are
  tested over fakes of the SQLite surface. The `insert … on conflict do nothing returning id` statement was checked
  against SQLite 3.49 locally.
- No end-to-end run through real PostgREST (the fakes model PostgREST; the SQL was probed with psql as above). The
  lead's `e2e-local` exercises the real path.
- `route-inventory.test.ts` and `log-hygiene.test.ts` are R3b's / the lead's; nothing in these modules logs.

## Open questions (none touches rules 1–9 beyond what is noted)

1. **Invite link window.** The spec names none; `INVITE_TTL_SECONDS` = 7 days (`invitations/routes.ts`). Confirm or
   give the value.
2. **Response bodies the spec leaves open:** `DELETE …/assignments/:id` answers the updated `AssignmentListResponse`
   (200), `POST …/assignments` the same with 201, `POST …/invitations/:id/revoke` the updated
   `InvitationListResponse` (200). Revoke of a visible invitation that is not `created`/`sent` is 409 `conflict`.
3. **Invite failure paths:** an outbox failure revokes the new invitation as the caller and answers 503 without the
   link (so the contact can be re-invited); a failed `sent` step after the outbox write answers 201 with the link and
   status `created` (the link is already delivered). Inviting to a test with no published version is 409.
4. **`aal2_required` (403)** is answered on assignments, invitations and the outbox route when the caller's own
   membership does not count at this aal (it is the caller's own state, m0b S18); everything the caller cannot see is
   still 404.
5. A member whose membership the caller can no longer read (removed) shows `displayName` "Removed member".
6. Each draft PUT inserts new `rubric_versions` rows; the old ones stay unreferenced (harmless; M1 can reuse them).

## For reviewers

- `tests/membership.ts` mirrors `private.membership_counts_for`; it only picks the error code, RLS decides rows.
- The L-16 gate in `assignments/routes.ts`: RLS lets every workspace recruiter read every assignment of the workspace
  (probe), so the api limits the panel to recruiters assigned to the test.
- `invitations/routes.ts`: the rule 9 path never builds a URL or calls Messaging when the inviter said no, even if the
  database returned another status (then 503).
- `media/media-link.ts`: the canonical-`sig` check (`ff4b27b`) removed a flaky test and sig malleability. The same
  base64url padding-bit malleability exists for JWT signatures decoded in `org-context.ts` and `candidate/token.ts`;
  it is not exploitable (nothing keys on the token string) and was left as is.
- `org-context.ts`: `fetch` is always called unbound (`7734f06`).
