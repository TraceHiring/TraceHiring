-- rls_d1_results (spec specs/d1-demo-slice.md 3.6 row "rls_d1_results"; 3.2 "Results (migration 3)"; 3.3 rows quality.scores,
-- quality.grader_runs, integrity.band_rule_versions, integrity.signals, integrity.flags, integrity.results; 3.7 I-1, I-3, I-9, I-10;
-- decisions L-3, L-4, L-5, L-14, L-15, L-28). RED first: written from the spec, targets migration <ts3>_d1_results.sql (and 1-2 for the
-- fixtures). Personas are synthetic (p-<persona>@example.test). See NOTES.md for the migration-2 columns assumed by the session fixtures.
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
select plan(167);
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
-- Personas (spec D1 3.6): synthetic users, fixed ids, created on the operator path (postgres, no claims).
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'p-owner-admin@example.test'),
  ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'p-admin@example.test'),
  ('00000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'p-recruiter-otp@example.test'),
  ('00000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'p-reviewer-asg@example.test'),
  ('00000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'p-hm@example.test'),
  ('00000000-0000-4000-8000-000000000014', 'authenticated', 'authenticated', 'p-reviewer-other@example.test'),
  ('00000000-0000-4000-8000-00000000000e', 'authenticated', 'authenticated', 'p-b-admin@example.test');
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
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007', '{reviewer}', null, 'Persona Reviewer Assigned', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000008', '{hiring_manager}', null, 'Persona Hiring Manager', 'active'),
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000014', '{reviewer}', null, 'Persona Reviewer Other', 'active'),
  ('a1000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000e', '{org_owner,admin}', null, 'Persona B Admin', 'active');
-- Authoring fixtures on the operator path: T1 (ws A1), T2 (ws A2), TB (org B), each with version 1, one mcq section,
-- one item and its key. The L-8 trigger (migration 3) creates each draft ruleset row and pins the notice; the
-- versions are then published on the operator path (published_by/creator assignment stay null/skipped there).
insert into public.tests (id, org_id, workspace_id, name) values
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test One'),
  ('e1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004', 'Test B');
insert into public.test_versions (id, org_id, test_id, version_no, total_time_seconds, quality_cutoff) values
  ('f1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 1, 1800, 40),
  ('f1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-00000000000b', 1, 1800, 40);
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values
  ('51000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 1, 'Choices', 'mcq', 1),
  ('51000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', 1, 'Choices', 'mcq', 1);
insert into public.item_versions (id, org_id, test_version_id, section_id, format, position, stem, options, rubric_version_id, origin, content_sha256) values
  ('61000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'mcq', 1, 'Pick one.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64)),
  ('61000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b', '51000000-0000-4000-8000-00000000000b', 'mcq', 1, 'Pick one.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64));
insert into public.item_answer_keys (org_id, item_version_id, format, key) values
  ('a1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'mcq', '{"option_id": "o1"}'),
  ('a1000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-00000000000b', 'mcq', '{"option_id": "o1"}');
update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id in ('f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-00000000000b');
-- The assigned reviewer persona is assigned to T1 on the operator path (so the S* arm has something to see).
insert into public.assignments (org_id, membership_id, scope, test_id, as_role)
  select m.org_id, m.id, 'test', 'e1000000-0000-4000-8000-000000000001', 'reviewer'
  from public.memberships m where m.org_id = 'a1000000-0000-4000-8000-000000000001' and m.user_id = '00000000-0000-4000-8000-000000000007';
-- Session fixtures through the real roles, in the real order (spec 3.2 migration 2 columns):
-- operator inserts the invitations; trace_api sends, verifies, adds the age step, consent, session_id, started;
-- trace_worker mirrors the sessions row, marks the invitation submitted and creates the report pointer row.
insert into public.invitations (id, org_id, workspace_id, test_id, test_version_id, candidate_label, contact_email, link_token_hash, adult_confirmed_by_inviter, status, expires_at) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Candidate 0', 'c01@example.test', '0000000000000000000000000000000000000000000000000000000000abc001', true, 'created', '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Candidate 0', 'c02@example.test', '0000000000000000000000000000000000000000000000000000000000abc002', true, 'created', '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Candidate 0', 'c03@example.test', '0000000000000000000000000000000000000000000000000000000000abc003', true, 'created', '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Candidate 0', 'c04@example.test', '0000000000000000000000000000000000000000000000000000000000abc004', true, 'created', '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Candidate 0', 'c05@example.test', '0000000000000000000000000000000000000000000000000000000000abc005', true, 'created', '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Candidate 0', 'c06@example.test', '0000000000000000000000000000000000000000000000000000000000abc006', true, 'created', '2030-01-01 00:00:00+00'),
  ('a2000000-0000-4000-8000-000000000040', 'a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', 'Candidate 0', 'c40@example.test', '0000000000000000000000000000000000000000000000000000000000abc040', true, 'created', '2030-01-01 00:00:00+00');
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000001';
update public.invitations set status = 'sent' where id in ('a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000006');
update public.invitations set status = 'otp_verified', adult_self_declared = true where id in ('a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000006');
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event)
  select c.cid, i.org_id, i.id, i.test_version_id, v.ruleset_version_id, v.notice_version_id, repeat('d', 64), 'en', 'granted'
  from (values ('a3000000-0000-4000-8000-000000000001'::uuid, 'a2000000-0000-4000-8000-000000000001'::uuid), ('a3000000-0000-4000-8000-000000000002'::uuid, 'a2000000-0000-4000-8000-000000000002'::uuid), ('a3000000-0000-4000-8000-000000000003'::uuid, 'a2000000-0000-4000-8000-000000000003'::uuid), ('a3000000-0000-4000-8000-000000000004'::uuid, 'a2000000-0000-4000-8000-000000000004'::uuid), ('a3000000-0000-4000-8000-000000000005'::uuid, 'a2000000-0000-4000-8000-000000000005'::uuid), ('a3000000-0000-4000-8000-000000000006'::uuid, 'a2000000-0000-4000-8000-000000000006'::uuid)) as c (cid, iid)
  join public.invitations i on i.id = c.iid
  join public.test_versions v on v.org_id = i.org_id and v.id = i.test_version_id;
update public.invitations i set session_id = c.sid
  from (values ('a2000000-0000-4000-8000-000000000001'::uuid, 'a4000000-0000-4000-8000-000000000001'::uuid), ('a2000000-0000-4000-8000-000000000002'::uuid, 'a4000000-0000-4000-8000-000000000002'::uuid), ('a2000000-0000-4000-8000-000000000003'::uuid, 'a4000000-0000-4000-8000-000000000003'::uuid), ('a2000000-0000-4000-8000-000000000004'::uuid, 'a4000000-0000-4000-8000-000000000004'::uuid), ('a2000000-0000-4000-8000-000000000005'::uuid, 'a4000000-0000-4000-8000-000000000005'::uuid), ('a2000000-0000-4000-8000-000000000006'::uuid, 'a4000000-0000-4000-8000-000000000006'::uuid)) as c (iid, sid)
  where i.id = c.iid;
update public.invitations i set status = 'started', started_at = c.st
  from (values ('a2000000-0000-4000-8000-000000000001'::uuid, '2026-10-14 10:00:00+00'::timestamptz), ('a2000000-0000-4000-8000-000000000002'::uuid, '2026-10-14 10:00:00+00'::timestamptz), ('a2000000-0000-4000-8000-000000000003'::uuid, '2026-10-14 10:00:00+00'::timestamptz), ('a2000000-0000-4000-8000-000000000004'::uuid, '2026-10-14 10:00:00+00'::timestamptz), ('a2000000-0000-4000-8000-000000000005'::uuid, '2026-10-14 10:00:00+00'::timestamptz), ('a2000000-0000-4000-8000-000000000006'::uuid, '2026-10-14 10:00:00+00'::timestamptz)) as c (iid, st)
  where i.id = c.iid;
reset role;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, adult_confirmed_at_start, started_at, server_deadline_at, submitted_at, mirror_seq, receipt_ref)
  select 'a4000000-0000-4000-8000-000000000001'::uuid, i.org_id, i.test_version_id, c.ruleset_version_id, i.id, c.id, 'submitted', 'candidate', true, '2026-10-14 10:00:00+00'::timestamptz, '2026-10-14 10:31:00+00'::timestamptz, '2026-10-14 10:20:00+00'::timestamptz, 1, 'RCPT0001' from public.invitations i join public.consents c on c.org_id = i.org_id and c.invitation_id = i.id where i.id = 'a2000000-0000-4000-8000-000000000001'
union all
  select 'a4000000-0000-4000-8000-000000000002'::uuid, i.org_id, i.test_version_id, c.ruleset_version_id, i.id, c.id, 'submitted', 'candidate', true, '2026-10-14 10:00:00+00'::timestamptz, '2026-10-14 10:31:00+00'::timestamptz, '2026-10-14 10:20:00+00'::timestamptz, 1, 'RCPT0002' from public.invitations i join public.consents c on c.org_id = i.org_id and c.invitation_id = i.id where i.id = 'a2000000-0000-4000-8000-000000000002'
union all
  select 'a4000000-0000-4000-8000-000000000003'::uuid, i.org_id, i.test_version_id, c.ruleset_version_id, i.id, c.id, 'submitted', 'candidate', true, '2026-10-14 10:00:00+00'::timestamptz, '2026-10-14 10:31:00+00'::timestamptz, '2026-10-14 10:20:00+00'::timestamptz, 1, 'RCPT0003' from public.invitations i join public.consents c on c.org_id = i.org_id and c.invitation_id = i.id where i.id = 'a2000000-0000-4000-8000-000000000003'
union all
  select 'a4000000-0000-4000-8000-000000000004'::uuid, i.org_id, i.test_version_id, c.ruleset_version_id, i.id, c.id, 'submitted', 'candidate', true, '2026-10-14 10:00:00+00'::timestamptz, '2026-10-14 10:31:00+00'::timestamptz, '2026-10-14 10:20:00+00'::timestamptz, 1, 'RCPT0004' from public.invitations i join public.consents c on c.org_id = i.org_id and c.invitation_id = i.id where i.id = 'a2000000-0000-4000-8000-000000000004'
union all
  select 'a4000000-0000-4000-8000-000000000005'::uuid, i.org_id, i.test_version_id, c.ruleset_version_id, i.id, c.id, 'submitted', 'candidate', true, '2026-10-14 10:00:00+00'::timestamptz, '2026-10-14 10:31:00+00'::timestamptz, '2026-10-14 10:20:00+00'::timestamptz, 1, 'RCPT0005' from public.invitations i join public.consents c on c.org_id = i.org_id and c.invitation_id = i.id where i.id = 'a2000000-0000-4000-8000-000000000005'
union all
  select 'a4000000-0000-4000-8000-000000000006'::uuid, i.org_id, i.test_version_id, c.ruleset_version_id, i.id, c.id, 'submitted', 'candidate', true, '2026-10-14 10:00:00+00'::timestamptz, '2026-10-14 10:31:00+00'::timestamptz, '2026-10-14 10:20:00+00'::timestamptz, 1, 'RCPT0006' from public.invitations i join public.consents c on c.org_id = i.org_id and c.invitation_id = i.id where i.id = 'a2000000-0000-4000-8000-000000000006';
update public.invitations set status = 'submitted' where id in ('a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000006');
reset role;
reset trace.job_org_id;
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-000000000003';
update public.invitations set status = 'sent' where id in ('a2000000-0000-4000-8000-000000000040');
update public.invitations set status = 'otp_verified', adult_self_declared = true where id in ('a2000000-0000-4000-8000-000000000040');
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event)
  select c.cid, i.org_id, i.id, i.test_version_id, v.ruleset_version_id, v.notice_version_id, repeat('d', 64), 'en', 'granted'
  from (values ('a3000000-0000-4000-8000-000000000040'::uuid, 'a2000000-0000-4000-8000-000000000040'::uuid)) as c (cid, iid)
  join public.invitations i on i.id = c.iid
  join public.test_versions v on v.org_id = i.org_id and v.id = i.test_version_id;
update public.invitations i set session_id = c.sid
  from (values ('a2000000-0000-4000-8000-000000000040'::uuid, 'a4000000-0000-4000-8000-000000000040'::uuid)) as c (iid, sid)
  where i.id = c.iid;
update public.invitations i set status = 'started', started_at = c.st
  from (values ('a2000000-0000-4000-8000-000000000040'::uuid, '2026-10-14 10:00:00+00'::timestamptz)) as c (iid, st)
  where i.id = c.iid;
reset role;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, adult_confirmed_at_start, started_at, server_deadline_at, submitted_at, mirror_seq, receipt_ref)
  select 'a4000000-0000-4000-8000-000000000040'::uuid, i.org_id, i.test_version_id, c.ruleset_version_id, i.id, c.id, 'submitted', 'candidate', true, '2026-10-14 10:00:00+00'::timestamptz, '2026-10-14 10:31:00+00'::timestamptz, '2026-10-14 10:20:00+00'::timestamptz, 1, 'RCPT0040' from public.invitations i join public.consents c on c.org_id = i.org_id and c.invitation_id = i.id where i.id = 'a2000000-0000-4000-8000-000000000040';
update public.invitations set status = 'submitted' where id in ('a2000000-0000-4000-8000-000000000040');
reset role;
reset trace.job_org_id;
-- session_items for the grader_runs cases (trace_worker, insert-only): R1, R2 in org A and RB1 in org B.
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values
  ('a9000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 1, '2026-10-14 10:01:00+00'),
  ('a9000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 1, '2026-10-14 10:01:00+00');
reset role;
reset trace.job_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
insert into public.session_items (id, org_id, session_id, section_id, item_version_id, position, served_at) values
  ('a9000000-0000-4000-8000-000000000040', 'a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000040', '51000000-0000-4000-8000-00000000000b', '61000000-0000-4000-8000-00000000000b', 1, '2026-10-14 10:01:00+00');
reset role;
reset trace.job_org_id;
-- Fixture: R4 below its cutoff (score 10 of 40) has its score and quality card from the start (flag tests need the card).
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001', 10, '[{"position": 1, "weight": 1, "score": 10}]', 40, false, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00');
insert into public.quality_cards (org_id, session_id, quality_score_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000004', 'a5000000-0000-4000-8000-000000000004');
reset role;
reset trace.job_org_id;
-- ===== quality.scores (internal source; quality worker S I; nobody else) =====
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), 'OK 1', 'quality.scores I: the quality worker inserts a score for its own org (job org A)');
select is((select count(*)::int from quality.scores), 2, 'quality.scores S: job org A sees its rows only (R4 fixture + R1)');
select is(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 40, '[{"position": 1, "weight": 1, "score": 40}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), 'OK 1', 'quality.scores I: a score equal to the cutoff meets it (boundary, meets_cutoff = true)');
select doesnt_match(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 50, '[{"position": 1, "weight": 1, "score": 50}]', 50, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), '^OK', 'quality.scores I: a cutoff different from the pinned test version cutoff is refused (pin trigger)');
select matches(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 30, '[{"position": 1, "weight": 1, "score": 30}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), '^23514', 'quality.scores I: meets_cutoff = true below the cutoff violates the CHECK');
select matches(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 40, '[{"position": 1, "weight": 1, "score": 40}]', 40, false, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), '^23514', 'quality.scores I: meets_cutoff = false at the cutoff violates the CHECK');
select matches(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 101, '[{"position": 1, "weight": 1, "score": 101}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), '^23514', 'quality.scores I: score 101 violates the 0..100 CHECK');
select matches(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', -1, '[{"position": 1, "weight": 1, "score": -1}]', 40, false, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), '^23514', 'quality.scores I: score -1 violates the 0..100 CHECK');
select matches(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-0000000000f1', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), '^23505', 'quality.scores I: a second score for the same (session, scoring_version) is refused (L-5)');
select is(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-0000000000f2', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v2', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), 'OK 1', 'quality.scores I: another scoring_version for the same session is a different key');
select matches(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, null, repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), '^23502', 'quality.scores I: scoring_version is not null');
select matches(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', null, '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), '^23502', 'quality.scores I: rubric_set_sha256 is not null');
select matches(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', null, 'mock-1', '2026-10-14 10:21:00+00')$$), '^23502', 'quality.scores I: grader_model_id is not null');
select matches(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-0000000000ee', 'f1000000-0000-4000-8000-000000000001', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), '^23503', 'quality.scores I: a score for a session that does not exist is refused (FK)');
select matches(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000040', 'a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000040', 'f1000000-0000-4000-8000-00000000000b', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), '^42501', 'quality.scores I: job org A cannot insert a score for an org B session (cross-org)');
select matches(pg_temp.try($$update quality.scores set score = 0$$), '^42501 permission denied', 'quality.scores U: the quality worker holds no UPDATE (insert-only)');
select matches(pg_temp.try($$delete from quality.scores$$), '^42501 permission denied', 'quality.scores D: the quality worker holds no DELETE');
reset role;
reset trace.job_org_id;
set local role trace_quality_worker;
select is((select count(*)::int from quality.scores), 0, 'quality.scores S: with no job org the quality worker sees nothing');
select matches(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), '^42501', 'quality.scores I: with no job org the quality worker cannot insert');
reset role;
reset trace.job_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from quality.scores), 0, 'quality.scores S: job org B sees no org A score (cross-org)');
select is(pg_temp.try($$insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-000000000040', 'a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000040', 'f1000000-0000-4000-8000-00000000000b', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00')$$), 'OK 1', 'quality.scores I: job org B inserts its own org score');
select is((select count(*)::int from quality.scores), 1, 'quality.scores S: job org B sees exactly its own row');
reset role;
reset trace.job_org_id;
select matches(pg_temp.try($$update quality.scores set score = 0$$), '^(42501|P0001)', 'quality.scores U: even the operator cannot rewrite a score (immutable)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select * from quality.scores$$), '^42501 permission denied', 'quality.scores S: authenticated owner cannot read (no grant)');
reset role;
reset request.jwt.claims;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select * from quality.scores$$), '^42501 permission denied', 'quality.scores S: trace_worker cannot read (no grant)');
reset role;
reset trace.job_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select * from quality.scores$$), '^42501 permission denied', 'quality.scores S: trace_integrity_worker cannot read (no grant)');
reset role;
reset trace.job_org_id;
set local role trace_api;
select matches(pg_temp.try($$select * from quality.scores$$), '^42501 permission denied', 'quality.scores S: trace_api cannot read (no grant)');
reset role;
reset trace.api_org_id;
set local role anon;
select matches(pg_temp.try($$select * from quality.scores$$), '^42501 permission denied', 'quality.scores S: anon cannot read (no grant)');
reset role;
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'quality.scores', 'select')), 'trace_quality_worker', 'quality.scores: exactly trace_quality_worker can read it (the other roles hold no SELECT)');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'quality.scores', 'insert')), 'trace_quality_worker', 'quality.scores: exactly trace_quality_worker can insert');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'quality.scores', 'update,delete,truncate,references,trigger')), '', 'quality.scores: no role holds UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER');
-- Cards for R1 and R2 (needed by the flag cases below; the card cells are tested in rls_d1_cards).
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
insert into public.quality_cards (org_id, session_id, quality_score_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001');
insert into public.quality_cards (org_id, session_id, quality_score_id) values ('a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000002');
reset role;
reset trace.job_org_id;
-- ===== quality.grader_runs (append-only; quality worker S I) =====
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$insert into quality.grader_runs (id, org_id, session_id, session_item_id, pass_no, grader_kind, model_id, adapter_version, rubric_version_id, raw_score, criteria, computed_at) values ('ad000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 1, 'mcq_key', 'mock-grader-v1', 'mock-1', null, 1.0000, '{}', '2026-10-14 10:21:00+00')$$), 'OK 1', 'quality.grader_runs I: the quality worker records a run for its own org');
select matches(pg_temp.try($$insert into quality.grader_runs (id, org_id, session_id, session_item_id, pass_no, grader_kind, model_id, adapter_version, rubric_version_id, raw_score, criteria, computed_at) values ('ad000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 1, 'mcq_key', 'mock-grader-v1', 'mock-1', null, 1.0000, '{}', '2026-10-14 10:21:00+00')$$), '^23505', 'quality.grader_runs I: a second run with the same (item, null rubric, model, pass) is refused (nulls not distinct, L-5)');
select is(pg_temp.try($$insert into quality.grader_runs (id, org_id, session_id, session_item_id, pass_no, grader_kind, model_id, adapter_version, rubric_version_id, raw_score, criteria, computed_at) values ('ad000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 1, 'mcq_key', 'mock-grader-v2', 'mock-1', null, 1.0000, '{}', '2026-10-14 10:21:00+00')$$), 'OK 1', 'quality.grader_runs I: another model_id is a different key');
select matches(pg_temp.try($$insert into quality.grader_runs (id, org_id, session_id, session_item_id, pass_no, grader_kind, model_id, adapter_version, rubric_version_id, raw_score, criteria, computed_at) values ('ad000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000002', 1, 'other', 'mock-grader-v1', 'mock-1', null, 1.0000, '{}', '2026-10-14 10:21:00+00')$$), '^23514', 'quality.grader_runs I: grader_kind outside (''mcq_key'',''llm'') violates the CHECK');
select matches(pg_temp.try($$insert into quality.grader_runs (id, org_id, session_id, session_item_id, pass_no, grader_kind, model_id, adapter_version, rubric_version_id, raw_score, criteria, computed_at) values ('ad000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000002', 1, 'mcq_key', 'mock-grader-v1', 'mock-1', null, 1.5000, '{}', '2026-10-14 10:21:00+00')$$), '^23514', 'quality.grader_runs I: raw_score 1.5 violates the 0..1 CHECK');
select matches(pg_temp.try($$insert into quality.grader_runs (id, org_id, session_id, session_item_id, pass_no, grader_kind, model_id, adapter_version, rubric_version_id, raw_score, criteria, computed_at) values ('ad000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000002', 1, 'mcq_key', 'mock-grader-v1', 'mock-1', null, -0.1000, '{}', '2026-10-14 10:21:00+00')$$), '^23514', 'quality.grader_runs I: raw_score -0.1 violates the 0..1 CHECK');
select matches(pg_temp.try($$insert into quality.grader_runs (id, org_id, session_id, session_item_id, pass_no, grader_kind, model_id, adapter_version, rubric_version_id, raw_score, criteria, computed_at) values ('ad000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000002', 1, 'mcq_key', 'mock-grader-v1', 'mock-1', null, 1.0000, ('{"pad": "' || repeat('x', 5000) || '"}')::jsonb, '2026-10-14 10:21:00+00')$$), '^23514', 'quality.grader_runs I: criteria over 4 KB violates the size CHECK');
select matches(pg_temp.try($$insert into quality.grader_runs (id, org_id, session_id, session_item_id, pass_no, grader_kind, model_id, adapter_version, rubric_version_id, raw_score, criteria, computed_at) values ('ad000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000002', 1, 'mcq_key', '', 'mock-1', null, 1.0000, '{}', '2026-10-14 10:21:00+00')$$), '^23514', 'quality.grader_runs I: an empty model_id violates the 1..64 length CHECK');
select matches(pg_temp.try($$insert into quality.grader_runs (id, org_id, session_id, session_item_id, pass_no, grader_kind, model_id, adapter_version, rubric_version_id, raw_score, criteria, computed_at) values ('ad000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000002', 1, 'mcq_key', 'mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm', 'mock-1', null, 1.0000, '{}', '2026-10-14 10:21:00+00')$$), '^23514', 'quality.grader_runs I: a 65-character model_id violates the 1..64 length CHECK');
select matches(pg_temp.try($$insert into quality.grader_runs (id, org_id, session_id, session_item_id, pass_no, grader_kind, model_id, adapter_version, rubric_version_id, raw_score, criteria, computed_at) values ('ad000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000040', 'a9000000-0000-4000-8000-000000000040', 1, 'mcq_key', 'mock-grader-v1', 'mock-1', null, 1.0000, '{}', '2026-10-14 10:21:00+00')$$), '^42501', 'quality.grader_runs I: job org A cannot record a run for an org B session (cross-org)');
select is((select count(*)::int from quality.grader_runs), 2, 'quality.grader_runs S: job org A sees its two runs only');
reset role;
reset trace.job_org_id;
set local role trace_quality_worker;
select is((select count(*)::int from quality.grader_runs), 0, 'quality.grader_runs S: with no job org the quality worker sees nothing');
select matches(pg_temp.try($$insert into quality.grader_runs (id, org_id, session_id, session_item_id, pass_no, grader_kind, model_id, adapter_version, rubric_version_id, raw_score, criteria, computed_at) values ('ad000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000002', 1, 'mcq_key', 'mock-grader-v1', 'mock-1', null, 1.0000, '{}', '2026-10-14 10:21:00+00')$$), '^42501', 'quality.grader_runs I: with no job org the quality worker cannot insert');
reset role;
reset trace.job_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from quality.grader_runs), 0, 'quality.grader_runs S: job org B sees no org A run (cross-org)');
reset role;
reset trace.job_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select * from quality.grader_runs$$), '^42501 permission denied', 'quality.grader_runs S: authenticated cannot read (no grant)');
reset role;
reset request.jwt.claims;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select * from quality.grader_runs$$), '^42501 permission denied', 'quality.grader_runs S: the integrity worker cannot read (no grant)');
reset role;
reset trace.job_org_id;
set local role trace_api;
select matches(pg_temp.try($$select * from quality.grader_runs$$), '^42501 permission denied', 'quality.grader_runs S: trace_api cannot read (no grant)');
reset role;
reset trace.api_org_id;
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'quality.grader_runs', 'select')), 'trace_quality_worker', 'quality.grader_runs: exactly trace_quality_worker can read it (the other roles hold no SELECT)');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'quality.grader_runs', 'insert')), 'trace_quality_worker', 'quality.grader_runs: exactly trace_quality_worker can insert');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'quality.grader_runs', 'update,delete,truncate,references,trigger')), '', 'quality.grader_runs: no role holds UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER');
select is((select string_agg(p, ',' order by p) from unnest(array['UPDATE', 'DELETE', 'TRUNCATE']) as p where has_table_privilege('postgres', 'quality.grader_runs', p)), null::text, 'quality.grader_runs: UPDATE, DELETE and TRUNCATE are revoked from the owner (append-only)');
select matches(pg_temp.try($$update quality.grader_runs set pass_no = 1$$), '^42501 permission denied', 'quality.grader_runs: an UPDATE by the operator is refused by the revoked privilege');
select matches(pg_temp.try($$delete from quality.grader_runs$$), '^42501 permission denied', 'quality.grader_runs: a DELETE by the operator is refused by the revoked privilege');
select matches(pg_temp.try($$truncate quality.grader_runs$$), '^42501 permission denied', 'quality.grader_runs: a TRUNCATE by the operator is refused by the revoked privilege');
grant update, delete, truncate on quality.grader_runs to postgres;
select is(pg_temp.try($$update quality.grader_runs set pass_no = 1$$), 'P0001 TRACE_APPEND_ONLY', 'quality.grader_runs: with the privilege re-granted the UPDATE trigger raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$delete from quality.grader_runs$$), 'P0001 TRACE_APPEND_ONLY', 'quality.grader_runs: the DELETE trigger raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$truncate quality.grader_runs$$), 'P0001 TRACE_APPEND_ONLY', 'quality.grader_runs: the TRUNCATE trigger raises TRACE_APPEND_ONLY');
set local session_replication_role = replica;
select is(pg_temp.try($$update quality.grader_runs set pass_no = 1$$), 'P0001 TRACE_APPEND_ONLY', 'quality.grader_runs: replica mode (ENABLE ALWAYS) still raises TRACE_APPEND_ONLY on UPDATE');
select is(pg_temp.try($$delete from quality.grader_runs$$), 'P0001 TRACE_APPEND_ONLY', 'quality.grader_runs: replica mode still raises TRACE_APPEND_ONLY on DELETE');
select is(pg_temp.try($$truncate quality.grader_runs$$), 'P0001 TRACE_APPEND_ONLY', 'quality.grader_runs: replica mode still raises TRACE_APPEND_ONLY on TRUNCATE');
set local session_replication_role = origin;
revoke update, delete, truncate on quality.grader_runs from postgres;
-- ===== integrity.band_rule_versions (integrity worker S only; the Rule-shape CHECK is in rls_d1_rulesets_m3) =====
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from integrity.band_rule_versions), 1, 'band_rule_versions S: job org A sees its seeded v1 only');
select matches(pg_temp.try($$insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille, coverage_photo_missing_factor_permille, rules, content_sha256) values ('a1000000-0000-4000-8000-000000000001', 9, '{paste}', 700, 750, '[]', repeat('a', 64))$$), '^42501 permission denied', 'band_rule_versions I: the integrity worker cannot insert (S only; the seed function is the only writer)');
select matches(pg_temp.try($$update integrity.band_rule_versions set coverage_floor_permille = 1$$), '^42501 permission denied', 'band_rule_versions U: the integrity worker cannot update');
select matches(pg_temp.try($$delete from integrity.band_rule_versions$$), '^42501 permission denied', 'band_rule_versions D: the integrity worker cannot delete');
select is((select count(*)::int from integrity.band_rule_versions where org_id = 'a1000000-0000-4000-8000-000000000003'), 0, 'band_rule_versions S: job org A sees no org B rule table (cross-org)');
reset role;
reset trace.job_org_id;
set local role trace_integrity_worker;
select is((select count(*)::int from integrity.band_rule_versions), 0, 'band_rule_versions S: with no job org the integrity worker sees nothing');
reset role;
reset trace.job_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from integrity.band_rule_versions), 1, 'band_rule_versions S: job org B sees its own seeded v1 only');
reset role;
reset trace.job_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select * from integrity.band_rule_versions$$), '^42501 permission denied', 'band_rule_versions S: authenticated (an org owner) cannot read (no grant)');
reset role;
reset request.jwt.claims;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select * from integrity.band_rule_versions$$), '^42501 permission denied', 'band_rule_versions S: the quality worker cannot read (no grant)');
reset role;
reset trace.job_org_id;
set local role trace_api;
select matches(pg_temp.try($$select * from integrity.band_rule_versions$$), '^42501 permission denied', 'band_rule_versions S: trace_api cannot read (no grant)');
reset role;
reset trace.api_org_id;
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'integrity.band_rule_versions', 'select')), 'trace_integrity_worker', 'integrity.band_rule_versions: exactly trace_integrity_worker can read it (the other roles hold no SELECT)');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'integrity.band_rule_versions', 'insert')), '', 'integrity.band_rule_versions: exactly nobody can insert');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'integrity.band_rule_versions', 'update,delete,truncate,references,trigger')), '', 'integrity.band_rule_versions: no role holds UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER');
-- ===== integrity.signals (append-only; integrity worker S I; keyed by the session-global gseq, L-14) =====
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$insert into integrity.signals (id, org_id, session_id, seq, kind, offset_ms, item_position, details) values ('a8000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 1, 'tab_hidden', 1000, null, '{"duration_ms": 4000}')$$), 'OK 1', 'integrity.signals I: the integrity worker inserts a signal (gseq 1, stream one)');
select is(pg_temp.try($$insert into integrity.signals (id, org_id, session_id, seq, kind, offset_ms, item_position, details) values ('a8000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 2, 'paste', 2000, null, '{"len": 120}')$$), 'OK 1', 'integrity.signals I: a paste with gseq 2 lands');
select is(pg_temp.try($$insert into integrity.signals (id, org_id, session_id, seq, kind, offset_ms, item_position, details) values ('a8000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 3, 'paste', 3000, null, '{"len": 80}')$$), 'OK 1', 'integrity.signals I: a paste after a reload (second stream) has its own gseq 3 and does not collide (L-14)');
select is((select count(*)::int from integrity.signals where session_id = 'a4000000-0000-4000-8000-000000000001'), 3, 'integrity.signals S: both pastes and the tab signal are stored');
select matches(pg_temp.try($$insert into integrity.signals (id, org_id, session_id, seq, kind, offset_ms, item_position, details) values ('a8000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 3, 'paste', 3000, null, '{}')$$), '^23505', 'integrity.signals I: the same gseq twice for a session is refused (exactly-once)');
select doesnt_match(pg_temp.try($$insert into integrity.signals (id, org_id, session_id, seq, kind, offset_ms, item_position, details) values ('a8000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 4, 'copy', 4000, null, '{}')$$), '^OK', 'integrity.signals I: a kind outside the six signal kinds is refused');
select matches(pg_temp.try($$insert into integrity.signals (id, org_id, session_id, seq, kind, offset_ms, item_position, details) values ('a8000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 4, 'paste', 4000, null, '{"text": "pasted words"}')$$), '^23514', 'integrity.signals I: details keys are limited to len and duration_ms (no pasted text ever)');
select matches(pg_temp.try($$insert into integrity.signals (id, org_id, session_id, seq, kind, offset_ms, item_position, details) values ('a8000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 4, 'paste', 4000, null, ('{"len": "' || repeat('x', 1100) || '"}')::jsonb)$$), '^23514', 'integrity.signals I: details over 1 KB violate the size CHECK');
select matches(pg_temp.try($$insert into integrity.signals (id, org_id, session_id, seq, kind, offset_ms, item_position, details) values ('a8000000-0000-4000-8000-000000000041', 'a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000040', 1, 'paste', 1000, null, '{}')$$), '^42501', 'integrity.signals I: job org A cannot insert a signal for an org B session (cross-org)');
select matches(pg_temp.try($$update integrity.signals set offset_ms = 0$$), '^42501 permission denied', 'integrity.signals U: the integrity worker holds no UPDATE (insert-only)');
reset role;
reset trace.job_org_id;
set local role trace_integrity_worker;
select is((select count(*)::int from integrity.signals), 0, 'integrity.signals S: with no job org the integrity worker sees nothing');
select matches(pg_temp.try($$insert into integrity.signals (id, org_id, session_id, seq, kind, offset_ms, item_position, details) values ('a8000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 9, 'paste', 9000, null, '{}')$$), '^42501', 'integrity.signals I: with no job org the integrity worker cannot insert');
reset role;
reset trace.job_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is(pg_temp.try($$insert into integrity.signals (id, org_id, session_id, seq, kind, offset_ms, item_position, details) values ('a8000000-0000-4000-8000-000000000041', 'a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000040', 1, 'paste', 1000, null, '{}')$$), 'OK 1', 'integrity.signals I: job org B inserts a signal for its own session');
select is((select count(*)::int from integrity.signals), 1, 'integrity.signals S: job org B sees only its own signal (cross-org)');
reset role;
reset trace.job_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select * from integrity.signals$$), '^42501 permission denied', 'integrity.signals S: trace_worker (the mirror holds nothing in integrity) cannot read (no grant)');
reset role;
reset trace.job_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select * from integrity.signals$$), '^42501 permission denied', 'integrity.signals S: the quality worker cannot read (no grant)');
reset role;
reset trace.job_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select * from integrity.signals$$), '^42501 permission denied', 'integrity.signals S: authenticated cannot read (no grant)');
reset role;
reset request.jwt.claims;
set local role trace_api;
select matches(pg_temp.try($$select * from integrity.signals$$), '^42501 permission denied', 'integrity.signals S: trace_api cannot read (no grant)');
reset role;
reset trace.api_org_id;
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'integrity.signals', 'select')), 'trace_integrity_worker', 'integrity.signals: exactly trace_integrity_worker can read it (the other roles hold no SELECT)');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'integrity.signals', 'insert')), 'trace_integrity_worker', 'integrity.signals: exactly trace_integrity_worker can insert');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'integrity.signals', 'update,delete,truncate,references,trigger')), '', 'integrity.signals: no role holds UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER');
select is((select string_agg(p, ',' order by p) from unnest(array['UPDATE', 'DELETE', 'TRUNCATE']) as p where has_table_privilege('postgres', 'integrity.signals', p)), null::text, 'integrity.signals: UPDATE, DELETE and TRUNCATE are revoked from the owner (append-only)');
select matches(pg_temp.try($$update integrity.signals set offset_ms = 0$$), '^42501 permission denied', 'integrity.signals: an UPDATE by the operator is refused by the revoked privilege');
select matches(pg_temp.try($$delete from integrity.signals$$), '^42501 permission denied', 'integrity.signals: a DELETE by the operator is refused by the revoked privilege');
select matches(pg_temp.try($$truncate integrity.signals$$), '^42501 permission denied', 'integrity.signals: a TRUNCATE by the operator is refused by the revoked privilege');
grant update, delete, truncate on integrity.signals to postgres;
select is(pg_temp.try($$update integrity.signals set offset_ms = 0$$), 'P0001 TRACE_APPEND_ONLY', 'integrity.signals: with the privilege re-granted the UPDATE trigger raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$delete from integrity.signals$$), 'P0001 TRACE_APPEND_ONLY', 'integrity.signals: the DELETE trigger raises TRACE_APPEND_ONLY');
select is(pg_temp.try($$truncate integrity.signals$$), 'P0001 TRACE_APPEND_ONLY', 'integrity.signals: the TRUNCATE trigger raises TRACE_APPEND_ONLY');
set local session_replication_role = replica;
select is(pg_temp.try($$update integrity.signals set offset_ms = 0$$), 'P0001 TRACE_APPEND_ONLY', 'integrity.signals: replica mode (ENABLE ALWAYS) still raises TRACE_APPEND_ONLY on UPDATE');
select is(pg_temp.try($$delete from integrity.signals$$), 'P0001 TRACE_APPEND_ONLY', 'integrity.signals: replica mode still raises TRACE_APPEND_ONLY on DELETE');
select is(pg_temp.try($$truncate integrity.signals$$), 'P0001 TRACE_APPEND_ONLY', 'integrity.signals: replica mode still raises TRACE_APPEND_ONLY on TRUNCATE');
set local session_replication_role = origin;
revoke update, delete, truncate on integrity.signals from postgres;
-- ===== integrity.flags (insert-only ledger; the insert trigger reads public.quality_cards only; rule 6) =====
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select doesnt_match(pg_temp.try($$insert into integrity.flags (id, org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, first_offset_ms, state, signal_seqs) values ('a7000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'D1-PASTE', 'paste', 'T3', 'medium', false, false, 1, 1000, 'pending', '{1}')$$), '^OK', 'integrity.flags I: a flag for a session with no quality card is refused (the rule 6 gate needs meets_cutoff)');
select is(pg_temp.try($$insert into integrity.flags (id, org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, first_offset_ms, state, signal_seqs) values ('a7000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'D1-PASTE', 'paste', 'T3', 'medium', false, false, 1, 1000, 'pending', '{1}')$$), 'OK 1', 'integrity.flags I: a pending flag lands when the session meets its cutoff');
select doesnt_match(pg_temp.try($$insert into integrity.flags (id, org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, first_offset_ms, state, signal_seqs) values ('a7000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'D1-PASTE', 'paste', 'T3', 'medium', false, false, 1, 1000, 'not_used', '{1}')$$), '^OK', 'integrity.flags I: a not_used flag is refused when the session meets its cutoff');
select is(pg_temp.try($$insert into integrity.flags (id, org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, first_offset_ms, state, signal_seqs) values ('a7000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000004', 'D1-PASTE', 'paste', 'T3', 'medium', false, false, 1, 1000, 'not_used', '{1}')$$), 'OK 1', 'integrity.flags I: a not_used flag lands when the session is below its cutoff (rule 6)');
select doesnt_match(pg_temp.try($$insert into integrity.flags (id, org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, first_offset_ms, state, signal_seqs) values ('a7000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000004', 'D1-UNTRUSTED-INPUT', 'input_origin', 'T3', 'hard', true, false, 1, 1000, 'pending', '{1}')$$), '^OK', 'integrity.flags I: a pending flag is refused when the session is below its cutoff');
select doesnt_match(pg_temp.try($$insert into integrity.flags (id, org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, first_offset_ms, state, signal_seqs) values ('a7000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'D1-PASTE', 'paste', 'T3', 'medium', false, false, 1, 1000, 'confirmed', '{1}')$$), '^OK', 'integrity.flags I: a confirmed flag is refused (no confirm action in D1)');
select doesnt_match(pg_temp.try($$insert into integrity.flags (id, org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, first_offset_ms, state, signal_seqs) values ('a7000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'D1-PASTE', 'paste', 'T3', 'medium', false, false, 1, 1000, 'overturned', '{1}')$$), '^OK', 'integrity.flags I: an overturned flag is refused (no overturn in D1)');
select ok(exists (select 1 from pg_constraint where conname = 'flags_d1_no_confirm' and conrelid = 'integrity.flags'::regclass and contype = 'c'), 'integrity.flags: the CHECK flags_d1_no_confirm exists (M6 drops it)');
select matches(pg_temp.try($$insert into integrity.flags (id, org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, first_offset_ms, state, signal_seqs) values ('a7000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'D1-X-T1', 'paste', 'T1', 'medium', true, false, 1, 1000, 'pending', '{1}')$$), '^23514', 'integrity.flags I: untrusted on a T1 flag violates the T3-only CHECK (rule 3)');
select matches(pg_temp.try($$insert into integrity.flags (id, org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, first_offset_ms, state, signal_seqs) values ('a7000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'D1-X-T2', 'paste', 'T2', 'medium', false, true, 1, 1000, 'pending', '{1}')$$), '^23514', 'integrity.flags I: raw_media on a T2 flag violates the T3-only CHECK (rule 3)');
select matches(pg_temp.try($$insert into integrity.flags (id, org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, first_offset_ms, state, signal_seqs) values ('a7000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'D1-PASTE', 'paste', 'T3', 'medium', false, false, 1, 1000, 'pending', '{1}')$$), '^23505', 'integrity.flags I: a second flag for the same (session, rule) is refused');
select matches(pg_temp.try($$insert into integrity.flags (id, org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, first_offset_ms, state, signal_seqs) values ('a7000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'D1-LONG', 'paste', 'T3', 'medium', false, false, 1, 1000, 'pending', (select array_agg(g)::int[] from generate_series(1, 51) as g))$$), '^23514', 'integrity.flags I: more than 50 signal_seqs violate the CHECK');
select matches(pg_temp.try($$insert into integrity.flags (id, org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, first_offset_ms, state, signal_seqs) values ('a7000000-0000-4000-8000-00000000000c', 'a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000040', 'D1-PASTE', 'paste', 'T3', 'medium', false, false, 1, 1000, 'pending', '{1}')$$), '^42501', 'integrity.flags I: job org A cannot insert a flag for an org B session (cross-org)');
select matches(pg_temp.try($$update integrity.flags set state = 'pending'$$), '^42501 permission denied', 'integrity.flags U: the integrity worker has no UPDATE at all in D1');
select matches(pg_temp.try($$delete from integrity.flags$$), '^42501 permission denied', 'integrity.flags D: the integrity worker holds no DELETE');
select is((select count(*)::int from integrity.flags), 2, 'integrity.flags S: job org A sees its two flags (one pending, one not_used)');
reset role;
reset trace.job_org_id;
set local role trace_integrity_worker;
select is((select count(*)::int from integrity.flags), 0, 'integrity.flags S: with no job org the integrity worker sees nothing');
select matches(pg_temp.try($$insert into integrity.flags (id, org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, first_offset_ms, state, signal_seqs) values ('a7000000-0000-4000-8000-00000000000d', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'D1-PASTE', 'paste', 'T3', 'medium', false, false, 1, 1000, 'pending', '{1}')$$), '^42501', 'integrity.flags I: with no job org the integrity worker cannot insert');
reset role;
reset trace.job_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from integrity.flags), 0, 'integrity.flags S: job org B sees no org A flag (cross-org)');
reset role;
reset trace.job_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select * from integrity.flags$$), '^42501 permission denied', 'integrity.flags S: the quality worker cannot read (no grant)');
reset role;
reset trace.job_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select * from integrity.flags$$), '^42501 permission denied', 'integrity.flags S: authenticated cannot read (no grant)');
reset role;
reset request.jwt.claims;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select * from integrity.flags$$), '^42501 permission denied', 'integrity.flags S: trace_worker cannot read (no grant)');
reset role;
reset trace.job_org_id;
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'integrity.flags', 'select')), 'trace_integrity_worker', 'integrity.flags: exactly trace_integrity_worker can read it (the other roles hold no SELECT)');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'integrity.flags', 'insert')), 'trace_integrity_worker', 'integrity.flags: exactly trace_integrity_worker can insert');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'integrity.flags', 'update,delete,truncate,references,trigger')), '', 'integrity.flags: no role holds UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER');
-- ===== integrity.results (the band is always stored; never Clear on thin coverage; insert-only) =====
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select is(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000001'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000001')), 'band-engine-1', 'clear', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), 'OK 1', 'integrity.results I: the integrity worker stores a Clear band with coverage above the floor');
select is(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000002'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000002')), 'band-engine-1', 'clear', 1.00, 700, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), 'OK 1', 'integrity.results I: Clear at coverage equal to the floor is allowed (boundary)');
select matches(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000003'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000003')), 'band-engine-1', 'clear', 1.00, 699, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), '^23514', 'integrity.results I: Clear below the coverage floor violates the CHECK (never Clear on thin coverage)');
select is(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000003'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000003')), 'band-engine-1', 'insufficient_evidence', 1.00, 100, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), 'OK 1', 'integrity.results I: Insufficient evidence on thin coverage is allowed');
select is(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000004', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000004'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000004')), 'band-engine-1', 'review', 0.33, 100, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), 'OK 1', 'integrity.results I: Review on thin coverage is allowed (evidence wins, R-3)');
select is(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000005', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000005'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000005')), 'band-engine-1', 'strong_concern', 0.33, 100, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), 'OK 1', 'integrity.results I: Strong concern on thin coverage is allowed (evidence wins, R-3)');
select matches(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-0000000000f1', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000001'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000001')), 'band-engine-1', 'clear', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), '^23505', 'integrity.results I: a second result for (session, ruleset) is refused');
select matches(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000006', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006')), 'band-engine-1', 'rejected', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), '^22P02', 'integrity.results I: a band label outside the four enum labels is refused (''rejected'' does not exist, rule 2)');
select is((select array_agg(enumlabel::text order by enumlabel::text) from pg_enum where enumtypid = 'integrity.band'::regtype), array['clear', 'insufficient_evidence', 'review', 'strong_concern'], 'integrity.band has exactly the four labels and no reject label (MT-6)');
select matches(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000006', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006')), 'band-engine-1', null, 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), '^23502', 'integrity.results I: the band is never null (no band-null CHECK exists, stored always)');
select matches(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000006', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006')), 'band-engine-1', 'clear', 1.50, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), '^23514', 'integrity.results I: evidence_strength 1.50 violates the 0..1 CHECK');
select matches(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000006', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006')), 'band-engine-1', 'clear', 1.00, 1001, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), '^23514', 'integrity.results I: coverage_permille 1001 violates the 0..1000 CHECK');
select matches(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000006', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006')), 'band-engine-1', 'clear', 1.00, 900, -1, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), '^23514', 'integrity.results I: coverage_floor_permille -1 violates the 0..1000 CHECK');
select matches(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000006', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006')), 'band-engine-1', 'clear', 1.00, 900, 700, false, 'xyz', '2026-10-14 10:22:00+00')$$), '^23514', 'integrity.results I: input_hash must be 64 hex');
select matches(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000006', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006')), null, 'clear', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), '^23502', 'integrity.results I: engine_version is not null (versions are recorded)');
select matches(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000006', null, (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006')), 'band-engine-1', 'clear', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), '^23502', 'integrity.results I: ruleset_version_id is not null');
select matches(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000040', 'a1000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000040', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000040'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000040')), 'band-engine-1', 'clear', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), '^42501', 'integrity.results I: job org A cannot store a result for an org B session (cross-org)');
select matches(pg_temp.try($$update integrity.results set band = 'clear'$$), '^42501 permission denied', 'integrity.results U: the integrity worker holds no UPDATE (insert-only)');
select matches(pg_temp.try($$delete from integrity.results$$), '^42501 permission denied', 'integrity.results D: the integrity worker holds no DELETE');
select is((select count(*)::int from integrity.results), 5, 'integrity.results S: job org A sees its five results');
reset role;
reset trace.job_org_id;
set local role trace_integrity_worker;
select is((select count(*)::int from integrity.results), 0, 'integrity.results S: with no job org the integrity worker sees nothing');
select matches(pg_temp.try($$insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000006', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-000000000006')), 'band-engine-1', 'clear', 1.00, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00')$$), '^42501', 'integrity.results I: with no job org the integrity worker cannot insert');
reset role;
reset trace.job_org_id;
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000003';
select is((select count(*)::int from integrity.results), 0, 'integrity.results S: job org B sees no org A result (cross-org)');
reset role;
reset trace.job_org_id;
select matches(pg_temp.try($$update integrity.results set band = 'clear'$$), '^(42501|P0001)', 'integrity.results U: even the operator cannot rewrite a result (immutable)');
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select * from integrity.results$$), '^42501 permission denied', 'integrity.results S: the quality worker cannot read (no grant)');
reset role;
reset trace.job_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "aal": "aal2", "amr": [{"method": "password", "timestamp": 1760000000}, {"method": "totp", "timestamp": 1760000100}], "role": "authenticated"}';
select matches(pg_temp.try($$select * from integrity.results$$), '^42501 permission denied', 'integrity.results S: authenticated cannot read (no grant)');
reset role;
reset request.jwt.claims;
set local role trace_api;
select matches(pg_temp.try($$select * from integrity.results$$), '^42501 permission denied', 'integrity.results S: trace_api cannot read (no grant)');
reset role;
reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-000000000001';
select matches(pg_temp.try($$select * from integrity.results$$), '^42501 permission denied', 'integrity.results S: trace_worker cannot read (no grant)');
reset role;
reset trace.job_org_id;
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'integrity.results', 'select')), 'trace_integrity_worker', 'integrity.results: exactly trace_integrity_worker can read it (the other roles hold no SELECT)');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'integrity.results', 'insert')), 'trace_integrity_worker', 'integrity.results: exactly trace_integrity_worker can insert');
select is((select coalesce(string_agg(r, ',' order by r), '') from unnest(array['anon', 'authenticated', 'service_role', 'trace_api', 'trace_candidate', 'trace_candidate_gateway', 'trace_worker', 'trace_quality_worker', 'trace_integrity_worker']) as r where has_table_privilege(r, 'integrity.results', 'update,delete,truncate,references,trigger')), '', 'integrity.results: no role holds UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER');
-- ===== rule 1 / MT-5 shape proofs for the two internal schemas =====
select is((select count(*)::int from information_schema.columns where table_schema = 'integrity' and column_name ~* '(score|quality|grade|outcome|reject|cutoff)'), 0, 'rule 1: no integrity column is named like a score, quality, grade, outcome, cutoff or reject');
select is((select count(*)::int from information_schema.columns where table_schema = 'quality' and column_name ~* '(band|integrity|flag|reject|evidence)'), 0, 'rule 1: no quality column is named like a band, integrity, flag, evidence or reject');
select is((select count(*)::int from pg_constraint c join pg_class a on a.oid = c.conrelid join pg_namespace an on an.oid = a.relnamespace join pg_class b on b.oid = c.confrelid join pg_namespace bn on bn.oid = b.relnamespace where c.contype = 'f' and ((an.nspname = 'quality' and bn.nspname = 'integrity') or (an.nspname = 'integrity' and bn.nspname = 'quality'))), 0, 'rule 1: no foreign key links quality.* and integrity.* (MT-5)');
select is(has_schema_privilege('trace_quality_worker', 'integrity', 'USAGE') or has_schema_privilege('trace_integrity_worker', 'quality', 'USAGE'), false, 'rule 1: neither result worker holds USAGE on the other internal schema (MT-5c, MT-14 both_schemas)');
select is((select count(*)::int from pg_roles r where r.rolname in ('trace_quality_worker', 'trace_integrity_worker') and pg_has_role(r.oid, 'trace_worker', 'member')), 0, 'rule 1: the two result workers are not members of trace_worker');
select is(has_schema_privilege('trace_api', 'quality', 'USAGE') or has_schema_privilege('trace_api', 'integrity', 'USAGE'), false, 'rule 1: trace_api holds nothing in quality or integrity (3.3 note 6)');

select * from finish();
rollback;
