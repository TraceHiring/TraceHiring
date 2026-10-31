-- M2 migration M2-c (spec specs/m2-scheduling-invites.md revision 5 §3.1 row M2-c, §3.2 message_templates,
-- outbound_messages, message_events, message_events_unmatched, §3.3, §3.4, §3.5 I-M2-6, I-M2-7, §4 Outbound message,
-- §6.3; binding rows R2-4, R2-11, R2-14, R2-15, R2-16, R2-18, R2-21, R3-1, R3-5, R3-6, R3-11, R3-12, R4-2, R4-5, R4-6,
-- R4-7, R5-3, R5-4, R5-6, R5-7, R5-14, R5-32, R5-45, R5-49, R5-50, R5-51, R5-52 a).
-- Provisional timestamp (R5-3): re-timestamped after the newest M1 file before M2 CLOSE.
--
-- No message body, subject, recipient, OTP or link token is ever stored (M2-14): the consumer renders at send time from
-- the ciphertext it decrypts in memory. Error contract as D1/M1: guard refusal 42501 'TRACE_GUARD: <reason>'; bad input
-- 22023 'TRACE_BAD_INPUT: <reason>'.
--
-- Lead decisions (AUTOPILOT §4, HOW-level; recorded in docs/build-notes.md "Autopilot changes" 2026-10-30):
-- (a) The messaging worker reads and writes nothing directly except its org's keys (M2-a). Everything it needs for one
--     claimed message comes from private.message_send_context(p_org, p_message, p_claim) (DEFINER), which returns the
--     render facts and the recipient ciphertext only while that claim holds; its failures go through
--     private.record_send_failure. This is narrower than §3.4's policy-based ciphertext SELECT for claimed rows and keeps
--     rls_roles' "writes no table directly" (R5-42).
-- (b) rotate_link_for_send and record_send take the claim id (R3-6 wins over §3.3's shorter signature).
-- (c) claim_due_messages also returns `reclaimed` (R4-7's counter) and never claims a row that used its 8 attempts.
-- (d) plan_messages also fires on invite_resend_no ("Resend invite", R2-4, R3-1's `${invitation_id}:invite:${resend_no}`
--     key); it still never fires on token_version or link_token_hash (R3-1).
-- (e) A cancelled drive cancels its planned messages (§4); closing plans and cancels nothing (R5-6).
-- (f) message_events_unmatched keeps the bounce kind, so a reconciled bounce is applied exactly as a matched one.

-- ---------------------------------------------------------------------------------------------
-- message_templates (R2-14, R5-32): library org, migration only, immutable. No app-role grant: the worker and the api read
-- through private.message_template.
-- ---------------------------------------------------------------------------------------------
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  purpose text not null check (purpose in ('invite', 'reminder', 'reschedule', 'otp')),
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  language text not null check (language in ('en', 'hi')),
  version int not null check (version >= 1),
  subject_template text null check (subject_template is null or char_length(subject_template) between 1 and 200),
  body_template text not null check (char_length(body_template) between 1 and 5000),
  provider_template_ref text null check (provider_template_ref is null or char_length(provider_template_ref) <= 128),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (org_id, purpose, channel, language, version),
  check ((channel = 'email') = (subject_template is not null)),
  -- Only the variables of §3.2 (R5-32): any other {{...}} is refused.
  check (body_template !~ '\{\{(?!(candidate_first_name|org_name|test_name|starts_at_ist|deadline_ist|duration_minutes|invite_url|otp|equipment_note)\}\})'),
  check (coalesce(subject_template, '') !~ '\{\{(?!(candidate_first_name|org_name|test_name|starts_at_ist|deadline_ist|duration_minutes)\}\})'),
  -- R5-32: the recruiter's template preview never shows the word the recruiter guards ban.
  check (body_template !~* '\mdevices?\M' and coalesce(subject_template, '') !~* '\mdevices?\M'),
  check (body_sha256 = encode(sha256(convert_to(body_template, 'UTF8')), 'hex'))
);
alter table public.message_templates enable row level security;
create trigger message_templates_insert_once before update or delete on public.message_templates
  for each row execute function private.m2_insert_once();
alter table public.message_templates enable always trigger message_templates_insert_once;

-- The seed (§3.2, plan §3.2 step 1, R2-4): EN email. The invite says the date, the duration, the equipment and what is
-- recorded (rule 8's allow-list, in plain words); reminders carry no link (Q-M2-2 default); only the latest link works
-- (R3-6). The practice-test link arrives with M3b.
insert into public.message_templates (org_id, purpose, channel, language, version, subject_template, body_template,
    body_sha256)
select o.id, t.purpose, 'email', 'en', 1, t.subject, t.body, encode(sha256(convert_to(t.body, 'UTF8')), 'hex')
from public.orgs as o
cross join (values
  ('invite', 'Your {{test_name}} test from {{org_name}}',
   E'Hello {{candidate_first_name}},\n\n{{org_name}} has invited you to take the {{test_name}} test.\n\nWhen: {{starts_at_ist}}\nLast time to finish: {{deadline_ist}}\nDuration: {{duration_minutes}} minutes\nYou need: {{equipment_note}}, and a steady internet connection.\n\nWhat is recorded: your answers, a photo when you start, and still pictures from your camera at times during the test. If a question asks for a spoken or video answer, that answer is recorded. Nothing else from your camera or microphone leaves your computer. You will see the same report the recruiter sees.\n\nOpen your test here (this link replaces any earlier link for this test):\n{{invite_url}}\n\nYou will get a one-time code by email when you open the link.'),
  ('reminder', 'Reminder: your {{test_name}} test from {{org_name}}',
   E'Hello {{candidate_first_name}},\n\nThis is a reminder of your {{test_name}} test from {{org_name}}.\n\nWhen: {{starts_at_ist}}\nLast time to finish: {{deadline_ist}}\nDuration: {{duration_minutes}} minutes\nYou need: {{equipment_note}}, and a steady internet connection.\n\nUse the link in your invitation email, or ask the recruiter to resend it.'),
  ('reschedule', 'New time for your {{test_name}} test from {{org_name}}',
   E'Hello {{candidate_first_name}},\n\nYour {{test_name}} test from {{org_name}} has a new time.\n\nWhen: {{starts_at_ist}}\nLast time to finish: {{deadline_ist}}\nDuration: {{duration_minutes}} minutes\nYou need: {{equipment_note}}, and a steady internet connection.\n\nOpen your test here (this link replaces any earlier link for this test):\n{{invite_url}}'),
  ('otp', 'Your code for the {{test_name}} test',
   E'Your one-time code is {{otp}}.\n\nIt works for 10 minutes. If you did not ask for it, you can ignore this email.')
) as t(purpose, subject, body)
where o.kind = 'trace_library';

-- message_template (R2-14, §3.3): the newest version for the purpose, channel and language; English when the language has
-- none yet (Hindi templates come with M3b, §1.4).
create function private.message_template(p_purpose text, p_channel text, p_language text)
returns table (id uuid, version int, language text, subject_template text, body_template text, body_sha256 text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.version, t.language, t.subject_template, t.body_template, t.body_sha256
  from public.message_templates as t
  join public.orgs as o on o.id = t.org_id and o.kind = 'trace_library'
  where t.purpose = p_purpose and t.channel = p_channel and t.language in (p_language, 'en')
  order by (t.language = p_language) desc, t.version desc
  limit 1
$$;
revoke execute on function private.message_template(text, text, text) from public, anon, authenticated, service_role;
grant execute on function private.message_template(text, text, text) to trace_api, trace_messaging_worker;

-- ---------------------------------------------------------------------------------------------
-- outbound_messages (M2-13, M2-14, R2-16, R3-1, R3-6, R5-4, R5-49, R5-50). Written only by DEFINER code: the planner
-- trigger, the claim, record_send, record_send_failure and record_message_event. Staff read it (reviewers ✗, R2-11).
-- ---------------------------------------------------------------------------------------------
create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  drive_id uuid not null,
  invitation_id uuid not null,
  template_id uuid not null references public.message_templates (id) on delete restrict,
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  purpose text not null check (purpose in ('invite', 'reminder', 'reschedule')),
  idempotency_key text not null check (idempotency_key ~ '^[0-9a-f-]{36}:(invite:[0-9]{1,5}|reminder:[0-9]{1,9}:[0-9]{1,12}|reschedule:[0-9a-f-]{36})$'),
  claim_id uuid null,
  scheduled_for timestamptz not null,
  status text not null default 'planned'
    check (status in ('planned', 'queued', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'cancelled')),
  provider text null check (provider is null or provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  provider_message_id text null check (provider_message_id is null or provider_message_id ~ '^[!-~]{1,255}$'),
  attempts smallint not null default 0 check (attempts between 0 and 8),
  last_error_code text null check (last_error_code is null or last_error_code in ('bad_recipient', 'provider_rejected',
    'provider_unavailable', 'throttled', 'render_failed', 'crypto_unavailable', 'invitation_closed', 'timeout', 'unknown')),
  queued_at timestamptz null,
  sent_at timestamptz null,
  delivered_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, idempotency_key),
  unique (provider, provider_message_id),
  foreign key (org_id, invitation_id, workspace_id) references public.invitations (org_id, id, workspace_id)
    on delete restrict,
  foreign key (org_id, drive_id, workspace_id) references public.drives (org_id, id, workspace_id) on delete restrict,
  check ((provider is null) = (provider_message_id is null)),
  check ((status = 'planned') = (claim_id is null and queued_at is null) or status = 'cancelled'),
  check (status not in ('sent', 'delivered', 'bounced', 'complained') or provider_message_id is not null)
);
create index outbound_messages_invitation_idx on public.outbound_messages (org_id, invitation_id, purpose, created_at);
create index outbound_messages_drive_idx on public.outbound_messages (org_id, drive_id, workspace_id);
create index outbound_messages_due_idx on public.outbound_messages (scheduled_for) where status in ('planned', 'queued');
alter table public.outbound_messages enable row level security;

-- Status rank (R2-15): planned 0 < queued 1 < sent 2 < delivered = bounced = failed 3 < complained 4.
create function private.message_status_rank(p_status text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_status when 'planned' then 0 when 'queued' then 1 when 'sent' then 2 when 'delivered' then 3
    when 'bounced' then 3 when 'failed' then 3 when 'complained' then 4 end
$$;
revoke execute on function private.message_status_rank(text) from public, anon, authenticated, service_role;

-- Guard (I-M2-6): identity frozen; status forward only by rank; cancelled only from planned; a reclaim keeps queued.
create function private.outbound_messages_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'TRACE_GUARD: outbound messages are never deleted' using errcode = '42501';
  end if;
  if (new.id, new.org_id, new.workspace_id, new.drive_id, new.invitation_id, new.template_id, new.channel, new.purpose,
      new.idempotency_key, new.scheduled_for, new.created_at)
    is distinct from (old.id, old.org_id, old.workspace_id, old.drive_id, old.invitation_id, old.template_id, old.channel,
      old.purpose, old.idempotency_key, old.scheduled_for, old.created_at) then
    raise exception 'TRACE_GUARD: an outbound message keeps its identity' using errcode = '42501';
  end if;
  if old.provider_message_id is not null and new.provider_message_id is distinct from old.provider_message_id then
    raise exception 'TRACE_GUARD: the provider message id is set once' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if old.status = 'cancelled' or (new.status = 'cancelled' and old.status <> 'planned') then
      raise exception 'TRACE_GUARD: only a planned message is cancelled' using errcode = '42501';
    end if;
    if new.status <> 'cancelled'
      and private.message_status_rank(new.status) <= private.message_status_rank(old.status) then
      raise exception 'TRACE_GUARD: message status moves forward only' using errcode = '42501';
    end if;
  end if;
  if new.attempts < old.attempts then
    raise exception 'TRACE_GUARD: attempts only grow' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.outbound_messages_guard() from public, anon, authenticated, service_role;

-- R2-21: every status change the worker or the webhook makes is audited as the system (ids and statuses only).
create function private.outbound_messages_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
    and current_setting('role') in ('trace_messaging_worker', 'trace_api') then
    perform private.audit(new.org_id, 'message.' || new.status, 'outbound_messages', new.id,
      jsonb_build_object('invitation_id', new.invitation_id, 'purpose', new.purpose, 'old_status', old.status)
        || case when new.last_error_code is not null then jsonb_build_object('error_code', new.last_error_code)
                else '{}'::jsonb end,
      new.workspace_id, 'system');
  end if;
  return null;
end
$$;
revoke execute on function private.outbound_messages_audit() from public, anon, authenticated, service_role;

create trigger outbound_messages_guard before update or delete on public.outbound_messages
  for each row execute function private.outbound_messages_guard();
create trigger outbound_messages_audit after update of status on public.outbound_messages
  for each row execute function private.outbound_messages_audit();
alter table public.outbound_messages enable always trigger outbound_messages_guard;
alter table public.outbound_messages enable always trigger outbound_messages_audit;

grant select on public.outbound_messages to authenticated;
create policy outbound_messages_select_staff on public.outbound_messages for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));

-- ---------------------------------------------------------------------------------------------
-- message_events (append-only, I-M2-7; R5-4: workspace_id copied by trigger) and message_events_unmatched (worker-only,
-- purged after 24 h; R3-5, R4-6, R5-14, R5-45: no grant at all).
-- ---------------------------------------------------------------------------------------------
create table public.message_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  outbound_message_id uuid not null,
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  provider_event_id text not null check (provider_event_id ~ '^[!-~]{1,255}$'),
  event text not null check (event in ('send', 'delivery', 'bounce', 'complaint', 'reject', 'delivery_delay')),
  bounce_kind text null check (bounce_kind is null or bounce_kind in ('permanent', 'transient', 'undetermined')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id),
  foreign key (org_id, outbound_message_id) references public.outbound_messages (org_id, id) on delete restrict,
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  check ((event = 'bounce') = (bounce_kind is not null))
);
create index message_events_message_idx on public.message_events (org_id, outbound_message_id);
create index message_events_workspace_idx on public.message_events (org_id, workspace_id);
alter table public.message_events enable row level security;

create function private.message_events_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select m.workspace_id into new.workspace_id
  from public.outbound_messages as m where m.org_id = new.org_id and m.id = new.outbound_message_id;
  new.received_at := now();
  return new;
end
$$;
revoke execute on function private.message_events_label() from public, anon, authenticated, service_role;

create function private.message_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'TRACE_APPEND_ONLY' using errcode = 'P0001';
end
$$;
revoke execute on function private.message_events_append_only() from public, anon, authenticated, service_role;
create trigger message_events_label before insert on public.message_events
  for each row execute function private.message_events_label();
create trigger message_events_append_only before update or delete on public.message_events
  for each row execute function private.message_events_append_only();
create trigger message_events_no_truncate before truncate on public.message_events
  for each statement execute function private.message_events_append_only();
alter table public.message_events enable always trigger message_events_label;
alter table public.message_events enable always trigger message_events_append_only;
alter table public.message_events enable always trigger message_events_no_truncate;
grant select on public.message_events to authenticated;
create policy message_events_select_staff on public.message_events for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));

create table public.message_events_unmatched (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  provider_event_id text not null check (provider_event_id ~ '^[!-~]{1,255}$'),
  provider_message_id text not null check (provider_message_id ~ '^[!-~]{1,255}$'),
  event text not null check (event in ('send', 'delivery', 'bounce', 'complaint', 'reject', 'delivery_delay')),
  bounce_kind text null check (bounce_kind is null or bounce_kind in ('permanent', 'transient', 'undetermined')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id),
  check ((event = 'bounce') = (bounce_kind is not null))
);
create index message_events_unmatched_lookup_idx on public.message_events_unmatched (org_id, provider, provider_message_id);
create index message_events_unmatched_received_idx on public.message_events_unmatched (received_at);
alter table public.message_events_unmatched enable row level security;

-- ---------------------------------------------------------------------------------------------
-- The planner (R3-1, R4-2, M2-13; lead decisions d and e). AFTER INSERT and AFTER UPDATE OF slot_id, status,
-- invite_resend_no on invitations; a no-op for D1 rows (drive_id null, R2-16). Keys:
--   invite      `${invitation_id}:invite:${invite_resend_no}`
--   reminder    `${invitation_id}:reminder:${plan_no}:${scheduled_for epoch}`
--   reschedule  `${invitation_id}:reschedule:${reschedule_event_id}`
-- A reminder that would fall in the past is skipped (E8). Open-window reminders anchor to the deadline.
-- ---------------------------------------------------------------------------------------------
create function private.plan_reminders(p_inv public.invitations)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anchor timestamptz;
  v_offsets interval[];
begin
  select d.reminder_offsets, case when d.mode = 'scheduled' then s.starts_at else d.deadline_at end
    into v_offsets, v_anchor
  from public.drives as d
  left join public.slots as s on s.org_id = p_inv.org_id and s.id = p_inv.slot_id
  where d.org_id = p_inv.org_id and d.id = p_inv.drive_id;
  insert into public.outbound_messages (org_id, workspace_id, drive_id, invitation_id, template_id, channel, purpose,
      idempotency_key, scheduled_for)
  select p_inv.org_id, p_inv.workspace_id, p_inv.drive_id, p_inv.id,
    (select t.id from private.message_template('reminder', 'email', p_inv.language) as t), 'email', 'reminder',
    p_inv.id::text || ':reminder:' || p_inv.plan_no || ':' || floor(extract(epoch from v_anchor - o.o))::bigint,
    v_anchor - o.o
  from unnest(v_offsets) as o(o)
  where v_anchor - o.o > now()
  on conflict (org_id, idempotency_key) do nothing;
end
$$;
revoke execute on function private.plan_reminders(public.invitations) from public, anon, authenticated, service_role;

create function private.plan_one(p_inv public.invitations, p_purpose text, p_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.outbound_messages (org_id, workspace_id, drive_id, invitation_id, template_id, channel, purpose,
      idempotency_key, scheduled_for)
  values (p_inv.org_id, p_inv.workspace_id, p_inv.drive_id, p_inv.id,
    (select t.id from private.message_template(p_purpose, 'email', p_inv.language) as t), 'email', p_purpose,
    p_inv.id::text || ':' || p_purpose || ':' || p_key, now())
  on conflict (org_id, idempotency_key) do nothing
$$;
revoke execute on function private.plan_one(public.invitations, text, text) from public, anon, authenticated, service_role;

create function private.plan_messages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
begin
  if new.drive_id is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'created' then
      perform private.plan_one(new, 'invite', new.invite_resend_no::text);
      perform private.plan_reminders(new);
    end if;
    return null;
  end if;
  if new.status in ('revoked', 'expired', 'blocked_age') then
    if old.status is distinct from new.status then
      update public.outbound_messages as m set status = 'cancelled'
      where m.org_id = new.org_id and m.invitation_id = new.id and m.status = 'planned';
    end if;
    return null;
  end if;
  if new.slot_id is distinct from old.slot_id then
    update public.outbound_messages as m set status = 'cancelled'
    where m.org_id = new.org_id and m.invitation_id = new.id and m.purpose = 'reminder' and m.status = 'planned';
    perform private.plan_reminders(new);
    -- The reschedule event of this move (written by the invitations_reschedule_event trigger, which fires first:
    -- triggers of one event fire in name order). R3-12: one event per move.
    select e.id into v_event from public.reschedule_events as e
    where e.org_id = new.org_id and e.invitation_id = new.id and e.from_slot_id = old.slot_id
      and e.to_slot_id = new.slot_id
    order by e.occurred_at desc, e.id desc limit 1;
    if v_event is not null then
      perform private.plan_one(new, 'reschedule', v_event::text);
    end if;
  end if;
  if new.invite_resend_no is distinct from old.invite_resend_no then
    perform private.plan_one(new, 'invite', new.invite_resend_no::text);
  end if;
  return null;
end
$$;
revoke execute on function private.plan_messages() from public, anon, authenticated, service_role;
-- The name sorts after invitations_reschedule_event, so the event row exists when the planner runs.
create trigger invitations_schedule_messages after insert or update of slot_id, status, invite_resend_no
  on public.invitations for each row execute function private.plan_messages();
alter table public.invitations enable always trigger invitations_schedule_messages;

-- Lead decision (e): a cancelled drive cancels its planned messages; invitations stay as they are (R5-13, E24).
create function private.drives_cancel_messages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.outbound_messages as m set status = 'cancelled'
    where m.org_id = new.org_id and m.drive_id = new.id and m.status = 'planned';
  end if;
  return null;
end
$$;
revoke execute on function private.drives_cancel_messages() from public, anon, authenticated, service_role;
create trigger drives_cancel_messages after update of status on public.drives
  for each row execute function private.drives_cancel_messages();

-- ---------------------------------------------------------------------------------------------
-- Cross-org worker functions (R5-45; the private.fail_stranded_ai_draft_jobs pattern): the messaging_claim stage calls
-- them with no job org. p_now is honoured only on the operator path (time-travel tests, R2-8).
-- ---------------------------------------------------------------------------------------------
create function private.claim_due_messages(p_now timestamptz, p_limit int)
returns table (org_id uuid, id uuid, claim_id uuid, reclaimed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := case when private.is_operator() then coalesce(p_now, now()) else now() end;
begin
  if current_setting('role') is distinct from 'trace_messaging_worker' and not private.is_operator() then
    raise exception 'TRACE_GUARD: the claim runs as the messaging worker' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'TRACE_BAD_INPUT: the claim limit is 1 to 1000' using errcode = '22023';
  end if;
  return query
  with due as (
    select m.org_id, m.id, m.status
    from public.outbound_messages as m
    where ((m.status = 'planned' and m.scheduled_for <= v_now)
           or (m.status = 'queued' and m.queued_at < v_now - interval '15 minutes'))
      and m.attempts < 8
    order by m.scheduled_for, m.id
    limit p_limit
    for update skip locked
  )
  update public.outbound_messages as m
  set status = 'queued', queued_at = v_now, claim_id = gen_random_uuid()
  from due
  where m.org_id = due.org_id and m.id = due.id
  returning m.org_id, m.id, m.claim_id, due.status = 'queued';
end
$$;
revoke execute on function private.claim_due_messages(timestamptz, int) from public, anon, authenticated, service_role;
grant execute on function private.claim_due_messages(timestamptz, int) to trace_messaging_worker;

-- close_due_drives (R5-6, R5-51): scheduled -> closed once the drive end has passed; touches no invitation or message.
create function private.close_due_drives(p_now timestamptz)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := case when private.is_operator() then coalesce(p_now, now()) else now() end;
  v_n int;
begin
  if current_setting('role') is distinct from 'trace_messaging_worker' and not private.is_operator() then
    raise exception 'TRACE_GUARD: the drive close runs as the messaging worker' using errcode = '42501';
  end if;
  update public.drives as d set status = 'closed'
  where d.status = 'scheduled' and private.drive_end(d.org_id, d.id) < v_now;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke execute on function private.close_due_drives(timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.close_due_drives(timestamptz) to trace_messaging_worker;

create function private.purge_unmatched_events()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if current_setting('role') is distinct from 'trace_messaging_worker' and not private.is_operator() then
    raise exception 'TRACE_GUARD: the purge runs as the messaging worker' using errcode = '42501';
  end if;
  delete from public.message_events_unmatched as u where u.received_at < now() - interval '24 hours';
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke execute on function private.purge_unmatched_events() from public, anon, authenticated, service_role;
grant execute on function private.purge_unmatched_events() to trace_messaging_worker;

-- ---------------------------------------------------------------------------------------------
-- Per-message worker functions, bound to the job org (R5-9) and to the claim (R3-6 compare-and-set).
-- ---------------------------------------------------------------------------------------------
create function private.messaging_worker_check(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if current_setting('role') is distinct from 'trace_messaging_worker' then
    raise exception 'TRACE_GUARD: this runs as the messaging worker' using errcode = '42501';
  end if;
  if p_org is null or p_org is distinct from private.job_org_id() then
    raise exception 'TRACE_GUARD: not the job org' using errcode = '42501';
  end if;
end
$$;
revoke execute on function private.messaging_worker_check(uuid) from public, anon, authenticated, service_role;

-- Lead decision (a): the render facts and the recipient ciphertext of one claimed message; nothing when the claim no
-- longer holds (another consumer or a reclaim owns it). The name and contact ciphertexts are decrypted in memory only.
create function private.message_send_context(p_org uuid, p_message uuid, p_claim uuid)
returns table (
  message_id uuid,
  invitation_id uuid,
  purpose text,
  channel text,
  template_id uuid,
  language text,
  idempotency_key text,
  attempts smallint,
  invitation_status public.invitation_status,
  drive_mode public.drive_mode,
  slot_starts_at timestamptz,
  deadline_at timestamptz,
  duration_seconds int,
  test_name text,
  org_name text,
  full_name_ct text,
  name_key_version int,
  email_ct text,
  contact_key_version int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.messaging_worker_check(p_org);
  return query
  select m.id, m.invitation_id, m.purpose, m.channel, m.template_id, i.language, m.idempotency_key, m.attempts,
    i.status, d.mode, s.starts_at, d.deadline_at, v.total_time_seconds, t.name, o.name, c.full_name_ct, c.key_version,
    cc.email_ct, cc.key_version
  from public.outbound_messages as m
  join public.invitations as i on i.org_id = m.org_id and i.id = m.invitation_id
  join public.drives as d on d.org_id = m.org_id and d.id = m.drive_id
  left join public.slots as s on s.org_id = i.org_id and s.id = i.slot_id
  join public.test_versions as v on v.org_id = i.org_id and v.id = i.test_version_id
  join public.tests as t on t.org_id = i.org_id and t.id = i.test_id
  join public.orgs as o on o.id = m.org_id
  join public.candidates as c on c.org_id = i.org_id and c.id = i.candidate_ref_id
  join public.candidate_contacts as cc on cc.org_id = i.org_id and cc.candidate_id = i.candidate_ref_id
  where m.org_id = p_org and m.id = p_message and m.status = 'queued' and m.claim_id = p_claim;
end
$$;
revoke execute on function private.message_send_context(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.message_send_context(uuid, uuid, uuid) to trace_messaging_worker;

-- rotate_link_for_send (R2-4, R3-6): the consumer's fresh token hash for a claimed invite or reschedule message; the
-- invitation's token_version + 1 (the guard's messaging-worker branch, R5-12 (1)). Returns the new token version.
create function private.rotate_link_for_send(p_org uuid, p_message uuid, p_claim uuid, p_new_hash text)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inv uuid;
  v_status public.invitation_status;
  v_version int;
begin
  perform private.messaging_worker_check(p_org);
  if p_new_hash is null or p_new_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'TRACE_BAD_INPUT: the link hash is 64 hex characters' using errcode = '22023';
  end if;
  select m.invitation_id into v_inv from public.outbound_messages as m
  where m.org_id = p_org and m.id = p_message and m.status = 'queued' and m.claim_id = p_claim
    and m.purpose in ('invite', 'reschedule')
  for update;
  if not found then
    raise exception 'TRACE_GUARD: message not claimed' using errcode = '42501';
  end if;
  select i.status into v_status from public.invitations as i where i.org_id = p_org and i.id = v_inv for update;
  if v_status not in ('created', 'sent', 'otp_verified') then
    raise exception 'TRACE_GUARD: invitation_closed' using errcode = '42501';
  end if;
  update public.invitations as i set link_token_hash = p_new_hash, token_version = i.token_version + 1
  where i.org_id = p_org and i.id = v_inv
  returning i.token_version into v_version;
  perform private.audit(p_org, 'invitation.link_rotated', 'invitations', v_inv,
    jsonb_build_object('message_id', p_message, 'token_version', v_version), null, 'system');
  return v_version;
end
$$;
revoke execute on function private.rotate_link_for_send(uuid, uuid, uuid, text) from public, anon, authenticated,
  service_role;
grant execute on function private.rotate_link_for_send(uuid, uuid, uuid, text) to trace_messaging_worker;

-- apply_message_event: one provider event on a known message (R2-15 ranks): stored once (unique provider event id), then
-- the status moves forward only. A transient bounce or a delay is stored and moves nothing. No grant.
create function private.apply_message_event(p_org uuid, p_message uuid, p_provider text, p_provider_event_id text,
  p_event text, p_bounce_kind text, p_occurred_at timestamptz)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
begin
  insert into public.message_events (org_id, outbound_message_id, provider, provider_event_id, event, bounce_kind,
      occurred_at)
  values (p_org, p_message, p_provider, p_provider_event_id, p_event, p_bounce_kind, p_occurred_at)
  on conflict (provider, provider_event_id) do nothing
  returning id into v_id;
  if v_id is null then
    return 'duplicate';
  end if;
  v_status := case p_event
    when 'send' then 'sent'
    when 'delivery' then 'delivered'
    when 'bounce' then case when p_bounce_kind = 'transient' then null else 'bounced' end
    when 'complaint' then 'complained'
    when 'reject' then 'failed'
  end;
  if v_status is not null then
    update public.outbound_messages as m
    set status = v_status,
      delivered_at = case when v_status = 'delivered' then p_occurred_at else m.delivered_at end,
      last_error_code = case when v_status = 'failed' then 'provider_rejected' else m.last_error_code end
    where m.org_id = p_org and m.id = p_message
      and private.message_status_rank(v_status) > private.message_status_rank(m.status)
      and m.status not in ('planned', 'cancelled');
  end if;
  return 'applied';
end
$$;
revoke execute on function private.apply_message_event(uuid, uuid, text, text, text, text, timestamptz) from public, anon,
  authenticated, service_role;

-- record_send (R2-16, R3-5, R3-6): compare-and-set on the claim; queued -> sent with the provider's id; a drive invitation
-- created -> sent (a no-op past sent, R3-12); events that arrived first are applied and dropped. False when the claim
-- no longer holds.
create function private.record_send(p_org uuid, p_message uuid, p_claim uuid, p_provider text,
  p_provider_message_id text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inv uuid;
  v_purpose text;
  v_u record;
begin
  perform private.messaging_worker_check(p_org);
  if p_provider is null or p_provider !~ '^[a-z][a-z0-9_]{1,31}$'
    or p_provider_message_id is null or p_provider_message_id !~ '^[!-~]{1,255}$' then
    raise exception 'TRACE_BAD_INPUT: provider and provider message id' using errcode = '22023';
  end if;
  update public.outbound_messages as m
  set status = 'sent', provider = p_provider, provider_message_id = p_provider_message_id, sent_at = now(),
    attempts = least(m.attempts + 1, 8), last_error_code = null
  where m.org_id = p_org and m.id = p_message and m.status = 'queued' and m.claim_id = p_claim
  returning m.invitation_id, m.purpose into v_inv, v_purpose;
  if not found then
    return false;
  end if;
  if v_purpose in ('invite', 'reschedule') then
    update public.invitations as i set status = 'sent'
    where i.org_id = p_org and i.id = v_inv and i.status = 'created';
  end if;
  for v_u in
    select u.id, u.provider_event_id, u.event, u.bounce_kind, u.occurred_at
    from public.message_events_unmatched as u
    where u.org_id = p_org and u.provider = p_provider and u.provider_message_id = p_provider_message_id
    order by u.occurred_at, u.id
  loop
    perform private.apply_message_event(p_org, p_message, p_provider, v_u.provider_event_id, v_u.event, v_u.bounce_kind,
      v_u.occurred_at);
    delete from public.message_events_unmatched as u where u.id = v_u.id;
  end loop;
  return true;
end
$$;
revoke execute on function private.record_send(uuid, uuid, uuid, text, text) from public, anon, authenticated,
  service_role;
grant execute on function private.record_send(uuid, uuid, uuid, text, text) to trace_messaging_worker;

-- Lead decision (a): a failed attempt under the claim. Transient: attempts + 1, the row stays queued for the Queue's
-- retry; final (a permanent error, or the 8th attempt): failed with the code. Returns the resulting status, or null when
-- the claim no longer holds.
create function private.record_send_failure(p_org uuid, p_message uuid, p_claim uuid, p_error_code text,
  p_final boolean)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  perform private.messaging_worker_check(p_org);
  if p_error_code is null or p_error_code not in ('bad_recipient', 'provider_rejected', 'provider_unavailable',
      'throttled', 'render_failed', 'crypto_unavailable', 'invitation_closed', 'timeout', 'unknown')
    or p_final is null then
    raise exception 'TRACE_BAD_INPUT: an error code from the list and a final flag' using errcode = '22023';
  end if;
  update public.outbound_messages as m
  set attempts = least(m.attempts + 1, 8), last_error_code = p_error_code,
    status = case when p_final or m.attempts + 1 >= 8 then 'failed' else 'queued' end
  where m.org_id = p_org and m.id = p_message and m.status = 'queued' and m.claim_id = p_claim
  returning m.status into v_status;
  return v_status;
end
$$;
revoke execute on function private.record_send_failure(uuid, uuid, uuid, text, boolean) from public, anon, authenticated,
  service_role;
grant execute on function private.record_send_failure(uuid, uuid, uuid, text, boolean) to trace_messaging_worker;

-- record_message_event (R2-18, R3-5, R4-6): the org comes from the (provider, provider_message_id) lookup, never from the
-- caller; an unknown id is kept as unmatched under the org of the SES message tag (p_org) until record_send reconciles
-- it, or dropped when there is no tag. trace_api (the signed webhook) and the messaging worker (the load-sim adapter,
-- bound to its job org). Returns applied | duplicate | unmatched | dropped.
create function private.record_message_event(p_provider text, p_provider_event_id text, p_provider_message_id text,
  p_event text, p_bounce_kind text, p_occurred_at timestamptz, p_org uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role text := current_setting('role');
  v_org uuid;
  v_id uuid;
begin
  if v_role is distinct from 'trace_api' and v_role is distinct from 'trace_messaging_worker'
    and not private.is_operator() then
    raise exception 'TRACE_GUARD: provider events come from the api or the messaging worker' using errcode = '42501';
  end if;
  if p_provider is null or p_provider !~ '^[a-z][a-z0-9_]{1,31}$'
    or p_provider_event_id is null or p_provider_event_id !~ '^[!-~]{1,255}$'
    or p_provider_message_id is null or p_provider_message_id !~ '^[!-~]{1,255}$'
    or p_event is null or p_event not in ('send', 'delivery', 'bounce', 'complaint', 'reject', 'delivery_delay')
    or (p_event = 'bounce') <> (p_bounce_kind is not null)
    or (p_bounce_kind is not null and p_bounce_kind not in ('permanent', 'transient', 'undetermined'))
    or p_occurred_at is null then
    raise exception 'TRACE_BAD_INPUT: a provider event' using errcode = '22023';
  end if;
  select m.org_id, m.id into v_org, v_id from public.outbound_messages as m
  where m.provider = p_provider and m.provider_message_id = p_provider_message_id
  for update;
  if v_role = 'trace_messaging_worker'
    and (private.job_org_id() is null or coalesce(v_org, p_org) is distinct from private.job_org_id()) then
    raise exception 'TRACE_GUARD: not the job org' using errcode = '42501';
  end if;
  if v_id is not null then
    return private.apply_message_event(v_org, v_id, p_provider, p_provider_event_id, p_event, p_bounce_kind,
      p_occurred_at);
  end if;
  if p_org is null or not exists (select 1 from public.orgs as o where o.id = p_org) then
    return 'dropped';
  end if;
  insert into public.message_events_unmatched (org_id, provider, provider_event_id, provider_message_id, event,
      bounce_kind, occurred_at)
  values (p_org, p_provider, p_provider_event_id, p_provider_message_id, p_event, p_bounce_kind, p_occurred_at)
  on conflict (provider, provider_event_id) do nothing;
  return 'unmatched';
end
$$;
revoke execute on function private.record_message_event(text, text, text, text, text, timestamptz, uuid) from public, anon,
  authenticated, service_role;
grant execute on function private.record_message_event(text, text, text, text, text, timestamptz, uuid) to trace_api,
  trace_messaging_worker;

-- ---------------------------------------------------------------------------------------------
-- drive_invitations (R4-5, R5-7, R5-44, R5-52 a): the drive's invitation list for the api, one page of a keyset on
-- (created_at, id). Rows only for a viewer whose membership counts in the api org (owner, admin or recruiter of a
-- customer org) and whose workspace fence covers the drive. Per invitation: label, status, slot, the name ciphertext for
-- the api to decrypt, hints, the person link and the latest delivery status per purpose.
-- ---------------------------------------------------------------------------------------------
create function private.drive_invitations(p_viewer uuid, p_aal text, p_amr text[], p_drive uuid,
  p_after_created_at timestamptz, p_after_id uuid, p_limit int)
returns table (
  invitation_id uuid,
  candidate_label text,
  status public.invitation_status,
  created_at timestamptz,
  slot_id uuid,
  slot_starts_at timestamptz,
  candidate_ref_id uuid,
  full_name_ct text,
  name_key_version int,
  email_hint text,
  phone_hint text,
  invite_status text,
  reminder_status text,
  reschedule_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'TRACE_BAD_INPUT: the page size is 1 to 200' using errcode = '22023';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception 'TRACE_BAD_INPUT: the cursor has both parts or neither' using errcode = '22023';
  end if;
  return query
  select i.id, i.candidate_label, i.status, i.created_at, i.slot_id, s.starts_at, i.candidate_ref_id, c.full_name_ct,
    c.key_version, cc.email_hint, cc.phone_hint,
    (select m.status from public.outbound_messages as m
     where m.org_id = i.org_id and m.invitation_id = i.id and m.purpose = 'invite' and m.status <> 'cancelled'
     order by m.created_at desc, m.id desc limit 1),
    (select m.status from public.outbound_messages as m
     where m.org_id = i.org_id and m.invitation_id = i.id and m.purpose = 'reminder' and m.status not in ('planned', 'cancelled')
     order by m.scheduled_for desc, m.id desc limit 1),
    (select m.status from public.outbound_messages as m
     where m.org_id = i.org_id and m.invitation_id = i.id and m.purpose = 'reschedule' and m.status <> 'cancelled'
     order by m.created_at desc, m.id desc limit 1)
  from public.drives as d
  join public.invitations as i on i.org_id = d.org_id and i.drive_id = d.id
  left join public.slots as s on s.org_id = i.org_id and s.id = i.slot_id
  left join public.candidates as c on c.org_id = i.org_id and c.id = i.candidate_ref_id
  left join public.candidate_contacts as cc on cc.org_id = i.org_id and cc.candidate_id = i.candidate_ref_id
  where d.org_id = private.api_org_id() and d.id = p_drive
    and p_viewer is not null
    and exists (
      select 1
      from public.memberships as mb
      join public.orgs as o on o.id = mb.org_id
      where mb.user_id = p_viewer
        and mb.org_id = private.api_org_id()
        and mb.status = 'active'
        and o.status = 'active'
        and o.kind = 'customer'
        and mb.roles && '{org_owner,admin,recruiter}'::public.org_role[]
        and (mb.workspace_id is null or mb.workspace_id = d.workspace_id)
        and private.membership_counts_for(p_viewer, mb.roles, p_aal, p_amr)
    )
    and (p_after_created_at is null or (i.created_at, i.id) > (p_after_created_at, p_after_id))
  order by i.created_at, i.id
  limit p_limit;
end
$$;
revoke execute on function private.drive_invitations(uuid, text, text[], uuid, timestamptz, uuid, int) from public, anon,
  authenticated, service_role;
grant execute on function private.drive_invitations(uuid, text, text[], uuid, timestamptz, uuid, int) to trace_api;
