-- rls_d1_invitations (spec specs/d1-demo-slice.md §3.6 row "rls_d1_invitations"; §3.2 invitations; §3.3 invitations row + note 2; L-1, L-17, L-31, L-32, L-35). RED first: written from the spec, targets migration <ts2>_d1_invites_sessions.sql (migration 2) on top of
-- migration 1 (authoring) and, where NOTES.md says so, migration 3 (L-8 trigger and org seed). Personas are synthetic (p-<persona>@example.test); no PII.
-- try() returns 'OK <rows>' or '<sqlstate> <message>'.
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
select plan(138);
grant trace_worker to postgres with inherit false, set true;
grant usage on schema extensions to trace_worker;
grant trace_quality_worker to postgres with inherit false, set true;
grant usage on schema extensions to trace_quality_worker;
grant trace_integrity_worker to postgres with inherit false, set true;
grant usage on schema extensions to trace_integrity_worker;
grant trace_api to postgres with inherit false, set true;
grant usage on schema extensions to trace_api;
grant trace_candidate to postgres with inherit false, set true;
grant usage on schema extensions to trace_candidate;
grant trace_candidate_gateway to postgres with inherit false, set true;
grant usage on schema extensions to trace_candidate_gateway;
-- ruleset / notice ids of a test version are set by the L-8 trigger (migration 3); fixtures read them through these
-- operator-owned helpers (the workers and trace_api cannot read test_versions freely).
create function pg_temp.rs(p_v uuid) returns uuid language sql security definer as $f$
  select ruleset_version_id from public.test_versions where id = p_v
$f$;
grant execute on function pg_temp.rs(uuid) to public;
create function pg_temp.nt(p_v uuid) returns uuid language sql security definer as $f$
  select notice_version_id from public.test_versions where id = p_v
$f$;
grant execute on function pg_temp.nt(uuid) to public;

-- Personas: synthetic users, fixed ids, created on the operator path (postgres, no claims).
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'p-owner-admin@example.test'),
  ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'p-admin@example.test'),
  ('00000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'p-recruiter-otp@example.test'),
  ('00000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'p-recruiter-pw-aal1@example.test'),
  ('00000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'p-reviewer-asg@example.test'),
  ('00000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'p-hm@example.test'),
  ('00000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'p-ws-recruiter@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'p-removed@example.test'),
  ('00000000-0000-4000-8000-00000000000c', 'authenticated', 'authenticated', 'p-suspended@example.test'),
  ('00000000-0000-4000-8000-00000000000e', 'authenticated', 'authenticated', 'p-b-admin@example.test'),
  ('00000000-0000-4000-8000-000000000014', 'authenticated', 'authenticated', 'p-reviewer-other@example.test');
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
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', '{recruiter}', null, 'Persona Recruiter Otp', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006', '{recruiter}', null, 'Persona Recruiter Pw', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', '{reviewer}', null, 'Persona Reviewer Assigned', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000014', '{reviewer}', null, 'Persona Reviewer Other', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000008', '{hiring_manager}', null, 'Persona Hiring Manager', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000009', '{recruiter}', 'b1000000-0000-4000-8000-000000000002', 'Persona Ws Recruiter', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', '{recruiter}', null, 'Persona Removed', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000c', '{recruiter}', null, 'Persona Suspended', 'active'),
  ('a1000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000e', '{org_owner,admin}', null, 'Persona B Admin', 'active');
update public.memberships set status = 'removed' where user_id = '00000000-0000-4000-8000-00000000000b';
update public.memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-00000000000c';

-- Authoring fixtures on the operator path (migration 1; publishing needs the L-8 trigger and the org seed of migration 3).
-- T1 (ws A1, owner), T2 (ws A2, ws recruiter), T3 (ws A1, retired version), TB (org B). Versions V1/V2/V3/VB are published below;
-- V3 is then retired; V1D is a second (draft) version of T1. Only org_id, parents and content are supplied.
insert into public.tests (id, org_id, workspace_id, name, created_by) values
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test One', '00000000-0000-4000-8000-000000000001'),
  ('e1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'Test Two', '00000000-0000-4000-8000-000000000009'),
  ('e1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test Three', '00000000-0000-4000-8000-000000000005'),
  ('e1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004', 'Test B', '00000000-0000-4000-8000-00000000000e');
insert into public.rubric_versions (id, org_id, rubric_key, version_no, criteria, content_sha256, created_by) values
  ('71000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'writing-basic', 1,
   '[{"id": "c1", "label": "Clarity", "max_points": 5, "anchors": []}]', repeat('a', 64), '00000000-0000-4000-8000-000000000001');
insert into public.test_versions (id, org_id, test_id, version_no, total_time_seconds, quality_cutoff, created_by) values
  ('f1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 1, 1800, 40, '00000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 1, 1800, 40, '00000000-0000-4000-8000-000000000009'),
  ('f1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', 1, 1800, 40, '00000000-0000-4000-8000-000000000005'),
  ('f1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 1, 1800, 40, '00000000-0000-4000-8000-00000000000e');
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 1, 'Choices', 'mcq', 1),
  ('51000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 2, 'Writing', 'written', 1),
  ('51000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 1, 'Choices Two', 'mcq', 1),
  ('51000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', 1, 'Choices Three', 'mcq', 1),
  ('51000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', 1, 'Choices B', 'mcq', 1);
insert into public.item_versions (id, org_id, test_version_id, section_id, format, position, stem, options, rubric_version_id, origin, content_sha256, created_by) values
  ('61000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'mcq', 1, 'Pick one.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64), '00000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', 'written', 1, 'Describe a recent project.', null, '71000000-0000-4000-8000-000000000001', 'human', repeat('c', 64), '00000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000003', 'mcq', 1, 'Pick one, again.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64), '00000000-0000-4000-8000-000000000009'),
  ('61000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000004', 'mcq', 1, 'Pick one, third.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64), '00000000-0000-4000-8000-000000000005'),
  ('61000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', '51000000-0000-4000-8000-00000000000b', 'mcq', 1, 'Pick one, B.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64), '00000000-0000-4000-8000-00000000000e');
insert into public.item_answer_keys (org_id, item_version_id, format, key, created_by) values
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'mcq', '{"option_id": "o1"}', '00000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000003', 'mcq', '{"option_id": "o1"}', '00000000-0000-4000-8000-000000000009'),
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000004', 'mcq', '{"option_id": "o1"}', '00000000-0000-4000-8000-000000000005'),
  ('a1000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-00000000000b', 'mcq', '{"option_id": "o1"}', '00000000-0000-4000-8000-00000000000e');
-- Publish on the operator path (needs migration 3: the L-8 trigger pins the ruleset and notice ids on the draft insert above).
update public.test_versions set status = 'published', content_sha256 = repeat('b', 64)
  where id in ('f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b');
update public.test_versions set status = 'retired' where id = 'f1000000-0000-4000-8000-000000000003';
-- A second, draft version of T1 (one open draft per test) and the reviewer assignment (S* arm).
insert into public.test_versions (id, org_id, test_id, total_time_seconds, quality_cutoff, created_by) values
  ('f1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 1800, 40, '00000000-0000-4000-8000-000000000001');
insert into public.assignments (org_id, membership_id, scope, test_id, as_role, created_by)
  select m.org_id, m.id, 'test', 'e1000000-0000-4000-8000-000000000001', 'reviewer', '00000000-0000-4000-8000-000000000001'
  from public.memberships m where m.org_id = 'a1000000-0000-4000-8000-000000000001' and m.user_id = '00000000-0000-4000-8000-000000000007';

-- Fixtures. k1 created, k2 sent, k3 otp_verified, k4 adult-declared, k5 consented (session_id minted), k6 started (no session row),
-- k7 started with an in_progress session, k8 created (revoked in the body), k9 sent (revoked in the body), k10 sent (expired in the body),
-- k11 on T2 (workspace A2), k12 in org B. Labels are Candidate <n> per test in insert order.
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand01@example.test', '0101010101010101010101010101010101010101010101010101010101010101', true, '2026-12-31 00:00:00+00');
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand02@example.test', '0202020202020202020202020202020202020202020202020202020202020202', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000002';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand03@example.test', '0303030303030303030303030303030303030303030303030303030303030303', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000003';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000003';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand04@example.test', '0404040404040404040404040404040404040404040404040404040404040404', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000004';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000004';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000004';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand05@example.test', '0505050505050505050505050505050505050505050505050505050505050505', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000005';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000005';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000005';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000005' where id = '41000000-0000-4000-8000-000000000005';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand06@example.test', '0606060606060606060606060606060606060606060606060606060606060606', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000006';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000006';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000006';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000006' where id = '41000000-0000-4000-8000-000000000006';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000006';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand07@example.test', '0707070707070707070707070707070707070707070707070707070707070707', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000007';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000007';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000007';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000007' where id = '41000000-0000-4000-8000-000000000007';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000007';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000007', '42000000-0000-4000-8000-000000000007', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000007');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand08@example.test', '0808080808080808080808080808080808080808080808080808080808080808', true, '2026-12-31 00:00:00+00');
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand09@example.test', '0909090909090909090909090909090909090909090909090909090909090909', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000009';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand10@example.test', '0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-00000000000a';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'cand11@example.test', '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b', true, '2026-12-31 00:00:00+00');
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-00000000000c', 'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', 'cand12@example.test', '0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c', true, '2026-12-31 00:00:00+00');

-- ===== label sequence (D1-1) =====
select is((select candidate_label from public.invitations where id = '41000000-0000-4000-8000-000000000001'), 'Candidate 1', 'label: the first invitation of a test is Candidate 1');
select is((select candidate_label from public.invitations where id = '41000000-0000-4000-8000-00000000000a'), 'Candidate 10', 'label: the tenth invitation of T1 is Candidate 10');
select is((select candidate_label from public.invitations where id = '41000000-0000-4000-8000-00000000000b'), 'Candidate 1', 'label: T2 has its own sequence');
select is((select invitation_seq from public.tests where id = 'e1000000-0000-4000-8000-000000000001'), 10, 'label: tests.invitation_seq counts the invitations created on T1');
select is((select count(distinct candidate_label)::int from public.invitations where test_id = 'e1000000-0000-4000-8000-000000000001'), 10, 'label: ten invitations on T1 carry ten distinct labels');
select is((select enum_range(null::public.invitation_status)::text), '{created,sent,otp_verified,started,submitted,expired,revoked,blocked_age}', 'enum: invitation_status has exactly the eight spec labels (no rejected value, rule 2)');
-- ===== S: who reads which invitations (A: k1..k10 on T1, k11 on T2; B: k12) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.invitations), 11, 'S: org_owner sees all 11 org A invitations');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.invitations), 11, 'S: admin sees all 11 org A invitations');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.invitations), 11, 'S: recruiter (aal1, email OTP) sees all 11 org A invitations');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000009", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.invitations), 1, 'S: workspace-A2 recruiter sees only the T2 invitation (workspace fence)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.invitations), 10, 'S: assigned reviewer sees the ten T1 invitations (S*)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000014", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.invitations), 0, 'S: unassigned reviewer sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.invitations), 0, 'S: assigned reviewer at aal1 sees none (aal2 required)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.invitations), 0, 'S: hiring_manager sees none (D1-14)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.invitations), 0, 'S: password-only recruiter at aal1 sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000b", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.invitations), 0, 'S: a removed member sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000c", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.invitations), 0, 'S: a suspended member sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.invitations), 1, 'S: org B admin sees only the org B invitation (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role anon;
select matches(pg_temp.try($$select * from public.invitations$$), '^42501 permission denied', 'S: anon has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate;
select matches(pg_temp.try($$select * from public.invitations$$), '^42501 permission denied', 'S: trace_candidate has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.invitations), 11, 'S: trace_worker with job org A sees the 11 org A invitations');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.invitations), 1, 'S: trace_worker with job org B sees only org B');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select is((select count(*)::int from public.invitations), 0, 'S: trace_worker without a job org sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.invitations), 11, 'S: trace_api with api org A sees the 11 org A invitations');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.invitations), 1, 'S: trace_api with api org B sees only org B');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
select is((select count(*)::int from public.invitations), 0, 'S: trace_api without an api org sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select id from public.invitations$$), '^42501 permission denied', 'S: trace_quality_worker has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select id from public.invitations$$), '^42501 permission denied', 'S: trace_integrity_worker has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select link_token_hash from public.invitations$$), '^42501 permission denied', 'S(c): authenticated cannot select link_token_hash');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$select * from public.invitations$$), '^42501 permission denied', 'S(c): select * fails for authenticated because the hash column is not granted');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select link_token_hash from public.invitations$$), '^42501 permission denied', 'S(c): trace_api cannot select link_token_hash');
select matches(pg_temp.try($$select * from public.invitations$$), '^42501 permission denied', 'S(c): select * fails for trace_api because the hash column is not granted');
-- ===== I: authenticated creates invitations (label and status come from the trigger) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'rec01@example.test', '1515151515151515151515151515151515151515151515151515151515151515', true, '2026-12-31 00:00:00+00')$$), 'OK 1', 'I: recruiter (aal1, email OTP) invites on T1');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'own01@example.test', '1616161616161616161616161616161616161616161616161616161616161616', true, '2026-12-31 00:00:00+00')$$), 'OK 1', 'I: org_owner invites on T1');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'adm01@example.test', '1717171717171717171717171717171717171717171717171717171717171717', true, '2026-12-31 00:00:00+00')$$), 'OK 1', 'I: admin invites on T1');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000009", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'wsr01@example.test', '1818181818181818181818181818181818181818181818181818181818181818', true, '2026-12-31 00:00:00+00')$$), 'OK 1', 'I: workspace-A2 recruiter invites on T2');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'wsr02@example.test', '1919191919191919191919191919191919191919191919191919191919191919', true, '2026-12-31 00:00:00+00')$$), '^42501 TRACE_GUARD: not allowed to invite to this test', 'I: workspace-A2 recruiter cannot invite on a workspace A1 test');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'rev01@example.test', '1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a', true, '2026-12-31 00:00:00+00')$$), '^42501 TRACE_GUARD: not allowed to invite to this test', 'I: reviewer cannot invite');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'hm01@example.test', '1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b', true, '2026-12-31 00:00:00+00')$$), '^42501 TRACE_GUARD: not allowed to invite to this test', 'I: hiring_manager cannot invite');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'pw01@example.test', '1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c', true, '2026-12-31 00:00:00+00')$$), '^42501 TRACE_GUARD: not allowed to invite to this test', 'I: password-only recruiter at aal1 cannot invite');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'bad01@example.test', '1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d', true, '2026-12-31 00:00:00+00')$$), '^42501 TRACE_GUARD: not allowed to invite to this test', 'I: org B admin cannot invite into org A (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', 'own02@example.test', '1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e', true, '2026-12-31 00:00:00+00')$$), '^42501 TRACE_GUARD: not allowed to invite to this test', 'I: org A owner cannot invite into org B (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role anon;
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'anon01@example.test', '1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f', true, '2026-12-31 00:00:00+00')$$), '^42501 permission denied', 'I: anon cannot insert');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'api01@example.test', '2020202020202020202020202020202020202020202020202020202020202020', true, '2026-12-31 00:00:00+00')$$), '^42501 permission denied', 'I: trace_api cannot insert (the recruiter creates, the api only advances)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'wrk01@example.test', '2121212121212121212121212121212121212121212121212121212121212121', true, '2026-12-31 00:00:00+00')$$), '^42501 permission denied', 'I: trace_worker cannot insert');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select candidate_label from public.invitations where contact_email = 'rec01@example.test'), 'Candidate 11', 'label: the next invite on T1 is Candidate 11');
select is((select candidate_label from public.invitations where contact_email = 'adm01@example.test'), 'Candidate 13', 'label: the third insert after the ten fixtures is Candidate 13');
select is((select candidate_label from public.invitations where contact_email = 'wsr01@example.test'), 'Candidate 2', 'label: the second invitation on T2 is Candidate 2');
select is((select status::text from public.invitations where contact_email = 'rec01@example.test'), 'created', 'I: a new invitation starts as created (status default; the client does not choose it)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at, candidate_label) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'lbl01@example.test', '2222222222222222222222222222222222222222222222222222222222222222', true, '2026-12-31 00:00:00+00', 'Candidate 777')$$), '^(OK 1|42501)', 'label: a client-supplied candidate_label is refused or overwritten');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select count(*)::int from public.invitations where candidate_label = 'Candidate 777'), 0, 'label: the client-chosen label never lands');
-- ===== pinned published version (Q20) =====
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000004', 'pin01@example.test', '2828282828282828282828282828282828282828282828282828282828282828', true, '2026-12-31 00:00:00+00')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'pin: a draft test version cannot be pinned');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000003', 'pin02@example.test', '2929292929292929292929292929292929292929292929292929292929292929', true, '2026-12-31 00:00:00+00')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'pin: a retired test version cannot be pinned');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'pin03@example.test', '2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a', true, '2026-12-31 00:00:00+00')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'pin: a published version of another test cannot be pinned');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'pin04@example.test', '2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b', true, '2026-12-31 00:00:00+00')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'pin: T1 version on a T2 invitation refused');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-00000000000b', 'pin05@example.test', '2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c', true, '2026-12-31 00:00:00+00')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'pin: another org version refused (composite FK)');
-- ===== CHECKs (D1-1): synthetic-only contacts, SHA-256 hash =====
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'real.person@acme-corp.com', '2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d', true, '2026-12-31 00:00:00+00')$$), '^23514', 'CHECK: a real-looking mail domain is refused');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'a@example.com', '2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e', true, '2026-12-31 00:00:00+00')$$), '^23514', 'CHECK: example.com is not the reserved example.test');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'UPPER@example.test', '2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f', true, '2026-12-31 00:00:00+00')$$), '^23514', 'CHECK: upper-case local part refused');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'a@sub.example.test', '3030303030303030303030303030303030303030303030303030303030303030', true, '2026-12-31 00:00:00+00')$$), '^23514', 'CHECK: a subdomain of example.test refused');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx@example.test', '3131313131313131313131313131313131313131313131313131313131313131', true, '2026-12-31 00:00:00+00')$$), '^23514', 'CHECK: local part longer than 64 characters refused');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '@example.test', '3232323232323232323232323232323232323232323232323232323232323232', true, '2026-12-31 00:00:00+00')$$), '^23514', 'CHECK: empty local part refused');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'h01@example.test', 'not-a-hash', true, '2026-12-31 00:00:00+00')$$), '^23514', 'CHECK: link_token_hash must be 64 hex characters');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'h02@example.test', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', true, '2026-12-31 00:00:00+00')$$), '^23514', 'CHECK: upper-case hex refused');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'h03@example.test', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', true, '2026-12-31 00:00:00+00')$$), '^23514', 'CHECK: 63 hex characters refused');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'h04@example.test', '0101010101010101010101010101010101010101010101010101010101010101', true, '2026-12-31 00:00:00+00')$$), '^23505', 'unique: link_token_hash is globally unique');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand01@example.test', '3333333333333333333333333333333333333333333333333333333333333333', true, '2026-12-31 00:00:00+00')$$), '^23505', 'unique: one open invitation per (test, contact email)');
-- ===== immutable columns (every caller, operator included) =====
select matches(pg_temp.try($$update public.invitations set link_token_hash = '6363636363636363636363636363636363636363636363636363636363636363' where id = '41000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'immutable: link_token_hash cannot change (operator)');
select matches(pg_temp.try($$update public.invitations set contact_email = 'other@example.test' where id = '41000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'immutable: contact_email cannot change (operator)');
select matches(pg_temp.try($$update public.invitations set candidate_label = 'Candidate 99' where id = '41000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'immutable: candidate_label cannot change (operator)');
select matches(pg_temp.try($$update public.invitations set candidate_id = gen_random_uuid() where id = '41000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'immutable: candidate_id cannot change (operator)');
select matches(pg_temp.try($$update public.invitations set adult_confirmed_by_inviter = false where id = '41000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'immutable: adult_confirmed_by_inviter cannot change (operator)');
select matches(pg_temp.try($$update public.invitations set test_version_id = 'f1000000-0000-4000-8000-000000000004' where id = '41000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'immutable: test_version_id cannot change (Q20)');
select matches(pg_temp.try($$update public.invitations set test_id = 'e1000000-0000-4000-8000-000000000002' where id = '41000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'immutable: test_id cannot change');
-- ===== authenticated: revoke only, from created or sent (R-14) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.invitations set status = 'revoked' where id = '41000000-0000-4000-8000-000000000008'$$), 'OK 1', 'U: org_owner revokes a created invitation');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$update public.invitations set status = 'revoked' where id = '41000000-0000-4000-8000-000000000009'$$), 'OK 1', 'U: recruiter revokes a sent invitation');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.invitations set status = 'revoked' where id = '41000000-0000-4000-8000-000000000003'$$), '^(OK 0|42501 TRACE_GUARD)', 'U: revoke after OTP is refused (a started flow finishes)');
select matches(pg_temp.try($$update public.invitations set status = 'revoked' where id = '41000000-0000-4000-8000-000000000006'$$), '^(OK 0|42501 TRACE_GUARD)', 'U: revoke of a started invitation is refused');
select matches(pg_temp.try($$update public.invitations set status = 'created' where id = '41000000-0000-4000-8000-000000000008'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|OK 0)', 'U: revoked is terminal (no way back to created)');
select matches(pg_temp.try($$update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'L-1: authenticated cannot set sent (trace_api only)');
select matches(pg_temp.try($$update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'U: authenticated cannot set otp_verified');
select matches(pg_temp.try($$update public.invitations set status = 'started' where id = '41000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'U: authenticated cannot set started');
select matches(pg_temp.try($$update public.invitations set status = 'submitted' where id = '41000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'U: authenticated cannot set submitted');
select matches(pg_temp.try($$update public.invitations set status = 'expired' where id = '41000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'U: authenticated cannot set expired');
select matches(pg_temp.try($$update public.invitations set status = 'blocked_age' where id = '41000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'U: authenticated cannot set blocked_age');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000009", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$update public.invitations set status = 'revoked' where id = '41000000-0000-4000-8000-000000000001'$$), 'OK 0', 'U: workspace-A2 recruiter cannot revoke a workspace A1 invitation (0 rows)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.invitations set status = 'revoked' where id = '41000000-0000-4000-8000-000000000001'$$), '^(OK 0|42501)', 'U: reviewer cannot revoke');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.invitations set status = 'revoked' where id = '41000000-0000-4000-8000-000000000001'$$), '^(OK 0|42501)', 'U: hiring_manager cannot revoke');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$update public.invitations set status = 'revoked' where id = '41000000-0000-4000-8000-000000000001'$$), 'OK 0', 'U: password-only recruiter at aal1 cannot revoke (0 rows)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.invitations set status = 'revoked' where id = '41000000-0000-4000-8000-00000000000c'$$), 'OK 0', 'U: org A owner cannot revoke an org B invitation (cross-org, 0 rows)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$update public.invitations set status = 'revoked' where id = '41000000-0000-4000-8000-000000000001'$$), 'OK 0', 'U: org B admin cannot revoke an org A invitation (cross-org, 0 rows)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.invitations set session_id = '43000000-0000-4000-8000-00000000005a' where id = '41000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'U(c): authenticated has no UPDATE grant on session_id');
select matches(pg_temp.try($$update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'U(c): authenticated has no UPDATE grant on adult_self_declared');
select matches(pg_temp.try($$update public.invitations set started_at = now() where id = '41000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'U(c): authenticated has no UPDATE grant on started_at');
select matches(pg_temp.try($$update public.invitations set age_block_source = 'inviter' where id = '41000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'U(c): authenticated has no UPDATE grant on age_block_source');
select matches(pg_temp.try($$update public.invitations set contact_email = 'x@example.test' where id = '41000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'U(c): authenticated has no UPDATE grant on contact_email');
select matches(pg_temp.try($$delete from public.invitations where id = '41000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'D: authenticated cannot delete an invitation');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$delete from public.invitations where id = '41000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'D: trace_api cannot delete');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$delete from public.invitations where id = '41000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'D: trace_worker cannot delete');
-- ===== trace_api: sent (L-1), otp_verified, started (L-17), expired (L-32), set-once columns =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000001'$$), 'OK 1', 'L-1: trace_api sets sent after the outbox write');
select is(pg_temp.try($$update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000001'$$), 'OK 1', 'U: trace_api moves sent to otp_verified');
select matches(pg_temp.try($$update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'U: the state machine is forward-only (otp_verified cannot go back to sent)');
select matches(pg_temp.try($$update public.invitations set status = 'revoked' where id = '41000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'U: trace_api cannot revoke');
select matches(pg_temp.try($$update public.invitations set status = 'submitted' where id = '41000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'U: trace_api cannot set submitted (trace_worker only)');
select matches(pg_temp.try($$update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'L-17: started needs a session_id and a consent (k3 has neither)');
select matches(pg_temp.try($$update public.invitations set session_id = '43000000-0000-4000-8000-000000000003' where id = '41000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'session_id needs an existing consent (k3 has none)');
select matches(pg_temp.try($$update public.invitations set session_id = '43000000-0000-4000-8000-000000000004' where id = '41000000-0000-4000-8000-000000000004'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'session_id needs an existing consent (k4 declared adult but has none)');
select is(pg_temp.try($$update public.invitations set status = 'expired' where id = '41000000-0000-4000-8000-00000000000a'$$), 'OK 1', 'L-32: trace_api expires a sent invitation that has no session');
select matches(pg_temp.try($$update public.invitations set status = 'expired' where id = '41000000-0000-4000-8000-000000000005'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'L-32: expired is refused once session_id is set');
select matches(pg_temp.try($$update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-00000000000a'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'U: expired is terminal');
select matches(pg_temp.try($$update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000008'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'U: revoked is terminal for trace_api too');
select matches(pg_temp.try($$update public.invitations set status = 'started' where id = '41000000-0000-4000-8000-000000000005'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'L-17: started without started_at is refused (the DO clock is required)');
select is(pg_temp.try($$update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000005'$$), 'OK 1', 'L-17: started with consent, session_id and started_at succeeds');
select is(pg_temp.try($$update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000005'$$), 'OK 1', 'L-17: a retry with the same started_at is a no-op');
select matches(pg_temp.try($$update public.invitations set status = 'started', started_at = '2026-10-14 10:05:00+00' where id = '41000000-0000-4000-8000-000000000005'$$), '^(OK [01]|42501)', 'L-17: a retry with another started_at changes nothing (set-once)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select started_at from public.invitations where id = '41000000-0000-4000-8000-000000000005'), '2026-10-14 10:00:00+00'::timestamptz, 'L-17: started_at is still the first value (set-once, the DO is the clock authority)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.invitations set session_id = '43000000-0000-4000-8000-00000000005b' where id = '41000000-0000-4000-8000-000000000005'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'session_id is set-once');
select matches(pg_temp.try($$update public.invitations set contact_email = 'x@example.test' where id = '41000000-0000-4000-8000-000000000005'$$), '^42501 permission denied', 'U(c): trace_api cannot update contact_email');
select matches(pg_temp.try($$update public.invitations set link_token_hash = '6262626262626262626262626262626262626262626262626262626262626262' where id = '41000000-0000-4000-8000-000000000005'$$), '^42501 permission denied', 'U(c): trace_api cannot update link_token_hash');
select matches(pg_temp.try($$update public.invitations set candidate_id = gen_random_uuid() where id = '41000000-0000-4000-8000-000000000005'$$), '^42501 permission denied', 'U(c): trace_api cannot update candidate_id');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
select is(pg_temp.try($$update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000002'$$), 'OK 0', 'U: trace_api with api org B cannot touch an org A invitation (0 rows)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
select is(pg_temp.try($$update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000002'$$), 'OK 0', 'U: trace_api without an api org touches nothing');
-- ===== trace_worker: submitted only, and only with a sessions row (L-35) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.invitations set status = 'submitted' where id = '41000000-0000-4000-8000-000000000006'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'L-35: submitted is refused without a sessions row (k6)');
select is(pg_temp.try($$update public.invitations set status = 'submitted' where id = '41000000-0000-4000-8000-000000000007'$$), 'OK 1', 'L-35: submitted succeeds once the sessions row exists (k7)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.invitations set status = 'expired' where id = '41000000-0000-4000-8000-000000000007'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'U: submitted is terminal');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000002'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'U: trace_worker cannot set otp_verified');
select matches(pg_temp.try($$update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000002'$$), '^42501 (TRACE_GUARD|permission denied)', 'U: trace_worker cannot set started');
select matches(pg_temp.try($$update public.invitations set status = 'revoked' where id = '41000000-0000-4000-8000-000000000002'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'U: trace_worker cannot revoke');
select matches(pg_temp.try($$update public.invitations set contact_email = 'x@example.test' where id = '41000000-0000-4000-8000-000000000002'$$), '^42501 permission denied', 'U(c): trace_worker updates status only');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is(pg_temp.try($$update public.invitations set status = 'submitted' where id = '41000000-0000-4000-8000-000000000006'$$), 'OK 0', 'U: trace_worker with job org B touches no org A row (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select is(pg_temp.try($$update public.invitations set status = 'submitted' where id = '41000000-0000-4000-8000-000000000006'$$), 'OK 0', 'U: trace_worker without a job org touches nothing');
-- ===== audit: invitation.create / invitation.revoke (IDs, enums and numbers only) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select count(*)::int from public.audit_log where action = 'invitation.create' and pg_temp.keys(details) <> 'status,test_version_id'), 0, 'audit: every invitation.create row has exactly the keys status,test_version_id');
select is((select count(*)::int from public.audit_log where action = 'invitation.revoke' and org_id = 'a1000000-0000-4000-8000-000000000001'), 2, 'audit: two successful revokes wrote invitation.revoke');
select is((select count(*)::int from public.audit_log where action = 'invitation.revoke' and pg_temp.keys(details) <> 'old_status'), 0, 'audit: every invitation.revoke row has exactly the key old_status');
select is((select details ->> 'old_status' from public.audit_log where action = 'invitation.revoke' and object_id = '41000000-0000-4000-8000-000000000009'), 'sent', 'audit: revoking k9 recorded old_status sent');
select is((select actor_user_id from public.audit_log where action = 'invitation.revoke' and object_id = '41000000-0000-4000-8000-000000000008'), '00000000-0000-4000-8000-000000000001'::uuid, 'audit: the revoke names the org_owner who did it');
select is((select a.actor_user_id from public.audit_log a join public.invitations i on i.id = a.object_id where a.action = 'invitation.create' and i.contact_email = 'rec01@example.test'), '00000000-0000-4000-8000-000000000005'::uuid, 'audit: the create names the recruiter who invited');
select is((select count(*)::int from public.audit_log where action like 'invitation.%' and details::text ~* '(example\.test|candidate [0-9]|link|hash|token)'), 0, 'audit: no email, label, link or token appears in invitation audit details');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;

select * from finish();
rollback;
