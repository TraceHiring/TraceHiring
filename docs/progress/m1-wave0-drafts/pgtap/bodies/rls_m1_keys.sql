-- rls_m1_keys (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_keys; §3.2 item_variant_keys, §3.3 item_answer_keys, §3.5, I-M1-5; AT-M1-22; R2-4, R3-7, R5-44). RED first: written from the spec before migration M1-a. Personas and items are synthetic.
select pg_temp.bank('qa1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('q2a', pg_temp.id('A'), pg_temp.id('A2'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('qd1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'draft');
select pg_temp.bank('qb1', pg_temp.id('B'), pg_temp.id('BW'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('la1', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'verbal', 0.50, 'approved');
-- A parameterised library item (one variant with its key), approved by the expert.
insert into public.items (id, org_id, workspace_id, format, skill_key, created_by) values
  ('c2000000-0000-4000-8000-000000000002', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'quant', pg_temp.id('lib_author'));
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256, created_by) values
  ('c2100000-0000-4000-8000-000000000002', pg_temp.id('L'), 'c2000000-0000-4000-8000-000000000002', 'mcq', '[synthetic] Library param',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64), pg_temp.id('lib_author'));
insert into public.item_variants (id, org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values
  ('c2200000-0000-4000-8000-000000000002', pg_temp.id('L'), 'c2100000-0000-4000-8000-000000000002', 1, '{"a": 3}',
   '[synthetic] What is 3 + 1?', '[{"id": "o1", "text": "4"}, {"id": "o2", "text": "3"}]', 0.50, repeat('c', 64));
insert into public.item_variant_keys (org_id, item_variant_id, key) values (pg_temp.id('L'), 'c2200000-0000-4000-8000-000000000002', '{"option_id": "o1"}');
update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000002';
update public.item_versions set status = 'approved', approved_by = pg_temp.id('lib_expert'), reviewed_by = pg_temp.id('lib_expert'), key_reviewed_by = pg_temp.id('lib_expert') where id = 'c2100000-0000-4000-8000-000000000002';
-- A parameterised draft in org A with its own variant (its key is added by the tests).
insert into public.items (id, org_id, workspace_id, format, skill_key) values
  ('c2000000-0000-4000-8000-000000000003', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant');
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256) values
  ('c2100000-0000-4000-8000-000000000003', pg_temp.id('A'), 'c2000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] Org A param',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64));
insert into public.item_variants (id, org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values
  ('c2200000-0000-4000-8000-000000000003', pg_temp.id('A'), 'c2100000-0000-4000-8000-000000000003', 1, '{"a": 5}',
   '[synthetic] What is 5 + 1?', '[{"id": "o1", "text": "6"}, {"id": "o2", "text": "5"}]', 0.50, repeat('c', 64));
-- An inline (D1-mode) draft with one MCQ item.
insert into public.tests (id, org_id, workspace_id, name, created_by) values
  ('e1000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), 'Test One', pg_temp.id('owner'));
insert into public.test_versions (id, org_id, test_id, total_time_seconds, quality_cutoff, created_by) values
  ('f1000000-0000-4000-8000-000000000001', pg_temp.id('A'), 'e1000000-0000-4000-8000-000000000001', 1800, 40, pg_temp.id('owner'));
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-000000000001', pg_temp.id('A'), 'f1000000-0000-4000-8000-000000000001', 1, 'Choices', 'mcq', 1);
insert into public.item_versions (id, org_id, section_id, format, position, stem, options, content_sha256) values
  ('61000000-0000-4000-8000-000000000001', pg_temp.id('A'), '51000000-0000-4000-8000-000000000001', 'mcq', 1, '[synthetic] Inline', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', repeat('c', 64));
-- The owner copies both library items into workspace A1 (keys arrive library_sourced).
select pg_temp.u('owner');
insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids)
  values (pg_temp.id('A'), pg_temp.id('A1'), array[pg_temp.id('la1'), 'c2100000-0000-4000-8000-000000000002'::uuid]);
select pg_temp.op();
insert into pg_temp.ids select 'copy_la1', id from public.item_versions where org_id = pg_temp.id('A') and source_item_version_id = pg_temp.id('la1');
insert into pg_temp.ids select 'copy_param', id from public.item_versions where org_id = pg_temp.id('A') and source_item_version_id = 'c2100000-0000-4000-8000-000000000002';

-- ===== I-M1-5 / AT-M1-22: library-sourced keys are invisible to every org role =====
select is((select count(*)::int from public.item_answer_keys where library_sourced) || '/' || (select count(*)::int from public.item_variant_keys where library_sourced), '1/1', 'fixture: the copy brought one base key and one variant key, both library_sourced');
select pg_temp.u('owner');
select is((select count(*)::int from public.item_answer_keys where library_sourced) + (select count(*)::int from public.item_variant_keys where library_sourced), 0, 'I-M1-5: owner reads no library-sourced key');
select is((select count(*)::int from public.item_answer_keys where item_version_id = pg_temp.id('qa1')), 1, 'keys S: owner reads the org''s own bank key');
select pg_temp.u('admin');
select is((select count(*)::int from public.item_answer_keys where library_sourced) + (select count(*)::int from public.item_variant_keys where library_sourced), 0, 'I-M1-5: admin reads no library-sourced key');
select pg_temp.u('recruiter');
select is((select count(*)::int from public.item_answer_keys where library_sourced) + (select count(*)::int from public.item_variant_keys where library_sourced), 0, 'I-M1-5: recruiter reads no library-sourced key');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.item_answer_keys where library_sourced) + (select count(*)::int from public.item_variant_keys where library_sourced), 0, 'I-M1-5: reviewer reads no library-sourced key');
select is((select count(*)::int from public.item_answer_keys where item_version_id = pg_temp.id('qa1')), 1, 'keys S: the reviewer reads a bank key of their workspace (approval arm, R2-4)');
select pg_temp.u('ws_reviewer');
select is((select count(*)::int from public.item_answer_keys where item_version_id = pg_temp.id('qa1')), 0, 'keys S: a reviewer fenced to workspace A2 reads no workspace A1 key');
select is((select count(*)::int from public.item_answer_keys where item_version_id = pg_temp.id('q2a')), 1, 'keys S: the fenced reviewer reads the workspace A2 key');
select pg_temp.u('hm');
select is((select count(*)::int from public.item_answer_keys) + (select count(*)::int from public.item_variant_keys), 0, 'keys S: hiring manager reads no key');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.item_answer_keys where org_id = pg_temp.id('A')), 0, 'keys S: org B admin reads no org A key');
select pg_temp.u('lib_author');
select is((select count(*)::int from public.item_answer_keys where org_id = pg_temp.id('A')), 0, 'keys S: library staff read no customer key (the copy is single-tenant)');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select is((select count(*)::int from public.item_answer_keys where library_sourced) || '/' || (select count(*)::int from public.item_variant_keys where library_sourced), '1/1', 'AT-M1-22: the quality worker reads the library-sourced keys of its job org');
select is((select count(*)::int from public.item_answer_keys where org_id <> pg_temp.id('A')), 0, 'keys S: the quality worker reads only its job org');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.item_variant_keys'), '^42501 permission denied', 'keys S: trace_api has no grant on variant keys');
select pg_temp.op();
set local role trace_candidate;
select matches(pg_temp.try('select * from public.item_answer_keys'), '^42501 permission denied', 'keys S: trace_candidate has no privilege');
select pg_temp.op();

-- ===== Writes on library-sourced keys =====
select pg_temp.u('owner');
select is(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o2"}' where item_version_id = %L$$, pg_temp.id('copy_la1'))), 'OK 0', 'library keys: owner updates no library-sourced key');
select is(pg_temp.try(format($$delete from public.item_answer_keys where item_version_id = %L$$, pg_temp.id('copy_la1'))), 'OK 0', 'library keys: owner deletes no library-sourced key');
select matches(pg_temp.try(format($$insert into public.item_answer_keys (org_id, item_version_id, format, key, library_sourced) values ('a1000000-0000-4000-8000-000000000001', %L, 'mcq', '{"option_id": "o1"}', true)$$, pg_temp.id('qd1'))), '^42501 permission denied', 'library keys: library_sourced is outside the insert grant');

-- ===== Bank keys: draft only (§3.3) =====
select is(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o2"}' where item_version_id = %L$$, pg_temp.id('qd1'))), 'OK 1', 'bank keys: the key of a draft is changed');
select matches(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o2"}' where item_version_id = %L$$, pg_temp.id('qa1'))), '^42501 TRACE_GUARD: the item version is frozen', 'bank keys: the key of an approved item is frozen');
select matches(pg_temp.try(format($$delete from public.item_answer_keys where item_version_id = %L$$, pg_temp.id('qa1'))), '^42501 TRACE_GUARD: the item version is frozen', 'bank keys: the key of an approved item is not deleted');
select matches(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o9"}' where item_version_id = %L$$, pg_temp.id('qd1'))), '^23514 TRACE_BAD_ANSWER_KEY', 'bank keys: the key names one of the item options');
select pg_temp.op();
select is((select coalesce(test_id::text, 'null') || '|' || (workspace_id = pg_temp.id('A1'))::text from public.item_answer_keys where item_version_id = pg_temp.id('qd1')), 'null|true', 'R5-44: a bank key has no test and the item''s workspace');
select pg_temp.u('ws_recruiter');
select is(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o1"}' where item_version_id = %L$$, pg_temp.id('qd1'))), 'OK 0', 'bank keys: workspace recruiter changes no workspace A1 key');
select pg_temp.u('reviewer');
select is(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o1"}' where item_version_id = %L$$, pg_temp.id('qd1'))), 'OK 0', 'bank keys: a reviewer changes no key');

-- ===== Inline keys take their test from their item (R5-44, replaces D1 I-12 NOT NULL test_id) =====
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) values ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'mcq', '{"option_id": "o1"}')$$), 'OK 1', 'inline keys: owner adds the key of an inline item');
select pg_temp.op();
select is((select test_id from public.item_answer_keys where item_version_id = '61000000-0000-4000-8000-000000000001'), 'e1000000-0000-4000-8000-000000000001'::uuid, 'inline keys: the test comes from the item');
select matches(pg_temp.try($$update public.item_answer_keys set test_id = null where item_version_id = '61000000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: answer key org, item and scope are immutable', 'inline keys: an inline key never loses its test, even on the operator path');
select is((select count(*)::int from public.item_answer_keys as k join public.item_versions as i on i.id = k.item_version_id where i.section_id is not null and k.test_id is null), 0, 'inline keys: no inline key without its test');

-- ===== Variant keys =====
select pg_temp.u('owner');
select matches(pg_temp.try($$insert into public.item_variant_keys (org_id, item_variant_id, key) values ('a1000000-0000-4000-8000-000000000001', 'c2200000-0000-4000-8000-000000000003', '{"option_id": "o7"}')$$), '^23514 TRACE_BAD_ANSWER_KEY', 'variant keys: the key names one of the variant options');
select is(pg_temp.try($$insert into public.item_variant_keys (org_id, item_variant_id, key) values ('a1000000-0000-4000-8000-000000000001', 'c2200000-0000-4000-8000-000000000003', '{"option_id": "o1"}')$$), 'OK 1', 'variant keys: owner keys a variant of a draft');
select is((select count(*)::int from public.item_variant_keys where item_variant_id = 'c2200000-0000-4000-8000-000000000003'), 1, 'variant keys: owner reads it');
select matches(pg_temp.try($$insert into public.item_variant_keys (org_id, item_variant_id, key, library_sourced) values ('a1000000-0000-4000-8000-000000000001', 'c2200000-0000-4000-8000-000000000003', '{"option_id": "o1"}', true)$$), '^42501 permission denied', 'variant keys: library_sourced is outside the insert grant');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.item_variant_keys where item_variant_id = 'c2200000-0000-4000-8000-000000000003'), 1, 'variant keys: the reviewer reads a workspace variant key');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.item_variant_keys where item_variant_id = 'c2200000-0000-4000-8000-000000000003'), 0, 'variant keys: workspace recruiter reads no workspace A1 variant key');
select pg_temp.u('owner');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000003'$$), 'OK 1', 'variant keys: the keyed parameterised draft is submitted');
select matches(pg_temp.try($$update public.item_variant_keys set key = '{"option_id": "o2"}' where item_variant_id = 'c2200000-0000-4000-8000-000000000003'$$), '^42501 TRACE_GUARD: the item version is frozen', 'variant keys: frozen once the item leaves draft');
select matches(pg_temp.try($$delete from public.item_variant_keys where item_variant_id = 'c2200000-0000-4000-8000-000000000003'$$), '^42501 TRACE_GUARD: the item version is frozen', 'variant keys: not deleted once the item leaves draft');

-- ===== Library browse never carries a key (R2-5, R3-7, LibraryItemCard) =====
select pg_temp.api(pg_temp.id('A'));
select is((select count(*)::int from private.library_browse('00000000-0000-4000-8000-000000000001', 'aal2', array['otp', 'totp'], null, null, null, null, null, 50)), 2, 'library browse: an owner of the api org sees the two approved library items');
select is((select options from private.library_browse('00000000-0000-4000-8000-000000000001', 'aal2', array['otp', 'totp'], 'verbal', null, null, null, null, 50)), '["One", "Two"]'::jsonb, 'library browse: options are texts only (no option ids, no key)');
select is((select count(*)::int from private.library_browse(null, null, null, null, null, null, null, null, 50)), 0, 'library browse: no viewer (the candidate path) sees nothing (R3-7)');
select is((select count(*)::int from private.library_browse('00000000-0000-4000-8000-000000000008', 'aal1', array['otp'], null, null, null, null, null, 50)), 0, 'library browse: a hiring manager sees nothing');
select is((select count(*)::int from private.library_browse('00000000-0000-4000-8000-000000000003', 'aal1', array['otp'], null, null, null, null, null, 50)), 0, 'library browse: an admin at aal1 sees nothing');
select is((select count(*)::int from private.library_browse('00000000-0000-4000-8000-00000000000e', 'aal2', array['otp', 'totp'], null, null, null, null, null, 50)), 0, 'library browse: an org B admin sees nothing through the org A api context');
select pg_temp.api(pg_temp.id('L'));
select is((select count(*)::int from private.library_browse('00000000-0000-4000-8000-000000000020', 'aal2', array['otp', 'totp'], null, null, null, null, null, 50)), 0, 'library browse: customers only (library staff use the bank itself)');
select pg_temp.u('owner');
select matches(pg_temp.try($$select * from private.library_browse(null, null, null, null, null, null, null, null, 50)$$), '^42501', 'library browse: authenticated cannot call it');
select pg_temp.op();
