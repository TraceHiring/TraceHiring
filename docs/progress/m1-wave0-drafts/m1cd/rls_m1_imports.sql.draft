-- rls_m1_imports (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_imports; §3.2 import_jobs, import_row_errors; §3.4 import_item_batch; §3.5; §4.3; §6.9; AT-M1-11 (DB half), AT-M1-25; Q23, R2-23, R3-4, R3-5, R5-26, R5-37, R5-40; E13, E14). RED first: written from the spec before migration M1-c. Personas, rows and images are synthetic.
-- Fixtures (operator path): an approved bank item in workspace A1 (content hash c…c, for duplicate_in_bank); batches as
-- jsonb (pg_temp.batch) and function results (pg_temp.res), readable by every persona.
select pg_temp.bank('dup', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
create table pg_temp.batch (k text primary key, j jsonb not null);
grant select on pg_temp.batch to public;
create table pg_temp.res (k text primary key, j jsonb);
grant select, insert on pg_temp.res to public;
insert into pg_temp.batch values ('b1', jsonb_build_array(
  jsonb_build_object('rowNo', 2, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.4, 'stem', '[synthetic] Import row two', 'options', jsonb_build_array('Alpha', 'Beta', 'Gamma'), 'correct', 'b', 'contentSha256', repeat('1', 64)),
  jsonb_build_object('rowNo', 3, 'format', 'written', 'skillKey', 'written_communication', 'difficulty', 0.5, 'stem', '[synthetic] Import row three', 'rubricKey', 'default', 'contentSha256', repeat('2', 64)),
  jsonb_build_object('rowNo', 4, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 1.5, 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'contentSha256', repeat('4', 64)),
  jsonb_build_object('rowNo', 5, 'format', 'mcq', 'skillKey', 'astrology', 'difficulty', 0.5, 'stem', '[synthetic] Import row five', 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'contentSha256', repeat('5', 64)),
  jsonb_build_object('rowNo', 6, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.5, 'stem', '[synthetic] Import row six', 'options', jsonb_build_array('Alpha', 'Beta', 'Gamma'), 'correct', 'e', 'contentSha256', repeat('6', 64)),
  jsonb_build_object('rowNo', 7, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.4, 'stem', '[synthetic] Import row seven', 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'contentSha256', repeat('1', 64)),
  jsonb_build_object('rowNo', 8, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.5, 'stem', '[synthetic] Import row eight', 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'contentSha256', repeat('c', 64)),
  jsonb_build_object('rowNo', 9, 'contentSha256', repeat('9', 64), 'errors', jsonb_build_array(jsonb_build_object('field', 'image_file', 'code', 'image_missing'))),
  jsonb_build_object('rowNo', 10, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.5, 'stem', '[synthetic] Import row ten', 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'imageKey', 'item-media/' || pg_temp.id('B') || '/' || repeat('f', 64) || '.png', 'imageAlt', 'A synthetic chart', 'contentSha256', repeat('a', 64)),
  jsonb_build_object('rowNo', 11, 'format', 'mcq', 'skillKey', 'quant', 'difficulty', 0.5, 'stem', '[synthetic] What is {{a}} plus one?', 'options', jsonb_build_array('{{a+1}}', '{{a+2}}'),
    'paramSpec', '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "[synthetic] What is {{a}} plus one?", "options": [{"id": "o1", "text": "{{a+1}}"}, {"id": "o2", "text": "{{a+2}}"}], "correctOptionId": "o1", "count": 5}'::jsonb,
    'variants', '[{"variantNo": 1, "params": {"a": 2}, "stem": "[synthetic] What is 2 plus one?", "options": [{"id": "o1", "text": "3"}, {"id": "o2", "text": "4"}], "difficulty": 0.5, "contentSha256": "3333333333333333333333333333333333333333333333333333333333333333", "correctOptionId": "o1"}, {"variantNo": 2, "params": {"a": 5}, "stem": "[synthetic] What is 5 plus one?", "options": [{"id": "o1", "text": "6"}, {"id": "o2", "text": "7"}], "difficulty": 0.55, "contentSha256": "3333333333333333333333333333333333333333333333333333333333333334", "correctOptionId": "o1"}]'::jsonb,
    'contentSha256', repeat('b', 64)),
  jsonb_build_object('rowNo', 12, 'format', 'mcq', 'skillKey', 'quant', 'difficulty', 0.5, 'stem', '[synthetic] What is {{a}} plus two?', 'options', jsonb_build_array('{{a+2}}', '{{a+3}}'),
    'paramSpec', '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "[synthetic] What is {{a}} plus two?", "options": [{"id": "o1", "text": "{{a+2}}"}, {"id": "o2", "text": "{{a+3}}"}], "correctOptionId": "o1", "count": 5}'::jsonb,
    'variants', '[{"variantNo": 1, "params": {"a": 2}, "stem": "[synthetic] What is 2 plus two?", "options": [{"id": "o1", "text": "4"}, {"id": "o2", "text": "5"}], "difficulty": 0.75, "contentSha256": "3333333333333333333333333333333333333333333333333333333333333335", "correctOptionId": "o1"}]'::jsonb,
    'contentSha256', repeat('d', 64)),
  jsonb_build_object('rowNo', 13, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.5, 'stem', repeat('x', 4001), 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'contentSha256', repeat('e', 64)),
  jsonb_build_object('rowNo', 14, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.6, 'stem', '[synthetic] Import row fourteen', 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'imageKey', 'item-media/' || pg_temp.id('A') || '/' || repeat('f', 64) || '.webp', 'imageAlt', 'A synthetic diagram', 'contentSha256', repeat('7', 64))
));
insert into pg_temp.batch values
  ('lib', jsonb_build_array(jsonb_build_object('rowNo', 2, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.5, 'stem', '[synthetic] Library import row', 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'contentSha256', repeat('8', 64)))),
  ('a2', jsonb_build_array(jsonb_build_object('rowNo', 2, 'format', 'mcq', 'skillKey', 'verbal', 'difficulty', 0.5, 'stem', '[synthetic] Workspace A2 import row', 'options', jsonb_build_array('Alpha', 'Beta'), 'correct', 'a', 'contentSha256', repeat('8', 64)))),
  ('big', (select jsonb_agg(jsonb_build_object('rowNo', n, 'contentSha256', repeat('0', 64), 'errors', jsonb_build_array(jsonb_build_object('field', 'row', 'code', 'row_limit')))) from generate_series(2, 102) as n)),
  ('twice', jsonb_build_array(jsonb_build_object('rowNo', 30, 'contentSha256', repeat('0', 64), 'errors', '[{"field": "row", "code": "row_limit"}]'::jsonb), jsonb_build_object('rowNo', 30, 'contentSha256', repeat('0', 64), 'errors', '[{"field": "row", "code": "row_limit"}]'::jsonb))),
  ('header', jsonb_build_array(jsonb_build_object('rowNo', 1, 'contentSha256', repeat('0', 64), 'errors', '[{"field": "row", "code": "row_limit"}]'::jsonb))),
  ('cell', jsonb_build_array(jsonb_build_object('rowNo', 40, 'contentSha256', repeat('0', 64), 'errors', '[{"field": "Priya Sharma", "code": "missing_field"}]'::jsonb)));

-- ===== import_jobs: I (OW AD RC in their workspaces) =====
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.import_jobs (id, org_id, workspace_id, source_kind, template_version) values ('a7000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), 'OK 1', 'import_jobs I: owner starts an xlsx import in workspace A1');
select is(pg_temp.try($$insert into public.import_jobs (id, org_id, workspace_id, source_kind, template_version) values ('a7000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'docx', 'trace-items-v1')$$), 'OK 1', 'import_jobs I: owner starts a docx import');
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'csv', 'trace-items-v1')$$), '^23514', 'import_jobs I: only the xlsx and docx templates (§6.9)');
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version, status) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1', 'completed')$$), '^42501 permission denied', 'import_jobs I: status is outside the insert grant (a job starts open)');
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version, rows_ok) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1', 500)$$), '^42501 permission denied', 'import_jobs I: counts are outside the insert grant');
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into public.import_jobs (id, org_id, workspace_id, source_kind, template_version) values ('a7000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), 'OK 1', 'import_jobs I: recruiter starts an import');
select pg_temp.u('ws_recruiter');
select is(pg_temp.try($$insert into public.import_jobs (id, org_id, workspace_id, source_kind, template_version) values ('a7000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'xlsx', 'trace-items-v1')$$), 'OK 1', 'import_jobs I: workspace recruiter starts an import in workspace A2');
select is(pg_temp.try($$insert into public.import_jobs (id, org_id, workspace_id, source_kind, template_version) values ('a7000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'xlsx', 'trace-items-v1')$$), 'OK 1', 'import_jobs I: workspace recruiter starts a second A2 import');
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), '^42501', 'import_jobs I: workspace recruiter cannot import into workspace A1');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), '^42501', 'import_jobs I: reviewer cannot import');
select pg_temp.u('hm');
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), '^42501', 'import_jobs I: hiring manager cannot import');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), '^42501', 'import_jobs I: org B admin cannot import into org A');
select pg_temp.u('lib_author');
select is(pg_temp.try(format($$insert into public.import_jobs (id, org_id, workspace_id, source_kind, template_version) values ('a7000000-0000-4000-8000-00000000000a', %L, %L, 'xlsx', 'trace-items-v1')$$, pg_temp.id('L'), pg_temp.id('LW'))), 'OK 1', 'import_jobs I: library staff import into the library org');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), '^42501 permission denied', 'import_jobs I: the authoring worker holds nothing on imports (R2-23)');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select matches(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'xlsx', 'trace-items-v1')$$), '^42501 permission denied', 'import_jobs I: the admin worker holds nothing on imports (R2-23)');
select pg_temp.op();
select is((select status || '|' || rows_total || '|' || rows_ok || '|' || rows_error || '|' || images_ok || '|' || (created_by = pg_temp.id('owner'))::text || '|' || coalesce(completed_at::text, 'null') from public.import_jobs where id = 'a7000000-0000-4000-8000-000000000001'), 'open|0|0|0|0|true|null', 'import_jobs I: a new job is open, empty and created by the caller');

-- ===== import_jobs: S =====
select pg_temp.u('owner');
select is((select count(*)::int from public.import_jobs), 5, 'import_jobs S: owner sees the five org A imports');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.import_jobs), 2, 'import_jobs S: workspace recruiter sees only the workspace A2 imports');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.import_jobs), 0, 'import_jobs S: reviewer sees no import (matrix OW AD RC)');
select pg_temp.u('hm');
select is((select count(*)::int from public.import_jobs), 0, 'import_jobs S: hiring manager sees no import');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.import_jobs), 0, 'import_jobs S: org B admin sees no org A or library import');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.import_jobs'), '^42501 permission denied', 'import_jobs S: trace_api has no grant');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.import_row_errors'), '^42501 permission denied', 'import_row_errors S: the quality worker has no grant');
select pg_temp.op();
set local role trace_candidate;
select matches(pg_temp.try('select * from public.import_jobs'), '^42501 permission denied', 'import_jobs S: trace_candidate has no privilege');
select pg_temp.op();

-- ===== import_item_batch: who may call it =====
select pg_temp.op();
set local role anon;
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', '[]')$$), '^42501 permission denied', 'batch: anon cannot execute import_item_batch');
select pg_temp.op();
set local role trace_candidate;
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', '[]')$$), '^42501 permission denied', 'batch: trace_candidate cannot execute import_item_batch');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), '^42501 permission denied', 'batch: trace_api cannot execute import_item_batch (the api calls it with the user JWT)');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), '^42501 permission denied', 'batch: the authoring worker cannot execute import_item_batch');
select is(has_function_privilege('service_role', 'public.import_item_batch(uuid, jsonb)', 'EXECUTE'), false, 'batch: service_role holds no EXECUTE on import_item_batch');
select is((select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') from pg_proc as p where p.oid = 'public.import_item_batch(uuid, jsonb)'::regprocedure), 'false|search_path=""', 'batch: import_item_batch is SECURITY INVOKER with an empty search_path (M1-18, R2-5)');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), '^23503 TRACE_GUARD: import job not found', 'batch: a workspace A2 recruiter cannot write into a workspace A1 import');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), '^23503 TRACE_GUARD: import job not found', 'batch: org B admin cannot write into an org A import');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), '^23503 TRACE_GUARD: import job not found', 'batch: reviewer cannot import');

-- ===== import_item_batch: input caps =====
select pg_temp.u('recruiter');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000004', (select j from pg_temp.batch where k = 'big'))$$), '^22023 TRACE_BAD_INPUT', 'batch: more than 100 rows is refused');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000004', (select j from pg_temp.batch where k = 'twice'))$$), '^22023 TRACE_BAD_INPUT', 'batch: a row number twice in one batch is refused');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000004', (select j from pg_temp.batch where k = 'header'))$$), '^22023 TRACE_BAD_INPUT', 'batch: row 1 is the header, never an item');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000004', (select j from pg_temp.batch where k = 'cell'))$$), '^23514', 'AT-M1-11: an error field outside the template columns is refused (no cell value can be stored as a field)');

-- ===== import_item_batch: the batch (Q23 approved by the importer; E14 per-row; AT-M1-11 codes) =====
select is(pg_temp.try($$insert into pg_temp.res select 'r1', public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), 'OK 1', 'batch: recruiter sends 13 rows to the A1 import');
select is((select (j ->> 'accepted')::int from pg_temp.res where k = 'r1'), 4, 'batch: rows 2, 3, 11 and 14 are accepted');
select is((select string_agg((e ->> 'rowNo') || ':' || (e ->> 'field') || ':' || (e ->> 'code'), ',' order by (e ->> 'rowNo')::int, e ->> 'field') from pg_temp.res, jsonb_array_elements(j -> 'errors') as e where k = 'r1'),
  '4:difficulty:bad_difficulty,4:stem:missing_field,5:skill:bad_skill,6:correct:bad_key,7:row:duplicate_in_file,8:row:duplicate_in_bank,9:image_file:image_missing,10:image_file:bad_image_ref,12:param_spec_json:variant_generation_failed,13:stem:too_long',
  'AT-M1-11: every bad row comes back with its field and code (api-found, value, taxonomy, key, duplicate, image, variant and length errors)');
select is((select bool_and(pg_temp.keys(e) = 'code,field,rowNo') from pg_temp.res, jsonb_array_elements(j -> 'errors') as e where k = 'r1'), true, 'AT-M1-11: an error carries a row number, a field and a code, never a cell value');
select pg_temp.op();
select is((select status from public.import_jobs where id = 'a7000000-0000-4000-8000-000000000001'), 'validating', 'batch: the first batch moves the job from open to validating (§4.3)');
select is((select string_agg(import_row_no || ':' || origin || ':' || status::text || ':' || (approved_by = pg_temp.id('recruiter'))::text || ':' || (created_by = pg_temp.id('recruiter'))::text || ':' || (workspace_id = pg_temp.id('A1'))::text, ',' order by import_row_no) from public.item_versions where import_job_id = 'a7000000-0000-4000-8000-000000000001'),
  '2:import:approved:true:true:true,3:import:approved:true:true:true,11:import:approved:true:true:true,14:import:approved:true:true:true',
  'Q23: each accepted row is an imported version approved by the importer in the same call, in the job workspace');
select is((select count(*)::int from public.items where org_id = pg_temp.id('A') and created_by = pg_temp.id('recruiter')), 4, 'E14: a row that fails inside the insert (bad skill, bad variant) leaves no items row behind');
select is((select v.options::text || '|' || (k.key ->> 'option_id') from public.item_versions as v join public.item_answer_keys as k on k.item_version_id = v.id where v.import_job_id = 'a7000000-0000-4000-8000-000000000001' and v.import_row_no = 2), '[{"id": "a", "text": "Alpha"}, {"id": "b", "text": "Beta"}, {"id": "c", "text": "Gamma"}]|b', 'batch: MCQ options get ids a..f and the key names the correct one');
select is((select (rubric_version_id = (select r.id from public.rubric_versions as r where r.org_id = pg_temp.id('A') and r.rubric_key = 'default' order by r.version_no desc limit 1))::text from public.item_versions where import_job_id = 'a7000000-0000-4000-8000-000000000001' and import_row_no = 3), 'true', 'batch: a written row takes the latest version of its org rubric');
select is((select v.is_parameterised::text || '|' || count(var.id) || '|' || count(k.item_variant_id) from public.item_versions as v join public.item_variants as var on var.item_version_id = v.id left join public.item_variant_keys as k on k.item_variant_id = var.id where v.import_job_id = 'a7000000-0000-4000-8000-000000000001' and v.import_row_no = 11 group by v.is_parameterised), 'true|2|2', 'batch: a parameterised row stores its variants and their keys (R3-4)');
select is((select media::text from public.item_versions where import_job_id = 'a7000000-0000-4000-8000-000000000001' and import_row_no = 14), '[{"alt": "A synthetic diagram", "key": "item-media/a1000000-0000-4000-8000-000000000001/' || repeat('f', 64) || '.webp"}]', 'batch: an image under the org prefix is stored as a media ref');
select is((select count(*)::int from public.audit_log as a join public.item_versions as v on v.id = a.object_id where a.action = 'item.approve' and v.import_job_id = 'a7000000-0000-4000-8000-000000000001' and a.actor_user_id = pg_temp.id('recruiter') and a.details ->> 'from' = 'draft' and a.details ->> 'self_approved' = 'true'), 4, 'Q23: each import approval is audited draft > approved, self-approved by the importer');
select is((select string_agg(row_no || ':' || field || ':' || error_code, ',' order by row_no, field) from public.import_row_errors where import_job_id = 'a7000000-0000-4000-8000-000000000001'),
  '4:difficulty:bad_difficulty,4:stem:missing_field,5:skill:bad_skill,6:correct:bad_key,7:row:duplicate_in_file,8:row:duplicate_in_bank,9:image_file:image_missing,10:image_file:bad_image_ref,12:param_spec_json:variant_generation_failed,13:stem:too_long',
  'AT-M1-11: the per-row errors are stored as codes');
select is((select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'import_row_errors'), 'org_id,import_job_id,row_no,field,error_code,workspace_id,created_at', 'AT-M1-11: import_row_errors has no column that could hold a cell value');
select is((select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'import_jobs' and data_type = 'text'), 'source_kind,template_version,status,error_code', 'M1-9: import_jobs stores no file, file name or cell (text columns are enums only)');

-- ===== E13: a re-sent batch is idempotent on (import_job_id, row_no) (R3-5) =====
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into pg_temp.res select 'r1b', public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), 'OK 1', 'E13: the same batch is sent again');
select is((select (select j from pg_temp.res where k = 'r1b') = (select j from pg_temp.res where k = 'r1')), true, 'E13: the re-sent batch gets the same answer');
select pg_temp.op();
select is((select count(*)::int from public.item_versions where import_job_id = 'a7000000-0000-4000-8000-000000000001') || '|' || (select count(*)::int from public.import_row_errors where import_job_id = 'a7000000-0000-4000-8000-000000000001') || '|' || (select count(*)::int from public.items where org_id = pg_temp.id('A') and created_by = pg_temp.id('recruiter')), '4|10|4', 'E13: no row, error or item is written twice');

-- ===== R5-37: a library import lands in review, not approved =====
select pg_temp.u('lib_author');
select is(pg_temp.try($$insert into pg_temp.res select 'rl', public.import_item_batch('a7000000-0000-4000-8000-00000000000a', (select j from pg_temp.batch where k = 'lib'))$$), 'OK 1', 'R5-37: library staff send a batch to the library import');
select pg_temp.op();
select is((select status::text || '|' || origin || '|' || coalesce(approved_by::text, 'null') from public.item_versions where import_job_id = 'a7000000-0000-4000-8000-00000000000a'), 'in_review|import|null', 'R5-37: a library import row is in_review with no approver (expert review stays)');
select is((select (j ->> 'accepted')::int from pg_temp.res where k = 'rl'), 1, 'R5-37: the library row is accepted');

-- ===== Fences on the job hook (§4.3, R2-9) =====
select pg_temp.u('ws_recruiter');
select is(pg_temp.try($$insert into pg_temp.res select 'ra2', public.import_item_batch('a7000000-0000-4000-8000-000000000005', (select j from pg_temp.batch where k = 'a2'))$$), 'OK 1', 'fence: workspace recruiter imports into their own A2 job');
select pg_temp.op();
select is((select workspace_id from public.item_versions where import_job_id = 'a7000000-0000-4000-8000-000000000005'), pg_temp.id('A2'), 'fence: the imported row lives in the job workspace A2');
select pg_temp.u('owner');
insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c7000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256, import_job_id, import_row_no) values ('a1000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] Fenced', '[{"id": "a", "text": "A"}, {"id": "b", "text": "B"}]', 'verbal', 0.5, repeat('6', 64), 'a7000000-0000-4000-8000-000000000005', 50)$$), '^42501 TRACE_GUARD: the import job is not open', 'fence: an A1 item cannot name an A2 import job');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256, import_row_no) values ('a1000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] Row without job', '[{"id": "a", "text": "A"}, {"id": "b", "text": "B"}]', 'verbal', 0.5, repeat('6', 64), 50)$$), '^23514', 'R3-5: a row number needs its import job');

-- ===== import_row_errors: I / S / U / D =====
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into public.import_row_errors (org_id, import_job_id, row_no, field, error_code) values ('a1000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', 20, 'stem', 'too_long')$$), 'OK 1', 'import_row_errors I: staff record an error code for an open job of their workspace');
select matches(pg_temp.try($$insert into public.import_row_errors (org_id, import_job_id, row_no, field, error_code) values ('a1000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', 21, 'stem', 'the stem said hello')$$), '^23514', 'import_row_errors I: the code is an enum, never text from the file');
select matches(pg_temp.try($$insert into public.import_row_errors (org_id, import_job_id, row_no, field, error_code) values ('a1000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', 2002, 'stem', 'row_limit')$$), '^23514', 'import_row_errors I: at most 2,000 data rows (rows 2..2001)');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$insert into public.import_row_errors (org_id, import_job_id, row_no, field, error_code) values ('a1000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', 22, 'stem', 'too_long')$$), '^42501', 'import_row_errors I: workspace recruiter cannot write errors of a workspace A1 job');
select is((select count(*)::int from public.import_row_errors), 0, 'import_row_errors S: workspace recruiter sees no workspace A1 error');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.import_row_errors), 0, 'import_row_errors S: reviewer sees nothing');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.import_row_errors), 0, 'import_row_errors S: org B admin sees nothing');
select pg_temp.u('owner');
select is((select count(*)::int from public.import_row_errors where import_job_id = 'a7000000-0000-4000-8000-000000000001'), 10, 'import_row_errors S: owner sees the A1 job errors');
select matches(pg_temp.try($$update public.import_row_errors set error_code = 'bad_key'$$), '^42501 permission denied', 'import_row_errors U: no update grant');
select matches(pg_temp.try($$delete from public.import_row_errors$$), '^42501 permission denied', 'import_row_errors D: no delete grant');
select pg_temp.op();
select matches(pg_temp.try($$update public.import_row_errors set error_code = 'bad_key'$$), '^42501 TRACE_GUARD: import row errors are never changed', 'import_row_errors U: never changed, even on the operator path');

-- ===== import_jobs: U (state machine §4.3; counts by the guard) =====
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.import_jobs set images_ok = 1 where id = 'a7000000-0000-4000-8000-000000000001'$$), 'OK 1', 'import_jobs U: staff record the images accepted while validating');
select matches(pg_temp.try($$update public.import_jobs set rows_ok = 999 where id = 'a7000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'import_jobs U: counts are outside the update grant');
select matches(pg_temp.try($$update public.import_jobs set source_kind = 'docx' where id = 'a7000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'import_jobs U: the source is outside the update grant');
select matches(pg_temp.try($$update public.import_jobs set status = 'open' where id = 'a7000000-0000-4000-8000-000000000005'$$), '^42501 TRACE_GUARD: import job status change not allowed', 'import_jobs U: a validating import never goes back to open');
select matches(pg_temp.try($$update public.import_jobs set status = 'failed' where id = 'a7000000-0000-4000-8000-000000000004'$$), '^23514', 'import_jobs U: a failure names its error code');
select is(pg_temp.try($$update public.import_jobs set status = 'completed' where id = 'a7000000-0000-4000-8000-000000000001'$$), 'OK 1', 'import_jobs U: recruiter completes the A1 import');
select pg_temp.op();
select is((select status || '|' || rows_total || '|' || rows_ok || '|' || rows_error || '|' || images_ok || '|' || (completed_at is not null)::text from public.import_jobs where id = 'a7000000-0000-4000-8000-000000000001'), 'completed|13|4|9|1|true', 'import_jobs U: completion counts the stored rows (4 items, 9 rows with errors)');
select is((select pg_temp.keys(details) || '|' || (details ->> 'rows_ok') || '|' || (details ->> 'rows_error') || '|' || (details ->> 'images_ok') || '|' || (actor_user_id = pg_temp.id('recruiter'))::text from public.audit_log where action = 'import.complete' and object_id = 'a7000000-0000-4000-8000-000000000001'), 'images_ok,import_job_id,rows_error,rows_ok|4|9|1|true', 'AT-M1-25: import.complete carries the job id and counts only (R5-26)');
select matches(pg_temp.try($$update public.import_jobs set images_ok = 2 where id = 'a7000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: a finished import job is frozen', 'import_jobs U: a finished job is frozen, even on the operator path');
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.import_jobs set images_ok = 2 where id = 'a7000000-0000-4000-8000-000000000001'$$), 'OK 0', 'import_jobs U: staff cannot reach a finished job');
select matches(pg_temp.try($$select public.import_item_batch('a7000000-0000-4000-8000-000000000001', (select j from pg_temp.batch where k = 'b1'))$$), '^42501 TRACE_GUARD: the import job is not open', 'batch: a completed job takes no more rows');
select is(pg_temp.try($$update public.import_jobs set status = 'cancelled' where id = 'a7000000-0000-4000-8000-000000000002'$$), 'OK 1', 'import_jobs U: recruiter cancels an open import');
select pg_temp.u('ws_recruiter');
select is(pg_temp.try($$update public.import_jobs set status = 'cancelled' where id = 'a7000000-0000-4000-8000-000000000004'$$), 'OK 0', 'import_jobs U: workspace recruiter cannot end a workspace A1 import');
select is(pg_temp.try($$update public.import_jobs set status = 'failed', error_code = 'timeout' where id = 'a7000000-0000-4000-8000-000000000003'$$), 'OK 1', 'import_jobs U: workspace recruiter marks their own A2 import failed');
select pg_temp.u('reviewer');
select is(pg_temp.try($$update public.import_jobs set status = 'cancelled' where id = 'a7000000-0000-4000-8000-000000000004'$$), 'OK 0', 'import_jobs U: reviewer cannot end an import');
select pg_temp.u('b_admin');
select is(pg_temp.try($$update public.import_jobs set status = 'cancelled' where id = 'a7000000-0000-4000-8000-000000000004'$$), 'OK 0', 'import_jobs U: org B admin cannot end an org A import');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try($$update public.import_jobs set status = 'cancelled' where id = 'a7000000-0000-4000-8000-000000000004'$$), '^42501 permission denied', 'import_jobs U: the authoring worker cannot touch an import');
select pg_temp.u('owner');
select matches(pg_temp.try($$delete from public.import_jobs where id = 'a7000000-0000-4000-8000-000000000004'$$), '^42501 permission denied', 'import_jobs D: no delete grant');
select pg_temp.op();
select matches(pg_temp.try($$delete from public.import_jobs where id = 'a7000000-0000-4000-8000-000000000004'$$), '^42501 TRACE_GUARD: import jobs are kept', 'import_jobs D: kept even on the operator path');
select is((select pg_temp.keys(details) || '|' || (details ->> 'import_job_id') from public.audit_log where action = 'import.cancel'), 'import_job_id|a7000000-0000-4000-8000-000000000002', 'AT-M1-25: import.cancel carries the job id only');
select is((select pg_temp.keys(details) || '|' || (details ->> 'error_code') from public.audit_log where action = 'import.fail'), 'error_code,import_job_id|timeout', 'AT-M1-25: import.fail carries the job id and an error code enum');
select is((select count(*)::int from public.audit_log where action like 'import.%' and exists (select 1 from jsonb_each(details) as e where jsonb_typeof(e.value) not in ('string', 'number'))), 0, 'AT-M1-25: no import audit row carries a nested or free-text structure');

-- ===== public.save_test_draft (M1-18: one transaction as the caller; E1) =====
select pg_temp.op();
select pg_temp.tv('d1', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.tv('pub', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('spub', 'pub', 1, 'mcq', null, null, 100);
select pg_temp.inline('ipub', 'spub');
select pg_temp.preset('pub', 'standard');
select pg_temp.publish('pub');
insert into pg_temp.batch values
  ('draft', jsonb_build_object('name', '[synthetic] Saved draft', 'totalTimeSeconds', 1500, 'qualityCutoff', 45, 'presetKey', 'standard',
    'settings', (select p.preset_values from public.integrity_presets as p where p.preset_key = 'standard' and p.version = 1),
    'sections', jsonb_build_array(
      jsonb_build_object('name', 'Choices', 'format', 'mcq', 'weight', 60, 'navigation', 'free', 'items', jsonb_build_array(jsonb_build_object('format', 'mcq', 'stem', '[synthetic] Saved MCQ', 'options', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]'::jsonb, 'correctOptionId', 'o2', 'contentSha256', repeat('1', 64)))),
      jsonb_build_object('name', 'Writing', 'format', 'written', 'weight', 40, 'navigation', 'forward_only', 'pasteRule', 'blocked', 'items', jsonb_build_array(jsonb_build_object('format', 'written', 'stem', '[synthetic] Saved prompt', 'rubric', jsonb_build_object('criteria', '[{"id": "c1", "label": "Clarity", "max_points": 5, "anchors": ["clear"], "min_hits": 1}]'::jsonb, 'contentSha256', repeat('2', 64)), 'contentSha256', repeat('3', 64))))))),
  ('draft_small', jsonb_build_object('name', '[synthetic] Saved draft', 'totalTimeSeconds', 1500, 'qualityCutoff', 45,
    'sections', jsonb_build_array(jsonb_build_object('name', 'Choices only', 'format', 'mcq', 'weight', 100, 'items', jsonb_build_array(jsonb_build_object('format', 'mcq', 'stem', '[synthetic] Saved MCQ again', 'options', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]'::jsonb, 'correctOptionId', 'o1', 'contentSha256', repeat('4', 64))))))),
  ('draft_badkey', jsonb_build_object('name', '[synthetic] Bad', 'totalTimeSeconds', 1500, 'qualityCutoff', 45,
    'sections', jsonb_build_array(jsonb_build_object('name', 'Choices', 'format', 'mcq', 'weight', 100, 'items', jsonb_build_array(jsonb_build_object('format', 'mcq', 'stem', '[synthetic] Bad key', 'options', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]'::jsonb, 'correctOptionId', 'zz', 'contentSha256', repeat('5', 64))))))),
  ('draft_poolitems', jsonb_build_object('name', '[synthetic] Bad', 'totalTimeSeconds', 1500, 'qualityCutoff', 45,
    'sections', jsonb_build_array(jsonb_build_object('name', 'Pool', 'format', 'mcq', 'weight', 100, 'poolId', gen_random_uuid(), 'drawCount', 1, 'items', jsonb_build_array(jsonb_build_object('format', 'mcq', 'stem', 'x', 'contentSha256', repeat('5', 64)))))));
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try($$select public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft'))$$), '^42501 permission denied', 'save_test_draft: trace_api cannot execute it');
select is((select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') || '|' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text from pg_proc as p where p.oid = 'public.save_test_draft(uuid, jsonb)'::regprocedure), 'false|search_path=""|false|true', 'save_test_draft: SECURITY INVOKER, empty search_path, EXECUTE to authenticated only (R2-5)');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$select public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft'))$$), '^23503 TRACE_GUARD: test version not found', 'save_test_draft: a workspace A2 recruiter cannot save a workspace A1 draft');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$select public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft'))$$), '^23503 TRACE_GUARD: test version not found', 'save_test_draft: org B admin cannot save an org A draft');
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into pg_temp.res select 'sd1', public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft'))$$), 'OK 1', 'save_test_draft: recruiter saves sections, items, keys and settings in one call');
select is((select j::text from pg_temp.res where k = 'sd1'), '{"items": 2, "sections": 2}', 'save_test_draft: the counts written come back');
select is((select string_agg(s.position || ':' || s.name || ':' || coalesce(s.navigation, 'null') || ':' || coalesce(s.paste_rule, 'null') || ':' || i.stem || ':' || coalesce(k.key ->> 'option_id', 'rubric'), ',' order by s.position) from public.sections as s join public.item_versions as i on i.section_id = s.id left join public.item_answer_keys as k on k.item_version_id = i.id where s.test_version_id = pg_temp.id('d1')), '1:Choices:free:null:[synthetic] Saved MCQ:o2,2:Writing:forward_only:blocked:[synthetic] Saved prompt:rubric', 'save_test_draft: sections, inline items and keys are stored in order');
select is((select v.total_time_seconds || '|' || v.quality_cutoff || '|' || t.name || '|' || r.preset_key || '|' || (r.signal_settings -> 'paste' ->> 'enabled') from public.test_versions as v join public.tests as t on t.id = v.test_id join public.ruleset_versions as r on r.id = v.ruleset_version_id where v.id = pg_temp.id('d1')), '1500|45|[synthetic] Saved draft|standard|false', 'save_test_draft: time, cutoff, name and settings saved; signal_settings derived by the guard (I-M1-7)');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft_small'))$$), 'OK 1', 'save_test_draft: a second save replaces the draft children');
select is((select count(*)::int || '|' || string_agg(s.name, ',') from public.sections as s where s.test_version_id = pg_temp.id('d1')) || '|' || (select count(*)::int from public.item_versions where test_version_id = pg_temp.id('d1')) || '|' || (select preset_key from public.ruleset_versions as r join public.test_versions as v on v.ruleset_version_id = r.id where v.id = pg_temp.id('d1')), '1|Choices only|1|standard', 'save_test_draft: old sections and items are gone; omitted settings are kept');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft_badkey'))$$), '23514 TRACE_BAD_ANSWER_KEY', 'save_test_draft: a bad key fails the whole call');
select is((select string_agg(s.name, ',') from public.sections as s where s.test_version_id = pg_temp.id('d1')), 'Choices only', 'save_test_draft: after a failed call the draft is as before (atomic, fixes D1 r3 m-4)');
select matches(pg_temp.try($$select public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft_poolitems'))$$), '^22023 TRACE_BAD_INPUT', 'save_test_draft: a pool section carries no inline items');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('pub'), (select j from pg_temp.batch where k = 'draft_small'))$$), '42501 TRACE_GUARD: a published test version is frozen', 'E1: saving a published version is refused by the database');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$select public.save_test_draft(pg_temp.id('d1'), (select j from pg_temp.batch where k = 'draft_small'))$$), '^23503 TRACE_GUARD: test version not found', 'save_test_draft: reviewer cannot save a draft');

-- ===== public.save_item_variants (ABH-7 generation lands through it; R2-22, R3-4) =====
select pg_temp.u('recruiter');
insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c7000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'quant');
insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000002', 'mcq', '[synthetic] Param draft', '[{"id": "o1", "text": "{{a+1}}"}, {"id": "o2", "text": "{{a+2}}"}]', 'quant', 0.50, true, '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "[synthetic] Param draft {{a}}", "options": [{"id": "o1", "text": "{{a+1}}"}, {"id": "o2", "text": "{{a+2}}"}], "correctOptionId": "o1", "count": 5}', repeat('9', 64));
select pg_temp.op();
insert into pg_temp.ids select 'pv', id from public.item_versions where stem = '[synthetic] Param draft';
insert into pg_temp.batch values
  ('vars2', '[{"variantNo": 1, "params": {"a": 2}, "stem": "[synthetic] 2 plus one", "options": [{"id": "o1", "text": "3"}, {"id": "o2", "text": "4"}], "difficulty": 0.5, "contentSha256": "4444444444444444444444444444444444444444444444444444444444444441", "correctOptionId": "o1"}, {"variantNo": 2, "params": {"a": 3}, "stem": "[synthetic] 3 plus one", "options": [{"id": "o1", "text": "4"}, {"id": "o2", "text": "5"}], "difficulty": 0.6, "contentSha256": "4444444444444444444444444444444444444444444444444444444444444442", "correctOptionId": "o1"}]'),
  ('vars1', '[{"variantNo": 1, "params": {"a": 7}, "stem": "[synthetic] 7 plus one", "options": [{"id": "o1", "text": "8"}, {"id": "o2", "text": "9"}], "difficulty": 0.45, "contentSha256": "4444444444444444444444444444444444444444444444444444444444444443", "correctOptionId": "o1"}]'),
  ('vars_far', '[{"variantNo": 1, "params": {"a": 7}, "stem": "[synthetic] 7 plus one", "options": [{"id": "o1", "text": "8"}, {"id": "o2", "text": "9"}], "difficulty": 0.61, "contentSha256": "4444444444444444444444444444444444444444444444444444444444444443", "correctOptionId": "o1"}]'),
  ('vars_badkey', '[{"variantNo": 1, "params": {"a": 7}, "stem": "[synthetic] 7 plus one", "options": [{"id": "o1", "text": "8"}, {"id": "o2", "text": "9"}], "difficulty": 0.5, "contentSha256": "4444444444444444444444444444444444444444444444444444444444444443", "correctOptionId": "o7"}]');
select is((select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') || '|' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text from pg_proc as p where p.oid = 'public.save_item_variants(uuid, jsonb)'::regprocedure), 'false|search_path=""|false|true', 'save_item_variants: SECURITY INVOKER, empty search_path, EXECUTE to authenticated only (R2-5)');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$select public.save_item_variants(pg_temp.id('pv'), (select j from pg_temp.batch where k = 'vars2'))$$), '^23503 TRACE_GUARD: item version not found', 'save_item_variants: a workspace A2 recruiter cannot reach a workspace A1 item');
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into pg_temp.res select 'sv2', to_jsonb(public.save_item_variants(pg_temp.id('pv'), (select j from pg_temp.batch where k = 'vars2')))$$), 'OK 1', 'save_item_variants: recruiter stores two variants and their keys');
select is((select j::text from pg_temp.res where k = 'sv2') || '|' || (select count(*)::int from public.item_variants where item_version_id = pg_temp.id('pv')) || '|' || (select count(*)::int from public.item_variant_keys as k join public.item_variants as v on v.id = k.item_variant_id where v.item_version_id = pg_temp.id('pv')), '2|2|2', 'save_item_variants: two variants, two keys');
select is(pg_temp.try($$select public.save_item_variants(pg_temp.id('pv'), (select j from pg_temp.batch where k = 'vars1'))$$), 'OK 1', 'save_item_variants: regeneration replaces the variants while the item is a draft');
select is((select string_agg(variant_no || ':' || difficulty, ',') from public.item_variants where item_version_id = pg_temp.id('pv')), '1:0.45', 'save_item_variants: only the new variant remains');
select is(pg_temp.try($$select public.save_item_variants(pg_temp.id('pv'), (select j from pg_temp.batch where k = 'vars_far'))$$), '23514 TRACE_GUARD: a variant difficulty must be within 0.10 of its item', 'AT-M1-05: a variant 0.11 away is refused');
select is(pg_temp.try($$select public.save_item_variants(pg_temp.id('pv'), (select j from pg_temp.batch where k = 'vars_badkey'))$$), '23514 TRACE_BAD_ANSWER_KEY', 'save_item_variants: a variant key names one of its options');
select is((select string_agg(variant_no || ':' || difficulty, ',') from public.item_variants where item_version_id = pg_temp.id('pv')), '1:0.45', 'save_item_variants: a failed call leaves the variants as they were');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where id = pg_temp.id('pv')$$), 'OK 1', 'save_item_variants: the item is submitted with its variants');
select is(pg_temp.try($$select public.save_item_variants(pg_temp.id('pv'), (select j from pg_temp.batch where k = 'vars2'))$$), '42501 TRACE_GUARD: the item version is frozen', 'R2-22: variants and their keys are frozen once the item leaves draft');
select is((select count(*)::int from public.item_variants where item_version_id = pg_temp.id('pv')), 1, 'R2-22: the submitted item keeps its variant');
select pg_temp.op();
