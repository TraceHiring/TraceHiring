-- M1 migration d of d (spec specs/m1-test-authoring.md revision 5: §3.1 row M1-d, §3.2 member_invites, §3.3 memberships,
-- §3.4 provision_invited_member, §3.5, §4.5, §7 E26, E27; binding rows R2-6, R2-14, R2-15, R3-8, R5-14, R5-26, R5-30,
-- R5-35; M1-20, carried M0b D16a). Member invitations: the invite table (an HMAC of the address, never the address),
-- the invited-membership path through private.provision_invited_member() for the admin worker, and the invitee's own
-- acceptance (invited → active).
--
-- PROVISIONAL TIMESTAMP (R5-30): see 20261023010000_m1_bank.sql. Functions replaced here and re-derived from the newest
-- body at the D1 CLOSE merge: private.memberships_guard (newest body: 20261012075545_m0b_tenancy.sql; no later
-- migration replaces it, 20261013133832_m0b_owner_change_isolation.sql adds a separate isolation trigger and is
-- unchanged) and private.memberships_audit (same file; only the actor kind of worker writes changes).
--
-- Error contract (as M0b): guard refusal 42501 'TRACE_GUARD: <reason>'; missing invite 42501 (the worker cannot tell an
-- unknown invite from one of another org, R5-35); a live membership already held 23505 'TRACE_GUARD: …' (E26).
--
-- Data minimisation: the address is never stored. member_invites.email_hmac is HMAC-SHA-256 of the normalised address
-- with the server pepper MEMBER_INVITE_PEPPER (R2-14; dedupe only); the address and the display name travel in the
-- queue message only, and the display name lands in memberships.display_name (as M0b).

-- ---------------------------------------------------------------------------------------------
-- member_invites (§3.2, §4.5)
-- ---------------------------------------------------------------------------------------------
create table public.member_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  email_hmac text not null check (email_hmac ~ '^[0-9a-f]{64}$'),
  roles public.org_role[] not null check (private.valid_roles(roles)),
  workspace_id uuid null,
  status text not null default 'pending' check (status in ('pending', 'provisioned', 'failed', 'cancelled')),
  -- The invited membership, set with status 'provisioned' (exactly-once: a re-delivered job finds it).
  membership_id uuid null,
  invited_by uuid null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, membership_id) references public.memberships (org_id, id) on delete restrict,
  -- As memberships: owners and admins are org-wide (D16b).
  check (workspace_id is null or not (roles && '{org_owner,admin}'::public.org_role[])),
  check ((status = 'provisioned') = (membership_id is not null))
);
-- One open invite per address per org (dedupe by HMAC).
create unique index member_invites_one_pending on public.member_invites (org_id, email_hmac) where status = 'pending';
create index member_invites_workspace_idx on public.member_invites (org_id, workspace_id);
create index member_invites_membership_idx on public.member_invites (org_id, membership_id);
alter table public.member_invites enable row level security;

-- The roles CHECK runs as the writer: the admin worker updates invite status (R2-6).
grant execute on function private.valid_roles(public.org_role[]) to trace_admin_worker;

-- member_invites guard (R2-14): an admin creates and cancels; an invite naming org_owner only by an owner; the admin
-- worker marks failed, and marks provisioned only from private.provision_invited_member (it names the membership).
create function private.member_invites_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op boolean := private.is_operator();
  v_role text := current_setting('role');
begin
  if tg_op = 'INSERT' then
    if not v_op then
      if v_role <> 'authenticated' or not (new.org_id = any (private.my_org_ids('{admin}'))) then
        raise exception 'TRACE_GUARD: an org admin invites members' using errcode = '42501';
      end if;
      if 'org_owner' = any (new.roles) and not (new.org_id = any (private.my_org_ids('{org_owner}'))) then
        raise exception 'TRACE_GUARD: only an owner invites an owner' using errcode = '42501';
      end if;
    end if;
    new.status := 'pending';
    new.membership_id := null;
    new.invited_by := case when v_op then new.invited_by else (select auth.uid()) end;
    new.created_at := now();
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'TRACE_GUARD: invites are kept' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.email_hmac is distinct from old.email_hmac or new.roles is distinct from old.roles
    or new.workspace_id is distinct from old.workspace_id or new.invited_by is distinct from old.invited_by
    or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: an invite is immutable except its status' using errcode = '42501';
  end if;
  if new.status = old.status then
    if new.membership_id is distinct from old.membership_id then
      raise exception 'TRACE_GUARD: the membership is set when the invite is provisioned' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status <> 'pending' then
    raise exception 'TRACE_GUARD: a settled invite is final' using errcode = '42501';
  end if;
  if new.status = 'cancelled' then
    if not v_op and v_role <> 'authenticated' then
      raise exception 'TRACE_GUARD: an org admin cancels an invite' using errcode = '42501';
    end if;
  elsif new.status = 'failed' then
    if not v_op and v_role <> 'trace_admin_worker' then
      raise exception 'TRACE_GUARD: the invite worker marks an invite failed' using errcode = '42501';
    end if;
  elsif new.status = 'provisioned' then
    if not v_op and v_role <> 'trace_admin_worker' then
      raise exception 'TRACE_GUARD: the invite worker provisions an invite' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.memberships as m
      where m.org_id = new.org_id and m.id = new.membership_id and m.status = 'invited' and m.roles = new.roles
        and m.workspace_id is not distinct from new.workspace_id
    ) then
      raise exception 'TRACE_GUARD: a provisioned invite names its invited membership' using errcode = '42501';
    end if;
  end if;
  if new.status <> 'provisioned' and new.membership_id is not null then
    raise exception 'TRACE_GUARD: the membership is set when the invite is provisioned' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.member_invites_guard() from public, anon, authenticated, service_role;

-- R5-14, R5-26: ids, enums and role names only.
create function private.member_invites_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.actor_kind := case when current_setting('role') like 'trace\_%' then 'system'::public.actor_kind end;
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.org_id, 'member_invite.create', 'member_invites', new.id,
      jsonb_build_object('member_invite_id', new.id, 'roles', to_jsonb(new.roles)), new.workspace_id,
      p_actor_kind => v_kind);
    return null;
  end if;
  if new.status is not distinct from old.status then
    return null;
  end if;
  perform private.audit(new.org_id,
    case new.status
      when 'cancelled' then 'member_invite.cancel'
      when 'provisioned' then 'member_invite.provisioned'
      when 'failed' then 'member_invite.failed'
    end,
    'member_invites', new.id, jsonb_build_object('member_invite_id', new.id), new.workspace_id,
    p_actor_kind => v_kind);
  return null;
end
$$;
revoke execute on function private.member_invites_audit() from public, anon, authenticated, service_role;

create trigger member_invites_guard before insert or update or delete on public.member_invites
  for each row execute function private.member_invites_guard();
create trigger member_invites_audit after insert or update on public.member_invites
  for each row execute function private.member_invites_audit();
alter table public.member_invites enable always trigger member_invites_guard;

-- ---------------------------------------------------------------------------------------------
-- memberships guard v2 (§3.3, R2-15, R5-30). Re-derived from 20261012075545_m0b_tenancy.sql (the newest body). M0b
-- behaviour is unchanged except: (1) an 'invited' row is inserted by the admin worker inside
-- private.provision_invited_member only (the invite id is the transaction-local marker trace.provision_invite and the
-- pending invite must match the row); app callers still cannot insert 'invited', and the operator still can (fixtures);
-- (2) the invitee moves their own row invited → active and changes nothing else (R2-15); (3) an owner or admin may move
-- an invited row to removed (§4.5, E27). Nobody else moves invited → active, the operator included.
-- ---------------------------------------------------------------------------------------------
create or replace function private.memberships_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator boolean := private.is_operator();
  v_uid uuid := (select auth.uid());
  v_touches_owner boolean;
  v_invite uuid;
  v_inviter uuid;
  v_accepts boolean;
begin
  if tg_op = 'INSERT' then
    v_touches_owner := 'org_owner' = any (new.roles);
    new.created_by := v_uid;
    new.created_at := now();
    if new.status not in ('active', 'invited') then
      raise exception 'TRACE_GUARD: a membership starts active' using errcode = '42501';
    end if;
    new.removed_at := null;
    -- Write-skew guard [D9]: lock first, so the checks below (each a fresh READ COMMITTED snapshot) see any
    -- concurrent owner change that committed while we waited (M0b database review B0-DB2).
    if v_touches_owner then
      perform 1 from public.orgs where id = new.org_id for no key update;
    end if;
    -- M1-20: the invite worker's path. trace_admin_worker holds no INSERT grant on memberships, so it reaches here only
    -- through private.provision_invited_member, which sets the marker to the invite it provisions.
    if current_setting('role') = 'trace_admin_worker' then
      v_invite := nullif(current_setting('trace.provision_invite', true), '')::uuid;
      select i.invited_by into v_inviter
      from public.member_invites as i
      where i.id = v_invite and i.org_id = new.org_id and i.org_id = private.job_org_id() and i.status = 'pending'
        and i.roles = new.roles and i.workspace_id is not distinct from new.workspace_id;
      if v_invite is null or not found then
        raise exception 'TRACE_GUARD: an invited membership needs its pending invite' using errcode = '42501';
      end if;
      if new.status <> 'invited' or new.team_id is not null then
        raise exception 'TRACE_GUARD: the invite worker inserts an invited membership only' using errcode = '42501';
      end if;
      new.created_by := v_inviter;
      return new;
    end if;
    if not v_operator then
      if new.status <> 'active' then
        raise exception 'TRACE_GUARD: an invited membership is created by the invite worker only' using errcode = '42501';
      end if;
      if new.user_id = v_uid then
        raise exception 'TRACE_GUARD: nobody adds themselves' using errcode = '42501';
      end if;
      if not (new.org_id = any (private.my_org_ids('{org_owner,admin}'))) then
        raise exception 'TRACE_GUARD: owner or admin required' using errcode = '42501';
      end if;
      if v_touches_owner and not (new.org_id = any (private.my_org_ids('{org_owner}'))) then
        raise exception 'TRACE_GUARD: only an owner adds an owner' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE (rule 4: no DELETE grant exists).
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.user_id is distinct from old.user_id or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: membership id, org, user, creator and created_at are immutable'
      using errcode = '42501';
  end if;
  if old.status = 'removed' then
    raise exception 'TRACE_GUARD: a removed membership is final' using errcode = '42501';
  end if;
  v_accepts := old.status = 'invited' and new.status = 'active';
  if new.status is distinct from old.status then
    if v_accepts then
      -- R2-15: only the invitee accepts, and accepting changes the status only.
      if v_operator or v_uid is null or old.user_id is distinct from v_uid then
        raise exception 'TRACE_GUARD: only the invitee accepts an invitation' using errcode = '42501';
      end if;
      if new.roles is distinct from old.roles or new.workspace_id is distinct from old.workspace_id
        or new.team_id is distinct from old.team_id or new.display_name is distinct from old.display_name then
        raise exception 'TRACE_GUARD: accepting an invitation changes the status only' using errcode = '42501';
      end if;
      -- R2-14 (security review M-1): an invitation provisioned from an invite is accepted only while its inviter is
      -- still an active admin (an owner for an owner invitation) of the active org, as at provisioning; an invited row
      -- never expires, so a removed or suspended admin leaves no access behind.
      select i.invited_by into v_inviter from public.member_invites as i
      where i.org_id = old.org_id and i.membership_id = old.id;
      if found and not exists (
        select 1 from public.memberships as m
        join public.orgs as o on o.id = m.org_id
        where m.org_id = old.org_id and m.user_id = v_inviter and m.status = 'active' and o.status = 'active'
          and m.roles && '{org_owner,admin}'::public.org_role[]
          and (not ('org_owner' = any (old.roles)) or 'org_owner' = any (m.roles))
      ) then
        raise exception 'TRACE_GUARD: the inviter is no longer an active admin or owner' using errcode = '42501';
      end if;
    elsif old.status = 'invited' and new.status = 'removed' then
      null;  -- §4.5, E27: an owner or admin (checked below) withdraws an unaccepted invitation.
    elsif old.status = 'invited' or new.status = 'invited'
      or not (
        (old.status = 'active' and new.status in ('suspended', 'removed'))
        or (old.status = 'suspended' and new.status in ('active', 'removed'))
      ) then
      raise exception 'TRACE_GUARD: status change not allowed' using errcode = '42501';
    end if;
  end if;
  new.removed_at := case when new.status = 'removed' then coalesce(old.removed_at, now()) end;

  v_touches_owner := 'org_owner' = any (old.roles) or 'org_owner' = any (new.roles);

  -- Write-skew guard [D9]: lock before the role checks (B0-DB2, as for INSERT above).
  if v_touches_owner or new.status is distinct from old.status then
    perform 1 from public.orgs where id = new.org_id for no key update;
  end if;

  if not v_operator then
    if old.user_id = v_uid then
      if v_accepts then
        return new;
      end if;
      if old.status = 'invited' then
        raise exception 'TRACE_GUARD: an invited member can only accept' using errcode = '42501';
      end if;
      if new.roles is distinct from old.roles or new.status is distinct from old.status
        or new.workspace_id is distinct from old.workspace_id
        or new.team_id is distinct from old.team_id then
        raise exception 'TRACE_GUARD: nobody changes their own roles, status or scope'
          using errcode = '42501';
      end if;
    else
      if not (old.org_id = any (private.my_org_ids('{org_owner,admin}'))) then
        raise exception 'TRACE_GUARD: owner or admin required' using errcode = '42501';
      end if;
      if v_touches_owner and not (old.org_id = any (private.my_org_ids('{org_owner}'))) then
        raise exception 'TRACE_GUARD: only an owner edits an owner' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end
$$;

-- memberships_audit v2: the M0b body and detail shapes unchanged; a write by a trace_* worker role (the invite worker)
-- is recorded with actor_kind 'system' (R2-22), not as an org user without a user id.
create or replace function private.memberships_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[] := '{}';
  v_kind public.actor_kind := case when current_setting('role') like 'trace\_%' then 'system'::public.actor_kind end;
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.org_id, 'membership.create', 'memberships', new.id,
      jsonb_build_object('roles', to_jsonb(new.roles), 'status', new.status,
        'workspace_id', new.workspace_id, 'team_id', new.team_id),
      new.workspace_id, p_actor_kind => v_kind);
    return null;
  end if;
  if new.status = 'removed' and old.status <> 'removed' then
    perform private.audit(new.org_id, 'membership.remove', 'memberships', new.id,
      jsonb_build_object('old_status', old.status), new.workspace_id, p_actor_kind => v_kind);
    return null;
  end if;
  if new.roles is distinct from old.roles then v_changed := array_append(v_changed, 'roles'); end if;
  if new.status is distinct from old.status then v_changed := array_append(v_changed, 'status'); end if;
  if new.workspace_id is distinct from old.workspace_id then
    v_changed := array_append(v_changed, 'workspace_id');
  end if;
  if new.team_id is distinct from old.team_id then v_changed := array_append(v_changed, 'team_id'); end if;
  if new.display_name is distinct from old.display_name then
    v_changed := array_append(v_changed, 'display_name');
  end if;
  if cardinality(v_changed) > 0 then
    perform private.audit(new.org_id, 'membership.update', 'memberships', new.id,
      jsonb_build_object('old_roles', to_jsonb(old.roles), 'new_roles', to_jsonb(new.roles),
        'old_status', old.status, 'new_status', new.status, 'changed', to_jsonb(v_changed)),
      new.workspace_id, p_actor_kind => v_kind);
  end if;
  return null;
end
$$;

-- R2-15, R3-8: the invitee accepts at any aal (the membership then counts only at its roles' aal, ADR-029).
create policy memberships_update_invitee on public.memberships for update to authenticated
  using (user_id = (select auth.uid()) and status = 'invited')
  with check (status = 'active' and user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- private.provision_invited_member (§3.4, M1-20, R2-14, R5-35, E26). EXECUTE trace_admin_worker only. The worker has
-- created (or found, E26) the Auth user with the Supabase admin API and passes its id. Roles and workspace come only
-- from the invite row. Re-checks that the inviter is still an active admin (an owner, for an owner invite) of an active
-- org. Inserts the 'invited' membership (audit membership.create {roles, status: invited, workspace_id, team_id}) and
-- marks the invite provisioned (audit member_invite.provisioned). Idempotent: a re-delivered job for an invite already
-- provisioned for the same user returns the same membership id.
-- ---------------------------------------------------------------------------------------------
create function private.provision_invited_member(p_invite uuid, p_user uuid, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.member_invites;
  v_member uuid;
begin
  select i.* into v_inv from public.member_invites as i
  where i.id = p_invite and i.org_id = private.job_org_id()
  for update;
  if not found then
    raise exception 'TRACE_GUARD: member invite not found in the job org' using errcode = '42501';
  end if;
  if v_inv.status = 'provisioned' then
    select m.id into v_member from public.memberships as m
    where m.org_id = v_inv.org_id and m.id = v_inv.membership_id and m.user_id = p_user;
    if found then
      return v_member;
    end if;
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'TRACE_GUARD: the invite is not pending' using errcode = '42501';
  end if;
  -- Security review L-1: checked before the insert, so a failing CHECK never echoes the name in an error detail.
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 120 then
    raise exception 'TRACE_BAD_INPUT: display name' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships as m
    join public.orgs as o on o.id = m.org_id
    where m.org_id = v_inv.org_id and m.user_id = v_inv.invited_by and m.status = 'active' and o.status = 'active'
      and m.roles && '{org_owner,admin}'::public.org_role[]
      and (not ('org_owner' = any (v_inv.roles)) or 'org_owner' = any (m.roles))
  ) then
    raise exception 'TRACE_GUARD: the inviter is no longer an active admin or owner' using errcode = '42501';
  end if;
  -- E26: the Auth user may exist already; one live membership per org (M0b index), reported before the index would.
  if exists (
    select 1 from public.memberships as m
    where m.org_id = v_inv.org_id and m.user_id = p_user and m.status <> 'removed'
  ) then
    raise exception 'TRACE_GUARD: the user already has a membership in this org' using errcode = '23505';
  end if;
  perform set_config('trace.provision_invite', p_invite::text, true);
  insert into public.memberships (org_id, user_id, roles, workspace_id, display_name, status)
    values (v_inv.org_id, p_user, v_inv.roles, v_inv.workspace_id, p_display_name, 'invited')
    returning id into v_member;
  perform set_config('trace.provision_invite', '', true);
  update public.member_invites set status = 'provisioned', membership_id = v_member
    where org_id = v_inv.org_id and id = p_invite;
  return v_member;
end
$$;
revoke execute on function private.provision_invited_member(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.provision_invited_member(uuid, uuid, text) to trace_admin_worker;

-- ---------------------------------------------------------------------------------------------
-- Grants and policies (§3.5): owners and admins read; admins (aal2, through my_org_ids) create and cancel; the admin
-- worker reads and updates the status of its job org's invites (R5-35). Nothing for recruiters, reviewers, hiring
-- managers, anon, service_role or the candidate roles.
-- ---------------------------------------------------------------------------------------------
grant select on public.member_invites to authenticated;
grant insert (org_id, email_hmac, roles, workspace_id) on public.member_invites to authenticated;
grant update (status) on public.member_invites to authenticated;
create policy member_invites_select_owner_admin on public.member_invites for select to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]));
create policy member_invites_insert_admin on public.member_invites for insert to authenticated
  with check (org_id = any ((select private.my_org_ids('{admin}'))::uuid[]));
create policy member_invites_update_admin on public.member_invites for update to authenticated
  using (status = 'pending' and org_id = any ((select private.my_org_ids('{admin}'))::uuid[]))
  with check (status = 'cancelled' and org_id = any ((select private.my_org_ids('{admin}'))::uuid[]));
grant select, update (status) on public.member_invites to trace_admin_worker;
create policy member_invites_select_admin_worker on public.member_invites for select to trace_admin_worker
  using (org_id = (select private.job_org_id()));
create policy member_invites_update_admin_worker on public.member_invites for update to trace_admin_worker
  using (org_id = (select private.job_org_id()))
  with check (org_id = (select private.job_org_id()));
