-- rls_m1_pools (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_pools; §3.2 pools, pool_items; §3.5; R2-9, R5-26; E3). RED first: written from the spec before migration M1-a. Personas and items are synthetic.
select pg_temp.bank('a1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('a2', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('aw', pg_temp.id('A'), pg_temp.id('A1'), 'written', 'written_communication', 0.50, 'approved');
select pg_temp.bank('ad', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'draft');
select pg_temp.bank('ar', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'in_review');
select pg_temp.bank('ax', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'retired');
select pg_temp.bank('b2', pg_temp.id('A'), pg_temp.id('A2'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('bb', pg_temp.id('B'), pg_temp.id('BW'), 'mcq', 'verbal', 0.50, 'approved');
insert into public.tests (id, org_id, workspace_id, name, created_by) values
  ('e1000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), 'Test One', pg_temp.id('owner'));
insert into public.test_versions (id, org_id, test_id, total_time_seconds, quality_cutoff, created_by) values
  ('f1000000-0000-4000-8000-000000000001', pg_temp.id('A'), 'e1000000-0000-4000-8000-000000000001', 1800, 40, pg_temp.id('owner'));
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-000000000001', pg_temp.id('A'), 'f1000000-0000-4000-8000-000000000001', 1, 'Choices', 'mcq', 1);
insert into public.item_versions (id, org_id, section_id, format, position, stem, options, content_sha256) values
  ('61000000-0000-4000-8000-000000000001', pg_temp.id('A'), '51000000-0000-4000-8000-000000000001', 'mcq', 1, '[synthetic] Inline', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', repeat('c', 64));

-- ===== pools: I =====
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.pools (id, org_id, workspace_id, name, format, skill_key) values ('d1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Verbal pool', 'mcq', 'verbal')$$), 'OK 1', 'pools I: owner creates an MCQ pool in workspace A1');
select matches(pg_temp.try($$insert into public.pools (org_id, workspace_id, name, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Bad', 'mcq', 'astrology')$$), '^23503 TRACE_GUARD: skill not found', 'pools I: a pool skill comes from the taxonomy');
select matches(pg_temp.try($$insert into public.pools (org_id, workspace_id, name, format, status) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Bad', 'mcq', 'archived')$$), '^42501 permission denied', 'pools I: status is outside the insert grant (a pool starts active)');
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into public.pools (id, org_id, workspace_id, name, format) values ('d1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Written pool', 'written')$$), 'OK 1', 'pools I: recruiter creates a written pool');
select pg_temp.u('ws_recruiter');
select is(pg_temp.try($$insert into public.pools (id, org_id, workspace_id, name, format) values ('d1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'A2 pool', 'mcq')$$), 'OK 1', 'pools I: workspace recruiter creates a pool in workspace A2');
select matches(pg_temp.try($$insert into public.pools (org_id, workspace_id, name, format) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Fence', 'mcq')$$), '^42501', 'pools I: workspace recruiter cannot create a pool in workspace A1');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$insert into public.pools (org_id, workspace_id, name, format) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Reviewer', 'mcq')$$), '^42501', 'pools I: reviewer cannot create a pool');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.pools (org_id, workspace_id, name, format) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Cross', 'mcq')$$), '^42501', 'pools I: org B admin cannot create a pool in org A');
select pg_temp.u('hm');
select matches(pg_temp.try($$insert into public.pools (org_id, workspace_id, name, format) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Hm', 'mcq')$$), '^42501', 'pools I: hiring manager cannot create a pool');

-- ===== pools: S =====
select pg_temp.u('owner');
select is((select count(*)::int from public.pools), 3, 'pools S: owner sees the three org A pools');
select pg_temp.u('ws_recruiter');
select is((select array_agg(name) from public.pools), array['A2 pool'], 'pools S: workspace recruiter sees only the workspace A2 pool');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.pools), 0, 'pools S: reviewer sees no pool (matrix OW AD RC)');
select pg_temp.u('hm');
select is((select count(*)::int from public.pools), 0, 'pools S: hiring manager sees no pool');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.pools where org_id = pg_temp.id('A')), 0, 'pools S: org B admin sees no org A pool');

-- ===== pool_items: I (approved bank items of the pool's format, same workspace) =====
select pg_temp.u('owner');
select is(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values ('a1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', %L)$$, pg_temp.id('a1'))), 'OK 1', 'pool_items I: an approved MCQ item joins the MCQ pool');
select is(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values ('a1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', %L)$$, pg_temp.id('a2'))), 'OK 1', 'pool_items I: a second approved item joins');
select matches(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values ('a1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', %L)$$, pg_temp.id('ad'))), '^42501 TRACE_GUARD: a pool holds approved bank items of its format', 'pool_items I: a draft cannot join');
select matches(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values ('a1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', %L)$$, pg_temp.id('ar'))), '^42501 TRACE_GUARD: a pool holds approved bank items of its format', 'pool_items I: an in-review item cannot join');
select matches(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values ('a1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', %L)$$, pg_temp.id('ax'))), '^42501 TRACE_GUARD: a pool holds approved bank items of its format', 'pool_items I: a retired item cannot join');
select matches(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values ('a1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', %L)$$, pg_temp.id('aw'))), '^42501 TRACE_GUARD: a pool holds approved bank items of its format', 'pool_items I: a written item cannot join an MCQ pool');
select matches(pg_temp.try($$insert into public.pool_items (org_id, pool_id, item_version_id) values ('a1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001')$$), '^42501 TRACE_GUARD: a pool holds approved bank items of its format', 'pool_items I: an inline test item cannot join a pool');
select matches(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values ('a1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', %L)$$, pg_temp.id('b2'))), '^23503', 'pool_items I: a workspace A2 item cannot join a workspace A1 pool (fence-preserving key, R2-9)');
select matches(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values ('a1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', %L)$$, pg_temp.id('bb'))), '^23503', 'pool_items I: an org B item cannot join an org A pool');
select is(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values ('a1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', %L)$$, pg_temp.id('aw'))), 'OK 1', 'pool_items I: a written item joins the written pool');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values ('a1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', %L)$$, pg_temp.id('a1'))), '^42501', 'pool_items I: workspace recruiter cannot add to a workspace A1 pool');
select is(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values ('a1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003', %L)$$, pg_temp.id('b2'))), 'OK 1', 'pool_items I: workspace recruiter adds a workspace A2 item to the A2 pool');
select pg_temp.u('reviewer');
select matches(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values ('a1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', %L)$$, pg_temp.id('a1'))), '^42501', 'pool_items I: reviewer cannot add pool items');
select pg_temp.op();
select is((select workspace_id from public.pool_items where pool_id = 'd1000000-0000-4000-8000-000000000003'), pg_temp.id('A2'), 'pool_items I: the workspace comes from the pool');

-- ===== pool_items: S / U / D =====
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.pool_items), 1, 'pool_items S: workspace recruiter sees only the workspace A2 pool items');
select pg_temp.u('hm');
select is((select count(*)::int from public.pool_items), 0, 'pool_items S: hiring manager sees nothing');
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.pool_items set item_version_id = item_version_id$$), '^42501 permission denied', 'pool_items U: no update grant');
select pg_temp.op();
select matches(pg_temp.try($$update public.pool_items set added_at = now()$$), '^42501 TRACE_GUARD: pool items are added or removed, never changed', 'pool_items U: never changed, even on the operator path');
select pg_temp.u('reviewer');
select is(pg_temp.try($$delete from public.pool_items$$), 'OK 0', 'pool_items D: reviewer removes nothing');
select pg_temp.u('owner');
select is(pg_temp.try(format($$delete from public.pool_items where item_version_id = %L$$, pg_temp.id('a2'))), 'OK 1', 'pool_items D: owner removes an item from a pool');
-- E3: an item retired after joining a pool stays in the pool row (the snapshot decides what a test serves).
select is(pg_temp.try(format($$update public.item_versions set status = 'retired' where id = %L$$, pg_temp.id('a1'))), 'OK 1', 'E3: a pooled item can be retired');
select is((select count(*)::int from public.pool_items where item_version_id = pg_temp.id('a1')), 1, 'E3: the pool row stays');

-- ===== pools: U (archive, R5-26) =====
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.pools set name = 'Verbal pool renamed' where id = 'd1000000-0000-4000-8000-000000000001'$$), 'OK 1', 'pools U: recruiter renames a pool');
select matches(pg_temp.try($$update public.pools set format = 'written' where id = 'd1000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'pools U: format is outside the update grant');
select is(pg_temp.try($$update public.pools set status = 'archived' where id = 'd1000000-0000-4000-8000-000000000001'$$), 'OK 1', 'pools U: recruiter archives a pool');
select pg_temp.op();
select is((select pg_temp.keys(details) || '|' || (details ->> 'pool_id') from public.audit_log where action = 'pool.archive' and object_id = 'd1000000-0000-4000-8000-000000000001'), 'pool_id|d1000000-0000-4000-8000-000000000001', 'pools event: pool.archive carries the pool id only');
select pg_temp.u('owner');
select matches(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values ('a1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', %L)$$, pg_temp.id('a2'))), '^42501 TRACE_GUARD: an archived pool takes no items', 'pools U: an archived pool takes no items');
select pg_temp.u('ws_recruiter');
select is(pg_temp.try($$update public.pools set name = 'x' where id = 'd1000000-0000-4000-8000-000000000002'$$), 'OK 0', 'pools U: workspace recruiter cannot rename a workspace A1 pool');
select pg_temp.u('owner');
select matches(pg_temp.try($$delete from public.pools where id = 'd1000000-0000-4000-8000-000000000002'$$), '^42501 permission denied', 'pools D: pools are archived, never deleted');
select pg_temp.op();
set local role trace_candidate;
select matches(pg_temp.try('select * from public.pools'), '^42501 permission denied', 'pools S: trace_candidate has no privilege');
select pg_temp.op();
