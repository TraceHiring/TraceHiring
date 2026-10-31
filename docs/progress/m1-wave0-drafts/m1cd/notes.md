# M1-c / M1-d drafting notes (2026-10-23)

Files in this folder: `m1c_imports_drafts.sql`, `m1d_members.sql` (migrations; the lead names them
`<ts>_m1_imports_drafts.sql`, `<ts>_m1_members.sql`, provisional timestamps per R5-30), bodies `rls_m1_imports.sql`
(122 assertions), `rls_m1_ai_drafts.sql` (100), `rls_m1_members.sql` (118), `preamble_changes.md`, this file.

## How it was checked
Every check ran on the shared local stack inside `begin; … rollback;` (pgTAP created inside the same transaction):
both migrations apply on top of the placed M1-a and M1-b; the three bodies pass with the patched preamble (only
exception below); every existing `supabase/tests/*.test.sql` was run against M1-c + M1-d (results under
"Breakages"). `catalog_meta` prints 126 `ok` lines and no `not ok` (its "planned 126 but ran 119" message, and
`catalog_probe`'s "18 but ran 4", appear on the baseline too: an artefact of running the file through psql, where the
fixtures' savepoint rollbacks undo pgTAP's counter rows; not caused by M1-c/d).

Expected red until the lead's M1-a fix round lands: `rls_m1_ai_drafts` "keys S: the authoring worker reads no answer
key" (the placed M1-a still grants that SELECT).

## Lead fix-round note (received mid-task) and how it is handled
- `private.ai_draft_job_running_in(p_org, p_workspace)`: M1-c does `create or replace` (true when a `running`
  `ai_draft_jobs` row exists for that org and workspace) plus a revoke (a no-op if M1-a already created it closed). It
  also works on today's M1-a, where the function does not exist yet (it is then created).
- Authoring worker SELECT on `item_answer_keys` dropped: `rls_m1_ai_drafts` asserts `permission denied` (red today, see
  above). The worker's key inserts in the body and in the preamble helper select the version id from `item_versions`
  (which it may read), never from the keys.
- Worker key inserts limited to its own in-review draft with a running job: every positive key insert in the body and
  the helper happens while the job is `running`. A negative case "key insert after the job completed" is not written
  (the drafts of the completed job are by then approved / not_approved and refused by the freeze anyway); add one if
  the fix round wants that branch proven on its own.
- Library copies store `param_spec - 'correctOptionId'`: nothing in M1-c copies library content.
  `import_item_batch` stores the importing row's own `paramSpec` (in a library-org import that is the library's own
  authoring, so `correctOptionId` stays in the library version; copies strip it per the fix). `save_item_variants`
  takes each variant's `correctOptionId` from the api for the caller's own draft and writes it only into
  `item_variant_keys`. Attention: `private.param_spec_valid` (M1-a) requires `correctOptionId`; a stripped copy fails
  that CHECK unless the fix round relaxes it for library copies.
- The authoring worker's positive paths for `items`, `item_versions` and `item_answer_keys` are in `rls_m1_ai_drafts`
  ("Drafts" section), against a real running job.

## Decisions where the spec is silent (HOW-level; none touches rules 1–9)
### M1-c
1. `import_jobs.rows_total` is not client-written: `ImportJobCreateRequest` has no row count, so the guard sets
   `rows_total = rows_ok + rows_error` when the job ends. Counts are recomputed from stored rows at completion /
   cancel / failure (E13: a re-sent batch cannot move them). `images_ok` is written by the api (it is the one that
   checked the uploads), 0–2000.
2. `import_jobs.error_code` added (R5-26 audits `import.fail {error_code}` but §3.2 lists no column): closed list
   `row_limit, image_limit, timeout, internal`; CHECK `(status = 'failed') = (error_code is not null)`.
3. Matrix says import_jobs U = "OW AD RC (cancel)"; §4.3 also needs someone to complete or fail a job, and the api
   runs with the user's JWT, so the staff UPDATE policy covers complete / fail / cancel and the guard owns the state
   machine (open → validating is done by the first `import_item_batch`). No worker role touches imports.
4. `import_row_errors`: "max 2,000 rows" read as 2,000 data rows per job (`row_no` 2..2001; row 1 is the header).
   `field` is a closed list (the template columns, plus `row` and `options`), `error_code` the 16 codes of §4.3.
   Staff hold a direct INSERT (the invoker function needs it); the guard requires an open/validating job. Errors are
   never updated or deleted (operator included).
5. `import_item_batch` DB payload (the api maps `ImportRow`): `rowNo`, optional api-found `errors[{field, code}]`
   (stored as-is, nothing inserted), `format, skillKey, difficulty, stem, contentSha256` (api canonical hash;
   required, else 22023), `options` as strings → ids `a..f`, `correct` `a..f`, `rubricKey` → latest version of that
   org rubric (missing → `missing_field`, unknown → `bad_format` on `rubric_key`; §4.3 has no rubric code), `imageKey`
   + `imageAlt` (the key must be under `item-media/{this org}/…`, else `bad_image_ref`), `paramSpec` + `variants`
   (variants as `save_item_variants`). DB-side row errors: field checks, `duplicate_in_file` (same `contentSha256`
   earlier in the job), `duplicate_in_bank` (same hash on a bank row of the job workspace, not `not_approved`), and
   guard refusals mapped to codes inside a per-row savepoint (bad skill, bad key, bad media, bad param spec, variant
   difficulty / missing variant keys → `variant_generation_failed`). Any other exception fails the whole batch (an
   api/DB bug, never a row error). Image codes `image_missing / image_too_large / image_bad_type` come from the api.
   Response is rebuilt from stored rows, so a re-sent batch returns the same JSON (E13).
6. Library detection inside the invoker function uses `orgs.kind = 'trace_library'` (it cannot call
   `private.library_org_id()`, R2-5).
7. New error string `TRACE_BAD_INPUT: <reason>` (22023) for malformed function input (batch size, rowNo, payload
   shape). The api validates with zod first, so it means an api bug.
8. `ai_draft_jobs.drafts_discarded` added (§6.4 "failed drafts are discarded and counted"). `drafts_created` is
   computed by the guard from the stored drafts when the job ends (worker value never trusted). `error_code` closed
   list `drafter_error, bad_output, no_draft_passed, timeout, internal` (contracts `AiDraftJobView.errorCode` must
   match). `provider, model_id, prompt_version` are written by the api at request time (versioning rule); the worker
   updates only `status, drafts_discarded, error_code`. queued → failed is allowed (e.g. a poison message).
9. (Superseded at placement, spec R5-50/R5-51: the cap is `private.ai_draft_job_has_room`, checked on draft insert
   only, and both hooks lock the job row.) `private.ai_draft_job_running` also caps drafts at the job's `count`. The draft's format/skill are not checked
   against the job's (the hook signature has no format); a follow-up guard could add it.
10. `save_test_draft` DB payload documented in the function header; `settings` optional (absent keeps the ruleset's
    settings; present resets `preset_version` so the guard picks the latest); a pool section with inline items is
    refused (22023); every written inline item gets a fresh rubric version (as D1's PUT); returns `{sections, items}`.
11. `save_item_variants` replaces all variants + keys of the draft (regeneration), returns the count; variant shape
    `{variantNo, params, stem, options, difficulty, contentSha256, correctOptionId}`.
12. Import cancel/failure leaves rows already imported as they are (approved in a customer org, in_review in the
    library). §4.3 is silent; the founder may prefer cancel to retire them (Q23 territory, not rules 1–9).

### M1-d
13. `member_invites.membership_id` added (FK to memberships, CHECK `(status = 'provisioned') = (membership_id is not
    null)`): exactly-once provisioning — a re-delivered job for the same user returns the same membership.
14. One pending invite per `(org_id, email_hmac)` (partial unique). Invites are never deleted (operator included).
15. Invite creation is admin-only per the matrix (I: AD aal2); an owner who is not also admin can read but not
    invite or cancel (pure_owner cases). An `org_owner` invite needs the inviter to be an owner too (R2-14).
16. The provisioning path: `trace_admin_worker` has no INSERT grant on `memberships`; the guard accepts an `invited`
    insert from that role only when the transaction-local marker `trace.provision_invite` names a pending invite of
    the same org (and `job_org_id()`), roles and workspace. `created_by` of the provisioned membership is the inviter;
    `team_id` is never set. Unknown or cross-org invite → 42501 (no existence oracle); a live membership already held
    (E26) → 23505 `TRACE_GUARD: the user already has a membership in this org` (the worker then marks the invite
    `failed`); unknown Auth user → 23503 (FK).
17. Inviter re-check (R2-14): an active membership in an active org holding owner or admin, and owner when the invite
    names `org_owner`.
18. §4.5 `invited → removed (admin)` is now allowed for owners/admins (M0b refused every change from `invited`). The
    operator may still INSERT `invited` rows (all M0b fixtures do), and `invited → active` stays refused for everyone
    but the invitee, the operator included (as M0b's R1 tests expect).
19. `private.memberships_audit` is replaced too (not only the guard): same details shapes; actor_kind `system` when a
    `trace_*` role writes (the provisioning insert), instead of an `org_user` row with no user. Add it to R5-30's
    re-derive list.
20. EXECUTE on `private.valid_roles` granted to `trace_admin_worker` (the roles CHECK runs as the writer on its status
    updates, R2-6).
21. An invitee may accept at any aal (R2-15); the accepted membership then counts only at its roles' aal (proved for
    an owner invite at aal1 vs aal2).

## Breakages the lead must fix in existing files
- Every generated `supabase/tests/rls_m1_*.test.sql` carries the old `pg_temp.ai_draft`: `rls_m1_publish_v2` and
  `rls_m1_serving` abort on `item_versions_ai_draft_job`. Apply `preamble_changes.md` and regenerate all of them.
- `rls_memberships.test.sql:404` ('U: an invited member cannot change their own display_name before accepting
  [B0-SP7]') expects `OK 0`; with the R2-15 policy the invited row is now reachable by its user, and the guard refuses:
  `42501 TRACE_GUARD: an invited member can only accept`. Unavoidable (a USING clause cannot see the new values);
  the assertion should become the 42501 text (still a denial, now explicit). Every other `rls_memberships` assertion
  passes, including "admin/operator cannot move invited to active" and "app callers cannot insert invited".
- `rls_roles.test.sql`: `:168` the authoring worker list gains `ai_draft_jobs:write`, `idempotency_keys:write`;
  `:169` the admin worker now holds `member_invites` (`member_invites:write`); `:193` the private EXECUTE list gains
  `trace_admin_worker.provision_invited_member` and `trace_admin_worker.valid_roles`.
- `rls_d1_idempotency.test.sql` 'L-20: one SELECT and one INSERT policy per worker role (six policies)' fails: M1-c
  adds the two `trace_authoring_worker` policies of §6.4 (scope `ai_draft`). This is a D1 assertion, so under
  AT-M1-28 / R5-28 it needs a supersession row (extend to eight, never loosen) — spec §6.4 requires the policies but
  R5-28's list does not name this assertion; flag in the M1 review.
- `rls_m1_candidate_denied`: `m1_tables()` should gain `import_jobs, import_row_errors, ai_draft_jobs, member_invites`
  and `m1_functions()` `import_item_batch, save_test_draft, save_item_variants, ai_draft_job_running_in,
  provision_invited_member` (and the new guards/audits if the list is meant to be complete). The current body still
  passes (lists are not exhaustive yet); anon / trace_candidate / service_role hold nothing on the new objects.
- `packages/db-types` regeneration; `AUDIT_ACTIONS` + detail schemas for `import.complete {import_job_id, rows_ok,
  rows_error, images_ok}`, `import.cancel {import_job_id}`, `import.fail {import_job_id, error_code}`,
  `ai_draft.complete {ai_draft_job_id, drafts_created}`, `ai_draft.fail {ai_draft_job_id, error_code}`,
  `member_invite.create {member_invite_id, roles}`, `member_invite.cancel|provisioned|failed {member_invite_id}`.
  Note `item.ai_drafted` (M1-a) carries `{item_version_id, ai_draft_job_id}`, not §6.4's `{checks_passed}`.
- MT floors: `rls-min-count` rises by 340 (122 + 100 + 118); catalog checks stay clean (MT-7 invoker functions in
  public with `search_path = ''`, MT-11 shapes use `job_org_id()` / `auth.uid()` / `my_*_ids`).

## Left out / for the lead
- No TypeScript (contracts, api modules, worker handlers); no `e2e`. The worker's idempotency-key use and the api's
  zod mapping of `ImportRow` → DB payload are the A2/A3 streams' job.
- AT-M1-08's serving gate with a real job is proven by the existing `rls_m1_serving` body through the patched helper
  (it passes); not duplicated here.
- Rules 1–9: nothing here reads or writes `quality.*` / `integrity.*`; no reject path; no PII column (no address, no
  topic, no cell value; the invitee's display name lives in `memberships.display_name` as in M0b). Nothing left out
  that touches rules 1–9.
