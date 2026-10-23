-- rls_m1_variants (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_variants; §3.2 item_variants, §4.1, §6.3, I-M1-4; AT-M1-05; R2-22, R3-4). RED first: written from the spec before migration M1-a. Personas and items are synthetic.
-- Fixtures: a parameterised MCQ draft P (difficulty 0.50) in workspace A1, one in A2, and a plain approved MCQ item.
select pg_temp.bank('qa1', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant', 0.50, 'approved');
insert into public.items (id, org_id, workspace_id, format, skill_key) values
  ('c2000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant'),
  ('c2000000-0000-4000-8000-000000000002', pg_temp.id('A'), pg_temp.id('A2'), 'mcq', 'quant');
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256) values
  ('c2100000-0000-4000-8000-000000000001', pg_temp.id('A'), 'c2000000-0000-4000-8000-000000000001', 'mcq', '[synthetic] P',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64)),
  ('c2100000-0000-4000-8000-000000000002', pg_temp.id('A'), 'c2000000-0000-4000-8000-000000000002', 'mcq', '[synthetic] P2',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64));

-- ===== param_spec shape (§5 ParamSpec) =====
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.item_versions set param_spec = '{"params": {}, "stem": "x", "options": [], "correctOptionId": "o1", "count": 5}' where id = 'c2100000-0000-4000-8000-000000000001'$$), '^23514', 'param_spec: a spec without parameters or options violates its CHECK');
select matches(pg_temp.try($$update public.item_versions set is_parameterised = true, param_spec = null where id = 'c2100000-0000-4000-8000-000000000001'$$), '^23514', 'param_spec: a parameterised item needs its spec');

-- ===== I: variants of a draft, ±0.10 (AT-M1-05) =====
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 1, '{"a": 3}', '[synthetic] What is 3 + 1?', '[{"id": "o1", "text": "4"}, {"id": "o2", "text": "3"}]', 0.60, repeat('c', 64))$$), 'OK 1', 'AT-M1-05: a variant 0.10 above its item is accepted');
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 2, '{"a": 4}', '[synthetic] What is 4 + 1?', '[{"id": "o1", "text": "5"}, {"id": "o2", "text": "4"}]', 0.40, repeat('c', 64))$$), 'OK 1', 'AT-M1-05: a variant 0.10 below its item is accepted');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 3, '{"a": 5}', '[synthetic] What is 5 + 1?', '[{"id": "o1", "text": "6"}, {"id": "o2", "text": "5"}]', 0.61, repeat('c', 64))$$), '^23514 TRACE_GUARD: a variant difficulty must be within 0.10 of its item', 'AT-M1-05: a variant 0.11 away is refused');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 3, '{"a": 5}', '[synthetic] What is 5 + 1?', '[{"id": "o1", "text": "6"}, {"id": "o2", "text": "5"}]', 0.39, repeat('c', 64))$$), '^23514 TRACE_GUARD: a variant difficulty must be within 0.10 of its item', 'AT-M1-05: a variant 0.11 below is refused');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 1, '{"a": 6}', '[synthetic] What is 6 + 1?', '[{"id": "o1", "text": "7"}, {"id": "o2", "text": "6"}]', 0.50, repeat('c', 64))$$), '^23505', 'variants I: variant numbers are unique per item version');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 4, '{"a": {"nested": 1}}', '[synthetic] x', '[{"id": "o1", "text": "7"}, {"id": "o2", "text": "6"}]', 0.50, repeat('c', 64))$$), '^23514', 'variants I: params are scalars only');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 4, '{"a": 7}', '[synthetic] x', '[{"id": "o1", "text": "7"}]', 0.50, repeat('c', 64))$$), '^23514', 'variants I: variant options are 2 to 6 MCQ options');
select matches(pg_temp.try(format($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', %L, 1, '{"a": 7}', '[synthetic] x', '[{"id": "o1", "text": "7"}, {"id": "o2", "text": "6"}]', 0.50, repeat('c', 64))$$, pg_temp.id('qa1'))), '^42501 TRACE_GUARD: variants change only while their parameterised item is a draft', 'variants I: an item that is not parameterised (and approved) takes no variant');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 5, '{"a": 8}', '[synthetic] x', '[{"id": "o1", "text": "9"}, {"id": "o2", "text": "8"}]', 0.50, repeat('c', 64))$$), '^42501', 'variants I: workspace recruiter cannot add a variant to a workspace A1 item');
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000002', 1, '{"a": 8}', '[synthetic] What is 8 + 1?', '[{"id": "o1", "text": "9"}, {"id": "o2", "text": "8"}]', 0.50, repeat('c', 64))$$), 'OK 1', 'variants I: workspace recruiter adds a variant to a workspace A2 item');
select pg_temp.u('reviewer');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 6, '{"a": 2}', '[synthetic] x', '[{"id": "o1", "text": "3"}, {"id": "o2", "text": "2"}]', 0.50, repeat('c', 64))$$), '^42501', 'variants I: a reviewer cannot add a variant');
select pg_temp.u('b_admin');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 6, '{"a": 2}', '[synthetic] x', '[{"id": "o1", "text": "3"}, {"id": "o2", "text": "2"}]', 0.50, repeat('c', 64))$$), '^42501', 'variants I: org B admin cannot add a variant in org A');
select pg_temp.op();
select is((select workspace_id from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000002'), pg_temp.id('A2'), 'variants I: the workspace comes from the item version');

-- ===== S =====
select pg_temp.u('reviewer');
select is((select count(*)::int from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001'), 2, 'variants S: the reviewer reads the variants of their workspace');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001'), 0, 'variants S: workspace recruiter reads no workspace A1 variant');
select pg_temp.u('hm');
select is((select count(*)::int from public.item_variants), 0, 'variants S: hiring manager reads nothing');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select is((select count(*)::int from public.item_variants), 3, 'variants S: the quality worker reads the variants of its job org');
select pg_temp.w('trace_quality_worker', pg_temp.id('B'));
select is((select count(*)::int from public.item_variants), 0, 'variants S: the quality worker bound to org B reads no org A variant');

-- ===== Readiness on leaving draft, immutability (I-M1-4, R2-22) =====
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: every variant needs its answer key', 'readiness: a parameterised item needs a key on every variant');
select is(pg_temp.try($$insert into public.item_variant_keys (org_id, item_variant_id, key) select org_id, id, '{"option_id": "o1"}' from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001'$$), 'OK 2', 'readiness: both variants are keyed');
select is(pg_temp.try($$update public.item_versions set difficulty = 0.70 where id = 'c2100000-0000-4000-8000-000000000001'$$), 'OK 1', 'readiness: the draft item difficulty moves to 0.70');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000001'$$), '^23514 TRACE_GUARD: a variant difficulty must be within 0.10 of its item', 'readiness: the 0.40 variant is now 0.30 away, so the item cannot be submitted');
select is(pg_temp.try($$delete from public.item_variant_keys where item_variant_id in (select id from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001' and variant_no = 2)$$), 'OK 1', 'regeneration: the key of the far variant is deleted while the item is a draft');
select is(pg_temp.try($$delete from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001' and variant_no = 2$$), 'OK 1', 'regeneration: the far variant itself is deleted (R2-22)');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000001'$$), 'OK 1', 'readiness: with one keyed variant within 0.10, the item is submitted');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000001', 7, '{"a": 2}', '[synthetic] x', '[{"id": "o1", "text": "3"}, {"id": "o2", "text": "2"}]', 0.70, repeat('c', 64))$$), '^42501 TRACE_GUARD: variants change only while their parameterised item is a draft', 'immutability: no variant is added once the item leaves draft');
select matches(pg_temp.try($$delete from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: variants change only while their parameterised item is a draft', 'immutability: no variant is deleted once the item leaves draft');
select pg_temp.op();
select matches(pg_temp.try($$update public.item_variants set stem = 'changed' where item_version_id = 'c2100000-0000-4000-8000-000000000001'$$), '^42501 TRACE_GUARD: variants are immutable', 'immutability: a variant is never updated, even on the operator path');
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.item_variants set stem = 'changed'$$), '^42501 permission denied', 'immutability: no update grant on variants');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000002'$$), '^42501 TRACE_GUARD: every variant needs its answer key', 'readiness: the A2 item without variant keys cannot be submitted');
select is(pg_temp.try($$delete from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000002'$$), 'OK 1', 'regeneration: the A2 variant is deleted');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000002'$$), '^42501 TRACE_GUARD: a parameterised item needs its variants', 'readiness: a parameterised item without variants cannot be submitted');

-- ===== DB-M1-6 (R5-33): variants and their keys are never truncated, even by the owner =====
select pg_temp.op();
-- TRUNCATE CASCADE from item_variants reaches the append-only D1 tables whose TRUNCATE is revoked from the owner; the
-- privilege is re-granted for this rolled-back test (as rls_d1_consents does), so only a trigger can refuse it. The named
-- table's BEFORE TRUNCATE trigger fires first.
do $do$
declare
  r record;
begin
  for r in
    select c.oid::regclass as rel from pg_class as c
    where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace)
      and c.relkind in ('r', 'p') and not has_table_privilege('postgres', c.oid, 'TRUNCATE')
  loop
    execute format('grant truncate on %s to postgres', r.rel);
  end loop;
end
$do$;
select matches(pg_temp.try('truncate public.item_variants cascade'), '^42501 TRACE_GUARD: bank content is never truncated', 'DB-M1-6: TRUNCATE item_variants is refused on the operator path');
select matches(pg_temp.try('truncate public.item_variant_keys'), '^42501 TRACE_GUARD: bank content is never truncated', 'DB-M1-6: TRUNCATE item_variant_keys is refused on the operator path');
select is((select string_agg(tgname || '=' || tgenabled::text, ',' order by tgname) from pg_trigger where tgname in ('item_variants_no_truncate', 'item_variant_keys_no_truncate')), 'item_variant_keys_no_truncate=A,item_variants_no_truncate=A', 'DB-M1-6: both truncate triggers are ENABLE ALWAYS');
select is((select count(*)::int from public.item_variants) > 0, true, 'DB-M1-6: the variants are still there');

-- ===== Migration M1-e (A1 DB review Lows): a difficulty has at most two decimals (never rounded); variants are 1..n =====
select pg_temp.op();
insert into public.items (id, org_id, workspace_id, format, skill_key) values
  ('c2000000-0000-4000-8000-000000000003', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'quant');
insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, is_parameterised, param_spec, content_sha256) values
  ('c2100000-0000-4000-8000-000000000003', pg_temp.id('A'), 'c2000000-0000-4000-8000-000000000003', 'mcq', '[synthetic] P3',
   '[{"id": "o1", "text": "a + 1"}, {"id": "o2", "text": "a"}]', 'quant', 0.50, true,
   '{"params": {"a": {"kind": "int", "min": 1, "max": 9, "step": 1}}, "stem": "What is {{a}} + 1?", "options": [{"id": "o1", "text": "{{a}} + 1"}, {"id": "o2", "text": "{{a}}"}], "correctOptionId": "o1", "count": 5}',
   repeat('c', 64));
select pg_temp.u('owner');
select matches(pg_temp.try($$update public.item_versions set difficulty = 0.505 where id = 'c2100000-0000-4000-8000-000000000003'$$), '^23514', 'M1-e: an item difficulty with a third decimal is refused, never rounded to 0.51');
select is((select difficulty::text from public.item_versions where id = 'c2100000-0000-4000-8000-000000000003'), '0.50', 'M1-e: the item difficulty is unchanged');
select matches(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000003', 1, '{"a": 3}', '[synthetic] What is 3 + 1?', '[{"id": "o1", "text": "4"}, {"id": "o2", "text": "3"}]', 0.405, repeat('c', 64))$$), '^23514', 'M1-e: a variant difficulty of 0.405 is refused, never rounded to 0.41');
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000003', 1, '{"a": 3}', '[synthetic] What is 3 + 1?', '[{"id": "o1", "text": "4"}, {"id": "o2", "text": "3"}]', 0.55, repeat('c', 64))$$), 'OK 1', 'M1-e: variant 1 at 0.55 is stored');
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000003', 3, '{"a": 5}', '[synthetic] What is 5 + 1?', '[{"id": "o1", "text": "6"}, {"id": "o2", "text": "5"}]', 0.45, repeat('c', 64))$$), 'OK 1', 'M1-e: variant 3 is stored (number 2 is missing)');
select is(pg_temp.try($$insert into public.item_variant_keys (org_id, item_variant_id, key) select org_id, id, '{"option_id": "o1"}' from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000003'$$), 'OK 2', 'M1-e: both variants are keyed');
select matches(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000003'$$), '^42501 TRACE_GUARD: variants are numbered 1 to n', 'M1-e: variants 1 and 3 without 2 cannot be submitted');
select is(pg_temp.try($$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000003', 2, '{"a": 4}', '[synthetic] What is 4 + 1?', '[{"id": "o1", "text": "5"}, {"id": "o2", "text": "4"}]', 0.50, repeat('c', 64))$$), 'OK 1', 'M1-e: variant 2 fills the gap');
select is(pg_temp.try($$insert into public.item_variant_keys (org_id, item_variant_id, key) select org_id, id, '{"option_id": "o1"}' from public.item_variants where item_version_id = 'c2100000-0000-4000-8000-000000000003' and variant_no = 2$$), 'OK 1', 'M1-e: variant 2 is keyed');
select is(pg_temp.try($$update public.item_versions set status = 'in_review' where id = 'c2100000-0000-4000-8000-000000000003'$$), 'OK 1', 'M1-e: variants 1 to 3 are submitted');
select pg_temp.op();
