-- rls_d1_media (spec specs/d1-demo-slice.md §3.6 row "rls_d1_media"; §3.2 media_objects; §3.3 note 4; rule 8). RED first: written from the spec, targets migration <ts2>_d1_invites_sessions.sql (migration 2) on top of
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
select plan(52);
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

-- Fixtures. Sessions: k1 and k4 on T1, k2 on T2, k3 in org B. Start photos exist for k1, k2 and k3 (k4 is the insert target).
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand01@example.test', '0101010101010101010101010101010101010101010101010101010101010101', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000001';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000001';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000001';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000001' where id = '41000000-0000-4000-8000-000000000001';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000001';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000001');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'cand02@example.test', '0202020202020202020202020202020202020202020202020202020202020202', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000002';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000002';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000002';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', pg_temp.rs('f1000000-0000-4000-8000-000000000002'), pg_temp.nt('f1000000-0000-4000-8000-000000000002'), repeat('a', 64), 'en', 'granted');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000002' where id = '41000000-0000-4000-8000-000000000002';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000002';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', pg_temp.rs('f1000000-0000-4000-8000-000000000002'), '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000002');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', 'cand03@example.test', '0303030303030303030303030303030303030303030303030303030303030303', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000003';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000003';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000003';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', pg_temp.rs('f1000000-0000-4000-8000-00000000000b'), pg_temp.nt('f1000000-0000-4000-8000-00000000000b'), repeat('a', 64), 'en', 'granted');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000003' where id = '41000000-0000-4000-8000-000000000003';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000003';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', pg_temp.rs('f1000000-0000-4000-8000-00000000000b'), '41000000-0000-4000-8000-000000000003', '42000000-0000-4000-8000-000000000003', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000003');
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
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000004' where id = '41000000-0000-4000-8000-000000000004';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000004';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000004', '42000000-0000-4000-8000-000000000004', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000004');
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
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000005';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005');
insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000001/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded');
insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000002', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000002/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', '43000000-0000-4000-8000-000000000003', 'start_photo', 'media/a1000000-0000-4000-8000-000000000003/43000000-0000-4000-8000-000000000003/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;

-- ===== S(c): metadata only; r2_key and sha256 are not selectable by app roles =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$select id, kind, bytes, mime, blurred_on_device, upload_state from public.media_objects$$), 'OK 2', 'S(c): org_owner reads the metadata columns of both org A photos');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$select id, kind, bytes, mime, blurred_on_device, upload_state from public.media_objects$$), 'OK 2', 'S(c): admin reads the metadata columns');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$select id, kind, bytes, mime, blurred_on_device, upload_state from public.media_objects$$), 'OK 2', 'S(c): recruiter (aal1, email OTP) reads the metadata columns');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000009", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$select id, kind, bytes, mime, blurred_on_device, upload_state from public.media_objects$$), 'OK 1', 'S(c): workspace-A2 recruiter reads only the T2 photo row');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$select id, kind, bytes, mime, blurred_on_device, upload_state from public.media_objects$$), 'OK 1', 'S(c): assigned reviewer reads the T1 photo row (S(c)*)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000014", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$select id, kind, bytes, mime, blurred_on_device, upload_state from public.media_objects$$), 'OK 0', 'S(c): unassigned reviewer reads none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$select id, kind, bytes, mime, blurred_on_device, upload_state from public.media_objects$$), 'OK 0', 'S(c): hiring_manager reads none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}';
select is(pg_temp.try($$select id, kind, bytes, mime, blurred_on_device, upload_state from public.media_objects$$), 'OK 0', 'S(c): password-only recruiter at aal1 reads none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is(pg_temp.try($$select id, kind, bytes, mime, blurred_on_device, upload_state from public.media_objects$$), 'OK 1', 'S(c): org B admin reads only the org B photo row (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select r2_key from public.media_objects$$), '^42501 permission denied', 'S(c): org_owner cannot select r2_key (bytes only through the grant functions)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select matches(pg_temp.try($$select r2_key from public.media_objects$$), '^42501 permission denied', 'S(c): recruiter cannot select r2_key (bytes only through the grant functions)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select r2_key from public.media_objects$$), '^42501 permission denied', 'S(c): assigned reviewer cannot select r2_key (bytes only through the grant functions)');
select matches(pg_temp.try($$select sha256 from public.media_objects$$), '^42501 permission denied', 'S(c): authenticated cannot select sha256');
select matches(pg_temp.try($$select * from public.media_objects$$), '^42501 permission denied', 'S(c): select * fails for authenticated (columns beyond the grant)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role anon;
select matches(pg_temp.try($$select id from public.media_objects$$), '^42501 permission denied', 'S: anon has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate;
select matches(pg_temp.try($$select id from public.media_objects$$), '^42501 permission denied', 'S: trace_candidate has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select id from public.media_objects$$), '^42501 permission denied', 'S: trace_api has no privilege (it reaches bytes through media_*_grant only)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select id from public.media_objects$$), '^42501 permission denied', 'S: trace_quality_worker has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select id from public.media_objects$$), '^42501 permission denied', 'S: trace_integrity_worker has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.media_objects), 2, 'S: trace_worker with job org A sees the org A photos');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.media_objects), 1, 'S: trace_worker with job org B sees only org B');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select is((select count(*)::int from public.media_objects), 0, 'S: trace_worker without a job org sees nothing');
-- ===== I: trace_worker inserts the start photo row; the CHECKs are the rule 8 allow-list =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000004', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000004/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), 'OK 1', 'I: trace_worker inserts the start photo of a session (k4)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select workspace_id::text || '/' || test_id::text from public.media_objects where id = '46000000-0000-4000-8000-000000000004'), 'b1000000-0000-4000-8000-000000000001/e1000000-0000-4000-8000-000000000001', 'L-27: workspace_id and test_id are copied from the session');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'snapshot', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^23514', 'CHECK (rule 8): kind is start_photo only in D1');
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'camera_frame', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^23514', 'CHECK (rule 8): camera frames never leave the device');
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'ambient_audio', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^23514', 'CHECK (rule 8): ambient audio never leaves the device');
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', false, 'uploaded')$$), '^23514', 'CHECK: blurred_on_device must be true');
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/png', true, 'uploaded')$$), '^23514', 'CHECK: mime is image/jpeg only');
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 0, 'image/jpeg', true, 'uploaded')$$), '^23514', 'CHECK: bytes is at least 1');
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1500001, 'image/jpeg', true, 'uploaded')$$), '^23514', 'CHECK: bytes is at most 1500000');
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-00000000000c', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'pending')$$), '^23514', 'CHECK: upload_state is ''uploaded'' only');
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-00000000000d', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000004/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^(23505|42501 TRACE_GUARD|23514)', 'key shape: a key naming another session''s id is refused (and would collide with k4''s key)');
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-00000000000e', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/other.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^(42501 TRACE_GUARD|23514)', 'key shape: the key must be exactly media/{org}/{session}/start_photo.jpg');
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-00000000000f', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000003/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^(42501 TRACE_GUARD|23514)', 'key shape: the org segment of the key must be the row org');
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000004', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000004/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^23505', 'unique: one start photo per session');
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000013', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000003', 'start_photo', 'media/a1000000-0000-4000-8000-000000000003/43000000-0000-4000-8000-000000000003/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^(42501|23503 TRACE_GUARD: session not found)', 'I: trace_worker with job org A cannot insert into an org B session (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000014', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^42501', 'I: trace_worker with job org B cannot insert for org A (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000015', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^42501', 'I: trace_worker without a job org cannot insert');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000016', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^42501 permission denied', 'I: trace_quality_worker cannot insert a media row');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000016', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^42501 permission denied', 'I: trace_integrity_worker cannot insert a media row');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000016', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^42501 permission denied', 'I: trace_api cannot insert a media row');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000016', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^42501 permission denied', 'I: an org_owner cannot insert a media row');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role anon;
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000016', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^42501 permission denied', 'I: anon cannot insert a media row');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate;
select matches(pg_temp.try($$insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state) values ('46000000-0000-4000-8000-000000000016', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000005', 'start_photo', 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000005/start_photo.jpg', repeat('f', 64), 1000, 'image/jpeg', true, 'uploaded')$$), '^42501 permission denied', 'I: trace_candidate cannot insert a media row');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.media_objects set bytes = 2 where id = '46000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'U: trace_worker cannot update a media row (S I only)');
select matches(pg_temp.try($$delete from public.media_objects where id = '46000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'D: trace_worker cannot delete a media row (erasure is M7)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.media_objects set bytes = 2 where id = '46000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'U: an org_owner cannot update a media row');
select matches(pg_temp.try($$delete from public.media_objects where id = '46000000-0000-4000-8000-000000000001'$$), '^42501 permission denied', 'D: an org_owner cannot delete a media row');
-- ===== catalogue: the kind CHECK is the allow-list; R2 key is deterministic =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select ok(((select count(*) >= 1 from pg_constraint where conrelid = 'public.media_objects'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%start_photo%')), 'catalogue: a CHECK on kind names start_photo (rule 8 allow-list)');
select is(((select count(*)::int from public.media_objects where r2_key <> 'media/' || org_id::text || '/' || session_id::text || '/start_photo.jpg')), 0, 'catalogue: every stored key equals media/{org}/{session}/start_photo.jpg');
select is(((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'media_objects' and column_name ~* '(embedding|template|voiceprint|face|biometric|gaze|emotion)')), 0, 'catalogue (rule 7): no biometric, embedding or face-match column exists on media_objects');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;

select * from finish();
rollback;
