-- rls_d1_sessions (spec specs/d1-demo-slice.md §3.6 row "rls_d1_sessions"; §3.2 sessions, session_items; §3.4 mirror_session; §10-DB mirror cases; L-6, L-35). RED first: written from the spec, targets migration <ts2>_d1_invites_sessions.sql (migration 2) on top of
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
select plan(93);
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

-- D1-M1-SHIM (remove when migration 3 lands): stands in for migration 3's L-8 trigger, which pins a new
-- ruleset row and the org notice on every draft insert (spec §3.1 row 3, L-8, L-34). It is created only
-- while integrity.band_rule_versions does not exist, inside this rolled-back transaction, so publish paths
-- can be exercised against migration 1 alone. Same trigger name as planned for L-8 (sorts after the guard).
do $shim$
begin
  if to_regclass('integrity.band_rule_versions') is null then
    create function private.d1_m1_shim_pin() returns trigger
    language plpgsql security definer set search_path = '' as $f$
    declare
      v_notice uuid;
      v_rs uuid;
    begin
      select n.id into v_notice from public.notice_versions as n
      where n.org_id = new.org_id and n.notice_key = 'd1-m1-shim' and n.version = 1;
      if v_notice is null then
        insert into public.notice_versions (org_id, notice_key, version, language, body_template, template_sha256)
        values (new.org_id, 'd1-m1-shim', 1, 'en', 'Synthetic notice body.', repeat('0', 64))
        returning id into v_notice;
      end if;
      insert into public.ruleset_versions (org_id, workspace_id, test_id, version_no, band_rule_version_id, signal_settings)
      values (new.org_id, new.workspace_id, new.test_id, new.version_no, gen_random_uuid(),
        '{"paste":{"enabled":true},"drop":{"enabled":true},"untrusted_input":{"enabled":true},'
        '"tab_hidden":{"enabled":true},"fullscreen_exit":{"enabled":true}}'::jsonb)
      returning id into v_rs;
      new.ruleset_version_id := v_rs;
      new.notice_version_id := v_notice;
      return new;
    end
    $f$;
    create trigger test_versions_ruleset_seed before insert on public.test_versions
      for each row execute function private.d1_m1_shim_pin();
  end if;
end
$shim$;

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

-- Fixtures. k1 started (direct-insert target), k2 started (mirror_session target), k3 started with an in_progress session (update target),
-- k4 and k5 started with no session (refusal targets), k6 started with a session on T2, k7 started with a session in org B,
-- k8 created then revoked (dead_invitation), k9 otp_verified with no consent.
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
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000001' where id = '41000000-0000-4000-8000-000000000001';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000001';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand02@example.test', '0202020202020202020202020202020202020202020202020202020202020202', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000002';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000002';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000002';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000002' where id = '41000000-0000-4000-8000-000000000002';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000002';
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
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000003';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000003' where id = '41000000-0000-4000-8000-000000000003';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000003';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000003', '42000000-0000-4000-8000-000000000003', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000003');
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
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000004' where id = '41000000-0000-4000-8000-000000000004';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000004';
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
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), pg_temp.nt('f1000000-0000-4000-8000-000000000001'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000005' where id = '41000000-0000-4000-8000-000000000005';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000005';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'cand06@example.test', '0606060606060606060606060606060606060606060606060606060606060606', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000006';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000006';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000006';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000002', pg_temp.rs('f1000000-0000-4000-8000-000000000002'), pg_temp.nt('f1000000-0000-4000-8000-000000000002'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000006' where id = '41000000-0000-4000-8000-000000000006';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000006';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', pg_temp.rs('f1000000-0000-4000-8000-000000000002'), '41000000-0000-4000-8000-000000000006', '42000000-0000-4000-8000-000000000006', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000006');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', 'cand07@example.test', '0707070707070707070707070707070707070707070707070707070707070707', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000007';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000007';
update public.invitations set adult_self_declared = true where id = '41000000-0000-4000-8000-000000000007';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at) values ('42000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-00000000000b', pg_temp.rs('f1000000-0000-4000-8000-00000000000b'), pg_temp.nt('f1000000-0000-4000-8000-00000000000b'), repeat('a', 64), 'en', 'granted', '2026-10-14 09:55:00+00');
update public.invitations set session_id = '43000000-0000-4000-8000-000000000007' where id = '41000000-0000-4000-8000-000000000007';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = '41000000-0000-4000-8000-000000000007';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', pg_temp.rs('f1000000-0000-4000-8000-00000000000b'), '41000000-0000-4000-8000-000000000007', '42000000-0000-4000-8000-000000000007', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000007');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand08@example.test', '0808080808080808080808080808080808080808080808080808080808080808', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
update public.invitations set status = 'revoked' where id = '41000000-0000-4000-8000-000000000008';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values ('41000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'cand09@example.test', '0909090909090909090909090909090909090909090909090909090909090909', true, '2026-12-31 00:00:00+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id = '41000000-0000-4000-8000-000000000009';
update public.invitations set status = 'otp_verified' where id = '41000000-0000-4000-8000-000000000009';
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 1, '2026-10-14 10:00:05+00');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;

-- ===== S: sessions (A: k3 on T1, k6 on T2; B: k7) =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.sessions), 2, 'S: org_owner sees both org A sessions');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.sessions), 2, 'S: admin sees both org A sessions');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.sessions), 2, 'S: recruiter (aal1, email OTP) sees both org A sessions');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000009", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.sessions), 1, 'S: workspace-A2 recruiter sees only the T2 session');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000007", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.sessions), 1, 'S: assigned reviewer sees the T1 session (S*)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000014", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.sessions), 0, 'S: unassigned reviewer sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000008", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.sessions), 0, 'S: hiring_manager sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1760000000}], "role": "authenticated"}';
select is((select count(*)::int from public.sessions), 0, 'S: password-only recruiter at aal1 sees none');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000e", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select is((select count(*)::int from public.sessions), 1, 'S: org B admin sees only the org B session (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.sessions), 2, 'S: trace_worker with job org A sees the org A sessions');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.sessions), 1, 'S: trace_worker with job org B sees only org B');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select is((select count(*)::int from public.sessions), 0, 'S: trace_worker without a job org sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.sessions), 2, 'S: trace_quality_worker with job org A sees the org A sessions');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
select is((select count(*)::int from public.sessions), 0, 'S: trace_quality_worker without a job org sees nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.sessions), 2, 'S: trace_integrity_worker with job org A sees the org A sessions');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.sessions), 1, 'S: trace_integrity_worker with job org B sees only org B');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select id from public.sessions$$), '^42501 permission denied', 'S: trace_api has no privilege on sessions');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role anon;
select matches(pg_temp.try($$select id from public.sessions$$), '^42501 permission denied', 'S: anon has no privilege');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate;
select matches(pg_temp.try($$select id from public.sessions$$), '^42501 permission denied', 'S: trace_candidate has no privilege');
-- ===== I: trace_worker inserts sessions; every pin is a composite FK or a guard =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000001')$$), 'OK 1', 'I: trace_worker inserts the session of a started invitation with its own consent (k1)');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000003', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'pin: another invitation''s consent is refused (k5 with the consent of k3)');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000002'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'pin: another version''s ruleset is refused (consent, invitation and ruleset must agree)');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000037', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'pin: a session id other than invitations.session_id is refused (composite FK)');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', pg_temp.rs('f1000000-0000-4000-8000-000000000002'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'pin: a test version other than the invitation''s is refused');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000009', '42000000-0000-4000-8000-000000000063', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000009')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'pin: no consent, no session (k9 never consented)');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, false, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^23514', 'CHECK: adult_confirmed_at_start must be true (rule 9)');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 10:00:00+00', 1, 'RC000005')$$), '^23514', 'CHECK: server_deadline_at must be after started_at');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, '2026-10-14 10:30:00+00', true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^23514', 'CHECK: an in_progress session has no submitted_at and no submit_kind');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'submitted', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^23514', 'CHECK: a submitted session needs submitted_at and submit_kind');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'submitted', 'candidate', '2026-10-14 09:00:00+00', true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^23514', 'CHECK: submitted_at cannot precede started_at');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'abc')$$), '^23514', 'CHECK: receipt_ref must match ^[A-Z0-9]{8,16}$ (too short)');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'rc000005')$$), '^23514', 'CHECK: receipt_ref must be upper case');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 0, 'RC000005')$$), '^23514', 'CHECK: mirror_seq is at least 1');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000004', '42000000-0000-4000-8000-000000000004', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000003')$$), '^23505', 'unique: receipt_ref is unique per org');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000021', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000003', '42000000-0000-4000-8000-000000000003', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000033')$$), '^(23505|23503)', 'unique: one attempt per invitation in D1 (a second session for k3)');
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000001')$$), '^23505', 'unique: a replayed insert of the same session id is a unique violation');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^42501', 'I: trace_worker with job org B cannot insert into org A (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^42501', 'I: trace_worker without a job org cannot insert');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^42501 permission denied', 'I: trace_quality_worker cannot insert a session');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^42501 permission denied', 'I: trace_integrity_worker cannot insert a session');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^42501 permission denied', 'I: trace_api cannot insert a session');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^42501 permission denied', 'I: an org_owner cannot insert a session');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role anon;
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^42501 permission denied', 'I: anon cannot insert a session');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_candidate;
select matches(pg_temp.try($$insert into public.sessions (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, submitted_at, adult_confirmed_at_start, started_at, server_deadline_at, mirror_seq, receipt_ref) values ('43000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', pg_temp.rs('f1000000-0000-4000-8000-000000000001'), '41000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000005', 'in_progress', null, null, true, '2026-10-14 10:00:00+00', '2026-10-14 11:00:00+00', 1, 'RC000005')$$), '^42501 permission denied', 'I: trace_candidate cannot insert a session');
-- ===== U: set-once columns and the forward-only mirror_seq =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.sessions set mirror_seq = 1 where id = '43000000-0000-4000-8000-000000000003'$$), '^(42501|P0001)', 'mirror_seq: an equal value is a hard error at the trigger');
select is(pg_temp.try($$update public.sessions set mirror_seq = 2 where id = '43000000-0000-4000-8000-000000000003'$$), 'OK 1', 'mirror_seq: moving forward is allowed');
select matches(pg_temp.try($$update public.sessions set mirror_seq = 1 where id = '43000000-0000-4000-8000-000000000003'$$), '^(42501|P0001)', 'mirror_seq: moving backward is refused');
select is(pg_temp.try($$update public.sessions set state = 'submitted', submit_kind = 'candidate', submitted_at = '2026-10-14 10:30:00+00' where id = '43000000-0000-4000-8000-000000000003'$$), 'OK 1', 'U: trace_worker finishes the session (state, submit_kind, submitted_at together)');
select matches(pg_temp.try($$update public.sessions set started_at = '2026-10-14 09:00:00+00' where id = '43000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'set-once: started_at cannot change');
select matches(pg_temp.try($$update public.sessions set server_deadline_at = '2026-10-14 12:00:00+00' where id = '43000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'set-once: server_deadline_at cannot change');
select matches(pg_temp.try($$update public.sessions set receipt_ref = 'RCNEW001' where id = '43000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'set-once: receipt_ref cannot change');
select matches(pg_temp.try($$update public.sessions set submitted_at = '2026-10-14 10:45:00+00' where id = '43000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)', 'set-once: submitted_at cannot change once set');
select matches(pg_temp.try($$update public.sessions set invitation_id = '41000000-0000-4000-8000-000000000005' where id = '43000000-0000-4000-8000-000000000003'$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'immutable: the invitation of a session cannot change');
select matches(pg_temp.try($$update public.sessions set state = 'in_progress' where id = '43000000-0000-4000-8000-000000000003'$$), '^(23514|42501|P0001)', 'a submitted session cannot go back to in_progress');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is(pg_temp.try($$update public.sessions set mirror_seq = 3 where id = '43000000-0000-4000-8000-000000000003'$$), 'OK 0', 'U: trace_worker with job org B touches no org A row (cross-org)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select is(pg_temp.try($$update public.sessions set mirror_seq = 3 where id = '43000000-0000-4000-8000-000000000003'$$), 'OK 0', 'U: trace_worker without a job org touches nothing');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.sessions set mirror_seq = 3 where id = '43000000-0000-4000-8000-000000000003'$$), '^42501 permission denied', 'U: trace_quality_worker cannot update a session');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$update public.sessions set mirror_seq = 3 where id = '43000000-0000-4000-8000-000000000003'$$), '^42501 permission denied', 'U: trace_integrity_worker cannot update a session');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$update public.sessions set mirror_seq = 3 where id = '43000000-0000-4000-8000-000000000003'$$), '^42501 permission denied', 'U: an org_owner cannot update a session');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$delete from public.sessions where id = '43000000-0000-4000-8000-000000000003'$$), '^42501 permission denied', 'D: trace_worker cannot delete a session (erasure is M7)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$delete from public.sessions where id = '43000000-0000-4000-8000-000000000003'$$), '^42501 permission denied', 'D: an org_owner cannot delete a session');
-- ===== session_items: insert-only, the item must belong to the session version =====
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-00000000001f', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', 2, '2026-10-14 10:01:00+00')$$), 'OK 1', 'session_items I: trace_worker inserts a served item of the session version');
select matches(pg_temp.try($$insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-000000000020', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 1, '2026-10-14 10:01:00+00')$$), '^23505', 'session_items unique: one item per (session, section, position)');
select matches(pg_temp.try($$insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-000000000021', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 3, '2026-10-14 10:01:00+00')$$), '^23505', 'session_items unique: the same item version cannot be served twice in a session');
select matches(pg_temp.try($$insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values ('44000000-0000-4000-8000-000000000022', 'a1000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-000000000003', 4, '2026-10-14 10:01:00+00')$$), '^(42501 TRACE_GUARD|P0001 TRACE_FROZEN|23503)', 'session_items trigger: an item of another test version is refused');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select workspace_id::text || '/' || test_id::text from public.session_items where id = '44000000-0000-4000-8000-00000000001f'), 'b1000000-0000-4000-8000-000000000001/e1000000-0000-4000-8000-000000000001', 'L-27: session_items workspace_id and test_id are copied from the session');
-- ===== private.mirror_session(p_org_id, p_msg): idempotent, INVOKER, trace_worker only =====
select is((has_schema_privilege('trace_worker', 'private', 'USAGE')), true, 'mirror_session: trace_worker can reach the private schema (the function is called over SQL after SET LOCAL ROLE)');
select is((has_function_privilege('trace_worker', 'private.mirror_session(uuid, jsonb)', 'execute')), true, 'mirror_session: EXECUTE is granted to trace_worker');
select is(((select count(*)::int from unnest(array['authenticated', 'anon', 'service_role', 'trace_api', 'trace_quality_worker', 'trace_integrity_worker', 'trace_candidate', 'trace_candidate_gateway']) r where has_function_privilege(r, 'private.mirror_session(uuid, jsonb)', 'execute'))), 0, 'mirror_session: EXECUTE is granted to no other role');
select is(((select prosecdef from pg_proc where oid = 'private.mirror_session(uuid, jsonb)'::regprocedure)), false, 'mirror_session: SECURITY INVOKER (the worker grants, policies and triggers still apply)');
select ok(((select proconfig::text like '%search_path%' from pg_proc where oid = 'private.mirror_session(uuid, jsonb)'::regprocedure)), 'mirror_session: search_path is pinned (MT-7)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(((private.mirror_session('a1000000-0000-4000-8000-000000000001', pg_temp.msg('43000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'RC000002', 1, null)))::text), '^(?!duplicate$|dead_invitation$).+', 'mirror_session: the first call stores the session (needs migration 3 for the reports row)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select count(*)::int from public.sessions where invitation_id = '41000000-0000-4000-8000-000000000002'), 1, 'mirror_session: one sessions row for the invitation');
select is((select state || '/' || receipt_ref from public.sessions where id = '43000000-0000-4000-8000-000000000002'), 'submitted/RC000002', 'mirror_session: state and receipt_ref come from the message');
select is((select status::text from public.invitations where id = '41000000-0000-4000-8000-000000000002'), 'submitted', 'mirror_session: the invitation moves to submitted after the sessions row exists');
select is((select count(*)::int from public.session_items where session_id = '43000000-0000-4000-8000-000000000002'), 1, 'mirror_session: the served item is stored (see NOTES: section lookup for an INVOKER function)');
select is((select count(*)::int from public.media_objects where session_id = '43000000-0000-4000-8000-000000000002' and kind = 'start_photo'), 1, 'mirror_session: the start photo row is stored when the message carries one');
select is((select count(*)::int from public.reports where session_id = '43000000-0000-4000-8000-000000000002' and quality_card_id is null and integrity_card_id is null), 1, 'mirror_session: one reports row with both card FKs null (needs migration 3)');
select is((select count(*)::int from public.idempotency_keys where org_id = 'a1000000-0000-4000-8000-000000000001' and scope = 'session_mirror' and key = '43000000-0000-4000-8000-000000000002:session_mirror:' || pg_temp.rs('f1000000-0000-4000-8000-000000000001')::text), 1, 'mirror_session: the idempotency key session:session_mirror:ruleset (L-6) is recorded');
select is((select count(*)::int from public.consents where invitation_id = '41000000-0000-4000-8000-000000000002'), 1, 'mirror_session: it writes no consent (the consent row was already there)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(((private.mirror_session('a1000000-0000-4000-8000-000000000001', pg_temp.msg('43000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'RC000002', 1, null)))::text), '^duplicate$', 'mirror_session: a replayed message returns ''duplicate''');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select count(*)::int from public.sessions where invitation_id = '41000000-0000-4000-8000-000000000002'), 1, 'mirror_session: the replay wrote no second session');
select is((select count(*)::int from public.session_items where session_id = '43000000-0000-4000-8000-000000000002'), 1, 'mirror_session: the replay wrote no second item');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(((private.mirror_session('a1000000-0000-4000-8000-000000000001', pg_temp.msg('43000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'RC000002', 2, null)))::text), '^duplicate$', 'mirror_session: the same key with a different mirror_seq is ''duplicate''');
select matches(((private.mirror_session('a1000000-0000-4000-8000-000000000001', pg_temp.msg('43000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'RC000002', 1, '43000000-0000-4000-8000-000000000002:session_mirror:other')))::text), '^duplicate$', 'mirror_session: a new key with mirror_seq <= the stored one is ''duplicate''');
select matches(pg_temp.try($$select private.mirror_session('a1000000-0000-4000-8000-000000000003', pg_temp.msg('43000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'RC000002', 1, null))$$), '^(42501|P0001)', 'mirror_session: p_org_id different from job_org_id() raises (cross-org payload)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
select matches(pg_temp.try($$select private.mirror_session('a1000000-0000-4000-8000-000000000001', pg_temp.msg('43000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'RC000002', 1, null))$$), '^(42501|P0001)', 'mirror_session: without a job org it raises');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select matches(pg_temp.try($$select private.mirror_session('a1000000-0000-4000-8000-000000000001', pg_temp.msg('43000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'RC000002', 1, null))$$), '^(42501|P0001)', 'mirror_session: job org B with an org A message raises');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(((private.mirror_session('a1000000-0000-4000-8000-000000000001', pg_temp.msg('43000000-0000-4000-8000-000000000008', '41000000-0000-4000-8000-000000000008', '42000000-0000-4000-8000-000000000008', 'f1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'RC000008', 1, null)))::text), '^dead_invitation$', 'mirror_session: a revoked invitation returns ''dead_invitation'' and stores nothing (R-14)');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
select is((select count(*)::int from public.sessions where invitation_id = '41000000-0000-4000-8000-000000000008'), 0, 'mirror_session: nothing was stored for the revoked invitation');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select private.mirror_session('a1000000-0000-4000-8000-000000000001', pg_temp.msg('43000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'RC000002', 1, null))$$), '^42501', 'mirror_session: authenticated cannot call it');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select private.mirror_session('a1000000-0000-4000-8000-000000000001', pg_temp.msg('43000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'RC000002', 1, null))$$), '^42501', 'mirror_session: trace_api cannot call it');
reset role;
reset request.jwt.claims;
reset trace.job_org_id;
reset trace.api_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select private.mirror_session('a1000000-0000-4000-8000-000000000001', pg_temp.msg('43000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'RC000002', 1, null))$$), '^42501', 'mirror_session: trace_quality_worker cannot call it');
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
