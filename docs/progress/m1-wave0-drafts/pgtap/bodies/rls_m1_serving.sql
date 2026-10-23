-- rls_m1_serving (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_serving; §3.3 session_items; §3.4; M1-6; AT-M1-03, AT-M1-08 (serving half), AT-M1-21 (db case), AT-M1-28; I-M1-1, I-M1-8; R2-1, R2-7, R2-16, R3-2, R5-19, R5-36, R5-39 a, R5-41, R5-42, R5-43; E28). RED first: written from the spec before migration M1-b. Personas, items and sessions are synthetic.
-- Fixtures (operator path): pool P (mcq, workspace A1) = approved s1..s8, the parameterised pq (two variants) and cp1, a
-- copy of the library item lib1; s9 is approved but in no pool; ai1 is an AI draft in review. Version v2 (Standard):
-- section sp draws 3 from P, section si is inline with ii1. Version v1: D1-style inline section with iv1.
select pg_temp.bank('s' || n, pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved') from generate_series(1, 9) as n;
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
   '[synthetic] What is 3 + 1?', '[{"id": "o1", "text": "4"}, {"id": "o2", "text": "3"}]', 0.50, repeat('c', 64)),
  ('c2200000-0000-4000-8000-000000000002', pg_temp.id('A'), 'c2100000-0000-4000-8000-000000000001', 2, '{"a": 5}',
   '[synthetic] What is 5 + 1?', '[{"id": "o1", "text": "6"}, {"id": "o2", "text": "5"}]', 0.55, repeat('c', 64));
insert into public.item_variant_keys (org_id, item_variant_id, key) values
  (pg_temp.id('A'), 'c2200000-0000-4000-8000-000000000001', '{"option_id": "o1"}'),
  (pg_temp.id('A'), 'c2200000-0000-4000-8000-000000000002', '{"option_id": "o1"}');
update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000001';
update public.item_versions set status = 'approved', approved_by = pg_temp.id('owner') where id = 'c2100000-0000-4000-8000-000000000001';
insert into pg_temp.ids values ('pq', 'c2100000-0000-4000-8000-000000000001'), ('pq_item', 'c2000000-0000-4000-8000-000000000001'),
  ('pqv1', 'c2200000-0000-4000-8000-000000000001'), ('pqv2', 'c2200000-0000-4000-8000-000000000002');
select pg_temp.ai_draft('ai1', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.u('owner');
insert into public.library_copy_requests (id, org_id, workspace_id, library_item_version_ids) values
  ('e5000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), array[pg_temp.id('lib1')]);
select pg_temp.op();
insert into pg_temp.ids select 'cp1', result_item_version_ids[1] from public.library_copy_requests where id = 'e5000000-0000-4000-8000-000000000001';
insert into public.pools (id, org_id, workspace_id, name, format) values
  ('d1000000-0000-4000-8000-0000000000e1', pg_temp.id('A'), pg_temp.id('A1'), 'Serving pool', 'mcq');
insert into public.pool_items (org_id, pool_id, item_version_id)
  select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000e1'::uuid, pg_temp.id(k)
  from unnest(array['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 'pq', 'cp1']) as k;
select pg_temp.tv('v2', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sp', 'v2', 1, 'mcq', 'd1000000-0000-4000-8000-0000000000e1', 3, 50);
select pg_temp.sec('si', 'v2', 2, 'mcq', null, null, 50);
select pg_temp.inline('ii1', 'si');
select pg_temp.preset('v2', 'standard');
select pg_temp.publish('v2');
select pg_temp.tv('v1', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-0000000000d1', pg_temp.id('A'), pg_temp.id('v1'), 1, 'Choices', 'mcq', 1);
insert into pg_temp.ids values ('sv1', '51000000-0000-4000-8000-0000000000d1');
select pg_temp.inline('iv1', 'sv1');
select pg_temp.publish('v1');
select pg_temp.session('a', 'v2', 11);
select pg_temp.session('b', 'v2', 12);
select pg_temp.session('d', 'v2', 14);
select pg_temp.session('c', 'v1', 13);
-- si(key, session, section, item, position, served, variant, option order): one session_items insert as the mirror
-- (trace_worker bound to org A); returns try()'s result. Records <key> = the row id.
create function pg_temp.si(p_key text, p_sess text, p_sec text, p_item text, p_pos int, p_served boolean,
  p_variant text default null, p_order jsonb default null) returns text language plpgsql as $f$
declare v_id uuid := gen_random_uuid(); v_r text;
begin
  perform pg_temp.w('trace_worker', pg_temp.id('A'));
  v_r := pg_temp.try(format($s$insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at, item_variant_id, option_order) values (%L, %L, %L, %L, %L, %s, %s, %L, %L)$s$,
    v_id, pg_temp.id('A'), pg_temp.id(p_sess), pg_temp.id(p_sec), pg_temp.id(p_item), p_pos,
    case when p_served then '''2026-10-14 10:05:00+00''' else 'null' end,
    case when p_variant is null then null else pg_temp.id(p_variant) end, p_order));
  perform pg_temp.op();
  if v_r like 'OK%' then
    insert into pg_temp.ids values (p_key, v_id);
  end if;
  return v_r;
end
$f$;

-- ===== AT-M1-08 (exit gate): an unapproved AI draft is never served, nor stored as drawn =====
select matches(pg_temp.si('x1', 'a', 'sp', 'ai1', 1, true), '^42501 TRACE_GUARD: unapproved item cannot be served$', 'AT-M1-08: the mirror cannot serve an AI draft without its approver (session_items_a_ai_gate)');
select matches(pg_temp.si('x2', 'a', 'sp', 'ai1', 1, false), '^42501 TRACE_GUARD: unapproved item cannot be served$', 'AT-M1-08 (R5-43): nor store it as drawn but unserved');
select is((select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.session_items'::regclass and not tgisinternal and tgtype & 2 = 2), 'session_items_a_ai_gate,session_items_guard', 'AT-M1-08 (R2-16): the gate is the first BEFORE trigger by name');
select is((select tgenabled::text from pg_trigger where tgrelid = 'public.session_items'::regclass and tgname = 'session_items_a_ai_gate'), 'A', 'AT-M1-08: the gate is ENABLE ALWAYS');

-- ===== Package v2: snapshot membership, draws, variants, option order (R2-1, R5-19, R5-39 a, R5-43) =====
select is(pg_temp.si('a_s1', 'a', 'sp', 's1', 1, true), 'OK 1', 'v2: a served pool item of the snapshot is stored');
select is(pg_temp.si('a_s2', 'a', 'sp', 's2', 2, false), 'OK 1', 'v2 (R5-19): a drawn but unserved pool item is stored with served_at null');
select is(pg_temp.si('a_pq', 'a', 'sp', 'pq', 3, true, 'pqv2', '["o2", "o1"]'), 'OK 1', 'v2: a parameterised item is stored as one of its variants, with its served option order');
select is(pg_temp.si('a_ii1', 'a', 'si', 'ii1', 1, true), 'OK 1', 'v2: a served inline item is stored');
select matches(pg_temp.si('x3', 'a', 'sp', 's9', 4, true), '^42501 TRACE_GUARD: the item is not in the published snapshot of its section', 'v2: an approved item outside the snapshot is refused');
select matches(pg_temp.si('x4', 'a', 'si', 's3', 2, true), '^42501 TRACE_GUARD: the item is not in the published snapshot of its section', 'v2: a snapshot item named under another section is refused');
select matches(pg_temp.si('x5', 'b', 'si', 'ii1', 1, false), '^42501 TRACE_GUARD: an inline item is stored when served', 'v2 (R5-43, R5-47): an inline item is stored only when served');
select matches(pg_temp.si('x6', 'b', 'sp', 'pq', 1, true), '^42501 TRACE_GUARD: a parameterised item is served as one of its variants', 'v2 (R5-39 a): a parameterised item needs its variant');
select matches(pg_temp.si('x7', 'b', 'sp', 's3', 1, true, 'pqv1'), '^(42501 TRACE_GUARD: a parameterised item is served as one of its variants|23503)', 'v2 (R5-39 a): a plain item takes no variant');
select matches(pg_temp.si('x8', 'b', 'sp', 's3', 1, true, null, '["o1", "o1"]'), '^42501 TRACE_GUARD: the option order is a permutation of the served options', 'v2: a repeated option id is not a permutation');
select matches(pg_temp.si('x9', 'b', 'sp', 's3', 1, true, null, '["o1"]'), '^42501 TRACE_GUARD: the option order is a permutation of the served options', 'v2: a missing option id is not a permutation');
select matches(pg_temp.si('x10', 'b', 'sp', 'pq', 1, true, 'pqv1', '["o1", "o3"]'), '^42501 TRACE_GUARD: the option order is a permutation of the served options', 'v2: a variant''s order permutes the variant''s options');
select is(pg_temp.si('b_s3', 'b', 'sp', 's3', 1, true, null, '["o2", "o1"]'), 'OK 1', 'v2: a shuffled option order is stored');
select is(pg_temp.si('b_cp1', 'b', 'sp', 'cp1', 2, true), 'OK 1', 'v2: a library copy in the pool is served');
select matches(pg_temp.si('x11', 'b', 'sp', 's3', 3, true), '^23505', 'v2: the same item twice in a session is refused by the unique key');
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at, draw_seed_sha256) values (%L, %L, %L, %L, 3, now(), 'not a hash')$$, pg_temp.id('A'), pg_temp.id('b'), pg_temp.id('sp'), pg_temp.id('s4'))), '^23514', 'v2: the draw seed is a SHA-256 hex digest');
select matches(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at) values (%L, %L, null, %L, 3, now())$$, pg_temp.id('A'), pg_temp.id('b'), pg_temp.id('s4'))), '^42501 TRACE_GUARD: a version 2 item names its section', 'v2 (R2-1): a v2 row names its section');
select matches(pg_temp.try(format($$update public.session_items set served_at = now() where id = %L$$, pg_temp.id('a_s2'))), '^42501', 'R5-41: session items are insert-only (a drawn row is never marked served later)');
select pg_temp.op();
-- A retired item stays servable from a published snapshot (E3; the gate allows approved and retired).
select pg_temp.u('owner');
select is(pg_temp.try(format($$update public.item_versions set status = 'retired' where id = %L$$, pg_temp.id('s5'))), 'OK 1', 'E3: a snapshotted item is retired');
select pg_temp.op();
select is(pg_temp.si('b_s5', 'b', 'sp', 's5', 3, true), 'OK 1', 'E3: a retired item of the published snapshot is still served');

-- ===== DB-M1-4 (R5-19 slots): a pool section stores at most its draw, in positions 1..draw_count =====
select matches(pg_temp.si('x13', 'a', 'sp', 's4', 2, true), '^42501 TRACE_GUARD: the section''s draw is full', 'DB-M1-4: a fourth row in a section that draws 3 is refused');
select matches(pg_temp.si('x14', 'd', 'sp', 's4', 4, false), '^42501 TRACE_GUARD: the position is outside the section''s draw', 'DB-M1-4: a position past the draw is refused');
select is(pg_temp.si('d_s4', 'd', 'sp', 's4', 3, false), 'OK 1', 'DB-M1-4: a position within the draw is stored');
select is((select count(*)::int from public.item_exposure_events where session_item_id = pg_temp.id('d_s4')), 0, 'DB-M1-4: the drawn row writes no exposure');

-- ===== Package v1 (AT-M1-28): the D1 rule stands =====
select is(pg_temp.si('c_iv1', 'c', 'sv1', 'iv1', 1, true), 'OK 1', 'v1 (AT-M1-28): a D1-style version still serves its inline item');
select matches(pg_temp.si('x12', 'c', 'sv1', 's1', 2, true), '^42501 TRACE_GUARD: the item belongs to another test version', 'v1: a bank item is not part of a v1 version');
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at) values (%L, %L, %L, %L, 2, null)$$, pg_temp.id('A'), pg_temp.id('c'), pg_temp.id('sv1'), pg_temp.id('iv1'))), '^(42501 TRACE_GUARD: a version 1 item is stored when served|23505)', 'v1 (R5-43): a v1 row is stored only when served');
select matches(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at, option_order) values (%L, %L, %L, %L, 1, now(), '["o1", "o2"]')$$, pg_temp.id('A'), pg_temp.id('a'), pg_temp.id('sv1'), pg_temp.id('iv1'))), '^42501 TRACE_GUARD: the item is not in the published snapshot of its section', 'v2: a v1 version''s item cannot be served in a v2 session');
select pg_temp.op();

-- ===== Exposure (AT-M1-03; I-M1-8; R5-41) =====
select is((select count(*)::int from public.item_exposure_events where session_item_id = pg_temp.id('a_s1')), 1, 'AT-M1-03: a served item writes exactly one exposure event');
select is((select (item_id = pg_temp.id('s1_item'))::text || '|' || coalesce(source_item_id::text, 'null') || '|' || (workspace_id = pg_temp.id('A1'))::text from public.item_exposure_events where session_item_id = pg_temp.id('a_s1')), 'true|null|true', 'AT-M1-03: the event names the item and the workspace');
select is((select count(*)::int from public.item_exposure_events where session_item_id = pg_temp.id('a_s2')), 0, 'AT-M1-03 (R5-41): a drawn, unserved row writes no event');
select is((select count(*)::int from public.item_exposure_events where item_id = pg_temp.id('s3_item')), 1, 'AT-M1-03: the refused duplicate counted nothing');
select is((select source_item_id from public.item_exposure_events where session_item_id = pg_temp.id('b_cp1')), pg_temp.id('lib1_item'), 'AT-M1-03 (R2-7): a library copy''s event carries the library item');
select is((select count(*)::int from public.item_exposure_events where session_item_id = pg_temp.id('c_iv1')), 1, 'AT-M1-03: a v1 served item counts too');
select pg_temp.u('owner');
select is((select served_count from public.v_item_exposure where item_id = pg_temp.id('s1_item')), 1, 'AT-M1-03: v_item_exposure counts the served item');
select is((select count(*)::int from public.v_item_exposure where item_id = pg_temp.id('s2_item')), 0, 'AT-M1-03: the drawn-only item has no exposure');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.v_item_exposure), 0, 'exposure S: a workspace A2 recruiter sees no workspace A1 exposure');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.item_exposure_events where org_id = pg_temp.id('A')), 0, 'exposure S: org B sees nothing of org A');
select pg_temp.api(pg_temp.id('L'));
select is((select served_count from private.library_exposure(pg_temp.id('lib_author'), 'aal2', '{otp,totp}') where source_item_id = pg_temp.id('lib1_item')), 1::bigint, 'E28 (R5-36): a library member reads the library item''s total across customer copies');
select pg_temp.api(pg_temp.id('A'));
select is((select count(*)::int from private.library_exposure(pg_temp.id('owner'), 'aal2', '{otp,totp}')), 0, 'R5-36: a customer viewer reads no library exposure');
select pg_temp.op();
select matches(pg_temp.try(format($$update public.item_exposure_events set served_at = now() where session_item_id = %L$$, pg_temp.id('a_s1'))), '^(42501 permission denied|P0001 TRACE_APPEND_ONLY)', 'exposure: append-only, even on the operator path (UPDATE revoked from the owner, ALWAYS trigger behind it)');

-- ===== The quality worker reads the whole draw (R5-19, AT-M1-21 db case) =====
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select is((select count(*)::int || '|' || count(*) filter (where served_at is null)::int from public.session_items where session_id = pg_temp.id('a')), '4|1', 'R5-19: the quality worker reads the drawn-but-unserved row with the served ones');
select is((select item_variant_id from public.session_items where id = pg_temp.id('a_pq')), pg_temp.id('pqv2'), 'R5-19: and the variant served');
select is((select count(*)::int from public.item_variant_keys where item_variant_id = pg_temp.id('pqv2')), 1, 'R5-19: and the variant key, to score it');
select pg_temp.op();

-- ===== responses guard v2 (R5-43): only a served item has a response =====
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$insert into public.responses (org_id, session_id, session_item_id, answer_kind, final_choice, answer_sha256, final_seq, submitted_at) values (%L, %L, %L, 'choice', 'o1', %L, 3, now())$$, pg_temp.id('A'), pg_temp.id('a'), pg_temp.id('a_s2'), repeat('a', 64))), '^42501 TRACE_GUARD: an item that was not served has no response', 'R5-43: a drawn, unserved item has no response');
select is(pg_temp.try(format($$insert into public.responses (org_id, session_id, session_item_id, answer_kind, final_choice, answer_sha256, final_seq, submitted_at) values (%L, %L, %L, 'choice', 'o1', %L, 3, now())$$, pg_temp.id('A'), pg_temp.id('a'), pg_temp.id('a_s1'), repeat('a', 64))), 'OK 1', 'R5-43: a served item takes its response');
select pg_temp.op();

-- ===== Who may write session_items (D1 unchanged) =====
select pg_temp.u('owner');
select matches(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at) values (%L, %L, %L, %L, 4, now())$$, pg_temp.id('A'), pg_temp.id('b'), pg_temp.id('sp'), pg_temp.id('s6'))), '^42501 permission denied', 'session_items I: an org user cannot write');
select pg_temp.w('trace_worker', pg_temp.id('B'));
select matches(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at) values (%L, %L, %L, %L, 4, now())$$, pg_temp.id('A'), pg_temp.id('b'), pg_temp.id('sp'), pg_temp.id('s6'))), '^42501', 'session_items I: a mirror bound to org B cannot write org A');
select pg_temp.op();

-- ===== exposure_at_publish (R3-2): a later publish freezes the served counts =====
select pg_temp.tv('v3', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sp3', 'v3', 1, 'mcq', 'd1000000-0000-4000-8000-0000000000e1', 1, 100);
select pg_temp.preset('v3', 'standard');
select is(pg_temp.try($$select pg_temp.publish('v3')$$), 'OK 1', 'R3-2: a second version of the pool publishes');
select is((select string_agg(k || '=' || sp.exposure_at_publish, ',' order by k) from unnest(array['s1', 's2', 's3', 'cp1']) as k join public.section_pool_snapshot as sp on sp.item_version_id = pg_temp.id(k) and sp.test_version_id = pg_temp.id('v3')), 'cp1=1,s1=1,s2=0,s3=1', 'R3-2: exposure_at_publish freezes each item''s served count (drawn-only s2 counts 0)');

-- ===== Migration M1-i (R5-62 b): trace_worker reads only the layout columns of sections and item_versions =====
select pg_temp.w('trace_worker', pg_temp.id('A'));
select ok((select count(*) from (select id, org_id, test_version_id, position, draw_count from public.sections) as s) > 0, 'M1-i: trace_worker bound to org A reads the section layout columns');
select ok((select count(*) from (select id, org_id, section_id, test_version_id from public.item_versions where section_id is not null) as v) > 0, 'M1-i: trace_worker bound to org A reads the inline item placement columns');
select matches(pg_temp.try('select name from public.sections'), '^42501 permission denied', 'M1-i: trace_worker cannot read a section name');
select matches(pg_temp.try('select stem from public.item_versions'), '^42501 permission denied', 'M1-i: trace_worker cannot read item content');
select matches(pg_temp.try('select options from public.item_versions'), '^42501 permission denied', 'M1-i: trace_worker cannot read options');
select matches(pg_temp.try($$update public.sections set position = position$$), '^42501 permission denied', 'M1-i: trace_worker cannot update sections');
select pg_temp.w('trace_worker', pg_temp.id('B'));
select is((select count(*)::int from public.sections where org_id = pg_temp.id('A')), 0, 'M1-i: trace_worker bound to org B sees no org A section');
select is((select count(*)::int from public.item_versions where org_id = pg_temp.id('A')), 0, 'M1-i: trace_worker bound to org B sees no org A item version');
select pg_temp.w('trace_worker', null);
select is((select count(*)::int from public.sections), 0, 'M1-i: an unbound trace_worker sees no section');
select pg_temp.op();

-- ===== Migration M1-l (R5-63 i; supersedes M1-k): trace_api reads a test's title only through a definer function,
-- bound to its api org; it still holds no SELECT on public.tests (rls_d1_api pin unchanged, R5-28) =====
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select name from public.tests'), '^42501 permission denied', 'M1-l: trace_api holds no SELECT on tests (the D1 pin stays)');
select ok(private.api_test_title(pg_temp.id('v3')) like 'Test %', 'M1-l: trace_api bound to org A reads the title of its test version');
select is(private.api_test_title('d1000000-0000-4000-8000-0000000000ff'), null, 'M1-l: an unknown test version has no title');
select pg_temp.api(pg_temp.id('B'));
select is(private.api_test_title(pg_temp.id('v3')), null, 'M1-l: trace_api bound to org B reads no org A title');
select pg_temp.api(null);
select is(private.api_test_title(pg_temp.id('v3')), null, 'M1-l: an unbound trace_api reads no title');
select pg_temp.op();
select is((select string_agg(r, ',' order by r) from unnest(array['anon', 'authenticated', 'service_role', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_candidate', 'trace_authoring_worker', 'trace_admin_worker', 'trace_api']) as r where has_function_privilege(r, 'private.api_test_title(uuid)', 'EXECUTE')), 'trace_api', 'M1-l: only trace_api may execute private.api_test_title');
select is((select prosecdef from pg_catalog.pg_proc where oid = 'private.api_test_title(uuid)'::regprocedure), true, 'M1-l: api_test_title is SECURITY DEFINER');
select is((select proconfig from pg_catalog.pg_proc where oid = 'private.api_test_title(uuid)'::regprocedure), array['search_path=""'], 'M1-l: api_test_title pins an empty search_path');
