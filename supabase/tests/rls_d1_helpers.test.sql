-- rls_d1_helpers (migration-1 helpers; spec specs/d1-demo-slice.md §3.4 rows job_org_id, api_org_id, membership_counts_for, §3.6 row "rls_d1_media_view" for the membership_counts_for cases that do not need migration 4, R-4, L-25, §3.5 MT-7). RED first, targets migration <ts1>_d1_authoring.sql. my_assigned_test_ids is covered in rls_d1_assignments. trace_api does not exist until migration 2, so its grants on api_org_id are asserted in rls_d1_api.
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
select plan(49);

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

-- Signatures used: private.job_org_id(), private.api_org_id(), private.membership_counts_for(uuid, public.org_role[], text, text[]), private.membership_counts(public.org_role[]).

-- ===== job_org_id() =====
select is(private.job_org_id(), null::uuid, 'job_org_id: unset returns NULL');
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(private.job_org_id(), 'a1000000-0000-4000-8000-000000000001'::uuid, 'job_org_id: returns the per-transaction org');
set local trace.job_org_id = '';
select is(private.job_org_id(), null::uuid, 'job_org_id: an empty string returns NULL (nullif)');
reset trace.job_org_id;
select is((select prosecdef from pg_proc where oid = 'private.job_org_id()'::regprocedure), false, 'job_org_id: SECURITY INVOKER');
select is((select provolatile::text from pg_proc where oid = 'private.job_org_id()'::regprocedure), 's', 'job_org_id: STABLE');
select ok((select proconfig::text like '%search_path%' from pg_proc where oid = 'private.job_org_id()'::regprocedure), 'job_org_id: search_path is pinned (MT-7)');
select is((select count(*)::int from unnest(array['trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) r where has_function_privilege(r, 'private.job_org_id()', 'execute')), 3, 'job_org_id: EXECUTE is granted to the three worker roles');
select is((select count(*)::int from unnest(array['authenticated', 'anon', 'service_role', 'trace_candidate', 'trace_candidate_gateway']) r where has_function_privilege(r, 'private.job_org_id()', 'execute')), 0, 'job_org_id: EXECUTE is granted to no other role');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try('select private.job_org_id()'), '^42501 permission denied', 'job_org_id: an app role cannot call it');
reset role;
reset request.jwt.claims;
-- Called as postgres: no app or worker role holds USAGE on schema private (M0b); the helper reads only GUCs.
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(private.job_org_id(), 'a1000000-0000-4000-8000-000000000001'::uuid, 'job_org_id: a worker sees the org it set for its transaction');
reset role;
reset trace.job_org_id;
-- Called as postgres: no app or worker role holds USAGE on schema private (M0b); the helper reads only GUCs.
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is(private.job_org_id(), 'a1000000-0000-4000-8000-000000000003'::uuid, 'job_org_id: another worker with another org sees that org (per-transaction, per-session value)');
reset role;
reset trace.job_org_id;

-- ===== api_org_id() =====
select is(private.api_org_id(), null::uuid, 'api_org_id: unset returns NULL');
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
select is(private.api_org_id(), 'a1000000-0000-4000-8000-000000000003'::uuid, 'api_org_id: returns the per-transaction org');
select is(private.job_org_id(), null::uuid, 'api_org_id: setting it does not set job_org_id (separate settings, L-23)');
reset trace.api_org_id;
select is((select prosecdef from pg_proc where oid = 'private.api_org_id()'::regprocedure), false, 'api_org_id: SECURITY INVOKER');
select ok((select proconfig::text like '%search_path%' from pg_proc where oid = 'private.api_org_id()'::regprocedure), 'api_org_id: search_path is pinned (MT-7)');
select is((select count(*)::int from unnest(array['authenticated', 'anon', 'service_role', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_candidate', 'trace_candidate_gateway']) r where has_function_privilege(r, 'private.api_org_id()', 'execute')), 0, 'api_org_id: EXECUTE is granted to none of the existing roles (trace_api arrives in migration 2)');
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try('select private.api_org_id()'), '^42501 permission denied', 'api_org_id: a worker cannot call it');
reset role;
reset trace.job_org_id;

-- ===== membership_counts_for (L-25): the M0b truth table with aal and amr passed in =====
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000005', '{recruiter}'::public.org_role[], 'aal1', array['otp']), true, 'counts_for: recruiter at aal1 with email OTP is allowed (L-25)');
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000005', '{recruiter}'::public.org_role[], 'aal1', array['magiclink']), true, 'counts_for: recruiter at aal1 with a magic link is allowed');
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000006', '{recruiter}'::public.org_role[], 'aal1', array['password']), false, 'counts_for: recruiter at aal1 with a password is denied (L-25)');
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000006', '{recruiter}'::public.org_role[], 'aal1', array['otp', 'password']), false, 'counts_for: a password anywhere in amr denies aal1');
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000005', '{recruiter}'::public.org_role[], 'aal1', array[]::text[]), false, 'counts_for: aal1 with an empty amr is denied');
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000005', '{recruiter}'::public.org_role[], 'aal1', null), false, 'counts_for: aal1 with a NULL amr is denied');
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000005', '{recruiter}'::public.org_role[], 'aal2', array['password', 'totp']), true, 'counts_for: recruiter at aal2 is allowed');
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000005', '{recruiter}'::public.org_role[], null, array['otp']), false, 'counts_for: a NULL aal is denied');
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000003', '{admin}'::public.org_role[], 'aal1', array['otp']), false, 'counts_for: admin at aal1 is denied even with OTP');
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000001', '{org_owner}'::public.org_role[], 'aal1', array['otp']), false, 'counts_for: org_owner at aal1 is denied');
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000007', '{reviewer}'::public.org_role[], 'aal1', array['otp']), false, 'counts_for: reviewer at aal1 is denied');
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000003', '{admin}'::public.org_role[], 'aal2', array['password', 'totp']), true, 'counts_for: admin at aal2 is allowed');
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000007', '{reviewer}'::public.org_role[], 'aal2', array['otp', 'totp']), true, 'counts_for: reviewer at aal2 is allowed');
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000005', '{recruiter,reviewer}'::public.org_role[], 'aal1', array['otp']), false, 'counts_for: a role list containing a privileged role needs aal2');
select is(private.membership_counts_for('00000000-0000-4000-8000-000000000008', '{hiring_manager}'::public.org_role[], 'aal1', array['otp']), true, 'counts_for: hiring_manager follows the unprivileged branch (same truth table)');
select is(private.membership_counts_for(null, '{recruiter}'::public.org_role[], 'aal1', array['otp']), true, 'counts_for: p_user is not read by the truth table (it must not touch auth.uid())');

-- ===== membership_counts now delegates and keeps its answers =====
-- Run as the operator with claims set (no role switch), so auth.jwt() resolves and the two functions can be compared.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(private.membership_counts('{recruiter}'::public.org_role[]), private.membership_counts_for('00000000-0000-4000-8000-000000000005', '{recruiter}'::public.org_role[], 'aal1', array['otp']), 'delegation: recruiter, aal1, OTP: membership_counts equals membership_counts_for');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}';
select is(private.membership_counts('{recruiter}'::public.org_role[]), private.membership_counts_for('00000000-0000-4000-8000-000000000006', '{recruiter}'::public.org_role[], 'aal1', array['password']), 'delegation: recruiter, aal1, password: the two functions agree (both false)');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(private.membership_counts('{admin}'::public.org_role[]), false, 'delegation: admin at aal1 is still denied through membership_counts');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(private.membership_counts('{admin}'::public.org_role[]), true, 'delegation: admin at aal2 is still allowed through membership_counts');
reset request.jwt.claims;
select ok((select prosrc ilike '%membership_counts_for%' from pg_proc where oid = 'private.membership_counts(public.org_role[])'::regprocedure), 'delegation: membership_counts is re-pointed at membership_counts_for (body names it)');
-- Existing policies behave as before (a policy that calls membership_counts, read through the new tests table).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.tests), 3, 'regression: a recruiter at aal1 with email OTP still reads tests through membership_counts');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.tests), 0, 'regression: a password recruiter at aal1 still reads nothing');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.tests), 0, 'regression: an admin at aal1 still reads nothing');
reset role;
reset request.jwt.claims;

-- ===== membership_counts_for: internal only =====
select is((select prosecdef from pg_proc where oid = 'private.membership_counts_for(uuid, public.org_role[], text, text[])'::regprocedure), true, 'counts_for: SECURITY DEFINER');
select is((select provolatile::text from pg_proc where oid = 'private.membership_counts_for(uuid, public.org_role[], text, text[])'::regprocedure), 's', 'counts_for: STABLE');
select ok((select proconfig::text like '%search_path%' from pg_proc where oid = 'private.membership_counts_for(uuid, public.org_role[], text, text[])'::regprocedure), 'counts_for: search_path is pinned (MT-7)');
select is((select count(*)::int from unnest(array['authenticated', 'anon', 'service_role', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_candidate', 'trace_candidate_gateway']) r where has_function_privilege(r, 'private.membership_counts_for(uuid, public.org_role[], text, text[])', 'execute')), 0, 'counts_for: EXECUTE is granted to no existing role (trace_api is asserted in rls_d1_api)');
select is((select count(*)::int from pg_policy p where pg_get_expr(p.polqual, p.polrelid) ilike '%membership_counts_for%' or pg_get_expr(p.polwithcheck, p.polrelid) ilike '%membership_counts_for%'), 0, 'counts_for: no policy calls it (it is for definer functions only, so it is not a MT-11 helper)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select private.membership_counts_for(null, '{recruiter}'::public.org_role[], 'aal1', array['otp'])$$), '^42501 permission denied', 'counts_for: an app role cannot call it');
reset role;
reset request.jwt.claims;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select private.membership_counts_for(null, '{recruiter}'::public.org_role[], 'aal1', array['otp'])$$), '^42501 permission denied', 'counts_for: a worker cannot call it');
reset role;
reset trace.job_org_id;

select * from finish();
rollback;
