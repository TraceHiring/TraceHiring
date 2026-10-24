-- rls_m1_carried (spec specs/m1-test-authoring.md revision 5 §10 row rls_m1_carried; §1.5 M0b B0-SP7 (rest); R5-30: each function M1 replaces keeps one case for its D1 behaviour and one for its M1 addition). RED first: written from the spec before migration M1-b. Personas, items and sessions are synthetic.
-- Fixtures (operator path): a published D1-style version v1 (inline iv1) with session c; a published Standard v2
-- version (pool section sp drawing from pool P = s1..s3, inline section si with ii1) with session a; a draft d.
select pg_temp.bank('s' || n, pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'approved') from generate_series(1, 4) as n;
select pg_temp.bank('dr', pg_temp.id('A'), pg_temp.id('A1'), 'mcq', 'verbal', 0.50, 'in_review');
insert into public.pools (id, org_id, workspace_id, name, format) values
  ('d1000000-0000-4000-8000-0000000000f1', pg_temp.id('A'), pg_temp.id('A1'), 'Carried pool', 'mcq');
insert into public.pool_items (org_id, pool_id, item_version_id)
  select pg_temp.id('A'), 'd1000000-0000-4000-8000-0000000000f1'::uuid, pg_temp.id(k) from unnest(array['s1', 's2', 's3']) as k;
select pg_temp.tv('v2', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sp', 'v2', 1, 'mcq', 'd1000000-0000-4000-8000-0000000000f1', 1, 50);
select pg_temp.sec('si', 'v2', 2, 'mcq', null, null, 50);
select pg_temp.inline('ii1', 'si');
select pg_temp.preset('v2', 'standard');
select pg_temp.publish('v2');
select pg_temp.tv('v1', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-0000000000f1', pg_temp.id('A'), pg_temp.id('v1'), 1, 'Choices', 'mcq', 1);
insert into pg_temp.ids values ('sv1', '51000000-0000-4000-8000-0000000000f1');
select pg_temp.inline('iv1', 'sv1');
select pg_temp.publish('v1');
select pg_temp.tv('d', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.sec('sd', 'd', 1, 'mcq', null, null, 100);
select pg_temp.inline('id1', 'sd');
insert into pg_temp.ids select 'd_rs', ruleset_version_id from public.test_versions where id = pg_temp.id('d');
select pg_temp.session('a', 'v2', 21);
select pg_temp.session('c', 'v1', 22);
select pg_temp.qcard('a');
select pg_temp.qcard('c');
select pg_temp.w('trace_worker', pg_temp.id('A'));
insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values
  ('a8000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('a'), pg_temp.id('sp'), pg_temp.id('s1'), 1, null),
  ('a8000000-0000-4000-8000-000000000002', pg_temp.id('A'), pg_temp.id('c'), pg_temp.id('sv1'), pg_temp.id('iv1'), 1, '2026-10-14 10:05:00+00');
select pg_temp.op();

-- ===== B0-SP7 (rest): the candidate gateway's SET ROLE path, executed =====
-- SET ROLE is authorised against the session user, and the local postgres is not a superuser (no SET SESSION
-- AUTHORIZATION), so the path is executed as gateway -> trace_candidate and the refusals are read from the catalogue.
grant trace_candidate_gateway to postgres with inherit false, set true;
grant usage on schema extensions to trace_candidate_gateway;
set local role trace_candidate_gateway;
select matches(pg_temp.try('select * from public.tests'), '^42501 permission denied', 'B0-SP7: as the gateway, no privilege of its own');
set local role trace_candidate;
select is(current_user::text, 'trace_candidate', 'B0-SP7: from the gateway, SET ROLE trace_candidate succeeds');
select matches(pg_temp.try('select * from public.items'), '^42501 permission denied', 'B0-SP7: as trace_candidate, no M1 table is readable');
reset role;
select is((select string_agg(r.rolname::text, ',' order by r.rolname) from pg_catalog.pg_roles as r where r.rolname <> 'trace_candidate' and r.rolname <> 'trace_candidate_gateway' and pg_has_role('trace_candidate_gateway', r.oid, 'SET')), null, 'B0-SP7: the gateway can become no role but trace_candidate (trace_api, workers, authenticated, service_role included)');

-- ===== B0-SP7 (rest): a pure owner (org_owner only) =====
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000030', 'authenticated', 'authenticated', 'p-pure-owner@example.test');
insert into public.memberships (org_id, user_id, roles, workspace_id, display_name, status) values
  (pg_temp.id('A'), '00000000-0000-4000-8000-000000000030', '{org_owner}', null, 'Persona Pure Owner', 'active');
insert into public.memberships (org_id, user_id, roles, workspace_id, display_name, status) values
  (pg_temp.id('A'), '00000000-0000-4000-8000-000000000011', '{admin,recruiter}', null, 'Persona Outsider Joined', 'active');
select pg_temp.u('pure_owner');
select matches(pg_temp.try($$insert into public.teams (org_id, name) values ('a1000000-0000-4000-8000-000000000001', 'Owners only')$$), '^42501', 'B0-SP7: a pure owner cannot create a team (admin only)');
select isnt((select count(*)::int from public.memberships where org_id = pg_temp.id('A')), 0, 'B0-SP7: a pure owner reads the org''s members');
select is(pg_temp.try($$update public.memberships set roles = '{recruiter}' where user_id = '00000000-0000-4000-8000-000000000011' and org_id = 'a1000000-0000-4000-8000-000000000001'$$), 'OK 1', 'B0-SP7: a pure owner revokes a member''s admin role');
select pg_temp.op();
select is((select roles::text from public.memberships where user_id = '00000000-0000-4000-8000-000000000011' and org_id = pg_temp.id('A')), '{recruiter}', 'B0-SP7: the revoke stands');

-- ===== Replaced functions (R5-30): one D1 case and one M1 case each =====
-- private.test_versions_guard
select pg_temp.u('recruiter');
select matches(pg_temp.try($$update public.test_versions set status = 'published' where id = pg_temp.id('d')$$), '^42501 TRACE_GUARD: publish needs the content hash', 'test_versions_guard D1: publish needs the content hash');
select pg_temp.op();
update public.sections set shuffle_items = true where id = pg_temp.id('sd');
select matches(pg_temp.try($$select pg_temp.publish('d')$$), '^42501 TRACE_GUARD: a version that uses M1 features needs its integrity settings', 'test_versions_guard M1: an M1 feature needs settings');
update public.sections set shuffle_items = false where id = pg_temp.id('sd');
-- private.ruleset_versions_guard
select matches(pg_temp.try($$update public.ruleset_versions set signal_settings = signal_settings where id = (select ruleset_version_id from public.test_versions where id = pg_temp.id('v1'))$$), '^42501 TRACE_GUARD: a published ruleset version is frozen', 'ruleset_versions_guard D1: a published ruleset is frozen');
select pg_temp.preset('d', 'open_book');
select matches(pg_temp.try($$update public.ruleset_versions set settings = null where id = pg_temp.id('d_rs')$$), '^42501 TRACE_GUARD: settings once set are not removed', 'ruleset_versions_guard M1: settings once set are not removed');
-- private.item_versions_guard
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$insert into public.item_versions (org_id, section_id, format, position, stem, options, content_sha256) values (%L, %L, 'mcq', 2, '[synthetic] Late', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', %L)$$, pg_temp.id('A'), pg_temp.id('sv1'), repeat('c', 64))), '^42501 TRACE_GUARD: the test version is frozen', 'item_versions_guard D1: no inline item joins a published version');
select matches(pg_temp.try(format($$update public.item_versions set stem = 'changed' where id = %L$$, pg_temp.id('s4'))), '^42501 TRACE_GUARD: an item version is frozen once it leaves draft', 'item_versions_guard M1: an approved bank version is frozen');
-- private.item_answer_keys_guard
select matches(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o9"}' where item_version_id = %L$$, pg_temp.id('id1'))), '^23514 TRACE_BAD_ANSWER_KEY', 'item_answer_keys_guard D1: a key names one of the item''s options');
select matches(pg_temp.try(format($$update public.item_answer_keys set key = '{"option_id": "o2"}' where item_version_id = %L$$, pg_temp.id('dr'))), '^42501 TRACE_GUARD: the item version is frozen', 'item_answer_keys_guard M1: an in-review bank key is frozen');
select pg_temp.op();
-- private.session_items_guard
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at) values (%L, %L, %L, %L, 2, now())$$, pg_temp.id('A'), pg_temp.id('c'), pg_temp.id('sd'), pg_temp.id('id1'))), '^42501 TRACE_GUARD: the item belongs to another test version', 'session_items_guard D1: a v1 session serves only its version''s items');
select matches(pg_temp.try(format($$insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at) values (%L, %L, %L, %L, 2, now())$$, pg_temp.id('A'), pg_temp.id('a'), pg_temp.id('sp'), pg_temp.id('s4'))), '^42501 TRACE_GUARD: the item is not in the published snapshot of its section', 'session_items_guard M1: a v2 session serves only its snapshot');
-- private.responses_guard
select matches(pg_temp.try(format($$insert into public.responses (org_id, session_id, session_item_id, answer_kind, final_text, answer_sha256, final_seq, submitted_at) values (%L, %L, 'a8000000-0000-4000-8000-000000000002', 'text', 'An essay', %L, 2, now())$$, pg_temp.id('A'), pg_temp.id('c'), repeat('a', 64))), '^42501 TRACE_GUARD: the answer kind does not match the item format', 'responses_guard D1: the answer kind follows the item format');
select matches(pg_temp.try(format($$insert into public.responses (org_id, session_id, session_item_id, answer_kind, final_choice, answer_sha256, final_seq, submitted_at) values (%L, %L, 'a8000000-0000-4000-8000-000000000001', 'choice', 'o1', %L, 2, now())$$, pg_temp.id('A'), pg_temp.id('a'), repeat('a', 64))), '^42501 TRACE_GUARD: an item that was not served has no response', 'responses_guard M1: a drawn, unserved item has no response');
select pg_temp.op();
-- private.integrity_flags_guard
select matches(pg_temp.flag('c', 'D1-TAB-HIDDEN', 'focus', 'soft', false), '^42501 TRACE_GUARD: a flag needs a validated rule of the session''s rule table', 'integrity_flags_guard D1: an unvalidated rule makes no flag (D1-DB-1)');
select matches(pg_temp.flag('a', 'D1-PASTE', 'paste', 'medium', false), '^42501 TRACE_GUARD: signal disabled by the test settings', 'integrity_flags_guard M1: a switched-off signal makes no flag (R5-5)');
select is(pg_temp.flag('c', 'D1-PASTE', 'paste', 'medium', false), 'OK 1', 'integrity_flags_guard D1: a D1 session''s paste flag is still accepted (AT-M1-28)');
