-- rls_d1_reports (spec specs/d1-demo-slice.md 3.6 row "rls_d1_reports"; 3.2 "Read-model cards and the report pointer"; 3.3 rows reports, quality_cards,
-- integrity_cards, integrity_timeline_entries; 3.4 mirror_session; R-1; decisions L-4, L-19, L-27, L-28; invariants I-1, I-9; migration-2 draft NOTES D-1).
-- RED first: targets migration <ts3>_d1_results.sql (fixtures also need <ts1>, <ts2>). Personas are synthetic (p-<persona>@example.test); no PII.
-- Includes the two assertions the lead moved out of migration 2: (a) trace_api holds no SELECT on the four result read-model tables, and
-- (b) private.mirror_session writes exactly one public.reports row (both card FKs null) for a mirrored session.
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
grant usage on schema extensions to authenticated, anon, service_role;
select plan(122);
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
create function pg_temp.rs(p_v uuid) returns uuid language sql security definer as $f$
  select ruleset_version_id from public.test_versions where id = p_v
$f$;
grant execute on function pg_temp.rs(uuid) to public;
create function pg_temp.nt(p_v uuid) returns uuid language sql security definer as $f$
  select notice_version_id from public.test_versions where id = p_v
$f$;
grant execute on function pg_temp.nt(uuid) to public;
create function pg_temp.qc(p_session uuid) returns uuid language plpgsql security definer as $f$
begin
  return (select c.id from public.quality_cards c where c.session_id = p_session);
end
$f$;
grant execute on function pg_temp.qc(uuid) to public;
create function pg_temp.ic(p_session uuid) returns uuid language plpgsql security definer as $f$
begin
  return (select c.id from public.integrity_cards c where c.session_id = p_session);
end
$f$;
grant execute on function pg_temp.ic(uuid) to public;
-- pg_temp.msg builds a SessionMirrorMessage (spec section 4.4) for org A; p_key null means the default job key.
create function pg_temp.msg(p_sess uuid, p_inv uuid, p_cons uuid, p_ver uuid, p_item uuid, p_receipt text, p_seq int, p_key text)
returns jsonb language sql as $f$
  select jsonb_build_object(
    'v', 1, 'jobKind', 'session_mirror', 'mirrorSeq', p_seq,
    'jobKey', coalesce(p_key, p_sess::text || ':session_mirror:' || pg_temp.rs(p_ver)::text),
    'sessionId', p_sess, 'orgId', 'a1000000-0000-4000-8000-000000000001', 'invitationId', p_inv, 'testVersionId', p_ver,
    'rulesetVersionId', pg_temp.rs(p_ver), 'consentId', p_cons, 'state', 'submitted', 'receiptRef', p_receipt,
    'startedAt', '2026-10-14T10:00:00Z', 'deadlineAt', '2026-10-14T11:00:00Z', 'submittedAt', '2026-10-14T10:30:00Z',
    'lastEventSeq', 0, 'streamCount', 1, 'resumeCount', 0,
    'served', jsonb_build_array(jsonb_build_object('position', 1, 'itemVersionId', p_item, 'servedAt', '2026-10-14T10:00:05Z')),
    'evidence', jsonb_build_object('finalKey', 'sessions/a/b/final.json', 'finalSha256', repeat('d', 64),
                                   'eventsKey', 'sessions/a/b/events.ndjson', 'eventsSha256', repeat('e', 64)),
    'replay', 'ok', 'signalCatalogVersion', 'd1-v1',
    'coverage', jsonb_build_object('activeMs', 1000, 'coveredMs', 1000), 'gaps', '[]'::jsonb,
    'photo', jsonb_build_object('key', 'media/a1000000-0000-4000-8000-000000000001/' || p_sess::text || '/start_photo.jpg',
                                'sha256', repeat('f', 64), 'bytes', 1000, 'mime', 'image/jpeg', 'blurredOnDevice', true),
    'photoSkippedReason', null)
$f$;
grant execute on function pg_temp.msg(uuid, uuid, uuid, uuid, uuid, text, int, text) to public;
-- Personas (spec D1 3.6): synthetic users, fixed ids, created on the operator path (postgres, no claims).
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
-- Orgs A and B (customers). The org-seed trigger of migration 3 gives each a notice, band rules v1 and a rubric.
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
-- Authoring fixtures on the operator path: T1 (ws A1), T2 (ws A2), TB (org B), each with version 1, one mcq section,
-- one item and its key. The L-8 trigger (migration 3) creates each draft ruleset row and pins the notice; the
-- versions are then published on the operator path.
insert into public.tests (id, org_id, workspace_id, name) values
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test One'),
  ('e1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'Test Two'),
  ('e1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004', 'Test B');
insert into public.test_versions (id, org_id, test_id, version_no, total_time_seconds, quality_cutoff) values
  ('f1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 1, 1800, 40),
  ('f1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 1, 1800, 40),
  ('f1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 1, 1800, 40);
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 1, 'Choices', 'mcq', 1),
  ('51000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 1, 'Choices', 'mcq', 1),
  ('51000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', 1, 'Choices', 'mcq', 1);
insert into public.item_versions (id, org_id, test_version_id, section_id, format, position, stem, options, rubric_version_id, origin, content_sha256) values
  ('61000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'mcq', 1, 'Pick one.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64)),
  ('61000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000002', 'mcq', 1, 'Pick one.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64)),
  ('61000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', '51000000-0000-4000-8000-00000000000b', 'mcq', 1, 'Pick one.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64));
insert into public.item_answer_keys (org_id, item_version_id, format, key) values
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'mcq', '{"option_id": "o1"}'),
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000002', 'mcq', '{"option_id": "o1"}'),
  ('a1000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-00000000000b', 'mcq', '{"option_id": "o1"}');
update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id in ('f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-00000000000b');
-- The assigned reviewer persona is assigned to T1 on the operator path (so the S* arm has something to see).
insert into public.assignments (org_id, membership_id, scope, test_id, as_role)
  select m.org_id, m.id, 'test', 'e1000000-0000-4000-8000-000000000001', 'reviewer'
  from public.memberships m where m.org_id = 'a1000000-0000-4000-8000-000000000001' and m.user_id = '00000000-0000-4000-8000-000000000007';
-- Session fixtures through the real roles, in the real order (spec 3.2 migration 2): the operator inserts the invitations, trace_api walks them to started,
-- trace_worker mirrors the sessions rows and creates the report pointer rows (both card FKs null), as the mirror does.
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'c01@example.test', '0101010101010101010101010101010101010101010101010101010101010101', true, '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'c02@example.test', '0202020202020202020202020202020202020202020202020202020202020202', true, '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'c03@example.test', '0303030303030303030303030303030303030303030303030303030303030303', true, '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'c04@example.test', '0404040404040404040404040404040404040404040404040404040404040404', true, '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'c05@example.test', '0505050505050505050505050505050505050505050505050505050505050505', true, '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'c06@example.test', '0606060606060606060606060606060606060606060606060606060606060606', true, '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'c08@example.test', '0808080808080808080808080808080808080808080808080808080808080808', true, '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'c09@example.test', '0909090909090909090909090909090909090909090909090909090909090909', true, '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'c07@example.test', '0707070707070707070707070707070707070707070707070707070707070707', true, '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000020', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'c20@example.test', '2020202020202020202020202020202020202020202020202020202020202020', true, '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000021', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'c21@example.test', '2121212121212121212121212121212121212121212121212121212121212121', true, '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000040', 'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', 'c40@example.test', '4040404040404040404040404040404040404040404040404040404040404040', true, '2030-01-01 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id in ('a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000006', 'a2000000-0000-4000-8000-000000000008', 'a2000000-0000-4000-8000-000000000009', 'a2000000-0000-4000-8000-000000000007', 'a2000000-0000-4000-8000-000000000020');
update public.invitations set status = 'otp_verified' where id in ('a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000006', 'a2000000-0000-4000-8000-000000000008', 'a2000000-0000-4000-8000-000000000009', 'a2000000-0000-4000-8000-000000000007', 'a2000000-0000-4000-8000-000000000020');
update public.invitations set adult_self_declared = true where id in ('a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000006', 'a2000000-0000-4000-8000-000000000008', 'a2000000-0000-4000-8000-000000000009', 'a2000000-0000-4000-8000-000000000007', 'a2000000-0000-4000-8000-000000000020');
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('a3000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('a3000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('a3000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('a3000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000008', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('a3000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('a3000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000002', pg_temp.rs('f1000000-0000-4000-8000-000000000002'), pg_temp.nt('f1000000-0000-4000-8000-000000000002'), repeat('a', 64), 'en', 'granted');
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('a3000000-0000-4000-8000-000000000020', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000020', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted');
update public.invitations set session_id = 'a4000000-0000-4000-8000-000000000001' where id = 'a2000000-0000-4000-8000-000000000001';
update public.invitations set session_id = 'a4000000-0000-4000-8000-000000000002' where id = 'a2000000-0000-4000-8000-000000000002';
update public.invitations set session_id = 'a4000000-0000-4000-8000-000000000003' where id = 'a2000000-0000-4000-8000-000000000003';
update public.invitations set session_id = 'a4000000-0000-4000-8000-000000000004' where id = 'a2000000-0000-4000-8000-000000000004';
update public.invitations set session_id = 'a4000000-0000-4000-8000-000000000005' where id = 'a2000000-0000-4000-8000-000000000005';
update public.invitations set session_id = 'a4000000-0000-4000-8000-000000000006' where id = 'a2000000-0000-4000-8000-000000000006';
update public.invitations set session_id = 'a4000000-0000-4000-8000-000000000008' where id = 'a2000000-0000-4000-8000-000000000008';
update public.invitations set session_id = 'a4000000-0000-4000-8000-000000000009' where id = 'a2000000-0000-4000-8000-000000000009';
update public.invitations set session_id = 'a4000000-0000-4000-8000-000000000007' where id = 'a2000000-0000-4000-8000-000000000007';
update public.invitations set session_id = 'a4000000-0000-4000-8000-000000000020' where id = 'a2000000-0000-4000-8000-000000000020';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = 'a2000000-0000-4000-8000-000000000001';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = 'a2000000-0000-4000-8000-000000000002';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = 'a2000000-0000-4000-8000-000000000003';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = 'a2000000-0000-4000-8000-000000000004';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = 'a2000000-0000-4000-8000-000000000005';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = 'a2000000-0000-4000-8000-000000000006';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = 'a2000000-0000-4000-8000-000000000008';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = 'a2000000-0000-4000-8000-000000000009';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = 'a2000000-0000-4000-8000-000000000007';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = 'a2000000-0000-4000-8000-000000000020';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
update public.invitations set status = 'sent' where id in ('a2000000-0000-4000-8000-000000000040');
update public.invitations set status = 'otp_verified' where id in ('a2000000-0000-4000-8000-000000000040');
update public.invitations set adult_self_declared = true where id in ('a2000000-0000-4000-8000-000000000040');
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ('a3000000-0000-4000-8000-000000000040', 'a1000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000040', 'f1000000-0000-4000-8000-00000000000b', pg_temp.rs('f1000000-0000-4000-8000-00000000000b'), pg_temp.nt('f1000000-0000-4000-8000-00000000000b'), repeat('a', 64), 'en', 'granted');
update public.invitations set session_id = 'a4000000-0000-4000-8000-000000000040' where id = 'a2000000-0000-4000-8000-000000000040';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = 'a2000000-0000-4000-8000-000000000040';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
update public.invitations set status = 'revoked' where id = 'a2000000-0000-4000-8000-000000000021';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values
  ('a4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'submitted', 'candidate', '2026-10-14 10:20:00+00', true, '2026-10-14 10:00:00+00', '2026-10-14 10:31:00+00', 1, 'RCPT0001'),
  ('a4000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), 'a2000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000002', 'submitted', 'candidate', '2026-10-14 10:20:00+00', true, '2026-10-14 10:00:00+00', '2026-10-14 10:31:00+00', 1, 'RCPT0002'),
  ('a4000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), 'a2000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000003', 'submitted', 'candidate', '2026-10-14 10:20:00+00', true, '2026-10-14 10:00:00+00', '2026-10-14 10:31:00+00', 1, 'RCPT0003'),
  ('a4000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), 'a2000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000004', 'submitted', 'candidate', '2026-10-14 10:20:00+00', true, '2026-10-14 10:00:00+00', '2026-10-14 10:31:00+00', 1, 'RCPT0004'),
  ('a4000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), 'a2000000-0000-4000-8000-000000000005', 'a3000000-0000-4000-8000-000000000005', 'submitted', 'candidate', '2026-10-14 10:20:00+00', true, '2026-10-14 10:00:00+00', '2026-10-14 10:31:00+00', 1, 'RCPT0005'),
  ('a4000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), 'a2000000-0000-4000-8000-000000000006', 'a3000000-0000-4000-8000-000000000006', 'submitted', 'candidate', '2026-10-14 10:20:00+00', true, '2026-10-14 10:00:00+00', '2026-10-14 10:31:00+00', 1, 'RCPT0006'),
  ('a4000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), 'a2000000-0000-4000-8000-000000000008', 'a3000000-0000-4000-8000-000000000008', 'submitted', 'candidate', '2026-10-14 10:20:00+00', true, '2026-10-14 10:00:00+00', '2026-10-14 10:31:00+00', 1, 'RCPT0008'),
  ('a4000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), 'a2000000-0000-4000-8000-000000000009', 'a3000000-0000-4000-8000-000000000009', 'submitted', 'candidate', '2026-10-14 10:20:00+00', true, '2026-10-14 10:00:00+00', '2026-10-14 10:31:00+00', 1, 'RCPT0009'),
  ('a4000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', pg_temp.rs('f1000000-0000-4000-8000-000000000002'), 'a2000000-0000-4000-8000-000000000007', 'a3000000-0000-4000-8000-000000000007', 'submitted', 'candidate', '2026-10-14 10:20:00+00', true, '2026-10-14 10:00:00+00', '2026-10-14 10:31:00+00', 1, 'RCPT0007');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values
  ('a4000000-0000-4000-8000-000000000040', 'a1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', pg_temp.rs('f1000000-0000-4000-8000-00000000000b'), 'a2000000-0000-4000-8000-000000000040', 'a3000000-0000-4000-8000-000000000040', 'submitted', 'candidate', '2026-10-14 10:20:00+00', true, '2026-10-14 10:00:00+00', '2026-10-14 10:31:00+00', 1, 'RCPT0040');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.reports (org_id, session_id) values
  ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003'),
  ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000004'),
  ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000005'),
  ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000006'),
  ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000007');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
insert into public.reports (org_id, session_id) values ('a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000040');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00');
insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00');
insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00');
insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00');
insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00');
insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000001', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00');
insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000002', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00');
insert into public.quality_cards (org_id, session_id, quality_score_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001');
insert into public.quality_cards (org_id, session_id, quality_score_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000002');
insert into public.quality_cards (org_id, session_id, quality_score_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'a5000000-0000-4000-8000-000000000003');
insert into public.quality_cards (org_id, session_id, quality_score_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000004', 'a5000000-0000-4000-8000-000000000004');
insert into public.quality_cards (org_id, session_id, quality_score_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000005', 'a5000000-0000-4000-8000-000000000005');
insert into public.quality_cards (org_id, session_id, quality_score_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000006', 'a5000000-0000-4000-8000-000000000006');
insert into public.quality_cards (org_id, session_id, quality_score_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000007', 'a5000000-0000-4000-8000-000000000007');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000040', 'a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000040', 'f1000000-0000-4000-8000-00000000000b', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00');
insert into public.quality_cards (org_id, session_id, quality_score_id) values ('a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000040', 'a5000000-0000-4000-8000-000000000040');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000001'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000001')), 'band-engine-1', 'clear', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00');
insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000002'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000002')), 'band-engine-1', 'clear', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00');
insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000003'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000003')), 'band-engine-1', 'clear', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00');
insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000004', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000004'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000004')), 'band-engine-1', 'clear', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00');
insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000005', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000005'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000005')), 'band-engine-1', 'clear', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00');
insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000006', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006')), 'band-engine-1', 'clear', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00');
insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000007', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000007'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000007')), 'band-engine-1', 'clear', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00');
insert into public.integrity_cards (org_id, session_id, integrity_result_id, review_state, photo_missing) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'reviewed', false);
insert into public.integrity_cards (org_id, session_id, integrity_result_id, review_state, photo_missing) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'a6000000-0000-4000-8000-000000000002', 'reviewed', false);
insert into public.integrity_cards (org_id, session_id, integrity_result_id, review_state, photo_missing) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'a6000000-0000-4000-8000-000000000003', 'reviewed', false);
insert into public.integrity_cards (org_id, session_id, integrity_result_id, review_state, photo_missing) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000004', 'a6000000-0000-4000-8000-000000000004', 'reviewed', false);
insert into public.integrity_cards (org_id, session_id, integrity_result_id, review_state, photo_missing) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000005', 'a6000000-0000-4000-8000-000000000005', 'reviewed', false);
insert into public.integrity_cards (org_id, session_id, integrity_result_id, review_state, photo_missing) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000006', 'a6000000-0000-4000-8000-000000000006', 'reviewed', false);
insert into public.integrity_cards (org_id, session_id, integrity_result_id, review_state, photo_missing) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000007', 'a6000000-0000-4000-8000-000000000007', 'reviewed', false);
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000040', 'a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000040', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000040'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000040')), 'band-engine-1', 'clear', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00');
insert into public.integrity_cards (org_id, session_id, integrity_result_id, review_state, photo_missing) values ('a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000040', 'a6000000-0000-4000-8000-000000000040', 'reviewed', false);
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
-- ===== structure: public.reports holds ids only, FKs into the public cards, RLS on, no internal-schema reference (R-1, I-1) =====
select is((select relrowsecurity from pg_class where oid = 'public.reports'::regclass), true, 'reports: row level security is enabled');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'reports' and cmd = 'ALL'), 0, 'reports: no FOR ALL policy (MT-11)');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'reports' and roles @> array['public']::name[]), 0, 'reports: no policy is granted to PUBLIC');
select is((select string_agg(attname, ',' order by attname) from pg_attribute where attrelid = 'public.reports'::regclass and attnum > 0 and not attisdropped), 'created_at,id,integrity_card_id,org_id,quality_card_id,session_id,test_id,workspace_id', 'reports: exactly the ids, the scoping columns and created_at (no number, band, state or text column)');
select is((select count(*)::int from pg_attribute where attrelid = 'public.reports'::regclass and attnum > 0 and not attisdropped and attname ~ '(score|band|grade|outcome|reject|state|decision|verdict|text)'), 0, 'reports: no column named like a score, band, state, outcome, rejection or text (I-1, I-2)');
select is((select count(*)::int from pg_constraint c join pg_class t on t.oid = c.confrelid join pg_namespace n on n.oid = t.relnamespace where c.conrelid = 'public.reports'::regclass and c.contype = 'f' and n.nspname <> 'public'), 0, 'reports: every foreign key references a public table (never quality.* or integrity.*)');
select ok((select exists (select 1 from pg_constraint c where c.conrelid = 'public.reports'::regclass and c.contype = 'f' and c.confrelid = 'public.quality_cards'::regclass and (select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['org_id', 'quality_card_id', 'session_id'])), 'reports: composite FK (org_id, quality_card_id, session_id) references public.quality_cards');
select ok((select exists (select 1 from pg_constraint c where c.conrelid = 'public.reports'::regclass and c.contype = 'f' and c.confrelid = 'public.integrity_cards'::regclass and (select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['integrity_card_id', 'org_id', 'session_id'])), 'reports: composite FK (org_id, integrity_card_id, session_id) references public.integrity_cards');
select is((select count(*)::int from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.reports'::regclass and not t.tgisinternal and pg_get_functiondef(p.oid) ~ '(^|[^a-z_])(quality|integrity)[.][a-z_]'), 0, 'reports: no trigger function names quality.* or integrity.* (MT-5d outside_host_both)');
select is((select (select count(*) from pg_constraint c where c.conrelid = 'public.reports'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ~ '(^|[^a-z_])(quality|integrity)[.][a-z_]')::int + (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'reports' and coalesce(p.qual, '') || coalesce(p.with_check, '') ~ '(^|[^a-z_])(quality|integrity)[.][a-z_]')::int), 0, 'reports: no CHECK or policy names quality.* or integrity.*');
select ok((select exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'reports' and indexdef ~ '[(]org_id, test_id[)]')), 'reports: index (org_id, test_id) exists (L-27)');
select ok((select exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'reports' and indexdef ~ '[(]org_id, workspace_id[)]')), 'reports: index (org_id, workspace_id) exists (L-27)');
select ok((select exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'reports' and indexdef ~ 'UNIQUE.*[(]org_id, session_id[)]')), 'reports: one report per session (unique org_id, session_id)');
select is((select count(*)::int from public.reports where session_id = 'a4000000-0000-4000-8000-000000000001' and workspace_id = 'b1000000-0000-4000-8000-000000000001' and test_id = 'e1000000-0000-4000-8000-000000000001'), 1, 'reports: workspace_id and test_id are copied from the session (L-27)');
-- ===== (a) trace_api reads none of the result read-model tables (moved out of migration 2; matrix row trace_api = none) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select count(*) from public.quality_cards$$), '^42501 permission denied', 'trace_api: SELECT on public.quality_cards is denied (42501), with api_org_id set');
select matches(pg_temp.try($$select count(*) from public.integrity_cards$$), '^42501 permission denied', 'trace_api: SELECT on public.integrity_cards is denied (42501), with api_org_id set');
select matches(pg_temp.try($$select count(*) from public.integrity_timeline_entries$$), '^42501 permission denied', 'trace_api: SELECT on public.integrity_timeline_entries is denied (42501), with api_org_id set');
select matches(pg_temp.try($$select count(*) from public.reports$$), '^42501 permission denied', 'trace_api: SELECT on public.reports is denied (42501), with api_org_id set');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select coalesce(string_agg(t, ',' order by t), '') from unnest(array['public.quality_cards', 'public.integrity_cards', 'public.integrity_timeline_entries', 'public.reports']) t where has_any_column_privilege('trace_api', t::regclass, 'SELECT,INSERT,UPDATE,REFERENCES') or has_table_privilege('trace_api', t::regclass, 'DELETE,TRUNCATE,TRIGGER')), '', 'trace_api: holds no privilege of any kind on the four result read-model tables');
-- ===== privileges: column grants per worker (R-1, matrix row reports) =====
select is((select coalesce(string_agg(attname::text, ',' order by attname), '') from pg_attribute where attrelid = 'public.reports'::regclass and attnum > 0 and not attisdropped and has_column_privilege('trace_quality_worker', 'public.reports', attname, 'SELECT')), 'id,org_id,quality_card_id,session_id', 'quality worker: SELECT (id, org_id, session_id) plus its own FK column, nothing else');
select is((select coalesce(string_agg(attname::text, ',' order by attname), '') from pg_attribute where attrelid = 'public.reports'::regclass and attnum > 0 and not attisdropped and has_column_privilege('trace_quality_worker', 'public.reports', attname, 'UPDATE')), 'quality_card_id', 'quality worker: UPDATE (quality_card_id) only');
select is((select has_any_column_privilege('trace_quality_worker', 'public.reports', 'INSERT') or has_table_privilege('trace_quality_worker', 'public.reports', 'DELETE')), false, 'quality worker: no INSERT and no DELETE on reports');
select is((select coalesce(string_agg(attname::text, ',' order by attname), '') from pg_attribute where attrelid = 'public.reports'::regclass and attnum > 0 and not attisdropped and has_column_privilege('trace_integrity_worker', 'public.reports', attname, 'SELECT')), 'id,integrity_card_id,org_id,session_id', 'integrity worker: SELECT (id, org_id, session_id) plus its own FK column, nothing else');
select is((select coalesce(string_agg(attname::text, ',' order by attname), '') from pg_attribute where attrelid = 'public.reports'::regclass and attnum > 0 and not attisdropped and has_column_privilege('trace_integrity_worker', 'public.reports', attname, 'UPDATE')), 'integrity_card_id', 'integrity worker: UPDATE (integrity_card_id) only');
select is((select has_any_column_privilege('trace_integrity_worker', 'public.reports', 'INSERT') or has_table_privilege('trace_integrity_worker', 'public.reports', 'DELETE')), false, 'integrity worker: no INSERT and no DELETE on reports');
select is((select has_any_column_privilege('trace_worker', 'public.reports', 'UPDATE') or has_table_privilege('trace_worker', 'public.reports', 'DELETE')), false, 'trace_worker: no UPDATE and no DELETE on reports (it creates the pointer row only)');
select is((select has_column_privilege('trace_worker', 'public.reports', 'org_id', 'INSERT') and has_column_privilege('trace_worker', 'public.reports', 'session_id', 'INSERT') and not has_column_privilege('trace_worker', 'public.reports', 'quality_card_id', 'INSERT') and not has_column_privilege('trace_worker', 'public.reports', 'integrity_card_id', 'INSERT')), true, 'trace_worker: INSERT covers the session ids and never a card FK column');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway']) r where has_any_column_privilege(r, 'public.reports', 'SELECT,INSERT,UPDATE,REFERENCES') or has_table_privilege(r, 'public.reports', 'DELETE,TRUNCATE,TRIGGER')), '', 'reports: anon, service_role, trace_api and both candidate roles hold no privilege');
select is((select has_table_privilege('authenticated', 'public.reports', 'SELECT') and not has_any_column_privilege('authenticated', 'public.reports', 'INSERT,UPDATE') and not has_table_privilege('authenticated', 'public.reports', 'DELETE')), true, 'authenticated: SELECT only on reports (matrix: S)');
-- ===== trace_worker: inserts the pointer row (both FKs null) for its own org only =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.reports (org_id, session_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001')$$), '^23505', 'reports I: a second report for the same session is refused (unique org_id, session_id)');
select is(pg_temp.try($$insert into public.reports (org_id, session_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001') on conflict do nothing$$), 'OK 0', 'reports I: the replayed insert with on conflict do nothing is a no-op');
select matches(pg_temp.try($$insert into public.reports (org_id, session_id, quality_card_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000008', 'a5000000-0000-4000-8000-000000000001')$$), '^42501', 'reports I: the pointer row is created with both card FKs null (supplying one is refused)');
select matches(pg_temp.try($$insert into public.reports (org_id, session_id, integrity_card_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000008', 'a6000000-0000-4000-8000-000000000001')$$), '^42501', 'reports I: supplying integrity_card_id at insert is refused too');
select is(pg_temp.try($$insert into public.reports (org_id, session_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000008')$$), 'OK 1', 'reports I: trace_worker inserts the pointer row from the ids alone');
select matches(pg_temp.try($$insert into public.reports (org_id, session_id) values ('a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000040')$$), '^42501', 'reports I: job org A cannot insert a report row for org B (cross-org)');
select matches(pg_temp.try($$insert into public.reports (org_id, session_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000040')$$), '^(23503|42501|P0001)', 'reports I: an org A row pointing at an org B session is refused (composite FK / session copy)');
select matches(pg_temp.try($$update public.reports set quality_card_id = null$$), '^42501 permission denied', 'reports U: trace_worker holds no UPDATE');
select matches(pg_temp.try($$delete from public.reports$$), '^42501 permission denied', 'reports D: trace_worker holds no DELETE');
select is((select count(*)::int from public.reports), 8, 'reports S: job org A sees its 8 report rows');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.reports), 1, 'reports S: job org B sees only its own report row (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select matches(pg_temp.try($$insert into public.reports (org_id, session_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000009')$$), '^42501', 'reports I: with no job org trace_worker cannot insert');
select is((select count(*)::int from public.reports), 0, 'reports S: with no job org trace_worker sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select count(*)::int from public.reports where session_id = 'a4000000-0000-4000-8000-000000000008' and quality_card_id is null and integrity_card_id is null and workspace_id = 'b1000000-0000-4000-8000-000000000001' and test_id = 'e1000000-0000-4000-8000-000000000001'), 1, 'reports: the pointer row has both FKs null and the session''s workspace and test');
select is((select count(*)::int from public.reports where session_id = 'a4000000-0000-4000-8000-000000000009'), 0, 'reports: the refused inserts left no row behind');
-- ===== quality worker: attaches its own card, once, to its own org's report; never the integrity column =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$select id, org_id, session_id, quality_card_id from public.reports$$), 'OK 8', 'reports S: the quality worker reads (id, org_id, session_id, quality_card_id) for job org A');
select matches(pg_temp.try($$select integrity_card_id from public.reports$$), '^42501 permission denied', 'reports S: the quality worker cannot read integrity_card_id (rule 1: no role holds both cards'' pointers)');
select matches(pg_temp.try($$select * from public.reports$$), '^42501 permission denied', 'reports S: select * is denied to the quality worker (non-granted columns)');
select is(pg_temp.try($$update public.reports set quality_card_id = pg_temp.qc('a4000000-0000-4000-8000-000000000001') where session_id = 'a4000000-0000-4000-8000-000000000001'$$), 'OK 1', 'reports U: the quality worker attaches S1''s quality card (null to non-null)');
select matches(pg_temp.try($$update public.reports set integrity_card_id = pg_temp.ic('a4000000-0000-4000-8000-000000000005') where session_id = 'a4000000-0000-4000-8000-000000000005'$$), '^42501 permission denied', 'reports U: the quality worker cannot set integrity_card_id');
select matches(pg_temp.try($$update public.reports set session_id = session_id where session_id = 'a4000000-0000-4000-8000-000000000005'$$), '^42501 permission denied', 'reports U: the quality worker cannot touch session_id (column grant)');
select matches(pg_temp.try($$update public.reports set workspace_id = workspace_id where session_id = 'a4000000-0000-4000-8000-000000000005'$$), '^42501 permission denied', 'reports U: the quality worker cannot touch workspace_id (column grant)');
select matches(pg_temp.try($$update public.reports set quality_card_id = null where session_id = 'a4000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001)', 'reports U: a set quality_card_id cannot be cleared (set-once)');
select matches(pg_temp.try($$update public.reports set quality_card_id = pg_temp.qc('a4000000-0000-4000-8000-000000000002') where session_id = 'a4000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001)', 'reports U: a set quality_card_id cannot be changed to another card (set-once)');
select matches(pg_temp.try($$update public.reports set quality_card_id = pg_temp.qc('a4000000-0000-4000-8000-000000000004') where session_id = 'a4000000-0000-4000-8000-000000000003'$$), '^23503', 'reports U: a quality card of another session is refused by the composite FK');
select matches(pg_temp.try($$update public.reports set quality_card_id = 'a5000000-0000-4000-8000-000000000003' where session_id = 'a4000000-0000-4000-8000-000000000003'$$), '^23503', 'reports U: a quality.scores id is not a card: the FK reaches public.quality_cards only');
select matches(pg_temp.try($$update public.reports set quality_card_id = gen_random_uuid() where session_id = 'a4000000-0000-4000-8000-000000000003'$$), '^23503', 'reports U: a quality_card_id that exists nowhere is refused');
select matches(pg_temp.try($$update public.reports set quality_card_id = pg_temp.qc('a4000000-0000-4000-8000-000000000040') where session_id = 'a4000000-0000-4000-8000-000000000003'$$), '^23503', 'reports U: an org B quality card cannot be attached to an org A report (cross-org FK)');
select is(pg_temp.try($$update public.reports set quality_card_id = pg_temp.qc('a4000000-0000-4000-8000-000000000040') where session_id = 'a4000000-0000-4000-8000-000000000040'$$), 'OK 0', 'reports U: job org A cannot attach anything to org B''s report (RLS hides the row)');
select matches(pg_temp.try($$insert into public.reports (org_id, session_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000009')$$), '^42501 permission denied', 'reports I: the quality worker holds no INSERT');
select matches(pg_temp.try($$delete from public.reports$$), '^42501 permission denied', 'reports D: the quality worker holds no DELETE');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is(pg_temp.try($$update public.reports set quality_card_id = pg_temp.qc('a4000000-0000-4000-8000-000000000003') where session_id = 'a4000000-0000-4000-8000-000000000003'$$), 'OK 0', 'reports U: job org B cannot attach a card to org A''s report (cross-org)');
select is((select count(*)::int from public.reports), 1, 'reports S: job org B quality worker sees only org B''s report row');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
select is(pg_temp.try($$update public.reports set quality_card_id = pg_temp.qc('a4000000-0000-4000-8000-000000000003') where session_id = 'a4000000-0000-4000-8000-000000000003'$$), 'OK 0', 'reports U: with no job org the quality worker updates nothing');
select is(pg_temp.try($$select id from public.reports$$), 'OK 0', 'reports S: with no job org the quality worker sees nothing');
-- ===== integrity worker: attaches its own card, once, in either order relative to the quality card =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$select id, org_id, session_id, integrity_card_id from public.reports$$), 'OK 8', 'reports S: the integrity worker reads (id, org_id, session_id, integrity_card_id) for job org A');
select matches(pg_temp.try($$select quality_card_id from public.reports$$), '^42501 permission denied', 'reports S: the integrity worker cannot read quality_card_id');
select matches(pg_temp.try($$select * from public.reports$$), '^42501 permission denied', 'reports S: select * is denied to the integrity worker (non-granted columns)');
select is(pg_temp.try($$update public.reports set integrity_card_id = pg_temp.ic('a4000000-0000-4000-8000-000000000002') where session_id = 'a4000000-0000-4000-8000-000000000002'$$), 'OK 1', 'reports U: the integrity worker attaches S2''s integrity card first (the other column is still null)');
select is(pg_temp.try($$update public.reports set integrity_card_id = pg_temp.ic('a4000000-0000-4000-8000-000000000001') where session_id = 'a4000000-0000-4000-8000-000000000001'$$), 'OK 1', 'reports U: the integrity worker attaches S1''s integrity card after the quality card (either order)');
select matches(pg_temp.try($$update public.reports set quality_card_id = pg_temp.qc('a4000000-0000-4000-8000-000000000005') where session_id = 'a4000000-0000-4000-8000-000000000005'$$), '^42501 permission denied', 'reports U: the integrity worker cannot set quality_card_id');
select matches(pg_temp.try($$update public.reports set session_id = session_id where session_id = 'a4000000-0000-4000-8000-000000000005'$$), '^42501 permission denied', 'reports U: the integrity worker cannot touch session_id (column grant)');
select matches(pg_temp.try($$update public.reports set integrity_card_id = null where session_id = 'a4000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001)', 'reports U: a set integrity_card_id cannot be cleared (set-once)');
select matches(pg_temp.try($$update public.reports set integrity_card_id = pg_temp.ic('a4000000-0000-4000-8000-000000000002') where session_id = 'a4000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001)', 'reports U: a set integrity_card_id cannot be changed to another card (set-once)');
select matches(pg_temp.try($$update public.reports set integrity_card_id = pg_temp.ic('a4000000-0000-4000-8000-000000000004') where session_id = 'a4000000-0000-4000-8000-000000000003'$$), '^23503', 'reports U: an integrity card of another session is refused by the composite FK');
select matches(pg_temp.try($$update public.reports set integrity_card_id = 'a6000000-0000-4000-8000-000000000003' where session_id = 'a4000000-0000-4000-8000-000000000003'$$), '^23503', 'reports U: an integrity.results id is not a card: the FK reaches public.integrity_cards only');
select matches(pg_temp.try($$update public.reports set integrity_card_id = pg_temp.ic('a4000000-0000-4000-8000-000000000040') where session_id = 'a4000000-0000-4000-8000-000000000003'$$), '^23503', 'reports U: an org B integrity card cannot be attached to an org A report (cross-org FK)');
select is(pg_temp.try($$update public.reports set integrity_card_id = pg_temp.ic('a4000000-0000-4000-8000-000000000040') where session_id = 'a4000000-0000-4000-8000-000000000040'$$), 'OK 0', 'reports U: job org A cannot attach anything to org B''s report (RLS hides the row)');
select matches(pg_temp.try($$insert into public.reports (org_id, session_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000009')$$), '^42501 permission denied', 'reports I: the integrity worker holds no INSERT');
select matches(pg_temp.try($$delete from public.reports$$), '^42501 permission denied', 'reports D: the integrity worker holds no DELETE');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is(pg_temp.try($$update public.reports set integrity_card_id = pg_temp.ic('a4000000-0000-4000-8000-000000000003') where session_id = 'a4000000-0000-4000-8000-000000000003'$$), 'OK 0', 'reports U: job org B cannot attach a card to org A''s report (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
select is(pg_temp.try($$update public.reports set integrity_card_id = pg_temp.ic('a4000000-0000-4000-8000-000000000003') where session_id = 'a4000000-0000-4000-8000-000000000003'$$), 'OK 0', 'reports U: with no job org the integrity worker updates nothing');
select is(pg_temp.try($$select id from public.reports$$), 'OK 0', 'reports S: with no job org the integrity worker sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$update public.reports set quality_card_id = pg_temp.qc('a4000000-0000-4000-8000-000000000002') where session_id = 'a4000000-0000-4000-8000-000000000002'$$), 'OK 1', 'reports U: the quality worker attaches S2''s quality card after the integrity card (either order)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select count(*)::int from public.reports where session_id in ('a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002') and quality_card_id = pg_temp.qc(session_id) and integrity_card_id = pg_temp.ic(session_id)), 2, 'reports: S1 and S2 point at their own two cards, attached in opposite orders');
select is((select count(*)::int from public.reports where session_id in ('a4000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000005', 'a4000000-0000-4000-8000-000000000006', 'a4000000-0000-4000-8000-000000000007', 'a4000000-0000-4000-8000-000000000008') and (quality_card_id is not null or integrity_card_id is not null)), 0, 'reports: every refused attach left the other reports untouched');
-- ===== reports_set_once: nothing but the null-to-non-null attach is possible, for the operator too =====
select matches(pg_temp.try($$update public.reports set quality_card_id = null where session_id = 'a4000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001)', 'reports_set_once: the operator cannot clear an attached quality_card_id');
select matches(pg_temp.try($$update public.reports set integrity_card_id = null where session_id = 'a4000000-0000-4000-8000-000000000001'$$), '^(42501 TRACE_GUARD|P0001)', 'reports_set_once: the operator cannot clear an attached integrity_card_id');
select matches(pg_temp.try($$update public.reports set workspace_id = 'b1000000-0000-4000-8000-000000000002' where session_id = 'a4000000-0000-4000-8000-000000000006'$$), '^(42501 TRACE_GUARD|P0001|23503)', 'reports_set_once: workspace_id is immutable (L-27)');
select matches(pg_temp.try($$update public.reports set test_id = 'e1000000-0000-4000-8000-000000000002' where session_id = 'a4000000-0000-4000-8000-000000000006'$$), '^(42501 TRACE_GUARD|P0001|23503)', 'reports_set_once: test_id is immutable (L-27)');
select matches(pg_temp.try($$update public.reports set session_id = 'a4000000-0000-4000-8000-000000000009' where session_id = 'a4000000-0000-4000-8000-000000000006'$$), '^(42501 TRACE_GUARD|P0001|23503)', 'reports_set_once: session_id is immutable');
select matches(pg_temp.try($$update public.reports set created_at = created_at - interval '1 day' where session_id = 'a4000000-0000-4000-8000-000000000006'$$), '^(42501 TRACE_GUARD|P0001)', 'reports_set_once: created_at is immutable ("changes nothing else")');
-- ===== SELECT arms: OW/AD/RC org-wide (workspace arm), RV assigned, HM denied, cross-org (matrix row reports) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.reports), 8, 'reports S: org_owner (aal2) sees all 8 report rows of org A');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.reports), 8, 'reports S: admin (aal2) sees all 8 report rows of org A');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.reports), 8, 'reports S: recruiter (email OTP) sees all 8 report rows of org A (report cards are org-wide for OW/AD/RC, R-15)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.reports), 0, 'reports S: recruiter with a password only (no OTP) sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000009", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.reports), 1, 'reports S: workspace-A2 recruiter sees only the A2 report (workspace fence, L-27)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.reports), 7, 'reports S: assigned reviewer (aal2) sees the 7 reports of the assigned test T1 (S* arm)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.reports), 0, 'reports S: assigned reviewer at aal1 sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000014", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.reports), 0, 'reports S: unassigned reviewer sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.reports), 0, 'reports S: hiring_manager is denied (D1-14)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000b", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.reports), 0, 'reports S: a removed recruiter sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000c", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.reports), 0, 'reports S: a suspended recruiter sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.reports), 1, 'reports S: org B admin sees only its own report row');
select is((select count(*)::int from public.reports where org_id = 'a1000000-0000-4000-8000-000000000001'), 0, 'reports S: org B admin sees no org A report (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.reports where org_id = 'a1000000-0000-4000-8000-000000000003'), 0, 'reports S: org A owner sees no org B report (cross-org)');
select matches(pg_temp.try($$insert into public.reports (org_id, session_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000009')$$), '^42501 permission denied', 'reports I: an org owner holds no INSERT (rows come from the mirror only)');
select matches(pg_temp.try($$update public.reports set quality_card_id = null$$), '^42501 permission denied', 'reports U: an org owner holds no UPDATE');
select matches(pg_temp.try($$delete from public.reports$$), '^42501 permission denied', 'reports D: an org owner holds no DELETE');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role anon;
select matches(pg_temp.try($$select count(*) from public.reports$$), '^42501 permission denied', 'reports S: anon holds no privilege on reports');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate;
select matches(pg_temp.try($$select count(*) from public.reports$$), '^42501 permission denied', 'reports S: trace_candidate holds no privilege on reports');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate_gateway;
select matches(pg_temp.try($$select count(*) from public.reports$$), '^42501 permission denied', 'reports S: trace_candidate_gateway holds no privilege on reports');
-- ===== (b) private.mirror_session writes exactly one reports row (both card FKs null) for a mirrored session (draft NOTES D-1) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches((select private.mirror_session('a1000000-0000-4000-8000-000000000001', pg_temp.msg('a4000000-0000-4000-8000-000000000020', 'a2000000-0000-4000-8000-000000000020', 'a3000000-0000-4000-8000-000000000020', 'f1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'RCPT0020', 1, null)))::text, '^(?!duplicate$|dead_invitation$).+', 'mirror_session: the first call for the started invitation stores the session');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select count(*)::int from public.sessions where id = 'a4000000-0000-4000-8000-000000000020'), 1, 'mirror_session: the sessions row for M1 was stored');
select is((select count(*)::int from public.reports where session_id = 'a4000000-0000-4000-8000-000000000020'), 1, 'mirror_session: writes exactly one reports row for the mirrored session');
select is((select count(*)::int from public.reports where session_id = 'a4000000-0000-4000-8000-000000000020' and quality_card_id is null and integrity_card_id is null), 1, 'mirror_session: the new reports row has both card FKs null');
select is((select count(*)::int from public.reports where session_id = 'a4000000-0000-4000-8000-000000000020' and workspace_id = 'b1000000-0000-4000-8000-000000000001' and test_id = 'e1000000-0000-4000-8000-000000000001' and org_id = 'a1000000-0000-4000-8000-000000000001'), 1, 'mirror_session: the reports row carries the session''s org, workspace and test');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select private.mirror_session('a1000000-0000-4000-8000-000000000001', pg_temp.msg('a4000000-0000-4000-8000-000000000020', 'a2000000-0000-4000-8000-000000000020', 'a3000000-0000-4000-8000-000000000020', 'f1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'RCPT0020', 1, null))), 'duplicate', 'mirror_session: a replayed message returns duplicate');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select count(*)::int from public.reports where session_id = 'a4000000-0000-4000-8000-000000000020'), 1, 'mirror_session: the replay wrote no second reports row');
select is((select count(*)::int from public.reports where org_id = 'a1000000-0000-4000-8000-000000000001'), 9, 'mirror_session: exactly one reports row was added to org A in total');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select private.mirror_session('a1000000-0000-4000-8000-000000000001', pg_temp.msg('a4000000-0000-4000-8000-000000000021', 'a2000000-0000-4000-8000-000000000021', 'a3000000-0000-4000-8000-000000000021', 'f1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'RCPT0021', 1, null))), 'dead_invitation', 'mirror_session: a revoked invitation returns dead_invitation');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select count(*)::int from public.reports where session_id = 'a4000000-0000-4000-8000-000000000021'), 0, 'mirror_session: a dead invitation stores no reports row');
select is((select count(*)::int from public.reports where org_id = 'a1000000-0000-4000-8000-000000000001'), 9, 'mirror_session: the dead invitation changed no report count');

select * from finish();
rollback;
