-- rls_m1_rpcs (spec specs/m1-test-authoring.md revision 5 R5-71 d, e; migration M1-q: R5-63 f atomic create_test_from_template; R5-63 f / R5-64 b and A2a re-review Low 4 atomic save_bank_draft)
-- Fixtures (operator path): approved and draft library items (lib1, lib_draft), the first published library template,
-- an approved org A bank item (bk1); request payloads as jsonb (pg_temp.batch) and function results (pg_temp.res).
create table pg_temp.batch (k text primary key, j jsonb not null);
grant select on pg_temp.batch to public;

-- ===== R5-71 d: public.create_test_from_template (job, test, draft, pools, library copies, settings: one transaction) =====
select pg_temp.op();
create table pg_temp.res (k text primary key, j jsonb);
grant select, insert on pg_temp.res to public;
select pg_temp.bank('lib1', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('lib_draft', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'verbal', 0.50, 'draft');
insert into pg_temp.ids select 'tpl', t.id from public.role_templates as t where t.org_id = pg_temp.id('L') and t.status = 'published' order by t.template_key, t.version limit 1;
insert into pg_temp.batch values ('tpl', jsonb_build_object('workspaceId', pg_temp.id('A1'), 'jobTitle', '[synthetic] Template job', 'roleTemplateVersionId', pg_temp.id('tpl'), 'jdSha256', repeat('a', 64), 'templateMatchPermille', 500, 'totalTimeSeconds', 1800, 'qualityCutoff', 40, 'presetKey', 'standard', 'presetVersion', 1,
  'settings', (select p.preset_values from public.integrity_presets as p where p.preset_key = 'standard' and p.version = 1),
  'sections', jsonb_build_array(jsonb_build_object('name', '[synthetic] Verbal', 'format', 'mcq', 'weight', 100, 'drawCount', 1, 'skillKey', 'verbal', 'shuffleItems', true, 'shuffleOptions', true, 'navigation', 'free', 'libraryItemVersionIds', jsonb_build_array(pg_temp.id('lib1'))))));
insert into pg_temp.batch select 'tpl_bad', jsonb_set(j, '{sections,0,libraryItemVersionIds}', jsonb_build_array(pg_temp.id('lib1'), pg_temp.id('lib_draft'))) || '{"jobTitle": "[synthetic] Bad template job"}'::jsonb from pg_temp.batch where k = 'tpl';
insert into pg_temp.batch select 'tpl_many', jsonb_set(j, '{sections}', (select jsonb_agg(x.s) from (select j -> 'sections' -> 0 as s from generate_series(1, 11)) as x)) from pg_temp.batch where k = 'tpl';
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into pg_temp.res select 'ct', public.create_test_from_template(pg_temp.id('A'), (select j from pg_temp.batch where k = 'tpl'))$$), 'OK 1', 'from-template: a recruiter creates the job, test and draft in one call');
select pg_temp.op();
insert into pg_temp.ids select 'ct_test', (j ->> 'testId')::uuid from pg_temp.res where k = 'ct';
insert into pg_temp.ids select 'ct_ver', (j ->> 'versionId')::uuid from pg_temp.res where k = 'ct';
select is((select t.name || '|' || j.title || '|' || (j.jd_sha256 = repeat('a', 64))::text || '|' || j.template_match_permille || '|' || (j.role_template_version_id = pg_temp.id('tpl'))::text || '|' || (j.id = (select (r.j ->> 'jobId')::uuid from pg_temp.res as r where r.k = 'ct'))::text from public.tests as t join public.jobs as j on j.id = t.job_id where t.id = pg_temp.id('ct_test')), '[synthetic] Template job|[synthetic] Template job|true|500|true|true', 'from-template: the job keeps the JD hash and match only; the test names it');
select is((select v.test_id = pg_temp.id('ct_test') and v.status = 'draft' and v.total_time_seconds = 1800 and v.quality_cutoff = 40 from public.test_versions as v where v.id = pg_temp.id('ct_ver')), true, 'from-template: the draft version has the template time and the default cutoff');
select is((select s.name || ':' || s.draw_count || ':' || s.shuffle_items || ':' || s.navigation || ':' || p.name || ':' || p.skill_key || ':' || (select count(*) from public.pool_items as pi where pi.pool_id = s.pool_id) || ':' || (select string_agg(i.origin::text || '/' || i.status::text, ',') from public.pool_items as pi join public.item_versions as i on i.id = pi.item_version_id where pi.pool_id = s.pool_id) from public.sections as s join public.pools as p on p.id = s.pool_id where s.test_version_id = pg_temp.id('ct_ver')), '[synthetic] Verbal:1:true:free:[synthetic] Verbal:verbal:1:library/approved', 'from-template: a pool section draws from a new pool holding the library copy');
select is((select r.preset_key || '|' || r.preset_version || '|' || (r.settings ->> 'paste_written') from public.ruleset_versions as r join public.test_versions as v on v.ruleset_version_id = r.id where v.id = pg_temp.id('ct_ver')), 'standard|1|allowed_logged', 'from-template: the preset is stored with the catalog version whose values were checked');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$select public.create_test_from_template(pg_temp.id('A'), (select j from pg_temp.batch where k = 'tpl_bad'))$$), 'TRACE_GUARD: only approved library items can be copied$', 'from-template: a library item that is not approved fails the whole call');
select pg_temp.op();
select is((select count(*)::int from public.jobs where title = '[synthetic] Bad template job') || '|' || (select count(*)::int from public.tests where name = '[synthetic] Bad template job') || '|' || (select count(*)::int from public.pools where name = '[synthetic] Verbal' and org_id = pg_temp.id('A')), '0|0|1', 'from-template: after a failed call no job, test or pool is left (atomic, R5-63 f)');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$select public.create_test_from_template(pg_temp.id('A'), (select j from pg_temp.batch where k = 'tpl_many'))$$), '^22023 TRACE_BAD_INPUT', 'from-template: more than 10 sections is bad input');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$select public.create_test_from_template(pg_temp.id('A'), (select j from pg_temp.batch where k = 'tpl'))$$), '^42501', 'from-template: a workspace A2 recruiter cannot create in workspace A1');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$select public.create_test_from_template(pg_temp.id('A'), (select j from pg_temp.batch where k = 'tpl'))$$), '^42501', 'from-template: a reviewer cannot create a test');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$select public.create_test_from_template(pg_temp.id('A'), (select j from pg_temp.batch where k = 'tpl'))$$), '^42501', 'from-template: org B admin cannot create in org A');
select pg_temp.op();
select is((select count(*)::int from public.jobs where title = '[synthetic] Template job'), 1, 'from-template: the refused calls wrote nothing');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try($$select public.create_test_from_template(pg_temp.id('A'), (select j from pg_temp.batch where k = 'tpl'))$$), '^42501 permission denied', 'from-template: trace_api cannot execute it');
select pg_temp.op();
select is((select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') || '|' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text from pg_proc as p where p.oid = 'public.create_test_from_template(uuid, jsonb)'::regprocedure), 'false|search_path=""|false|true', 'from-template: SECURITY INVOKER, empty search_path, EXECUTE for authenticated only');

-- ===== R5-71 e: public.save_bank_draft (create, edit, clone with the key in one transaction; R5-64 b, Low 4) =====
select pg_temp.bank('bk1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
insert into pg_temp.batch values ('bd_create', jsonb_build_object('mode', 'create', 'workspaceId', pg_temp.id('A1'), 'keyOptionId', 'o2', 'content', jsonb_build_object('format', 'mcq', 'stem', '[synthetic] Bank MCQ', 'options', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]'::jsonb, 'rubric_version_id', null, 'skill_key', 'verbal', 'difficulty', 0.5, 'is_parameterised', false, 'param_spec', null, 'media', null, 'content_sha256', repeat('6', 64))));
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into pg_temp.res select 'bd1', to_jsonb(public.save_bank_draft(pg_temp.id('A'), (select j from pg_temp.batch where k = 'bd_create')))$$), 'OK 1', 'bank draft: a recruiter creates an item, its draft version and its key in one call');
select pg_temp.op();
insert into pg_temp.ids select 'bd1', (j #>> '{}')::uuid from pg_temp.res where k = 'bd1';
insert into pg_temp.ids select 'bd1_item', item_id from public.item_versions where id = pg_temp.id('bd1');
select is((select v.status || ':' || v.origin || ':' || v.version_no || ':' || v.stem || ':' || (k.key ->> 'option_id') from public.item_versions as v join public.item_answer_keys as k on k.item_version_id = v.id where v.id = pg_temp.id('bd1')), 'draft:human:1:[synthetic] Bank MCQ:o2', 'bank draft: the guard sets status, origin and number; the key is stored with it');
insert into pg_temp.batch values
  ('bd_update', jsonb_build_object('mode', 'update', 'itemId', pg_temp.id('bd1_item'), 'versionId', pg_temp.id('bd1'), 'keyOptionId', 'o3', 'content', jsonb_build_object('format', 'mcq', 'stem', '[synthetic] Bank MCQ edited', 'options', '[{"id": "o1", "text": "One"}, {"id": "o3", "text": "Three"}]'::jsonb, 'rubric_version_id', null, 'skill_key', 'verbal', 'difficulty', 0.6, 'is_parameterised', false, 'param_spec', null, 'media', null, 'content_sha256', repeat('7', 64)))),
  ('bd_clone', jsonb_build_object('mode', 'clone', 'itemId', pg_temp.id('bk1_item'), 'keyOptionId', 'o1', 'content', jsonb_build_object('format', 'mcq', 'stem', '[synthetic] Bank item bk1', 'options', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]'::jsonb, 'rubric_version_id', null, 'skill_key', 'verbal', 'difficulty', 0.5, 'is_parameterised', false, 'param_spec', null, 'media', null, 'content_sha256', repeat('c', 64)))),
  ('bd_update_approved', jsonb_build_object('mode', 'update', 'itemId', pg_temp.id('bk1_item'), 'versionId', pg_temp.id('bk1'), 'keyOptionId', 'o2', 'content', jsonb_build_object('format', 'mcq', 'stem', '[synthetic] Not stored', 'options', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]'::jsonb, 'rubric_version_id', null, 'skill_key', 'verbal', 'difficulty', 0.5, 'is_parameterised', false, 'param_spec', null, 'media', null, 'content_sha256', repeat('8', 64))));
insert into pg_temp.batch select 'bd_update_badkey', jsonb_set(j, '{content,stem}', '"[synthetic] Not stored"') || '{"keyOptionId": "zz"}'::jsonb from pg_temp.batch where k = 'bd_update';
insert into pg_temp.batch select 'bd_badmode', j || '{"mode": "delete"}'::jsonb from pg_temp.batch where k = 'bd_update';
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into pg_temp.res select 'bd2', to_jsonb(public.save_bank_draft(pg_temp.id('A'), (select j from pg_temp.batch where k = 'bd_update')))$$), 'OK 1', 'bank draft: an edit of the draft');
select is((select (j #>> '{}')::uuid = pg_temp.id('bd1') from pg_temp.res where k = 'bd2'), true, 'bank draft: an edit answers the same version');
select is((select v.stem || ':' || v.difficulty || ':' || (v.options -> 1 ->> 'id') || ':' || (k.key ->> 'option_id') from public.item_versions as v join public.item_answer_keys as k on k.item_version_id = v.id where v.id = pg_temp.id('bd1')), '[synthetic] Bank MCQ edited:0.6:o3:o3', 'bank draft: content and key change together');
select matches(pg_temp.try($$select public.save_bank_draft(pg_temp.id('A'), (select j from pg_temp.batch where k = 'bd_update_badkey'))$$), '^23514', 'bank draft: a key on no current option fails the whole edit');
select is((select v.stem || ':' || (k.key ->> 'option_id') from public.item_versions as v join public.item_answer_keys as k on k.item_version_id = v.id where v.id = pg_temp.id('bd1')), '[synthetic] Bank MCQ edited:o3', 'bank draft: after a failed edit the content and key are as before (atomic, Low 4)');
select is(pg_temp.try($$insert into pg_temp.res select 'bd_na', to_jsonb(public.save_bank_draft(pg_temp.id('A'), (select j from pg_temp.batch where k = 'bd_update_approved')))$$), 'OK 1', 'bank draft: an edit naming an approved version runs');
select is((select j is null or j = 'null'::jsonb from pg_temp.res where k = 'bd_na'), true, 'bank draft: it answers null (only a draft is edited, I-M1-3)');
select is((select v.stem from public.item_versions as v where v.id = pg_temp.id('bk1')), '[synthetic] Bank item bk1', 'bank draft: the approved version is unchanged');
select is(pg_temp.try($$insert into pg_temp.res select 'bd3', to_jsonb(public.save_bank_draft(pg_temp.id('A'), (select j from pg_temp.batch where k = 'bd_clone')))$$), 'OK 1', 'bank draft: a new version of an approved item');
select is((select v.item_id = pg_temp.id('bk1_item') and v.status = 'draft' and v.version_no = 2 and v.origin = 'human' and k.key ->> 'option_id' = 'o1' from public.item_versions as v join public.item_answer_keys as k on k.item_version_id = v.id where v.id = (select (j #>> '{}')::uuid from pg_temp.res where k = 'bd3')), true, 'bank draft: the clone is draft version 2 with its key');
select matches(pg_temp.try($$select public.save_bank_draft(pg_temp.id('A'), (select j from pg_temp.batch where k = 'bd_clone'))$$), '^23505', 'bank draft: a second open version of one item is refused (R5-64 a)');
select matches(pg_temp.try($$select public.save_bank_draft(pg_temp.id('A'), (select j from pg_temp.batch where k = 'bd_badmode'))$$), '^22023 TRACE_BAD_INPUT', 'bank draft: an unknown mode is bad input');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$select public.save_bank_draft(pg_temp.id('A'), (select j from pg_temp.batch where k = 'bd_create'))$$), '^42501', 'bank draft: a reviewer cannot create an item');
select pg_temp.u('b_admin');
select is(pg_temp.try($$insert into pg_temp.res select 'bd_b', to_jsonb(public.save_bank_draft(pg_temp.id('A'), (select j from pg_temp.batch where k = 'bd_update')))$$), 'OK 1', 'bank draft: org B admin''s edit of an org A draft runs');
select is((select j is null or j = 'null'::jsonb from pg_temp.res where k = 'bd_b'), true, 'bank draft: and finds nothing (RLS), answering null');
select pg_temp.op();
select is((select v.stem from public.item_versions as v where v.id = pg_temp.id('bd1')), '[synthetic] Bank MCQ edited', 'bank draft: org A''s draft is unchanged');
select is((select count(*)::int from public.items where org_id = pg_temp.id('A') and created_by = pg_temp.id('reviewer')), 0, 'bank draft: the refused create left no item');
select is((select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') || '|' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || '|' || has_function_privilege('trace_api', p.oid, 'EXECUTE')::text from pg_proc as p where p.oid = 'public.save_bank_draft(uuid, jsonb)'::regprocedure), 'false|search_path=""|false|true|false', 'bank draft: SECURITY INVOKER, empty search_path, EXECUTE for authenticated only');
