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
set local role trace_integrity_worker;
set local trace.job_org_id = 'a1000000-0000-4000-8000-0000000000d1';
insert into integrity.results (id, org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) values ('a6000000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-0000000000d1', 'a4000000-0000-4000-8000-0000000000d1', (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-0000000000d1'), (select r.band_rule_version_id from public.ruleset_versions r where r.id = (select ruleset_version_id from public.sessions where id = 'a4000000-0000-4000-8000-0000000000d1')), 'band-engine-1', 'strong_concern', 0.67, 900, 700, false, repeat('e', 64), '2026-10-14 10:22:00+00');
insert into integrity.flags (org_id, session_id, rule_id, family, tier, severity, count, first_offset_ms, state, signal_seqs) values ('a1000000-0000-4000-8000-0000000000d1', 'a4000000-0000-4000-8000-0000000000d1', 'D1-TAB-HIDDEN', 'focus', 'T1', 'hard', 1, 1000, 'pending', '{1}');
insert into integrity.flags (org_id, session_id, rule_id, family, tier, severity, count, first_offset_ms, state, signal_seqs) values ('a1000000-0000-4000-8000-0000000000d1', 'a4000000-0000-4000-8000-0000000000d1', 'NOT-IN-TABLE', 'gaze', 'T2', 'hard', 1, 1000, 'pending', '{1}');
insert into public.integrity_cards (org_id, session_id, integrity_result_id, review_state) values ('a1000000-0000-4000-8000-0000000000d1', 'a4000000-0000-4000-8000-0000000000d1', 'a6000000-0000-4000-8000-0000000000d1', 'reviewed');
update public.reports set integrity_card_id = (select id from public.integrity_cards where session_id = 'a4000000-0000-4000-8000-0000000000d1') where session_id = 'a4000000-0000-4000-8000-0000000000d1';
reset role;
reset trace.job_org_id;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated","aal":"aal2","amr":[{"method":"password","timestamp":1}]}';
select 'reviewer sees band=' || band || ' state=' || review_state from public.integrity_cards;
reset role;
select 'flags=' || string_agg(rule_id || ':' || tier || ':' || severity, ',') from integrity.flags where session_id = 'a4000000-0000-4000-8000-0000000000d1';
rollback;
