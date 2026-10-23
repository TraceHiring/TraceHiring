-- rls_m1_snapshot (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_snapshot; §3.2 section_pool_snapshot; §3.4 publish guard v2 and private.assert_drive_pool_ratio; §3.5; AT-M1-12; R2-8, R3-1, R3-2, R3-3, R5-33). RED first: written from the spec before migration M1-b. Personas and items are synthetic.
-- Fixtures (operator path): approved MCQ bank items v1..v10 and w1..w100 in workspace A1; pools PA = v1..v10,
-- PB = w1..w99, PC = w1..w100, PD = {v1, w1} (overlaps PA); org B pool PBB = 10 items.
select pg_temp.bank('v' || n, pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved') from generate_series(1, 10) as n;
select pg_temp.bank('w' || n, pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved') from generate_series(1, 100) as n;
select pg_temp.bank('bv' || n, pg_temp.id('B'), pg_temp.id('BW'), 'mcq', 'verbal', 0.50, 'approved') from generate_series(1, 10) as n;
insert into public.pools (id, org_id, workspace_id, name, format) values
  ('d1000000-0000-4000-8000-00000000000a', pg_temp.id('A'), pg_temp.id('A1'), 'Pool A', 'mcq'),
  ('d1000000-0000-4000-8000-00000000000b', pg_temp.id('A'), pg_temp.id('A1'), 'Pool B', 'mcq'),
  ('d1000000-0000-4000-8000-00000000000c', pg_temp.id('A'), pg_temp.id('A1'), 'Pool C', 'mcq'),
  ('d1000000-0000-4000-8000-00000000000d', pg_temp.id('A'), pg_temp.id('A1'), 'Pool D', 'mcq'),
  ('d1000000-0000-4000-8000-0000000000bb', pg_temp.id('B'), pg_temp.id('BW'), 'Pool BB', 'mcq');
insert into public.pool_items (org_id, pool_id, item_version_id)
  select pg_temp.id('A'), 'd1000000-0000-4000-8000-00000000000a'::uuid, pg_temp.id('v' || n) from generate_series(1, 10) as n
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-00000000000b'::uuid, pg_temp.id('w' || n) from generate_series(1, 99) as n
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-00000000000c'::uuid, pg_temp.id('w' || n) from generate_series(1, 100) as n
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-00000000000d'::uuid, pg_temp.id('v1')
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-00000000000d'::uuid, pg_temp.id('w1');
insert into public.pool_items (org_id, pool_id, item_version_id)
  select pg_temp.id('B'), 'd1000000-0000-4000-8000-0000000000bb'::uuid, pg_temp.id('bv' || n) from generate_series(1, 10) as n;
-- Versions: ta = PA draw 1 (10x); tb = PB draw 10 (9.9x); tc = PC draw 10 (10x); td = one inline section; te = PA draw
-- 1 + an inline section; tf = PA and PD (overlap); tg = a D1-style v1 version (inline, no settings, no M1 column);
-- tbb = org B, PBB draw 1.
select pg_temp.tv('ta', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sa', 'ta', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000a', 1, 100);
select pg_temp.preset('ta', 'standard');
select pg_temp.tv('tb', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sb', 'tb', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000b', 10, 100);
select pg_temp.preset('tb', 'standard');
select pg_temp.tv('tc', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sc', 'tc', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000c', 10, 100);
select pg_temp.preset('tc', 'standard');
select pg_temp.tv('td', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sd', 'td', 1, 'mcq', null, null, 100);
select pg_temp.inline('id1', 'sd');
select pg_temp.preset('td', 'standard');
select pg_temp.tv('te', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('se1', 'te', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000a', 1, 50);
select pg_temp.sec('se2', 'te', 2, 'mcq', null, null, 50);
select pg_temp.inline('ie1', 'se2');
select pg_temp.preset('te', 'standard');
select pg_temp.tv('tf', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sf1', 'tf', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000a', 1, 50);
select pg_temp.sec('sf2', 'tf', 2, 'mcq', 'd1000000-0000-4000-8000-00000000000d', 1, 50);
select pg_temp.preset('tf', 'standard');
select pg_temp.tv('tg', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-0000000000a7', pg_temp.id('A'), pg_temp.id('tg'), 1, 'Choices', 'mcq', 1);
insert into pg_temp.ids values ('sg', '51000000-0000-4000-8000-0000000000a7');
select pg_temp.inline('ig1', 'sg');
select pg_temp.tv('tbb', pg_temp.id('B'), pg_temp.id('BW'));
select pg_temp.sec('sbb', 'tbb', 1, 'mcq', 'd1000000-0000-4000-8000-0000000000bb', 1, 100);
select pg_temp.preset('tbb', 'standard');
-- The assigned reviewer persona is assigned to test ta.
insert into public.assignments (org_id, membership_id, scope, test_id, as_role)
  select m.org_id, m.id, 'test', pg_temp.id('ta_test'), 'reviewer'
  from public.memberships as m where m.org_id = pg_temp.id('A') and m.user_id = pg_temp.id('reviewer');

-- ===== Publish writes the snapshot (R3-2) and the ratio (AT-M1-12) =====
select is(pg_temp.try($$select pg_temp.publish('ta')$$), 'OK 1', 'publish: a pool version (10 approved items, draw 1) publishes');
select is((select count(*)::int from public.section_pool_snapshot where section_id = pg_temp.id('sa')), 10, 'snapshot: the pool section holds its 10 approved pool items');
select is((select bool_and(test_version_id = pg_temp.id('ta') and test_id = pg_temp.id('ta_test') and workspace_id = pg_temp.id('A1') and exposure_at_publish = 0) from public.section_pool_snapshot where section_id = pg_temp.id('sa')), true, 'snapshot: rows carry the version, test, workspace and the frozen exposure (0 here)');
select is((select min_pool_ratio::text || '|' || package_version::text from public.test_versions where id = pg_temp.id('ta')), '10.00|2', 'publish: min_pool_ratio 10.00, package version 2');
select is(pg_temp.try($$select pg_temp.publish('tb')$$), 'OK 1', 'publish: a 9.9x pool version publishes (the 10x rule is for drives)');
select is((select min_pool_ratio::text from public.test_versions where id = pg_temp.id('tb')), '9.90', 'publish: min_pool_ratio 9.90');
select is(pg_temp.try($$select pg_temp.publish('tc')$$), 'OK 1', 'publish: a 10x pool version (100 items, draw 10) publishes');
select is(pg_temp.try($$select pg_temp.publish('td')$$), 'OK 1', 'publish: an inline-only v2 version publishes');
select is((select count(*)::int || '|' || bool_and(item_version_id = pg_temp.id('id1'))::text from public.section_pool_snapshot where test_version_id = pg_temp.id('td')), '1|true', 'snapshot: an inline section snapshots its own items');
select is((select coalesce(min_pool_ratio::text, 'null') || '|' || package_version::text from public.test_versions where id = pg_temp.id('td')), 'null|2', 'publish: no drawing section, so min_pool_ratio is null');
select is(pg_temp.try($$select pg_temp.publish('te')$$), 'OK 1', 'publish: a pool section and an inline section publish together');
select is(pg_temp.try($$select pg_temp.publish('tg')$$), 'OK 1', 'publish (R3-1, AT-M1-28): a D1-style version without settings publishes as D1');
select is((select package_version::text || '|' || coalesce(min_pool_ratio::text, 'null') || '|' || (select count(*) from public.section_pool_snapshot where test_version_id = pg_temp.id('tg'))::text from public.test_versions where id = pg_temp.id('tg')), '1|null|0', 'publish (R3-1): a v1 version has package 1, no ratio and no snapshot');
-- R3-3: an item may be drawn by only one section of a version.
select matches(pg_temp.try($$select pg_temp.publish('tf')$$), '^42501 TRACE_GUARD: an item may appear in only one section', 'publish (R3-3): overlapping pools in two sections are refused');
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('tf')), 0, 'publish (R3-3): a refused publish writes no snapshot');
select is(pg_temp.try($$select pg_temp.publish('tbb')$$), 'OK 1', 'publish: an org B pool version publishes');

-- ===== private.assert_drive_pool_ratio (AT-M1-12; called by M2's drive trigger) =====
select is(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('ta'))), 'OK 1', 'pool ratio: 10x (10 items, draw 1) passes');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('tb'))), '^42501 TRACE_GUARD: pool must be at least 10x the draw for drives', 'pool ratio: 9.9x raises');
select is(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('tc'))), 'OK 1', 'pool ratio: 10x (100 items, draw 10) passes');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('td'))), '^42501 TRACE_GUARD: pool must be at least 10x the draw for drives', 'pool ratio: an inline-only version raises');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('te'))), '^42501 TRACE_GUARD: pool must be at least 10x the draw for drives', 'pool ratio: an inline section next to a 10x pool section still raises');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('tg'))), '^42501 TRACE_GUARD: pool must be at least 10x the draw for drives', 'pool ratio: a D1 v1 version raises (inline)');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('tf'))), '^23503 TRACE_GUARD: published test version not found', 'pool ratio: a draft version is not found');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('B'), pg_temp.id('ta'))), '^23503 TRACE_GUARD: published test version not found', 'pool ratio: another org''s version is not found');
select pg_temp.u('owner');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('ta'))), '^42501 permission denied', 'pool ratio: no app role may call it');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('ta'))), '^42501 permission denied', 'pool ratio: trace_api may not call it');
select pg_temp.op();

-- ===== section_pool_snapshot: S =====
select pg_temp.u('owner');
select is((select count(*)::int from public.section_pool_snapshot), 10 + 99 + 100 + 1 + 10 + 1, 'snapshot S: owner sees every org A snapshot row');
select pg_temp.u('recruiter');
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('ta')), 10, 'snapshot S: recruiter sees the workspace A1 rows');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.section_pool_snapshot), 0, 'snapshot S: workspace A2 recruiter sees no workspace A1 row');
select pg_temp.u('reviewer');
select is((select count(*)::int || '|' || bool_and(test_id = pg_temp.id('ta_test'))::text from public.section_pool_snapshot), '10|true', 'snapshot S: the reviewer sees the rows of the assigned test only');
select pg_temp.u('ws_reviewer');
select is((select count(*)::int from public.section_pool_snapshot), 0, 'snapshot S: an unassigned reviewer sees nothing');
select pg_temp.u('hm');
select is((select count(*)::int from public.section_pool_snapshot), 0, 'snapshot S: hiring manager sees nothing');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.section_pool_snapshot where org_id = pg_temp.id('A')), 0, 'snapshot S: org B admin sees no org A row');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('ta')), 10, 'snapshot S: the quality worker reads its job org''s snapshot');
select is((select count(*)::int from public.section_pool_snapshot where org_id = pg_temp.id('B')), 0, 'snapshot S: the quality worker bound to org A reads nothing of org B');
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.section_pool_snapshot'), '^42501 permission denied', 'snapshot S: trace_worker has no grant');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.section_pool_snapshot'), '^42501 permission denied', 'snapshot S: trace_api has no grant');
select pg_temp.op();

-- ===== section_pool_snapshot: I / U / D (I-M1-2: written by publish only, immutable for every role) =====
select pg_temp.u('owner');
select matches(pg_temp.try(format($$insert into public.section_pool_snapshot (org_id, section_id, item_version_id, workspace_id, test_id, test_version_id, exposure_at_publish) values (%L, %L, %L, %L, %L, %L, 0)$$, pg_temp.id('A'), pg_temp.id('sa'), pg_temp.id('w1'), pg_temp.id('A1'), pg_temp.id('ta_test'), pg_temp.id('ta'))), '^42501 permission denied', 'snapshot I: owner has no insert grant');
select matches(pg_temp.try('update public.section_pool_snapshot set exposure_at_publish = 5'), '^42501 permission denied', 'snapshot U: owner has no update grant');
select matches(pg_temp.try('delete from public.section_pool_snapshot'), '^42501 permission denied', 'snapshot D: owner has no delete grant');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select matches(pg_temp.try('update public.section_pool_snapshot set exposure_at_publish = 5'), '^42501 permission denied', 'snapshot U: the quality worker has no update grant');
select pg_temp.op();
select matches(pg_temp.try(format($$insert into public.section_pool_snapshot (org_id, section_id, item_version_id, workspace_id, test_id, test_version_id, exposure_at_publish) values (%L, %L, %L, %L, %L, %L, 0)$$, pg_temp.id('A'), pg_temp.id('sa'), pg_temp.id('w1'), pg_temp.id('A1'), pg_temp.id('ta_test'), pg_temp.id('ta'))), '^42501 TRACE_GUARD: the snapshot is written by publish only and is immutable', 'snapshot I: the operator cannot add a row outside publish');
select matches(pg_temp.try('update public.section_pool_snapshot set exposure_at_publish = 5'), '^42501 TRACE_GUARD: the snapshot is written by publish only and is immutable', 'snapshot U: the operator cannot change a row');
select matches(pg_temp.try('delete from public.section_pool_snapshot'), '^42501 TRACE_GUARD: the snapshot is written by publish only and is immutable', 'snapshot D: the operator cannot delete a row');
select matches(pg_temp.try('truncate public.section_pool_snapshot'), '^42501 TRACE_GUARD: the snapshot is written by publish only and is immutable', 'snapshot TRUNCATE: refused for the operator');
select is((select count(*)::int from public.section_pool_snapshot), 10 + 99 + 100 + 1 + 10 + 1 + 10, 'snapshot: every published row is still there');

-- ===== Later pool changes never touch a published snapshot (E3) =====
select pg_temp.u('owner');
select is(pg_temp.try(format($$delete from public.pool_items where pool_id = 'd1000000-0000-4000-8000-00000000000a' and item_version_id = %L$$, pg_temp.id('v2'))), 'OK 1', 'E3: an item leaves pool A after publish');
select is(pg_temp.try(format($$update public.item_versions set status = 'retired' where id = %L$$, pg_temp.id('v3'))), 'OK 1', 'E3: a snapshotted item is retired after publish');
select pg_temp.op();
select is((select count(*)::int from public.section_pool_snapshot where section_id = pg_temp.id('sa')), 10, 'E3: the published snapshot keeps all 10 items');
select is((select min_pool_ratio::text from public.test_versions where id = pg_temp.id('ta')), '10.00', 'E3: the published ratio is unchanged');
select matches(pg_temp.try(format($$select private.assert_drive_pool_ratio(%L, %L)$$, pg_temp.id('A'), pg_temp.id('ta'))), '^OK', 'E3: the drive check reads the frozen snapshot, so ta still passes');

-- ===== E22 (DB-M1-12): a version holds at most 5,000 items, which also bounds min_pool_ratio =====
-- Pool PH = 5,001 approved written items in workspace A1 (operator path); version th draws 1 from it.
select pg_temp.op();
create temp table huge_src as select gen_random_uuid() as item, gen_random_uuid() as ver, n from generate_series(1, 5001) as n;
insert into public.items (id, org_id, workspace_id, format, skill_key, created_by)
  select item, pg_temp.id('A'), pg_temp.id('A1'), 'written', 'written_communication', pg_temp.id('owner') from huge_src;
insert into public.item_versions (id, org_id, item_id, format, stem, rubric_version_id, skill_key, difficulty, content_sha256, created_by)
  select ver, pg_temp.id('A'), item, 'written', '[synthetic] Huge ' || n, (select r.id from public.rubric_versions as r where r.org_id = pg_temp.id('A') and r.rubric_key = 'default'), 'written_communication', 0.50, repeat('e', 64), pg_temp.id('owner') from huge_src;
update public.item_versions set status = 'in_review' where id in (select ver from huge_src);
update public.item_versions set status = 'approved', approved_by = pg_temp.id('owner') where id in (select ver from huge_src);
insert into public.pools (id, org_id, workspace_id, name, format) values
  ('d1000000-0000-4000-8000-0000000000ee', pg_temp.id('A'), pg_temp.id('A1'), 'Pool huge', 'written');
insert into public.pool_items (org_id, pool_id, item_version_id)
  select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000ee'::uuid, ver from huge_src;
select pg_temp.tv('th', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sh', 'th', 1, 'written', 'd1000000-0000-4000-8000-0000000000ee', 1, 100);
select pg_temp.preset('th', 'standard');
select matches(pg_temp.try($$select pg_temp.publish('th')$$), '^42501 TRACE_GUARD: a version holds at most 5,000 items', 'publish (E22, DB-M1-12): a snapshot of more than 5,000 items is refused');
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('th')), 0, 'publish (E22): the refused publish wrote no snapshot');
delete from public.pool_items where pool_id = 'd1000000-0000-4000-8000-0000000000ee' and item_version_id = (select ver from huge_src where n = 5001);
select is(pg_temp.try($$select pg_temp.publish('th')$$), 'OK 1', 'publish (E22): exactly 5,000 items publish');
select is((select min_pool_ratio::text from public.test_versions where id = pg_temp.id('th')), '5000.00', 'publish (E22): min_pool_ratio stays within numeric(6, 2)');

-- ===== Publish race (R5-56 d, migration M1-e): the guard recomputes the digest of the snapshot it writes =====
select pg_temp.op();
select is(private.snapshot_digest_of(array['d2000000-0000-4000-8000-00000000000b:d3000000-0000-4000-8000-000000000002:7', 'd2000000-0000-4000-8000-00000000000a:d3000000-0000-4000-8000-000000000001:0', 'd2000000-0000-4000-8000-00000000000a:d3000000-0000-4000-8000-000000000003:12']), 'e905567988cc26439a5c547f68097ce1e4917bf36d1355d7ab70f46f4abed28b', 'digest: the SQL digest equals @trace/shared snapshotDigest on the pinned vector (item-hash.test.ts)');
select is((select snapshot_digest from public.test_versions where id = pg_temp.id('ta')), (select private.snapshot_digest_of(array_agg(sp.section_id::text || ':' || sp.item_version_id::text || ':' || sp.exposure_at_publish::text)) from public.section_pool_snapshot as sp where sp.test_version_id = pg_temp.id('ta')), 'digest: a published v2 version stores the digest of its snapshot');
select is((select snapshot_digest is null from public.test_versions where id = pg_temp.id('tg')), true, 'digest: a v1 version stores none (it has no snapshot), even when one is sent');
select pg_temp.tv('tk', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sk', 'tk', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000a', 1, 100);
select pg_temp.preset('tk', 'standard');
select matches(pg_temp.try($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id = pg_temp.id('tk')$$), '^42501 TRACE_GUARD: publish needs the snapshot digest', 'digest: a v2 publish without a digest is refused');
select matches(pg_temp.try($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64), snapshot_digest = repeat('0', 64) where id = pg_temp.id('tk')$$), '^40001 TRACE_GUARD: the package was built from another snapshot', 'digest: a digest of other rows is refused with 40001 (the api rebuilds and retries)');
select is((select count(*)::int || '|' || (select status::text from public.test_versions where id = pg_temp.id('tk')) from public.section_pool_snapshot where test_version_id = pg_temp.id('tk')), '0|draft', 'digest: a refused publish writes no snapshot and leaves the draft');
create temp table stale_digest as select pg_temp.live_digest('tk') as d;
delete from public.pool_items where pool_id = 'd1000000-0000-4000-8000-00000000000a' and item_version_id = pg_temp.id('v4');
select matches(pg_temp.try(format($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64), snapshot_digest = %L where id = %L$$, (select d from stale_digest), pg_temp.id('tk'))), '^40001 TRACE_GUARD: the package was built from another snapshot', 'digest: a package built before a pool change is refused (A1 DB review Medium, R3-2)');
select is(pg_temp.try($$select pg_temp.publish('tk')$$), 'OK 1', 'digest: rebuilt from the live pool, the publish passes');
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('tk')), 7, 'digest: the snapshot holds the 7 approved items left in pool A');
select matches(pg_temp.try($$update public.test_versions set status = 'retired', snapshot_digest = repeat('1', 64) where id = pg_temp.id('tk')$$), '^42501 TRACE_GUARD: a published test version is frozen', 'digest: the digest freezes with the version');
select pg_temp.tv('tl', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sl', 'tl', 1, 'mcq', 'd1000000-0000-4000-8000-00000000000c', 1, 100);
select pg_temp.preset('tl', 'standard');
select pg_temp.u('owner');
select is(pg_temp.try($$update public.test_versions set snapshot_digest = repeat('2', 64) where id = pg_temp.id('tl')$$), 'OK 1', 'digest: a draft update may name the column (the owner holds its update grant)');
select is((select snapshot_digest is null from public.test_versions where id = pg_temp.id('tl')), true, 'digest: a draft keeps none (only the publish update carries it)');
select is(pg_temp.try($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64), snapshot_digest = pg_temp.live_digest('tl') where id = pg_temp.id('tl')$$), 'OK 1', 'digest: the owner publishes a v2 version with its digest');
select pg_temp.op();
