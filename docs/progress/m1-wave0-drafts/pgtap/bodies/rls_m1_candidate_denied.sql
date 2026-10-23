-- rls_m1_candidate_denied (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_candidate_denied; §3.5 last line: trace_candidate, anon, service_role, hiring_manager and client viewer hold nothing on any M1 table; rule 5). rls_d1_candidate_denied already scans the whole catalogue for trace_candidate, trace_candidate_gateway and anon; this file adds service_role, the M1 functions, the RLS personas and direct calls. RED first: written from the spec before migration M1-b. Personas and content are synthetic.
-- m1_tables(): every M1 table and view (M1-a, M1-b, M1-c, M1-d, M1-m).
create function pg_temp.m1_tables() returns text[] language sql as $f$
  select array['skill_taxonomy', 'items', 'item_variants', 'item_variant_keys', 'item_exposure_events', 'pools', 'pool_items',
    'library_copy_requests', 'role_templates', 'jobs', 'section_pool_snapshot', 'integrity_setting_defs', 'integrity_presets',
    'org_integrity_locks', 'v_item_exposure', 'v_item_bank_quant_share', 'import_jobs', 'import_row_errors', 'ai_draft_jobs',
    'member_invites', 'v_pool_item_counts']
$f$;
grant execute on function pg_temp.m1_tables() to public;
-- m1_functions(): every function M1 adds in private or public (M1-a, M1-b, M1-c, M1-d).
create function pg_temp.m1_functions() returns text[] language sql as $f$
  select array['library_org_id', 'param_spec_valid', 'media_refs_valid', 'skill_key_exists', 'ai_draft_job_running',
    'import_job_open', 'item_version_ready', 'library_copy', 'library_viewer_ok', 'library_browse', 'library_exposure',
    'blueprint_valid', 'current_settings_catalog', 'integrity_settings_check', 'derive_signal_settings',
    'assert_drive_pool_ratio', 'library_reference', 'session_items_a_ai_gate', 'session_items_exposure',
    'ai_draft_job_running_in', 'item_media_in_org', 'bank_no_truncate', 'sealed_settings_catalogs', 'settings_catalog_sealed',
    'import_jobs_guard', 'import_jobs_audit', 'import_row_errors_guard', 'ai_draft_jobs_guard', 'ai_draft_jobs_audit',
    'save_item_variants', 'import_item_batch', 'save_test_draft', 'member_invites_guard', 'member_invites_audit',
    'provision_invited_member', 'ai_draft_job_has_room', 'fail_stranded_ai_draft_jobs']
$f$;
grant execute on function pg_temp.m1_functions() to public;
-- held(role): the M1 tables and functions the role holds any privilege on (table, any column, EXECUTE), sorted.
create function pg_temp.held(p_role text) returns text language sql as $f$
  select coalesce(string_agg(x, ',' order by x), '') from (
    select 'table:' || t as x from unnest(pg_temp.m1_tables()) as t
    where has_table_privilege(p_role, 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(p_role, 'public.' || t, 'SELECT,INSERT,UPDATE,REFERENCES')
    union all
    select 'function:' || n.nspname || '.' || p.proname from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname = any (pg_temp.m1_functions())
      and has_function_privilege(p_role, p.oid, 'EXECUTE')
  ) as h
$f$;
grant execute on function pg_temp.held(text) to public;

-- ===== Grants: nothing for the candidate side or service_role =====
select is(pg_temp.held('anon'), '', 'anon holds nothing on any M1 table or function');
select is(pg_temp.held('trace_candidate'), '', 'trace_candidate holds nothing on any M1 table or function');
select is(pg_temp.held('trace_candidate_gateway'), '', 'trace_candidate_gateway holds nothing on any M1 table or function');
select is(pg_temp.held('service_role'), '', 'service_role holds nothing on any M1 table or function (service keys stay out of M1)');
select is((select count(*)::int from unnest(pg_temp.m1_tables()) as t), (select count(*)::int from pg_class as c join pg_namespace as n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any (pg_temp.m1_tables())), 'every listed M1 table and view exists (the list is not stale)');

-- Fixtures (operator path): one of every M1 row kind in org A, workspace A1.
select pg_temp.bank('b1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('b2', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('lib1', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'verbal', 0.50, 'approved');
insert into public.items (id, org_id, workspace_id, format, skill_key) values
  ('c2000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant');
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256) values
  ('c2100000-0000-4000-8000-000000000001', pg_temp.id('A'), 'c2000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] What is a + 1?',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64));
insert into public.item_variants (id, org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values
  ('c2200000-0000-4000-8000-000000000001', pg_temp.id('A'), 'c2100000-0000-4000-8000-000000000001', 1, '{"a": 3}',
   '[synthetic] What is 3 + 1?', '[{"id": "o1", "text": "4"}, {"id": "o2", "text": "3"}]', 0.50, repeat('c', 64));
insert into public.item_variant_keys (org_id, item_variant_id, key) values
  (pg_temp.id('A'), 'c2200000-0000-4000-8000-000000000001', '{"option_id": "o1"}');
select pg_temp.u('owner');
insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values
  (pg_temp.id('A'), pg_temp.id('A1'), array[pg_temp.id('lib1')]);
select pg_temp.op();
insert into public.pools (id, org_id, workspace_id, name, format) values
  ('d1000000-0000-4000-8000-0000000000c1', pg_temp.id('A'), pg_temp.id('A1'), 'Denied pool', 'mcq');
insert into public.pool_items (org_id, pool_id, item_version_id) values
  (pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000c1', pg_temp.id('b1')),
  (pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000c1', pg_temp.id('b2'));
insert into public.jobs (org_id, workspace_id, title) values (pg_temp.id('A'), pg_temp.id('A1'), 'Denied job');
insert into public.role_templates (org_id, template_key, version, name, keywords, blueprint, preset_key) values
  (pg_temp.id('A'), 'denied_tpl', 1, 'Denied template', '{night}',
   '{"sections": [{"title": "Verbal", "format": "mcq", "skillKey": "verbal", "drawCount": 1, "available": true}], "totalTimeSeconds": 600}', 'standard');
insert into public.org_integrity_locks (org_id, setting_key, locked_value) values (pg_temp.id('A'), 'question_copy', 'on');
-- One row in each M1-c/M1-d table (operator path), so the owner control proves the zeros below are denials.
insert into public.import_jobs (id, org_id, workspace_id, source_kind, template_version, created_by) values
  ('a7000000-0000-4000-8000-0000000000c1', pg_temp.id('A'), pg_temp.id('A1'), 'xlsx', 'trace-items-v1', pg_temp.id('owner'));
insert into public.import_row_errors (org_id, import_job_id, row_no, field, error_code) values
  (pg_temp.id('A'), 'a7000000-0000-4000-8000-0000000000c1', 2, 'stem', 'missing_field');
insert into public.ai_draft_jobs (org_id, workspace_id, requested_by, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values
  (pg_temp.id('A'), pg_temp.id('A1'), pg_temp.id('owner'), 'mcq', 'verbal', 0.50, 1, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1');
insert into public.member_invites (org_id, email_hmac, roles, invited_by) values
  (pg_temp.id('A'), repeat('c', 64), '{recruiter}', pg_temp.id('admin'));
select pg_temp.tv('v2', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sp', 'v2', 1, 'mcq', 'd1000000-0000-4000-8000-0000000000c1', 1, 100);
select pg_temp.preset('v2', 'standard');
select pg_temp.publish('v2');
select pg_temp.session('a', 'v2', 31);
select pg_temp.w('trace_worker', pg_temp.id('A'));
insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at) values
  (pg_temp.id('A'), pg_temp.id('a'), pg_temp.id('sp'), pg_temp.id('b1'), 1, '2026-10-14 10:05:00+00');
select pg_temp.op();
-- visible(): rows of each M1 table and view the current role can read ('-' when it has no grant at all).
create function pg_temp.visible() returns text language plpgsql as $f$
declare v_out text := ''; t text; n bigint;
begin
  foreach t in array pg_temp.m1_tables() loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      v_out := v_out || t || '=' || n || ' ';
    exception when insufficient_privilege then
      v_out := v_out || t || '=- ';
    end;
  end loop;
  return trim(v_out);
end
$f$;
grant execute on function pg_temp.visible() to public;
select is((select string_agg(t, ',' order by t) from unnest(pg_temp.m1_tables()) as t where t not like 'v\_%' and not exists (select 1 from information_schema.columns as c where c.table_schema = 'public' and c.table_name = t and c.column_name = 'org_id')), null, 'every M1 table has org_id (tenancy rule)');

-- ===== RLS personas: a hiring manager and an outsider read nothing =====
select pg_temp.u('hm');
select is(pg_temp.visible(), 'skill_taxonomy=- items=0 item_variants=0 item_variant_keys=0 item_exposure_events=0 pools=0 pool_items=0 library_copy_requests=0 role_templates=0 jobs=0 section_pool_snapshot=0 integrity_setting_defs=- integrity_presets=- org_integrity_locks=0 v_item_exposure=0 v_item_bank_quant_share=0 import_jobs=0 import_row_errors=0 ai_draft_jobs=0 member_invites=0 v_pool_item_counts=0', 'a hiring manager of org A reads no M1 row');
select pg_temp.u('outsider');
select is(pg_temp.visible(), 'skill_taxonomy=- items=0 item_variants=0 item_variant_keys=0 item_exposure_events=0 pools=0 pool_items=0 library_copy_requests=0 role_templates=0 jobs=0 section_pool_snapshot=0 integrity_setting_defs=- integrity_presets=- org_integrity_locks=0 v_item_exposure=0 v_item_bank_quant_share=0 import_jobs=0 import_row_errors=0 ai_draft_jobs=0 member_invites=0 v_pool_item_counts=0', 'a user with no membership reads no M1 row');
select pg_temp.u('owner');
select is(pg_temp.visible(), 'skill_taxonomy=- items=4 item_variants=1 item_variant_keys=1 item_exposure_events=1 pools=1 pool_items=2 library_copy_requests=1 role_templates=1 jobs=1 section_pool_snapshot=2 integrity_setting_defs=- integrity_presets=- org_integrity_locks=1 v_item_exposure=1 v_item_bank_quant_share=1 import_jobs=1 import_row_errors=1 ai_draft_jobs=1 member_invites=1 v_pool_item_counts=1', 'control: the owner reads the fixtures (so the zeros above are denials)');
select pg_temp.op();

-- ===== Direct calls by the candidate roles =====
set local role trace_candidate;
select is(pg_temp.visible(), 'skill_taxonomy=- items=- item_variants=- item_variant_keys=- item_exposure_events=- pools=- pool_items=- library_copy_requests=- role_templates=- jobs=- section_pool_snapshot=- integrity_setting_defs=- integrity_presets=- org_integrity_locks=- v_item_exposure=- v_item_bank_quant_share=- import_jobs=- import_row_errors=- ai_draft_jobs=- member_invites=- v_pool_item_counts=-', 'trace_candidate: every M1 table and view is permission denied');
select matches(pg_temp.try($$select * from private.library_browse(null, null, null, null, null, null, null, null, null, 10)$$), '^42501 permission denied', 'trace_candidate: library_browse is denied');
select matches(pg_temp.try($$select private.library_reference(null, null, null, 'templates')$$), '^42501 permission denied', 'trace_candidate: library_reference is denied');
reset role;
set local role anon;
select is(pg_temp.visible(), 'skill_taxonomy=- items=- item_variants=- item_variant_keys=- item_exposure_events=- pools=- pool_items=- library_copy_requests=- role_templates=- jobs=- section_pool_snapshot=- integrity_setting_defs=- integrity_presets=- org_integrity_locks=- v_item_exposure=- v_item_bank_quant_share=- import_jobs=- import_row_errors=- ai_draft_jobs=- member_invites=- v_pool_item_counts=-', 'anon: every M1 table and view is permission denied');
reset role;
set local role service_role;
select is(pg_temp.visible(), 'skill_taxonomy=- items=- item_variants=- item_variant_keys=- item_exposure_events=- pools=- pool_items=- library_copy_requests=- role_templates=- jobs=- section_pool_snapshot=- integrity_setting_defs=- integrity_presets=- org_integrity_locks=- v_item_exposure=- v_item_bank_quant_share=- import_jobs=- import_row_errors=- ai_draft_jobs=- member_invites=- v_pool_item_counts=-', 'service_role: every M1 table and view is permission denied');
reset role;
