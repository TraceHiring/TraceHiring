-- rls_d1_api (spec specs/d1-demo-slice.md §3.6 row "rls_d1_api"; §3.3 trace_api column; §3.4 resolve_invitation_by_hash, api_org_id; L-10). RED first: written from the spec, targets migration <ts2>_d1_invites_sessions.sql (migration 2) on top of
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
-- The trace_api SELECT denials on quality_cards, integrity_cards, integrity_timeline_entries and reports move to the
-- migration-3 files: those tables do not exist yet.
select plan(83);
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

-- Fixtures: k1 created, k2 sent, k4 adult-declared (consent-ready) in org A on T1; k12 in org B (adult-declared). trace_api does the walking.
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
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-00000000000c', 'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', 'cand12@example.test', '0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-00000000000c';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-00000000000c';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-00000000000c';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-00000000000d', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'cand13@example.test', '0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-00000000000d';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-00000000000d';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-00000000000d';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-00000000000d', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-00000000000d', 'f1000000-0000-4000-8000-000000000002', pg_temp.rs('f1000000-0000-4000-8000-000000000002'), pg_temp.nt('f1000000-0000-4000-8000-000000000002'), repeat('a', 64), 'en', 'granted');
update public.invitations set session_id = '43000000-0000-4000-8000-00000000000d' where id = '41000000-0000-4000-8000-00000000000d';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-00000000000e', 'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', 'cand14@example.test', '0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-00000000000e';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-00000000000e';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-00000000000e';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-00000000000e', 'a1000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-00000000000e', 'f1000000-0000-4000-8000-00000000000b', pg_temp.rs('f1000000-0000-4000-8000-00000000000b'), pg_temp.nt('f1000000-0000-4000-8000-00000000000b'), repeat('a', 64), 'en', 'granted');
update public.invitations set session_id = '43000000-0000-4000-8000-00000000000e' where id = '41000000-0000-4000-8000-00000000000e';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;

-- ===== test_versions: S(c) only =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.test_versions), 4, 'test_versions S(c): api org A reads the four org A versions (V1, V2, V3, V1D) through the granted columns');
select matches(pg_temp.try($$select id, org_id, test_id, status, total_time_seconds, ruleset_version_id, notice_version_id, content_sha256 from public.test_versions$$), '^OK 4', 'test_versions S(c): the eight granted columns are readable');
select matches(pg_temp.try($$select quality_cutoff from public.test_versions$$), '^42501 permission denied', 'test_versions S(c): quality_cutoff is not granted to trace_api');
select matches(pg_temp.try($$select * from public.test_versions$$), '^42501 permission denied', 'test_versions S(c): select * fails (columns beyond the grant)');
select matches(pg_temp.try($$select created_by from public.test_versions$$), '^42501 permission denied', 'test_versions S(c): created_by is not granted');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.test_versions), 1, 'test_versions S: api org B sees only the org B version (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
select is((select count(*)::int from public.test_versions), 0, 'test_versions S: api without an api org sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.test_versions set total_time_seconds = 600 where id = 'f1000000-0000-4000-8000-000000000004'$$), '^42501 permission denied', 'test_versions: trace_api cannot update');
select matches(pg_temp.try($$insert into public.test_versions (org_id, test_id, total_time_seconds, quality_cutoff) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 600, 40)$$), '^42501 permission denied', 'test_versions: trace_api cannot insert');
select matches(pg_temp.try($$delete from public.test_versions where id = 'f1000000-0000-4000-8000-000000000004'$$), '^42501 permission denied', 'test_versions: trace_api cannot delete');
-- ===== notice_versions: S =====
select ok((select count(*) >= 1 from public.notice_versions), 'notice_versions S: api org A reads the seeded notice (needs the org seed of migration 3)');
select is((select count(*)::int from public.notice_versions where org_id <> 'a1000000-0000-4000-8000-000000000001'), 0, 'notice_versions S: api org A reads no other org notice (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
select is((select count(*)::int from public.notice_versions), 0, 'notice_versions S: api without an api org reads none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.notice_versions set language = 'en'$$), '^42501 permission denied', 'notice_versions: trace_api cannot update');
select matches(pg_temp.try($$delete from public.notice_versions$$), '^42501 permission denied', 'notice_versions: trace_api cannot delete');
-- ===== invitations: S(c) U(c) =====
select matches(pg_temp.try($$select id, org_id, status, candidate_id, session_id, started_at, test_id, test_version_id, expires_at, adult_confirmed_by_inviter, adult_self_declared, age_block_source, contact_email, candidate_label, created_at from public.invitations$$), '^OK 4', 'invitations S(c): every column except link_token_hash is readable (api org A, four rows)');
select matches(pg_temp.try($$select link_token_hash from public.invitations$$), '^42501 permission denied', 'invitations S(c): the hash column is not readable');
select matches(pg_temp.try($$select * from public.invitations$$), '^42501 permission denied', 'invitations S(c): select * fails because of the hash column');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.invitations), 2, 'invitations S: api org B reads only the two org B invitations (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
select is((select count(*)::int from public.invitations), 0, 'invitations S: no api org reads nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000001'$$), 'OK 1', 'invitations U(c): api org A advances status');
select matches(pg_temp.try($$update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000002'$$), '^(OK 1|42501)', 'invitations U(c): adult_self_declared is in the column grant (state guard may refuse before OTP)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
select is(pg_temp.try($$update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000004'$$), 'OK 0', 'invitations U: api org B cannot update an org A row (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
select is(pg_temp.try($$update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000004'$$), 'OK 0', 'invitations U: api without an api org updates nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.invitations set contact_email = 'x@example.test' where id = '41000000-0000-4000-8000-000000000004'$$), '^42501 permission denied', 'invitations U(c): contact_email is outside the grant');
select matches(pg_temp.try($$update public.invitations set link_token_hash = '6161616161616161616161616161616161616161616161616161616161616161' where id = '41000000-0000-4000-8000-000000000004'$$), '^42501 permission denied', 'invitations U(c): link_token_hash is outside the grant');
select matches(pg_temp.try($$update public.invitations set candidate_label = 'Candidate 9' where id = '41000000-0000-4000-8000-000000000004'$$), '^42501 permission denied', 'invitations U(c): candidate_label is outside the grant');
select matches(pg_temp.try($$update public.invitations set test_version_id = 'f1000000-0000-4000-8000-000000000002' where id = '41000000-0000-4000-8000-000000000004'$$), '^42501 permission denied', 'invitations U(c): test_version_id is outside the grant');
select matches(pg_temp.try($$insert into public.invitations (org_id, test_id, test_version_id, contact_email, link_token_hash, expires_at) values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'api01@example.test', '6060606060606060606060606060606060606060606060606060606060606060', '2026-12-31 00:00:00+00')$$), '^42501 permission denied', 'invitations I: trace_api cannot insert');
select matches(pg_temp.try($$delete from public.invitations where id = '41000000-0000-4000-8000-000000000004'$$), '^42501 permission denied', 'invitations D: trace_api cannot delete');
-- ===== consents: S I (append-only, see rls_d1_consents) =====
select is((select count(*)::int from public.consents), 1, 'consents S: api org A reads its one consent (k13 on T2)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.consents), 1, 'consents S: api org B reads only org B (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
select is((select count(*)::int from public.consents), 0, 'consents S: no api org reads nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted')$$), 'OK 1', 'consents I: trace_api inserts a consent for an adult-declared otp_verified invitation');
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted')$$), '^(23505|OK 0)', 'consents I: a second consent for the same invitation is a unique violation (the api uses on conflict do nothing)');
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-00000000000c', 'f1000000-0000-4000-8000-00000000000b', pg_temp.rs('f1000000-0000-4000-8000-00000000000b'), pg_temp.nt('f1000000-0000-4000-8000-00000000000b'), repeat('a', 64), 'en', 'granted')$$), '^42501 TRACE_GUARD: the consent is outside the api org', 'consents I: api org A cannot insert for an org B invitation (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
select is(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-00000000000c', 'f1000000-0000-4000-8000-00000000000b', pg_temp.rs('f1000000-0000-4000-8000-00000000000b'), pg_temp.nt('f1000000-0000-4000-8000-00000000000b'), repeat('a', 64), 'en', 'granted')$$), 'OK 1', 'consents I: api org B inserts for its own invitation');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
select matches(pg_temp.try($$insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('42000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted')$$), '^42501 TRACE_GUARD: the consent is outside the api org', 'consents I: api without an api org cannot insert');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.consents set language = 'en'$$), '^42501 permission denied', 'consents U: trace_api cannot update (append-only)');
select matches(pg_temp.try($$delete from public.consents$$), '^42501 permission denied', 'consents D: trace_api cannot delete (append-only)');
-- ===== trace_api holds nothing else (matrix cells are denied) =====
select matches(pg_temp.try($$select 1 from public.tests limit 1$$), '^42501 permission denied', 'tests: trace_api has no SELECT privilege');
select matches(pg_temp.try($$select 1 from public.sections limit 1$$), '^42501 permission denied', 'sections: trace_api has no SELECT privilege');
select matches(pg_temp.try($$select 1 from public.item_versions limit 1$$), '^42501 permission denied', 'item_versions: trace_api has no SELECT privilege');
select matches(pg_temp.try($$select 1 from public.item_answer_keys limit 1$$), '^42501 permission denied', 'item_answer_keys: trace_api has no SELECT privilege');
select matches(pg_temp.try($$select 1 from public.rubric_versions limit 1$$), '^42501 permission denied', 'rubric_versions: trace_api has no SELECT privilege');
select matches(pg_temp.try($$select 1 from public.ruleset_versions limit 1$$), '^42501 permission denied', 'ruleset_versions: trace_api has no SELECT privilege');
select matches(pg_temp.try($$select 1 from public.assignments limit 1$$), '^42501 permission denied', 'assignments: trace_api has no SELECT privilege');
select matches(pg_temp.try($$select 1 from public.sessions limit 1$$), '^42501 permission denied', 'sessions: trace_api has no SELECT privilege');
select matches(pg_temp.try($$select 1 from public.session_items limit 1$$), '^42501 permission denied', 'session_items: trace_api has no SELECT privilege');
select matches(pg_temp.try($$select 1 from public.responses limit 1$$), '^42501 permission denied', 'responses: trace_api has no SELECT privilege');
select matches(pg_temp.try($$select 1 from public.media_objects limit 1$$), '^42501 permission denied', 'media_objects: trace_api has no SELECT privilege');
select matches(pg_temp.try($$select 1 from public.idempotency_keys limit 1$$), '^42501 permission denied', 'idempotency_keys: trace_api has no SELECT privilege');
select matches(pg_temp.try($$select 1 from public.memberships limit 1$$), '^42501 permission denied', 'memberships: trace_api has no SELECT privilege');
select matches(pg_temp.try($$select 1 from public.audit_log limit 1$$), '^42501 permission denied', 'audit_log: trace_api has no SELECT privilege');
select matches(pg_temp.try($$select 1 from quality.scores limit 1$$), '^42501 permission denied', 'quality.scores: trace_api has no privilege (needs migration 3)');
select matches(pg_temp.try($$select 1 from integrity.results limit 1$$), '^42501 permission denied', 'integrity.results: trace_api has no privilege (needs migration 3)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((has_schema_privilege('trace_api', 'quality', 'USAGE')), false, 'quality: trace_api has no USAGE on the schema (MT-5c: at most one internal schema, here none)');
select is((has_schema_privilege('trace_api', 'integrity', 'USAGE')), false, 'integrity: trace_api has no USAGE on the schema');
select is(((select count(*)::int from information_schema.role_table_grants where grantee = 'trace_api' and table_schema in ('quality', 'integrity'))), 0, 'trace_api holds no table privilege in quality or integrity');
set local role trace_api;
select matches(pg_temp.try($$insert into public.sessions (id) values (gen_random_uuid())$$), '^42501 permission denied', 'sessions: trace_api cannot insert (trace_worker only)');
select matches(pg_temp.try($$insert into public.media_objects (id) values (gen_random_uuid())$$), '^42501 permission denied', 'media_objects: trace_api cannot insert');
reset role;
-- ===== private.resolve_invitation_by_hash(p_hash): the only token-hash lookup =====
select is((has_schema_privilege('trace_api', 'private', 'USAGE')), true, 'resolve: trace_api can reach the private schema (helpers are called over SQL after SET LOCAL ROLE)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from private.resolve_invitation_by_hash('0101010101010101010101010101010101010101010101010101010101010101')), 1, 'resolve: the hash of an org A invitation returns exactly one row');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
select is((select count(*)::int from private.resolve_invitation_by_hash('0101010101010101010101010101010101010101010101010101010101010101')), 1, 'resolve: usable with no api org at all (the lookup resolves the org)');
select is((select count(*)::int from private.resolve_invitation_by_hash('c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8')), 0, 'resolve: an unknown hash returns nothing');
select is((select id from private.resolve_invitation_by_hash('0101010101010101010101010101010101010101010101010101010101010101')), '41000000-0000-4000-8000-000000000001'::uuid, 'resolve: it returns the invitation that owns the hash');
select is((select org_id from private.resolve_invitation_by_hash('0101010101010101010101010101010101010101010101010101010101010101')), 'a1000000-0000-4000-8000-000000000001'::uuid, 'resolve: it returns the invitation org (so the api can set api_org_id)');
select is((select count(*)::int from private.resolve_invitation_by_hash('0101010101010101010101010101010101010101010101010101010101010101' || 'x')), 0, 'resolve: a hash with a suffix returns nothing (exact match, no pattern)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select proargnames::text from pg_proc where oid = 'private.resolve_invitation_by_hash(text)'::regprocedure), '{p_hash,org_id,id,status,candidate_id,session_id,started_at,test_id,test_version_id,expires_at}', 'resolve: returns exactly the listed columns and never the hash');
select is((select prosecdef from pg_proc where oid = 'private.resolve_invitation_by_hash(text)'::regprocedure), true, 'resolve: SECURITY DEFINER');
select is((select provolatile::text from pg_proc where oid = 'private.resolve_invitation_by_hash(text)'::regprocedure), 's', 'resolve: STABLE');
select ok((select proconfig::text like '%search_path%' from pg_proc where oid = 'private.resolve_invitation_by_hash(text)'::regprocedure), 'resolve: search_path is pinned (MT-7)');
select is((has_function_privilege('trace_api', 'private.resolve_invitation_by_hash(text)', 'execute')), true, 'resolve: EXECUTE is granted to trace_api');
select is(((select count(*)::int from unnest(array['authenticated', 'anon', 'service_role', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_candidate', 'trace_candidate_gateway']) r where has_function_privilege(r, 'private.resolve_invitation_by_hash(text)', 'execute'))), 0, 'resolve: EXECUTE is granted to no other role');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select * from private.resolve_invitation_by_hash('0101010101010101010101010101010101010101010101010101010101010101')$$), '^42501 permission denied', 'resolve: authenticated cannot call it');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select * from private.resolve_invitation_by_hash('0101010101010101010101010101010101010101010101010101010101010101')$$), '^42501 permission denied', 'resolve: trace_worker cannot call it');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role anon;
select matches(pg_temp.try($$select * from private.resolve_invitation_by_hash('0101010101010101010101010101010101010101010101010101010101010101')$$), '^42501 permission denied', 'resolve: anon cannot call it');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate;
select matches(pg_temp.try($$select * from private.resolve_invitation_by_hash('0101010101010101010101010101010101010101010101010101010101010101')$$), '^42501 permission denied', 'resolve: trace_candidate cannot call it');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate_gateway;
select matches(pg_temp.try($$select * from private.resolve_invitation_by_hash('0101010101010101010101010101010101010101010101010101010101010101')$$), '^42501 permission denied', 'resolve: trace_candidate_gateway cannot call it');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select * from private.resolve_invitation_by_hash('0101010101010101010101010101010101010101010101010101010101010101')$$), '^42501 permission denied', 'resolve: trace_quality_worker cannot call it');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select * from private.resolve_invitation_by_hash('0101010101010101010101010101010101010101010101010101010101010101')$$), '^42501 permission denied', 'resolve: trace_integrity_worker cannot call it');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(((select private.api_org_id())), 'a1000000-0000-4000-8000-000000000001'::uuid, 'api_org_id: trace_api reads the per-transaction org');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
select is(((select private.api_org_id())), null::uuid, 'api_org_id: unset means null (a policy matches no row)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;

select * from finish();
rollback;
