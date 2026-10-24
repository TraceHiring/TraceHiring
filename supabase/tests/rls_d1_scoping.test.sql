-- rls_d1_scoping (spec specs/d1-demo-slice.md §3.6 row "rls_d1_scoping"; L-27, §3.2 scoping columns, §3.3 arms). RED first, targets migration <ts1>_d1_authoring.sql. Migration-1 child tables only: sections, item_versions, item_answer_keys, assignments (consents, session_items, media_objects are migration 2).
begin;
-- Helpers live in pg_temp (rolled back with the transaction). try() runs one statement as the current
-- role and returns 'OK <rows>' or '<sqlstate> <message>', so a denial is an assertion, not an abort.
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'OK ' || n;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end
$f$;
grant execute on function pg_temp.try(text) to public;
-- keys() lists the top-level keys of an audit details object, sorted and comma-joined.
create function pg_temp.keys(p_details jsonb) returns text language sql as $f$
  select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(p_details) as k
$f$;
grant execute on function pg_temp.keys(jsonb) to public;
grant usage on schema extensions to authenticated, anon, service_role;
select plan(48);

grant trace_worker to postgres with inherit false, set true;
grant usage on schema extensions to trace_worker;
grant trace_quality_worker to postgres with inherit false, set true;
grant usage on schema extensions to trace_quality_worker;
grant trace_integrity_worker to postgres with inherit false, set true;
grant usage on schema extensions to trace_integrity_worker;
grant trace_candidate to postgres with inherit false, set true;
grant usage on schema extensions to trace_candidate;
-- Personas (spec D1 §3.6): synthetic users, fixed ids, created on the operator path (postgres, no claims).
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'p-owner-admin@example.test'),
  ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'p-admin@example.test'),
  ('00000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'p-admin-aal1@example.test'),
  ('00000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'p-recruiter-otp@example.test'),
  ('00000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'p-recruiter-pw-aal1@example.test'),
  ('00000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'p-reviewer-asg@example.test'),
  ('00000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'p-hm@example.test'),
  ('00000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'p-ws-recruiter@example.test'),
  ('00000000-0000-4000-8000-00000000000e', 'authenticated', 'authenticated', 'p-b-admin@example.test'),
  ('00000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'p-outsider@example.test'),
  ('00000000-0000-4000-8000-000000000013', 'authenticated', 'authenticated', 'p-recruiter-two@example.test'),
  ('00000000-0000-4000-8000-000000000014', 'authenticated', 'authenticated', 'p-reviewer-other@example.test'),
  ('00000000-0000-4000-8000-000000000015', 'authenticated', 'authenticated', 'p-creator-removed@example.test'),
  ('00000000-0000-4000-8000-000000000016', 'authenticated', 'authenticated', 'p-b-reviewer@example.test');

-- Org A and org B (customers). Seeds (notice, band rules, rubric) arrive with the orgs from migration 3.
insert into public.orgs (id, kind, name, slug) values
  ('a1000000-0000-4000-8000-000000000001', 'customer', 'Org A', 'org-a-test'),
  ('a1000000-0000-4000-8000-000000000003', 'customer', 'Org B', 'org-b-test');
insert into public.workspaces (id, org_id, name, kind, is_default) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Default', 'default', true),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Client A2', 'client', false),
  ('b1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000003', 'Default', 'default', true);
insert into public.memberships (org_id, user_id, roles, workspace_id, display_name, status) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '{org_owner,admin}', null, 'Persona Owner Admin', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '{admin}', null, 'Persona Admin', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', '{admin}', null, 'Persona Admin Aal1', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', '{recruiter}', null, 'Persona Recruiter Otp', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006', '{recruiter}', null, 'Persona Recruiter Pw', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', '{reviewer}', null, 'Persona Reviewer Assigned', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000008', '{hiring_manager}', null, 'Persona Hiring Manager', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000009', '{recruiter}', 'b1000000-0000-4000-8000-000000000002', 'Persona Ws Recruiter', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000013', '{recruiter}', null, 'Persona Recruiter Two', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000014', '{reviewer}', null, 'Persona Reviewer Other', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000015', '{recruiter}', null, 'Persona Creator Removed', 'active'),
  ('a1000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000e', '{org_owner,admin}', null, 'Persona B Admin', 'active'),
  ('a1000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000016', '{reviewer}', null, 'Persona B Reviewer', 'active');

-- Authoring fixtures on the operator path. Four tests: T1 (ws A1, owner), T2 (ws A2, ws recruiter), T3 (ws A1,
-- recruiter), TB (org B). Version V1 on T1 is a complete draft (publishable); V2 on T2 a draft; V3 on T3 is published
-- below; VB is org B's draft. Only org_id, parents and content are supplied; workspace_id/test_id on children and the
-- ruleset/notice ids on versions come from triggers (L-27, L-8).
insert into public.tests (id, org_id, workspace_id, name, created_by) values
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test One', '00000000-0000-4000-8000-000000000001'),
  ('e1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'Test Two', '00000000-0000-4000-8000-000000000009'),
  ('e1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test Three', '00000000-0000-4000-8000-000000000005'),
  ('e1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004', 'Test B', '00000000-0000-4000-8000-00000000000e');
insert into public.rubric_versions (id, org_id, rubric_key, version_no, criteria, content_sha256, created_by) values
  ('71000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'writing-basic', 1,
   '[{"id": "c1", "label": "Clarity", "max_points": 5, "anchors": []}]', repeat('a', 64), '00000000-0000-4000-8000-000000000001'),
  ('71000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'writing-spare', 1,
   '[{"id": "c1", "label": "Clarity", "max_points": 5, "anchors": []}]', repeat('a', 64), '00000000-0000-4000-8000-000000000001'),
  ('71000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'writing-b', 1,
   '[{"id": "c1", "label": "Clarity", "max_points": 5, "anchors": []}]', repeat('a', 64), '00000000-0000-4000-8000-00000000000e');
insert into public.test_versions (id, org_id, test_id, version_no, total_time_seconds, quality_cutoff, created_by) values
  ('f1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 1, 1800, 40, '00000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 1, 1800, 40, '00000000-0000-4000-8000-000000000009'),
  ('f1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', 1, 1800, 40, '00000000-0000-4000-8000-000000000005'),
  ('f1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 1, 1800, 40, '00000000-0000-4000-8000-00000000000e');
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 1, 'Writing', 'written', 1),
  ('51000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 2, 'Choices', 'mcq', 1),
  ('51000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 1, 'Choices Two', 'mcq', 1),
  ('51000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', 1, 'Choices Three', 'mcq', 1),
  ('51000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', 1, 'Choices B', 'mcq', 1);
insert into public.item_versions (id, org_id, test_version_id, section_id, format, position, stem, options, rubric_version_id, origin, content_sha256, created_by) values
  ('61000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'written', 1, 'Describe a recent project.', null, '71000000-0000-4000-8000-000000000001', 'human', repeat('c', 64), '00000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', 'mcq', 1, 'Pick one.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64), '00000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000003', 'mcq', 1, 'Pick one, again.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64), '00000000-0000-4000-8000-000000000009'),
  ('61000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000004', 'mcq', 1, 'Pick one, third.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64), '00000000-0000-4000-8000-000000000005'),
  ('61000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', '51000000-0000-4000-8000-00000000000b', 'mcq', 1, 'Pick one, B.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64), '00000000-0000-4000-8000-00000000000e');
insert into public.item_answer_keys (org_id, item_version_id, format, key, created_by) values
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000002', 'mcq', '{"option_id": "o1"}', '00000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000003', 'mcq', '{"option_id": "o1"}', '00000000-0000-4000-8000-000000000009'),
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000004', 'mcq', '{"option_id": "o1"}', '00000000-0000-4000-8000-000000000005'),
  ('a1000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-00000000000b', 'mcq', '{"option_id": "o1"}', '00000000-0000-4000-8000-00000000000e');
-- The assigned reviewer persona is assigned to T1 on the operator path (so the S* arm has something to see).
insert into public.assignments (org_id, membership_id, scope, test_id, as_role, created_by)
  select m.org_id, m.id, 'test', 'e1000000-0000-4000-8000-000000000001', 'reviewer', '00000000-0000-4000-8000-000000000001'
  from public.memberships m where m.org_id = 'a1000000-0000-4000-8000-000000000001' and m.user_id = '00000000-0000-4000-8000-000000000007';
-- V3 is published by the admin (plain update; it also makes the recruiter persona the auto-assigned creator of T3).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id = 'f1000000-0000-4000-8000-000000000003';
reset role;
reset request.jwt.claims;

-- Fixture addition: the unassigned reviewer persona is assigned to T2 (workspace A2) on the operator path, so reviewer and workspace fences can be compared on the same child rows.
insert into public.assignments (org_id, membership_id, scope, test_id, as_role, created_by)
  select m.org_id, m.id, 'test', 'e1000000-0000-4000-8000-000000000002', 'reviewer', '00000000-0000-4000-8000-000000000001'
  from public.memberships m where m.org_id = 'a1000000-0000-4000-8000-000000000001' and m.user_id = '00000000-0000-4000-8000-000000000014';

-- ===== workspace_id and test_id are copied from the parent by trigger =====
select is((select count(*)::int from public.sections where workspace_id is null or test_id is null), 0, 'copy: every section carries workspace_id and test_id');
select is((select count(*)::int from public.sections s join public.test_versions v on v.org_id = s.org_id and v.id = s.test_version_id where s.workspace_id is distinct from v.workspace_id or s.test_id is distinct from v.test_id), 0, 'copy: section scoping equals its test version''s');
select is((select count(*)::int from public.item_versions where workspace_id is null or test_id is null), 0, 'copy: every item carries workspace_id and test_id');
select is((select count(*)::int from public.item_versions i join public.sections s on s.org_id = i.org_id and s.id = i.section_id where i.workspace_id is distinct from s.workspace_id or i.test_id is distinct from s.test_id), 0, 'copy: item scoping equals its section''s');
select is((select count(*)::int from public.item_answer_keys where workspace_id is null or test_id is null), 0, 'copy: every key carries workspace_id and test_id');
select is((select count(*)::int from public.item_answer_keys k join public.item_versions i on i.org_id = k.org_id and i.id = k.item_version_id where k.workspace_id is distinct from i.workspace_id or k.test_id is distinct from i.test_id), 0, 'copy: key scoping equals its item''s');
select is((select count(*)::int from public.assignments where workspace_id is null), 0, 'copy: every assignment carries a workspace_id');
select is((select count(*)::int from public.assignments a join public.tests t on t.org_id = a.org_id and t.id = a.test_id where a.workspace_id is distinct from t.workspace_id), 0, 'copy: assignment workspace equals its test''s');
select is((select count(*)::int from public.test_versions v join public.tests t on t.org_id = v.org_id and t.id = v.test_id where v.workspace_id is distinct from t.workspace_id), 0, 'copy: test_versions workspace equals its test''s');
select is((select workspace_id from public.sections where id = '51000000-0000-4000-8000-000000000003'), 'b1000000-0000-4000-8000-000000000002'::uuid, 'copy: the workspace A2 section carries workspace A2');
select is((select test_id from public.item_versions where id = '61000000-0000-4000-8000-000000000003'), 'e1000000-0000-4000-8000-000000000002'::uuid, 'copy: the workspace A2 item carries test T2');

-- ===== a client cannot choose its own scoping values =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.sections (org_id, test_version_id, workspace_id, test_id, position, name, format, weight) values ('a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 6, 'Spoofed Scope', 'mcq', 1)$$), '^(OK 1|42501)', 'client values: a section insert with spoofed scoping is either refused or overwritten (never stored as given)');
reset role;
reset request.jwt.claims;
select is((select count(*)::int from public.sections where name = 'Spoofed Scope' and (workspace_id <> 'b1000000-0000-4000-8000-000000000001' or test_id <> 'e1000000-0000-4000-8000-000000000001')), 0, 'client values: no section carries scoping that differs from its test version');
delete from public.sections where name = 'Spoofed Scope';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.sections set workspace_id = 'b1000000-0000-4000-8000-000000000002' where id = '51000000-0000-4000-8000-000000000001'$$), '^42501', 'immutable: an app role cannot change a section''s workspace_id');
select matches(pg_temp.try($$update public.sections set test_id = 'e1000000-0000-4000-8000-000000000002' where id = '51000000-0000-4000-8000-000000000001'$$), '^42501', 'immutable: an app role cannot change a section''s test_id');
select matches(pg_temp.try($$update public.item_versions set test_id = 'e1000000-0000-4000-8000-000000000002' where id = '61000000-0000-4000-8000-000000000001'$$), '^42501', 'immutable: an app role cannot change an item''s test_id');
select matches(pg_temp.try($$update public.item_answer_keys set workspace_id = 'b1000000-0000-4000-8000-000000000002' where item_version_id = '61000000-0000-4000-8000-000000000002'$$), '^42501', 'immutable: an app role cannot change a key''s workspace_id');
reset role;
reset request.jwt.claims;
select matches(pg_temp.try($$update public.sections set workspace_id = 'b1000000-0000-4000-8000-000000000002' where id = '51000000-0000-4000-8000-000000000001'$$), '^(42501|P0001)', 'immutable: the operator cannot change a section''s workspace_id (guard)');
select matches(pg_temp.try($$update public.sections set test_id = 'e1000000-0000-4000-8000-000000000002' where id = '51000000-0000-4000-8000-000000000001'$$), '^(42501|P0001|23503)', 'immutable: the operator cannot change a section''s test_id (guard or composite FK)');
select matches(pg_temp.try($$update public.item_versions set workspace_id = 'b1000000-0000-4000-8000-000000000002' where id = '61000000-0000-4000-8000-000000000001'$$), '^(42501|P0001)', 'immutable: the operator cannot change an item''s workspace_id (guard)');
select matches(pg_temp.try($$update public.item_answer_keys set test_id = 'e1000000-0000-4000-8000-000000000002' where item_version_id = '61000000-0000-4000-8000-000000000002'$$), '^(42501|P0001|23503)', 'immutable: the operator cannot change a key''s test_id (guard or composite FK)');
select matches(pg_temp.try($$update public.assignments set workspace_id = 'b1000000-0000-4000-8000-000000000002' where test_id = 'e1000000-0000-4000-8000-000000000001'$$), '^(42501|P0001)', 'immutable: the operator cannot change an assignment''s workspace_id (guard)');
select matches(pg_temp.try($$update public.tests set workspace_id = 'b1000000-0000-4000-8000-000000000002' where id = 'e1000000-0000-4000-8000-000000000001'$$), '^(42501|P0001)', 'immutable: the operator cannot change a test''s workspace_id (guard)');

-- ===== composite FKs and indexes exist on every migration-1 child =====
select ok(exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.sections'::regclass and c.confrelid = 'public.tests'::regclass and cardinality(c.conkey) = 2), 'fk: sections (org_id, test_id) -> tests');
select ok(exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.sections'::regclass and c.confrelid = 'public.workspaces'::regclass and cardinality(c.conkey) = 2), 'fk: sections (org_id, workspace_id) -> workspaces');
select ok(exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.item_versions'::regclass and c.confrelid = 'public.tests'::regclass and cardinality(c.conkey) = 2), 'fk: item_versions (org_id, test_id) -> tests');
select ok(exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.item_versions'::regclass and c.confrelid = 'public.workspaces'::regclass and cardinality(c.conkey) = 2), 'fk: item_versions (org_id, workspace_id) -> workspaces');
select ok(exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.item_answer_keys'::regclass and c.confrelid = 'public.tests'::regclass and cardinality(c.conkey) = 2), 'fk: item_answer_keys (org_id, test_id) -> tests');
select ok(exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.item_answer_keys'::regclass and c.confrelid = 'public.workspaces'::regclass and cardinality(c.conkey) = 2), 'fk: item_answer_keys (org_id, workspace_id) -> workspaces');
select ok(exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.assignments'::regclass and c.confrelid = 'public.tests'::regclass and cardinality(c.conkey) = 2), 'fk: assignments (org_id, test_id) -> tests');
select ok(exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.assignments'::regclass and c.confrelid = 'public.workspaces'::regclass and cardinality(c.conkey) = 2), 'fk: assignments (org_id, workspace_id) -> workspaces');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'sections' and indexdef ilike '%(org_id, test_id)%'), 'index: sections (org_id, test_id)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'sections' and indexdef ilike '%(org_id, workspace_id)%'), 'index: sections (org_id, workspace_id)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'item_versions' and indexdef ilike '%(org_id, test_id)%'), 'index: item_versions (org_id, test_id)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'item_versions' and indexdef ilike '%(org_id, workspace_id)%'), 'index: item_versions (org_id, workspace_id)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'item_answer_keys' and indexdef ilike '%(org_id, test_id)%'), 'index: item_answer_keys (org_id, test_id)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'item_answer_keys' and indexdef ilike '%(org_id, workspace_id)%'), 'index: item_answer_keys (org_id, workspace_id)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'assignments' and indexdef ilike '%(org_id, test_id)%'), 'index: assignments (org_id, test_id)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'assignments' and indexdef ilike '%(org_id, workspace_id)%'), 'index: assignments (org_id, workspace_id)');

-- ===== fences: workspace-scoped recruiter (A2 only) and the two reviewers (T1 vs T2) =====
-- counts below are sections / item_versions / item_answer_keys / ruleset_versions / assignments
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000009", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select array[(select count(*) from public.sections), (select count(*) from public.item_versions), (select count(*) from public.item_answer_keys), (select count(*) from public.ruleset_versions), (select count(*) from public.assignments)]::int[]), array[1, 1, 1, 1, 1], 'fence: the workspace A2 recruiter sees exactly the T2 children (section, item, key, ruleset, the reviewer assignment)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select array[(select count(*) from public.sections), (select count(*) from public.item_versions), (select count(*) from public.item_answer_keys), (select count(*) from public.ruleset_versions), (select count(*) from public.assignments)]::int[]), array[4, 4, 3, 3, 3], 'fence: the recruiter without a workspace scope sees every org A child');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array[(select count(*) from public.sections), (select count(*) from public.item_versions), (select count(*) from public.item_answer_keys), (select count(*) from public.ruleset_versions), (select count(*) from public.assignments)]::int[]), array[2, 2, 1, 1, 1], 'fence: the reviewer assigned to T1 sees only the T1 children and their own assignment');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000014", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array[(select count(*) from public.sections), (select count(*) from public.item_versions), (select count(*) from public.item_answer_keys), (select count(*) from public.ruleset_versions), (select count(*) from public.assignments)]::int[]), array[1, 1, 1, 1, 1], 'fence: the reviewer assigned to T2 sees only the T2 children and their own assignment, not T1''s');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select array[(select count(*) from public.sections), (select count(*) from public.item_versions), (select count(*) from public.item_answer_keys), (select count(*) from public.ruleset_versions), (select count(*) from public.assignments)]::int[]), array[0, 0, 0, 0, 0], 'fence: hiring_manager sees nothing on any child');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select array[(select count(*) from public.sections), (select count(*) from public.item_versions), (select count(*) from public.item_answer_keys), (select count(*) from public.ruleset_versions), (select count(*) from public.assignments)]::int[]), array[0, 0, 0, 0, 0], 'fence: the assigned reviewer at aal1 sees nothing on any child');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select array[(select count(*) from public.sections), (select count(*) from public.item_versions), (select count(*) from public.item_answer_keys), (select count(*) from public.ruleset_versions), (select count(*) from public.assignments)]::int[]), array[1, 1, 1, 1, 0], 'fence: the org B admin sees only org B children (cross-org)');
reset role;
reset request.jwt.claims;
select is((select count(*)::int from public.sections s where not exists (select 1 from public.test_versions v where v.org_id = s.org_id and v.id = s.test_version_id and v.test_id = s.test_id)), 0, 'consistency: no section points at a version of another test');
select is((select count(*)::int from public.item_versions i where not exists (select 1 from public.sections s where s.org_id = i.org_id and s.id = i.section_id and s.test_id = i.test_id and s.test_version_id = i.test_version_id)), 0, 'consistency: no item disagrees with its section on test or version');

select * from finish();
rollback;
