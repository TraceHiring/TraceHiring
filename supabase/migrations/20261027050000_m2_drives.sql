-- M2 migration M2-b (spec specs/m2-scheduling-invites.md revision 5 §3.1 row M2-b, §3.2 drives, slots, invite_uploads,
-- invite_upload_errors, invitations (widened), reschedule_events, §3.3, §3.4, §3.5, §4; binding rows R2-1, R2-12, R2-13,
-- R2-15, R2-16, R2-19, R3-1, R3-3, R3-4, R3-8, R3-9, R3-10, R3-12, R4-2, R4-4, R5-3, R5-4, R5-5, R5-10, R5-11, R5-12,
-- R5-15, R5-17, R5-41, R5-42, R5-43, R5-46, R5-47, R5-48, R5-49, R5-50, R5-51, R5-52, R5-64, R5-65, R5-66).
-- Provisional timestamp (R5-3): re-timestamped after the newest M1 file before M2 CLOSE, and every D1 body replaced here
-- (invitations_label, invitations_guard, invitations_audit, resolve_invitation_by_hash, the staff UPDATE policy on
-- invitations) is re-derived from its newest version then.
--
-- Re-derived from 20261014094801_d1_invites_sessions.sql (unchanged by D1 4p and M1): invitations_label, invitations_guard,
-- invitations_audit, resolve_invitation_by_hash and invitations_update_staff. D1 rows (drive_id null) keep every D1 rule;
-- the M2 additions apply to drive rows only, except the session_grant_exp default (R5-41), which keeps the new CHECK true
-- for D1 rows and for the D1 api code.
--
-- invite_uploads.rows_refused is §3.2's rows_rejected renamed: D1 invariant I-2 and I-M2-8 (rule 2) allow no column
-- named like reject anywhere, and a refused file row is not a rejected candidate.
-- One HOW-level addition (AUTOPILOT §4): invitations.upload_row_no (the file row an upload invitation came from), so
-- ingest_invite_batch replays an invited row idempotently on (upload_id, row_no) (R3-4) without reading a blind index,
-- which staff cannot select (R3-9).
--
-- Error contract as D1: guard refusal 42501 'TRACE_GUARD: <reason>'; missing parent 23503; malformed batch 22023.

-- ---------------------------------------------------------------------------------------------
-- Fence keys M2 adds itself (R5-4)
-- ---------------------------------------------------------------------------------------------
alter table public.test_versions add constraint test_versions_org_id_id_test_id_key unique (org_id, id, test_id);
alter table public.tests add constraint tests_org_id_id_workspace_id_key unique (org_id, id, workspace_id);
alter table public.invitations add constraint invitations_org_id_id_workspace_id_key unique (org_id, id, workspace_id);

create type public.drive_mode as enum ('open_window', 'scheduled');
create type public.drive_status as enum ('draft', 'scheduled', 'closed', 'cancelled');

-- CHECK helper (R3-11): 0-4 distinct reminder offsets, each 15 minutes to 7 days. Granted to the writer role.
create function private.reminder_offsets_valid(p_offsets interval[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_offsets is not null
    and cardinality(p_offsets) <= 4
    and array_position(p_offsets, null) is null
    and not exists (select 1 from unnest(p_offsets) as o where o < interval '15 minutes' or o > interval '7 days')
    and (select count(distinct o) from unnest(p_offsets) as o) = cardinality(p_offsets)
$$;
revoke execute on function private.reminder_offsets_valid(interval[]) from public, anon, authenticated, service_role;
grant execute on function private.reminder_offsets_valid(interval[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- drives (M2-8, M2-17, M2-18, M2-21)
-- ---------------------------------------------------------------------------------------------
create table public.drives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  default_test_version_id uuid not null,
  name text not null check (char_length(name) between 1 and 200),
  mode public.drive_mode not null,
  status public.drive_status not null default 'draft',
  opens_at timestamptz not null,
  deadline_at timestamptz not null,
  timezone text not null default 'Asia/Kolkata' check (timezone = 'Asia/Kolkata'),
  reminder_offsets interval[] not null default '{24 hours,1 hour}' check (private.reminder_offsets_valid(reminder_offsets)),
  self_reschedule_allowed boolean not null default true,
  lab_mode boolean not null default false,
  bandwidth_budget_kbps int null check (bandwidth_budget_kbps between 64 and 1000000),
  expected_candidates int null check (expected_candidates between 1 and 100000),
  created_by uuid null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, id, test_id),
  unique (org_id, id, workspace_id),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id, workspace_id) references public.tests (org_id, id, workspace_id) on delete restrict,
  foreign key (org_id, default_test_version_id, test_id) references public.test_versions (org_id, id, test_id)
    on delete restrict,
  check (deadline_at > opens_at)
);
create index drives_workspace_idx on public.drives (org_id, workspace_id);
create index drives_test_idx on public.drives (org_id, test_id);
create index drives_version_idx on public.drives (org_id, default_test_version_id, test_id);
create index drives_due_idx on public.drives (deadline_at) where status = 'scheduled';
alter table public.drives enable row level security;

-- ---------------------------------------------------------------------------------------------
-- slots (ABH-14). booked is outside every grant; only the booking trigger moves it.
-- ---------------------------------------------------------------------------------------------
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  drive_id uuid not null,
  starts_at timestamptz not null,
  capacity int not null check (capacity between 1 and 20000),
  booked int not null default 0 check (booked between 0 and capacity),
  start_window_minutes int not null default 15 check (start_window_minutes between 5 and 30),
  lobby_opens_minutes int not null default 30 check (lobby_opens_minutes between 15 and 60),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, id, drive_id),
  unique (org_id, drive_id, starts_at),
  foreign key (org_id, drive_id, workspace_id) references public.drives (org_id, id, workspace_id) on delete cascade,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict
);
create index slots_drive_workspace_idx on public.slots (org_id, drive_id, workspace_id);
create index slots_test_idx on public.slots (org_id, test_id);
alter table public.slots enable row level security;

-- Drive end (R5-51): the later of the deadline and the last non-cancelled slot's window end. No app-role EXECUTE.
create function private.drive_end(p_org uuid, p_drive uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(d.deadline_at, (
    select max(s.starts_at + make_interval(mins => s.start_window_minutes))
    from public.slots as s
    where s.org_id = d.org_id and s.drive_id = d.id and s.status <> 'cancelled'
  ))
  from public.drives as d
  where d.org_id = p_org and d.id = p_drive
$$;
revoke execute on function private.drive_end(uuid, uuid) from public, anon, authenticated, service_role;

-- The drives guard (R5-10, R5-46): SECURITY DEFINER owned by postgres, so it may call assert_drive_pool_ratio; the caller
-- must be staff of the test's workspace first, and every miss (other org, other workspace, another test's version) is the
-- one error 'drive not found', so nothing about another org's versions leaks.
create function private.drives_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := current_setting('role');
  v_op boolean := private.is_operator();
  v_ws uuid;
  v_vtest uuid;
  v_vstatus public.test_version_status;
  v_vno int;
  v_old_vno int;
begin
  if v_role = 'trace_messaging_worker' then
    -- private.close_due_drives only (R5-6, R5-46 f): scheduled -> closed and nothing else.
    if tg_op <> 'UPDATE' or old.status <> 'scheduled' or new.status <> 'closed'
      or (to_jsonb(new) - 'status') <> (to_jsonb(old) - 'status') then
      raise exception 'TRACE_GUARD: the messaging worker may only close a scheduled drive' using errcode = '42501';
    end if;
    return new;
  end if;
  if v_role is distinct from 'authenticated' and not v_op then
    raise exception 'TRACE_GUARD: drives are changed by org users only' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    select t.workspace_id into v_ws from public.tests as t where t.org_id = new.org_id and t.id = new.test_id;
    if not found or (not v_op and not (v_ws = any (private.my_workspace_ids('{org_owner,admin,recruiter}')))) then
      raise exception 'TRACE_GUARD: drive not found' using errcode = '42501';
    end if;
    new.workspace_id := v_ws;
    new.created_by := case when v_op then new.created_by else (select auth.uid()) end;
    new.created_at := now();
    if new.status not in ('draft', 'scheduled') then
      raise exception 'TRACE_GUARD: a drive starts as draft or scheduled' using errcode = '42501';
    end if;
  else
    if old.status in ('closed', 'cancelled') then
      raise exception 'TRACE_GUARD: a closed or cancelled drive cannot change' using errcode = '42501';
    end if;
    if new.id is distinct from old.id or new.org_id is distinct from old.org_id
      or new.workspace_id is distinct from old.workspace_id or new.test_id is distinct from old.test_id
      or new.mode is distinct from old.mode or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'TRACE_GUARD: drive test, workspace and mode are immutable' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and not (
      (old.status = 'draft' and new.status in ('scheduled', 'cancelled'))
      or (old.status = 'scheduled' and new.status in ('closed', 'cancelled'))
    ) then
      raise exception 'TRACE_GUARD: drive status moves forward only' using errcode = '42501';
    end if;
    if old.status <> 'draft' then
      if new.opens_at is distinct from old.opens_at then
        raise exception 'TRACE_GUARD: a scheduled drive keeps its opening time' using errcode = '42501';
      end if;
      -- R3-10: only extended; the follow-up trigger moves the live invitations' expires_at forward.
      if new.deadline_at < old.deadline_at then
        raise exception 'TRACE_GUARD: a drive deadline can only be extended' using errcode = '42501';
      end if;
    end if;
  end if;

  -- Version rules (M2-17, M2-18): a published version of the drive's test, forward only, 10x pool for scheduled mode.
  if tg_op = 'INSERT' or new.default_test_version_id is distinct from old.default_test_version_id
    or (new.status = 'scheduled' and old.status = 'draft') then
    select v.test_id, v.status, v.version_no into v_vtest, v_vstatus, v_vno
    from public.test_versions as v where v.org_id = new.org_id and v.id = new.default_test_version_id;
    if not found or v_vtest is distinct from new.test_id then
      raise exception 'TRACE_GUARD: drive not found' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.default_test_version_id is distinct from old.default_test_version_id then
      select v.version_no into v_old_vno
      from public.test_versions as v where v.org_id = old.org_id and v.id = old.default_test_version_id;
      if v_vno <= v_old_vno then
        raise exception 'TRACE_GUARD: the default version moves forward only' using errcode = '42501';
      end if;
    end if;
    if new.mode = 'scheduled' then
      perform private.assert_drive_pool_ratio(new.org_id, new.default_test_version_id);
    elsif v_vstatus <> 'published' then
      raise exception 'TRACE_GUARD: published test version not found' using errcode = '23503';
    end if;
  end if;

  if new.status = 'scheduled' and new.mode = 'scheduled' and (tg_op = 'INSERT' or old.status = 'draft')
    and not exists (
      select 1 from public.slots as s where s.org_id = new.org_id and s.drive_id = new.id and s.status = 'open'
    ) then
    raise exception 'TRACE_GUARD: a scheduled drive needs a slot' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.drives_guard() from public, anon, authenticated, service_role;

create function private.drives_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'drive.create';
  elsif new is not distinct from old then
    return null;
  elsif new.status is distinct from old.status then
    v_action := case new.status when 'scheduled' then 'drive.schedule' when 'closed' then 'drive.close'
                                else 'drive.cancel' end;
  else
    v_action := 'drive.update';
  end if;
  perform private.audit(new.org_id, v_action, 'drives', new.id,
    jsonb_build_object('drive_id', new.id, 'test_id', new.test_id, 'default_test_version_id', new.default_test_version_id),
    new.workspace_id,
    case when current_setting('role') = 'trace_messaging_worker' then 'system'::public.actor_kind end);
  return null;
end
$$;
revoke execute on function private.drives_audit() from public, anon, authenticated, service_role;

-- Live drive invitations follow the drive end, forward only (R3-10, R5-42, R5-51, R5-65 c, e): locks in id order, and only
-- rows whose expires_at is behind the new end are touched, so the guard's value rule only ever sees a forward move.
create function private.invitations_follow_end(p_org uuid, p_drive uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exp timestamptz := private.drive_end(p_org, p_drive) + interval '7 days';
begin
  perform 1 from public.invitations as i
  where i.org_id = p_org and i.drive_id = p_drive and i.status in ('created', 'sent', 'otp_verified', 'started')
    and i.expires_at < v_exp
  order by i.id
  for update;
  update public.invitations as i set expires_at = v_exp
  where i.org_id = p_org and i.drive_id = p_drive and i.status in ('created', 'sent', 'otp_verified', 'started')
    and i.expires_at < v_exp;
end
$$;
revoke execute on function private.invitations_follow_end(uuid, uuid) from public, anon, authenticated, service_role;

create function private.drives_follow_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deadline_at > old.deadline_at then
    perform private.invitations_follow_end(new.org_id, new.id);
  end if;
  return null;
end
$$;
revoke execute on function private.drives_follow_end() from public, anon, authenticated, service_role;

create trigger drives_guard before insert or update on public.drives
  for each row execute function private.drives_guard();
create trigger drives_audit after insert or update on public.drives
  for each row execute function private.drives_audit();
create trigger drives_follow_end after update of deadline_at on public.drives
  for each row execute function private.drives_follow_end();
alter table public.drives enable always trigger drives_guard;

grant select on public.drives to authenticated;
grant insert (org_id, test_id, default_test_version_id, name, mode, status, opens_at, deadline_at, timezone,
  reminder_offsets, self_reschedule_allowed, lab_mode, bandwidth_budget_kbps, expected_candidates)
  on public.drives to authenticated;
grant update (default_test_version_id, name, status, opens_at, deadline_at, reminder_offsets, self_reschedule_allowed,
  lab_mode, bandwidth_budget_kbps, expected_candidates) on public.drives to authenticated;
grant delete on public.drives to authenticated;
create policy drives_select_staff on public.drives for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy drives_select_reviewer on public.drives for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy drives_insert_staff on public.drives for insert to authenticated
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy drives_update_staff on public.drives for update to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]))
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy drives_delete_staff on public.drives for delete to authenticated
  using (status = 'draft' and workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));

-- slots guard: booked-only changes come from the booking trigger (no column grant reaches booked), under any caller role.
create function private.slots_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op boolean := private.is_operator();
  v_ws uuid;
  v_test uuid;
  v_mode public.drive_mode;
  v_status public.drive_status;
  v_opens timestamptz;
  v_deadline timestamptz;
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'booked') = (to_jsonb(old) - 'booked') then
    return new;
  end if;
  if current_setting('role') is distinct from 'authenticated' and not v_op then
    raise exception 'TRACE_GUARD: slots are changed by org users only' using errcode = '42501';
  end if;
  select d.workspace_id, d.test_id, d.mode, d.status, d.opens_at, d.deadline_at
    into v_ws, v_test, v_mode, v_status, v_opens, v_deadline
  from public.drives as d
  where d.org_id = case when tg_op = 'DELETE' then old.org_id else new.org_id end
    and d.id = case when tg_op = 'DELETE' then old.drive_id else new.drive_id end;
  if not found or (not v_op and not (v_ws = any (private.my_workspace_ids('{org_owner,admin,recruiter}')))) then
    raise exception 'TRACE_GUARD: drive not found' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if old.booked > 0 then
      raise exception 'TRACE_GUARD: move the slot''s invitations first' using errcode = '42501';
    end if;
    return old;
  end if;
  if v_status not in ('draft', 'scheduled') then
    raise exception 'TRACE_GUARD: a closed or cancelled drive cannot change' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if v_mode <> 'scheduled' then
      raise exception 'TRACE_GUARD: slots belong to scheduled-mode drives' using errcode = '42501';
    end if;
    new.workspace_id := v_ws;
    new.test_id := v_test;
    new.booked := 0;
    new.created_at := now();
  else
    if old.status = 'cancelled' then
      raise exception 'TRACE_GUARD: a cancelled slot cannot change' using errcode = '42501';
    end if;
    if new.id is distinct from old.id or new.org_id is distinct from old.org_id
      or new.workspace_id is distinct from old.workspace_id or new.test_id is distinct from old.test_id
      or new.drive_id is distinct from old.drive_id or new.created_at is distinct from old.created_at then
      raise exception 'TRACE_GUARD: a slot stays in its drive' using errcode = '42501';
    end if;
    if new.status = 'cancelled' and old.booked > 0 then
      raise exception 'TRACE_GUARD: move the slot''s invitations first' using errcode = '42501';
    end if;
    -- The operator path may move a booked slot's times (fixtures, support); org users move invitations first.
    if not v_op and old.booked > 0 and (new.starts_at, new.start_window_minutes, new.lobby_opens_minutes)
      is distinct from (old.starts_at, old.start_window_minutes, old.lobby_opens_minutes) then
      raise exception 'TRACE_GUARD: a booked slot keeps its times' using errcode = '42501';
    end if;
  end if;
  if new.starts_at < v_opens or new.starts_at > v_deadline then
    raise exception 'TRACE_GUARD: a slot starts inside the drive window' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.slots_guard() from public, anon, authenticated, service_role;

-- Statement level with transition tables (R5-65 e): one forward move per drive whose slot times or status changed.
create function private.slots_follow_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d record;
begin
  if tg_op = 'INSERT' then
    for v_d in select distinct n.org_id, n.drive_id from new_rows as n order by n.org_id, n.drive_id loop
      perform private.invitations_follow_end(v_d.org_id, v_d.drive_id);
    end loop;
  else
    for v_d in
      select distinct n.org_id, n.drive_id
      from new_rows as n join old_rows as o on o.id = n.id
      where (n.starts_at, n.start_window_minutes, n.status) is distinct from (o.starts_at, o.start_window_minutes, o.status)
      order by n.org_id, n.drive_id
    loop
      perform private.invitations_follow_end(v_d.org_id, v_d.drive_id);
    end loop;
  end if;
  return null;
end
$$;
revoke execute on function private.slots_follow_end() from public, anon, authenticated, service_role;

create trigger slots_guard before insert or update or delete on public.slots
  for each row execute function private.slots_guard();
create trigger slots_follow_end_insert after insert on public.slots
  referencing new table as new_rows for each statement execute function private.slots_follow_end();
create trigger slots_follow_end_update after update on public.slots
  referencing old table as old_rows new table as new_rows for each statement execute function private.slots_follow_end();
alter table public.slots enable always trigger slots_guard;

grant select on public.slots to authenticated;
grant insert (org_id, drive_id, starts_at, capacity, start_window_minutes, lobby_opens_minutes, status)
  on public.slots to authenticated;
grant update (starts_at, capacity, start_window_minutes, lobby_opens_minutes, status) on public.slots to authenticated;
grant delete on public.slots to authenticated;
create policy slots_select_staff on public.slots for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy slots_select_reviewer on public.slots for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy slots_insert_staff on public.slots for insert to authenticated
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy slots_update_staff on public.slots for update to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]))
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy slots_delete_staff on public.slots for delete to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));

-- ---------------------------------------------------------------------------------------------
-- invite_uploads and invite_upload_errors (ABH-13; CSV only, R5-20; no file and no cell value is stored, Q30)
-- ---------------------------------------------------------------------------------------------
create table public.invite_uploads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  drive_id uuid not null,
  source_kind text not null default 'csv' check (source_kind = 'csv'),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  rows_total int not null check (rows_total between 0 and 5000),
  rows_invited int not null default 0 check (rows_invited >= 0),
  rows_refused int not null default 0 check (rows_refused >= 0),
  rows_held int not null default 0 check (rows_held >= 0),
  created_by uuid null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  unique (org_id, id),
  unique (org_id, id, drive_id),
  foreign key (org_id, drive_id, workspace_id) references public.drives (org_id, id, workspace_id) on delete restrict,
  check ((status = 'open') = (completed_at is null))
);
create index invite_uploads_drive_idx on public.invite_uploads (org_id, drive_id, workspace_id);
alter table public.invite_uploads enable row level security;

create table public.invite_upload_errors (
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  upload_id uuid not null,
  row_no int not null check (row_no between 1 and 5000),
  reason text not null check (reason in ('missing_name', 'missing_contact', 'invalid_email', 'invalid_phone',
    'duplicate_email_in_file', 'duplicate_phone_in_file', 'already_invited', 'phone_shared', 'minor', 'bad_adult_value',
    'bad_slot', 'slot_full', 'name_too_long', 'row_limit', 'unknown_column', 'missing_email')),
  held boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (org_id, upload_id, row_no),
  foreign key (org_id, upload_id) references public.invite_uploads (org_id, id) on delete restrict,
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  check (held = (reason = 'phone_shared'))
);
create index invite_upload_errors_workspace_idx on public.invite_upload_errors (org_id, workspace_id);
alter table public.invite_upload_errors enable row level security;

create function private.invite_uploads_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op boolean := private.is_operator();
  v_ws uuid;
  v_status public.drive_status;
begin
  -- Counter-only changes come from private.invite_uploads_count (no grant reaches the counters).
  if tg_op = 'UPDATE' and (to_jsonb(new) - '{rows_invited,rows_refused,rows_held}'::text[])
                         = (to_jsonb(old) - '{rows_invited,rows_refused,rows_held}'::text[]) then
    return new;
  end if;
  if current_setting('role') is distinct from 'authenticated' and not v_op then
    raise exception 'TRACE_GUARD: uploads are changed by org users only' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    select d.workspace_id, d.status into v_ws, v_status
    from public.drives as d where d.org_id = new.org_id and d.id = new.drive_id;
    if not found or (not v_op and not (v_ws = any (private.my_workspace_ids('{org_owner,admin,recruiter}')))) then
      raise exception 'TRACE_GUARD: drive not found' using errcode = '42501';
    end if;
    if v_status <> 'scheduled' then
      raise exception 'TRACE_GUARD: invitations need a scheduled drive' using errcode = '42501';
    end if;
    new.workspace_id := v_ws;
    new.status := 'open';
    new.rows_invited := 0;
    new.rows_refused := 0;
    new.rows_held := 0;
    new.completed_at := null;
    new.created_at := now();
    new.created_by := case when v_op then new.created_by else (select auth.uid()) end;
    return new;
  end if;
  if old.status <> 'open' then
    raise exception 'TRACE_GUARD: an upload moves from open only' using errcode = '42501';
  end if;
  if (to_jsonb(new) - '{status,completed_at}'::text[]) <> (to_jsonb(old) - '{status,completed_at}'::text[])
    or new.status not in ('completed', 'cancelled') then
    raise exception 'TRACE_GUARD: an upload changes only its status, to completed or cancelled' using errcode = '42501';
  end if;
  new.completed_at := now();
  return new;
end
$$;
revoke execute on function private.invite_uploads_guard() from public, anon, authenticated, service_role;

create function private.invite_upload_errors_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_status text;
begin
  select u.workspace_id, u.status into v_ws, v_status
  from public.invite_uploads as u where u.org_id = new.org_id and u.id = new.upload_id;
  if not found or (not private.is_operator()
                   and not (v_ws = any (private.my_workspace_ids('{org_owner,admin,recruiter}')))) then
    raise exception 'TRACE_GUARD: upload not found' using errcode = '42501';
  end if;
  if v_status <> 'open' then
    raise exception 'TRACE_GUARD: the upload is not open' using errcode = '42501';
  end if;
  new.workspace_id := v_ws;
  new.created_at := now();
  return new;
end
$$;
revoke execute on function private.invite_upload_errors_guard() from public, anon, authenticated, service_role;

-- Counters by increment (AFTER INSERT on invitations with an upload, AFTER INSERT OR DELETE on the error rows).
create function private.invite_uploads_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'invitations' then
    if new.upload_id is not null then
      update public.invite_uploads as u set rows_invited = u.rows_invited + 1
      where u.org_id = new.org_id and u.id = new.upload_id;
    end if;
  elsif tg_op = 'INSERT' then
    update public.invite_uploads as u
      set rows_refused = u.rows_refused + case when new.held then 0 else 1 end,
          rows_held = u.rows_held + case when new.held then 1 else 0 end
    where u.org_id = new.org_id and u.id = new.upload_id;
  else
    update public.invite_uploads as u
      set rows_refused = u.rows_refused - case when old.held then 0 else 1 end,
          rows_held = u.rows_held - case when old.held then 1 else 0 end
    where u.org_id = old.org_id and u.id = old.upload_id;
  end if;
  return null;
end
$$;
revoke execute on function private.invite_uploads_count() from public, anon, authenticated, service_role;

create trigger invite_uploads_guard before insert or update on public.invite_uploads
  for each row execute function private.invite_uploads_guard();
create trigger invite_upload_errors_guard before insert on public.invite_upload_errors
  for each row execute function private.invite_upload_errors_guard();
create trigger invite_upload_errors_frozen before update on public.invite_upload_errors
  for each row execute function private.m2_insert_once();
create trigger invite_upload_errors_count after insert or delete on public.invite_upload_errors
  for each row execute function private.invite_uploads_count();
alter table public.invite_uploads enable always trigger invite_uploads_guard;
alter table public.invite_upload_errors enable always trigger invite_upload_errors_guard;
alter table public.invite_upload_errors enable always trigger invite_upload_errors_frozen;

grant select on public.invite_uploads to authenticated;
grant insert (org_id, drive_id, source_kind, file_sha256, rows_total) on public.invite_uploads to authenticated;
grant update (status) on public.invite_uploads to authenticated;
create policy invite_uploads_select_staff on public.invite_uploads for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy invite_uploads_insert_staff on public.invite_uploads for insert to authenticated
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy invite_uploads_update_staff on public.invite_uploads for update to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]))
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
-- A held phone_shared row is replaced when the recruiter re-sends it confirmed (R2-12, R3-4): DELETE of held rows only.
grant select on public.invite_upload_errors to authenticated;
grant insert (org_id, upload_id, row_no, reason, held) on public.invite_upload_errors to authenticated;
grant delete on public.invite_upload_errors to authenticated;
create policy invite_upload_errors_select_staff on public.invite_upload_errors for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy invite_upload_errors_insert_staff on public.invite_upload_errors for insert to authenticated
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy invite_upload_errors_delete_staff on public.invite_upload_errors for delete to authenticated
  using (held and workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));

-- ---------------------------------------------------------------------------------------------
-- invitations widened (R2-1, R3-1, R3-8, R4-2, R5-4, R5-5, R5-17, R5-43, R5-49, R5-50)
-- ---------------------------------------------------------------------------------------------
alter table public.invitations
  add column drive_id uuid null,
  add column slot_id uuid null,
  add column upload_id uuid null,
  add column upload_row_no int null check (upload_row_no between 1 and 5000),
  add column candidate_ref_id uuid null,
  add column email_bidx text null check (email_bidx ~ '^[0-9a-f]{64}$'),
  add column phone_bidx text null check (phone_bidx ~ '^[0-9a-f]{64}$'),
  add column token_version int not null default 1 check (token_version >= 1),
  add column invite_resend_no smallint not null default 0 check (invite_resend_no >= 0),
  add column plan_no int not null default 0 check (plan_no >= 0),
  add column session_grant_exp timestamptz null,
  add column shared_contact_confirmed_by uuid null,
  add column self_reschedules_used smallint not null default 0 check (self_reschedules_used between 0 and 1),
  add column language text not null default 'en' check (language in ('en', 'hi')),
  add column channels text[] not null default '{email}'
    check (cardinality(channels) between 1 and 3 and channels <@ '{email,sms,whatsapp}'::text[]);
alter table public.invitations alter column contact_email drop not null;
alter table public.invitations
  add constraint invitations_contact_or_drive check ((drive_id is null) = (contact_email is not null)),
  add constraint invitations_candidate_link check ((drive_id is null) = (candidate_ref_id is null)),
  add constraint invitations_booking_needs_drive check (drive_id is not null or (slot_id is null and upload_id is null)),
  add constraint invitations_drive_bidx check (drive_id is null or email_bidx is not null),
  add constraint invitations_upload_row check ((upload_id is null) = (upload_row_no is null)),
  add constraint invitations_drive_fk foreign key (org_id, drive_id, test_id)
    references public.drives (org_id, id, test_id) on delete restrict,
  add constraint invitations_drive_workspace_fk foreign key (org_id, drive_id, workspace_id)
    references public.drives (org_id, id, workspace_id) on delete restrict,
  add constraint invitations_slot_fk foreign key (org_id, slot_id, drive_id)
    references public.slots (org_id, id, drive_id) on delete restrict,
  add constraint invitations_upload_fk foreign key (org_id, upload_id, drive_id)
    references public.invite_uploads (org_id, id, drive_id) on delete restrict,
  add constraint invitations_candidate_fk foreign key (org_id, candidate_ref_id, workspace_id)
    references public.candidates (org_id, id, workspace_id) on delete restrict,
  add constraint invitations_upload_row_key unique (org_id, upload_id, upload_row_no);
-- I-M2-2: email dedupe per drive.
create unique index invitations_one_live_drive_email on public.invitations (org_id, drive_id, email_bidx)
  where drive_id is not null and status <> 'revoked';
create index invitations_drive_list_idx on public.invitations (org_id, drive_id, created_at, id);
create index invitations_slot_idx on public.invitations (org_id, slot_id);
create index invitations_candidate_ref_idx on public.invitations (org_id, candidate_ref_id);
create index invitations_drive_phone_idx on public.invitations (org_id, drive_id, phone_bidx) where phone_bidx is not null;

-- session_grant_exp (R5-5, R5-41, R5-58 b, R5-65 a): the backfill runs as the table owner with the guard off (the live
-- guard refuses any change to a terminal row and any change by the operator), then the guard is ENABLE ALWAYS again.
-- Rows with a sessions row: server deadline + 3,600 s; without one: consent time + D1's session-token maximum (10,800 s).
create function private.backfill_session_grant_exp()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  alter table public.invitations disable trigger invitations_guard;
  update public.invitations as i
    set session_grant_exp = coalesce(
      (select s.server_deadline_at + interval '3600 seconds' from public.sessions as s
       where s.org_id = i.org_id and s.invitation_id = i.id),
      (select c.occurred_at + interval '10800 seconds' from public.consents as c
       where c.org_id = i.org_id and c.invitation_id = i.id),
      now() + interval '16200 seconds')
    where i.session_id is not null and i.session_grant_exp is null;
  get diagnostics v_n = row_count;
  alter table public.invitations enable always trigger invitations_guard;
  return v_n;
end
$$;
revoke execute on function private.backfill_session_grant_exp() from public, anon, authenticated, service_role;
select private.backfill_session_grant_exp();
alter table public.invitations add constraint invitations_session_grant_exp_check
  check (session_id is null or session_grant_exp is not null);

-- ---------------------------------------------------------------------------------------------
-- invitations_label (re-derived from D1; R5-11): D1 rows unchanged; drive rows take the drive's test and default version
-- (M2-18), expires_at = drive end + 7 days, the contact's blind indexes, and the phone rule under an advisory lock.
-- ---------------------------------------------------------------------------------------------
create or replace function private.invitations_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.test_version_status;
  v_test uuid;
  v_ws uuid;
  v_n int;
  v_d_test uuid;
  v_d_version uuid;
  v_d_status public.drive_status;
  v_d_mode public.drive_mode;
  v_email_bidx text;
  v_phone_bidx text;
begin
  -- Org users create invitations; the operator path (plain postgres, no JWT; M0b §2.8) may too, as on the
  -- migration-1 authoring tables (NOTES Q-1, decided 2026-10-14). The rule-9 inviter block below holds for both.
  if current_setting('role') is distinct from 'authenticated' and not private.is_operator() then
    raise exception 'TRACE_GUARD: invitations are created by org users only' using errcode = '42501';
  end if;
  -- M2 drive rows: the drive names the test and the pinned version. A missing drive gives the same error as a test
  -- outside the caller's workspaces, checked next.
  if new.drive_id is not null then
    select d.test_id, d.default_test_version_id, d.status, d.mode into v_d_test, v_d_version, v_d_status, v_d_mode
    from public.drives as d where d.org_id = new.org_id and d.id = new.drive_id;
    if not found then
      raise exception 'TRACE_GUARD: not allowed to invite to this test' using errcode = '42501';
    end if;
    new.test_id := v_d_test;
    new.test_version_id := v_d_version;
  end if;
  -- An app caller must be staff of the test's workspace before anything else is read or locked, so a caller outside it
  -- (another org, a hiring manager, a reviewer) learns nothing about the test version's state and takes no lock
  -- (m2 DB review m-1; the same order as consents_guard).
  if not private.is_operator() and not exists (
    select 1 from public.tests as t
    where t.org_id = new.org_id and t.id = new.test_id
      and t.workspace_id = any (private.my_workspace_ids('{org_owner,admin,recruiter}'))
  ) then
    raise exception 'TRACE_GUARD: not allowed to invite to this test' using errcode = '42501';
  end if;
  -- FOR SHARE: a concurrent retire (NO KEY UPDATE) waits, so the pin is published at insert time (Q20).
  select v.status, v.test_id into v_status, v_test
  from public.test_versions as v where v.org_id = new.org_id and v.id = new.test_version_id for share;
  if not found then
    raise exception 'TRACE_GUARD: test version not found' using errcode = '23503';
  end if;
  if new.test_id is distinct from v_test then
    raise exception 'TRACE_GUARD: the test version belongs to another test' using errcode = '42501';
  end if;
  if v_status <> 'published' then
    raise exception 'TRACE_GUARD: an invitation pins a published test version' using errcode = '42501';
  end if;
  -- The label sequence is bumped under the tests row lock: labels are unique, gaps are possible (D1-1, §10-DB).
  update public.tests as t
    set invitation_seq = t.invitation_seq + 1
    where t.org_id = new.org_id and t.id = new.test_id
    returning t.invitation_seq, t.workspace_id into v_n, v_ws;
  new.workspace_id := v_ws;
  new.candidate_label := 'Candidate ' || v_n;
  new.candidate_id := gen_random_uuid();
  new.session_id := null;
  new.started_at := null;
  new.adult_self_declared := null;
  -- As tests_guard (D1 review m-1): only the operator path names the creator.
  new.created_by := case when private.is_operator() then new.created_by else (select auth.uid()) end;
  if new.adult_confirmed_by_inviter is false then
    new.status := 'blocked_age';
    new.age_block_source := 'inviter';
  else
    new.status := 'created';
    new.age_block_source := null;
  end if;
  -- M2 counters and grant start at their defaults for every row (R3-1, R4-2, R5-65 e).
  new.session_grant_exp := null;
  new.token_version := 1;
  new.invite_resend_no := 0;
  new.plan_no := 0;
  new.self_reschedules_used := 0;
  if new.drive_id is null then
    new.email_bidx := null;
    new.phone_bidx := null;
    new.shared_contact_confirmed_by := null;
    return new;
  end if;

  if v_d_status <> 'scheduled' then
    raise exception 'TRACE_GUARD: invitations need a scheduled drive' using errcode = '42501';
  end if;
  if v_d_mode = 'scheduled' and new.slot_id is null then
    raise exception 'TRACE_GUARD: a scheduled-mode drive invitation needs a slot' using errcode = '42501';
  end if;
  if v_d_mode = 'open_window' and new.slot_id is not null then
    raise exception 'TRACE_GUARD: an open-window drive invitation has no slot' using errcode = '42501';
  end if;
  if new.upload_id is not null and not exists (
    select 1 from public.invite_uploads as u
    where u.org_id = new.org_id and u.id = new.upload_id and u.drive_id = new.drive_id and u.status = 'open'
  ) then
    raise exception 'TRACE_GUARD: the upload is not open' using errcode = '42501';
  end if;
  new.expires_at := private.drive_end(new.org_id, new.drive_id) + interval '7 days';
  if new.candidate_ref_id is not null then
    select c.email_bidx, c.phone_bidx into v_email_bidx, v_phone_bidx
    from public.candidate_contacts as c where c.org_id = new.org_id and c.candidate_id = new.candidate_ref_id;
    if not found then
      raise exception 'TRACE_GUARD: candidate contact not found' using errcode = '23503';
    end if;
  end if;
  new.email_bidx := v_email_bidx;
  new.phone_bidx := v_phone_bidx;
  if new.shared_contact_confirmed_by is not null and not private.is_operator()
    and new.shared_contact_confirmed_by is distinct from (select auth.uid()) then
    raise exception 'TRACE_GUARD: the shared-contact confirmation names the caller' using errcode = '42501';
  end if;
  -- M2-5, R2-15: a phone-only match with another email in the same drive needs a named confirmation.
  if new.phone_bidx is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.drive_id::text || new.phone_bidx, 0));
    if exists (
      select 1 from public.invitations as i
      where i.org_id = new.org_id and i.drive_id = new.drive_id and i.phone_bidx = new.phone_bidx
        and i.email_bidx is distinct from new.email_bidx and i.status <> 'revoked'
    ) then
      if new.shared_contact_confirmed_by is null then
        raise exception 'TRACE_GUARD: phone shared with another candidate' using errcode = '42501';
      end if;
      perform private.audit(new.org_id, 'invitation.shared_contact_confirmed', 'invitations', new.id,
        jsonb_build_object('drive_id', new.drive_id), new.workspace_id);
    end if;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- invitations_guard (re-derived from D1; R5-12 as amended by R5-41, R5-42, R5-48, R5-65, R5-66). The changed columns are
-- computed once; D1's checks and messages are kept for D1 rows.
-- ---------------------------------------------------------------------------------------------
create or replace function private.invitations_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := current_setting('role');
  v_old_rank int;
  v_new_rank int;
  v_changed text[];
  v_live_grant boolean;
begin
  select coalesce(array_agg(n.key), '{}') into v_changed
  from jsonb_each(to_jsonb(new)) as n join jsonb_each(to_jsonb(old)) as o on o.key = n.key
  where n.value is distinct from o.value;
  -- R5-42: callers cannot be identified inside a DEFINER, so the rule is value-based: expires_at alone may move forward
  -- to exactly the drive end + 7 days (what the drives/slots trigger writes), for a drive row.
  if v_changed = array['expires_at'] and new.drive_id is not null and new.expires_at > old.expires_at
    and new.expires_at = private.drive_end(new.org_id, new.drive_id) + interval '7 days' then
    return new;
  end if;
  if v_changed && array['id', 'org_id', 'workspace_id', 'test_id', 'test_version_id', 'candidate_id', 'candidate_label',
      'contact_email', 'adult_confirmed_by_inviter', 'expires_at', 'created_by', 'created_at', 'drive_id', 'upload_id',
      'upload_row_no', 'candidate_ref_id', 'email_bidx', 'phone_bidx', 'language', 'channels',
      'shared_contact_confirmed_by', 'plan_no']
    or (v_role is distinct from 'trace_messaging_worker' and v_changed && array['link_token_hash', 'token_version']) then
    raise exception 'TRACE_GUARD: invitation identity, pin, contact and inviter answer are immutable'
      using errcode = '42501';
  end if;
  -- An update that changes nothing is a no-op (a retried sessionStarted with the stored started_at, L-17).
  if v_changed = '{}' then
    return new;
  end if;
  if old.status in ('submitted', 'expired', 'revoked', 'blocked_age') then
    raise exception 'TRACE_GUARD: the invitation is in a terminal state' using errcode = '42501';
  end if;
  -- Set-once columns.
  if (old.session_id is not null and new.session_id is distinct from old.session_id)
    or (old.started_at is not null and new.started_at is distinct from old.started_at)
    or (old.adult_self_declared is not null and new.adult_self_declared is distinct from old.adult_self_declared)
    or (old.age_block_source is not null and new.age_block_source is distinct from old.age_block_source) then
    raise exception 'TRACE_GUARD: session_id, started_at and the age answer are set once' using errcode = '42501';
  end if;
  -- session_grant_exp (R5-5, R5-41, R5-65 e, R5-66 a, b): defaulted when session_id is set alone (old code, every
  -- fixture), else set by trace_api with or after session_id, forward only, never past now() + 16,200 s.
  if old.session_id is null and new.session_id is not null and new.session_grant_exp is null then
    new.session_grant_exp := now() + interval '16200 seconds';
  elsif new.session_grant_exp is distinct from old.session_grant_exp then
    if new.session_id is null then
      raise exception 'TRACE_GUARD: session_grant_exp needs the session id' using errcode = '42501';
    end if;
    if old.session_grant_exp is not null
      and (new.session_grant_exp is null or new.session_grant_exp < old.session_grant_exp) then
      raise exception 'TRACE_GUARD: session_grant_exp moves forward only' using errcode = '42501';
    end if;
    if new.session_grant_exp > now() + interval '16200 seconds' then
      raise exception 'TRACE_GUARD: session_grant_exp is past the cap' using errcode = '42501';
    end if;
    if v_role is distinct from 'trace_api' then
      raise exception 'TRACE_GUARD: only the api sets session_grant_exp' using errcode = '42501';
    end if;
    if new.drive_id is not null and old.status not in ('otp_verified', 'started') then
      raise exception 'TRACE_GUARD: session_grant_exp moves only for a consented or started invitation'
        using errcode = '42501';
    end if;
  end if;
  -- R4-4: a grant is live while its expiry has not passed or a sessions row exists; no revoke or expiry strands it.
  v_live_grant := old.session_id is not null and (
    old.session_grant_exp is null or now() <= old.session_grant_exp
    or exists (select 1 from public.sessions as s where s.org_id = old.org_id and s.invitation_id = old.id)
  );
  -- R4-2: every slot move bumps plan_no, so reminders planned for an earlier visit to a slot never collide.
  if new.slot_id is distinct from old.slot_id then
    new.plan_no := old.plan_no + 1;
  end if;

  if v_role = 'authenticated' then
    -- D1: revoke from created|sent; M2 drive rows also from otp_verified (R3-3), and slot moves (reschedule_invitation)
    -- and the "Resend invite" counter (R3-1).
    if not (v_changed <@ array['status', 'slot_id', 'invite_resend_no'])
      or ('status' = any (v_changed) and v_changed && array['slot_id', 'invite_resend_no'])
      or (new.drive_id is null and v_changed && array['slot_id', 'invite_resend_no']) then
      raise exception 'TRACE_GUARD: org users may only revoke an invitation' using errcode = '42501';
    end if;
    if 'status' = any (v_changed) then
      if new.status <> 'revoked' or (old.status not in ('created', 'sent')
                                     and not (new.drive_id is not null and old.status = 'otp_verified')) then
        raise exception 'TRACE_GUARD: org users may revoke only a created or sent invitation' using errcode = '42501';
      end if;
      if new.drive_id is not null and v_live_grant then
        raise exception 'TRACE_GUARD: a live session grant blocks this change' using errcode = '42501';
      end if;
      return new;
    end if;
    if 'slot_id' = any (v_changed) then
      if old.status not in ('created', 'sent') then
        raise exception 'TRACE_GUARD: only a created or sent invitation can be moved' using errcode = '42501';
      end if;
      if new.slot_id is null then
        raise exception 'TRACE_GUARD: a scheduled-mode drive invitation needs a slot' using errcode = '42501';
      end if;
    end if;
    if 'invite_resend_no' = any (v_changed)
      and (new.invite_resend_no <> old.invite_resend_no + 1 or old.status not in ('created', 'sent')) then
      raise exception 'TRACE_GUARD: a resend bumps the counter by one for a created or sent invitation'
        using errcode = '42501';
    end if;
    return new;

  elsif v_role = 'trace_api' then
    -- M2 self-reschedule (private.self_reschedule, M2-11): the slot moves only with the one-time counter.
    if v_changed && array['slot_id', 'self_reschedules_used'] then
      if new.drive_id is null or not (v_changed <@ array['slot_id', 'self_reschedules_used'])
        or not ('slot_id' = any (v_changed)) or new.slot_id is null
        or old.self_reschedules_used <> 0 or new.self_reschedules_used <> 1
        or old.status not in ('created', 'sent', 'otp_verified') then
        raise exception 'TRACE_GUARD: the api moves a slot only through the one self-reschedule' using errcode = '42501';
      end if;
      return new;
    end if;
    -- Rule 9: a self-declared minor always blocks, whatever status the caller sent.
    if new.adult_self_declared is false and old.adult_self_declared is null then
      new.status := 'blocked_age';
      new.age_block_source := 'self_declared';
    end if;
    if new.age_block_source is distinct from old.age_block_source
      and not (new.status = 'blocked_age' and new.age_block_source = 'self_declared'
               and new.adult_self_declared is false) then
      raise exception 'TRACE_GUARD: age_block_source follows the self-declared answer' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      v_old_rank := case old.status
        when 'created' then 1 when 'sent' then 2 when 'otp_verified' then 3 when 'started' then 4 end;
      v_new_rank := case new.status
        when 'created' then 1 when 'sent' then 2 when 'otp_verified' then 3 when 'started' then 4
        when 'submitted' then 5 end;
      if new.status in ('sent', 'otp_verified', 'started') then
        if v_new_rank <= v_old_rank then
          raise exception 'TRACE_GUARD: invitation status moves forward only' using errcode = '42501';
        end if;
      elsif new.status = 'expired' then
        if new.drive_id is null then
          -- L-32: a lazy expiry lands only before consent minted the session id (D1 rows, R5-48).
          if old.session_id is not null or new.session_id is not null then
            raise exception 'TRACE_GUARD: an invitation with a session cannot expire' using errcode = '42501';
          end if;
        else
          -- R3-3, R4-4: drive rows expire from created|sent|otp_verified, and with a session id only after the grant.
          if old.status not in ('created', 'sent', 'otp_verified') then
            raise exception 'TRACE_GUARD: the api cannot set this invitation status' using errcode = '42501';
          end if;
          if v_live_grant then
            raise exception 'TRACE_GUARD: a live session grant blocks this change' using errcode = '42501';
          end if;
        end if;
      elsif new.status = 'blocked_age' then
        if new.adult_self_declared is not false then
          raise exception 'TRACE_GUARD: blocked_age needs a self-declared minor' using errcode = '42501';
        end if;
      else
        raise exception 'TRACE_GUARD: the api cannot set this invitation status' using errcode = '42501';
      end if;
      if new.status = 'started' then
        -- L-12/L-17: only via sessionStarted after SessionDO.start acknowledged: session id, consent, adult answers
        -- and the DO's started_at.
        if new.session_id is null or new.started_at is null then
          raise exception 'TRACE_GUARD: started needs the session id and the DO start time' using errcode = '42501';
        end if;
        if new.adult_self_declared is not true or new.adult_confirmed_by_inviter is false then
          raise exception 'TRACE_GUARD: started needs an adult self-declaration' using errcode = '42501';
        end if;
        if not exists (
          select 1 from public.consents as c where c.org_id = new.org_id and c.invitation_id = new.id
        ) then
          raise exception 'TRACE_GUARD: started needs a consent' using errcode = '42501';
        end if;
      end if;
    end if;
    if new.started_at is distinct from old.started_at and not (new.status = 'started' and old.status <> 'started') then
      raise exception 'TRACE_GUARD: started_at is set only with the started transition' using errcode = '42501';
    end if;
    if new.session_id is distinct from old.session_id and not exists (
      select 1 from public.consents as c where c.org_id = new.org_id and c.invitation_id = new.id
    ) then
      raise exception 'TRACE_GUARD: the session id is minted only after consent' using errcode = '42501';
    end if;
    return new;

  elsif v_role = 'trace_worker' then
    -- The mirror sets submitted only, from any non-terminal state, once the sessions row exists (L-35). No sweep ever
    -- expires an invitation (R5-6).
    if new.session_id is distinct from old.session_id or new.started_at is distinct from old.started_at
      or new.adult_self_declared is distinct from old.adult_self_declared
      or new.age_block_source is distinct from old.age_block_source
      or new.status is distinct from 'submitted' or v_changed && array['slot_id', 'session_grant_exp'] then
      raise exception 'TRACE_GUARD: the mirror may only set submitted' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.sessions as s where s.org_id = new.org_id and s.invitation_id = new.id
    ) then
      raise exception 'TRACE_GUARD: submitted needs the sessions row' using errcode = '42501';
    end if;
    return new;

  elsif v_role = 'trace_messaging_worker' then
    -- Reached only through private.rotate_link_for_send / private.record_send (DEFINER; no UPDATE grant, R5-42):
    -- rotate the link (token_version + 1) and move a drive row created -> sent (R2-4, R2-16, R3-6).
    if new.drive_id is null or not (v_changed <@ array['link_token_hash', 'token_version', 'status']) then
      raise exception 'TRACE_GUARD: the messaging worker may only rotate the link and mark a drive invitation sent'
        using errcode = '42501';
    end if;
    if ('link_token_hash' = any (v_changed)) <> ('token_version' = any (v_changed))
      or ('token_version' = any (v_changed) and new.token_version <> old.token_version + 1) then
      raise exception 'TRACE_GUARD: a link rotation bumps token_version by one' using errcode = '42501';
    end if;
    if 'status' = any (v_changed) and not (old.status = 'created' and new.status = 'sent') then
      raise exception 'TRACE_GUARD: the messaging worker may only mark a created invitation sent' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'TRACE_GUARD: this role cannot change an invitation' using errcode = '42501';
end
$$;

-- invitations_audit (re-derived from D1; R5-13, R5-52 b): a drive row's revoke also names its drive.
create or replace function private.invitations_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.org_id, 'invitation.create', 'invitations', new.id,
      jsonb_build_object('test_version_id', new.test_version_id, 'status', new.status), new.workspace_id);
  elsif new.status = 'revoked' and old.status is distinct from 'revoked' then
    perform private.audit(new.org_id, 'invitation.revoke', 'invitations', new.id,
      jsonb_build_object('old_status', old.status)
        || case when new.drive_id is not null then jsonb_build_object('drive_id', new.drive_id) else '{}'::jsonb end,
      new.workspace_id);
  end if;
  return null;
end
$$;

-- Booking (R2-15, R2-16, R5-43): one seat per live drive invitation; a slot move locks both slots in id order. The seat is
-- released on revoked, expired and blocked_age. The slot must be in the invitation's drive, open and in the future.
create function private.book_slot_seat(p_org uuid, p_drive uuid, p_slot uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_starts timestamptz;
  v_booked int;
  v_capacity int;
begin
  select s.status, s.starts_at, s.booked, s.capacity into v_status, v_starts, v_booked, v_capacity
  from public.slots as s where s.org_id = p_org and s.id = p_slot and s.drive_id = p_drive
  for update;
  if not found then
    raise exception 'TRACE_GUARD: slot not in drive' using errcode = '42501';
  end if;
  if v_status <> 'open' or v_starts <= now() then
    raise exception 'TRACE_GUARD: slot not open' using errcode = '42501';
  end if;
  if v_booked >= v_capacity then
    raise exception 'TRACE_GUARD: slot full' using errcode = '42501';
  end if;
  update public.slots as s set booked = s.booked + 1 where s.org_id = p_org and s.id = p_slot;
end
$$;
revoke execute on function private.book_slot_seat(uuid, uuid, uuid) from public, anon, authenticated, service_role;

create function private.invitations_book()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_live boolean;
  v_new_live boolean := new.status not in ('revoked', 'expired', 'blocked_age');
begin
  if tg_op = 'INSERT' then
    if new.slot_id is not null and v_new_live then
      perform private.book_slot_seat(new.org_id, new.drive_id, new.slot_id);
    end if;
    return null;
  end if;
  v_old_live := old.status not in ('revoked', 'expired', 'blocked_age');
  if new.slot_id is not distinct from old.slot_id then
    if old.slot_id is not null and v_old_live and not v_new_live then
      update public.slots as s set booked = s.booked - 1 where s.org_id = old.org_id and s.id = old.slot_id;
    end if;
    return null;
  end if;
  perform 1 from public.slots as s where s.org_id = new.org_id and s.id in (old.slot_id, new.slot_id)
    order by s.id for update;
  if old.slot_id is not null and v_old_live then
    update public.slots as s set booked = s.booked - 1 where s.org_id = old.org_id and s.id = old.slot_id;
  end if;
  if new.slot_id is not null and v_new_live then
    perform private.book_slot_seat(new.org_id, new.drive_id, new.slot_id);
  end if;
  return null;
end
$$;
revoke execute on function private.invitations_book() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- reschedule_events (append-only; written only by the trigger below, R3-12)
-- ---------------------------------------------------------------------------------------------
create table public.reschedule_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  invitation_id uuid not null,
  actor_kind text not null check (actor_kind in ('org_user', 'candidate')),
  actor_user_id uuid null,
  from_slot_id uuid not null,
  to_slot_id uuid not null,
  reason_code text not null check (reason_code in ('candidate_self', 'recruiter', 'slot_cancelled')),
  occurred_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, invitation_id, workspace_id) references public.invitations (org_id, id, workspace_id)
    on delete restrict,
  foreign key (org_id, from_slot_id) references public.slots (org_id, id) on delete restrict,
  foreign key (org_id, to_slot_id) references public.slots (org_id, id) on delete restrict,
  check ((actor_kind = 'org_user') = (actor_user_id is not null))
);
create index reschedule_events_invitation_idx on public.reschedule_events (org_id, invitation_id);
create index reschedule_events_from_idx on public.reschedule_events (org_id, from_slot_id);
create index reschedule_events_to_idx on public.reschedule_events (org_id, to_slot_id);
alter table public.reschedule_events enable row level security;

create function private.reschedule_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'TRACE_APPEND_ONLY' using errcode = 'P0001';
end
$$;
revoke execute on function private.reschedule_events_append_only() from public, anon, authenticated, service_role;
create trigger reschedule_events_append_only before update or delete on public.reschedule_events
  for each row execute function private.reschedule_events_append_only();
create trigger reschedule_events_no_truncate before truncate on public.reschedule_events
  for each statement execute function private.reschedule_events_append_only();
alter table public.reschedule_events enable always trigger reschedule_events_append_only;
alter table public.reschedule_events enable always trigger reschedule_events_no_truncate;
-- As D1 consents (NOTES D-3): the FK checks from the slots side run SELECT ... FOR KEY SHARE on this table as its owner,
-- which needs UPDATE on one column; any UPDATE still hits the append-only trigger.
revoke update, delete, truncate on public.reschedule_events from postgres;
grant update (id) on public.reschedule_events to postgres;
grant select on public.reschedule_events to authenticated;
create policy reschedule_events_select_staff on public.reschedule_events for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));

create function private.invitations_reschedule_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate boolean := current_setting('role') = 'trace_api';
begin
  if old.slot_id is not null and new.slot_id is not null and new.slot_id is distinct from old.slot_id then
    insert into public.reschedule_events (org_id, workspace_id, invitation_id, actor_kind, actor_user_id, from_slot_id,
        to_slot_id, reason_code)
      values (new.org_id, new.workspace_id, new.id, case when v_candidate then 'candidate' else 'org_user' end,
        case when v_candidate then null else (select auth.uid()) end, old.slot_id, new.slot_id,
        case when v_candidate then 'candidate_self' else 'recruiter' end);
  end if;
  return null;
end
$$;
revoke execute on function private.invitations_reschedule_event() from public, anon, authenticated, service_role;

create trigger invitations_book after insert or update of slot_id, status on public.invitations
  for each row execute function private.invitations_book();
create trigger invitations_reschedule_event after update of slot_id on public.invitations
  for each row execute function private.invitations_reschedule_event();
create trigger invitations_upload_count after insert on public.invitations
  for each row execute function private.invite_uploads_count();
alter table public.invitations enable always trigger invitations_book;
alter table public.invitations enable always trigger invitations_reschedule_event;

-- invitation grants and the staff UPDATE policy (R3-9, R5-12 (6), R5-64 d, R5-66 d). The blind indexes, the person link
-- and the confirmation stay outside every SELECT grant; staff see people only through the api. upload_id and
-- upload_row_no let ingest_invite_batch (INVOKER) replay an invited row.
grant select (drive_id, upload_id, upload_row_no) on public.invitations to authenticated;
grant insert (drive_id, slot_id, upload_id, upload_row_no, candidate_ref_id, shared_contact_confirmed_by, language,
  channels) on public.invitations to authenticated;
grant update (slot_id, invite_resend_no) on public.invitations to authenticated;
grant select (drive_id, slot_id, session_grant_exp) on public.invitations to trace_api;
grant update (session_grant_exp) on public.invitations to trace_api;
drop policy invitations_update_staff on public.invitations;
create policy invitations_update_staff on public.invitations for update to authenticated
  using (
    (status in ('created', 'sent') or (drive_id is not null and status = 'otp_verified'))
    and workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[])
  )
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));

-- ---------------------------------------------------------------------------------------------
-- RPCs for staff (INVOKER: the caller's grants, RLS and every trigger apply; §9)
-- ---------------------------------------------------------------------------------------------
-- ingest_invite_batch (§3.3, §6.2; R2-5, R2-12, R3-4, R5-15, R5-52 d): <= 200 rows the api has validated and encrypted.
-- A row either carries an api-decided `reason` (recorded, nothing about the person stored) or the ciphertexts, blind
-- indexes, hints, adult answer (true or null), optional slotStartsAt (null = the earliest open future slot with space),
-- language, link token hash and confirmPhoneDuplicate. Each row runs in its own subtransaction: a refused row stores
-- nothing but its error row. Idempotent on (upload, rowNo) for final outcomes; a held row is replaced when re-sent.
create function public.ingest_invite_batch(p_upload uuid, p_rows jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_org uuid;
  v_ws uuid;
  v_drive uuid;
  v_ustatus text;
  v_test uuid;
  v_version uuid;
  v_mode public.drive_mode;
  v_out jsonb := '[]'::jsonb;
  v_row jsonb;
  v_no int;
  v_reason text;
  v_cand uuid;
  v_inv uuid;
  v_slot uuid;
  v_try uuid;
  v_constraint text;
  v_msg text;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'TRACE_GUARD: a batch is a non-empty array of rows' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception 'TRACE_GUARD: at most 200 rows per batch' using errcode = '22023';
  end if;
  select u.org_id, u.workspace_id, u.drive_id, u.status into v_org, v_ws, v_drive, v_ustatus
  from public.invite_uploads as u where u.id = p_upload;
  if not found then
    raise exception 'TRACE_GUARD: upload not found' using errcode = '42501';
  end if;
  if v_ustatus <> 'open' then
    raise exception 'TRACE_GUARD: the upload is not open' using errcode = '42501';
  end if;
  select d.test_id, d.default_test_version_id, d.mode into v_test, v_version, v_mode
  from public.drives as d where d.org_id = v_org and d.id = v_drive;

  for v_row in select e from jsonb_array_elements(p_rows) as e loop
    begin
      v_no := (v_row ->> 'rowNo')::int;
    exception when others then
      raise exception 'TRACE_GUARD: rowNo is a number' using errcode = '22023';
    end;
    if v_no is null or v_no < 1 or v_no > 5000 then
      raise exception 'TRACE_GUARD: rowNo is 1 to 5000' using errcode = '22023';
    end if;
    select i.id into v_inv from public.invitations as i
    where i.org_id = v_org and i.upload_id = p_upload and i.upload_row_no = v_no;
    if found then
      v_out := v_out || jsonb_build_array(jsonb_build_object('rowNo', v_no, 'invitationId', v_inv));
      continue;
    end if;
    select e.reason into v_reason from public.invite_upload_errors as e
    where e.org_id = v_org and e.upload_id = p_upload and e.row_no = v_no and not e.held;
    if found then
      v_out := v_out || jsonb_build_array(jsonb_build_object('rowNo', v_no, 'reason', v_reason));
      continue;
    end if;
    delete from public.invite_upload_errors as e
    where e.org_id = v_org and e.upload_id = p_upload and e.row_no = v_no and e.held;

    v_reason := v_row ->> 'reason';
    v_inv := null;
    v_cand := null;
    if v_reason is null then
      begin
        if v_row ? 'adult' and jsonb_typeof(v_row -> 'adult') not in ('null') and (v_row ->> 'adult') <> 'true' then
          raise exception 'TRACE_GUARD: a minor row is refused by the api, never inserted' using errcode = '22023';
        end if;
        insert into public.candidates (org_id, workspace_id, full_name_ct, key_version, contact_fingerprint)
          values (v_org, v_ws, v_row ->> 'fullNameCt', (v_row ->> 'keyVersion')::int, v_row ->> 'fingerprint')
          on conflict (org_id, workspace_id, contact_fingerprint) do nothing
          returning id into v_cand;
        if v_cand is null then
          select c.id into v_cand from public.candidates as c
          where c.org_id = v_org and c.workspace_id = v_ws and c.contact_fingerprint = v_row ->> 'fingerprint';
        end if;
        insert into public.candidate_contacts (org_id, candidate_id, workspace_id, email_ct, phone_ct, email_bidx,
            phone_bidx, email_hint, phone_hint, key_version)
          values (v_org, v_cand, v_ws, v_row ->> 'emailCt', v_row ->> 'phoneCt', v_row ->> 'emailBidx',
            v_row ->> 'phoneBidx', v_row ->> 'emailHint', v_row ->> 'phoneHint', (v_row ->> 'keyVersion')::int)
          on conflict (org_id, candidate_id) do nothing;
        v_slot := null;
        if v_mode = 'scheduled' and v_row ->> 'slotStartsAt' is not null then
          select s.id into v_slot from public.slots as s
          where s.org_id = v_org and s.drive_id = v_drive and s.starts_at = (v_row ->> 'slotStartsAt')::timestamptz;
          if not found then
            raise exception 'TRACE_GUARD: slot not in drive' using errcode = '42501';
          end if;
        end if;
        if v_mode = 'scheduled' and v_slot is null then
          -- Auto-assign (R5-52 d): the earliest open future slot with space, in file order; a slot filled meanwhile
          -- by a concurrent batch is skipped.
          for v_try in
            select s.id from public.slots as s
            where s.org_id = v_org and s.drive_id = v_drive and s.status = 'open' and s.starts_at > now()
              and s.booked < s.capacity
            order by s.starts_at, s.id
          loop
            begin
              insert into public.invitations (org_id, test_id, test_version_id, drive_id, slot_id, upload_id,
                  upload_row_no, candidate_ref_id, link_token_hash, adult_confirmed_by_inviter, expires_at,
                  shared_contact_confirmed_by, language)
                values (v_org, v_test, v_version, v_drive, v_try, p_upload, v_no, v_cand, v_row ->> 'linkTokenHash',
                  case when (v_row ->> 'adult') = 'true' then true end, now() + interval '1 day',
                  case when coalesce((v_row ->> 'confirmPhoneDuplicate')::boolean, false) then (select auth.uid()) end,
                  coalesce(v_row ->> 'language', 'en'))
                returning id into v_inv;
              exit;
            exception when insufficient_privilege then
              get stacked diagnostics v_msg = message_text;
              if v_msg <> 'TRACE_GUARD: slot full' then
                raise;
              end if;
            end;
          end loop;
          if v_inv is null then
            raise exception 'TRACE_GUARD: slot full' using errcode = '42501';
          end if;
        else
          insert into public.invitations (org_id, test_id, test_version_id, drive_id, slot_id, upload_id, upload_row_no,
              candidate_ref_id, link_token_hash, adult_confirmed_by_inviter, expires_at, shared_contact_confirmed_by,
              language)
            values (v_org, v_test, v_version, v_drive, v_slot, p_upload, v_no, v_cand, v_row ->> 'linkTokenHash',
              case when (v_row ->> 'adult') = 'true' then true end, now() + interval '1 day',
              case when coalesce((v_row ->> 'confirmPhoneDuplicate')::boolean, false) then (select auth.uid()) end,
              coalesce(v_row ->> 'language', 'en'))
            returning id into v_inv;
        end if;
      exception
        when unique_violation then
          get stacked diagnostics v_constraint = constraint_name;
          if v_constraint = 'invitations_one_live_drive_email' then
            v_reason := 'already_invited';
          else
            raise;
          end if;
        when insufficient_privilege then
          get stacked diagnostics v_msg = message_text;
          v_reason := case v_msg
            when 'TRACE_GUARD: phone shared with another candidate' then 'phone_shared'
            when 'TRACE_GUARD: slot full' then 'slot_full'
            when 'TRACE_GUARD: slot not open' then 'bad_slot'
            when 'TRACE_GUARD: slot not in drive' then 'bad_slot'
          end;
          if v_reason is null then
            raise;
          end if;
        when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
          or numeric_value_out_of_range then
          raise exception 'TRACE_GUARD: a row field has the wrong type' using errcode = '22023';
      end;
    end if;
    if v_reason is not null then
      insert into public.invite_upload_errors (org_id, upload_id, row_no, reason, held)
        values (v_org, p_upload, v_no, v_reason, v_reason = 'phone_shared')
        on conflict do nothing;
      v_out := v_out || jsonb_build_array(jsonb_build_object('rowNo', v_no, 'reason', v_reason,
        'held', v_reason = 'phone_shared'));
    else
      v_out := v_out || jsonb_build_array(jsonb_build_object('rowNo', v_no, 'invitationId', v_inv));
    end if;
  end loop;
  return v_out;
end
$$;
revoke execute on function public.ingest_invite_batch(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ingest_invite_batch(uuid, jsonb) to authenticated;

-- reschedule_invitation (§3.3, §6.6): the recruiter's move; the guard, the booking trigger and the event trigger apply.
create function public.reschedule_invitation(p_invitation uuid, p_to_slot uuid)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.invitations as i set slot_id = p_to_slot
  where i.id = p_invitation and i.drive_id is not null and i.status in ('created', 'sent')
  returning i.id into v_id;
  if v_id is null then
    raise exception 'TRACE_GUARD: invitation not found or not movable' using errcode = '42501';
  end if;
  return v_id;
end
$$;
revoke execute on function public.reschedule_invitation(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.reschedule_invitation(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- trace_api functions (bound to private.api_org_id(); drive rows only)
-- ---------------------------------------------------------------------------------------------
-- self_reschedule (M2-11, R2-8): once, up to 2 h before the current slot or after its window was missed, to a future
-- open slot of the same drive with space. Uses now(); no clock parameter.
create function private.self_reschedule(p_org uuid, p_invitation uuid, p_to_slot uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_drive uuid;
  v_slot uuid;
  v_status public.invitation_status;
  v_used smallint;
  v_allowed boolean;
  v_starts timestamptz;
  v_window int;
begin
  if p_org is null or p_org is distinct from private.api_org_id() then
    raise exception 'TRACE_GUARD: not the api org' using errcode = '42501';
  end if;
  select i.drive_id, i.slot_id, i.status, i.self_reschedules_used into v_drive, v_slot, v_status, v_used
  from public.invitations as i where i.org_id = p_org and i.id = p_invitation
  for update;
  if not found or v_drive is null or v_slot is null or v_status not in ('created', 'sent', 'otp_verified') then
    raise exception 'TRACE_GUARD: invitation not found' using errcode = '42501';
  end if;
  select d.self_reschedule_allowed into v_allowed from public.drives as d where d.org_id = p_org and d.id = v_drive;
  if not v_allowed then
    raise exception 'TRACE_GUARD: self-reschedule is off for this drive' using errcode = '42501';
  end if;
  if v_used >= 1 then
    raise exception 'TRACE_GUARD: reschedule_used' using errcode = '42501';
  end if;
  select s.starts_at, s.start_window_minutes into v_starts, v_window
  from public.slots as s where s.org_id = p_org and s.id = v_slot;
  if not (now() <= v_starts - interval '2 hours' or now() > v_starts + make_interval(mins => v_window)) then
    raise exception 'TRACE_GUARD: too_late_to_reschedule' using errcode = '42501';
  end if;
  if p_to_slot is not distinct from v_slot or not exists (
    select 1 from public.slots as s where s.org_id = p_org and s.id = p_to_slot and s.drive_id = v_drive
  ) then
    raise exception 'TRACE_GUARD: slot not in drive' using errcode = '42501';
  end if;
  update public.invitations as i set slot_id = p_to_slot, self_reschedules_used = 1
  where i.org_id = p_org and i.id = p_invitation;
  return p_to_slot;
end
$$;
revoke execute on function private.self_reschedule(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.self_reschedule(uuid, uuid, uuid) to trace_api;

-- invitation_window (R5-63, R5-66 d): scheduled [starts_at, +window], lobby lobby_opens_minutes early; open window
-- [opens_at, drive end], lobby from opens_at.
create function private.invitation_window(p_invitation uuid)
returns table (mode public.drive_mode, nb timestamptz, na timestamptz, lobby_opens_at timestamptz, drive_end timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.mode,
    case when d.mode = 'scheduled' then s.starts_at else d.opens_at end,
    case when d.mode = 'scheduled' then s.starts_at + make_interval(mins => s.start_window_minutes)
         else private.drive_end(d.org_id, d.id) end,
    case when d.mode = 'scheduled' then s.starts_at - make_interval(mins => s.lobby_opens_minutes) else d.opens_at end,
    private.drive_end(d.org_id, d.id)
  from public.invitations as i
  join public.drives as d on d.org_id = i.org_id and d.id = i.drive_id
  left join public.slots as s on s.org_id = i.org_id and s.id = i.slot_id
  where i.org_id = private.api_org_id() and i.id = p_invitation
$$;
revoke execute on function private.invitation_window(uuid) from public, anon, authenticated, service_role;
grant execute on function private.invitation_window(uuid) to trace_api;

-- invitation_recipient_ct (R5-47): a drive row's recipient ciphertext for the lobby / manage OTP email; never a D1 row.
create function private.invitation_recipient_ct(p_invitation uuid)
returns table (email_ct text, key_version int)
language sql
stable
security definer
set search_path = ''
as $$
  select c.email_ct, c.key_version
  from public.invitations as i
  join public.candidate_contacts as c on c.org_id = i.org_id and c.candidate_id = i.candidate_ref_id
  where i.org_id = private.api_org_id() and i.id = p_invitation and i.drive_id is not null
$$;
revoke execute on function private.invitation_recipient_ct(uuid) from public, anon, authenticated, service_role;
grant execute on function private.invitation_recipient_ct(uuid) to trace_api;

-- portal_slots (R5-24, E25, rule 5): the future open slots of the invitation's drive other than its own, with an
-- availability boolean only (never a count or another candidate).
create function private.portal_slots(p_org uuid, p_invitation uuid)
returns table (slot_id uuid, starts_at timestamptz, available boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.starts_at, s.booked < s.capacity
  from public.invitations as i
  join public.slots as s on s.org_id = i.org_id and s.drive_id = i.drive_id
  where p_org = private.api_org_id() and i.org_id = p_org and i.id = p_invitation
    and s.status = 'open' and s.starts_at > now() and s.id is distinct from i.slot_id
  order by s.starts_at, s.id
$$;
revoke execute on function private.portal_slots(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.portal_slots(uuid, uuid) to trace_api;

-- resolve_invitation_by_hash widened (R2-19): DROP + CREATE + re-GRANT (a return-type change cannot use create or
-- replace). Still never the contact, label or hash.
drop function private.resolve_invitation_by_hash(text);
create function private.resolve_invitation_by_hash(p_hash text)
returns table (
  org_id uuid,
  id uuid,
  status public.invitation_status,
  candidate_id uuid,
  session_id uuid,
  started_at timestamptz,
  test_id uuid,
  test_version_id uuid,
  expires_at timestamptz,
  drive_id uuid,
  slot_id uuid,
  slot_starts_at timestamptz,
  start_window_minutes int,
  lobby_opens_minutes int,
  self_reschedules_used smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.org_id, i.id, i.status, i.candidate_id, i.session_id, i.started_at, i.test_id, i.test_version_id,
    i.expires_at, i.drive_id, i.slot_id, s.starts_at, s.start_window_minutes, s.lobby_opens_minutes,
    i.self_reschedules_used
  from public.invitations as i
  left join public.slots as s on s.org_id = i.org_id and s.id = i.slot_id
  where p_hash ~ '^[0-9a-f]{64}$'
    and i.link_token_hash = p_hash
$$;
revoke execute on function private.resolve_invitation_by_hash(text) from public, anon, authenticated, service_role;
grant execute on function private.resolve_invitation_by_hash(text) to trace_api;
