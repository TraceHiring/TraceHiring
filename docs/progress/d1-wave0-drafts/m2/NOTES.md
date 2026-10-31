# D1 migration 2 (`<ts2>_d1_invites_sessions.sql`): notes for the lead

Draft: `d1_invites_sessions.sql.draft` (this folder). Smoke: `smoke.sql.draft`.
Tested only inside rolled-back transactions on the shared local Postgres 17.11 (`supabase_db_trace`).
The tests ran on top of the placed migration 1 (`20261014065417_d1_authoring.sql`, 45206c8), which was already in the
DB, so the migration-1 draft was skipped (the runner applies it only when `to_regclass('public.tests')` is null).

## What it creates

- **Role `trace_api`**: the same idempotent `do` block as migration 1. It does nothing when the role exists (it only
  re-asserts `nologin nocreatedb nocreaterole nobypassrls`).
- **`grant usage on schema private to trace_api, trace_worker`**: a by-name call to
  `private.resolve_invitation_by_hash()` / `private.mirror_session()` needs schema USAGE. So does the INVOKER body of
  `mirror_session`, which calls `private.job_org_id()`. MT-8 forbids USAGE only for anon and authenticated. The smoke
  (G24) shows these two roles can execute nothing in `private` except `api_org_id`/`resolve_invitation_by_hash`
  (trace_api) and `job_org_id`/`mirror_session` (trace_worker).
- **Enum** `invitation_status` = created, sent, otp_verified, started, submitted, expired, revoked, blocked_age. No
  rejected value.
- **Tables.** Every table has `org_id`, `unique (org_id, id)`, composite FKs and RLS on. App-readable tables also carry
  `workspace_id`/`test_id`, copied by trigger, with `(org_id, test_id)` and `(org_id, workspace_id)` indexes.
  - `invitations`: the L-31 CHECK `invitations_age_block` and `invitations_age_block_source`; the contact CHECK
    (`@example.test`); a 64-hex hash; every unique in §3.2, including the partial live-contact unique.
  - `consents`: append-only. FKs go to `invitations (org,id,test_version_id)`, `test_versions (org,id,ruleset)` and
    `notice_versions`.
  - `sessions`: the four pin FKs of §3.2 and the CHECKs.
  - `session_items`, `responses`, `media_objects`.
- **Triggers.** All are SECURITY DEFINER with `search_path = ''`, EXECUTE revoked and `ENABLE ALWAYS`, except
  `invitations_audit`, which is an ordinary AFTER trigger like the M0b audit triggers.
  - `invitations_label` (BEFORE INSERT): label, scoping copy, published-pin check, inviter-minor block.
  - `invitations_guard` (BEFORE UPDATE): immutability, set-once fields, and the state machine for each role.
  - `invitations_audit`: `invitation.create {test_version_id, status}` and `invitation.revoke {old_status}`.
  - `consents_guard`.
  - `consents_append_only` (row) and `consents_no_truncate` (statement).
  - `sessions_guard`.
  - `session_items_guard`, `responses_guard`, `media_objects_guard`.
- **Grants and policies.** These follow the §3.3 rows for the six tables plus `idempotency_keys`, with one policy per
  operation per role set, all `to <role>`. Arms:
  - staff: `my_workspace_ids('{org_owner,admin,recruiter}')`;
  - reviewer: `my_assigned_test_ids('{reviewer}')`;
  - workers: `job_org_id()`;
  - api: `api_org_id()`.

  Nothing is granted to anon or the candidate roles. HM is excluded by the helpers.
- **L-20.** The four M0b `idempotency_keys_*_worker` policies are dropped and UPDATE and DELETE are revoked from
  `trace_worker`. SELECT and INSERT go to the three worker roles. There are six policies, each
  `scope = '<own job>' and org_id = (select private.job_org_id())`.

### Functions

| Function | Kind | EXECUTE granted to |
| --- | --- | --- |
| `private.resolve_invitation_by_hash(text)` | STABLE DEFINER, sql | trace_api |
| `private.mirror_session(uuid, jsonb)` returns text | VOLATILE INVOKER, plpgsql | trace_worker |
| `private.invitations_label()` | trigger, DEFINER | nobody |
| `private.invitations_guard()` | trigger, DEFINER | nobody |
| `private.invitations_audit()` | trigger, DEFINER | nobody |
| `private.consents_guard()` | trigger, DEFINER | nobody |
| `private.consents_append_only()` | trigger, DEFINER | nobody |
| `private.sessions_guard()` | trigger, DEFINER | nobody |
| `private.session_items_guard()` | trigger, DEFINER | nobody |
| `private.responses_guard()` | trigger, DEFINER | nobody |
| `private.media_objects_guard()` | trigger, DEFINER | nobody |

Every function revokes EXECUTE from `public, anon, authenticated, service_role` first.

`mirror_session` returns:
- `'stored'`;
- `'duplicate'` when the `session_mirror` key exists, or the stored `mirror_seq` is greater than or equal to the
  message's;
- `'dead_invitation'` for an invitation that is revoked, expired or blocked_age. Nothing is written.

It raises 42501 when `p_org_id` is not `job_org_id()`, and 22023 `TRACE_BAD_MIRROR` for a malformed message.

### Error contract
- Guards raise `42501 TRACE_GUARD: …`.
- A missing parent raises `23503 TRACE_GUARD: … not found`.
- A bad mirror message raises `22023 TRACE_BAD_MIRROR: …`.
- Writes to consents raise `P0001 TRACE_APPEND_ONLY`.

## Results

- **Smoke**: `PASS 181 / FAIL 0 / TOTAL 181`. It covers:
  - every state-machine transition per role (authenticated, trace_api, trace_worker, the operator, hm, both
    reviewers, the other-org admin);
  - the L-31 CHECKs, run with the insert trigger switched off inside the transaction;
  - set-once fields: `session_id`, `started_at`, `adult_self_declared`, and the session times and receipt;
  - L-1, L-17 (a retry with the stored time is a no-op), L-32 and L-35;
  - consents append-only: the revoke (42501), then the trigger (P0001) for UPDATE, DELETE and TRUNCATE, in normal and
    replica mode;
  - `mirror_session`: stored, duplicate, duplicate by key with a higher `mirrorSeq`, dead_invitation, and malformed
    messages;
  - the `idempotency_keys` scope, org-unset, cross-org, UPDATE and DELETE cases for each worker;
  - column-limited reads, `responses` denied to app roles, and the anon and candidate grant scan;
  - a column-name scan for score, band, grade, outcome and reject.
- **Catalog checks**: all 18 `supabase/catalog-checks/MT-*.sql` ran inside the same rolled-back transaction after the
  draft was applied. **All return 0 rows**, including MT-11. The allow-list for `job_org_id`, `api_org_id` and
  `my_assigned_test_ids` landed in 357919d, so the new worker and api policies are clean.

## Deviations from the spec text

- **D-1.** `mirror_session` does **not** insert the `public.reports` row, because `reports` is created in migration 3.
  Migration 3 should `create or replace function private.mirror_session(uuid, jsonb)` (this keeps the EXECUTE ACL) and
  add `insert into public.reports (org_id, session_id) values (p_org_id, v_session) on conflict do nothing` before the
  invitation update.
- **D-2.** No login roles are created. The §3 intro and M0b §2.3 say the four named login roles are operator-created,
  with passwords from the runbook. The runbook statements, with no password in SQL, are:
  `create role api_login login noinherit;` followed by `grant trace_api to api_login with inherit false, set true;`.
  The same pattern applies to `jobs_mirror_login` → `trace_worker`, `jobs_quality_login` → `trace_quality_worker` and
  `jobs_integrity_login` → `trace_integrity_worker`. The password is set out of band.
- **D-3.** The `consents` owner keeps a **column-level `UPDATE (id)`**. `sessions → consents` is an FK, and the FK check
  runs `SELECT … FOR KEY SHARE` on consents as its owner, which needs UPDATE on at least one column. A full revoke made
  every session insert, and every invitation delete, fail with "permission denied for table consents". Any UPDATE still
  hits `consents_append_only` (smoke E15). Table-level UPDATE, DELETE and TRUNCATE stay revoked, so `relacl` holds none
  of them. The MT-15 append-only registry check must allow this column grant (it lives in `attacl`), or the FK has to
  go (see Q-8).
- **D-4.** `usage on schema private` is granted to `trace_api` and `trace_worker`. The spec text does not mention it,
  but by-name calls need it.
- **D-5.** The label lives in `invitations_label` (BEFORE INSERT only), which also does the scoping copy, the pin check
  and the inviter-minor block. `invitations_guard` is BEFORE UPDATE only. The two never fire together, so trigger order
  does not matter.
- **D-6.** The guards admit only the writers the spec names: `authenticated` creates and revokes, `trace_api` writes
  consents and its transitions, and `trace_worker` writes sessions and children. The plain operator session is refused
  (fail closed, see Q-1).
- **D-7.** `consents_guard` also requires that `notice_version_id` equals the test version's pinned
  `notice_version_id`. This is not in the spec; the fail-closed reading is that the consent must be for the notice the
  test pins. See Q-4.
- **D-8.** A replayed consent is a no-op at any step: the guard returns NULL when a row already exists for
  `(org, invitation, event)`. So a replay after `started` does not raise. `on conflict do nothing` also works.
- **D-9.** Rule 9: when `trace_api` sets `adult_self_declared = false`, the guard **forces** `status = 'blocked_age'`
  and `age_block_source = 'self_declared'`, whatever status the api sent. `blocked_age` without a false answer is
  refused. `started` also requires `adult_self_declared is true` (a second check alongside the consent).
- **D-10.** `started_at` may change only with the transition to `started`. An update that changes nothing is allowed,
  so a retried `sessionStarted` with the stored time succeeds and changes nothing. A different time raises (set once).
- **D-11.** `trace_worker` SELECT on invitations excludes `contact_email` and `link_token_hash`, which is narrower than
  the matrix's `S`. The mirror needs neither.
- **D-12.** `trace_quality_worker` SELECT on sessions is column-limited to `(id, org_id, test_version_id,
  ruleset_version_id, state)`, per §3.3 note 5. `trace_integrity_worker` has table-level SELECT.
- **D-13.** These items are added beyond the spec text:
  - sessions CHECK `(state = 'auto_submitted') = (submit_kind = 'deadline')`;
  - `session_items.served_at` is `not null`, and `section_id` is derived from the item by the trigger;
  - `responses_guard` checks that `answer_kind` matches the item format;
  - length CHECKs: contact ≤ 77, the label regex `^Candidate [1-9][0-9]{0,8}$`, `final_choice` 1–64, `r2_key` ≤ 200.
- **D-14.** Insert-only on `session_items`, `responses` and `media_objects` is enforced by guards that refuse UPDATE for
  every caller. DELETE is left to grants: there are none, and deletion is M7.
- **D-15.** On `sessions`, every UPDATE needs a strictly higher `mirror_seq`, and a non-`in_progress` state is
  terminal.
- **D-16.** The `invitations` update policy for `authenticated` has USING `status in ('created','sent')` with the
  workspace arm, and WITH CHECK on the arm only, in the L-30 style. A revoke of another state affects 0 rows.
- **D-17.** `mirror_session` rules:
  - it requires exactly one of `photo` and `photoSkippedReason`;
  - it also returns `dead_invitation` for `expired` and `blocked_age` (the spec names only revoked);
  - the idempotency key's `expires_at` is `submittedAt + 90 days`;
  - it locks the invitation `FOR UPDATE` before the duplicate checks, so concurrent duplicates serialise.
- **D-18.** Clients cannot choose `id` on invitations or consents: `id` is not in the INSERT grants.

## Open questions

1. **Operator path** (rules 2, 9 adjacent): the guards on all six tables refuse the plain `postgres` session. pgTAP
   fixtures therefore have to `set local role authenticated` with claims, `trace_api` with `trace.api_org_id`, or
   `trace_worker` with `trace.job_org_id`. Migration 1 allows operator inserts on authoring tables. Should invitations
   allow them too?
2. **Login roles:** confirm they stay a runbook step (D-2), with MT-14 fixtures for the four of them written by you.
3. **Mirror input shape:** `p_msg` is `SessionMirrorMessage` plus `responses:
   [{itemVersionId, kind: 'text'|'choice', text?, choice?, sha256, finalSeq}]`, which the job builds from the
   hash-checked `final.json`. The message schema in §4.4 has no answers. This needs a contract line in
   `@trace/shared` (lead).
4. Should the consent's notice be pinned to the test version's notice (D-7, enforced), or may any org notice be used?
5. Is `dead_invitation` for expired and blocked_age right (D-17)? The session guard would refuse those anyway.
6. Is a 90-day `expires_at` on idempotency keys acceptable, pending M7 cleanup?
7. **PostgREST inserts:** `link_token_hash` is insertable but not selectable, and `id` is not insertable. Does the org
   invitations endpoint get the new id through `return=representation` with `select=id`, or should `id` join the
   INSERT grant so the api supplies its own uuid? A `RETURNING *` would fail on the hash column. The same question
   applies to `tests` in migration 1.
8. **MT-15 and D-3:** do you accept the owner's `UPDATE (id)` on `consents`? It is needed by the `sessions → consents`
   FK. Migration 3's append-only tables are not FK targets in the spec, so the issue should not recur there; check
   `integrity_timeline_entries` if anything ever references it.
9. Inviting on an archived test (`tests.archived_at` not null) is not refused; the spec says nothing. Add a guard?
10. Not re-tested: applying the migration-1 *draft* plus this draft on a DB without migration 1. The shared DB already
    has the placed migration 1. The runner handles both cases.

## Lead decisions at placement (2026-10-14, `20261014094801_d1_invites_sessions.sql`)

- **(a) USAGE on schema `private` for `trace_api` and `trace_worker`: accepted (D-4).** MT-8 forbids it only for anon and authenticated; EXECUTE stays per function (`rls_roles` pins the exact lists: `trace_api` api_org_id + resolve_invitation_by_hash, `trace_worker` job_org_id + mirror_session).
- **(b) Owner `UPDATE (id)` on `consents`: accepted (D-3, Q-8).** Needed by the `sessions → consents` FK; every UPDATE still hits `consents_append_only`. The catalog checks pass with it.
- **(c) Operator path (Q-1): allowed on invitation INSERT only**, as on the migration-1 authoring tables; the creator is named only on the operator path (m-1 rule); the rule-9 inviter block holds for every caller. Consents stay api-only, sessions and children worker-only.
- **(d) `rls_idempotency` (M0b) rewritten for L-20** in the same change (worker: own scope in its job org, S and I only).
- **Grants (D-18, Q-7):** `trace_api` supplies consent `id`; `trace_worker` supplies `id` on session children and `upload_state` (pinned by its CHECK). Authenticated invitation inserts still cannot choose `id`. (Corrected after the DB review m-4: `occurred_at` on consents and `workspace_id`/`test_id` on sessions are **not** granted, because the guards always set them.)
- **Guard fix:** `consents_guard` refuses a consent outside `api_org_id()` **before** the replay no-op, so an api call scoped to no org or another org learns nothing about existing consents.
- **Tests pinned** to the codes the migration gives (tests NOTES ambiguities 2, 3, 9), each still a refusal; two fixture bugs fixed (two trace_api denials ran as the operator; a session finish without a newer `mirror_seq`); a non-canonical `jobKey` is a `22023` malformed message. The migration-3 assertions (trace_api denials on cards/timeline/reports, mirror_session writing `reports`) were moved out; add them to the m3 files.
- Result: `pnpm test:rls` 24 files, rls 1835, catalog 142, db-types current.

- **DB review of migration 2:** APPROVE WITH MINOR FIXES; M-1, m-1, m-3, m-4, m-5 fixed in place (docs/reviews/D1-db-review-m2.md).
