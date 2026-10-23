-- rls_m1_bank (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_bank; §3.2 items, §3.3 item_versions, §3.4, §3.5, §4.1; AT-M1-02, AT-M1-06, AT-M1-09, AT-M1-25; R2-2, R2-5, R3-8, R5-22, R5-28 c, R5-38, R5-40; library copy E7, E8). RED first: written from the spec before migration M1-a. Personas and items are synthetic.
-- Fixtures (operator path): approved, draft and in-review bank items in orgs A, B and the library.
select pg_temp.bank('qa1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant', 0.50, 'approved');
select pg_temp.bank('qa2', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant', 0.40, 'approved');
select pg_temp.bank('qx', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant', 0.40, 'retired');
select pg_temp.bank('qdq', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant', 0.40, 'draft');
select pg_temp.bank('va1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('qr1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'in_review');
select pg_temp.bank('qr2', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'in_review');
select pg_temp.bank('q2r', pg_temp.id('A'), pg_temp.id('A2'), 'mcq', 'verbal', 0.50, 'in_review');
select pg_temp.bank('qb1', pg_temp.id('B'), pg_temp.id('BW'), 'mcq', 'verbal', 0.50, 'in_review');
select pg_temp.bank('la1', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'verbal', 0.50, 'approved');
select pg_temp.bank('la2', pg_temp.id('L'), pg_temp.id('LW'), 'mcq', 'verbal', 0.50, 'in_review');
-- A parameterised quant item (approved) for the share metric: version, one variant and its key, then review.
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
update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000001';
update public.item_versions set status = 'approved', approved_by = pg_temp.id('owner') where id = 'c2100000-0000-4000-8000-000000000001';
-- An inline (D1-mode) test version with one section, for the inline-row cases.
insert into public.tests (id, org_id, workspace_id, name, created_by) values
  ('e1000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), 'Test One', pg_temp.id('owner'));
insert into public.test_versions (id, org_id, test_id, total_time_seconds, quality_cutoff, created_by) values
  ('f1000000-0000-4000-8000-000000000001', pg_temp.id('A'), 'e1000000-0000-4000-8000-000000000001', 1800, 40, pg_temp.id('owner'));
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-000000000001', pg_temp.id('A'), 'f1000000-0000-4000-8000-000000000001', 1, 'Choices', 'mcq', 1);

-- ===== items: I =====
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'quant')$$), 'OK 1', 'items I: owner creates a bank item in workspace A1');
select is(pg_temp.try($$insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'logical')$$), 'OK 1', 'items I: owner creates a second bank item');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'astrology')$$), '^23503 TRACE_GUARD: skill not found', 'items I: a skill outside the library taxonomy is refused');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'Bad Skill')$$), '^23503 TRACE_GUARD: skill not found', 'items I: a malformed skill key is not in the taxonomy either');
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'written', 'written_communication')$$), 'OK 1', 'items I: recruiter creates a bank item');
select pg_temp.u('ws_recruiter');
select is(pg_temp.try($$insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'mcq', 'verbal')$$), 'OK 1', 'items I: workspace recruiter creates a bank item in workspace A2');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal')$$), '^42501', 'items I: workspace recruiter cannot create an item in workspace A1 (fence)');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal')$$), '^42501', 'items I: reviewer cannot create an item');
select pg_temp.u('hm');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal')$$), '^42501', 'items I: hiring manager cannot create an item');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal')$$), '^42501', 'items I: org B admin cannot create an item in org A (cross-org)');
select pg_temp.op();
select is((select created_by from public.items where id = 'c1000000-0000-4000-8000-000000000002'), pg_temp.id('recruiter'), 'items I: created_by is the caller');
select is((select pg_temp.keys(details) || '|' || actor_kind::text || '|' || (actor_user_id = pg_temp.id('recruiter'))::text from public.audit_log where action = 'item.create' and object_id = 'c1000000-0000-4000-8000-000000000002'), 'format|org_user|true', 'items event: item.create carries only the format, by the creating user');

-- ===== items: S =====
select pg_temp.u('owner');
select is((select count(*)::int from public.items where org_id = pg_temp.id('A')) > 10, true, 'items S: owner sees the org A bank');
select is((select count(*)::int from public.items where org_id <> pg_temp.id('A')), 0, 'items S: owner sees no other org (library and B hidden)');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.items where workspace_id = pg_temp.id('A1')), 0, 'items S: workspace recruiter sees nothing in workspace A1');
select is((select count(*)::int from public.items where workspace_id = pg_temp.id('A2')) >= 2, true, 'items S: workspace recruiter sees workspace A2 items');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.items where org_id = pg_temp.id('A')) > 10, true, 'items S: reviewer sees the workspace bank (approval arm)');
select pg_temp.u('reviewer_aal1');
select is((select count(*)::int from public.items), 0, 'items S: reviewer at aal1 sees nothing');
select pg_temp.u('hm');
select is((select count(*)::int from public.items), 0, 'items S: hiring manager sees nothing');
select pg_temp.u('outsider');
select is((select count(*)::int from public.items), 0, 'items S: a user without a membership sees nothing');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.items where org_id = pg_temp.id('A')), 0, 'items S: org B admin sees no org A item');

-- ===== items: U / D =====
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.items set format = 'written' where id = 'c1000000-0000-4000-8000-000000000001'$$), '^42501', 'items U: format is immutable');
select matches(pg_temp.try($$update public.items set workspace_id = 'b1000000-0000-4000-8000-000000000002' where id = 'c1000000-0000-4000-8000-000000000001'$$), '^42501', 'items U: workspace is immutable');
select is(pg_temp.try($$update public.items set archived_at = now() where id = 'c1000000-0000-4000-8000-000000000001'$$), 'OK 1', 'items U: owner archives an item');
select is(pg_temp.try($$delete from public.items where id = 'c1000000-0000-4000-8000-000000000004'$$), 'OK 1', 'items D: an item without versions is deleted');
select matches(pg_temp.try(format($$delete from public.items where id = %L$$, pg_temp.id('qa1_item'))), '^42501 TRACE_GUARD: an item with versions cannot be deleted', 'items D: an item with versions is not deleted (R3-8)');
select pg_temp.u('reviewer');
select is(pg_temp.try(format($$delete from public.items where id = %L$$, pg_temp.id('va1_item'))), 'OK 0', 'items D: reviewer deletes nothing');

-- ===== item_versions (bank): I =====
select pg_temp.u('recruiter');
select is(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, rubric_version_id, skill_key, difficulty, content_sha256, origin) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'written', '[synthetic] Bank written v1', (select id from public.rubric_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and rubric_key = 'default'), 'written_communication', 0.50, repeat('d', 64), 'library')$$), 'OK 1', 'versions I: recruiter adds a bank version (client origin value supplied)');
select is(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, rubric_version_id, skill_key, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'written', '[synthetic] Bank written v2', (select id from public.rubric_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and rubric_key = 'default'), 'written_communication', 0.50, repeat('d', 64))$$), 'OK 1', 'versions I: recruiter adds a second version');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, rubric_version_id, content_sha256, status) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'written', '[synthetic] x', (select id from public.rubric_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and rubric_key = 'default'), repeat('d', 64), 'approved')$$), '^42501 permission denied', 'versions I: status is outside the insert grant');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, rubric_version_id, content_sha256, origin) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'written', '[synthetic] x', (select id from public.rubric_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and rubric_key = 'default'), repeat('d', 64), 'ai')$$), '^23514', 'versions I: an origin outside the CHECK still fails the CHECK (rls_d1_tests unchanged, R5-28)');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'mcq', '[synthetic] x', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', repeat('d', 64))$$), '^42501 TRACE_GUARD: the version format differs from its item', 'versions I: the version format is the item format');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, rubric_version_id, content_sha256, position) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'written', '[synthetic] x', (select id from public.rubric_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and rubric_key = 'default'), repeat('d', 64), 3)$$), '^23514', 'versions I: a bank row with a position breaks the placement CHECK (R2-2)');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, skill_key, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'written', '[synthetic] No rubric', 'written_communication', 0.50, repeat('d', 64))$$), '^23514', 'versions I (carried Medium): a written bank version without a rubric is refused, so none reaches review, approval or a pool');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000009', 'mcq', '[synthetic] x', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', repeat('d', 64))$$), '^23503 TRACE_GUARD: item not found', 'versions I: a bank version needs its item');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, rubric_version_id, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'written', '[synthetic] x', (select id from public.rubric_versions where org_id = 'a1000000-0000-4000-8000-000000000001' and rubric_key = 'default'), repeat('d', 64))$$), '^42501', 'versions I: workspace recruiter cannot add a version to a workspace A1 item (the workspace comes from the item)');
select pg_temp.op();
select is((select origin || '|' || status::text || '|' || version_no || '|' || (workspace_id = pg_temp.id('A1'))::text || '|' || (created_by = pg_temp.id('recruiter'))::text || '|' || coalesce(approved_by::text, 'null') from public.item_versions where stem = '[synthetic] Bank written v1'), 'human|draft|1|true|true|null', 'versions I: origin from the write path, draft, version 1, workspace from the item, created by the caller');
select is((select version_no from public.item_versions where stem = '[synthetic] Bank written v2'), 2::smallint, 'versions I: the next version gets the next number');
-- Inline rows (D1 mode): the test comes from the section; an inline row cannot take a bank identity (R2-1, R5-28 c).
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.item_versions (org_id, section_id, format, position, stem, options, origin, content_sha256) values ('a1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'mcq', 1, '[synthetic] Inline one', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'human', repeat('c', 64))$$), 'OK 1', 'inline I: owner adds an inline item without naming the test or version');
select matches(pg_temp.try(format($$insert into public.item_versions (org_id, section_id, item_id, format, position, stem, options, content_sha256) values ('a1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', %L, 'mcq', 2, '[synthetic] Inline two', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', repeat('c', 64))$$, pg_temp.id('qa1_item'))), '^42501 TRACE_GUARD: an inline item cannot take a bank item identity', 'inline I: an inline item cannot reuse a bank item id');
select pg_temp.op();
select is((select (test_id = 'e1000000-0000-4000-8000-000000000001')::text || '|' || status::text from public.item_versions where stem = '[synthetic] Inline one'), 'true|approved', 'inline I: test filled from the section; an inline item is approved with its version (R5-28 c inline proof)');
select is((select count(*)::int from public.item_versions where section_id is not null and test_id is null), 0, 'inline I: no inline row exists without its test');

-- ===== trace_authoring_worker writes (R5-35, DB-M1-5, SEC-M1-2, SEC-M1-3). No drafting job of org A is running here,
-- so every worker write is refused. =====
insert into public.items (id, org_id, workspace_id, format, skill_key) values
  ('c3000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal');
-- The operator path names a drafting job that is queued, never running (M1-c's FK needs the row), so every worker write
-- below is still refused; rls_m1_ai_drafts has the allowed cases against a running job.
insert into public.ai_draft_jobs (id, org_id, workspace_id, requested_by, format, skill_key, difficulty, count, topic_sha256, provider, model_id, prompt_version) values
  ('c3900000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), pg_temp.id('owner'), 'mcq', 'verbal', 0.50, 1, repeat('e', 64), 'mock', 'mock-drafter-v1', 'draft-v1');
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, origin, ai_draft_job_id, content_sha256) values
  ('c3100000-0000-4000-8000-000000000001', pg_temp.id('A'), 'c3000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] AI draft without its key',
   '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, 'ai_draft', 'c3900000-0000-4000-8000-000000000001', repeat('c', 64));
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal')$$), '^42501 TRACE_GUARD: the authoring worker writes only for a running drafting job', 'worker items I (SEC-M1-3): no item without a running drafting job of its org and workspace');
select matches(pg_temp.try($$insert into public.items (org_id, workspace_id, format, skill_key) values ('a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004', 'mcq', 'verbal')$$), '^42501', 'worker items I: a worker bound to org A writes no org B item (cross-org)');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] Worker v2', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, repeat('c', 64))$$), '^42501 TRACE_GUARD: an AI draft needs its running drafting job', 'worker versions I (R5-35): no version without a running drafting job');
select matches(pg_temp.try(format($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000003', %L, 'mcq', '[synthetic] Worker cross', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, repeat('c', 64))$$, pg_temp.id('qb1_item'))), '^42501', 'worker versions I: a worker bound to org A writes no org B version (cross-org)');
select matches(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) values ('a1000000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 'mcq', '{"option_id": "o1"}')$$), '^42501 TRACE_GUARD: the authoring worker keys only an AI draft of its running job', 'worker keys I (SEC-M1-3): no key for an in-review AI draft without its running job');
select matches(pg_temp.try(format($$insert into public.item_answer_keys (org_id, item_version_id, format, key) values ('a1000000-0000-4000-8000-000000000001', %L, 'mcq', '{"option_id": "o2"}')$$, pg_temp.id('qdq'))), '^42501 TRACE_GUARD: the authoring worker keys only an AI draft of its running job', 'worker keys I (SEC-M1-3): never the key of a human draft');
select matches(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) select org_id, id, 'mcq', '{"option_id": "o1"}' from public.item_versions where stem = '[synthetic] Inline one'$$), '^42501 TRACE_GUARD: the authoring worker keys only an AI draft of its running job', 'worker keys I (SEC-M1-3): never the key of an inline item');
select matches(pg_temp.try(format($$insert into public.item_answer_keys (org_id, item_version_id, format, key) values ('a1000000-0000-4000-8000-000000000003', %L, 'mcq', '{"option_id": "o1"}')$$, pg_temp.id('qb1'))), '^42501', 'worker keys I: a worker bound to org A writes no org B key (cross-org)');
select matches(pg_temp.try('select * from public.item_answer_keys'), '^42501 permission denied', 'worker keys S (SEC-M1-2): the authoring worker reads no answer key');
select is(private.media_refs_valid('[{"key": "item-media/a1000000-0000-4000-8000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", "alt": "A chart"}]'), true, 'validators (R2-6): media_refs_valid runs for the authoring worker');
select is(private.param_spec_valid('{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "count": 5}'), true, 'validators (R2-6, SEC-M1-1): param_spec_valid runs for the authoring worker; a spec without correctOptionId has a valid shape');
select pg_temp.op();

-- ===== SEC-M1-5: an item image lives under its own org's prefix (bank and inline rows, insert and edit) =====
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.items (id, org_id, workspace_id, format, skill_key) values ('c1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'mcq', 'verbal')$$), 'OK 1', 'media: owner creates an item for the image cases');
select is(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, media, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000005', 'mcq', '[synthetic] With image', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', '[{"key": "item-media/a1000000-0000-4000-8000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", "alt": "A chart"}]', repeat('d', 64))$$), 'OK 1', 'media: a bank version takes an image under its org''s prefix');
select matches(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, media, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000005', 'mcq', '[synthetic] Foreign image', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', '[{"key": "item-media/a1000000-0000-4000-8000-000000000003/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", "alt": "A chart"}]', repeat('d', 64))$$), '^42501 TRACE_GUARD: an item image belongs to the item''s org', 'media (SEC-M1-5): a bank version cannot name an org B image');
select matches(pg_temp.try(format($$insert into public.item_versions (org_id, item_id, format, stem, options, media, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000005', 'mcq', '[synthetic] Library image', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', %L, repeat('d', 64))$$, jsonb_build_array(jsonb_build_object('key', 'item-media/' || pg_temp.id('L') || '/' || repeat('a', 64) || '.png', 'alt', 'A chart')))), '^42501 TRACE_GUARD: an item image belongs to the item''s org', 'media (SEC-M1-5): a human version cannot name a library image (only a library copy may)');
select matches(pg_temp.try($$update public.item_versions set media = '[{"key": "item-media/a1000000-0000-4000-8000-000000000003/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png", "alt": "A chart"}]' where stem = '[synthetic] With image'$$), '^42501 TRACE_GUARD: an item image belongs to the item''s org', 'media (SEC-M1-5): a draft edit cannot switch to an org B image');
select matches(pg_temp.try($$update public.item_versions set media = '[{"key": "elsewhere/a.png", "alt": "A chart"}]' where stem = '[synthetic] With image'$$), '^23514', 'media (media_refs_valid): a key outside the item-media prefix breaks the CHECK');
select matches(pg_temp.try($$insert into public.item_versions (org_id, section_id, format, position, stem, options, media, content_sha256) values ('a1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'mcq', 5, '[synthetic] Inline foreign image', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', '[{"key": "item-media/a1000000-0000-4000-8000-000000000003/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", "alt": "A chart"}]', repeat('c', 64))$$), '^42501 TRACE_GUARD: an item image belongs to the item''s org', 'media (SEC-M1-5): an inline item cannot name an org B image');
select matches(pg_temp.try($$update public.item_versions set media = '[{"key": "item-media/a1000000-0000-4000-8000-000000000003/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", "alt": "A chart"}]' where stem = '[synthetic] Inline one'$$), '^42501 TRACE_GUARD: an item image belongs to the item''s org', 'media (SEC-M1-5): an inline edit cannot switch to an org B image');
select is(pg_temp.try($$update public.item_versions set media = '[{"key": "item-media/a1000000-0000-4000-8000-000000000001/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.webp", "alt": "A chart"}]' where stem = '[synthetic] Inline one'$$), 'OK 1', 'media: an inline draft item takes an image under its org''s prefix');

-- ===== Lifecycle (§4.1) =====
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.item_versions set stem = '[synthetic] Bank written v1 edited' where stem = '[synthetic] Bank written v1'$$), 'OK 1', 'lifecycle: a draft is edited');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 1', 'lifecycle: the author submits the draft');
select matches(pg_temp.try($$update public.item_versions set stem = 'changed' where stem = '[synthetic] Bank written v1 edited'$$), '^42501 TRACE_GUARD: an item version is frozen once it leaves draft', 'lifecycle: content is frozen once in review (I-M1-3)');
select matches(pg_temp.try($$update public.item_versions set status = 'draft' where stem = '[synthetic] Bank written v1 edited'$$), '^42501 TRACE_GUARD: item status change not allowed', 'lifecycle: in_review never goes back to draft');
select pg_temp.u('reviewer_aal1');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 0', 'approval: reviewer at aal1 approves nothing');
select pg_temp.u('ws_reviewer');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 0', 'approval: a reviewer fenced to workspace A2 cannot approve a workspace A1 item (R5-38)');
select pg_temp.u('b_admin');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 0', 'approval: org B admin approves nothing in org A (cross-org)');
select pg_temp.u('hm');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 0', 'approval: hiring manager approves nothing');
select pg_temp.u('reviewer');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 1', 'approval: the reviewer approves an in-review item (M1-3)');
select pg_temp.op();
select is((select (approved_by = pg_temp.id('reviewer'))::text || '|' || (approved_at is not null)::text || '|' || coalesce(reviewed_by::text, 'null') from public.item_versions where stem = '[synthetic] Bank written v1 edited'), 'true|true|null', 'approval: approved_by is the approver and approved_at is set (AT-M1-09)');
select is((select pg_temp.keys(a.details) || '|' || (a.actor_user_id = pg_temp.id('reviewer'))::text || '|' || (a.details ->> 'self_approved') || '|' || (a.details ->> 'from') || '>' || (a.details ->> 'to') from public.audit_log as a join public.item_versions as v on v.id = a.object_id where a.action = 'item.approve' and v.stem = '[synthetic] Bank written v1 edited'), 'from,item_version_id,self_approved,to|true|false|in_review>approved', 'approval event: item.approve names the approver, ids and enums only (AT-M1-09, AT-M1-25)');
select pg_temp.u('recruiter');
select matches(pg_temp.try($$update public.item_versions set difficulty = 0.9 where stem = '[synthetic] Bank written v1 edited'$$), '^42501 TRACE_GUARD: an item version is frozen once it leaves draft', 'lifecycle: approved content is frozen');
select matches(pg_temp.try(format($$update public.item_versions set approved_by = %L where stem = '[synthetic] Bank written v1 edited'$$, pg_temp.id('recruiter'))), '^42501 permission denied', 'lifecycle: approved_by is outside the update grant');
select pg_temp.u('reviewer');
select is(pg_temp.try($$update public.item_versions set status = 'retired' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 0', 'lifecycle: a reviewer cannot retire an item');
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.item_versions set status = 'retired' where stem = '[synthetic] Bank written v1 edited'$$), 'OK 1', 'lifecycle: a recruiter retires an approved item');
select matches(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Bank written v1 edited'$$), '^42501', 'lifecycle: retired is terminal');
-- Self-approval in a customer org is allowed and audited (M1-3).
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where stem = '[synthetic] Bank written v2'$$), 'OK 1', 'self-approval: the recruiter submits their own draft');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Bank written v2'$$), 'OK 1', 'self-approval: the recruiter approves their own item');
select pg_temp.op();
select is((select a.details ->> 'self_approved' from public.audit_log as a join public.item_versions as v on v.id = a.object_id where a.action = 'item.approve' and v.stem = '[synthetic] Bank written v2'), 'true', 'self-approval event: self_approved is true');
select pg_temp.u('owner');
select is(pg_temp.try(format($$update public.item_versions set status = 'approved' where id = %L$$, pg_temp.id('qr1'))), 'OK 1', 'approval: an owner is an approver (R5-40)');
-- Send back (R5-22): not_approved is terminal.
select pg_temp.u('reviewer');
select is(pg_temp.try(format($$update public.item_versions set status = 'not_approved' where id = %L$$, pg_temp.id('qr2'))), 'OK 1', 'send back: the reviewer sends an item back');
select pg_temp.u('owner');
select matches(pg_temp.try(format($$update public.item_versions set status = 'approved' where id = %L$$, pg_temp.id('qr2'))), '^42501', 'send back: not_approved is terminal');
select pg_temp.op();
select is((select pg_temp.keys(a.details) || '|' || (a.details ->> 'to') from public.audit_log as a where a.action = 'item.not_approved' and a.object_id = pg_temp.id('qr2')), 'from,item_version_id,self_approved,to|not_approved', 'send back event: item.not_approved');
-- Readiness: an MCQ item needs its key before review; a servable bank item is tagged (AT-M1-02).
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] No difficulty', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'quant', repeat('d', 64))$$), 'OK 1', 'readiness: owner adds an MCQ draft without difficulty or key');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where stem = '[synthetic] No difficulty'$$), '^42501 TRACE_GUARD: a multiple-choice item needs its answer key', 'readiness: an MCQ item without its key cannot be submitted');
select is(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) select org_id, id, 'mcq', '{"option_id": "o2"}' from public.item_versions where stem = '[synthetic] No difficulty'$$), 'OK 1', 'readiness: the key is added to the draft');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where stem = '[synthetic] No difficulty'$$), 'OK 1', 'readiness: then it is submitted');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] No difficulty'$$), '^23514', 'AT-M1-02: an approved bank item needs a difficulty (CHECK)');
select pg_temp.u('owner');
select matches(pg_temp.try($$delete from public.item_versions where stem = '[synthetic] No difficulty'$$), '^42501 TRACE_GUARD: only a draft item version can be deleted', 'versions D: an in-review version is not deleted');
select matches(pg_temp.try(format($$delete from public.item_versions where id = %L$$, pg_temp.id('qa1'))), '^42501 TRACE_GUARD: only a draft item version can be deleted', 'versions D: an approved version is not deleted');
select is(pg_temp.try(format($$delete from public.item_answer_keys where item_version_id = %L$$, pg_temp.id('qdq'))), 'OK 1', 'versions D: the key of a draft version is deleted');
select is(pg_temp.try(format($$delete from public.item_versions where id = %L$$, pg_temp.id('qdq'))), 'OK 1', 'versions D: then the draft version itself');

-- ===== Library expert review (M1-3, ABH-6, AT-M1-02) =====
select pg_temp.u('lib_author');
select is(pg_temp.try(format($$insert into public.item_versions (org_id, item_id, format, stem, options, skill_key, difficulty, content_sha256) values (%L, %L, 'mcq', '[synthetic] Library v2', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', 'verbal', 0.50, repeat('e', 64))$$, pg_temp.id('L'), pg_temp.id('la1_item'))), 'OK 1', 'library: the author adds a new library version');
select is(pg_temp.try($$insert into public.item_answer_keys (org_id, item_version_id, format, key) select org_id, id, 'mcq', '{"option_id": "o1"}' from public.item_versions where stem = '[synthetic] Library v2'$$), 'OK 1', 'library: the author adds its key');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where stem = '[synthetic] Library v2'$$), 'OK 1', 'library: the author submits it');
-- SEC-M1-4 (ABH-6): the key review is an attested action of its own: the reviewer records it on the in-review version
-- (key_reviewed_by null -> themselves, nothing else changes); the approval then requires it and cannot name it.
select matches(pg_temp.try(format($$update public.item_versions set key_reviewed_by = %L where stem = '[synthetic] Library v2'$$, pg_temp.id('lib_author'))), '^42501 TRACE_GUARD: a library item needs a reviewer and a key reviewer other than its author', 'library (SEC-M1-4): the author cannot review their own key');
select matches(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Library v2'$$), '^42501 TRACE_GUARD: a library item needs a reviewer and a key reviewer other than its author', 'library: the author cannot be the reviewer');
select pg_temp.u('owner');
select is(pg_temp.try(format($$update public.item_versions set key_reviewed_by = %L where stem = '[synthetic] Library v2'$$, pg_temp.id('owner'))), 'OK 0', 'library (SEC-M1-4): a customer owner records no library key review');
select matches(pg_temp.try(format($$update public.item_versions set key_reviewed_by = %L where stem = '[synthetic] No difficulty'$$, pg_temp.id('owner'))), '^42501 TRACE_GUARD: an item version is frozen once it leaves draft', 'library (SEC-M1-4): a customer item has no key review step');
select pg_temp.u('lib_expert');
select matches(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Library v2'$$), '^42501 TRACE_GUARD: a library item needs a reviewer and a key reviewer other than its author', 'library: the key review comes before the approval');
select matches(pg_temp.try(format($$update public.item_versions set key_reviewed_by = %L where stem = '[synthetic] Library v2'$$, pg_temp.id('lib_author'))), '^42501 TRACE_GUARD: the key reviewer records their own review', 'library (SEC-M1-4): an expert cannot record a key review in another member''s name');
select matches(pg_temp.try(format($$update public.item_versions set status = 'approved', key_reviewed_by = %L where stem = '[synthetic] Library v2'$$, pg_temp.id('lib_expert'))), '^42501 TRACE_GUARD: the key review is recorded in its own update', 'library (SEC-M1-4): the approval does not name the key reviewer');
select matches(pg_temp.try(format($$update public.item_versions set key_reviewed_by = %L, difficulty = 0.60 where stem = '[synthetic] Library v2'$$, pg_temp.id('lib_expert'))), '^42501 TRACE_GUARD: an item version is frozen once it leaves draft', 'library (SEC-M1-4): the key review changes nothing else');
select is(pg_temp.try(format($$update public.item_versions set key_reviewed_by = %L where stem = '[synthetic] Library v2'$$, pg_temp.id('lib_expert'))), 'OK 1', 'library (SEC-M1-4): the expert records their own key review');
select matches(pg_temp.try(format($$update public.item_versions set key_reviewed_by = %L where stem = '[synthetic] Library v2'$$, pg_temp.id('lib_author'))), '^42501 TRACE_GUARD: an item version is frozen once it leaves draft', 'library (SEC-M1-4): a recorded key review is final');
select is(pg_temp.try($$update public.item_versions set status = 'approved' where stem = '[synthetic] Library v2'$$), 'OK 1', 'library: an expert other than the author approves after the key review');
select pg_temp.op();
select is((select (reviewed_by = pg_temp.id('lib_expert'))::text || '|' || (key_reviewed_by = pg_temp.id('lib_expert'))::text || '|' || (approved_by = pg_temp.id('lib_expert'))::text from public.item_versions where stem = '[synthetic] Library v2'), 'true|true|true', 'library: reviewer, key reviewer and approver recorded');
select is((select pg_temp.keys(details) || '|' || actor_kind::text || '|' || (actor_user_id = pg_temp.id('lib_expert'))::text || '|' || (details ->> 'item_version_id' = object_id::text)::text from public.audit_log where action = 'item.key_review' and object_id = (select id from public.item_versions where stem = '[synthetic] Library v2')), 'item_version_id|org_user|true|true', 'library (carried Low): the key review is audited as item.key_review by its reviewer');

-- ===== Library copy (R2-5, R3-4, R3-8, E7, E8) =====
select pg_temp.u('owner');
select is(pg_temp.try(format($$insert into public.library_copy_requests (id, org_id, workspace_id, library_item_version_ids) values ('c4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[%L]::uuid[])$$, pg_temp.id('la1'))), 'OK 1', 'library copy: owner copies an approved library item into workspace A1');
select pg_temp.op();
select is((select v.origin || '|' || v.status::text || '|' || (v.approved_by = pg_temp.id('owner'))::text || '|' || coalesce(v.reviewed_by::text, 'null') || '|' || (v.workspace_id = pg_temp.id('A1'))::text || '|' || (r.result_item_version_ids = array[v.id])::text from public.item_versions as v join public.library_copy_requests as r on r.id = 'c4000000-0000-4000-8000-000000000001' where v.org_id = pg_temp.id('A') and v.source_item_version_id = pg_temp.id('la1')), 'library|approved|true|null|true|true', 'library copy: an approved copy by the copier, no expert reviewer in the customer org, ids returned (R2-10, R3-4)');
select is((select count(*)::int from public.item_answer_keys as k join public.item_versions as v on v.id = k.item_version_id where v.org_id = pg_temp.id('A') and v.source_item_version_id = pg_temp.id('la1') and k.library_sourced), 1, 'library copy: the key is copied as library_sourced');
select pg_temp.u('owner');
select is(pg_temp.try(format($$insert into public.library_copy_requests (id, org_id, workspace_id, library_item_version_ids) values ('c4000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[%L]::uuid[])$$, pg_temp.id('la1'))), 'OK 1', 'library copy: a second request for the same item succeeds');
select pg_temp.op();
select is((select count(*)::int from public.item_versions where org_id = pg_temp.id('A') and source_item_version_id = pg_temp.id('la1')), 1, 'library copy: the existing copy is reused (one copy per workspace and library version)');
select is((select pg_temp.keys(details) || '|' || (details ->> 'count') || '|' || (details ->> 'reused') from public.audit_log where action = 'library.copy' and object_id = 'c4000000-0000-4000-8000-000000000002'), 'count,reused|0|1', 'library copy event: counts only');
select pg_temp.u('owner');
select matches(pg_temp.try(format($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[%L]::uuid[])$$, pg_temp.id('la2'))), '^42501 TRACE_GUARD: only approved library items can be copied', 'library copy: an in-review library item cannot be copied');
select matches(pg_temp.try(format($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[%L]::uuid[])$$, pg_temp.id('qa1'))), '^42501 TRACE_GUARD: only approved library items can be copied', 'library copy: a customer item is not a library item');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try(format($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[%L]::uuid[])$$, pg_temp.id('la1'))), '^42501', 'library copy: workspace recruiter cannot copy into workspace A1 (fence)');
select pg_temp.u('reviewer');
select matches(pg_temp.try(format($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[%L]::uuid[])$$, pg_temp.id('la1'))), '^42501', 'library copy: a reviewer cannot copy');
select pg_temp.u('lib_author');
select matches(pg_temp.try(format($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values (%L, %L, array[%L]::uuid[])$$, pg_temp.id('L'), pg_temp.id('LW'), pg_temp.id('la1'))), '^42501 TRACE_GUARD: a copy goes from the library into a customer org', 'library copy: the library does not copy into itself');
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.library_copy_requests set result_item_version_ids = null where id = 'c4000000-0000-4000-8000-000000000001'$$), '^42501', 'library copy: a request is immutable');
-- E8: the daily cap. 1,998 more copies made today (operator path) bring org A to 1,999; one more copy fits, the next does not.
select pg_temp.op();
create temp table cap_src as select gen_random_uuid() as item, gen_random_uuid() as ver, n from generate_series(1, 2000) as n;
grant select on cap_src to public;
insert into public.items (id, org_id, workspace_id, format, skill_key, created_by)
  select item, pg_temp.id('L'), pg_temp.id('LW'), 'written', 'written_communication', pg_temp.id('lib_author') from cap_src;
insert into public.item_versions (id, org_id, item_id, format, stem, rubric_version_id, skill_key, difficulty, content_sha256, created_by)
  select ver, pg_temp.id('L'), item, 'written', '[synthetic] Cap ' || n, (select id from public.rubric_versions where org_id = pg_temp.id('L') and rubric_key = 'default'), 'written_communication', 0.50, repeat('e', 64), pg_temp.id('lib_author') from cap_src;
update public.item_versions set status = 'in_review' where id in (select ver from cap_src);
update public.item_versions set status = 'approved', approved_by = pg_temp.id('lib_expert'), reviewed_by = pg_temp.id('lib_expert'), key_reviewed_by = pg_temp.id('lib_expert') where id in (select ver from cap_src);
create temp table cap_copy as select gen_random_uuid() as item, ver as src, n from cap_src where n <= 1998;
insert into public.items (id, org_id, workspace_id, format, skill_key) select item, pg_temp.id('A'), pg_temp.id('A2'), 'written', 'written_communication' from cap_copy;
insert into public.item_versions (org_id, item_id, format, stem, rubric_version_id, skill_key, difficulty, content_sha256, origin, source_item_version_id)
  select pg_temp.id('A'), item, 'written', '[synthetic] Copy ' || n, (select id from public.rubric_versions where org_id = pg_temp.id('A') and rubric_key = 'default'), 'written_communication', 0.50, repeat('e', 64), 'library', src from cap_copy;
select is((select count(*)::int from public.item_versions where org_id = pg_temp.id('A') and origin = 'library'), 1999, 'library cap: org A holds 1,999 library copies made today');
select pg_temp.u('owner');
select is(pg_temp.try($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) select 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[ver] from cap_src where n = 1999$$), 'OK 1', 'library cap: the 2,000th copy of the day is made');
select matches(pg_temp.try($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) select 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[ver] from cap_src where n = 2000$$), '^42501 TRACE_GUARD: library copy cap reached', 'library cap: the 2,001st is refused (E8)');
select is(pg_temp.try(format($$insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', array[%L]::uuid[])$$, pg_temp.id('la1'))), 'OK 1', 'library cap: reusing an existing copy is not counted');

-- ===== AT-M1-06: the share metric counts approved quant items only =====
select pg_temp.u('owner');
select is((select quant_items_approved || '/' || quant_items_parameterised from public.v_item_bank_quant_share where workspace_id = pg_temp.id('A1')), '3/1', 'AT-M1-06: workspace A1 has 3 approved quant items, 1 parameterised (retired, draft, other skills and inline items not counted)');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.v_item_bank_quant_share where org_id = pg_temp.id('A')), 0, 'AT-M1-06: org B sees no org A share row');

-- ===== Reads by other roles =====
select pg_temp.u('reviewer');
select is((select count(*)::int from public.item_versions where section_id is null and status = 'in_review') >= 1, true, 'versions S: the reviewer sees in-review bank rows of their workspaces');
select pg_temp.u('ws_reviewer');
select is((select count(*)::int from public.item_versions where section_id is null and workspace_id = pg_temp.id('A1')), 0, 'versions S: a workspace-fenced reviewer sees no workspace A1 bank row');
select is((select count(*)::int from public.item_versions where id = pg_temp.id('q2r')), 1, 'versions S: a workspace-fenced reviewer sees the workspace A2 row');
select pg_temp.u('hm');
select is((select count(*)::int from public.item_versions), 0, 'versions S: hiring manager sees nothing');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select is((select count(*)::int from public.item_versions where section_id is null) > 0, true, 'versions S: the quality worker reads bank rows of its job org');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select is((select count(*)::int from public.item_versions where org_id <> pg_temp.id('A')), 0, 'versions S: the authoring worker reads only its job org');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.item_versions'), '^42501 permission denied', 'versions S: trace_api has no grant on item_versions');
select pg_temp.op();
set local role trace_candidate;
select matches(pg_temp.try('select * from public.items'), '^42501 permission denied', 'items S: trace_candidate has no privilege');
select pg_temp.op();

-- ===== AT-M1-25: M1 audit details are ids, enums, booleans and counts only =====
select is((select count(*)::int from public.audit_log where (action like 'item.%' or action = 'library.copy') and exists (select 1 from jsonb_each(details) as e where jsonb_typeof(e.value) not in ('string', 'boolean', 'number'))), 0, 'AT-M1-25: no item or library audit row carries a nested or free-text structure');
select is((select count(*)::int from public.audit_log where action in ('item.submit', 'item.approve', 'item.not_approved', 'item.retire') and pg_temp.keys(details) <> 'from,item_version_id,self_approved,to'), 0, 'AT-M1-25: every item transition carries exactly item_version_id, from, to, self_approved');
select is((select count(*)::int from public.audit_log where action in ('item.submit', 'item.approve', 'item.not_approved', 'item.retire') and ((details ->> 'item_version_id') !~ '^[0-9a-f-]{36}$' or (details ->> 'from') not in ('draft', 'in_review', 'approved') or (details ->> 'to') not in ('in_review', 'approved', 'not_approved', 'retired'))), 0, 'AT-M1-25: transition values are an id and status enums');

-- ===== DB-M1-10: the indexes behind the workspace reads and the library copy cap =====
select is((select string_agg(indexname || ':' || indexdef, '; ' order by indexname) from pg_indexes where schemaname = 'public' and indexname in ('item_exposure_events_workspace_idx', 'section_pool_snapshot_workspace_idx', 'item_versions_library_copy_day_idx')), 'item_exposure_events_workspace_idx:CREATE INDEX item_exposure_events_workspace_idx ON public.item_exposure_events USING btree (org_id, workspace_id); item_versions_library_copy_day_idx:CREATE INDEX item_versions_library_copy_day_idx ON public.item_versions USING btree (org_id, origin, created_at) WHERE (origin = ''library''::text); section_pool_snapshot_workspace_idx:CREATE INDEX section_pool_snapshot_workspace_idx ON public.section_pool_snapshot USING btree (org_id, workspace_id)', 'DB-M1-10: exposure events and snapshot rows are indexed by workspace, library copies by org and day');
