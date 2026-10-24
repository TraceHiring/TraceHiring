-- rls_m1_publish_source (spec specs/m1-test-authoring.md revision 5 §3.4, §6.5; R5-63 f, R5-65). RED first: written before migration M1-o. The api reads a v2 package's source in one call: public.publish_source_v2 (SECURITY INVOKER) returns the pool members (live: approved bank versions of each pool section; frozen: section_pool_snapshot), their item rows, the variants of parameterised items and, live only, the served counts. RLS applies as the caller; another org reads null. Personas and items are synthetic.
-- Fixtures (operator path): pool PS1 = approved MCQ items ps1..ps3 plus the parameterised item psq; pool PS2 = ps3 (in
-- two sections) and ps4; ps5 is approved but in no pool; ps6 joins PS1 and is retired. Version ts1 has an inline
-- section and two pool sections (PS1 draw 2, PS2 draw 1); ts1 is published and served once, then ts2 (a draft of the
-- same test shape) reads the live source with the served count.
select pg_temp.bank('ps' || n, pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved') from generate_series(1, 6) as n;
insert into public.items (id, org_id, workspace_id, format, skill_key) values
  ('c5000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant');
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256) values
  ('c5100000-0000-4000-8000-000000000001', pg_temp.id('A'), 'c5000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] What is a + 1?',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64));
insert into public.item_variants (id, org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values
  ('c5200000-0000-4000-8000-000000000002', pg_temp.id('A'), 'c5100000-0000-4000-8000-000000000001', 2, '{"a": 4}',
   '[synthetic] What is 4 + 1?', '[{"id": "o1", "text": "5"}, {"id": "o2", "text": "4"}]', 0.50, repeat('c', 64)),
  ('c5200000-0000-4000-8000-000000000001', pg_temp.id('A'), 'c5100000-0000-4000-8000-000000000001', 1, '{"a": 3}',
   '[synthetic] What is 3 + 1?', '[{"id": "o1", "text": "4"}, {"id": "o2", "text": "3"}]', 0.50, repeat('c', 64));
insert into public.item_variant_keys (org_id, item_variant_id, key) values
  (pg_temp.id('A'), 'c5200000-0000-4000-8000-000000000001', '{"option_id": "o1"}'),
  (pg_temp.id('A'), 'c5200000-0000-4000-8000-000000000002', '{"option_id": "o1"}');
update public.item_versions set status = 'in_review' where id = 'c5100000-0000-4000-8000-000000000001';
update public.item_versions set status = 'approved', approved_by = pg_temp.id('owner') where id = 'c5100000-0000-4000-8000-000000000001';
insert into pg_temp.ids values ('psq', 'c5100000-0000-4000-8000-000000000001');
insert into public.pools (id, org_id, workspace_id, name, format) values
  ('d5000000-0000-4000-8000-0000000000a1', pg_temp.id('A'), pg_temp.id('A1'), 'Pool PS1', 'mcq'),
  ('d5000000-0000-4000-8000-0000000000a2', pg_temp.id('A'), pg_temp.id('A1'), 'Pool PS2', 'mcq');
insert into public.pool_items (org_id, pool_id, item_version_id)
  select pg_temp.id('A'), 'd5000000-0000-4000-8000-0000000000a1'::uuid, pg_temp.id(k) from unnest(array['ps1', 'ps2', 'ps3', 'psq', 'ps6']) as k
  union all select pg_temp.id('A'), 'd5000000-0000-4000-8000-0000000000a2'::uuid, pg_temp.id(k) from unnest(array['ps3', 'ps4']) as k;
update public.item_versions set status = 'retired' where id = pg_temp.id('ps6');
select pg_temp.tv('ts1', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('ts1_in', 'ts1', 1, 'mcq', null, null, 20);
select pg_temp.inline('ts1_i1', 'ts1_in');
select pg_temp.sec('ts1_p1', 'ts1', 2, 'mcq', 'd5000000-0000-4000-8000-0000000000a1', 2, 40);
select pg_temp.sec('ts1_p2', 'ts1', 3, 'mcq', 'd5000000-0000-4000-8000-0000000000a2', 1, 40);
select pg_temp.preset('ts1', 'standard');
-- Expected member lists (section:item, sorted), computed from the fixture ids.
create temp table expect_live as
  select string_agg(l, ',' order by l collate "C") as v from (
    select pg_temp.id('ts1_p1')::text || ':' || pg_temp.id(k)::text as l from unnest(array['ps1', 'ps2', 'ps3', 'psq']) as k
    union all select pg_temp.id('ts1_p2')::text || ':' || pg_temp.id(k)::text from unnest(array['ps3', 'ps4']) as k
  ) as x;
grant select on expect_live to public;
create temp table got as select null::jsonb as j;
grant select, update on got to public;

-- ===== Shape and privileges =====
select is((select p.prosecdef::text || '|' || p.provolatile::text || '|' || array_to_string(p.proconfig, ',') from pg_proc as p where p.oid = 'public.publish_source_v2(uuid, uuid, boolean)'::regprocedure), 'false|s|search_path=""', 'source: SECURITY INVOKER, stable, with an empty search_path');
select is(has_function_privilege('authenticated', 'public.publish_source_v2(uuid, uuid, boolean)', 'EXECUTE'), true, 'source: authenticated may execute it (RLS applies)');
select is((select array_agg(r order by r) from unnest(array['anon', 'trace_candidate', 'trace_worker', 'trace_api', 'trace_admin_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_authoring_worker']) as r where has_function_privilege(r, 'public.publish_source_v2(uuid, uuid, boolean)', 'EXECUTE')), null, 'source: no other role may execute it');

-- ===== Live source (before publish) =====
select pg_temp.u('recruiter');
update got set j = public.publish_source_v2(pg_temp.id('A'), pg_temp.id('ts1'), false);
select is((select string_agg((m ->> 'section_id') || ':' || (m ->> 'item_version_id'), ',' order by (m ->> 'section_id') || ':' || (m ->> 'item_version_id') collate "C") from got, jsonb_array_elements(j -> 'members') as m), (select v from expect_live), 'live: members are the approved bank versions of each pool section (retired, unpooled and inline items never)');
select is((select count(*)::int from got, jsonb_array_elements(j -> 'items') as i), 5, 'live: each member item appears once in items (ps3 is in two sections)');
select is((select string_agg(k, ',' order by k) from got, jsonb_object_keys(j -> 'items' -> 0) as k), 'difficulty,format,id,is_parameterised,item_id,media,options,position,rubric_version_id,section_id,skill_key,stem,test_version_id', 'live: an item row has exactly the package columns (no key, no rubric body)');
select is((select string_agg((v ->> 'variant_no') || '=' || (v ->> 'item_version_id'), ',' order by (v ->> 'variant_no')) from got, jsonb_array_elements(j -> 'variants') as v), '1=' || pg_temp.id('psq')::text || ',2=' || pg_temp.id('psq')::text, 'live: the variants of the parameterised item');
select is((select string_agg(k, ',' order by k) from got, jsonb_object_keys(j -> 'variants' -> 0) as k), 'id,item_version_id,options,stem,variant_no', 'live: a variant row has no params and no key');
select is((select jsonb_array_length(j -> 'exposure') from got), 0, 'live: no item has been served yet');
select is((select bool_and(m -> 'exposure_at_publish' = 'null'::jsonb) from got, jsonb_array_elements(j -> 'members') as m), true, 'live: members carry no frozen exposure');
select pg_temp.u('owner');
select is((select jsonb_array_length(public.publish_source_v2(pg_temp.id('A'), pg_temp.id('ts1'), false) -> 'members')), 6, 'live: the org owner reads the same six members');
select pg_temp.u('b_admin');
select is(public.publish_source_v2(pg_temp.id('A'), pg_temp.id('ts1'), false), null, 'live: another org''s admin reads null (RLS, no existence leak)');
select is(public.publish_source_v2(pg_temp.id('B'), pg_temp.id('ts1'), false), null, 'live: naming their own org with org A''s version reads null');
select pg_temp.u('recruiter');
select is(public.publish_source_v2(pg_temp.id('B'), pg_temp.id('ts1'), false), null, 'live: a version outside the named org reads null');

-- ===== Frozen source (after publish) and the served count =====
-- Publish refuses an item in two sections, so ps3 leaves PS2 first: the frozen source has five members.
select pg_temp.op();
delete from public.pool_items where pool_id = 'd5000000-0000-4000-8000-0000000000a2' and item_version_id = pg_temp.id('ps3');
drop table expect_live;
create temp table expect_live as
  select string_agg(l, ',' order by l collate "C") as v from (
    select pg_temp.id('ts1_p1')::text || ':' || pg_temp.id(k)::text as l from unnest(array['ps1', 'ps2', 'ps3', 'psq']) as k
    union all select pg_temp.id('ts1_p2')::text || ':' || pg_temp.id('ps4')::text
  ) as x;
grant select on expect_live to public;
-- The snapshot also holds the inline section's rows (the api reads inline items from the draft content instead).
create temp table expect_frozen as
  select string_agg(l, ',' order by l collate "C") as v from (
    select pg_temp.id('ts1_p1')::text || ':' || pg_temp.id(k)::text as l from unnest(array['ps1', 'ps2', 'ps3', 'psq']) as k
    union all select pg_temp.id('ts1_p2')::text || ':' || pg_temp.id('ps4')::text
    union all select pg_temp.id('ts1_in')::text || ':' || pg_temp.id('ts1_i1')::text
  ) as x;
grant select on expect_frozen to public;
select pg_temp.publish('ts1');
select pg_temp.u('recruiter');
update got set j = public.publish_source_v2(pg_temp.id('A'), pg_temp.id('ts1'), true);
select is((select string_agg((m ->> 'section_id') || ':' || (m ->> 'item_version_id'), ',' order by (m ->> 'section_id') || ':' || (m ->> 'item_version_id') collate "C") from got, jsonb_array_elements(j -> 'members') as m), (select v from expect_frozen), 'frozen: members are the section_pool_snapshot rows of the version');
select is((select bool_and((m ->> 'exposure_at_publish')::int = 0) from got, jsonb_array_elements(j -> 'members') as m), true, 'frozen: members carry the exposure frozen at publish');
select is((select jsonb_array_length(j -> 'exposure') from got), 0, 'frozen: no live served counts are read');
select is((select count(*)::int from got, jsonb_array_elements(j -> 'items') as i), 6, 'frozen: the six snapshot items (five pool members, one inline)');
-- A bank item retired after publish stays in the frozen source (the snapshot wins).
select pg_temp.op();
update public.item_versions set status = 'retired' where id = pg_temp.id('ps4');
select pg_temp.u('recruiter');
select is((select jsonb_array_length(public.publish_source_v2(pg_temp.id('A'), pg_temp.id('ts1'), true) -> 'members')), 6, 'frozen: an item retired after publish stays in the frozen source');
select is((select jsonb_array_length(public.publish_source_v2(pg_temp.id('A'), pg_temp.id('ts1'), false) -> 'members')), 4, 'live: the retired item leaves the live source');
-- One serve of ps1 in a session of the published version: the live source counts it.
select pg_temp.op();
select pg_temp.session('sps', 'ts1', 92);
select pg_temp.w('trace_worker', pg_temp.id('A'));
select is(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at) values (%L, %L, %L, %L, 1, now())$$, pg_temp.id('A'), pg_temp.id('sps'), pg_temp.id('ts1_p1'), pg_temp.id('ps1'))), 'OK 1', 'exposure: ps1 is served once in a session of the published version');
select pg_temp.u('recruiter');
select is((select string_agg((e ->> 'item_id') || '=' || (e ->> 'served_count'), ',') from jsonb_array_elements(public.publish_source_v2(pg_temp.id('A'), pg_temp.id('ts1'), false) -> 'exposure') as e), pg_temp.id('ps1_item')::text || '=1', 'exposure: the live source sums the served count by item');
select pg_temp.u('b_admin');
select is(public.publish_source_v2(pg_temp.id('A'), pg_temp.id('ts1'), true), null, 'frozen: another org''s admin reads null');

-- ===== Fences =====
select pg_temp.u('recruiter');
select matches(pg_temp.try($$select public.publish_source_v2(null, null, false)$$), '^OK', 'source: null arguments read null, never an error');
select is(public.publish_source_v2(pg_temp.id('A'), null, false), null, 'source: a null version reads null');
select pg_temp.op();
select is((select count(*)::int from pg_proc as p where p.proname = 'publish_source_v2' and pg_get_functiondef(p.oid) ~* '(quality|integrity)\.'), 0, 'source: the function reads no quality.* or integrity.* object (I-M1-10)');
