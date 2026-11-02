-- rls_d1_workspace_fence (docs/reviews/D1-db-review-m1.md M-1, m-1, m-3; spec specs/d1-demo-slice.md §3.2 assignments, §3.4 my_assigned_test_ids, R-15; M0b D16b workspace scope). RED first: written against migration 1, fixed by the d1 authoring-fixes migration. Personas are synthetic.
-- M-1: an assignment, the helper behind every reviewer policy, and the publish auto-assignment all respect the
-- membership's workspace (a workspace-scoped member reaches only tests of that workspace).
-- m-1: a test's or version's creator comes from the JWT; only the operator path (plain postgres, no JWT) names one.
-- m-3: publish fails closed when the ruleset has no band rule version.
begin;
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
-- The membership id of a user in org A (SECURITY DEFINER so RLS does not hide it).
create function pg_temp.mid(p_user uuid) returns uuid language sql security definer as $f$
  select m.id from public.memberships as m
  where m.org_id = 'a1000000-0000-4000-8000-000000000001' and m.user_id = p_user
$f$;
grant execute on function pg_temp.mid(uuid) to public;
-- Assignments of one test, counted past RLS.
create function pg_temp.asg(p_test uuid, p_user uuid) returns int language sql security definer as $f$
  select count(*)::int from public.assignments as a
  where a.test_id = p_test and (p_user is null or a.membership_id = pg_temp.mid(p_user))
$f$;
grant execute on function pg_temp.asg(uuid, uuid) to public;
grant usage on schema extensions to authenticated, anon, service_role;
select plan(23);

grant trace_worker to postgres with inherit false, set true;
grant usage on schema extensions to trace_worker;

-- Personas: org-wide admin, org-wide reviewer (R), workspace-A2 reviewer (W), workspace-A2 recruiter (C).
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'p-admin@example.test'),
  ('00000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'p-reviewer-org@example.test'),
  ('00000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'p-ws-recruiter@example.test'),
  ('00000000-0000-4000-8000-000000000017', 'authenticated', 'authenticated', 'p-ws-reviewer@example.test');
insert into public.orgs (id, kind, name, slug) values
  ('a1000000-0000-4000-8000-000000000001', 'customer', 'Org A', 'org-a-test');
insert into public.workspaces (id, org_id, name, kind, is_default) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Default', 'default', true),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Client A2', 'client', false);
insert into public.memberships (org_id, user_id, roles, workspace_id, display_name, status) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '{admin}', null, 'Persona Admin', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', '{reviewer}', null, 'Persona Reviewer Org', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000009', '{recruiter}', 'b1000000-0000-4000-8000-000000000002', 'Persona Ws Recruiter', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000017', '{reviewer}', 'b1000000-0000-4000-8000-000000000002', 'Persona Ws Reviewer', 'active');

-- Tests on the operator path: T1 (ws A1), T2 (ws A2, created by C), T4 (ws A1, named creator C: only the operator
-- can do that), T6 (ws A1, for m-3). Each has one complete draft: an MCQ section, item and key.
insert into public.tests (id, org_id, workspace_id, name, created_by) values
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test One', '00000000-0000-4000-8000-000000000003'),
  ('e1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'Test Two', '00000000-0000-4000-8000-000000000009'),
  ('e1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test Four', '00000000-0000-4000-8000-000000000009'),
  ('e1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test Six', '00000000-0000-4000-8000-000000000003');
insert into public.test_versions (id, org_id, test_id, version_no, total_time_seconds, quality_cutoff, created_by)
  select ('f1000000-0000-4000-8000-00000000000' || n)::uuid, 'a1000000-0000-4000-8000-000000000001',
    ('e1000000-0000-4000-8000-00000000000' || n)::uuid, 1, 1800, 40, '00000000-0000-4000-8000-000000000003'
  from unnest(array['1', '2', '4', '6']) as n;
insert into public.sections (id, org_id, test_version_id, position, name, format, weight)
  select ('51000000-0000-4000-8000-00000000000' || n)::uuid, 'a1000000-0000-4000-8000-000000000001',
    ('f1000000-0000-4000-8000-00000000000' || n)::uuid, 1, 'Choices ' || n, 'mcq', 1
  from unnest(array['1', '2', '4', '6']) as n;
insert into public.item_versions (id, org_id, test_version_id, section_id, format, position, stem, options, rubric_version_id, origin, content_sha256, created_by)
  select ('61000000-0000-4000-8000-00000000000' || n)::uuid, 'a1000000-0000-4000-8000-000000000001',
    ('f1000000-0000-4000-8000-00000000000' || n)::uuid, ('51000000-0000-4000-8000-00000000000' || n)::uuid,
    'mcq', 1, 'Pick one ' || n || '.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human',
    repeat('c', 64), '00000000-0000-4000-8000-000000000003'
  from unnest(array['1', '2', '4', '6']) as n;
insert into public.item_answer_keys (org_id, item_version_id, format, key, created_by)
  select 'a1000000-0000-4000-8000-000000000001', ('61000000-0000-4000-8000-00000000000' || n)::uuid, 'mcq',
    '{"option_id": "o1"}', '00000000-0000-4000-8000-000000000003'
  from unnest(array['1', '2', '4', '6']) as n;

-- ===== M-1: the assignment guard =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.assignments (org_id, membership_id, test_id, as_role) values ('a1000000-0000-4000-8000-000000000001', pg_temp.mid('00000000-0000-4000-8000-000000000017'), 'e1000000-0000-4000-8000-000000000001', 'reviewer')$$),
  '^42501 TRACE_GUARD', 'M-1 guard: a workspace-A2 reviewer cannot be assigned to a workspace-A1 test');
select is(pg_temp.try($$insert into public.assignments (org_id, membership_id, test_id, as_role) values ('a1000000-0000-4000-8000-000000000001', pg_temp.mid('00000000-0000-4000-8000-000000000017'), 'e1000000-0000-4000-8000-000000000002', 'reviewer')$$),
  'OK 1', 'M-1 guard: a workspace-A2 reviewer can be assigned to a workspace-A2 test');
select is(pg_temp.try($$insert into public.assignments (org_id, membership_id, test_id, as_role) values ('a1000000-0000-4000-8000-000000000001', pg_temp.mid('00000000-0000-4000-8000-000000000007'), 'e1000000-0000-4000-8000-000000000001', 'reviewer')$$),
  'OK 1', 'M-1 guard: an org-wide reviewer can be assigned to a workspace-A1 test');
select matches(pg_temp.try($$insert into public.assignments (org_id, membership_id, test_id, as_role) values ('a1000000-0000-4000-8000-000000000001', pg_temp.mid('00000000-0000-4000-8000-000000000009'), 'e1000000-0000-4000-8000-000000000001', 'recruiter')$$),
  '^42501 TRACE_GUARD', 'M-1 guard: a workspace-A2 recruiter cannot be assigned to a workspace-A1 test');
reset role;
reset request.jwt.claims;
select matches(pg_temp.try($$insert into public.assignments (org_id, membership_id, test_id, as_role) values ('a1000000-0000-4000-8000-000000000001', pg_temp.mid('00000000-0000-4000-8000-000000000017'), 'e1000000-0000-4000-8000-000000000001', 'reviewer')$$),
  '^42501 TRACE_GUARD', 'M-1 guard: the operator path cannot cross the workspace fence either');

-- ===== M-1: my_assigned_test_ids and the reviewer read policies =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.item_versions where test_id = 'e1000000-0000-4000-8000-000000000001'), 1, 'M-1 helper: the org-wide reviewer reads the item of the assigned A1 test');
select is((select count(*)::int from public.item_answer_keys where test_id = 'e1000000-0000-4000-8000-000000000001'), 1, 'M-1 helper: the org-wide reviewer reads the answer key of the assigned A1 test');
reset role;
reset request.jwt.claims;
-- The reviewer's membership is narrowed to workspace A2 after the assignment (operator path).
update public.memberships set workspace_id = 'b1000000-0000-4000-8000-000000000002'
  where org_id = 'a1000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-000000000007';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
-- The helper is called as postgres with the claims set: no app role holds USAGE on schema private (M0b).
reset role;
select is(cardinality(coalesce((select private.my_assigned_test_ids('{reviewer}'::public.org_role[])::uuid[]), '{}')), 0, 'M-1 helper: an A1 assignment no longer counts once the membership is scoped to A2');
set local role authenticated;
select is((select count(*)::int from public.item_versions where test_id = 'e1000000-0000-4000-8000-000000000001'), 0, 'M-1 helper: the narrowed reviewer no longer reads the A1 item');
select is((select count(*)::int from public.item_answer_keys where test_id = 'e1000000-0000-4000-8000-000000000001'), 0, 'M-1 helper: the narrowed reviewer no longer reads the A1 answer key');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000017", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
reset role;
select is((select private.my_assigned_test_ids('{reviewer}'::public.org_role[])::uuid[]), array['e1000000-0000-4000-8000-000000000002'::uuid], 'M-1 helper: the workspace-A2 reviewer gets the assigned A2 test');
set local role authenticated;
select is((select count(*)::int from public.item_answer_keys where test_id = 'e1000000-0000-4000-8000-000000000002'), 1, 'M-1 helper: the workspace-A2 reviewer reads the A2 answer key');

-- ===== M-1: the publish auto-assignment =====
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id = 'f1000000-0000-4000-8000-000000000004'$$),
  'OK 1', 'M-1 publish: a test in A1 whose creator is scoped to A2 still publishes');
select is(pg_temp.asg('e1000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000009'), 0, 'M-1 publish: the A2-scoped creator is not auto-assigned to the A1 test');
select is(pg_temp.try($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id = 'f1000000-0000-4000-8000-000000000002'$$),
  'OK 1', 'M-1 publish: the A2 test publishes');
select is(pg_temp.asg('e1000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000009'), 1, 'M-1 publish: the A2-scoped creator is auto-assigned to their A2 test');

-- ===== m-3: publish needs a band rule version =====
reset role;
reset request.jwt.claims;
update public.ruleset_versions set band_rule_version_id = null
  where org_id = 'a1000000-0000-4000-8000-000000000001' and test_id = 'e1000000-0000-4000-8000-000000000006';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id = 'f1000000-0000-4000-8000-000000000006'$$),
  '^42501 TRACE_GUARD: publish needs a ruleset with a band rule version', 'm-3: publish fails closed without a band rule version');

-- ===== m-1: the creator comes from the JWT; only the operator names one =====
-- authenticated cannot supply created_by at all (column grant).
select matches(pg_temp.try($$insert into public.tests (org_id, workspace_id, name, created_by) values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Named Creator', '00000000-0000-4000-8000-000000000009')$$),
  '^42501 permission denied', 'm-1: authenticated cannot name a creator');
reset role;
reset request.jwt.claims;
-- The real guard functions on temp tables of the same shape, so a caller with no JWT that is not the operator
-- (a definer path, trace_api, a worker) can be exercised: it must get a null creator, not the supplied one.
create temp table h_tests (id uuid, org_id uuid, workspace_id uuid, created_by uuid, created_at timestamptz, invitation_seq int);
create trigger h_tests_guard before insert on h_tests for each row execute function private.tests_guard();
create temp table h_versions (org_id uuid, test_id uuid, workspace_id uuid, version_no int, status text, created_by uuid, published_at timestamptz, published_by uuid);
create trigger h_versions_guard before insert on h_versions for each row execute function private.test_versions_guard();
grant insert, select on h_tests, h_versions to trace_worker, authenticated;
insert into h_tests (id, created_by) values ('c0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000009');
insert into h_versions (org_id, test_id, status, version_no, created_by) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'draft', 9, '00000000-0000-4000-8000-000000000009');
set local role trace_worker;
insert into h_tests (id, created_by) values ('c0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000009');
insert into h_versions (org_id, test_id, status, version_no, created_by) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'draft', 10, '00000000-0000-4000-8000-000000000009');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
insert into h_tests (id, created_by) values ('c0000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000009');
reset role;
reset request.jwt.claims;
select is((select created_by from h_tests where id = 'c0000000-0000-4000-8000-000000000001'), '00000000-0000-4000-8000-000000000009'::uuid, 'm-1 tests: the operator path keeps the named creator');
select is((select created_by from h_tests where id = 'c0000000-0000-4000-8000-000000000002'), null::uuid, 'm-1 tests: a caller with no JWT that is not the operator gets no creator');
select is((select created_by from h_tests where id = 'c0000000-0000-4000-8000-000000000003'), '00000000-0000-4000-8000-000000000003'::uuid, 'm-1 tests: an app caller is the creator, whatever it supplies');
select is((select created_by from h_versions where version_no = 9), '00000000-0000-4000-8000-000000000009'::uuid, 'm-1 versions: the operator path keeps the named creator');
select is((select created_by from h_versions where version_no = 10), null::uuid, 'm-1 versions: a caller with no JWT that is not the operator gets no creator');

select * from finish();
rollback;
