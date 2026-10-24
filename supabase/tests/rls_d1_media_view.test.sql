-- rls_d1_media_view (spec specs/d1-demo-slice.md §3.6 row "rls_d1_media_view"; §3.4 media_viewer_check, media_link_grant,
-- media_view_grant; L-2, L-25, L-26, R-7, R-15; rule 8; AT-D10). RED first: targets migration 20261014175327_d1_media_audit.sql on top
-- of migrations 1-3. The fixtures are those of rls_d1_media (sessions k1-k5, start photos for k1, k2, k3). Personas are
-- synthetic (p-<persona>@example.test); no PII. try() returns 'OK <rows>' or '<sqlstate> <message>'.
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
select plan(73);
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
-- Assignments on the operator path (R-15): on T1 the owner-admin, the admin, both recruiters and the assigned reviewer;
-- on T2 the workspace recruiter. A publish auto-assignment may already hold the pair, so a conflict is skipped.
insert into public.assignments (org_id, membership_id, scope, test_id, as_role, created_by)
  select m.org_id, m.id, 'test', 'e1000000-0000-4000-8000-000000000001', v.r::public.org_role, '00000000-0000-4000-8000-000000000001'
  from public.memberships m
  join (values ('00000000-0000-4000-8000-000000000001'::uuid, 'org_owner'), ('00000000-0000-4000-8000-000000000003'::uuid, 'admin'), ('00000000-0000-4000-8000-000000000005'::uuid, 'recruiter'), ('00000000-0000-4000-8000-000000000006'::uuid, 'recruiter')) as v (u, r) on v.u = m.user_id
  where m.org_id = 'a1000000-0000-4000-8000-000000000001'
  on conflict (org_id, membership_id, test_id) do nothing;
insert into public.assignments (org_id, membership_id, scope, test_id, as_role, created_by)
  select m.org_id, m.id, 'test', 'e1000000-0000-4000-8000-000000000002', 'recruiter', '00000000-0000-4000-8000-000000000001'
  from public.memberships m where m.org_id = 'a1000000-0000-4000-8000-000000000001' and m.user_id = '00000000-0000-4000-8000-000000000009'
  on conflict (org_id, membership_id, test_id) do nothing;
-- Audit rows before any call (the fixtures above may write assignment rows; only media.* rows are counted below).
create temp table mv_before as select count(*)::int as n from public.audit_log where action like 'media.%';
grant select on mv_before to public;

-- ===== catalogue: three private DEFINER functions, search_path pinned, EXECUTE to trace_api only (L-2, MT-7) =====
select ok((select to_regprocedure('private.media_viewer_check(uuid, uuid, text, text[])') is not null and to_regprocedure('private.media_link_grant(uuid, uuid, text, text[], uuid)') is not null and to_regprocedure('private.media_view_grant(uuid, uuid, text, text[], uuid)') is not null), 'media: media_viewer_check, media_link_grant and media_view_grant exist with the §3.4 signatures');
select is((select bool_and(prosecdef) from pg_proc where oid in ('private.media_viewer_check(uuid, uuid, text, text[])'::regprocedure, 'private.media_link_grant(uuid, uuid, text, text[], uuid)'::regprocedure, 'private.media_view_grant(uuid, uuid, text, text[], uuid)'::regprocedure)), true, 'media: all three are SECURITY DEFINER');
select is((select bool_and(proconfig @> array['search_path=""']) from pg_proc where oid in ('private.media_viewer_check(uuid, uuid, text, text[])'::regprocedure, 'private.media_link_grant(uuid, uuid, text, text[], uuid)'::regprocedure, 'private.media_view_grant(uuid, uuid, text, text[], uuid)'::regprocedure)), true, 'media: all three pin search_path to the empty path (MT-7)');
select is((select string_agg(provolatile::text, ',' order by proname) from pg_proc where oid in ('private.media_viewer_check(uuid, uuid, text, text[])'::regprocedure, 'private.media_link_grant(uuid, uuid, text, text[], uuid)'::regprocedure, 'private.media_view_grant(uuid, uuid, text, text[], uuid)'::regprocedure)), 'v,v,s', 'media: the check is STABLE; the two grants write audit rows and are VOLATILE');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_candidate', 'trace_candidate_gateway']) r where has_function_privilege(r, 'private.media_link_grant(uuid, uuid, text, text[], uuid)', 'execute')), 'trace_api', 'media_link_grant: EXECUTE to trace_api only (L-2)');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_candidate', 'trace_candidate_gateway']) r where has_function_privilege(r, 'private.media_view_grant(uuid, uuid, text, text[], uuid)', 'execute')), 'trace_api', 'media_view_grant: EXECUTE to trace_api only (L-2)');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_candidate', 'trace_candidate_gateway']) r where has_function_privilege(r, 'private.media_viewer_check(uuid, uuid, text, text[])', 'execute')), '', 'media_viewer_check: no role can execute it (internal)');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker', 'trace_candidate', 'trace_candidate_gateway']) r where has_function_privilege(r, 'private.membership_counts_for(uuid, public.org_role[], text, text[])', 'execute')), '', 'membership_counts_for: no role can execute it (L-25)');
select is((select count(*)::int from pg_proc where oid in ('private.media_viewer_check(uuid, uuid, text, text[])'::regprocedure, 'private.media_link_grant(uuid, uuid, text, text[], uuid)'::regprocedure, 'private.media_view_grant(uuid, uuid, text, text[], uuid)'::regprocedure) and prosrc ~ '(^|[^a-z_])(quality|integrity)[.][a-z_]'), 0, 'media: no body names quality.* or integrity.* (reaches public only)');

-- ===== L-25: membership_counts_for answers as membership_counts does for the same JWT values =====
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp"}]}';
select is(array[private.membership_counts('{recruiter}'), private.membership_counts('{reviewer}')], array[private.membership_counts_for('00000000-0000-4000-8000-000000000005', '{recruiter}', 'aal1', '{otp}'), private.membership_counts_for('00000000-0000-4000-8000-000000000005', '{reviewer}', 'aal1', '{otp}')], 'L-25: aal1 by OTP gives the same answers through both functions (recruiter true, reviewer false)');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal1", "amr": [{"method": "password"}]}';
select is(array[private.membership_counts('{recruiter}'), private.membership_counts('{org_owner,admin}')], array[private.membership_counts_for('00000000-0000-4000-8000-000000000006', '{recruiter}', 'aal1', '{password}'), private.membership_counts_for('00000000-0000-4000-8000-000000000006', '{org_owner,admin}', 'aal1', '{password}')], 'L-25: aal1 by password gives the same answers through both functions (both false)');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password"}, {"method": "totp"}]}';
select is(array[private.membership_counts('{org_owner,admin}'), private.membership_counts('{reviewer}')], array[private.membership_counts_for('00000000-0000-4000-8000-000000000001', '{org_owner,admin}', 'aal2', '{password,totp}'), private.membership_counts_for('00000000-0000-4000-8000-000000000001', '{reviewer}', 'aal2', '{password,totp}')], 'L-25: aal2 gives the same answers through both functions (both true)');
reset request.jwt.claims;

-- ===== allowed: an assigned viewer of each role gets the session id (issue) and the key (fetch), audited =====
-- Every trace_api call runs with the api org of the transaction set (private.api_org_id(), security review m4 F3).
-- Link ids: 0x01-0x06 granted; 0x11-0x20 refused at issue; 0x21-0x2a refused at fetch (some issued first).
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000001')), '43000000-0000-4000-8000-000000000001'::uuid, 'link_grant: the assigned owner at aal2 gets the media''s session id');
select is((select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000001')), 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000001/start_photo.jpg', 'view_grant: the assigned owner at aal2 gets the R2 key for the link issued to them');
select is((select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000002')), '43000000-0000-4000-8000-000000000001'::uuid, 'link_grant: the assigned admin at aal2 is allowed');
select is((select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000002')), 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000001/start_photo.jpg', 'view_grant: the assigned admin at aal2 gets the key');
select is((select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', 'aal1', '{otp}', '47000000-0000-4000-8000-000000000003')), '43000000-0000-4000-8000-000000000001'::uuid, 'link_grant: the assigned recruiter at aal1 signed in by OTP is allowed (L-25)');
select is((select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', 'aal1', '{otp}', '47000000-0000-4000-8000-000000000003')), 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000001/start_photo.jpg', 'view_grant: the assigned recruiter at aal1 by OTP gets the key (L-25)');
select is((select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000004')), '43000000-0000-4000-8000-000000000001'::uuid, 'link_grant: the assigned reviewer at aal2 is allowed');
select is((select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000004')), 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000001/start_photo.jpg', 'view_grant: the assigned reviewer at aal2 gets the key');
select is((select private.media_link_grant('46000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000009', 'aal1', '{otp}', '47000000-0000-4000-8000-000000000005')), '43000000-0000-4000-8000-000000000002'::uuid, 'link_grant: the workspace recruiter assigned to T2 is allowed on a T2 photo');
select is((select private.media_view_grant('46000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000009', 'aal1', '{otp}', '47000000-0000-4000-8000-000000000005')), 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000002/start_photo.jpg', 'view_grant: the workspace recruiter gets the key of a T2 photo');
select is((select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000006')), '43000000-0000-4000-8000-000000000001'::uuid, 'link_grant: the assigned password recruiter at aal2 is allowed (the positive control of the fence case below)');
select is((select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000006')), 'media/a1000000-0000-4000-8000-000000000001/43000000-0000-4000-8000-000000000001/start_photo.jpg', 'view_grant: the assigned password recruiter at aal2 gets the key');
reset role;
reset trace.api_org_id;
select is((select actor_kind::text || '|' || actor_user_id::text || '|' || actor_roles::text || '|' || object_table || '|' || object_id::text || '|' || workspace_id::text from public.audit_log where action = 'media.link_issued' and details ->> 'link_id' = '47000000-0000-4000-8000-000000000001'), 'org_user|00000000-0000-4000-8000-000000000001|{org_owner,admin}|media_objects|46000000-0000-4000-8000-000000000001|b1000000-0000-4000-8000-000000000001', 'media.link_issued: the actor is the viewer with the viewer''s roles, not the connection (L-26)');
select is((select pg_temp.keys(details) from public.audit_log where action = 'media.link_issued' and details ->> 'link_id' = '47000000-0000-4000-8000-000000000001'), 'link_id,media_id,session_id,ttl_seconds', 'media.link_issued: exact details keys');
select is((select details ->> 'media_id' || '|' || (details ->> 'session_id') || '|' || (details ->> 'ttl_seconds') from public.audit_log where action = 'media.link_issued' and details ->> 'link_id' = '47000000-0000-4000-8000-000000000001'), '46000000-0000-4000-8000-000000000001|43000000-0000-4000-8000-000000000001|300', 'media.link_issued: details carry the media, the session and a 300 s TTL (rule 8)');
select is((select string_agg(distinct actor_kind::text || '|' || actor_user_id::text || '|' || actor_roles::text, ',') from public.audit_log where action = 'media.view' and details ->> 'link_id' = '47000000-0000-4000-8000-000000000001'), 'org_user|00000000-0000-4000-8000-000000000001|{org_owner,admin}', 'media.view: the actor is the viewer with the viewer''s roles (L-26)');
select is((select string_agg(distinct pg_temp.keys(details), ',') from public.audit_log where action = 'media.view'), 'link_id,media_id,session_id', 'media.view: exact details keys (no key, link, signature or token)');
select is((select actor_user_id::text || '|' || actor_roles::text from public.audit_log where action = 'media.view' and details ->> 'link_id' = '47000000-0000-4000-8000-000000000004'), '00000000-0000-4000-8000-000000000007|{reviewer}', 'media.view: a reviewer''s row names the reviewer and the reviewer role');

-- ===== denied at issue: the viewer check (no session id, no audit row) =====
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006', 'aal1', '{password}', '47000000-0000-4000-8000-000000000011')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: an assigned recruiter at aal1 signed in with a password is denied (L-25)');
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006', 'aal1', '{otp,password}', '47000000-0000-4000-8000-000000000012')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: OTP plus a password at aal1 is denied (L-25)');
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal1', '{otp}', '47000000-0000-4000-8000-000000000013')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: the assigned owner at aal1 is denied (owner needs aal2)');
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', 'aal1', '{otp}', '47000000-0000-4000-8000-000000000014')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: the assigned reviewer at aal1 is denied (reviewer needs aal2)');
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000008', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000015')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: the hiring manager is denied (no assignment role)');
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000014', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000016')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: an unassigned reviewer is denied');
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000017')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: the owner is denied on a test not assigned to them (R-15)');
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000018')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: the admin is denied on a test not assigned to them (R-15)');
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000005', 'aal1', '{otp}', '47000000-0000-4000-8000-000000000019')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: a recruiter is denied on a test not assigned to them');
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000007', 'aal2', '{password,totp}', '47000000-0000-4000-8000-00000000001a')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: a reviewer is denied on a test not assigned to them');
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000e', 'aal2', '{password,totp}', '47000000-0000-4000-8000-00000000001b')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: an org B admin is denied on an org A photo (cross-org)');
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-00000000001c')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: an org A owner is denied on an org B photo (cross-org)');
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-0000000000ff', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-00000000001d')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: an unknown media id gets the same refusal (no existence oracle)');
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000001', null, 'aal2', '{password,totp}', '47000000-0000-4000-8000-00000000001e')$$) || ' / ' || pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', null)$$), '42501 TRACE_GUARD: media access denied / 42501 TRACE_GUARD: media access denied', 'grants: a null viewer or a null link id is refused');
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000001')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: a link id that was already issued is refused (a jti is never reused)');
reset trace.api_org_id;
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-00000000001f')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: with no api org set for the transaction nothing is granted (§3.4, security review m4 F3)');
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
select is(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000020')$$), '42501 TRACE_GUARD: media access denied', 'link_grant: with the api org set to another org an org A photo is refused (F3)');
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';

-- ===== denied at fetch: the link itself (rule 8 in the database, security review m4 F2) =====
select is(pg_temp.try($$select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000021')$$), '42501 TRACE_GUARD: media access denied', 'view_grant: a link id that was never issued is refused');
select is(pg_temp.try($$select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000001')$$), '42501 TRACE_GUARD: media access denied', 'view_grant: a second fetch of the same link is refused (single use)');
select is((select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000022')), '43000000-0000-4000-8000-000000000001'::uuid, 'fixture: a fresh link is issued to the admin');
select is(pg_temp.try($$select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000022')$$), '42501 TRACE_GUARD: media access denied', 'view_grant: a link issued to another viewer is refused, even for an allowed viewer');
reset role;
-- A link issued 400 s ago (written on the operator path with an old time) is stale.
insert into public.audit_log (org_id, occurred_at, actor_kind, actor_user_id, actor_roles, action, object_table, object_id, workspace_id, details)
  values ('a1000000-0000-4000-8000-000000000001', now() - interval '400 seconds', 'org_user', '00000000-0000-4000-8000-000000000001', '{org_owner,admin}', 'media.link_issued', 'media_objects', '46000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', '{"media_id": "46000000-0000-4000-8000-000000000001", "session_id": "43000000-0000-4000-8000-000000000001", "link_id": "47000000-0000-4000-8000-000000000023", "ttl_seconds": 300}');
set local role trace_api;
select is(pg_temp.try($$select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000023')$$), '42501 TRACE_GUARD: media access denied', 'view_grant: a link issued more than 330 s ago is refused (5-minute link, rule 8)');

-- ===== denied at fetch: the viewer changed between issue and fetch =====
select is((select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000024')), '43000000-0000-4000-8000-000000000001'::uuid, 'fixture: a link is issued to the admin before the demotion');
select is((select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000025')), '43000000-0000-4000-8000-000000000001'::uuid, 'fixture: a link is issued to the reviewer before the removal');
select is((select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', 'aal1', '{otp}', '47000000-0000-4000-8000-000000000026')), '43000000-0000-4000-8000-000000000001'::uuid, 'fixture: a link is issued to the OTP recruiter before the suspension');
select is((select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000027')), '43000000-0000-4000-8000-000000000001'::uuid, 'fixture: a link is issued to the password recruiter before the narrowing');
select is((select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000029')), '43000000-0000-4000-8000-000000000001'::uuid, 'fixture: a link is issued to the owner before the org is suspended');
reset role;
update public.memberships set roles = '{recruiter}' where org_id = 'a1000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-000000000003';
update public.memberships set status = 'removed' where org_id = 'a1000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-000000000007';
update public.memberships set status = 'suspended' where org_id = 'a1000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-000000000005';
update public.memberships set workspace_id = 'b1000000-0000-4000-8000-000000000002' where org_id = 'a1000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-000000000006';
set local role trace_api;
select is(pg_temp.try($$select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000024')$$), '42501 TRACE_GUARD: media access denied', 'view_grant: a member demoted so they no longer hold the assignment''s role is denied (DB review m4 m-1)');
select is(pg_temp.try($$select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000025')$$), '42501 TRACE_GUARD: media access denied', 'view_grant: a membership removed between issue and fetch is denied (AT-D10, DB review m4 m-2)');
reset role;
insert into public.memberships (org_id, user_id, roles, workspace_id, display_name, status) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', '{reviewer}', null, 'Persona Reviewer Readded', 'active');
set local role trace_api;
select is(pg_temp.try($$select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000025')$$), '42501 TRACE_GUARD: media access denied', 'view_grant: re-adding a removed member does not revive the old assignment (DB review m4 m-2)');
select is(pg_temp.try($$select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', 'aal1', '{otp}', '47000000-0000-4000-8000-000000000026')$$), '42501 TRACE_GUARD: media access denied', 'view_grant: a membership suspended between issue and fetch is denied');
select is(pg_temp.try($$select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000027')$$), '42501 TRACE_GUARD: media access denied', 'view_grant: a recruiter narrowed to workspace A2 is denied on a workspace A1 photo despite the old assignment (fence)');
-- An audit write that fails aborts the grant: no session id and no row (security review m4 F7).
set local trace.request_id = 'not-a-uuid';
select matches(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000028')$$), '^22P02 ', 'link_grant: a failing audit write aborts the call (fail closed)');
reset trace.request_id;
reset role;
update public.orgs set status = 'suspended' where id = 'a1000000-0000-4000-8000-000000000001';
set local role trace_api;
select is(pg_temp.try($$select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000029')$$), '42501 TRACE_GUARD: media access denied', 'view_grant: a suspended org gets nothing (security review m4 F7)');
reset role;
reset trace.api_org_id;

-- ===== the audit trail: exactly one row per granted call, none for any refusal =====
select is((select count(*)::int from public.audit_log where action like 'media.%' and details ->> 'link_id' between '47000000-0000-4000-8000-000000000011' and '47000000-0000-4000-8000-000000000021'), 0, 'refused issues and the never-issued fetch wrote no media audit row');
select is((select count(*)::int from public.audit_log where action = 'media.view' and details ->> 'link_id' >= '47000000-0000-4000-8000-000000000022'), 0, 'refused fetches wrote no media.view row');
select is((select count(*)::int from public.audit_log where action = 'media.view' and details ->> 'link_id' = '47000000-0000-4000-8000-000000000001'), 1, 'the refused replay left exactly one media.view for its link');
select is((select count(*)::int from public.audit_log where details ->> 'link_id' = '47000000-0000-4000-8000-000000000028'), 0, 'the aborted grant left no row');
select is((select count(*)::int - (select n from mv_before) from public.audit_log where action like 'media.%'), 19, 'media audit rows: 12 media.link_issued and 6 media.view for granted calls, plus the stale fixture row');

-- ===== EXECUTE denied to every role but trace_api (called directly) =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password"}, {"method": "totp"}]}';
select matches(pg_temp.try($$select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000031')$$), '^42501 permission denied', 'view_grant: authenticated (even the assigned owner at aal2) cannot call it');
reset role;
reset request.jwt.claims;
set local role trace_worker;
select matches(pg_temp.try($$select private.media_link_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000032')$$), '^42501 permission denied', 'link_grant: trace_worker cannot call it');
reset role;
set local role trace_candidate;
select matches(pg_temp.try($$select private.media_view_grant('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}', '47000000-0000-4000-8000-000000000033')$$), '^42501 permission denied', 'view_grant: trace_candidate cannot call it');
reset role;
set local role trace_api;
select matches(pg_temp.try($$select private.media_viewer_check('46000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aal2', '{password,totp}')$$), '^42501 permission denied', 'media_viewer_check: even trace_api cannot call the internal check');
reset role;

select * from finish();
rollback;
