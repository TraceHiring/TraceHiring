# Preamble changes for M1-c / M1-d (docs/progress/m1-wave0-drafts/pgtap/preamble.sql)

One helper changes; no helper is added (the three new bodies define their own body-local helpers:
`pg_temp.batch`, `pg_temp.res` in rls_m1_imports; `pg_temp.as_sub`, `pg_temp.res` in rls_m1_members).

## Replace `pg_temp.ai_draft` (preamble lines 281 to the end of that function)

Why: M1-c adds `check ((origin = 'ai_draft') = (ai_draft_job_id is not null))` (R5-35). The current helper inserts an
`ai_draft` version on the operator path without a job, so every generated `rls_m1_*.test.sql` that calls it fails
(`rls_m1_publish_v2`, `rls_m1_serving` abort with `violates check constraint "item_versions_ai_draft_job"`).

The replacement writes the draft the way the drafting job does: the operator requests a job (the guard makes it
`queued`), the authoring worker bound to the org moves it to `running`, inserts the `items` row, the version naming the
job (the guard sets `origin = 'ai_draft'`, `status = 'in_review'`, `created_by = null`) and its answer key. Same
signature, same return value, same recorded ids `<key>` and `<key>_item` (plus a new `<key>_job`), same end state for
the callers: an in-review MCQ `ai_draft` version of skill `verbal`, difficulty 0.50, key `o1`, persona switched back to
the operator. The job stays `running` (count 10), so a caller may add more drafts to it.

Checked: with this replacement and M1-a…d applied, the existing bodies `rls_m1_serving` (50), `rls_m1_publish_v2`
(47), `rls_m1_bank` (110), `rls_m1_candidate_denied` (14) and `rls_m1_carried` (23) pass unchanged (rolled-back runs,
2026-10-23).

Text to paste (replaces the whole old function, comment included):

```sql
-- ai_draft(key, org, workspace): an AI-drafted MCQ bank version left in_review, written the way the drafting job writes
-- it (R5-35): the operator requests a drafting job, the authoring worker (bound to the org) moves it to running and
-- inserts the item, the version naming the job and its answer key. Records <key>, <key>_item and <key>_job.
create function pg_temp.ai_draft(p_key text, p_org uuid, p_ws uuid) returns uuid language plpgsql as $f$
declare v_job uuid; v_item uuid; v_ver uuid;
begin
  perform pg_temp.op();
  insert into public.ai_draft_jobs (org_id, workspace_id, requested_by, format, skill_key, difficulty, count, topic_sha256,
      provider, model_id, prompt_version)
    values (p_org, p_ws, case when p_org = pg_temp.id('B') then pg_temp.id('b_admin') else pg_temp.id('owner') end, 'mcq',
      'verbal', 0.50, 10, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')
    returning id into v_job;
  perform pg_temp.w('trace_authoring_worker', p_org);
  update public.ai_draft_jobs set status = 'running' where id = v_job;
  insert into public.items (org_id, workspace_id, format, skill_key) values (p_org, p_ws, 'mcq', 'verbal')
    returning id into v_item;
  insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, ai_draft_job_id,
      content_sha256)
    values (p_org, v_item, 'mcq', '[synthetic] AI draft ' || p_key,
      '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, v_job, repeat('c', 64))
    returning id into v_ver;
  insert into public.item_answer_keys (org_id, item_version_id, format, key) values (p_org, v_ver, 'mcq', '{"option_id": "o1"}');
  perform pg_temp.op();
  insert into pg_temp.ids values (p_key, v_ver), (p_key || '_item', v_item), (p_key || '_job', v_job);
  return v_ver;
end
$f$;
```

Notes:
- The answer key is inserted by the authoring worker while its job is `running` and the draft is `in_review`, which is
  exactly the path the lead's M1-a fix round keeps (worker key inserts limited to its own in-review draft with a
  running job, via `private.ai_draft_job_running_in`). The worker never reads keys here, so dropping its SELECT on
  `item_answer_keys` does not affect the helper.
- `p_org` of the library org works too (requested_by falls to the org A owner id, which only fills a nullable column;
  the guard keeps the operator's value).
- No preamble change is needed for M1-d: `invitee` and `pure_owner` already exist in `pg_temp.u()`; their
  `auth.users` rows are inserted by `rls_m1_members` (and must be by any other body that uses them).
