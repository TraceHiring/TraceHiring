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

-- ===== M1-REV-2: a retired library copy is never reused, so a recruiter's retire does not block later copies or from-template =====
select pg_temp.bank('rlib', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'verbal', 0.50, 'approved');
create table pg_temp.copies (k text primary key, v uuid[] not null);
grant select, insert on pg_temp.copies to public;
create table pg_temp.batch (k text primary key, j jsonb not null);
grant select on pg_temp.batch to public;
create table pg_temp.res (k text primary key, j jsonb);
grant select, insert on pg_temp.res to public;
insert into pg_temp.ids select 'tpl', t.id from public.role_templates as t where t.org_id = pg_temp.id('L') and t.status = 'published' order by t.template_key, t.version limit 1;
insert into pg_temp.batch values ('tpl', jsonb_build_object('workspaceId', pg_temp.id('A1'), 'jobTitle', '[synthetic] Retired copy job', 'roleTemplateVersionId', pg_temp.id('tpl'), 'jdSha256', repeat('a', 64), 'templateMatchPermille', 500, 'totalTimeSeconds', 1800, 'qualityCutoff', 40, 'presetKey', 'standard', 'presetVersion', 1,
  'settings', (select p.preset_values from public.integrity_presets as p where p.preset_key = 'standard' and p.version = 1),
  'sections', jsonb_build_array(jsonb_build_object('name', '[synthetic] Verbal', 'format', 'mcq', 'weight', 100, 'drawCount', 1, 'skillKey', 'verbal', 'shuffleItems', true, 'shuffleOptions', true, 'navigation', 'free', 'libraryItemVersionIds', jsonb_build_array(pg_temp.id('rlib'))))));
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$with r as (insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values (%L, %L, array[%L]::uuid[]) returning result_item_version_ids) insert into pg_temp.copies select 'c1', result_item_version_ids from r$$, pg_temp.id('A'), pg_temp.id('A1'), pg_temp.id('rlib'))), 'OK 1', 'M1-REV-2 setup: a recruiter copies an approved library item');
select is(pg_temp.try(format($$update public.item_versions set status = 'retired' where id = %L$$, (select v[1] from pg_temp.copies where k = 'c1'))), 'OK 1', 'M1-REV-2 setup: the recruiter retires the copy (bank retire route)');
select is(pg_temp.try(format($$with r as (insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values (%L, %L, array[%L]::uuid[]) returning result_item_version_ids) insert into pg_temp.copies select 'c2', result_item_version_ids from r$$, pg_temp.id('A'), pg_temp.id('A1'), pg_temp.id('rlib'))), 'OK 1', 'M1-REV-2: copying the same library item again succeeds');
select pg_temp.op();
select is((select (c2.v[1] <> c1.v[1])::text || '|' || (select v.status::text from public.item_versions as v where v.id = c2.v[1]) || '|' || (select v.status::text from public.item_versions as v where v.id = c1.v[1]) from pg_temp.copies as c1, pg_temp.copies as c2 where c1.k = 'c1' and c2.k = 'c2'), 'true|approved|retired', 'M1-REV-2: the new request makes a fresh approved copy; the retired copy stays retired');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$with r as (insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values (%L, %L, array[%L]::uuid[]) returning result_item_version_ids) insert into pg_temp.copies select 'c3', result_item_version_ids from r$$, pg_temp.id('A'), pg_temp.id('A1'), pg_temp.id('rlib'))), 'OK 1', 'M1-REV-2: a third request runs');
select pg_temp.op();
select is((select c3.v = c2.v from pg_temp.copies as c2, pg_temp.copies as c3 where c2.k = 'c2' and c3.k = 'c3'), true, 'M1-REV-2: a live copy is still reused (one copy per org, workspace and library version, R3-8)');
select is((select string_agg(x.c, ',' order by x.c) from (select (l.details ->> 'count') || '/' || (l.details ->> 'reused') as c from public.audit_log as l where l.org_id = pg_temp.id('A') and l.action = 'library.copy' and l.object_id in (select r.id from public.library_copy_requests as r where pg_temp.id('rlib') = any (r.library_item_version_ids))) as x), '0/1,1/0,1/0', 'M1-REV-2: the audit (count/reused) counts the fresh copy as new, as the daily cap does: two new, one reused');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.item_versions set status = 'retired' where id = %L$$, (select v[1] from pg_temp.copies where k = 'c2'))), 'OK 1', 'M1-REV-2 setup: the recruiter retires the second copy too');
select is(pg_temp.try($$insert into pg_temp.res select 'ct', public.create_test_from_template(pg_temp.id('A'), (select j from pg_temp.batch where k = 'tpl'))$$), 'OK 1', 'M1-REV-2: from-template naming a library item whose copies are all retired succeeds');
select pg_temp.op();
select is((select string_agg(i.origin::text || '/' || i.status::text || '/' || (i.source_item_version_id = pg_temp.id('rlib'))::text || '/' || (i.id <> all (array(select c.v[1] from pg_temp.copies as c)))::text, ',') from public.sections as s join public.pool_items as pi on pi.pool_id = s.pool_id join public.item_versions as i on i.id = pi.item_version_id where s.test_version_id = (select (j ->> 'versionId')::uuid from pg_temp.res where k = 'ct')), 'library/approved/true/true', 'M1-REV-2: its pool holds one fresh approved copy of that library item');
select is((select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'item_versions' and indexname = 'item_versions_library_copy' and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%status <> ''retired''%'), 1, 'M1-REV-2: one live copy per org, workspace and library version (a partial unique index that leaves retired copies out)');

-- ===== M1-REV-7: AT-M1-02, the skill_key and approved_by arms of CHECK item_versions_bank_approved (operator path) =====
-- Org-role approvals force approved_by := auth.uid() and the guard fills skill_key from its item, so only the operator
-- path reaches these arms; the skill_key arm is reached with the user triggers off, to test the CHECK on its own.
select pg_temp.op();
select pg_temp.bank('r7a', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'in_review');
select pg_temp.bank('r7b', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'in_review');
select matches(pg_temp.try(format($$update public.item_versions set status = 'approved', approved_by = null, approved_at = now() where id = %L$$, pg_temp.id('r7a'))), '^23514 .*"item_versions_bank_approved"', 'AT-M1-02: an approved bank item needs its approver (CHECK, operator path)');
select matches(pg_temp.try(format($$update public.item_versions set skill_key = null where id = %L$$, pg_temp.id('r7b'))), '^42501 TRACE_GUARD', 'AT-M1-02 control: the guard refuses a skill change outside draft');
alter table public.item_versions disable trigger user;
select matches(pg_temp.try(format($$update public.item_versions set status = 'approved', approved_by = %L, approved_at = now(), skill_key = null where id = %L$$, pg_temp.id('owner'), pg_temp.id('r7b'))), '^23514 .*"item_versions_bank_approved"', 'AT-M1-02: an approved bank item needs its skill (CHECK alone, guard off)');
-- Re-enable each trigger as it was (FIX re-review note: `enable trigger user` would leave the ALWAYS ones at origin).
alter table public.item_versions enable trigger item_versions_audit;
alter table public.item_versions enable always trigger item_versions_guard;
alter table public.item_versions enable always trigger item_versions_variants_numbered;
select is((select string_agg(t.tgname::text || ':' || t.tgenabled::text, ',' order by t.tgname) from pg_trigger as t where t.tgrelid = 'public.item_versions'::regclass and not t.tgisinternal), 'item_versions_audit:O,item_versions_guard:A,item_versions_variants_numbered:A', 'AT-M1-02: the triggers are back as they were (guard and variant numbering ENABLE ALWAYS)');
select is((select string_agg(v.status::text || '/' || coalesce(v.skill_key, 'null') || '/' || (v.approved_by is null)::text, ',' order by v.stem) from public.item_versions as v where v.id in (pg_temp.id('r7a'), pg_temp.id('r7b'))), 'in_review/verbal/true,in_review/verbal/true', 'AT-M1-02: both refused approvals left the versions in review');

-- ===== M1-REV-8: the E26 lookup states that it is not bound to the invite's address (comment; no behaviour change) =====
select is((select obj_description('private.auth_user_id_for_invite(uuid, text)'::regprocedure, 'pg_proc') like '%which the worker sets itself%Not bound to the invite''s address%M1-REV-8%Skips SSO, anonymous and deleted users%'), true, 'M1-REV-8: the function comment records that p_email is not bound to email_hmac, and the accepted residual risk');
select is((select has_function_privilege('trace_admin_worker', 'private.auth_user_id_for_invite(uuid, text)', 'EXECUTE')::text || '|' || has_function_privilege('authenticated', 'private.auth_user_id_for_invite(uuid, text)', 'EXECUTE')::text || '|' || has_function_privilege('trace_authoring_worker', 'private.auth_user_id_for_invite(uuid, text)', 'EXECUTE')::text), 'true|false|false', 'M1-REV-8: only trace_admin_worker may execute the lookup');
