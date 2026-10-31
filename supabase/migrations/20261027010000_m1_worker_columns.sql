-- M1-t (M1 FIX, docs/reviews/M1.md M1-REV-1; spec specs/m1-test-authoring.md revision 5 R5-72 a): the drafting worker
-- reads only the item_versions columns of its SQL (workers/jobs/src/drafting/store.ts: the stored-drafts count, the
-- existing-stems dedupe, the approved-stems prompt context and `returning id` of its insert). The table-wide SELECT of
-- M1-c (20261023010000_m1_bank.sql) let it read param_spec, whose correctOptionId is the key of every variant of a
-- parameterised item, and options. Its policy (org_id = private.job_org_id()) is unchanged. Pinned by
-- rls_m1_review_fixes.
revoke select on public.item_versions from trace_authoring_worker;
grant select (id, org_id, item_id, section_id, status, skill_key, stem, created_at, ai_draft_job_id)
  on public.item_versions to trace_authoring_worker;
