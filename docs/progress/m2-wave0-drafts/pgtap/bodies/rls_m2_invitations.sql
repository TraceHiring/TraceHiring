-- rls_m2_invitations (spec specs/m2-scheduling-invites.md revision 5 §10 row rls_m2_invitations; §3.2 invitations; §3.3; §3.4 row invitations; §4 Invitation; I-M2-2, I-M2-5; M2-5, M2-18, R2-1, R2-15, R2-19, R3-3, R3-9, R4-4, R5-5, R5-11, R5-12, R5-17, R5-41, R5-42, R5-47, R5-48, R5-51, R5-64, R5-65, R5-66; AT-M2-03, AT-M2-04, AT-M2-17, AT-M2-27, AT-M2-28). RED first: written from the spec before migration M2-b. Synthetic data.
-- Fixtures: ta = a 10x version (A1) and ta2 its newer version; drive ds (scheduled mode) with slots s1 (+48 h) and s2
-- (+72 h), scheduled; drive dw (open window, scheduled); drive dd (draft). Candidates c1 and c2 share phone p1.
select pg_temp.pooltv('ta', pg_temp.id('A'), pg_temp.id('A1'));
insert into public.test_versions (org_id, test_id, total_time_seconds, quality_cutoff)
  values (pg_temp.id('A'), pg_temp.id('ta_test'), 1800, 40);
insert into pg_temp.ids select 'ta2', id from public.test_versions where test_id = pg_temp.id('ta_test') and version_no = 2;
select pg_temp.sec('ta2_s', 'ta2', 1, 'mcq', pg_temp.id('ta_pool'), 1, 100);
select pg_temp.preset('ta2', 'standard');
select pg_temp.publish('ta2');
select pg_temp.drive('ds', 'ta', 'scheduled');
select pg_temp.slot('s1', 'ds', 48, 5);
select pg_temp.slot('s2', 'ds', 72, 5);
update public.drives set status = 'scheduled' where id = pg_temp.id('ds');
select pg_temp.drive('dw', 'ta', 'open_window', 'scheduled');
select pg_temp.drive('dd', 'ta', 'open_window');
select pg_temp.cand('c1', pg_temp.id('A'), pg_temp.id('A1'), 'p1');
select pg_temp.cand('c2', pg_temp.id('A'), pg_temp.id('A1'), 'p1');
select pg_temp.cand('c' || n, pg_temp.id('A'), pg_temp.id('A1')) from generate_series(3, 9) as n;
insert into public.assignments (org_id, membership_id, scope, test_id, as_role)
  select m.org_id, m.id, 'test', pg_temp.id('ta_test'), 'reviewer'
  from public.memberships as m where m.org_id = pg_temp.id('A') and m.user_id = pg_temp.id('reviewer');
-- rinv(key, drive, slot, candidate, confirmed by): the INSERT a recruiter sends through ingest_invite_batch.
create function pg_temp.rinv(p_key text, p_drive text, p_slot text, p_cand text, p_conf uuid default null) returns text
language sql as $f$
  select pg_temp.try(format($s$insert into public.invitations (org_id, test_id, test_version_id, drive_id, slot_id, candidate_ref_id, link_token_hash, adult_confirmed_by_inviter, expires_at, shared_contact_confirmed_by) values (%L, %L, %L, %L, %L, %L, %L, true, now() + interval '1 hour', %L)$s$,
    pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'), pg_temp.id(p_drive), pg_temp.id(p_slot), pg_temp.id(p_cand),
    pg_temp.h('l-' || p_key), p_conf))
$f$;
grant execute on function pg_temp.rinv(text, text, text, text, uuid) to public;

-- ===== Insert rules (label trigger, R5-11) =====
select pg_temp.u('recruiter');
select is(pg_temp.rinv('i1', 'ds', 's1', 'c1'), 'OK 1', 'I recruiter: a drive invitation');
select pg_temp.op();
insert into pg_temp.ids select 'i1', id from public.invitations where link_token_hash = pg_temp.h('l-i1');
select is((select status::text || '|' || (expires_at = private.drive_end(org_id, drive_id) + interval '7 days')::text || '|' || (email_bidx = pg_temp.h('e-c1'))::text || '|' || (phone_bidx = pg_temp.h('p-p1'))::text || '|' || coalesce(session_grant_exp::text, 'null') || '|' || token_version || '|' || plan_no || '|' || self_reschedules_used || '|' || language from public.invitations where id = pg_temp.id('i1')), 'created|true|true|true|null|1|0|0|en', 'R5-11: expires_at = drive end + 7 days (client value ignored), blind indexes copied from the contact, session_grant_exp null, counters at their start');
select is((select expires_at from public.invitations where id = pg_temp.id('i1')), (select greatest(d.deadline_at, (select max(s.starts_at + make_interval(mins => s.start_window_minutes)) from public.slots as s where s.drive_id = d.id and s.status <> 'cancelled')) + interval '7 days' from public.drives as d where d.id = pg_temp.id('ds')), 'R5-51: drive end is the later of the deadline and the last slot''s window end');
select pg_temp.op();
select pg_temp.slot('s9', 'ds', 24 * 30 - 0.1, 5);
select is((select expires_at = (select s.starts_at + interval '15 minutes' + interval '7 days' from public.slots as s where s.id = pg_temp.id('s9')) from public.invitations where id = pg_temp.id('i1')), true, 'R5-51, R5-65 e: a slot whose window ends after the deadline moves expires_at forward (statement-level slots trigger)');
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$insert into public.invitations (org_id, test_id, test_version_id, drive_id, slot_id, candidate_ref_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at) values (%L, %L, %L, %L, %L, %L, 'm2-x@example.test', %L, true, now() + interval '1 day')$$, pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'), pg_temp.id('ds'), pg_temp.id('s1'), pg_temp.id('c3'), pg_temp.h('l-x1'))), '^23514', 'R5-17: a drive row has no plaintext contact_email');
select matches(pg_temp.try(format($$insert into public.invitations (org_id, test_id, test_version_id, drive_id, slot_id, link_token_hash, adult_confirmed_by_inviter, expires_at) values (%L, %L, %L, %L, %L, %L, true, now() + interval '1 day')$$, pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'), pg_temp.id('ds'), pg_temp.id('s1'), pg_temp.h('l-x2'))), '^23514', 'R2-1: a drive row needs its candidate link');
select matches(pg_temp.rinv('x3', 'ds', null, 'c3'), '^42501 TRACE_GUARD: a scheduled-mode drive invitation needs a slot', 'I: a scheduled-mode drive invitation names a slot');
select matches(pg_temp.rinv('x4', 'dd', null, 'c3'), '^42501 TRACE_GUARD: invitations need a scheduled drive', 'I: a draft drive takes no invitation');
select is(pg_temp.rinv('w1', 'dw', null, 'c3'), 'OK 1', 'I: an open-window drive invitation has no slot');
select pg_temp.u('ws_recruiter');
select matches(pg_temp.rinv('x5', 'ds', 's1', 'c4'), '^42501', 'I ws_recruiter: refused outside its workspace');
select pg_temp.u('reviewer');
select matches(pg_temp.rinv('x6', 'ds', 's1', 'c4'), '^42501', 'I reviewer: refused');

-- ===== Email dedupe per drive (I-M2-2, AT-M2-03) =====
select pg_temp.u('recruiter');
select matches(pg_temp.rinv('x7', 'ds', 's2', 'c1'), '^23505', 'AT-M2-03: the same email cannot be invited twice to a drive');
select is(pg_temp.rinv('w2', 'dw', null, 'c1'), 'OK 1', 'E3: the same person may be invited to another drive of the workspace');

-- ===== Phone rule (M2-5, R2-15, AT-M2-04) =====
select matches(pg_temp.rinv('x8', 'ds', 's1', 'c2'), '^42501 TRACE_GUARD: phone shared with another candidate', 'AT-M2-04: a phone-only match with another email is held for confirmation');
select matches(pg_temp.rinv('x9', 'ds', 's1', 'c2', pg_temp.id('owner')), '^42501 TRACE_GUARD: the shared-contact confirmation names the caller', 'AT-M2-04: the confirmation must name the caller');
select is(pg_temp.rinv('i2', 'ds', 's1', 'c2', pg_temp.id('recruiter')), 'OK 1', 'AT-M2-04: allowed with the caller''s confirmation');
select pg_temp.op();
insert into pg_temp.ids select 'i2', id from public.invitations where link_token_hash = pg_temp.h('l-i2');
select is((select count(*)::int from public.audit_log where action = 'invitation.shared_contact_confirmed' and object_id = pg_temp.id('i2') and actor_user_id = pg_temp.id('recruiter')), 1, 'AT-M2-04: the confirmation is audited with the actor');

-- ===== Column grants (R3-9, R5-64 d, R5-66 d) =====
select pg_temp.u('recruiter');
select is((select count(*)::int from public.invitations where drive_id = pg_temp.id('ds')), 2, 'S recruiter: drive_id is selectable (R5-64 d)');
select matches(pg_temp.try('select email_bidx from public.invitations'), '^42501 permission denied', 'R3-9: email_bidx is outside the staff grant');
select matches(pg_temp.try('select candidate_ref_id from public.invitations'), '^42501 permission denied', 'R3-9: candidate_ref_id is outside the staff grant');
select matches(pg_temp.try('select shared_contact_confirmed_by from public.invitations'), '^42501 permission denied', 'R3-9: shared_contact_confirmed_by is outside the staff grant');
select matches(pg_temp.try(format($$update public.invitations set expires_at = now() + interval '90 days' where id = %L$$, pg_temp.id('i1'))), '^42501 permission denied', 'R5-42: no UPDATE grant on expires_at for staff');
select set_config('trace.drive_end_trigger', 'on', true);
select matches(pg_temp.try(format($$update public.invitations set expires_at = now() + interval '90 days' where id = %L$$, pg_temp.id('i1'))), '^42501 permission denied', 'R5-42: a custom setting changes nothing');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.invitations where test_id = pg_temp.id('ta_test')), 4, 'S reviewer: D1''s status read of the assigned test''s invitations still works');
select pg_temp.api(pg_temp.id('A'));
select is((select count(*)::int from public.invitations where drive_id = pg_temp.id('ds') and slot_id is not null and session_grant_exp is null), 2, 'S api (R5-66 d): drive_id, slot_id and session_grant_exp are selectable');
select pg_temp.w('trace_messaging_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$update public.invitations set token_version = 2 where id = %L$$, pg_temp.id('i1'))), '^42501 permission denied', 'R5-42: the messaging worker holds no UPDATE grant (rotation is DEFINER-only)');
select pg_temp.op();

-- ===== expires_at follows the drive end, forward only (R3-10, R5-42, R5-51, R5-65 c) =====
select matches(pg_temp.try(format($$update public.invitations set expires_at = expires_at + interval '1 day' where id = %L$$, pg_temp.id('i1'))), '^42501 TRACE_GUARD: invitation identity, pin, contact and inviter answer are immutable', 'R5-42: expires_at moves only to drive end + 7 days');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.drives set deadline_at = deadline_at + interval '10 days' where id = %L$$, pg_temp.id('ds'))), 'OK 1', 'R3-10: the recruiter extends the deadline');
select pg_temp.op();
select is((select bool_and(expires_at = private.drive_end(org_id, drive_id) + interval '7 days') from public.invitations where drive_id = pg_temp.id('ds')), true, 'R3-10: every live invitation of the drive follows the new end');
select is((select count(*)::int from public.audit_log where object_table = 'invitations' and action like 'invitation.%' and object_id = pg_temp.id('i1') and action <> 'invitation.create'), 0, 'R5-42: the follow-up move writes no invitation audit row');

-- ===== Version pin (I-M2-5, AT-M2-17) =====
select is((select bool_and(test_version_id = pg_temp.id('ta')) from public.invitations where drive_id = pg_temp.id('ds')), true, 'AT-M2-17: each invitation pins the drive''s default version at creation');
insert into pg_temp.ids select 'w1', id from public.invitations where link_token_hash = pg_temp.h('l-w1');
select matches(pg_temp.try(format($$update public.invitations set test_version_id = %L where id = %L$$, pg_temp.id('ta2'), pg_temp.id('w1'))), '^42501 TRACE_GUARD: invitation identity, pin, contact and inviter answer are immutable', 'AT-M2-17: the pin never changes');

-- ===== Staff moves and revokes (R3-3, R4-4, R5-12, R5-48) =====
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.invitations set slot_id = %L where id = %L$$, pg_temp.id('s2'), pg_temp.id('i1'))), 'OK 1', 'U recruiter: a created invitation moves to another slot');
select pg_temp.op();
select is((select plan_no::text || '|' || (select booked from public.slots where id = pg_temp.id('s1')) || '|' || (select booked from public.slots where id = pg_temp.id('s2')) from public.invitations where id = pg_temp.id('i1')), '1|1|1', 'R4-2, R2-15: plan_no +1 and the seat moves with the invitation');
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$update public.invitations set plan_no = 7 where id = %L$$, pg_temp.id('i1'))), '^42501', 'U: plan_no is the guard''s');
-- i3: consented (otp_verified), no session yet; i4: session_id set with a live grant; i5: a grant that has passed.
select pg_temp.dinv('i3', 'ds', 's1', 'c3');
select pg_temp.dinv('i4', 'ds', 's1', 'c4');
select pg_temp.dinv('i5', 'ds', 's1', 'c5');
select pg_temp.dinv('i6', 'ds', 's1', 'c6');
select pg_temp.consent('i3');
select pg_temp.consent('i4');
select pg_temp.consent('i5');
select pg_temp.consent('i6');
select pg_temp.api(pg_temp.id('A'));
select is(pg_temp.try(format($$update public.invitations set session_id = gen_random_uuid() where id = %L$$, pg_temp.id('i4'))), 'OK 1', 'R5-41: trace_api sets session_id alone (D1 code)');
select is((select session_grant_exp between now() + interval '16199 seconds' and now() + interval '16201 seconds' from public.invitations where id = pg_temp.id('i4')), true, 'R5-41: the guard defaults session_grant_exp to now() + 16,200 s');
select is(pg_temp.try(format($$update public.invitations set session_id = gen_random_uuid(), session_grant_exp = now() - interval '1 minute' where id = %L$$, pg_temp.id('i5'))), 'OK 1', 'R5-66 a: an explicit session_grant_exp with session_id wins');
select matches(pg_temp.try(format($$update public.invitations set session_id = gen_random_uuid(), session_grant_exp = now() + interval '16300 seconds' where id = %L$$, pg_temp.id('i6'))), '^42501 TRACE_GUARD: session_grant_exp is past the cap', 'R5-65 e: an explicit value past now() + 16,200 s is refused');
select matches(pg_temp.try(format($$update public.invitations set session_grant_exp = now() where id = %L$$, pg_temp.id('i4'))), '^42501 TRACE_GUARD: session_grant_exp moves forward only', 'R5-5: session_grant_exp moves forward only');
select matches(pg_temp.try(format($$update public.invitations set session_grant_exp = now() + interval '1 hour' where id = %L$$, pg_temp.id('i3'))), '^42501 TRACE_GUARD: session_grant_exp needs the session id', 'R5-5: never before session_id');
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$update public.invitations set slot_id = %L where id = %L$$, pg_temp.id('s2'), pg_temp.id('i3'))), '^(42501|OK 0)', '§4: an otp_verified invitation is not moved by staff');
select is(pg_temp.try(format($$update public.invitations set status = 'revoked' where id = %L$$, pg_temp.id('i3'))), 'OK 1', 'R3-3: staff revoke a drive row from otp_verified (no session id)');
select matches(pg_temp.try(format($$update public.invitations set status = 'revoked' where id = %L$$, pg_temp.id('i4'))), '^42501 TRACE_GUARD: a live session grant blocks this change', 'R4-4, AT-M2-27: refused while now() <= session_grant_exp');
select is(pg_temp.try(format($$update public.invitations set status = 'revoked' where id = %L$$, pg_temp.id('i5'))), 'OK 1', 'R4-4, AT-M2-27: allowed after session_grant_exp with no sessions row');
select pg_temp.op();
select is((select count(*)::int from public.audit_log where action = 'invitation.revoke' and object_id = pg_temp.id('i5') and details ->> 'old_status' = 'otp_verified' and details ->> 'drive_id' = pg_temp.id('ds')::text), 1, 'R5-13: the revoke is audited with the old status and the drive id');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try(format($$update public.invitations set status = 'expired' where id = %L$$, pg_temp.id('i4'))), '^42501 TRACE_GUARD: a live session grant blocks this change', 'AT-M2-27: trace_api cannot expire while the grant lives');
select matches(pg_temp.try(format($$update public.invitations set slot_id = %L where id = %L$$, pg_temp.id('s2'), pg_temp.id('i4'))), '^42501', 'R5-12: trace_api moves a slot only with the self-reschedule counter (private.self_reschedule)');
select pg_temp.w('trace_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$update public.invitations set status = 'expired' where id = %L$$, pg_temp.id('i4'))), '^42501 TRACE_GUARD: the mirror may only set submitted', 'R5-6: trace_worker cannot expire an invitation (no sweep)');
-- A sessions row blocks both, even after the grant (R4-4).
select pg_temp.api(pg_temp.id('A'));
update public.invitations set status = 'started', started_at = now() where id = pg_temp.id('i4');
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$update public.invitations set status = 'revoked' where id = %L$$, pg_temp.id('i4'))), '^(42501|OK 0)', 'AT-M2-27: a started invitation is never revoked');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try(format($$update public.invitations set status = 'expired' where id = %L$$, pg_temp.id('i4'))), '^42501', 'AT-M2-27: nor expired');

-- ===== D1 rows keep D1's rules (R5-48, AT-M2-28) =====
select pg_temp.session('d1s', 'ta', 1);
select pg_temp.op();
select is((select session_grant_exp is not null from public.invitations where session_id = pg_temp.id('d1s')), true, 'R5-41: a D1 row that sets session_id alone gets the default too, so the CHECK holds for old code');
select pg_temp.op();
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at)
  values ('42000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'), 'm2-d1b@example.test', pg_temp.h('l-d1b'), true, now() + interval '1 day');
insert into pg_temp.ids values ('d1b', '42000000-0000-4000-8000-000000000001');
select pg_temp.consent('d1b');
select pg_temp.api(pg_temp.id('A'));
update public.invitations set session_id = gen_random_uuid(), session_grant_exp = now() - interval '1 minute' where id = pg_temp.id('d1b');
select matches(pg_temp.try(format($$update public.invitations set status = 'expired' where id = %L$$, pg_temp.id('d1b'))), '^42501 TRACE_GUARD: an invitation with a session cannot expire', 'R5-48: a D1 row with a session id keeps L-32, whatever session_grant_exp says');
select pg_temp.u('recruiter');
select matches(pg_temp.try(format($$update public.invitations set status = 'revoked' where id = %L$$, pg_temp.id('d1b'))), '^(42501|OK 0)', 'R5-48: staff revoke a D1 row only from created or sent');

-- ===== The CHECK and the backfill (R5-5, R5-58 b, R5-64 c, R5-65 a) =====
select pg_temp.op();
alter table public.invitations disable trigger invitations_guard;
select matches(pg_temp.try(format($$update public.invitations set session_grant_exp = null where id = %L$$, pg_temp.id('d1b'))), '^23514', 'R5-64 c: the CHECK refuses session_id without session_grant_exp (guard off)');
alter table public.invitations drop constraint invitations_session_grant_exp_check;
update public.invitations set session_grant_exp = null where id in (pg_temp.id('d1b'), (select id from public.invitations where session_id = pg_temp.id('d1s')));
alter table public.invitations enable always trigger invitations_guard;
select is((select private.backfill_session_grant_exp()), 2, 'R5-65 a: the backfill fills the two rows with the guard enabled (submitted and otp_verified)');
select is((select session_grant_exp from public.invitations where session_id = pg_temp.id('d1s')), '2026-10-14 11:31:00+00'::timestamptz, 'R5-5: a row with a sessions row gets server deadline + 3,600 s');
select is((select session_grant_exp = (select c.occurred_at + interval '10800 seconds' from public.consents as c where c.invitation_id = pg_temp.id('d1b')) from public.invitations where id = pg_temp.id('d1b')), true, 'R5-5: a row without one gets consent time + 10,800 s');
select is((select tgenabled::text from pg_catalog.pg_trigger where tgrelid = 'public.invitations'::regclass and tgname = 'invitations_guard'), 'A', 'R5-65 a: the guard is ENABLE ALWAYS again');
alter table public.invitations add constraint invitations_session_grant_exp_check check (session_id is null or session_grant_exp is not null);
select is((select count(*)::int from unnest(array['authenticated', 'trace_api', 'trace_worker', 'trace_messaging_worker']) as r where has_function_privilege(r, 'private.backfill_session_grant_exp()', 'EXECUTE')), 0, 'R5-58 b: no app role may run the backfill');

-- ===== private functions for trace_api (R2-19, R5-47, R5-66 d) =====
select is((select proargnames::text from pg_proc where oid = 'private.resolve_invitation_by_hash(text)'::regprocedure), '{p_hash,org_id,id,status,candidate_id,session_id,started_at,test_id,test_version_id,expires_at,drive_id,slot_id,slot_starts_at,start_window_minutes,lobby_opens_minutes,self_reschedules_used}', 'R2-19: resolve is widened with the drive, the slot times and the reschedule counter (never contacts)');
select pg_temp.api(null);
select is((select drive_id::text || '|' || (slot_starts_at = now() + interval '72 hours')::text || '|' || start_window_minutes || '|' || lobby_opens_minutes || '|' || self_reschedules_used from private.resolve_invitation_by_hash(pg_temp.h('l-i1'))), pg_temp.id('ds')::text || '|true|15|30|0', 'R2-19: resolve returns the current slot''s times');
select pg_temp.api(pg_temp.id('A'));
select is((select mode::text || '|' || (nb = now() + interval '72 hours')::text || '|' || (na - nb = interval '15 minutes')::text || '|' || (nb - lobby_opens_at = interval '30 minutes')::text from private.invitation_window(pg_temp.id('i1'))), 'scheduled|true|true|true', 'R5-66 d: a scheduled row''s window is [starts_at, +15 min], lobby 30 min early');
select is((select mode::text || '|' || (na = drive_end)::text || '|' || (nb = lobby_opens_at)::text from private.invitation_window(pg_temp.id('w1'))), 'open_window|true|true', 'R5-66 d: an open-window row''s window is [opens_at, drive end]');
select is((select count(*)::int from private.invitation_window(pg_temp.id('d1b'))), 0, 'R5-66 d: a D1 row has no window');
select is((select email_ct = pg_temp.ct('e-c1') from private.invitation_recipient_ct(pg_temp.id('i1'))), true, 'R5-47: trace_api reads a drive row''s recipient ciphertext');
select is((select count(*)::int from private.invitation_recipient_ct(pg_temp.id('d1b'))), 0, 'R5-47: nothing for a D1 row');
select pg_temp.api(pg_temp.id('B'));
select is((select count(*)::int from private.invitation_window(pg_temp.id('i1'))) + (select count(*)::int from private.invitation_recipient_ct(pg_temp.id('i1'))), 0, 'R5-47, R5-66 d: bound to the api org');
select pg_temp.u('owner');
select matches(pg_temp.try(format($$select * from private.invitation_recipient_ct(%L)$$, pg_temp.id('i1'))), '^42501 permission denied', 'R5-47: no app role may call it');
select pg_temp.op();
