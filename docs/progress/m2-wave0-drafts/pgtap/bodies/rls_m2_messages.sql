-- rls_m2_messages (spec specs/m2-scheduling-invites.md revision 5 §10 row rls_m2_messages; §3.2 message_templates, outbound_messages, message_events, message_events_unmatched; §3.3; §3.4; §4 Outbound message; I-M2-6, I-M2-7; M2-13, M2-14, R2-4, R2-11, R2-14, R2-15, R2-16, R2-18, R2-21, R3-1, R3-5, R3-6, R4-2, R4-5, R4-6, R4-7, R5-7, R5-14, R5-32, R5-44, R5-45, R5-52 a; AT-M2-02, AT-M2-05, AT-M2-06, AT-M2-19, AT-M2-24, AT-M2-26, AT-M2-29). RED first: written from the spec before migration M2-c. Synthetic data.
-- Fixtures: ta = a 10x version (A1); drive ds (scheduled mode, slots s1 at +48 h, s2 at +72 h, s3 at +2 h; reminders
-- 24 h and 1 h); drive dw (open window, deadline +30 days); drive dx (scheduled mode, slot x1s at +48 h) for the cancel
-- case. Candidates c1 to c12 in A1. The reviewer persona is assigned to ta's test.
select pg_temp.pooltv('ta', pg_temp.id('A'), pg_temp.id('A1'));
select pg_temp.drive('ds', 'ta', 'scheduled');
select pg_temp.slot('s1', 'ds', 48, 5);
select pg_temp.slot('s2', 'ds', 72, 5);
select pg_temp.slot('s3', 'ds', 2, 5);
update public.drives set status = 'scheduled' where id = pg_temp.id('ds');
select pg_temp.drive('dw', 'ta', 'open_window', 'scheduled');
select pg_temp.drive('dx', 'ta', 'scheduled');
select pg_temp.slot('x1s', 'dx', 48, 5);
update public.drives set status = 'scheduled' where id = pg_temp.id('dx');
select pg_temp.cand('c' || n, pg_temp.id('A'), pg_temp.id('A1')) from generate_series(1, 12) as n;
insert into public.assignments (org_id, membership_id, scope, test_id, as_role)
  select m.org_id, m.id, 'test', pg_temp.id('ta_test'), 'reviewer'
  from public.memberships as m where m.org_id = pg_temp.id('A') and m.user_id = pg_temp.id('reviewer');
-- plan(invitation): its messages as purpose:status in send order (read on the operator path).
create function pg_temp.plan(p_inv text) returns text language sql as $f$
  select coalesce(string_agg(m.purpose || ':' || m.status, ',' order by m.scheduled_for, m.purpose, m.idempotency_key), '')
  from public.outbound_messages as m where m.invitation_id = pg_temp.id(p_inv)
$f$;
-- claimed: what each claim returned. claim(p_now): the operator's claim (time travel); wclaim(p_now): the worker's.
create table pg_temp.claimed (org_id uuid, id uuid, claim_id uuid, reclaimed boolean, at timestamptz default clock_timestamp());
grant all on pg_temp.claimed to public;
create function pg_temp.claim(p_now timestamptz) returns int language plpgsql as $f$
declare v_n int;
begin
  perform pg_temp.op();
  insert into pg_temp.claimed (org_id, id, claim_id, reclaimed) select * from private.claim_due_messages(p_now, 1000);
  get diagnostics v_n = row_count;
  return v_n;
end
$f$;
create function pg_temp.wclaim(p_now timestamptz) returns int language plpgsql as $f$
declare v_n int;
begin
  perform pg_temp.w('trace_messaging_worker', null);
  insert into pg_temp.claimed (org_id, id, claim_id, reclaimed) select * from private.claim_due_messages(p_now, 1000);
  get diagnostics v_n = row_count;
  perform pg_temp.op();
  return v_n;
end
$f$;
-- msg(invitation, purpose): the invitation's first message of that purpose, a queued one first.
create function pg_temp.msg(p_inv text, p_purpose text) returns uuid language sql as $f$
  select m.id from public.outbound_messages as m where m.invitation_id = pg_temp.id(p_inv) and m.purpose = p_purpose
  order by (m.status = 'queued') desc, m.scheduled_for, m.id limit 1
$f$;
-- send(invitation, purpose, provider message id, claim): record_send as the worker of the message's org, with the
-- message's current claim unless one is given. fail(...): record_send_failure the same way.
create function pg_temp.send(p_inv text, p_purpose text, p_pmid text, p_claim uuid default null) returns text
language plpgsql as $f$
declare v_org uuid; v_id uuid; v_claim uuid; v_r boolean;
begin
  perform pg_temp.op();
  select m.org_id, m.id, coalesce(p_claim, m.claim_id) into v_org, v_id, v_claim
  from public.outbound_messages as m where m.id = pg_temp.msg(p_inv, p_purpose);
  perform pg_temp.w('trace_messaging_worker', v_org);
  v_r := private.record_send(v_org, v_id, v_claim, 'loadsim', p_pmid);
  perform pg_temp.op();
  return coalesce(v_r::text, 'null');
end
$f$;
create function pg_temp.fail(p_inv text, p_purpose text, p_code text, p_final boolean) returns text
language plpgsql as $f$
declare v_org uuid; v_id uuid; v_claim uuid; v_r text;
begin
  perform pg_temp.op();
  select m.org_id, m.id, m.claim_id into v_org, v_id, v_claim
  from public.outbound_messages as m where m.id = pg_temp.msg(p_inv, p_purpose);
  perform pg_temp.w('trace_messaging_worker', v_org);
  v_r := private.record_send_failure(v_org, v_id, v_claim, p_code, p_final);
  perform pg_temp.op();
  return coalesce(v_r, 'null');
end
$f$;
-- ev(provider message id, event id, event, bounce kind, tag org): record_message_event as trace_api (the webhook).
create function pg_temp.ev(p_pmid text, p_evid text, p_event text, p_bounce text, p_org uuid) returns text
language plpgsql as $f$
declare v_r text;
begin
  perform pg_temp.api(null);
  v_r := private.record_message_event('loadsim', p_evid, p_pmid, p_event, p_bounce, now(), p_org);
  perform pg_temp.op();
  return v_r;
end
$f$;
-- di(viewer, aal, amr): the drive list of ds through trace_api bound to org A, one page of 200.
create function pg_temp.di(p_viewer text, p_aal text, p_amr text[]) returns int language sql as $f$
  select count(*)::int from private.drive_invitations(pg_temp.id(p_viewer), p_aal, p_amr, pg_temp.id('ds'), null, null, 200)
$f$;
grant execute on function pg_temp.plan(text), pg_temp.claim(timestamptz), pg_temp.wclaim(timestamptz),
  pg_temp.msg(text, text), pg_temp.send(text, text, text, uuid), pg_temp.fail(text, text, text, boolean),
  pg_temp.ev(text, text, text, text, uuid), pg_temp.di(text, text, text[]) to public;

-- ===== Templates (R2-14, R5-32) =====
select pg_temp.op();
select is((select string_agg(t.purpose || ':' || t.channel || ':' || t.language || ':' || t.version, ',' order by t.purpose) from public.message_templates as t join public.orgs as o on o.id = t.org_id where o.kind = 'trace_library'), 'invite:email:en:1,otp:email:en:1,reminder:email:en:1,reschedule:email:en:1', 'R2-14: the seed is the four EN email templates of the library org');
select is((select string_agg(purpose || ':' || (body_template like '%{{invite_url}}%')::text, ',' order by purpose) from public.message_templates), 'invite:true,otp:false,reminder:false,reschedule:true', 'R2-4: invites and reschedules carry the link; reminders never do');
select is((select count(*)::int from public.message_templates where body_template ~* 'device' or subject_template ~* 'device'), 0, 'R5-32: no template uses the banned word');
select is((select (body_template like '%{{equipment_note}}%' and body_template like '%recorded%' and body_template like '%{{duration_minutes}}%' and body_template like '%{{starts_at_ist}}%')::text from public.message_templates where purpose = 'invite'), 'true', 'plan §3.2 step 1: the invite says the time, the duration, the equipment and what is recorded');
select is((select count(*)::int from public.message_templates where body_sha256 <> encode(sha256(convert_to(body_template, 'UTF8')), 'hex')), 0, 'R2-14: body_sha256 is the body''s hash');
select matches(pg_temp.try(format($$insert into public.message_templates (org_id, purpose, channel, language, version, subject_template, body_template, body_sha256) values (%L, 'invite', 'email', 'en', 9, 'S', 'Hello {{email}}', encode(sha256(convert_to('Hello {{email}}', 'UTF8')), 'hex'))$$, pg_temp.id('L'))), '^23514', 'R5-32: a template variable outside the list is refused');
select matches(pg_temp.try(format($$insert into public.message_templates (org_id, purpose, channel, language, version, subject_template, body_template, body_sha256) values (%L, 'invite', 'email', 'en', 9, 'S', 'Use any device', encode(sha256(convert_to('Use any device', 'UTF8')), 'hex'))$$, pg_temp.id('L'))), '^23514', 'R5-32: a template with the banned word is refused');
select matches(pg_temp.try($$update public.message_templates set version = 2 where purpose = 'invite'$$), '^42501 TRACE_GUARD: message templates are insert-once', '§3.2: templates are immutable');
select matches(pg_temp.try($$delete from public.message_templates where purpose = 'invite'$$), '^42501 TRACE_GUARD: message templates are insert-once', '§3.2: templates are never deleted');
select pg_temp.api(pg_temp.id('A'));
select is((select language || ':' || (subject_template is not null)::text from private.message_template('reminder', 'email', 'hi')), 'en:true', 'R2-14: a language without a template yet falls back to English');
select matches(pg_temp.try('select * from public.message_templates'), '^42501 permission denied', 'R2-14: trace_api reads templates only through message_template');
select pg_temp.u('owner');
select matches(pg_temp.try('select * from public.message_templates'), '^42501 permission denied', 'R2-14: no authenticated grant on message_templates');
select matches(pg_temp.try($$select * from private.message_template('invite', 'email', 'en')$$), '^42501 permission denied', 'R2-14: staff see previews through the api only');
select pg_temp.op();

-- ===== Planning on insert (R3-1, M2-13, AT-M2-05, AT-M2-06) =====
select pg_temp.dinv('i1', 'ds', 's1', 'c1');
select is(pg_temp.plan('i1'), 'invite:planned,reminder:planned,reminder:planned', 'R3-1: an insert plans the invite now and the drive''s two reminders');
select is((select string_agg(replace(m.idempotency_key, pg_temp.id('i1')::text, 'I'), ',' order by m.scheduled_for) from public.outbound_messages as m where m.invitation_id = pg_temp.id('i1') and m.purpose = 'invite'), 'I:invite:0', 'R3-1: the invite key is invitation:invite:resend_no');
select is((select array_agg(m.scheduled_for order by m.scheduled_for) from public.outbound_messages as m where m.invitation_id = pg_temp.id('i1') and m.purpose = 'reminder'), (select array[s.starts_at - interval '24 hours', s.starts_at - interval '1 hour'] from public.slots as s where s.id = pg_temp.id('s1')), 'AT-M2-05: reminders at T-24 h and T-1 h of the slot');
select is((select count(*)::int from public.outbound_messages as m where m.invitation_id = pg_temp.id('i1') and m.purpose = 'reminder' and m.idempotency_key = m.invitation_id::text || ':reminder:0:' || floor(extract(epoch from m.scheduled_for))::bigint), 2, 'R4-2: reminder keys are invitation:reminder:plan_no:epoch');
select is((select count(*)::int from public.outbound_messages where invitation_id = pg_temp.id('i1') and (claim_id is not null or provider is not null or attempts <> 0 or queued_at is not null)), 0, 'M2-13: planned rows carry no claim, provider or attempt');
select pg_temp.dinv('i3', 'ds', 's3', 'c3');
select is(pg_temp.plan('i3'), 'invite:planned,reminder:planned', 'E8: a reminder that would fall in the past (T-24 h of a slot 2 h away) is skipped');
select pg_temp.dinv('w1', 'dw', null, 'c4');
select is((select array_agg(m.scheduled_for order by m.scheduled_for) from public.outbound_messages as m where m.invitation_id = pg_temp.id('w1') and m.purpose = 'reminder'), (select array[d.deadline_at - interval '24 hours', d.deadline_at - interval '1 hour'] from public.drives as d where d.id = pg_temp.id('dw')), 'M2-13: open-window reminders anchor to the deadline');
update public.drives set reminder_offsets = '{2 hours}' where id = pg_temp.id('dw');
select pg_temp.dinv('w2', 'dw', null, 'c5');
select is((select array_agg(m.scheduled_for) from public.outbound_messages as m where m.invitation_id = pg_temp.id('w2') and m.purpose = 'reminder'), (select array[d.deadline_at - interval '2 hours'] from public.drives as d where d.id = pg_temp.id('dw')), 'AT-M2-06: the plan follows the drive''s offsets');
insert into public.invitations (id, org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at)
  values ('43000000-0000-4000-8000-000000000001', pg_temp.id('A'), pg_temp.id('ta_test'), pg_temp.id('ta'), 'm2-msg-d1@example.test', pg_temp.h('l-d1m'), true, now() + interval '1 day');
select is((select count(*)::int from public.outbound_messages where invitation_id = '43000000-0000-4000-8000-000000000001'), 0, 'R2-16: a D1 row (no drive) plans nothing');

-- ===== Claim and time travel (R2-16, AT-M2-05) =====
select is(pg_temp.claim(now()) >= 1, true, 'AT-M2-05: the claim at now takes the due invites');
select is(pg_temp.plan('i1'), 'invite:queued,reminder:planned,reminder:planned', 'AT-M2-05: nothing but the invite is claimed before T-24 h');
select is(pg_temp.send('i1', 'invite', 'pm-i1-inv'), 'true', 'R2-16: the worker records the send under its claim');
select is((select status::text from public.invitations where id = pg_temp.id('i1')), 'sent', 'R2-16: the drive invitation moves created -> sent');
select is((select status || '|' || provider || '|' || attempts || '|' || (sent_at is not null)::text from public.outbound_messages where id = pg_temp.msg('i1', 'invite')), 'sent|loadsim|1|true', 'R2-16: sent with the provider and its message id, one attempt');
select pg_temp.claim((select starts_at - interval '24 hours 1 minute' from public.slots where id = pg_temp.id('s1')));
select is(pg_temp.plan('i1'), 'invite:sent,reminder:planned,reminder:planned', 'AT-M2-05: a minute before T-24 h nothing more is claimed');
select pg_temp.claim((select starts_at - interval '24 hours' from public.slots where id = pg_temp.id('s1')));
select is(pg_temp.plan('i1'), 'invite:sent,reminder:queued,reminder:planned', 'AT-M2-05: the 24 h reminder is claimed at T-24 h');
select is(pg_temp.send('i1', 'reminder', 'pm-i1-r1'), 'true', 'AT-M2-05: and sent');
select is((select status::text from public.invitations where id = pg_temp.id('i1')), 'sent', 'R3-1: a reminder moves no invitation status');
select pg_temp.claim((select starts_at - interval '1 hour 1 minute' from public.slots where id = pg_temp.id('s1')));
select is(pg_temp.plan('i1'), 'invite:sent,reminder:sent,reminder:planned', 'AT-M2-05: a minute before T-1 h the second reminder waits');
select pg_temp.claim((select starts_at - interval '1 hour' from public.slots where id = pg_temp.id('s1')));
select is(pg_temp.plan('i1'), 'invite:sent,reminder:sent,reminder:queued', 'AT-M2-05: the 1 h reminder is claimed at T-1 h');
select pg_temp.dinv('i2', 'ds', 's2', 'c2');
select is(pg_temp.wclaim(now() + interval '30 days') >= 1, true, 'R2-8: the worker''s claim runs');
select is(pg_temp.plan('i2'), 'invite:queued,reminder:planned,reminder:planned', 'R2-8: p_now from a non-operator is ignored (now() is used)');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from private.claim_due_messages(now(), 10)'), '^42501 permission denied', 'R3-11: trace_api cannot claim');
select pg_temp.u('owner');
select matches(pg_temp.try('select * from private.claim_due_messages(now(), 10)'), '^42501 permission denied', 'R3-11: nor can staff');
select pg_temp.op();
select matches(pg_temp.try('select * from private.claim_due_messages(now(), 0)'), '^22023', 'R5-45: the claim limit is bounded');

-- ===== Reclaim and lease (R2-15, R3-6, R4-7, AT-M2-26) =====
insert into pg_temp.ids select 'i2_claim1', claim_id from public.outbound_messages where id = pg_temp.msg('i2', 'invite');
select pg_temp.claim(now() + interval '16 minutes');
select is((select claim_id <> pg_temp.id('i2_claim1') and status = 'queued' from public.outbound_messages where id = pg_temp.msg('i2', 'invite')), true, 'R2-15, R3-6: a queued row older than 15 minutes is reclaimed with a new claim id');
select is((select reclaimed from pg_temp.claimed where id = pg_temp.msg('i2', 'invite') order by at desc limit 1), true, 'R4-7: the claim reports the reclaim');
select is(pg_temp.send('i2', 'invite', 'pm-i2-old', pg_temp.id('i2_claim1')), 'false', 'AT-M2-26: the old claim cannot record the send');
select is((select status from public.outbound_messages where id = pg_temp.msg('i2', 'invite')), 'queued', 'AT-M2-26: nothing changed');
insert into pg_temp.ids select 'i2_claim2', claim_id from public.outbound_messages where id = pg_temp.msg('i2', 'invite');
select is(pg_temp.send('i2', 'invite', 'pm-i2'), 'true', 'AT-M2-26: the current claim records it');
select is(pg_temp.send('i2', 'invite', 'pm-i2-dup', pg_temp.id('i2_claim2')), 'false', 'E17: a second delivery of the same queue message records nothing');
select is((select provider_message_id || '|' || attempts from public.outbound_messages where id = pg_temp.msg('i2', 'invite')), 'pm-i2|1', 'E17: one provider id, one attempt');

-- ===== Provider events (R2-15, R2-18, R3-5, R4-6, AT-M2-26) =====
select is(pg_temp.ev('pm-i1-inv', 'ev-1', 'delivery', null, null), 'applied', 'R2-18: an event finds its message by the provider id, with no org context');
select is((select status || '|' || (delivered_at is not null)::text from public.outbound_messages where id = pg_temp.msg('i1', 'invite')), 'delivered|true', 'M2-14: delivered');
select is(pg_temp.ev('pm-i1-inv', 'ev-1', 'delivery', null, null), 'duplicate', 'E15: a replayed event is a no-op');
select is((select count(*)::int from public.message_events where provider_event_id = 'ev-1'), 1, 'E15: stored once');
select is(pg_temp.ev('pm-i1-inv', 'ev-2', 'send', null, null), 'applied', 'R2-15: a late send event is stored');
select is((select status from public.outbound_messages where id = pg_temp.msg('i1', 'invite')), 'delivered', 'R2-15: a lower rank never moves the status back');
select is(pg_temp.ev('pm-i1-inv', 'ev-3', 'bounce', 'permanent', null), 'applied', 'R2-15: a bounce after delivery is stored');
select is((select status from public.outbound_messages where id = pg_temp.msg('i1', 'invite')), 'delivered', 'R2-15: an equal rank is ignored');
select is(pg_temp.ev('pm-i1-inv', 'ev-4', 'complaint', null, null), 'applied', 'R2-15: a complaint is stored');
select is((select status from public.outbound_messages where id = pg_temp.msg('i1', 'invite')), 'complained', 'R2-15: a complaint after delivery is accepted');
select is(pg_temp.ev('pm-i1-r1', 'ev-4b', 'bounce', 'transient', null), 'applied', 'R2-15: a transient bounce is stored');
select is((select status from public.outbound_messages where invitation_id = pg_temp.id('i1') and provider_message_id = 'pm-i1-r1'), 'sent', 'R2-15: a transient bounce moves nothing');
select is(pg_temp.ev('pm-early', 'ev-5', 'delivery', null, pg_temp.id('A')), 'unmatched', 'R3-5: an event before the send is kept under its tag org');
select is(pg_temp.ev('pm-untagged', 'ev-6', 'delivery', null, null), 'dropped', 'R4-6: an unknown event without the org tag is dropped');
select is((select count(*)::int from public.message_events_unmatched where provider_message_id = 'pm-early' and org_id = pg_temp.id('A')), 1, 'R3-5: the unmatched row has the org');
select is(pg_temp.send('i3', 'invite', 'pm-early'), 'true', 'R3-5: the send is recorded');
select is((select status from public.outbound_messages where id = pg_temp.msg('i3', 'invite')) || '|' || (select count(*) from public.message_events_unmatched where provider_message_id = 'pm-early') || '|' || (select count(*) from public.message_events where provider_event_id = 'ev-5'), 'delivered|0|1', 'R3-5, AT-M2-26: record_send reconciles the early event and removes it');
select pg_temp.w('trace_messaging_worker', pg_temp.id('B'));
select matches(pg_temp.try($$select private.record_message_event('loadsim', 'ev-7', 'pm-i1-inv', 'delivery', null, now(), null)$$), '^42501 TRACE_GUARD: not the job org', 'R2-18: the worker records events of its job org only');
select pg_temp.w('trace_messaging_worker', pg_temp.id('A'));
select is((select private.record_message_event('loadsim', 'ev-8', 'pm-i2', 'delivery', null, now(), pg_temp.id('A'))), 'applied', 'M2-1: the load-sim adapter''s events go through the same function as the worker');
select pg_temp.api(null);
select matches(pg_temp.try($$select private.record_message_event('loadsim', 'ev-9', 'pm-i2', 'open', null, now(), null)$$), '^22023', 'R2-18: an event kind outside the list is refused');
select matches(pg_temp.try($$select private.record_message_event('loadsim', 'ev-9', 'pm-i2', 'bounce', null, now(), null)$$), '^22023', 'R2-18: a bounce names its kind');
select pg_temp.u('owner');
select matches(pg_temp.try($$select private.record_message_event('loadsim', 'ev-9', 'pm-i2', 'delivery', null, now(), null)$$), '^42501 permission denied', 'R3-11: staff cannot record provider events');
select pg_temp.op();
insert into public.message_events_unmatched (org_id, provider, provider_event_id, provider_message_id, event, occurred_at, received_at)
  values (pg_temp.id('A'), 'loadsim', 'ev-old', 'pm-old', 'delivery', now() - interval '25 hours', now() - interval '25 hours'),
         (pg_temp.id('A'), 'loadsim', 'ev-new', 'pm-new', 'delivery', now(), now());
select pg_temp.w('trace_messaging_worker', null);
select is((select private.purge_unmatched_events()), 1, 'R3-5, R5-45: the purge deletes unmatched events older than 24 h only');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select private.purge_unmatched_events()'), '^42501 permission denied', 'R5-45: only the messaging worker purges');
select pg_temp.op();

-- ===== Failures (AT-M2-24, AT-M2-30 database side) =====
select pg_temp.dinv('i4', 'ds', 's1', 'c6');
select pg_temp.dinv('i5', 'ds', 's1', 'c7');
select pg_temp.claim(now() + interval '20 minutes');
select is(pg_temp.fail('i4', 'invite', 'throttled', false), 'queued', 'AT-M2-30: a transient failure keeps the row queued for the Queue''s retry');
select is((select attempts || '|' || last_error_code from public.outbound_messages where id = pg_temp.msg('i4', 'invite')), '1|throttled', 'AT-M2-30: the attempt and its code are counted');
select is(pg_temp.fail('i4', 'invite', 'bad_recipient', true), 'failed', 'AT-M2-24: a permanent error fails the message');
select is((select count(*)::int from public.audit_log where action = 'message.failed' and object_id = pg_temp.msg('i4', 'invite') and actor_kind = 'system' and details ->> 'error_code' = 'bad_recipient'), 1, 'R2-21, AT-M2-24: the failure is audited as the system with its code');
select is(pg_temp.fail('i4', 'invite', 'throttled', false), 'null', 'R3-6: a failed message holds no claim any more');
select is((select string_agg(x.r, ',' order by x.n) from (select n, pg_temp.fail('i5', 'invite', 'provider_unavailable', false) as r from generate_series(1, 8) as n) as x),'queued,queued,queued,queued,queued,queued,queued,failed', 'AT-M2-30: the 8th failed attempt fails the message');
insert into pg_temp.ids select 'i5_msg', pg_temp.msg('i5', 'invite');
select matches(pg_temp.try(format($$select private.record_send_failure(%L, %L, %L, 'oops', false)$$, pg_temp.id('A'), pg_temp.id('i5_msg'), gen_random_uuid())), '^42501', 'the failure path runs as the messaging worker only');
select pg_temp.w('trace_messaging_worker', pg_temp.id('A'));
select matches(pg_temp.try(format($$select private.record_send_failure(%L, %L, %L, 'oops', false)$$, pg_temp.id('A'), pg_temp.id('i5_msg'), gen_random_uuid())), '^22023', 'error codes come from the list');
select pg_temp.op();

-- ===== Slot moves, revoke, resend and drive cancel (R3-1, R4-2, §4, E9, E24) =====
select pg_temp.dinv('i6', 'ds', 's1', 'c8');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$select public.reschedule_invitation(%L, %L)$$, pg_temp.id('i6'), pg_temp.id('s2'))), 'OK 1', 'E9: the recruiter moves the invitation to s2');
select pg_temp.op();
select is(pg_temp.plan('i6'), 'invite:planned,reschedule:planned,reminder:cancelled,reminder:cancelled,reminder:planned,reminder:planned', 'E9, R3-1: the old reminders are cancelled, new ones planned, one reschedule message');
select is((select count(*)::int from public.outbound_messages as m join public.reschedule_events as e on m.idempotency_key = m.invitation_id::text || ':reschedule:' || e.id::text where m.invitation_id = pg_temp.id('i6')), 1, 'R3-1: the reschedule key names the reschedule event');
select is((select count(*)::int from public.outbound_messages where invitation_id = pg_temp.id('i6') and status = 'planned' and idempotency_key like '%:reminder:1:%'), 2, 'R4-2: the new reminders carry plan_no 1');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$select public.reschedule_invitation(%L, %L)$$, pg_temp.id('i6'), pg_temp.id('s1'))), 'OK 1', 'R4-2: and back to s1');
select pg_temp.op();
select is((select count(*) filter (where purpose = 'reminder' and status = 'planned' and idempotency_key like '%:reminder:2:%') || '|' || count(*) filter (where purpose = 'reminder' and status = 'cancelled') || '|' || count(*) filter (where purpose = 'reschedule') from public.outbound_messages where invitation_id = pg_temp.id('i6')), '2|4|2', 'AT-M2-05, R4-2: A -> B -> A plans fresh reminders; none is lost to an old key');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.invitations set status = 'revoked' where id = %L$$, pg_temp.id('i6'))), 'OK 1', '§4: the recruiter revokes i6');
select pg_temp.op();
select is((select count(*)::int from public.outbound_messages where invitation_id = pg_temp.id('i6') and status = 'planned'), 0, 'R3-1: a revoke cancels every planned message');
select pg_temp.dinv('i7', 'ds', 's1', 'c9');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.invitations set invite_resend_no = 1 where id = %L$$, pg_temp.id('i7'))), 'OK 1', 'R2-4: "Resend invite" bumps the counter');
select pg_temp.op();
select is((select string_agg(replace(idempotency_key, pg_temp.id('i7')::text, 'I'), ',' order by idempotency_key) from public.outbound_messages where invitation_id = pg_temp.id('i7') and purpose = 'invite'), 'I:invite:0,I:invite:1', 'R3-1: the resend plans a new invite under the new key');
select pg_temp.dinv('x1', 'dx', 'x1s', 'c10');
select pg_temp.u('recruiter');
select is(pg_temp.try(format($$update public.drives set status = 'cancelled' where id = %L$$, pg_temp.id('dx'))), 'OK 1', '§4: the recruiter cancels drive dx');
select pg_temp.op();
select is((select (select status::text from public.invitations where id = pg_temp.id('x1')) || '|' || pg_temp.plan('x1')), 'created|invite:cancelled,reminder:cancelled,reminder:cancelled', 'E24: a cancelled drive cancels its planned messages; the invitation stays as it is');

-- ===== Guard (I-M2-6) =====
select matches(pg_temp.try(format($$update public.outbound_messages set status = 'queued' where id = %L$$, pg_temp.msg('i1', 'invite'))), '^42501 TRACE_GUARD: message status moves forward only', 'I-M2-6: status moves forward only, even for the owner');
select matches(pg_temp.try(format($$update public.outbound_messages set status = 'cancelled' where id = %L$$, pg_temp.msg('i2', 'invite'))), '^42501 TRACE_GUARD: only a planned message is cancelled', '§4: only a planned message is cancelled');
select matches(pg_temp.try(format($$update public.outbound_messages set idempotency_key = idempotency_key || 'x' where id = %L$$, pg_temp.msg('i1', 'invite'))), '^42501 TRACE_GUARD: an outbound message keeps its identity', 'I-M2-6: the key is immutable');
select matches(pg_temp.try(format($$delete from public.outbound_messages where id = %L$$, pg_temp.msg('i1', 'invite'))), '^42501 TRACE_GUARD: outbound messages are never deleted', 'I-M2-6: never deleted');
select matches(pg_temp.try($$update public.message_events set event = 'send' where provider_event_id = 'ev-1'$$), '^P0001 TRACE_APPEND_ONLY', 'I-M2-7: message events are append-only');
select matches(pg_temp.try($$delete from public.message_events where provider_event_id = 'ev-1'$$), '^P0001 TRACE_APPEND_ONLY', 'I-M2-7: and never deleted');
select is((select workspace_id from public.message_events where provider_event_id = 'ev-1'), pg_temp.id('A1'), 'R5-4: the event''s workspace is copied from its message');

-- ===== Reads (§3.4, R2-11, AT-M2-19) =====
select pg_temp.u('owner');
select is((select count(*) > 0 from public.outbound_messages) and (select count(*) > 0 from public.message_events), true, 'S owner: the org''s messages and events');
select pg_temp.u('recruiter');
select is((select count(*) > 0 from public.outbound_messages), true, 'S recruiter: the workspace''s messages');
select matches(pg_temp.try(format($$insert into public.outbound_messages (org_id, workspace_id, drive_id, invitation_id, template_id, channel, purpose, idempotency_key, scheduled_for) select org_id, workspace_id, drive_id, invitation_id, template_id, channel, purpose, invitation_id || ':invite:9', now() from public.outbound_messages where id = %L$$, pg_temp.msg('i1', 'invite'))), '^42501 permission denied', 'I recruiter: messages are planned by the trigger only');
select matches(pg_temp.try($$update public.outbound_messages set attempts = 0$$), '^42501 permission denied', 'U recruiter: no update grant');
select pg_temp.u('ws_recruiter');
select is((select count(*)::int from public.outbound_messages) + (select count(*)::int from public.message_events), 0, 'S ws_recruiter: nothing outside its workspace');
select pg_temp.u('reviewer');
select is((select count(*)::int from public.outbound_messages) + (select count(*)::int from public.message_events), 0, 'R2-11: an assigned reviewer reads no message');
select pg_temp.u('hm');
select is((select count(*)::int from public.outbound_messages), 0, 'S hiring manager: nothing');
select pg_temp.u('b_admin');
select is((select count(*)::int from public.outbound_messages) + (select count(*)::int from public.message_events), 0, 'S org B admin: nothing of org A');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try('select * from public.outbound_messages'), '^42501 permission denied', 'S api: no grant on outbound_messages');
select pg_temp.w('trace_messaging_worker', pg_temp.id('A'));
select matches(pg_temp.try('select * from public.outbound_messages'), '^42501 permission denied', 'lead decision (a): the worker reads messages only through its functions');
select matches(pg_temp.try('select email_ct from public.candidate_contacts'), '^42501 permission denied', 'M2-20: the worker has no direct read of contacts');
select pg_temp.op();
select is((select count(*)::int from unnest(array['authenticated', 'trace_api', 'trace_messaging_worker', 'trace_worker', 'trace_candidate', 'anon', 'service_role']) as r cross join unnest(array['public.message_events_unmatched', 'public.message_templates']) as t where has_table_privilege(r, t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege(r, t, 'SELECT, INSERT, UPDATE, REFERENCES')), 0, 'R5-14, R5-45, R2-14: no role holds anything on message_events_unmatched or message_templates');
select is((select count(*)::int from pg_catalog.pg_attribute where attrelid in ('public.outbound_messages'::regclass, 'public.message_events'::regclass, 'public.message_events_unmatched'::regclass) and attnum > 0 and not attisdropped and attname ~ '(body|subject|recipient|otp|token|email|phone|name|address|payload|diagnostic)'), 0, 'M2-14, AT-M2-19: no column holds a body, subject, recipient, OTP, token or provider payload');
select is((select count(*)::int from public.audit_log where action = 'message.sent' and actor_kind = 'system' and pg_temp.keys(details) = 'invitation_id,old_status,purpose'), 4, 'R2-21: each recorded send is audited as the system with ids and statuses only');

-- ===== The worker's send context (lead decision a) =====
select pg_temp.op();
insert into pg_temp.ids select 'i3_rem', id from public.outbound_messages where invitation_id = pg_temp.id('i3') and purpose = 'reminder';
insert into pg_temp.ids select 'i3_rem_claim', claim_id from public.outbound_messages where invitation_id = pg_temp.id('i3') and purpose = 'reminder';
select pg_temp.w('trace_messaging_worker', pg_temp.id('A'));
select is((select (email_ct = pg_temp.ct('e-c3') and full_name_ct = pg_temp.ct('n-c3') and test_name = 'Test ta' and duration_seconds = 1800 and purpose = 'reminder' and invitation_status = 'sent' and drive_mode = 'scheduled')::text from private.message_send_context(pg_temp.id('A'), pg_temp.id('i3_rem'), pg_temp.id('i3_rem_claim'))), 'true', 'lead decision (a): the claimed message''s render facts and recipient ciphertext');
select is((select count(*)::int from private.message_send_context(pg_temp.id('A'), pg_temp.id('i3_rem'), gen_random_uuid())), 0, 'R3-6: nothing without the current claim');
select pg_temp.w('trace_messaging_worker', pg_temp.id('B'));
select matches(pg_temp.try(format($$select * from private.message_send_context(%L, %L, %L)$$, pg_temp.id('A'), pg_temp.id('i3_rem'), pg_temp.id('i3_rem_claim'))), '^42501 TRACE_GUARD: not the job org', 'R5-9: bound to the job org');
select pg_temp.api(pg_temp.id('A'));
select matches(pg_temp.try(format($$select * from private.message_send_context(%L, %L, %L)$$, pg_temp.id('A'), pg_temp.id('i3_rem'), pg_temp.id('i3_rem_claim'))), '^42501 permission denied', 'only the messaging worker may read a send context');

-- ===== Drive invitation list (R4-5, R5-7, R5-44, R5-52 a; AT-M2-02, AT-M2-29) =====
select pg_temp.api(pg_temp.id('A'));
select is(pg_temp.di('owner', 'aal2', array['otp', 'totp']), 7, 'AT-M2-02: an owner at aal2 lists the drive''s seven invitations');
select is(pg_temp.di('recruiter', 'aal1', array['otp']), 7, 'R5-7: a recruiter-only member at aal1 after an email OTP counts');
select is(pg_temp.di('owner', 'aal1', array['otp']), 0, 'R5-7: an owner without MFA does not');
select is(pg_temp.di('ws_recruiter', 'aal1', array['otp']), 0, 'R4-5: a recruiter fenced to another workspace gets nothing');
select is(pg_temp.di('reviewer', 'aal2', array['otp', 'totp']), 0, 'R2-11: an assigned reviewer gets nothing');
select is(pg_temp.di('b_admin', 'aal2', array['otp', 'totp']), 0, 'R4-5: a member of another org gets nothing');
select is((select invite_status || '|' || coalesce(reminder_status, 'none') || '|' || coalesce(reschedule_status, 'none') || '|' || (full_name_ct = pg_temp.ct('n-c1'))::text || '|' || email_hint from private.drive_invitations(pg_temp.id('owner'), 'aal2', array['otp', 'totp'], pg_temp.id('ds'), null, null, 200) where invitation_id = pg_temp.id('i1')), 'complained|queued|none|true|c•••@example.test', 'AT-M2-02: the latest delivery status per purpose, the name ciphertext and the hint');
select is((select array_agg(x.invitation_id order by x.created_at, x.invitation_id) from (select * from private.drive_invitations(pg_temp.id('owner'), 'aal2', array['otp', 'totp'], pg_temp.id('ds'), null, null, 3) union all select * from private.drive_invitations(pg_temp.id('owner'), 'aal2', array['otp', 'totp'], pg_temp.id('ds'), (select max(created_at) from private.drive_invitations(pg_temp.id('owner'), 'aal2', array['otp', 'totp'], pg_temp.id('ds'), null, null, 3)), (select invitation_id from private.drive_invitations(pg_temp.id('owner'), 'aal2', array['otp', 'totp'], pg_temp.id('ds'), null, null, 3) order by created_at desc, invitation_id desc limit 1), 200)) as x), (select array_agg(invitation_id order by created_at, invitation_id) from private.drive_invitations(pg_temp.id('owner'), 'aal2', array['otp', 'totp'], pg_temp.id('ds'), null, null, 200)), 'AT-M2-29: a keyset page on (created_at, id) returns every row once across pages');
select matches(pg_temp.try(format($$select * from private.drive_invitations(%L, 'aal2', array['otp', 'totp'], %L, now(), null, 10)$$, pg_temp.id('owner'), pg_temp.id('ds'))), '^22023', 'R5-44: the cursor has both parts');
select matches(pg_temp.try(format($$select * from private.drive_invitations(%L, 'aal2', array['otp', 'totp'], %L, null, null, 500)$$, pg_temp.id('owner'), pg_temp.id('ds'))), '^22023', 'R5-31: a page holds at most 200 rows');
select pg_temp.api(pg_temp.id('B'));
select is(pg_temp.di('owner', 'aal2', array['otp', 'totp']), 0, 'R4-5: bound to the api org');
select pg_temp.op();
select is((select count(*)::int from unnest(array['authenticated', 'trace_messaging_worker', 'trace_worker', 'trace_candidate', 'anon', 'service_role']) as r where has_function_privilege(r, 'private.drive_invitations(uuid, text, text[], uuid, timestamptz, uuid, int)', 'EXECUTE')), 0, 'R4-5: only trace_api executes drive_invitations');
select is((select relrowsecurity::text from pg_catalog.pg_class where oid = 'public.outbound_messages'::regclass) || (select relrowsecurity::text from pg_catalog.pg_class where oid = 'public.message_events'::regclass) || (select relrowsecurity::text from pg_catalog.pg_class where oid = 'public.message_events_unmatched'::regclass) || (select relrowsecurity::text from pg_catalog.pg_class where oid = 'public.message_templates'::regclass), 'truetruetruetrue', 'RLS: enabled on every M2-c table');
