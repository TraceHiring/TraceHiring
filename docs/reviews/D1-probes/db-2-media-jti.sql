begin;
grant trace_worker to postgres with inherit false, set true;
grant trace_quality_worker to postgres with inherit false, set true;
grant trace_integrity_worker to postgres with inherit false, set true;
grant trace_api to postgres with inherit false, set true;
grant usage on schema extensions to trace_worker, trace_quality_worker, trace_integrity_worker, trace_api, authenticated;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'authenticated', 'authenticated', 'p-dbrev-admin@example.test'),
  ('00000000-0000-4000-8000-0000000000d2', 'authenticated', 'authenticated', 'p-dbrev-rev@example.test');
insert into public.orgs (id, kind, name, slug) values ('a1000000-0000-4000-8000-0000000000d1', 'customer', 'Org DBR', 'org-dbrev-probe');
insert into public.workspaces (id, org_id, name, kind, is_default) values ('b1000000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-0000000000d1', 'Default', 'default', true);
insert into public.memberships (org_id, user_id, roles, workspace_id, display_name, status) values
  ('a1000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d1', '{org_owner,admin}', null, 'Persona Admin', 'active'),
  ('a1000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2', '{reviewer}', null, 'Persona Rev', 'active');
insert into public.tests (id, org_id, workspace_id, name) values ('e1000000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-0000000000d1', 'b1000000-0000-4000-8000-0000000000d1', 'Test DBR');
insert into public.test_versions (id, org_id, test_id, version_no, total_time_seconds, quality_cutoff) values ('f1000000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-0000000000d1', 'e1000000-0000-4000-8000-0000000000d1', 1, 1800, 40);
insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values ('51000000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-0000000000d1', 'f1000000-0000-4000-8000-0000000000d1', 1, 'Choices', 'mcq', 1);
insert into public.item_versions (id, org_id, test_version_id, section_id, format, position, stem, options, rubric_version_id, origin, content_sha256) values ('61000000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-0000000000d1', 'f1000000-0000-4000-8000-0000000000d1', '51000000-0000-4000-8000-0000000000d1', 'mcq', 1, 'Pick one.', '[{"id": "o1", "text": "One"}, {"id": "o2", "text": "Two"}]', null, 'human', repeat('c', 64));
insert into public.item_answer_keys (org_id, item_version_id, format, key) values ('a1000000-0000-4000-8000-0000000000d1', '61000000-0000-4000-8000-0000000000d1', 'mcq', '{"option_id": "o1"}');
update public.test_versions set status = 'published', content_sha256 = repeat('b', 64) where id = 'f1000000-0000-4000-8000-0000000000d1';
insert into public.assignments (org_id, membership_id, scope, test_id, as_role) select m.org_id, m.id, 'test', 'e1000000-0000-4000-8000-0000000000d1', 'reviewer' from public.memberships m where m.user_id = '00000000-0000-4000-8000-0000000000d2';
insert into public.assignments (org_id, membership_id, scope, test_id, as_role) select m.org_id, m.id, 'test', 'e1000000-0000-4000-8000-0000000000d1', 'admin' from public.memberships m where m.user_id = '00000000-0000-4000-8000-0000000000d1';
insert into public.invitations (id, org_id, workspace_id, test_id, test_version_id, candidate_label, contact_email, link_token_hash, adult_confirmed_by_inviter, status, expires_at) values ('a2000000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-0000000000d1', 'b1000000-0000-4000-8000-0000000000d1', 'e1000000-0000-4000-8000-0000000000d1', 'f1000000-0000-4000-8000-0000000000d1', 'Candidate 0', 'cd1@example.test', '00000000000000000000000000000000000000000000000000000000000dbd01', true, 'created', '2030-01-01 00:00:00+00');
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-0000000000d1';
update public.invitations set status = 'sent' where id = 'a2000000-0000-4000-8000-0000000000d1';
update public.invitations set status = 'otp_verified', adult_self_declared = true where id = 'a2000000-0000-4000-8000-0000000000d1';
insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event)
  select 'a3000000-0000-4000-8000-0000000000d1', i.org_id, i.id, i.test_version_id, v.ruleset_version_id, v.notice_version_id, repeat('d', 64), 'en', 'granted'
  from public.invitations i join public.test_versions v on v.org_id = i.org_id and v.id = i.test_version_id where i.id = 'a2000000-0000-4000-8000-0000000000d1';
update public.invitations set session_id = 'a4000000-0000-4000-8000-0000000000d1' where id = 'a2000000-0000-4000-8000-0000000000d1';
update public.invitations set status = 'started', started_at = '2026-10-14 10:00:00+00' where id = 'a2000000-0000-4000-8000-0000000000d1';
reset role; reset trace.api_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-0000000000d1';
insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind, adult_confirmed_at_start, started_at, server_deadline_at, submitted_at, mirror_seq, receipt_ref)
  select 'a4000000-0000-4000-8000-0000000000d1', i.org_id, i.test_version_id, c.ruleset_version_id, i.id, c.id, 'submitted', 'candidate', true, '2026-10-14 10:00:00+00', '2026-10-14 10:31:00+00', '2026-10-14 10:20:00+00', 1, 'RCPTDBR1' from public.invitations i join public.consents c on c.invitation_id = i.id where i.id = 'a2000000-0000-4000-8000-0000000000d1';
update public.invitations set status = 'submitted' where id = 'a2000000-0000-4000-8000-0000000000d1';
insert into public.reports (org_id, session_id) values ('a1000000-0000-4000-8000-0000000000d1', 'a4000000-0000-4000-8000-0000000000d1');
reset role; reset trace.job_org_id;
set local role trace_quality_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-0000000000d1';
insert into quality.scores (id, org_id, session_id, test_version_id, score, section_scores, quality_cutoff, meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, computed_at) values ('a5000000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-0000000000d1', 'a4000000-0000-4000-8000-0000000000d1', 'f1000000-0000-4000-8000-0000000000d1', 80, '[{"position": 1, "weight": 1, "score": 80}]', 40, true, 'd1-scoring-v1', repeat('d', 64), '{}', 'mock-grader-v1', 'mock-1', '2026-10-14 10:21:00+00');
insert into public.quality_cards (org_id, session_id, quality_score_id) values ('a1000000-0000-4000-8000-0000000000d1', 'a4000000-0000-4000-8000-0000000000d1', 'a5000000-0000-4000-8000-0000000000d1');
reset role;
reset trace.job_org_id;
set local role trace_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-0000000000d1';
insert into public.media_objects (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device) values ('a8000000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-0000000000d1', 'a4000000-0000-4000-8000-0000000000d1', 'start_photo', 'media/a1000000-0000-4000-8000-0000000000d1/a4000000-0000-4000-8000-0000000000d1/start_photo.jpg', repeat('a', 64), 1000, 'image/jpeg', true);
reset role;
reset trace.job_org_id;
insert into public.audit_log (org_id, actor_kind, actor_user_id, actor_roles, action, object_table, object_id, details, occurred_at) values
 ('a1000000-0000-4000-8000-0000000000d1', 'org_user', '00000000-0000-4000-8000-0000000000d1', '{org_owner,admin}', 'media.link_issued', 'media_objects', 'a8000000-0000-4000-8000-0000000000d1', '{"link_id":"c0ffee00-0000-4000-8000-0000000000d1"}', now() - interval '400 seconds'),
 ('a1000000-0000-4000-8000-0000000000d1', 'org_user', '00000000-0000-4000-8000-0000000000d1', '{org_owner,admin}', 'media.view', 'media_objects', 'a8000000-0000-4000-8000-0000000000d1', '{"link_id":"c0ffee00-0000-4000-8000-0000000000d1"}', now() - interval '390 seconds');
set local role trace_api;
set local trace.api_org_id = 'a1000000-0000-4000-8000-0000000000d1';
select 'reissue same jti -> session ' || private.media_link_grant('a8000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d1', 'aal2', '{password}', 'c0ffee00-0000-4000-8000-0000000000d1');
select 'second view of same jti -> ' || private.media_view_grant('a8000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d1', 'aal2', '{password}', 'c0ffee00-0000-4000-8000-0000000000d1');
reset role;
select 'audit rows for jti=' || count(*) from public.audit_log where details ->> 'link_id' = 'c0ffee00-0000-4000-8000-0000000000d1';
rollback;
