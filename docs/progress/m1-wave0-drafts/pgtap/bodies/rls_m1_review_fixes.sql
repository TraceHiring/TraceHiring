-- rls_m1_review_fixes (M1 FIX of docs/reviews/M1.md: M1-REV-1, M1-REV-2, M1-REV-7; spec specs/m1-test-authoring.md revision 5 R5-72). RED first: each section was written before its migration (M1-t, M1-u). Personas and items are synthetic.

-- ===== M1-REV-1: trace_authoring_worker reads only the item_versions columns of its SQL (workers/jobs/src/drafting/store.ts) =====
select pg_temp.op();
select pg_temp.bank('r1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select is(has_table_privilege('trace_authoring_worker', 'public.item_versions', 'SELECT'), false, 'M1-REV-1: the authoring worker holds no table-wide SELECT on item_versions');
select is((select string_agg(a.attname::text, ',' order by a.attname) from pg_attribute as a where a.attrelid = 'public.item_versions'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('trace_authoring_worker', a.attrelid, a.attnum, 'SELECT')), 'ai_draft_job_id,created_at,id,item_id,org_id,section_id,skill_key,status,stem', 'M1-REV-1: it may select exactly the columns the drafting SQL reads');
select is(has_column_privilege('trace_authoring_worker', 'public.item_versions', 'param_spec', 'SELECT') or has_column_privilege('trace_authoring_worker', 'public.item_versions', 'options', 'SELECT'), false, 'M1-REV-1: param_spec (correctOptionId, the key of every variant) and options are not readable by the worker');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try('select param_spec from public.item_versions'), '^42501 permission denied', 'M1-REV-1: the worker selecting param_spec is refused');
select matches(pg_temp.try('select * from public.item_versions'), '^42501 permission denied', 'M1-REV-1: select * is refused too');
select is(pg_temp.try(format($$select stem from public.item_versions where org_id = %L and section_id is null and status = 'approved' and skill_key = 'verbal' order by created_at desc, id limit 5$$, pg_temp.id('A'))), 'OK 1', 'M1-REV-1 control: the approved-stems read of the drafting job still runs');
select is(pg_temp.try(format($$select count(*)::int as n from public.item_versions where org_id = %L and ai_draft_job_id = %L$$, pg_temp.id('A'), gen_random_uuid())), 'OK 1', 'M1-REV-1 control: the stored-drafts count still runs');
select is(pg_temp.try(format($$select distinct btrim(lower(regexp_replace(v.stem, '[ \t\n\r\f\v]+', ' ', 'g')), ' ') from public.item_versions as v where v.org_id = %L$$, pg_temp.id('A'))), 'OK 1', 'M1-REV-1 control: the existing-stems read still runs');
select pg_temp.op();
