# D1 migration 1 (`<ts1>_d1_authoring.sql`) — notes for the lead

Draft: `d1-m1-migration.sql` (same folder). Tested only inside rolled-back transactions on the shared local Postgres 17.11.
It applies cleanly on top of the 6 existing migrations (M0a + M0b) in one transaction.

## What it creates
- Role `trace_api` (idempotent `do` block, nologin, same attributes as m0b_roles). Spec lists it under migration 2, but migration 1 already grants to it
  (`api_org_id()`, `test_versions` columns, `notice_versions`). Migration 2's `create role ... if not exists` is then a no-op.
- Enums `test_version_status`, `section_format`.
- Tables (all `org_id`, `unique (org_id, id)`, composite FKs, RLS on, `workspace_id`/`test_id` + indexes where the matrix needs them):
  `tests`, `rubric_versions`, `notice_versions`, `ruleset_versions`, `test_versions`, `sections`, `item_versions`, `item_answer_keys`
  (PK `(org_id, item_version_id)`, no `id`), `assignments`.
- Functions (all `private`, `search_path = ''`, EXECUTE revoked from public/anon/authenticated/service_role first):
  | function | kind | EXECUTE granted to |
  | --- | --- | --- |
  | `job_org_id()` | STABLE INVOKER | trace_worker, trace_quality_worker, trace_integrity_worker |
  | `api_org_id()` | STABLE INVOKER | trace_api |
  | `my_assigned_test_ids(org_role[])` | STABLE DEFINER | authenticated |
  | `membership_counts_for(uuid, org_role[], text, text[])` | STABLE DEFINER | nobody |
  | `membership_counts(org_role[])` | re-created (`create or replace`, keeps ACL), now calls `_for` with `auth.uid()`, `aal`, amr methods (objects only) | nobody (as before) |
  | `mcq_options_valid(jsonb)`, `rubric_criteria_valid(jsonb)` | IMMUTABLE INVOKER (CHECK helpers) | authenticated (a CHECK runs with the writer's privileges, as `valid_roles`) |
  | `signal_settings_valid(jsonb)` | IMMUTABLE DEFINER | nobody (per spec) |
  Truth table of `membership_counts_for` is the M0b one; checked in the smoke run (otp ok, otp+password no, password-only no, reviewer aal1 no, aal2 yes, null aal no, null element in amr ok).
- Triggers (all SECURITY DEFINER, `search_path = ''`, EXECUTE revoked). ONE BEFORE trigger per table, so scoping-copy + immutability + freeze have no ordering dependency; all guards are `ENABLE ALWAYS`:
  `tests_guard` (+ `tests_audit`), `rubric_versions_guard`, `notice_versions_freeze`, `ruleset_versions_guard`,
  `test_versions_guard` (copy workspace, assign version_no, state machine, freeze, publish validation, stamps ruleset `published_at`, creator auto-assignment),
  `test_versions_delete_guard` (draft only), `test_versions_after_delete` (deletes the unpublished ruleset row), `test_versions_audit`,
  `sections_guard`, `item_versions_guard`, `item_answer_keys_guard`, `assignments_guard`, `assignments_no_update`, `assignments_audit`.
  Freeze/guards fire for every caller (postgres, workers, replica mode) with no operator bypass; verified with `session_replication_role = replica`.
- Grants/policies: per the matrix, one policy per operation per role set, all `to <role>`; authenticated arms use `my_workspace_ids('{org_owner,admin,recruiter}')`,
  `my_assigned_test_ids('{reviewer}')` or `my_org_ids(...)`; workers `org_id = (select private.job_org_id())`; trace_api `org_id = (select private.api_org_id())`.
  Quality worker: table-level SELECT on `test_versions, sections, item_versions, item_answer_keys, rubric_versions`. Integrity worker: SELECT on `ruleset_versions`.
  trace_api: `select (id, org_id, test_id, status, total_time_seconds, ruleset_version_id, notice_version_id, content_sha256)` on `test_versions`, SELECT on `notice_versions`.
  `assignments`: RC INSERT/DELETE only `as_role = 'reviewer'`, in own workspaces, on tests where the caller holds a `recruiter` assignment (L-16); OW/AD any; no UPDATE grant plus a no-update trigger; reviewer SELECT own rows only.

## New audit actions for `AUDIT_ACTIONS` (packages/shared)
`test.create`, `test.publish` (details `{version_no}`), `assignment.create`, `assignment.delete` (details `{test_id, membership_id}`; written for the recruiter path and the publish auto-assignment too).
(`invitation.*` and `media.*` come with migrations 2 and 4.) `object_table` values used: `tests`, `test_versions`, `assignments`.

## Lead-only follow-ups
- MT-11 `helper_function` allow-list: add `job_org_id`, `api_org_id`, `my_assigned_test_ids` (the `private` branch of the `caller` expression). `membership_counts_for` is not in any policy, so it is not added.
  Verified with a patched copy of MT-11 (those three names added): clean. Fixtures (positive + negative per helper) still needed.
- `pnpm db:types` after placing the file (new `public` tables).
- Migration 3 must: add FK `(org_id, band_rule_version_id) -> integrity.band_rule_versions (org_id, id)` and index `(org_id, band_rule_version_id)` on `ruleset_versions`; create the L-8 trigger named so it sorts after `test_versions_guard` (e.g. `test_versions_ruleset_seed`): the guard sets `workspace_id`, `version_no` and `created_by` on INSERT and does not touch `ruleset_version_id`/`notice_version_id` on INSERT, so L-8 may overwrite them. L-8 inserts the ruleset row with the five `signal_settings` keys `paste, drop, untrusted_input, tab_hidden, fullscreen_exit` (see O-3).
- Until migration 3 runs, publish is refused (`TRACE_GUARD: publish needs the pinned ruleset and notice`), which is the intended fail-closed behaviour.

## Catalog checks (inside the rolled-back transaction, after applying)
All 18 `MT-*.sql` ran. Rows returned: **MT-11 only**, 14 rows, all branch `no_caller_reference`, each on a policy that calls `job_org_id()`, `api_org_id()` or `my_assigned_test_ids()` (not yet allow-listed):
`tests_select_reviewer`, `ruleset_versions_select_reviewer`, `test_versions_select_reviewer`, `sections_select_reviewer`, `item_versions_select_reviewer`, `item_answer_keys_select_reviewer`,
`rubric_versions_select_quality_worker`, `test_versions_select_quality_worker`, `sections_select_quality_worker`, `item_versions_select_quality_worker`, `item_answer_keys_select_quality_worker`,
`ruleset_versions_select_integrity_worker`, `notice_versions_select_api`, `test_versions_select_api`. With the allow-list patched (copy of MT-11) the check returns no rows. MT-1..MT-10, 12, 13, 14, 8b: no rows.

## Smoke results (rolled back; not part of the deliverable)
50-case script: recruiter at aal1 with OTP creates test/sections/items/rubric/key and publishes; creator auto-assigned (audit: `test.create` 1, `test.publish` 1, `assignment.create` 2 incl. the reviewer one);
publish refused with no sections / no items / no key / no hash; edits after publish refused for owner-role too (operator, replica mode); retired is terminal; draft delete removes its ruleset row; published ruleset frozen;
notice immutable; a non-assigned recruiter cannot assign; assigned recruiter assigns a reviewer but not a recruiter; reviewer at aal2 sees the assigned test across the child tables and own assignment only, at aal1 sees nothing;
workers see nothing without `trace.job_org_id`, see their org's rows with it; quality worker cannot read `tests`; integrity worker cannot read `test_versions`; trace_api cannot read `quality_cutoff`; anon denied.

## Deviations from the spec text / open questions
- O-1 `ruleset_versions` has SELECT only for `authenticated` (matrix says SIU(d)). `signal_settings` and `band_rule_version_id` are outside the grant (spec) and every other column is system-assigned, so no writable column is left; the draft ruleset is created by the L-8 trigger and removed by `test_versions_after_delete`. Say if you want an INSERT/UPDATE policy anyway.
- O-2 `test_versions` delete cleanup is an AFTER DELETE trigger (spec: BEFORE): in a BEFORE trigger the version row still references the ruleset row (FK). Same effect.
- O-3 The "five D1 signal keys" are not named in the spec text. Taken from §4.6 (client-captured signals): `paste, drop, untrusted_input, tab_hidden, fullscreen_exit` (`connectivity_gap` is server-derived, no setting). Confirm.
- O-4 `version_no` on `test_versions` stays in the INSERT grant but is assigned (max+1 under the tests row lock) when null; a supplied value is kept (unique constraint decides).
- O-5 "Writes only while draft (d)" is enforced by the guard triggers for sections/items/keys; only `test_versions` carries it in the policies (UPDATE USING per L-30, DELETE USING `status = 'draft'`).
- O-6 `rubric_versions` UPDATE grant is `(criteria, content_sha256)` and is refused once an item references the rubric; `item_answer_keys` and `rubric_versions` validate content (key must name one of the item's option ids -> `23514 TRACE_BAD_ANSWER_KEY`; criteria 1-8 objects with `id`, `label`, `anchors`, `max_points > 0`).
- O-7 Retire (published -> retired) is allowed for the staff arm and not audited (no `test.retire` action in the spec list). Add one if wanted.
- O-8 `tests.created_by`/`test_versions.created_by` etc. are nullable plain uuids (no FK to `auth.users`, like `memberships.created_by`); operator inserts leave them null and the creator auto-assignment is then skipped.
- O-9 Created-at columns were added to `sections`, `item_versions`, `item_answer_keys`, `rubric_versions`, `test_versions` (not in the spec list; harmless, timestamp convention).
- O-10 Row-level behaviour: an UPDATE/DELETE that the policy hides (for example a published row for the delete policy, a retired row for the update policy) affects 0 rows without an error for `authenticated`; the guard errors (`42501`) apply to operator/definer paths and to visible rows. pgTAP cases should assert row counts there.
- O-11 Spec §3.4 says `membership_counts_for` takes `p_user`, unused by the truth table; kept, unused.
