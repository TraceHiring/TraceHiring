-- M0b tenancy (spec specs/m0b-tenancy.md §2–§3): enums, the 8 tables, private helpers, guard and
-- audit triggers, audit partitions, grants and policies. Every rule of M0a spec §8.2 applies.
--
-- Error contract (the rls_* tests rely on it):
--   guard refusal                 SQLSTATE 42501, message 'TRACE_GUARD: <reason>'
--   operator-only function        SQLSTATE 42501, message 'TRACE_OPERATOR_ONLY'
--   last active owner             SQLSTATE 23514, message 'TRACE_LAST_OWNER' (deferred constraint trigger)
--   staff row outside trace_internal  SQLSTATE 23514, message 'TRACE_STAFF_ORG'
--   audit_log UPDATE/DELETE/TRUNCATE  SQLSTATE P0001, message 'TRACE_APPEND_ONLY'
--   create_audit_partition        22023 'TRACE_BAD_MONTH'; 55000 'TRACE_CURRENT_PARTITION_MISSING'

-- ---------------------------------------------------------------------------------------------
-- 3.1 Enums
-- ---------------------------------------------------------------------------------------------
create type public.org_kind as enum ('customer', 'trace_library', 'trace_internal');
create type public.org_status as enum ('active', 'suspended');
create type public.data_residency as enum ('r2_apac', 's3_mumbai');
create type public.workspace_kind as enum ('default', 'client');
create type public.org_role as enum ('org_owner', 'admin', 'recruiter', 'reviewer', 'hiring_manager');
create type public.membership_status as enum ('invited', 'active', 'suspended', 'removed');
create type public.actor_kind as enum ('org_user', 'candidate', 'staff', 'system');
create type public.staff_grant_scope as enum ('support_read');

-- ---------------------------------------------------------------------------------------------
-- Immutable helpers used by CHECK constraints and by the operator predicate
-- ---------------------------------------------------------------------------------------------

-- 1–5 roles, no nulls, no duplicates. A CHECK runs with the writer's privileges, so
-- authenticated gets EXECUTE (D7).
create function private.valid_roles(p_roles public.org_role[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_roles is not null
    and cardinality(p_roles) between 1 and 5
    and array_position(p_roles, null) is null
    and cardinality(p_roles) = (select count(distinct r) from unnest(p_roles) as r)
$$;
revoke execute on function private.valid_roles(public.org_role[]) from public, anon, authenticated, service_role;
grant execute on function private.valid_roles(public.org_role[]) to authenticated;

-- details is an object whose top-level keys match ^[a-z_]{1,40}$. Only definer code (owner
-- postgres) writes audit rows, so nobody else needs EXECUTE.
create function private.audit_details_ok(p_details jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_details) = 'object'
    and octet_length(p_details::text) <= 4096
    and not exists (
      select 1 from jsonb_object_keys(p_details) as k where k !~ '^[a-z_]{1,40}$'
    )
$$;
revoke execute on function private.audit_details_ok(jsonb) from public, anon, authenticated, service_role;

-- The operator path (§2.8): a plain `postgres` session with no SET ROLE and no JWT. Kept as one
-- immutable function so its truth table is tested directly (rls_memberships).
create function private.is_operator_session(p_session_user name, p_role text, p_uid uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_session_user = 'postgres' and p_role in ('none', 'postgres') and p_uid is null, false)
$$;
revoke execute on function private.is_operator_session(name, text, uuid) from public, anon, authenticated, service_role;

-- Inside a SECURITY DEFINER function the effective user is always the owner, so the caller is
-- read from session_user and the role setting, never from the effective user.
create function private.is_operator()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.is_operator_session(session_user, current_setting('role'), (select auth.uid()))
$$;
revoke execute on function private.is_operator() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 3.2 orgs
-- ---------------------------------------------------------------------------------------------
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid generated always as (id) stored not null,
  kind public.org_kind not null,
  name text not null check (char_length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  data_residency public.data_residency not null default 'r2_apac',
  status public.org_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
alter table public.orgs enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 3.3 workspaces
-- ---------------------------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 200),
  kind public.workspace_kind not null default 'client',
  is_default boolean not null default false,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  check (is_default = (kind = 'default'))
);
create unique index workspaces_one_default on public.workspaces (org_id) where is_default;
alter table public.workspaces enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 3.4 teams
-- ---------------------------------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, name)
);
alter table public.teams enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 3.5 memberships
-- ---------------------------------------------------------------------------------------------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  roles public.org_role[] not null check (private.valid_roles(roles)),
  workspace_id uuid null,
  team_id uuid null,
  display_name text not null check (char_length(display_name) between 1 and 120),
  status public.membership_status not null default 'active',
  created_by uuid null,
  created_at timestamptz not null default now(),
  removed_at timestamptz null,
  unique (org_id, id),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, team_id) references public.teams (org_id, id) on delete restrict,
  check ((removed_at is not null) = (status = 'removed')),
  -- Owners and admins are org-wide (D16b).
  check (workspace_id is null or not (roles && '{org_owner,admin}'::public.org_role[]))
);
create unique index memberships_one_live_per_user on public.memberships (org_id, user_id)
  where status <> 'removed';
create index memberships_user_idx on public.memberships (user_id)
  include (org_id, roles, status, workspace_id);
create index memberships_workspace_idx on public.memberships (org_id, workspace_id);
create index memberships_team_idx on public.memberships (org_id, team_id);
alter table public.memberships enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 3.6 audit_log (partitioned by month on occurred_at, §2.4)
-- ---------------------------------------------------------------------------------------------
create table public.audit_log (
  id uuid not null default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  actor_kind public.actor_kind not null,
  actor_user_id uuid null,
  actor_roles public.org_role[] not null default '{}',
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$' and char_length(action) <= 80),
  object_table text null check (object_table is null or object_table ~ '^[a-z_.]{1,63}$'),
  object_id uuid null,
  candidate_id uuid null,
  workspace_id uuid null,
  request_id uuid null,
  staff_grant_id uuid null,
  details jsonb not null default '{}' check (private.audit_details_ok(details)),
  primary key (org_id, occurred_at, id)
) partition by range (occurred_at);
create index audit_log_org_time_idx on public.audit_log (org_id, occurred_at desc);
alter table public.audit_log enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 3.7 platform_staff and staff_access_grants
-- ---------------------------------------------------------------------------------------------
create table public.platform_staff (
  user_id uuid primary key references auth.users (id) on delete restrict,
  org_id uuid not null references public.orgs (id) on delete restrict,
  active boolean not null default true,
  capabilities text[] not null default '{}'
    check (capabilities <@ '{support_read}'::text[] and array_position(capabilities, null) is null),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
alter table public.platform_staff enable row level security;

create table public.staff_access_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  staff_user_id uuid not null references public.platform_staff (user_id) on delete restrict,
  ticket_ref text not null check (ticket_ref ~ '^[A-Za-z0-9_-]{3,64}$'),
  scope public.staff_grant_scope not null default 'support_read',
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_by uuid not null references public.platform_staff (user_id) on delete restrict,
  revoked_at timestamptz null,
  revoked_by uuid null,
  unique (org_id, id),
  check (expires_at > granted_at and expires_at <= granted_at + interval '4 hours'),
  check (approved_by <> staff_user_id)
);
create index staff_access_grants_staff_idx on public.staff_access_grants (staff_user_id);
create index staff_access_grants_approver_idx on public.staff_access_grants (approved_by);
alter table public.staff_access_grants enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 3.8 idempotency_keys (worker-only ledger, ADR-029)
-- ---------------------------------------------------------------------------------------------
create table public.idempotency_keys (
  org_id uuid not null references public.orgs (id) on delete restrict,
  scope text not null check (char_length(scope) between 1 and 64),
  key text not null check (char_length(key) between 1 and 200),
  first_seen_at timestamptz not null default now(),
  result_ref text null check (result_ref is null or char_length(result_ref) <= 200),
  expires_at timestamptz not null,
  primary key (org_id, scope, key)
);
alter table public.idempotency_keys enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 2.1–2.2 Authorisation helpers: roles come from tables, the JWT gives only sub, aal and amr.
-- ---------------------------------------------------------------------------------------------

-- Whether a membership holding p_roles counts for the current JWT (§2.2): a privileged role needs
-- aal2; otherwise aal2, or aal1 when the first factor was email OTP and no password was used.
create function private.membership_counts(p_roles public.org_role[])
returns boolean
language sql
stable
set search_path = ''
as $$
  with c as (
    select (select auth.jwt()) as j
  ), amr as (
    select e ->> 'method' as method
    from c,
      jsonb_array_elements(
        case when jsonb_typeof(c.j -> 'amr') = 'array' then c.j -> 'amr' else '[]'::jsonb end
      ) as e
    where jsonb_typeof(e) = 'object'
  )
  select coalesce(
    case
      when (select j ->> 'aal' from c) = 'aal2' then true
      when p_roles && '{org_owner,admin,reviewer}'::public.org_role[] then false
      when (select j ->> 'aal' from c) = 'aal1' then
        exists (select 1 from amr where method in ('otp', 'magiclink'))
        and not exists (select 1 from amr where method = 'password')
      else false
    end,
    false
  )
$$;
revoke execute on function private.membership_counts(public.org_role[]) from public, anon, authenticated, service_role;

-- The orgs in which the caller holds any of p_roles through an active membership that counts,
-- in an active org. Returns '{}' for no caller.
create function private.my_org_ids(p_roles public.org_role[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct m.org_id), '{}'::uuid[])
  from public.memberships as m
  join public.orgs as o on o.id = m.org_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and o.status = 'active'
    and m.roles && p_roles
    and private.membership_counts(m.roles)
$$;
revoke execute on function private.my_org_ids(public.org_role[]) from public, anon, authenticated, service_role;
grant execute on function private.my_org_ids(public.org_role[]) to authenticated;

-- The workspaces the caller may see through such a membership: every workspace of the org for an
-- org-wide membership, else only the membership's own workspace (D16b).
create function private.my_workspace_ids(p_roles public.org_role[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct w.id), '{}'::uuid[])
  from public.memberships as m
  join public.orgs as o on o.id = m.org_id
  join public.workspaces as w
    on w.org_id = m.org_id and (m.workspace_id is null or w.id = m.workspace_id)
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and o.status = 'active'
    and m.roles && p_roles
    and private.membership_counts(m.roles)
$$;
revoke execute on function private.my_workspace_ids(public.org_role[]) from public, anon, authenticated, service_role;
grant execute on function private.my_workspace_ids(public.org_role[]) to authenticated;

-- The caller's roles in an org right now (for actor_roles), whatever the aal.
create function private.caller_roles(p_org_id uuid)
returns public.org_role[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.roles from public.memberships as m
     where m.org_id = p_org_id and m.user_id = (select auth.uid()) and m.status = 'active'
     limit 1),
    '{}'::public.org_role[]
  )
$$;
revoke execute on function private.caller_roles(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2.4 Audit writer: the only path that inserts audit rows. No EXECUTE grant.
-- ---------------------------------------------------------------------------------------------
create function private.audit(
  p_org_id uuid,
  p_action text,
  p_object_table text,
  p_object_id uuid,
  p_details jsonb,
  p_workspace_id uuid default null,
  p_actor_kind public.actor_kind default null,
  p_actor_user_id uuid default null,
  p_actor_roles public.org_role[] default null,
  p_staff_grant_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator boolean := private.is_operator();
  v_kind public.actor_kind;
  v_user uuid;
  v_roles public.org_role[];
begin
  if p_actor_kind is not null then
    v_kind := p_actor_kind;
    v_user := p_actor_user_id;
    v_roles := coalesce(p_actor_roles, '{}');
  elsif v_operator then
    v_kind := 'system';
    v_user := null;
    v_roles := '{}';
  else
    v_kind := 'org_user';
    v_user := (select auth.uid());
    v_roles := private.caller_roles(p_org_id);
  end if;

  insert into public.audit_log (
    org_id, actor_kind, actor_user_id, actor_roles, action, object_table, object_id,
    workspace_id, request_id, staff_grant_id, details
  ) values (
    p_org_id, v_kind, v_user, v_roles, p_action, p_object_table, p_object_id,
    p_workspace_id, nullif(current_setting('trace.request_id', true), '')::uuid,
    p_staff_grant_id, coalesce(p_details, '{}'::jsonb)
  );
end
$$;
revoke execute on function private.audit(uuid, text, text, uuid, jsonb, uuid, public.actor_kind, uuid, public.org_role[], uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2.4 Append-only audit log: triggers, per-partition rules, partitions
-- ---------------------------------------------------------------------------------------------
create function private.audit_log_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'TRACE_APPEND_ONLY' using errcode = 'P0001';
end
$$;
revoke execute on function private.audit_log_append_only() from public, anon, authenticated, service_role;

-- RLS on, no non-owner write privilege, the owner's UPDATE/DELETE/TRUNCATE revoked, the TRUNCATE
-- trigger (TRUNCATE triggers are not inherited, DC-5) and ALWAYS mode on every trigger (D3).
create function private.apply_audit_partition_rules(p_rel regclass)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  execute format('alter table %s enable row level security', p_rel);
  execute format(
    'revoke all on table %s from public, anon, authenticated, service_role, trace_worker, '
    'trace_quality_worker, trace_integrity_worker, trace_candidate, trace_candidate_gateway',
    p_rel
  );
  execute format('revoke update, delete, truncate on table %s from postgres', p_rel);
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = p_rel and tgname = 'audit_log_no_truncate'
  ) then
    execute format(
      'create trigger audit_log_no_truncate before truncate on %s '
      'for each statement execute function private.audit_log_append_only()',
      p_rel
    );
  end if;
  execute format('alter table %s enable always trigger audit_log_no_truncate', p_rel);
  if p_rel <> 'public.audit_log'::regclass then
    execute format('alter table %s enable always trigger audit_log_no_update_delete', p_rel);
  end if;
end
$$;
revoke execute on function private.apply_audit_partition_rules(regclass) from public, anon, authenticated, service_role;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function private.audit_log_append_only();
alter table public.audit_log enable always trigger audit_log_no_update_delete;
select private.apply_audit_partition_rules('public.audit_log'::regclass);

create table public.audit_log_default partition of public.audit_log default;
select private.apply_audit_partition_rules('public.audit_log_default'::regclass);

-- Creates the UTC month partition p_month (a month start). If rows of that month sit in DEFAULT,
-- moves them in one transaction (§2.4 steps 1–7) and writes one audit.repartition per org whose
-- rows moved. Owner-only: no EXECUTE grant.
create function private.create_audit_partition(p_month date)
returns void
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_name text;
  v_from timestamptz;
  v_to timestamptz;
  v_current date := date_trunc('month', now(), 'UTC')::date;
  v_rel regclass;
  r record;
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'TRACE_BAD_MONTH' using errcode = '22023';
  end if;
  v_name := 'audit_log_' || to_char(p_month, 'YYYY_MM');
  if to_regclass('public.' || v_name) is not null then
    return;
  end if;
  v_from := p_month::timestamp at time zone 'UTC';
  v_to := (p_month + interval '1 month')::timestamp at time zone 'UTC';

  if not exists (
    select 1 from public.audit_log_default where occurred_at >= v_from and occurred_at < v_to
  ) then
    execute format(
      'create table public.%I partition of public.audit_log for values from (%L) to (%L)',
      v_name, v_from, v_to
    );
    perform private.apply_audit_partition_rules(format('public.%I', v_name)::regclass);
    return;
  end if;

  -- Recovery. 1: the repartition events must not land in DEFAULT themselves.
  if p_month <> v_current
    and to_regclass('public.audit_log_' || to_char(v_current, 'YYYY_MM')) is null then
    raise exception 'TRACE_CURRENT_PARTITION_MISSING' using errcode = '55000';
  end if;
  -- 2: lock, detach and rename the old DEFAULT.
  lock table public.audit_log in access exclusive mode;
  alter table public.audit_log detach partition public.audit_log_default;
  alter table public.audit_log_default rename to audit_log_default_old;
  -- 3: the month partition.
  execute format(
    'create table public.%I partition of public.audit_log for values from (%L) to (%L)',
    v_name, v_from, v_to
  );
  perform private.apply_audit_partition_rules(format('public.%I', v_name)::regclass);
  -- 4: a new empty DEFAULT.
  create table public.audit_log_default partition of public.audit_log default;
  perform private.apply_audit_partition_rules('public.audit_log_default'::regclass);
  -- 5: one INSERT routes the month's rows to the month and the rest to the new DEFAULT.
  insert into public.audit_log select * from public.audit_log_default_old;
  -- 6: one event per org whose rows moved into the month.
  for r in
    select o.org_id, count(*) as n
    from public.audit_log_default_old as o
    where o.occurred_at >= v_from and o.occurred_at < v_to
    group by o.org_id
  loop
    perform private.audit(
      r.org_id, 'audit.repartition', 'audit_log', null,
      jsonb_build_object('month', to_char(p_month, 'YYYY-MM'), 'rows_moved', r.n),
      p_actor_kind => 'system'
    );
  end loop;
  -- 7: drop the old table (DDL; its TRUNCATE trigger does not fire on DROP).
  drop table public.audit_log_default_old;
end
$$;
revoke execute on function private.create_audit_partition(date) from public, anon, authenticated, service_role;

-- The fixed range 2026-10 … 2027-12. Never now(): the same migration builds the same database on
-- any date (R6). Keeping partitions ahead is the M7 maintenance job's duty.
do $$
declare
  m date := date '2026-10-01';
begin
  while m <= date '2027-12-01' loop
    perform private.create_audit_partition(m);
    m := (m + interval '1 month')::date;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 3.2 orgs guard and audit [N7]
-- ---------------------------------------------------------------------------------------------
create function private.orgs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Never read new.org_id here: a stored generated column is NULL in a BEFORE trigger (E3).
  if new.id is distinct from old.id or new.kind is distinct from old.kind
    or new.slug is distinct from old.slug or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: orgs id, kind, slug and created_at are immutable' using errcode = '42501';
  end if;
  if private.is_operator() then
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'TRACE_GUARD: only the operator changes org status' using errcode = '42501';
  end if;
  if not (old.id = any (private.my_org_ids('{org_owner,admin}'))) then
    raise exception 'TRACE_GUARD: owner or admin required' using errcode = '42501';
  end if;
  if new.data_residency is distinct from old.data_residency
    and not (old.id = any (private.my_org_ids('{org_owner}'))) then
    raise exception 'TRACE_GUARD: only an owner changes data residency' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.orgs_guard() from public, anon, authenticated, service_role;

create function private.orgs_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[] := '{}';
begin
  if new.name is distinct from old.name then v_changed := v_changed || 'name'; end if;
  if new.data_residency is distinct from old.data_residency then
    v_changed := v_changed || 'data_residency';
  end if;
  if new.status is distinct from old.status then v_changed := v_changed || 'status'; end if;
  if cardinality(v_changed) > 0 then
    perform private.audit(new.org_id, 'org.update', 'orgs', new.id,
      jsonb_build_object('changed', to_jsonb(v_changed)));
  end if;
  return null;
end
$$;
revoke execute on function private.orgs_audit() from public, anon, authenticated, service_role;

create trigger orgs_guard before update on public.orgs
  for each row execute function private.orgs_guard();
create trigger orgs_audit after update on public.orgs
  for each row execute function private.orgs_audit();

-- ---------------------------------------------------------------------------------------------
-- 3.3 workspaces guard and audit
-- ---------------------------------------------------------------------------------------------
create function private.workspaces_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not private.is_operator() then
      if new.kind <> 'client' then
        raise exception 'TRACE_GUARD: only client workspaces can be added' using errcode = '42501';
      end if;
      if not (new.org_id = any (private.my_org_ids('{org_owner,admin}'))) then
        raise exception 'TRACE_GUARD: owner or admin required' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.kind is distinct from old.kind or new.is_default is distinct from old.is_default
    or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: workspace id, org, kind, default flag and created_at are immutable'
      using errcode = '42501';
  end if;
  if new.is_default and new.archived_at is not null then
    raise exception 'TRACE_GUARD: the default workspace cannot be archived' using errcode = '42501';
  end if;
  if not private.is_operator() and not (old.org_id = any (private.my_org_ids('{org_owner,admin}'))) then
    raise exception 'TRACE_GUARD: owner or admin required' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.workspaces_guard() from public, anon, authenticated, service_role;

create function private.workspaces_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.org_id, 'workspace.create', 'workspaces', new.id,
      jsonb_build_object('kind', new.kind), new.id);
    return null;
  end if;
  if old.archived_at is null and new.archived_at is not null then
    perform private.audit(new.org_id, 'workspace.archive', 'workspaces', new.id,
      jsonb_build_object('kind', new.kind), new.id);
    return null;
  end if;
  if new.name is distinct from old.name then v_changed := v_changed || 'name'; end if;
  if new.archived_at is distinct from old.archived_at then v_changed := v_changed || 'archived_at'; end if;
  if cardinality(v_changed) > 0 then
    perform private.audit(new.org_id, 'workspace.update', 'workspaces', new.id,
      jsonb_build_object('kind', new.kind, 'changed', to_jsonb(v_changed)), new.id);
  end if;
  return null;
end
$$;
revoke execute on function private.workspaces_audit() from public, anon, authenticated, service_role;

create trigger workspaces_guard before insert or update on public.workspaces
  for each row execute function private.workspaces_guard();
create trigger workspaces_audit after insert or update on public.workspaces
  for each row execute function private.workspaces_audit();

-- ---------------------------------------------------------------------------------------------
-- 3.4 teams guard and audit
-- ---------------------------------------------------------------------------------------------
create function private.teams_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := case when tg_op = 'INSERT' then new.org_id else old.org_id end;
begin
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.created_at is distinct from old.created_at) then
    raise exception 'TRACE_GUARD: team id, org and created_at are immutable' using errcode = '42501';
  end if;
  if not private.is_operator() and not (v_org = any (private.my_org_ids('{admin}'))) then
    raise exception 'TRACE_GUARD: admin required' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;
revoke execute on function private.teams_guard() from public, anon, authenticated, service_role;

create function private.teams_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.org_id, 'team.create', 'teams', new.id, '{}'::jsonb);
  elsif tg_op = 'UPDATE' then
    if new.name is distinct from old.name then
      perform private.audit(new.org_id, 'team.update', 'teams', new.id,
        jsonb_build_object('changed', jsonb_build_array('name')));
    end if;
  else
    perform private.audit(old.org_id, 'team.delete', 'teams', old.id, '{}'::jsonb);
  end if;
  return null;
end
$$;
revoke execute on function private.teams_audit() from public, anon, authenticated, service_role;

create trigger teams_guard before insert or update or delete on public.teams
  for each row execute function private.teams_guard();
create trigger teams_audit after insert or update or delete on public.teams
  for each row execute function private.teams_audit();

-- ---------------------------------------------------------------------------------------------
-- 3.5 memberships guard, last-owner check and audit
-- ---------------------------------------------------------------------------------------------
create function private.memberships_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator boolean := private.is_operator();
  v_uid uuid := (select auth.uid());
  v_touches_owner boolean;
begin
  if tg_op = 'INSERT' then
    v_touches_owner := 'org_owner' = any (new.roles);
    new.created_by := v_uid;
    new.created_at := now();
    if new.status not in ('active', 'invited') then
      raise exception 'TRACE_GUARD: a membership starts active' using errcode = '42501';
    end if;
    new.removed_at := null;
    if not v_operator then
      if new.status <> 'active' then
        raise exception 'TRACE_GUARD: invitations arrive in M1' using errcode = '42501';
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
    if v_touches_owner then
      perform 1 from public.orgs where id = new.org_id for no key update;
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
  if new.status is distinct from old.status then
    if old.status = 'invited' or new.status = 'invited'
      or not (
        (old.status = 'active' and new.status in ('suspended', 'removed'))
        or (old.status = 'suspended' and new.status in ('active', 'removed'))
      ) then
      raise exception 'TRACE_GUARD: status change not allowed' using errcode = '42501';
    end if;
  end if;
  new.removed_at := case when new.status = 'removed' then coalesce(old.removed_at, now()) end;

  v_touches_owner := 'org_owner' = any (old.roles) or 'org_owner' = any (new.roles);

  if not v_operator then
    if old.user_id = v_uid then
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

  if v_touches_owner or new.status is distinct from old.status then
    perform 1 from public.orgs where id = new.org_id for no key update;
  end if;
  return new;
end
$$;
revoke execute on function private.memberships_guard() from public, anon, authenticated, service_role;

create function private.memberships_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships
    where org_id = new.org_id and status = 'active' and 'org_owner' = any (roles)
  ) then
    raise exception 'TRACE_LAST_OWNER' using errcode = '23514';
  end if;
  return null;
end
$$;
revoke execute on function private.memberships_last_owner() from public, anon, authenticated, service_role;

create function private.memberships_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.org_id, 'membership.create', 'memberships', new.id,
      jsonb_build_object('roles', to_jsonb(new.roles), 'status', new.status,
        'workspace_id', new.workspace_id, 'team_id', new.team_id),
      new.workspace_id);
    return null;
  end if;
  if new.status = 'removed' and old.status <> 'removed' then
    perform private.audit(new.org_id, 'membership.remove', 'memberships', new.id,
      jsonb_build_object('old_status', old.status), new.workspace_id);
    return null;
  end if;
  if new.roles is distinct from old.roles then v_changed := v_changed || 'roles'; end if;
  if new.status is distinct from old.status then v_changed := v_changed || 'status'; end if;
  if new.workspace_id is distinct from old.workspace_id then
    v_changed := v_changed || 'workspace_id';
  end if;
  if new.team_id is distinct from old.team_id then v_changed := v_changed || 'team_id'; end if;
  if new.display_name is distinct from old.display_name then
    v_changed := v_changed || 'display_name';
  end if;
  if cardinality(v_changed) > 0 then
    perform private.audit(new.org_id, 'membership.update', 'memberships', new.id,
      jsonb_build_object('old_roles', to_jsonb(old.roles), 'new_roles', to_jsonb(new.roles),
        'old_status', old.status, 'new_status', new.status, 'changed', to_jsonb(v_changed)),
      new.workspace_id);
  end if;
  return null;
end
$$;
revoke execute on function private.memberships_audit() from public, anon, authenticated, service_role;

create trigger memberships_guard before insert or update on public.memberships
  for each row execute function private.memberships_guard();
create constraint trigger memberships_last_owner after insert or update on public.memberships
  deferrable initially deferred
  for each row execute function private.memberships_last_owner();
create trigger memberships_audit after insert or update on public.memberships
  for each row execute function private.memberships_audit();

-- ---------------------------------------------------------------------------------------------
-- 3.7 platform_staff and staff_access_grants guards and audit
-- ---------------------------------------------------------------------------------------------
create function private.platform_staff_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.orgs where id = new.org_id and kind = 'trace_internal') then
    raise exception 'TRACE_STAFF_ORG' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function private.platform_staff_guard() from public, anon, authenticated, service_role;

create trigger platform_staff_guard before insert or update on public.platform_staff
  for each row execute function private.platform_staff_guard();

create function private.staff_access_grants_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.staff_user_id is distinct from old.staff_user_id
    or new.ticket_ref is distinct from old.ticket_ref or new.scope is distinct from old.scope
    or new.granted_at is distinct from old.granted_at or new.expires_at is distinct from old.expires_at
    or new.approved_by is distinct from old.approved_by then
    raise exception 'TRACE_GUARD: only a revocation may change a grant' using errcode = '42501';
  end if;
  if old.revoked_at is not null then
    raise exception 'TRACE_GUARD: a grant is revoked once' using errcode = '42501';
  end if;
  if new.revoked_at is null and new.revoked_by is null then
    raise exception 'TRACE_GUARD: an update must revoke the grant' using errcode = '42501';
  end if;
  if not private.is_operator()
    and not (old.org_id = any (private.my_org_ids('{org_owner,admin}'))) then
    raise exception 'TRACE_GUARD: owner or admin required' using errcode = '42501';
  end if;
  new.revoked_by := (select auth.uid());
  new.revoked_at := now();
  return new;
end
$$;
revoke execute on function private.staff_access_grants_guard() from public, anon, authenticated, service_role;

create function private.staff_access_grants_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.org_id, 'staff_grant.create', 'staff_access_grants', new.id,
      jsonb_build_object('scope', new.scope, 'expires_at', new.expires_at),
      p_staff_grant_id => new.id);
  else
    perform private.audit(new.org_id, 'staff_grant.revoke', 'staff_access_grants', new.id,
      '{}'::jsonb, p_staff_grant_id => new.id);
  end if;
  return null;
end
$$;
revoke execute on function private.staff_access_grants_audit() from public, anon, authenticated, service_role;

create trigger staff_access_grants_guard before update on public.staff_access_grants
  for each row execute function private.staff_access_grants_guard();
create trigger staff_access_grants_audit after insert or update on public.staff_access_grants
  for each row execute function private.staff_access_grants_audit();

-- ---------------------------------------------------------------------------------------------
-- 2.6 Operator functions (owner-only: no EXECUTE grant to any role)
-- ---------------------------------------------------------------------------------------------
create function private.create_org(
  p_name text,
  p_slug text,
  p_kind public.org_kind,
  p_owner_user_id uuid,
  p_display_name text,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('trace.request_id', true);
  v_org uuid;
  v_ws uuid;
  v_member uuid;
begin
  if not private.is_operator() then
    raise exception 'TRACE_OPERATOR_ONLY' using errcode = '42501';
  end if;
  perform set_config('trace.request_id', p_request_id::text, true);
  insert into public.orgs (kind, name, slug) values (p_kind, p_name, p_slug) returning id into v_org;
  insert into public.workspaces (org_id, name, kind, is_default)
    values (v_org, 'Default', 'default', true) returning id into v_ws;
  insert into public.memberships (org_id, user_id, roles, display_name, status)
    values (v_org, p_owner_user_id, '{org_owner,admin}', p_display_name, 'active')
    returning id into v_member;
  perform private.audit(v_org, 'org.create', 'orgs', v_org,
    jsonb_build_object('kind', p_kind, 'default_workspace_id', v_ws,
      'first_membership_id', v_member));
  perform set_config('trace.request_id', coalesce(v_prev, ''), true);
  return v_org;
end
$$;
revoke execute on function private.create_org(text, text, public.org_kind, uuid, text, uuid)
  from public, anon, authenticated, service_role;

create function private.add_member(
  p_org_id uuid,
  p_user_id uuid,
  p_roles public.org_role[],
  p_display_name text,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('trace.request_id', true);
  v_member uuid;
begin
  if not private.is_operator() then
    raise exception 'TRACE_OPERATOR_ONLY' using errcode = '42501';
  end if;
  perform set_config('trace.request_id', p_request_id::text, true);
  insert into public.memberships (org_id, user_id, roles, display_name, status)
    values (p_org_id, p_user_id, p_roles, p_display_name, 'active')
    returning id into v_member;
  perform set_config('trace.request_id', coalesce(v_prev, ''), true);
  return v_member;
end
$$;
revoke execute on function private.add_member(uuid, uuid, public.org_role[], text, uuid)
  from public, anon, authenticated, service_role;

create function private.grant_staff_access(
  p_org_id uuid,
  p_staff_user_id uuid,
  p_approved_by uuid,
  p_ticket_ref text,
  p_scope public.staff_grant_scope,
  p_expires_at timestamptz,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := current_setting('trace.request_id', true);
  v_grant uuid;
begin
  if not private.is_operator() then
    raise exception 'TRACE_OPERATOR_ONLY' using errcode = '42501';
  end if;
  perform set_config('trace.request_id', p_request_id::text, true);
  insert into public.staff_access_grants (org_id, staff_user_id, approved_by, ticket_ref, scope, expires_at)
    values (p_org_id, p_staff_user_id, p_approved_by, p_ticket_ref, p_scope, p_expires_at)
    returning id into v_grant;
  perform set_config('trace.request_id', coalesce(v_prev, ''), true);
  return v_grant;
end
$$;
revoke execute on function private.grant_staff_access(uuid, uuid, uuid, text, public.staff_grant_scope, timestamptz, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 3.9 Grants and policies. One policy per operation per role set; nothing for anon.
-- ---------------------------------------------------------------------------------------------

-- orgs
grant select on public.orgs to authenticated;
grant update (name, data_residency) on public.orgs to authenticated;
create policy orgs_select_member on public.orgs for select to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin,recruiter,reviewer,hiring_manager}'))::uuid[]));
create policy orgs_update_owner_admin on public.orgs for update to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]))
  with check (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]));

-- workspaces
grant select on public.workspaces to authenticated;
grant insert (org_id, name, kind) on public.workspaces to authenticated;
grant update (name, archived_at) on public.workspaces to authenticated;
create policy workspaces_select_member on public.workspaces for select to authenticated
  using (id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter,reviewer,hiring_manager}'))::uuid[]));
create policy workspaces_insert_owner_admin on public.workspaces for insert to authenticated
  with check (kind = 'client' and org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]));
create policy workspaces_update_owner_admin on public.workspaces for update to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]))
  with check (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]));

-- teams
grant select, delete on public.teams to authenticated;
grant insert (org_id, name) on public.teams to authenticated;
grant update (name) on public.teams to authenticated;
create policy teams_select_member on public.teams for select to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin,recruiter,reviewer,hiring_manager}'))::uuid[]));
create policy teams_insert_admin on public.teams for insert to authenticated
  with check (org_id = any ((select private.my_org_ids('{admin}'))::uuid[]));
create policy teams_update_admin on public.teams for update to authenticated
  using (org_id = any ((select private.my_org_ids('{admin}'))::uuid[]))
  with check (org_id = any ((select private.my_org_ids('{admin}'))::uuid[]));
create policy teams_delete_admin on public.teams for delete to authenticated
  using (org_id = any ((select private.my_org_ids('{admin}'))::uuid[]));

-- memberships
grant select on public.memberships to authenticated;
grant insert (org_id, user_id, roles, workspace_id, team_id, display_name, status)
  on public.memberships to authenticated;
grant update (roles, workspace_id, team_id, display_name, status, removed_at)
  on public.memberships to authenticated;
create policy memberships_select_own on public.memberships for select to authenticated
  using (user_id = (select auth.uid()));
create policy memberships_select_owner_admin on public.memberships for select to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]));
create policy memberships_select_directory on public.memberships for select to authenticated
  using (
    status in ('invited', 'active')
    and org_id = any ((select private.my_org_ids('{recruiter,reviewer}'))::uuid[])
  );
create policy memberships_insert_owner_admin on public.memberships for insert to authenticated
  with check (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]));
create policy memberships_update_owner_admin on public.memberships for update to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]))
  with check (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]));
create policy memberships_update_own on public.memberships for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- audit_log: read by owners and admins of the org; written only by private.audit.
grant select on public.audit_log to authenticated;
create policy audit_log_select_owner_admin on public.audit_log for select to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]));

-- platform_staff: a staff member sees their own active row. Operator-written only.
grant select on public.platform_staff to authenticated;
create policy platform_staff_select_own on public.platform_staff for select to authenticated
  using (active and user_id = (select auth.uid()));

-- staff_access_grants: tenant owners/admins see and revoke; staff see their own grants.
grant select on public.staff_access_grants to authenticated;
grant update (revoked_at, revoked_by) on public.staff_access_grants to authenticated;
create policy staff_access_grants_select_owner_admin on public.staff_access_grants for select to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]));
create policy staff_access_grants_select_own on public.staff_access_grants for select to authenticated
  using (staff_user_id = (select auth.uid()));
create policy staff_access_grants_update_owner_admin on public.staff_access_grants for update to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]))
  with check (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]));

-- idempotency_keys: worker-only ledger (ADR-029). Literally-true clauses, on MT-11's
-- reference-table list.
grant select, insert, update, delete on public.idempotency_keys to trace_worker;
create policy idempotency_keys_select_worker on public.idempotency_keys for select to trace_worker
  using (true);
create policy idempotency_keys_insert_worker on public.idempotency_keys for insert to trace_worker
  with check (true);
create policy idempotency_keys_update_worker on public.idempotency_keys for update to trace_worker
  using (true) with check (true);
create policy idempotency_keys_delete_worker on public.idempotency_keys for delete to trace_worker
  using (true);
