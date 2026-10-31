-- rls_m1_bank_fixes (spec specs/m1-test-authoring.md revision 5 §3.4, §3.5, §4.1, §4.3; R5-64; A2a database first review D1, D2, D4, D6, D7 in docs/reviews/M1-wave2-first-reviews.md). RED first: written before migration M1-m. Personas and items are synthetic.
-- Fixtures (operator path): MCQ drafts with their key on option o1, an approved item, a pool of mixed statuses.
select pg_temp.bank('kd', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'draft');
select pg_temp.bank('kk', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'draft');
select pg_temp.bank('ki', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'draft');
select pg_temp.bank('ov', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('p1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('p2', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('p3', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('pb', pg_temp.id('B'), pg_temp.id('BW'), 'mcq', 'verbal', 0.50, 'approved');
insert into public.pools (id, org_id, workspace_id, name, format, skill_key) values
  ('d9000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), 'Verbal pool', 'mcq', 'verbal'),
  ('d9000000-0000-4000-8000-000000000002', pg_temp.id('A'), pg_temp.id('A1'), 'Empty pool', 'mcq', 'verbal'),
  ('d9000000-0000-4000-8000-000000000003', pg_temp.id('B'), pg_temp.id('BW'), 'Org B pool', 'mcq', 'verbal');
insert into public.pool_items (org_id, pool_id, item_version_id) values
  (pg_temp.id('A'), 'd9000000-0000-4000-8000-000000000001', pg_temp.id('p1')),
  (pg_temp.id('A'), 'd9000000-0000-4000-8000-000000000001', pg_temp.id('p2')),
  (pg_temp.id('A'), 'd9000000-0000-4000-8000-000000000001', pg_temp.id('p3')),
  (pg_temp.id('B'), 'd9000000-0000-4000-8000-000000000003', pg_temp.id('pb'));
-- E3: a retired item stays in its pool and stops counting as approved.
update public.item_versions set status = 'retired' where id = pg_temp.id('p3');

-- ===== D1: the answer key names one of the version's options when it leaves draft (§4.1) =====
select pg_temp.u('owner');
select is(pg_temp.try(format($$update public.item_versions set options = '[{"id": "o3", "text": "Three"}, {"id": "o4", "text": "Four"}]' where id = %L$$, pg_temp.id('kd'))), 'OK 1', 'D1 setup: the owner replaces the options of a draft whose key names o1');
select matches(pg_temp.try(format($$update public.item_versions set status = 'in_review' where id = %L$$, pg_temp.id('kd'))), '^42501 TRACE_GUARD: a multiple-choice item needs its answer key', 'D1: a draft whose key names a deleted option cannot be submitted');
select is((select status::text from public.item_versions where id = pg_temp.id('kd')), 'draft', 'D1: the refused submit leaves the draft as it was');
select is(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o3"}' where item_version_id = %L$$, pg_temp.id('kd'))), 'OK 1', 'D1: the owner moves the key to a current option');
select is(pg_temp.try(format($$update public.item_versions set status = 'in_review' where id = %L$$, pg_temp.id('kd'))), 'OK 1', 'D1: with the key on a current option the draft is submitted');
select is(pg_temp.try(format($$update public.item_versions set status = 'in_review' where id = %L$$, pg_temp.id('kk'))), 'OK 1', 'D1 control: an untouched draft with its key is submitted');
select pg_temp.op();
update public.item_versions set options = '[{"id": "o5", "text": "Five"}, {"id": "o6", "text": "Six"}]' where id = pg_temp.id('ki');
select matches(pg_temp.try(format($$update public.item_versions set status = 'in_review' where id = %L$$, pg_temp.id('ki'))), '^42501 TRACE_GUARD: a multiple-choice item needs its answer key', 'D1: the operator path is refused the same way (the guard holds for every writer)');

-- ===== D4: one open (draft or in-review) version per bank item =====
select pg_temp.u('owner');
select is(pg_temp.try(format($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256) values (%L, %L, 'mcq', '[synthetic] Version two', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, repeat('d', 64))$$, pg_temp.id('A'), pg_temp.id('ov_item'))), 'OK 1', 'D4: the owner opens version 2 of an approved item');
select matches(pg_temp.try(format($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256) values (%L, %L, 'mcq', '[synthetic] Version three', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, repeat('e', 64))$$, pg_temp.id('A'), pg_temp.id('ov_item'))), '^23505', 'D4: a second open version of the same item is refused');
select pg_temp.op();
select matches(pg_temp.try(format($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256) values (%L, %L, 'mcq', '[synthetic] Version three', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, repeat('e', 64))$$, pg_temp.id('A'), pg_temp.id('ov_item'))), '^23505', 'D4: the operator path is refused the same way');
select is((select count(*)::int from public.item_versions where item_id = pg_temp.id('ov_item') and status in ('draft', 'in_review')), 1, 'D4: the item has exactly one open version');
select is((select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'item_versions' and indexname = 'item_versions_one_open_per_item' and indexdef like '%UNIQUE%'), 1, 'D4: the rule is a partial unique index');

-- ===== D7: the bank list keyset (created_at desc, id desc) of bank rows has an index =====
select is((select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'item_versions' and indexname = 'item_versions_bank_page_idx' and indexdef like '%(org_id, created_at DESC, id DESC)%' and indexdef like '%section_id IS NULL%'), 1, 'D7: item_versions_bank_page_idx serves the bank list keyset');

-- ===== D2: per-pool counts in one read (v_pool_item_counts, security_invoker) =====
select is((select c.reloptions::text from pg_class as c join pg_namespace as n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'v_pool_item_counts'), '{security_invoker=true}', 'D2: v_pool_item_counts is a security_invoker view');
select is(has_table_privilege('authenticated', 'public.v_pool_item_counts', 'SELECT'), true, 'D2: authenticated may select the counts');
select is(has_table_privilege('authenticated', 'public.v_pool_item_counts', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false, 'D2: the counts are read-only');
select is(has_table_privilege('anon', 'public.v_pool_item_counts', 'SELECT') or has_table_privilege('service_role', 'public.v_pool_item_counts', 'SELECT') or has_table_privilege('trace_candidate', 'public.v_pool_item_counts', 'SELECT'), false, 'D2: anon, service_role and trace_candidate hold nothing on the counts');
select pg_temp.u('owner');
select is((select string_agg(pool_id::text || '=' || item_count || '/' || approved_count, ',' order by pool_id) from public.v_pool_item_counts), 'd9000000-0000-4000-8000-000000000001=3/2', 'D2: the owner reads its pool: 3 items, 2 approved (the retired one stays and stops counting, E3); an empty pool has no row');
select pg_temp.u('recruiter');
select is((select item_count || '/' || approved_count from public.v_pool_item_counts where pool_id = 'd9000000-0000-4000-8000-000000000001'), '3/2', 'D2: a recruiter of workspace A1 reads the same counts');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.v_pool_item_counts), 0, 'D2: a workspace A2 recruiter reads no workspace A1 counts (fence)');
select pg_temp.u('hm');
select is((select count(*)::int from public.v_pool_item_counts), 0, 'D2: a hiring manager reads no counts');
select pg_temp.u('b_admin');
select is((select string_agg(pool_id::text || '=' || item_count || '/' || approved_count, ',') from public.v_pool_item_counts), 'd9000000-0000-4000-8000-000000000003=1/1', 'D2: org B admin reads only org B counts (cross-org)');
select pg_temp.u('outsider');
select is((select count(*)::int from public.v_pool_item_counts), 0, 'D2: a user with no membership reads no counts');
