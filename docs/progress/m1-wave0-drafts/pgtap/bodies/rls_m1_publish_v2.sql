-- rls_m1_publish_v2 (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_publish_v2; §3.3 sections, test_versions; §3.4 publish guard v2; §4.2; AT-M1-08 (publish half), AT-M1-13, AT-M1-14; R2-1, R2-13, R3-1, R5-9, R5-33; E1, E4). RED first: written from the spec before migration M1-b. Personas and items are synthetic.
-- Fixtures (operator path): pool PA = approved MCQ items pa1..pa11 plus the parameterised item pq; written pool PW =
-- approved written items pw1..pw10; pool PX (archived); pool PBIG = 101 approved MCQ items; an AI draft ai1 (in review).
select pg_temp.bank('pa' || n, pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved') from generate_series(1, 11) as n;
select pg_temp.bank('pw' || n, pg_temp.id('A'), pg_temp.id('A1'), 'written', 'written_communication', 0.50, 'approved') from generate_series(1, 10) as n;
select pg_temp.bank('big' || n, pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'reading', 0.50, 'approved') from generate_series(1, 101) as n;
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
insert into pg_temp.ids values ('pq', 'c2100000-0000-4000-8000-000000000001'), ('pqv', 'c2200000-0000-4000-8000-000000000001');
select pg_temp.ai_draft('ai1', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.pools (id, org_id, workspace_id, name, format) values
  ('d1000000-0000-4000-8000-0000000000a1', pg_temp.id('A'), pg_temp.id('A1'), 'Pool PA', 'mcq'),
  ('d1000000-0000-4000-8000-0000000000a2', pg_temp.id('A'), pg_temp.id('A1'), 'Pool PW', 'written'),
  ('d1000000-0000-4000-8000-0000000000a3', pg_temp.id('A'), pg_temp.id('A1'), 'Pool PX', 'mcq'),
  ('d1000000-0000-4000-8000-0000000000a4', pg_temp.id('A'), pg_temp.id('A1'), 'Pool PBIG', 'mcq');
insert into public.pool_items (org_id, pool_id, item_version_id)
  select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000a1'::uuid, pg_temp.id('pa' || n) from generate_series(1, 11) as n
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000a1'::uuid, pg_temp.id('pq')
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000a2'::uuid, pg_temp.id('pw' || n) from generate_series(1, 10) as n
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000a3'::uuid, pg_temp.id('pa1')
  union all select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000a4'::uuid, pg_temp.id('big' || n) from generate_series(1, 101) as n;
update public.pools set status = 'archived' where id = 'd1000000-0000-4000-8000-0000000000a3';
-- Draft p: s1 draws 1 from PA (mcq), s2 draws 1 from PW (written), s3 is inline with one item. No settings yet.
select pg_temp.tv('p', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('ps1', 'p', 1, 'mcq', 'd1000000-0000-4000-8000-0000000000a1', 1, 40);
select pg_temp.sec('ps2', 'p', 2, 'written', 'd1000000-0000-4000-8000-0000000000a2', 1, 30);
select pg_temp.sec('ps3', 'p', 3, 'mcq', null, null, 30);
select pg_temp.inline('pi1', 'ps3');
insert into pg_temp.ids select 'p_rs', ruleset_version_id from public.test_versions where id = pg_temp.id('p');

-- ===== Publish refusals (§3.4, each checked alone; a refused publish changes nothing) =====
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a version that uses M1 features needs its integrity settings', 'publish (R3-1): a version with pool sections needs its settings');
select pg_temp.preset('p', 'standard');
update public.sections set navigation = null where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: every section of a version 2 test has its navigation', 'publish (R2-1): every v2 section names its navigation');
update public.sections set navigation = 'free' where id = pg_temp.id('ps1');
update public.sections set draw_count = 13 where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: the pool has fewer approved items than the section draws', 'publish (E4): a draw larger than the approved pool is refused');
update public.sections set draw_count = 1 where id = pg_temp.id('ps1');
select pg_temp.inline('pi_bad', 'ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a section either serves its own items or draws from one pool', 'publish (M1-1): a pool section with its own items is refused');
delete from public.item_answer_keys where item_version_id = pg_temp.id('pi_bad');
delete from public.item_versions where id = pg_temp.id('pi_bad');
update public.sections set pool_id = 'd1000000-0000-4000-8000-0000000000a3' where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a section draws from an active pool of its format', 'publish: an archived pool is refused');
update public.sections set pool_id = 'd1000000-0000-4000-8000-0000000000a2' where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a section draws from an active pool of its format', 'publish: an MCQ section cannot draw from a written pool');
update public.sections set pool_id = 'd1000000-0000-4000-8000-0000000000a1' where id = pg_temp.id('ps1');
update public.sections set weight = 50 where id = pg_temp.id('ps3');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: section weights must sum to 100', 'publish (R2-13, Q26): v2 section weights sum to 100');
update public.sections set weight = 30 where id = pg_temp.id('ps3');
update public.sections set time_limit_seconds = 600 where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: either every section is timed or none is', 'publish (M1-11): section timers are all or none');
update public.sections set time_limit_seconds = 500 where test_version_id = pg_temp.id('p');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: the total time is the sum of the section times', 'publish (M1-11): a timed version''s total is the sum of its sections');
update public.sections set time_limit_seconds = null where test_version_id = pg_temp.id('p');
update public.sections set pool_id = 'd1000000-0000-4000-8000-0000000000a4', draw_count = 101 where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a candidate is served at most 100 items', 'publish (R5-9): more than 100 served items are refused');
update public.sections set pool_id = 'd1000000-0000-4000-8000-0000000000a1', draw_count = 1 where id = pg_temp.id('ps1');
-- DB-M1-1 (rule 3, fairness): a written section's paste rule is the test's paste setting (Standard: allowed_logged).
update public.sections set paste_rule = null where id = pg_temp.id('ps2');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a written section of a version 2 test has its paste rule', 'publish (DB-M1-1): a v2 written section names its paste rule');
update public.sections set paste_rule = 'blocked' where id = pg_temp.id('ps2');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a written section''s paste rule follows the test''s paste setting', 'publish (DB-M1-1): a paste rule other than the settings'' paste_written is refused');
update public.sections set paste_rule = 'allowed_logged' where id = pg_temp.id('ps2');
-- DB-M1-12: a section's strata quotas sum to its draw; an inline section has no strata.
update public.sections set blueprint = '{"strata": [{"skillKey": "verbal", "difficultyBand": 2, "count": 1}, {"skillKey": "quant", "difficultyBand": 2, "count": 1}]}' where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a section''s strata quotas sum to its draw', 'publish (DB-M1-12): strata quotas that do not sum to the draw are refused');
update public.sections set blueprint = '{"strata": [{"skillKey": "verbal", "difficultyBand": 2, "count": "one"}]}' where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a section''s strata quotas sum to its draw', 'publish (DB-M1-12): a quota that is not a number is refused');
update public.sections set blueprint = '{"strata": [{"skillKey": "verbal", "difficultyBand": 2, "count": 1}]}' where id = pg_temp.id('ps3');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a section''s strata quotas sum to its draw', 'publish (DB-M1-12): an inline section takes no strata');
update public.sections set blueprint = null where id = pg_temp.id('ps3');
update public.sections set blueprint = '{"strata": [{"skillKey": "verbal", "difficultyBand": 2, "count": 0.5}, {"skillKey": "quant", "difficultyBand": 2, "count": 0.5}]}' where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a section''s strata quotas sum to its draw', 'publish (carried Low): a fractional quota is refused even when the quotas sum to the draw');
update public.sections set blueprint = '{"strata": [{"skillKey": "verbal", "difficultyBand": 2, "count": 1}, {"skillKey": "quant", "difficultyBand": 2, "count": 0}]}' where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a section''s strata quotas sum to its draw', 'publish (carried Low): a zero quota is refused');
update public.sections set blueprint = '{"strata": [{"skillKey": "verbal", "difficultyBand": 2, "count": 2}, {"skillKey": "quant", "difficultyBand": 2, "count": -1}]}' where id = pg_temp.id('ps1');
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: a section''s strata quotas sum to its draw', 'publish (carried Low): a negative quota is refused');
select matches(pg_get_functiondef('private.test_versions_guard'::regproc), 'from public\.ruleset_versions as r where r\.org_id = new\.org_id and r\.id = new\.ruleset_version_id\s+for share;', 'publish (carried Low): the pinned ruleset is read for share, so its settings cannot change under the publish');
update public.sections set blueprint = '{"strata": [{"skillKey": "verbal", "difficultyBand": 2, "count": 1}]}' where id = pg_temp.id('ps1');
select pg_temp.sec('ps4', 'p', 4, 'mcq', null, null, 1);
select matches(pg_temp.try($$select pg_temp.publish('p')$$), '^42501 TRACE_GUARD: every section needs at least one item', 'publish (R2-1): an inline section without items is refused');
delete from public.sections where id = pg_temp.id('ps4');
update public.sections set shuffle_options = true, shuffle_items = true where id = pg_temp.id('ps1');
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('p')), 0, 'publish: refused publishes wrote no snapshot');
select is((select status::text from public.test_versions where id = pg_temp.id('p')), 'draft', 'publish: the version is still a draft');
-- DB-M1-1: a paste rule alone makes a version 2 draft, so it needs its settings.
select pg_temp.tv('pw0', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.sections (id, org_id, test_version_id, position, name, format, weight, paste_rule) values
  ('51000000-0000-4000-8000-0000000000e9', pg_temp.id('A'), pg_temp.id('pw0'), 1, 'Essay', 'written', 100, 'blocked');
insert into public.item_versions (org_id, section_id, format, position, stem, rubric_version_id, content_sha256) values
  (pg_temp.id('A'), '51000000-0000-4000-8000-0000000000e9', 'written', 1, '[synthetic] Essay',
   (select r.id from public.rubric_versions as r where r.org_id = pg_temp.id('A') and r.rubric_key = 'default'), repeat('c', 64));
select matches(pg_temp.try($$select pg_temp.publish('pw0')$$), '^42501 TRACE_GUARD: a version that uses M1 features needs its integrity settings', 'publish (DB-M1-1): a paste rule without settings is refused');

-- ===== AT-M1-08 (publish half): an unapproved AI draft never enters a snapshot =====
select matches(pg_temp.try(format($$insert into public.pool_items (org_id, pool_id, item_version_id) values (%L, 'd1000000-0000-4000-8000-0000000000a1', %L)$$, pg_temp.id('A'), pg_temp.id('ai1'))), '^42501 TRACE_GUARD: a pool holds approved bank items of its format', 'AT-M1-08: an in-review AI draft cannot join a pool, even on the operator path');
select pg_temp.u('reviewer');
select is(pg_temp.try(format($$update public.item_versions set status = 'approved' where id = %L$$, pg_temp.id('ai1'))), 'OK 1', 'AT-M1-08: a reviewer of the workspace approves the AI draft');
select pg_temp.op();
select is((select (approved_by = pg_temp.id('reviewer'))::text || '|' || (approved_at is not null)::text from public.item_versions where id = pg_temp.id('ai1')), 'true|true', 'AT-M1-08: the approver is logged on the version');
insert into public.pool_items (org_id, pool_id, item_version_id) values (pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000a1', pg_temp.id('ai1'));

-- ===== Publish (R3-2): the snapshot holds every approved pool item and the inline item =====
select is(pg_temp.try($$select pg_temp.publish('p')$$), 'OK 1', 'publish: the corrected v2 version publishes');
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('p')), 11 + 1 + 1 + 10 + 1, 'publish: the snapshot holds pa1..pa11, pq, ai1, pw1..pw10 and the inline item');
select is((select bool_and(i.status = 'approved' and (i.origin <> 'ai_draft' or i.approved_by is not null)) from public.section_pool_snapshot as sp join public.item_versions as i on i.id = sp.item_version_id where sp.test_version_id = pg_temp.id('p')), true, 'AT-M1-08: every snapshotted item is approved, every AI draft with its approver');
select is((select package_version::text || '|' || min_pool_ratio::text from public.test_versions where id = pg_temp.id('p')), '2|10.00', 'publish: package 2; min ratio = PW 10 items / draw 1');
select is((select published_at is not null from public.ruleset_versions where id = pg_temp.id('p_rs')), true, 'publish: the ruleset freezes with the version');

-- ===== AT-M1-13 / R5-33: nothing a published version references can change, for any role or the operator =====
create function pg_temp.frozen_probe() returns text language plpgsql as $f$
declare v_out text := ''; v_sql text; v_r text;
begin
  foreach v_sql in array array[
    $$update public.test_versions set quality_cutoff = 41 where id = pg_temp.id('p')$$,
    $$update public.test_versions set min_pool_ratio = 1, package_version = 1 where id = pg_temp.id('p')$$,
    $$update public.test_versions set status = 'draft', published_at = null where id = pg_temp.id('p')$$,
    $$delete from public.test_versions where id = pg_temp.id('p')$$,
    $$update public.sections set weight = 1 where test_version_id = pg_temp.id('p')$$,
    $$update public.sections set draw_count = 2, shuffle_items = false where id = pg_temp.id('ps1')$$,
    $$delete from public.sections where test_version_id = pg_temp.id('p')$$,
    $$update public.item_versions set stem = 'changed' where id = pg_temp.id('pi1')$$,
    $$delete from public.item_versions where id = pg_temp.id('pi1')$$,
    $$update public.item_answer_keys set key = '{"option_id": "o2"}' where item_version_id = pg_temp.id('pi1')$$,
    $$delete from public.item_answer_keys where item_version_id = pg_temp.id('pi1')$$,
    $$update public.ruleset_versions set settings = settings || '{"paste_written": "blocked"}' where id = pg_temp.id('p_rs')$$,
    $$update public.ruleset_versions set signal_settings = '{}' where id = pg_temp.id('p_rs')$$,
    $$update public.section_pool_snapshot set exposure_at_publish = 7 where test_version_id = pg_temp.id('p')$$,
    $$delete from public.section_pool_snapshot where test_version_id = pg_temp.id('p')$$,
    $$update public.item_versions set stem = 'changed' where id = pg_temp.id('pa1')$$,
    $$update public.item_versions set difficulty = 0.9 where id = pg_temp.id('pw1')$$,
    $$update public.item_versions set approved_by = null, approved_at = null where id = pg_temp.id('pa1')$$,
    $$update public.item_versions set approved_at = approved_at + interval '1 second' where id = pg_temp.id('ai1')$$,
    $$update public.item_versions set reviewed_by = approved_by, key_reviewed_by = approved_by where id = pg_temp.id('pa2')$$,
    $$update public.item_versions set status = 'draft' where id = pg_temp.id('pa1')$$,
    $$delete from public.item_versions where id = pg_temp.id('pa1')$$,
    $$update public.item_answer_keys set key = '{"option_id": "o2"}' where item_version_id = pg_temp.id('pa1')$$,
    $$delete from public.item_answer_keys where item_version_id = pg_temp.id('pa1')$$,
    $$update public.item_variants set stem = 'changed' where item_version_id = pg_temp.id('pq')$$,
    $$delete from public.item_variants where item_version_id = pg_temp.id('pq')$$,
    $$update public.item_variant_keys set key = '{"option_id": "o2"}' where item_variant_id = pg_temp.id('pqv')$$,
    $$delete from public.item_variant_keys where item_variant_id = pg_temp.id('pqv')$$,
    -- DB-M1-3: INSERT probes. Each is written so that only a guard can refuse it (no key or row conflict).
    $$insert into public.section_pool_snapshot (org_id, section_id, item_version_id, workspace_id, test_id, test_version_id, exposure_at_publish) select v.org_id, pg_temp.id('ps1'), pg_temp.id('big1'), v.workspace_id, v.test_id, v.id, 0 from public.test_versions as v where v.id = pg_temp.id('p') and set_config('trace.publishing', pg_temp.id('p')::text, true) is not null$$,
    $$insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty, content_sha256) values ('a1000000-0000-4000-8000-000000000001', pg_temp.id('pq'), 9, '{"a": 8}', '[synthetic] What is 8 + 1?', '[{"id": "o1", "text": "9"}, {"id": "o2", "text": "8"}]', 0.50, repeat('c', 64))$$,
    $$insert into public.item_variant_keys (org_id, item_variant_id, key) values ('a1000000-0000-4000-8000-000000000001', pg_temp.id('pqv'), '{"option_id": "o2"}') on conflict (org_id, item_variant_id) do update set key = excluded.key$$,
    $$insert into public.item_answer_keys (org_id, item_version_id, format, key) values ('a1000000-0000-4000-8000-000000000001', pg_temp.id('pa1'), 'mcq', '{"option_id": "o2"}') on conflict (org_id, item_version_id) do update set key = excluded.key$$
  ] loop
    v_r := pg_temp.try(v_sql);
    if v_r ~ '^OK [1-9]' then
      v_out := v_out || v_sql || '; ';
    end if;
  end loop;
  return v_out;
end
$f$;
grant execute on function pg_temp.frozen_probe() to public;
select pg_temp.u('owner');
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: owner changes nothing a published version references');
select pg_temp.u('admin');
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: admin changes nothing');
select pg_temp.u('recruiter');
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: recruiter changes nothing');
select pg_temp.u('reviewer');
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: reviewer changes nothing');
select pg_temp.api(pg_temp.id('A'));
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: trace_api changes nothing');
select pg_temp.w('trace_worker', pg_temp.id('A'));
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: trace_worker changes nothing');
select pg_temp.w('trace_quality_worker', pg_temp.id('A'));
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: trace_quality_worker changes nothing');
select pg_temp.w('trace_integrity_worker', pg_temp.id('A'));
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: trace_integrity_worker changes nothing');
select pg_temp.w('trace_authoring_worker', pg_temp.id('A'));
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: trace_authoring_worker changes nothing');
select pg_temp.w('trace_admin_worker', pg_temp.id('A'));
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: trace_admin_worker changes nothing');
select pg_temp.op();
select is(pg_temp.frozen_probe(), '', 'AT-M1-13: the operator changes nothing (ENABLE ALWAYS, no bypass)');
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('p')), 24, 'AT-M1-13: the snapshot is whole after every probe');
select set_config('trace.publishing', pg_temp.id('p')::text, true);
select matches(pg_temp.try(format($$insert into public.section_pool_snapshot (org_id, section_id, item_version_id, workspace_id, test_id, test_version_id, exposure_at_publish) values (%L, %L, %L, %L, %L, %L, 0)$$, pg_temp.id('A'), pg_temp.id('ps1'), pg_temp.id('big1'), pg_temp.id('A1'), pg_temp.id('p_test'), pg_temp.id('p'))), '^42501 TRACE_GUARD: the snapshot is written by publish only and is immutable', 'DB-M1-3 (I-M1-2): the operator cannot add to a published snapshot, even naming it in trace.publishing');
select set_config('trace.publishing', '', true);
select is((select count(*)::int from public.section_pool_snapshot where test_version_id = pg_temp.id('p')), 24, 'DB-M1-3: the published snapshot still holds 24 rows');
-- What may still change: a snapshotted bank item may be retired (approved -> retired only), and the version retires.
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.item_versions set status = 'retired' where id = %L$$, pg_temp.id('pa3'))), 'OK 1', 'R5-33: a snapshotted item may go approved -> retired');
select pg_temp.op();
select matches(pg_temp.try($$update public.test_versions set status = 'retired', min_pool_ratio = 1 where id = pg_temp.id('p')$$), '^42501 TRACE_GUARD: a published test version is frozen', 'R5-33: publish -> retire keeps min_pool_ratio frozen');
select matches(pg_temp.try($$update public.test_versions set status = 'retired', package_version = 1 where id = pg_temp.id('p')$$), '^42501 TRACE_GUARD: a published test version is frozen', 'R5-33: publish -> retire keeps package_version frozen');
select matches(pg_temp.try($$update public.test_versions set status = 'retired', role_template_version_id = gen_random_uuid() where id = pg_temp.id('p')$$), '^42501 TRACE_GUARD: a published test version is frozen', 'R5-33: publish -> retire keeps role_template_version_id frozen');

-- ===== AT-M1-14 / Q20: "Edit as new version" is a new draft; invitations keep their version =====
insert into public.invitations (id, org_id, workspace_id, test_id, test_version_id, candidate_label, contact_email, link_token_hash, adult_confirmed_by_inviter, status, expires_at) values
  ('a2000000-0000-4000-8000-0000000000e1', pg_temp.id('A'), pg_temp.id('A1'), pg_temp.id('p_test'), pg_temp.id('p'), 'Candidate 0', 'm1-q20@example.test', repeat('e', 64), true, 'created', '2030-01-01 00:00:00+00');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$insert into public.test_versions (org_id, test_id, total_time_seconds, quality_cutoff) values (%L, %L, 1800, 40)$$, pg_temp.id('A'), pg_temp.id('p_test'))), 'OK 1', 'AT-M1-14: a recruiter opens version 2 of a published test');
select pg_temp.op();
insert into pg_temp.ids select 'p2', id from public.test_versions where test_id = pg_temp.id('p_test') and version_no = 2;
select is((select version_no::text || '|' || status::text || '|' || package_version::text || '|' || coalesce(min_pool_ratio::text, 'null') from public.test_versions where id = pg_temp.id('p2')), '2|draft|1|null', 'AT-M1-14: the new version is draft number 2; the guard owns the M1 columns');
select is((select (r.settings is null)::text || '|' || (r.published_at is null)::text from public.ruleset_versions as r join public.test_versions as v on v.ruleset_version_id = r.id where v.id = pg_temp.id('p2')), 'true|true', 'AT-M1-14 (R3-1): the new draft gets the D1 seed ruleset');
select is((select pg_temp.keys(details) || '|' || (details ->> 'version_no') from public.audit_log where action = 'test.new_version' and object_id = pg_temp.id('p2')), 'version_no|2', 'AT-M1-14 (R5-26): test.new_version carries the version number only');
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.ruleset_versions as r set preset_key = 'standard', settings = (select s.settings from public.ruleset_versions as s where s.id = pg_temp.id('p_rs')) where r.id = (select v.ruleset_version_id from public.test_versions as v where v.id = pg_temp.id('p2'))$$), 'OK 1', 'AT-M1-14: the source version''s settings are copied into the new draft');
select pg_temp.op();
select is((select r.signal_settings = s.signal_settings from public.ruleset_versions as r, public.ruleset_versions as s where r.id = (select v.ruleset_version_id from public.test_versions as v where v.id = pg_temp.id('p2')) and s.id = pg_temp.id('p_rs')), true, 'AT-M1-14: the copy derives the same signal settings');
select matches(pg_temp.try($$update public.invitations set test_version_id = pg_temp.id('p2') where id = 'a2000000-0000-4000-8000-0000000000e1'$$), '^42501', 'AT-M1-14 (Q20): an invitation keeps the version it was sent with');
select is((select test_version_id from public.invitations where id = 'a2000000-0000-4000-8000-0000000000e1'), pg_temp.id('p'), 'AT-M1-14: the invitation still pins version 1');
-- E1: the published version stays frozen while the new draft is edited.
select pg_temp.u('recruiter');
select is(pg_temp.try($$update public.test_versions set quality_cutoff = 50 where id = pg_temp.id('p2')$$), 'OK 1', 'E1: the new draft is editable');
select matches(pg_temp.try($$update public.test_versions set quality_cutoff = 50 where id = pg_temp.id('p')$$), '^(42501|OK 0)', 'E1: the published version is not');
select pg_temp.op();
