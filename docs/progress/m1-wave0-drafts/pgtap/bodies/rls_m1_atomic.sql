-- rls_m1_atomic (spec specs/m1-test-authoring.md revision 5 R5-71; migration M1-p: R5-70 re-review Low 1 = D1's shape re-checked inside save_test_draft under its row lock; R5-63 f = the navigation default and the written paste rule derived in the database from the draft's settings, so the integrity PUT is one write; R5-64 g / R5-51 f = a client never chooses an import or drafting job id)
-- Fixtures (operator path): dd = a D1-shaped draft (one inline MCQ section, no settings); dx = a draft whose stored
-- section is shuffled (D1's editor cannot express it); pd = a draft with an MCQ and a written section and no settings.
select pg_temp.tv('dd', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.sections (org_id, test_version_id, position, name, format, weight)
  values (pg_temp.id('A'), pg_temp.id('dd'), 1, 'Choices', 'mcq', 100);
select pg_temp.tv('dx', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.sections (org_id, test_version_id, position, name, format, weight, shuffle_items)
  values (pg_temp.id('A'), pg_temp.id('dx'), 1, 'Choices', 'mcq', 100, true);
with p as (
  insert into public.pools (org_id, workspace_id, name, format, skill_key)
    values (pg_temp.id('A'), pg_temp.id('A1'), 'Pool atomic', 'mcq', 'verbal') returning id
) insert into pg_temp.ids select 'pool1', id from p;
select pg_temp.tv('pd', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.sections (org_id, test_version_id, position, name, format, weight)
  values (pg_temp.id('A'), pg_temp.id('pd'), 1, 'Choices', 'mcq', 50), (pg_temp.id('A'), pg_temp.id('pd'), 2, 'Essay', 'written', 50);
insert into pg_temp.ids select 'pd_rs', ruleset_version_id from public.test_versions where id = pg_temp.id('pd');
create table pg_temp.batch (k text primary key, j jsonb not null);
grant select on pg_temp.batch to public;
insert into pg_temp.batch values
  ('v2', jsonb_build_object('name', '[synthetic] Saved draft', 'totalTimeSeconds', 1500, 'qualityCutoff', 45,
    'sections', jsonb_build_array(jsonb_build_object('name', 'Choices', 'format', 'mcq', 'weight', 100, 'items', jsonb_build_array(jsonb_build_object('format', 'mcq', 'stem', '[synthetic] Saved MCQ', 'options', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]'::jsonb, 'correctOptionId', 'o1', 'contentSha256', repeat('4', 64))))))),
  ('pd_save', jsonb_build_object('name', '[synthetic] Saved v2 draft', 'totalTimeSeconds', 1500, 'qualityCutoff', 45,
    'sections', jsonb_build_array(
      jsonb_build_object('name', 'Choices', 'format', 'mcq', 'weight', 50, 'items', jsonb_build_array(jsonb_build_object('format', 'mcq', 'stem', '[synthetic] Saved MCQ', 'options', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]'::jsonb, 'correctOptionId', 'o1', 'contentSha256', repeat('4', 64)))),
      jsonb_build_object('name', 'Essay', 'format', 'written', 'weight', 50, 'items', jsonb_build_array(jsonb_build_object('format', 'written', 'stem', '[synthetic] Saved prompt', 'rubric', jsonb_build_object('criteria', '[{"id": "c1", "label": "Clarity", "max_points": 5, "anchors": ["clear"], "min_hits": 1}]'::jsonb, 'contentSha256', repeat('2', 64)), 'contentSha256', repeat('3', 64)))))));
insert into pg_temp.batch select 'd1', j || '{"requireD1Shape": true}'::jsonb from pg_temp.batch where k = 'v2';
insert into pg_temp.batch select 'strict', p.preset_values from public.integrity_presets as p where p.preset_key = 'strict' and p.version = 1;

-- ===== R5-70 re-review Low 1: D1's PUT shape check runs inside save_test_draft, after the version row lock =====
select pg_temp.u('recruiter');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('dd'), (select j from pg_temp.batch where k = 'd1'))$$), 'OK 1', 'D1 shape: a D1-shaped stored draft takes a D1 save');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('dx'), (select j from pg_temp.batch where k = 'd1'))$$), '55000 TRACE_GUARD: the draft has sections the D1 editor cannot save', 'D1 shape: a shuffled stored section refuses a D1 save');
select is((select string_agg(s.name || ':' || s.shuffle_items, ',') from public.sections as s where s.test_version_id = pg_temp.id('dx')), 'Choices:true', 'D1 shape: the refused save wrote nothing (the stored section is kept)');
select is((select t.name from public.tests as t join public.test_versions as v on v.test_id = t.id where v.id = pg_temp.id('dx')), 'Test dx', 'D1 shape: the refused save did not rename the test');
select is((select v.total_time_seconds || '|' || v.quality_cutoff from public.test_versions as v where v.id = pg_temp.id('dx')), '1800|40', 'D1 shape: the version update before the check is rolled back too (M1-p spec review 2)');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('dx'), (select j from pg_temp.batch where k = 'v2'))$$), 'OK 1', 'D1 shape: a v2 save (no requireD1Shape) of the same draft is unchanged');
select pg_temp.op();
update public.sections set time_limit_seconds = 600 where test_version_id = pg_temp.id('dd');
select pg_temp.u('recruiter');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('dd'), (select j from pg_temp.batch where k = 'd1'))$$), '55000 TRACE_GUARD: the draft has sections the D1 editor cannot save', 'D1 shape: a timed section refuses a D1 save');
select pg_temp.op();
update public.sections set time_limit_seconds = null, blueprint = '{"strata": []}' where test_version_id = pg_temp.id('dd');
select pg_temp.u('recruiter');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('dd'), (select j from pg_temp.batch where k = 'd1'))$$), '55000 TRACE_GUARD: the draft has sections the D1 editor cannot save', 'D1 shape: a section with a blueprint refuses a D1 save');
select pg_temp.op();
update public.sections set blueprint = null, navigation = 'forward_only' where test_version_id = pg_temp.id('dd');
select pg_temp.u('recruiter');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('dd'), (select j from pg_temp.batch where k = 'd1'))$$), '55000 TRACE_GUARD: the draft has sections the D1 editor cannot save', 'D1 shape: an MCQ section with forward-only navigation refuses a D1 save');
select pg_temp.op();
update public.sections set navigation = null, shuffle_options = true where test_version_id = pg_temp.id('dd');
select pg_temp.u('recruiter');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('dd'), (select j from pg_temp.batch where k = 'd1'))$$), '55000 TRACE_GUARD: the draft has sections the D1 editor cannot save', 'D1 shape: shuffled options refuse a D1 save');
select pg_temp.op();
update public.sections set shuffle_options = false, pool_id = pg_temp.id('pool1'), draw_count = 1 where test_version_id = pg_temp.id('dd');
select pg_temp.u('recruiter');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('dd'), (select j from pg_temp.batch where k = 'd1'))$$), '55000 TRACE_GUARD: the draft has sections the D1 editor cannot save', 'D1 shape: a pool section refuses a D1 save');
select pg_temp.op();
update public.sections set pool_id = null, draw_count = null where test_version_id = pg_temp.id('dd');
insert into public.sections (org_id, test_version_id, position, name, format, weight)
  values (pg_temp.id('A'), pg_temp.id('dd'), 2, 'Choices again', 'mcq', 1);
select pg_temp.u('recruiter');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('dd'), (select j from pg_temp.batch where k = 'd1'))$$), '55000 TRACE_GUARD: the draft has sections the D1 editor cannot save', 'D1 shape: two sections of one format refuse a D1 save');
select pg_temp.op();
delete from public.sections where test_version_id = pg_temp.id('dd') and position = 2;
update public.sections set navigation = 'free' where test_version_id = pg_temp.id('dd');
select pg_temp.u('recruiter');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('dd'), (select j from pg_temp.batch where k = 'd1'))$$), 'OK 1', 'D1 shape: the format''s default navigation is D1-shaped (a draft with stored settings, R5-70 b)');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$select public.save_test_draft(pg_temp.id('dd'), (select j from pg_temp.batch where k = 'd1'))$$), '^23503 TRACE_GUARD: test version not found', 'D1 shape: a reviewer still cannot save (the shape check never answers before RLS)');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$select public.save_test_draft(pg_temp.id('dx'), (select j from pg_temp.batch where k = 'd1'))$$), '^23503 TRACE_GUARD: test version not found', 'D1 shape: org B admin learns nothing about an org A draft''s shape');

-- ===== R5-63 f: navigation default and written paste rule derived from the draft's settings (one write) =====
select pg_temp.op();
select is((select string_agg(s.format || ':' || coalesce(s.navigation, 'null') || ':' || coalesce(s.paste_rule, 'null'), ',' order by s.position) from public.sections as s where s.test_version_id = pg_temp.id('pd')), 'mcq:null:null,written:null:null', 'derive: a draft without settings keeps D1''s null navigation and paste rule');
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.ruleset_versions set preset_key = 'strict', settings = (select j from pg_temp.batch where k = 'strict') where id = pg_temp.id('pd_rs')$$), 'OK 1', 'derive: the recruiter stores Strict settings in one write');
select is((select string_agg(s.format || ':' || coalesce(s.navigation, 'null') || ':' || coalesce(s.paste_rule, 'null'), ',' order by s.position) from public.sections as s where s.test_version_id = pg_temp.id('pd')), 'mcq:free:null,written:forward_only:blocked', 'derive: the settings write gives every section its default navigation and the written one Strict''s paste rule');
select is(pg_temp.try($$update public.ruleset_versions set preset_key = null, settings = jsonb_set(settings, '{paste_written}', '"allowed_logged"') where id = pg_temp.id('pd_rs')$$), 'OK 1', 'derive: the recruiter changes the paste setting in one write');
select is((select string_agg(s.format || ':' || coalesce(s.navigation, 'null') || ':' || coalesce(s.paste_rule, 'null'), ',' order by s.position) from public.sections as s where s.test_version_id = pg_temp.id('pd')), 'mcq:free:null,written:forward_only:allowed_logged', 'derive: the written section follows the new paste setting');
select is(pg_temp.try($$insert into public.sections (org_id, test_version_id, position, name, format, weight, paste_rule) values (pg_temp.id('A'), pg_temp.id('pd'), 3, 'Essay two', 'written', 1, 'blocked')$$), 'OK 1', 'derive: a written section inserted with another paste rule is accepted');
select is((select s.navigation || ':' || s.paste_rule from public.sections as s where s.test_version_id = pg_temp.id('pd') and s.position = 3), 'forward_only:allowed_logged', 'derive: it stores the settings'' paste rule and the default navigation, never the request''s');
select is(pg_temp.try($$update public.sections set paste_rule = 'blocked' where test_version_id = pg_temp.id('pd') and position = 2$$), 'OK 1', 'derive: an update of a written section''s paste rule is accepted');
select is((select s.paste_rule from public.sections as s where s.test_version_id = pg_temp.id('pd') and s.position = 2), 'allowed_logged', 'derive: the stored paste rule still follows the settings');
select is(pg_temp.try($$update public.sections set navigation = null where test_version_id = pg_temp.id('pd') and position = 1$$), 'OK 1', 'derive: an update clearing an MCQ section''s navigation is accepted');
select is((select s.navigation from public.sections as s where s.test_version_id = pg_temp.id('pd') and s.position = 1), 'free', 'derive: a draft with settings never stores a null navigation (R5-63 b)');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('pd'), (select j from pg_temp.batch where k = 'pd_save'))$$), 'OK 1', 'derive: save_test_draft with sections that name no navigation or paste rule');
select is((select string_agg(s.format || ':' || coalesce(s.navigation, 'null') || ':' || coalesce(s.paste_rule, 'null'), ',' order by s.position) from public.sections as s where s.test_version_id = pg_temp.id('pd')), 'mcq:free:null,written:forward_only:allowed_logged', 'derive: the saved sections take the stored settings');
select is((select string_agg(s.format || ':' || coalesce(s.navigation, 'null') || ':' || coalesce(s.paste_rule, 'null'), ',' order by s.position) from public.sections as s where s.test_version_id = pg_temp.id('dd')), 'mcq:null:null', 'derive: a D1 draft (no settings) keeps what it stored');
select pg_temp.u('b_admin');
select is(pg_temp.try($$update public.ruleset_versions set settings = (select j from pg_temp.batch where k = 'strict') where id = pg_temp.id('pd_rs')$$), 'OK 0', 'derive: org B admin cannot reach org A settings, so no section moves');
select pg_temp.op();
select is((select string_agg(s.paste_rule, ',' order by s.position) from public.sections as s where s.test_version_id = pg_temp.id('pd') and s.format = 'written'), 'allowed_logged', 'derive: org A''s written section is unchanged');
select is((select string_agg(p.proname || ':' || p.prosecdef || ':' || array_to_string(p.proconfig, ',') || ':' || has_function_privilege('authenticated', p.oid, 'EXECUTE') || ':' || has_function_privilege('public', p.oid, 'EXECUTE'), ',' order by p.proname) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname in ('sections_settings_derive', 'ruleset_settings_to_sections')), 'ruleset_settings_to_sections:true:search_path="":false:false,sections_settings_derive:true:search_path="":false:false', 'derive: both trigger functions are DEFINER with an empty search_path and no EXECUTE grant');
select is((select string_agg(t.tgname || ':' || t.tgenabled::text, ',' order by t.tgname) from pg_trigger as t where t.tgname in ('sections_settings_derive', 'ruleset_settings_to_sections')), 'ruleset_settings_to_sections:A,sections_settings_derive:A', 'derive: both triggers are ENABLE ALWAYS');

-- ===== R5-64 g / R5-51 f: a client never chooses an import or drafting job id =====
select is(has_column_privilege('authenticated', 'public.import_jobs', 'id', 'INSERT')::text || '|' || has_column_privilege('authenticated', 'public.ai_draft_jobs', 'id', 'INSERT')::text, 'false|false', 'job ids: id is outside both insert grants');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$insert into public.import_jobs (id, org_id, workspace_id, source_kind, template_version) values (gen_random_uuid(), pg_temp.id('A'), pg_temp.id('A1'), 'xlsx', 'trace-items-v1')$$), '^42501 permission denied', 'job ids: a recruiter cannot choose an import job id');
select matches(pg_temp.try($$insert into public.ai_draft_jobs (id, org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values (gen_random_uuid(), pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), '^42501 permission denied', 'job ids: a recruiter cannot choose a drafting job id');
select is(pg_temp.try($$insert into public.import_jobs (org_id, workspace_id, source_kind, template_version) values (pg_temp.id('A'), pg_temp.id('A1'), 'xlsx', 'trace-items-v1')$$), 'OK 1', 'job ids: an import without an id still opens (the database picks it)');
select is(pg_temp.try($$insert into public.ai_draft_jobs (org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values (pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 2, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1')$$), 'OK 1', 'job ids: a drafting job without an id is still requested');


-- ===== M1-p fix round (database review 1, 2, 4; security review 1, 2; spec review 2) =====
-- The lock order (ruleset, then version) of save_test_draft: the race itself is a two-connection scenario in
-- scripts/test-concurrency-local.mjs ("draft save during a settings write"); here the lock is pinned in the body.
select is((select position('for no key update' in pg_get_functiondef('public.save_test_draft(uuid, jsonb)'::regprocedure)) between 1 and position('update public.test_versions' in pg_get_functiondef('public.save_test_draft(uuid, jsonb)'::regprocedure))), true, 'lock order: save_test_draft locks the ruleset before it updates the version');
select pg_temp.op();
insert into public.sections (org_id, test_version_id, position, name, format, weight, navigation)
  values (pg_temp.id('A'), pg_temp.id('dd'), 2, 'Essay', 'written', 1, 'forward_only');
select pg_temp.u('admin');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('dd'), (select j from pg_temp.batch where k = 'd1'))$$), 'OK 1', 'D1 shape: an admin''s D1 save of a draft whose written section is forward-only (its default) is accepted');
select pg_temp.op();
update public.sections set shuffle_items = true where test_version_id = pg_temp.id('dx');
insert into pg_temp.batch select 'd1_string', j || '{"requireD1Shape": "true"}'::jsonb from pg_temp.batch where k = 'v2';
select pg_temp.u('owner');
select is(pg_temp.try($$select public.save_test_draft(pg_temp.id('dx'), (select j from pg_temp.batch where k = 'd1_string'))$$), 'OK 1', 'D1 shape: only the JSON boolean true asks for the check (a string is ignored; the api sends the boolean)');
select pg_temp.u('hm');
select matches(pg_temp.try($$select public.save_test_draft(pg_temp.id('dd'), (select j from pg_temp.batch where k = 'd1'))$$), '^23503 TRACE_GUARD: test version not found', 'D1 shape: a hiring manager cannot save a draft');
select pg_temp.op();
select is(has_function_privilege('trace_candidate', 'public.save_test_draft(uuid, jsonb)', 'EXECUTE')::text || '|' || has_function_privilege('anon', 'public.save_test_draft(uuid, jsonb)', 'EXECUTE')::text, 'false|false', 'save_test_draft: the candidate role and anon cannot execute it');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$insert into public.sections (org_id, test_version_id, position, name, format, weight, paste_rule) values (pg_temp.id('A'), pg_temp.id('pd'), 9, 'Fenced', 'written', 1, 'blocked')$$), '^42501', 'derive: a workspace A2 recruiter cannot add a section to a workspace A1 draft (the DEFINER trigger gives no reach)');
select is(pg_temp.try($$update public.ruleset_versions set settings = (select j from pg_temp.batch where k = 'strict') where id = pg_temp.id('pd_rs')$$), 'OK 0', 'derive: a workspace A2 recruiter cannot reach workspace A1 settings');
select pg_temp.u('reviewer');
select is(pg_temp.try($$update public.ruleset_versions set settings = (select j from pg_temp.batch where k = 'strict') where id = pg_temp.id('pd_rs')$$), 'OK 0', 'derive: a reviewer cannot write settings');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.sections (org_id, test_version_id, position, name, format, weight) values (pg_temp.id('A'), pg_temp.id('pd'), 9, 'Foreign', 'written', 1)$$), '^42501', 'derive: org B admin cannot add a section to an org A draft');
select pg_temp.op();
select is((select count(*)::int || '|' || string_agg(s.paste_rule, ',') from public.sections as s where s.test_version_id = pg_temp.id('pd') and s.format = 'written'), '1|allowed_logged', 'derive: the refused writes changed no org A section');
