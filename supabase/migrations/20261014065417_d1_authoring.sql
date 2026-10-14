-- D1 migration 1 of 4 (spec specs/d1-demo-slice.md §3.1 row 1, §3.2 authoring, §3.3, §3.4, §3.7; decisions
-- L-8 (trigger lives in migration 3), L-15, L-16, L-25, L-27, L-30, L-33, L-34).
-- Authoring tables, caller-context helpers, scoping-copy / guard / freeze / publish / audit triggers, grants and
-- policies. Migrations 1-2 leave `quality` and `integrity` empty; nothing here reads or names either schema.
--
-- Error contract (same as M0b; the rls_d1_* tests rely on it):
--   guard / freeze refusal        SQLSTATE 42501, message 'TRACE_GUARD: <reason>'
--   bad answer key                SQLSTATE 23514, message 'TRACE_BAD_ANSWER_KEY'
--   missing parent row            SQLSTATE 23503, message 'TRACE_GUARD: <parent> not found'
--
-- Trigger-order note: every table has ONE BEFORE trigger (<table>_guard) that copies the scoping columns,
-- enforces immutability and the draft-only freeze, so there is no cross-trigger ordering to rely on, except that
-- migration 3's L-8 trigger on test_versions must fire AFTER test_versions_guard (its name sorts after
-- 'test_versions_guard': use test_versions_ruleset_seed), because the guard assigns version_no and the workspace.

-- ---------------------------------------------------------------------------------------------
-- Role trace_api (the api's own role, ADR-029). Spec §3.1 lists it under migration 2; migration 1 already
-- grants to it (test_versions columns, notice_versions, api_org_id), so it is created here, idempotently and
-- with the same attribute pattern as m0b_roles. Migration 2's `create role ... if not exists` is then a no-op.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select from pg_catalog.pg_roles where rolname = 'trace_api') then
    create role trace_api nologin;
  end if;
  alter role trace_api nologin nocreatedb nocreaterole nobypassrls;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------------------------
create type public.test_version_status as enum ('draft', 'published', 'retired');
create type public.section_format as enum ('written', 'mcq');

-- ---------------------------------------------------------------------------------------------
-- L-25: membership_counts_for takes the user, aal and amr as arguments (auth.jwt() / auth.uid() are NULL on the
-- trace_api connection). membership_counts is re-created to call it with the JWT values; its truth table is the
-- M0b one, unchanged. EXECUTE to nobody: only definer code (my_org_ids, my_workspace_ids, my_assigned_test_ids,
-- migration 4's media_viewer_check) calls it, running as the owner.
-- ---------------------------------------------------------------------------------------------
create function private.membership_counts_for(
  p_user uuid,
  p_roles public.org_role[],
  p_aal text,
  p_amr text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case
      when p_aal = 'aal2' then true
      when p_roles && '{org_owner,admin,reviewer}'::public.org_role[] then false
      when p_aal = 'aal1' then
        (coalesce(p_amr, '{}'::text[]) && array['otp', 'magiclink']::text[])
        and not (coalesce(p_amr, '{}'::text[]) && array['password']::text[])
      else false
    end,
    false
  )
$$;
revoke execute on function private.membership_counts_for(uuid, public.org_role[], text, text[])
  from public, anon, authenticated, service_role;

create or replace function private.membership_counts(p_roles public.org_role[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.membership_counts_for(
    (select auth.uid()),
    p_roles,
    c.j ->> 'aal',
    array(
      select e ->> 'method'
      from jsonb_array_elements(
        case when jsonb_typeof(c.j -> 'amr') = 'array' then c.j -> 'amr' else '[]'::jsonb end
      ) as e
      where jsonb_typeof(e) = 'object'
    )
  )
  from (select (select auth.jwt()) as j) as c
$$;

-- ---------------------------------------------------------------------------------------------
-- Caller-context helpers for workers and the api (R-4). They read a per-transaction setting that the job /
-- api sets with set_config(..., true) after it has verified the org; app roles cannot set it (set_config is not
-- exposed by PostgREST). Unset => NULL => a policy `org_id = (select private.job_org_id())` matches no row.
-- ---------------------------------------------------------------------------------------------
create function private.job_org_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('trace.job_org_id', true), '')::uuid
$$;
revoke execute on function private.job_org_id() from public, anon, authenticated, service_role;
grant execute on function private.job_org_id() to trace_worker, trace_quality_worker, trace_integrity_worker;

create function private.api_org_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('trace.api_org_id', true), '')::uuid
$$;
revoke execute on function private.api_org_id() from public, anon, authenticated, service_role;
grant execute on function private.api_org_id() to trace_api;

-- ---------------------------------------------------------------------------------------------
-- Immutable validators used by CHECK constraints. A CHECK runs with the writer's privileges, so the two that
-- app roles trigger get EXECUTE for authenticated (as private.valid_roles, M0b D7). signal_settings_valid is only
-- evaluated for rows written by definer code (the L-8 trigger), so nobody else holds EXECUTE.
-- ---------------------------------------------------------------------------------------------
create function private.mcq_options_valid(p_options jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case
      when jsonb_typeof(p_options) = 'array'
        and jsonb_array_length(p_options) between 2 and 6
        and octet_length(p_options::text) <= 8192 then
        not exists (
          select 1
          from jsonb_array_elements(p_options) as e
          where jsonb_typeof(e) is distinct from 'object'
            or jsonb_typeof(e -> 'id') is distinct from 'string'
            or jsonb_typeof(e -> 'text') is distinct from 'string'
            or char_length(e ->> 'id') not between 1 and 64
            or char_length(e ->> 'text') not between 1 and 500
        )
        and (select count(distinct e ->> 'id') from jsonb_array_elements(p_options) as e)
          = jsonb_array_length(p_options)
      else false
    end,
    false
  )
$$;
revoke execute on function private.mcq_options_valid(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.mcq_options_valid(jsonb) to authenticated;

create function private.rubric_criteria_valid(p_criteria jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case
      when jsonb_typeof(p_criteria) = 'array'
        and jsonb_array_length(p_criteria) between 1 and 8
        and octet_length(p_criteria::text) <= 16384 then
        not exists (
          select 1
          from jsonb_array_elements(p_criteria) as e
          where jsonb_typeof(e) is distinct from 'object'
            or jsonb_typeof(e -> 'id') is distinct from 'string'
            or jsonb_typeof(e -> 'label') is distinct from 'string'
            or char_length(e ->> 'id') not between 1 and 64
            or char_length(e ->> 'label') not between 1 and 200
            or not (e ? 'anchors')
            or not (
              case
                when jsonb_typeof(e -> 'max_points') = 'number' then (e ->> 'max_points')::numeric > 0
                else false
              end
            )
        )
      else false
    end,
    false
  )
$$;
revoke execute on function private.rubric_criteria_valid(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.rubric_criteria_valid(jsonb) to authenticated;

-- Exactly the five D1 signal keys the candidate client can send (spec §4.6), each {"enabled": bool].
create function private.signal_settings_valid(p_settings jsonb)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select coalesce(
    case
      when jsonb_typeof(p_settings) = 'object' then
        (select array_agg(k order by k) from jsonb_object_keys(p_settings) as k)
          = array['drop', 'fullscreen_exit', 'paste', 'tab_hidden', 'untrusted_input']::text[]
        and not exists (
          select 1
          from jsonb_each(p_settings) as e
          where jsonb_typeof(e.value) is distinct from 'object'
            or (select array_agg(kk order by kk) from jsonb_object_keys(e.value) as kk)
              is distinct from array['enabled']::text[]
            or jsonb_typeof(e.value -> 'enabled') is distinct from 'boolean'
        )
      else false
    end,
    false
  )
$$;
revoke execute on function private.signal_settings_valid(jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

-- tests
create table public.tests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  name text not null check (char_length(name) between 1 and 200),
  archived_at timestamptz null,
  invitation_seq int not null default 0 check (invitation_seq >= 0),
  created_by uuid null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict
);
create index tests_workspace_idx on public.tests (org_id, workspace_id);
alter table public.tests enable row level security;

-- rubric_versions (org-level: no test)
create table public.rubric_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  rubric_key text not null check (char_length(rubric_key) between 1 and 64),
  version_no int not null check (version_no >= 1),
  criteria jsonb not null check (private.rubric_criteria_valid(criteria)),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, rubric_key, version_no)
);
alter table public.rubric_versions enable row level security;

-- notice_versions (org-level, immutable always; written only by migration 3's seed function)
create table public.notice_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  notice_key text not null check (char_length(notice_key) between 1 and 64),
  version int not null check (version >= 1),
  language text not null check (language = 'en'),
  body_template text not null check (char_length(body_template) between 1 and 20000),
  template_sha256 text not null check (template_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, notice_key, version)
);
alter table public.notice_versions enable row level security;

-- ruleset_versions. The FK (org_id, band_rule_version_id) -> integrity.band_rule_versions is added in migration 3
-- (L-33), together with its (org_id, band_rule_version_id) index.
create table public.ruleset_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  version_no int not null check (version_no >= 1),
  band_rule_version_id uuid null,
  signal_settings jsonb not null check (private.signal_settings_valid(signal_settings)),
  published_at timestamptz null,
  content_sha256 text null check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  unique (org_id, id),
  unique (org_id, test_id, version_no),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict
);
create index ruleset_versions_workspace_idx on public.ruleset_versions (org_id, workspace_id);
alter table public.ruleset_versions enable row level security;

-- test_versions
create table public.test_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  version_no int not null check (version_no >= 1),
  status public.test_version_status not null default 'draft',
  total_time_seconds int not null check (total_time_seconds between 60 and 7200),
  quality_cutoff smallint not null check (quality_cutoff between 0 and 100),
  ruleset_version_id uuid null,
  notice_version_id uuid null,
  content_sha256 text null check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz null,
  published_by uuid null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, test_id, version_no),
  unique (org_id, id, ruleset_version_id),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict,
  foreign key (org_id, ruleset_version_id) references public.ruleset_versions (org_id, id) on delete restrict,
  foreign key (org_id, notice_version_id) references public.notice_versions (org_id, id) on delete restrict,
  check ((status = 'draft') = (published_at is null)),
  check (
    status = 'draft'
    or (content_sha256 is not null and ruleset_version_id is not null and notice_version_id is not null)
  )
);
create unique index test_versions_one_open_draft on public.test_versions (org_id, test_id) where status = 'draft';
create index test_versions_workspace_idx on public.test_versions (org_id, workspace_id);
create index test_versions_ruleset_idx on public.test_versions (org_id, ruleset_version_id);
create index test_versions_notice_idx on public.test_versions (org_id, notice_version_id);
alter table public.test_versions enable row level security;

-- sections
create table public.sections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  test_version_id uuid not null,
  position int not null check (position >= 1),
  name text not null check (char_length(name) between 1 and 120),
  format public.section_format not null,
  weight numeric(5, 2) not null check (weight > 0),
  time_limit_seconds int null check (time_limit_seconds is null or time_limit_seconds > 0),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, test_version_id, position),
  unique (org_id, id, format),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict,
  foreign key (org_id, test_version_id) references public.test_versions (org_id, id) on delete restrict
);
create index sections_test_idx on public.sections (org_id, test_id);
create index sections_workspace_idx on public.sections (org_id, workspace_id);
alter table public.sections enable row level security;

-- item_versions (no `items` table in D1; item_id is a stable identity with no FK, spec §3.2)
create table public.item_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  test_version_id uuid not null,
  section_id uuid not null,
  format public.section_format not null,
  item_id uuid not null default gen_random_uuid(),
  version_no smallint not null default 1 check (version_no >= 1),
  position int not null check (position >= 1),
  stem text not null check (char_length(stem) between 1 and 4000),
  options jsonb null,
  rubric_version_id uuid null,
  origin text not null default 'human' check (origin = 'human'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, id, format),
  unique (org_id, section_id, position),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict,
  foreign key (org_id, test_version_id) references public.test_versions (org_id, id) on delete restrict,
  foreign key (org_id, section_id, format) references public.sections (org_id, id, format) on delete restrict,
  foreign key (org_id, rubric_version_id) references public.rubric_versions (org_id, id) on delete restrict,
  check (
    (format = 'mcq' and options is not null and private.mcq_options_valid(options) and rubric_version_id is null)
    or (format = 'written' and options is null and rubric_version_id is not null)
  )
);
create index item_versions_test_idx on public.item_versions (org_id, test_id);
create index item_versions_workspace_idx on public.item_versions (org_id, workspace_id);
create index item_versions_test_version_idx on public.item_versions (org_id, test_version_id);
create index item_versions_rubric_idx on public.item_versions (org_id, rubric_version_id);
alter table public.item_versions enable row level security;

-- item_answer_keys: never in the R2 test package, never readable by the candidate path.
create table public.item_answer_keys (
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  item_version_id uuid not null,
  format public.section_format not null default 'mcq' check (format = 'mcq'),
  key jsonb not null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  primary key (org_id, item_version_id),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict,
  foreign key (org_id, item_version_id, format) references public.item_versions (org_id, id, format)
    on delete restrict
);
create index item_answer_keys_test_idx on public.item_answer_keys (org_id, test_id);
create index item_answer_keys_workspace_idx on public.item_answer_keys (org_id, workspace_id);
alter table public.item_answer_keys enable row level security;

-- assignments (build-notes §4; every role needs one to view evidence, R-15)
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  membership_id uuid not null,
  scope text not null default 'test' check (scope = 'test'),
  test_id uuid not null,
  as_role public.org_role not null check (as_role in ('org_owner', 'admin', 'recruiter', 'reviewer')),
  created_by uuid null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, membership_id, test_id),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, membership_id) references public.memberships (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict
);
create index assignments_test_idx on public.assignments (org_id, test_id);
create index assignments_workspace_idx on public.assignments (org_id, workspace_id);
alter table public.assignments enable row level security;

-- ---------------------------------------------------------------------------------------------
-- my_assigned_test_ids: the tests assigned to the caller through an active membership that counts, in an active
-- org, where the assignment's as_role is one of p_roles and is held by the membership (spec §3.4). Defined after
-- the assignments table it reads.
-- ---------------------------------------------------------------------------------------------
create function private.my_assigned_test_ids(p_roles public.org_role[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct a.test_id), '{}'::uuid[])
  from public.assignments as a
  join public.memberships as m on m.org_id = a.org_id and m.id = a.membership_id
  join public.orgs as o on o.id = m.org_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and o.status = 'active'
    and a.as_role = any (p_roles)
    and a.as_role = any (m.roles)
    and private.membership_counts(m.roles)
$$;
revoke execute on function private.my_assigned_test_ids(public.org_role[]) from public, anon, authenticated, service_role;
grant execute on function private.my_assigned_test_ids(public.org_role[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Guards (BEFORE) and audit (AFTER) triggers. All SECURITY DEFINER with search_path = ''; the freeze logic has no
-- operator bypass (Q20) and the guards are ENABLE ALWAYS, so replica mode cannot skip them.
-- ---------------------------------------------------------------------------------------------

-- tests ------------------------------------------------------------------------------------------
create function private.tests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- created_by is outside every authenticated grant, so an app caller always gets auth.uid(); only the
    -- operator path (no JWT) may name the creator, which the publish auto-assignment then uses (R-15).
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.invitation_seq := 0;
    return new;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.workspace_id is distinct from old.workspace_id or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: test id, org, workspace, creator and created_at are immutable'
      using errcode = '42501';
  end if;
  if new.invitation_seq < old.invitation_seq then
    raise exception 'TRACE_GUARD: invitation_seq only grows' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.tests_guard() from public, anon, authenticated, service_role;

create function private.tests_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.audit(new.org_id, 'test.create', 'tests', new.id, '{}'::jsonb, new.workspace_id);
  return null;
end
$$;
revoke execute on function private.tests_audit() from public, anon, authenticated, service_role;

create trigger tests_guard before insert or update on public.tests
  for each row execute function private.tests_guard();
create trigger tests_audit after insert on public.tests
  for each row execute function private.tests_audit();
alter table public.tests enable always trigger tests_guard;

-- rubric_versions (guard + freeze: refused once any item_versions row references it) ----------------
create function private.rubric_versions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    return new;
  end if;
  -- Serialise against a concurrent item insert that references this rubric (item_versions_guard takes FOR SHARE).
  perform 1 from public.rubric_versions where org_id = old.org_id and id = old.id for no key update;
  if exists (
    select 1 from public.item_versions as i where i.org_id = old.org_id and i.rubric_version_id = old.id
  ) then
    raise exception 'TRACE_GUARD: a rubric version used by an item is frozen' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.rubric_key is distinct from old.rubric_key or new.version_no is distinct from old.version_no
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: rubric id, org, key, version and creator are immutable' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.rubric_versions_guard() from public, anon, authenticated, service_role;

create trigger rubric_versions_guard before insert or update or delete on public.rubric_versions
  for each row execute function private.rubric_versions_guard();
alter table public.rubric_versions enable always trigger rubric_versions_guard;

-- notice_versions: immutable always (the seed function in migration 3 only inserts) -----------------
create function private.notice_versions_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'TRACE_GUARD: notice versions are immutable' using errcode = '42501';
end
$$;
revoke execute on function private.notice_versions_freeze() from public, anon, authenticated, service_role;

create trigger notice_versions_freeze before update or delete on public.notice_versions
  for each row execute function private.notice_versions_freeze();
alter table public.notice_versions enable always trigger notice_versions_freeze;

-- ruleset_versions: scoping copy; frozen once a published test version has stamped published_at ------
create function private.ruleset_versions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  if tg_op = 'INSERT' then
    select t.workspace_id into v_ws
    from public.tests as t where t.org_id = new.org_id and t.id = new.test_id;
    if not found then
      raise exception 'TRACE_GUARD: test not found' using errcode = '23503';
    end if;
    new.workspace_id := v_ws;
    new.published_at := null;
    return new;
  end if;
  if old.published_at is not null then
    raise exception 'TRACE_GUARD: a published ruleset version is frozen' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.workspace_id is distinct from old.workspace_id or new.test_id is distinct from old.test_id
    or new.version_no is distinct from old.version_no then
    raise exception 'TRACE_GUARD: ruleset id, org, workspace, test and version are immutable'
      using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.ruleset_versions_guard() from public, anon, authenticated, service_role;

create trigger ruleset_versions_guard before insert or update or delete on public.ruleset_versions
  for each row execute function private.ruleset_versions_guard();
alter table public.ruleset_versions enable always trigger ruleset_versions_guard;

-- test_versions: scoping copy, version_no, state machine, freeze, publish ---------------------------
create function private.test_versions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_band uuid;
  v_uid uuid := (select auth.uid());
  v_member uuid;
  v_role public.org_role;
begin
  if tg_op = 'INSERT' then
    -- Lock the test row: serialises version_no assignment and the one-open-draft rule with other inserts.
    select t.workspace_id into v_ws
    from public.tests as t where t.org_id = new.org_id and t.id = new.test_id for no key update;
    if not found then
      raise exception 'TRACE_GUARD: test not found' using errcode = '23503';
    end if;
    if new.status is distinct from 'draft' then
      raise exception 'TRACE_GUARD: a test version starts as a draft' using errcode = '42501';
    end if;
    new.workspace_id := v_ws;
    new.created_by := coalesce(v_uid, new.created_by);  -- same rule as tests_guard
    new.published_at := null;
    new.published_by := null;
    if new.version_no is null then
      select coalesce(max(v.version_no), 0) + 1 into new.version_no
      from public.test_versions as v where v.org_id = new.org_id and v.test_id = new.test_id;
    end if;
    return new;
  end if;

  -- UPDATE (DELETE has its own trigger).
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.workspace_id is distinct from old.workspace_id or new.test_id is distinct from old.test_id
    or new.version_no is distinct from old.version_no or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.ruleset_version_id is distinct from old.ruleset_version_id
    or new.notice_version_id is distinct from old.notice_version_id then
    raise exception 'TRACE_GUARD: test version id, org, workspace, test, number, creator and pins are immutable'
      using errcode = '42501';
  end if;

  if old.status = 'retired' then
    if new is distinct from old then
      raise exception 'TRACE_GUARD: a retired test version is terminal' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'published' then
    if new.status = 'published' then
      -- Even an identical update is refused, so a second (racing) publisher gets an error, not a silent no-op.
      raise exception 'TRACE_GUARD: a published test version is frozen' using errcode = '42501';
    elsif new.status = 'retired' then
      if new.total_time_seconds is distinct from old.total_time_seconds
        or new.quality_cutoff is distinct from old.quality_cutoff
        or new.content_sha256 is distinct from old.content_sha256
        or new.published_at is distinct from old.published_at
        or new.published_by is distinct from old.published_by then
        raise exception 'TRACE_GUARD: a published test version is frozen' using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'TRACE_GUARD: status change not allowed' using errcode = '42501';
  end if;

  -- old.status = 'draft'
  if new.status = 'draft' then
    new.published_at := null;
    new.published_by := null;
    return new;
  end if;
  if new.status <> 'published' then
    raise exception 'TRACE_GUARD: status change not allowed' using errcode = '42501';
  end if;

  -- Publish. The row lock taken before this trigger fired serialises concurrent publishes of this version; the
  -- tests row lock also serialises against a concurrent draft insert (M0b D9 pattern).
  perform 1 from public.tests as t where t.org_id = new.org_id and t.id = new.test_id for no key update;
  if new.content_sha256 is null then
    raise exception 'TRACE_GUARD: publish needs the content hash' using errcode = '42501';
  end if;
  if new.ruleset_version_id is null or new.notice_version_id is null then
    raise exception 'TRACE_GUARD: publish needs the pinned ruleset and notice' using errcode = '42501';
  end if;
  select r.band_rule_version_id into v_band
  from public.ruleset_versions as r where r.org_id = new.org_id and r.id = new.ruleset_version_id;
  if v_band is null then
    raise exception 'TRACE_GUARD: publish needs a ruleset with a band rule version' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sections as s where s.org_id = new.org_id and s.test_version_id = new.id) then
    raise exception 'TRACE_GUARD: publish needs at least one section' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.sections as s
    where s.org_id = new.org_id and s.test_version_id = new.id
      and not exists (select 1 from public.item_versions as i where i.org_id = s.org_id and i.section_id = s.id)
  ) then
    raise exception 'TRACE_GUARD: every section needs at least one item' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.item_versions as i
    where i.org_id = new.org_id and i.test_version_id = new.id and i.format = 'mcq'
      and not exists (
        select 1
        from public.item_answer_keys as k, jsonb_array_elements(i.options) as o
        where k.org_id = i.org_id and k.item_version_id = i.id and o ->> 'id' = k.key ->> 'option_id'
      )
  ) then
    raise exception 'TRACE_GUARD: every multiple-choice item needs a valid answer key' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.item_versions as i
    where i.org_id = new.org_id and i.test_version_id = new.id and i.format = 'written'
      and i.rubric_version_id is null
  ) then
    raise exception 'TRACE_GUARD: every written item needs a rubric' using errcode = '42501';
  end if;

  new.published_at := now();
  new.published_by := v_uid;

  -- The ruleset freezes with the version (Q20).
  update public.ruleset_versions
    set published_at = new.published_at
    where org_id = new.org_id and id = new.ruleset_version_id and published_at is null;

  -- The creator is assigned automatically so they can view evidence (R-15). as_role = the highest of
  -- org_owner | admin | recruiter that their membership holds; skipped if the membership is no longer active.
  select m.id,
    case
      when 'org_owner' = any (m.roles) then 'org_owner'::public.org_role
      when 'admin' = any (m.roles) then 'admin'::public.org_role
      when 'recruiter' = any (m.roles) then 'recruiter'::public.org_role
    end
  into v_member, v_role
  from public.tests as t
  join public.memberships as m on m.org_id = t.org_id and m.user_id = t.created_by and m.status = 'active'
  where t.org_id = new.org_id and t.id = new.test_id;
  if v_member is not null and v_role is not null then
    insert into public.assignments (org_id, membership_id, test_id, as_role)
      values (new.org_id, v_member, new.test_id, v_role)
      on conflict (org_id, membership_id, test_id) do nothing;
  end if;
  return new;
end
$$;
revoke execute on function private.test_versions_guard() from public, anon, authenticated, service_role;

create function private.test_versions_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    raise exception 'TRACE_GUARD: only a draft test version can be deleted' using errcode = '42501';
  end if;
  return old;
end
$$;
revoke execute on function private.test_versions_delete_guard() from public, anon, authenticated, service_role;

-- AFTER DELETE (spec says BEFORE): the ruleset row is still referenced by the version row in a BEFORE trigger.
create function private.test_versions_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.ruleset_versions
    where org_id = old.org_id and id = old.ruleset_version_id and published_at is null;
  return null;
end
$$;
revoke execute on function private.test_versions_after_delete() from public, anon, authenticated, service_role;

create function private.test_versions_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'published' then
    perform private.audit(new.org_id, 'test.publish', 'test_versions', new.id,
      jsonb_build_object('version_no', new.version_no), new.workspace_id);
  end if;
  return null;
end
$$;
revoke execute on function private.test_versions_audit() from public, anon, authenticated, service_role;

create trigger test_versions_guard before insert or update on public.test_versions
  for each row execute function private.test_versions_guard();
create trigger test_versions_delete_guard before delete on public.test_versions
  for each row execute function private.test_versions_delete_guard();
create trigger test_versions_after_delete after delete on public.test_versions
  for each row execute function private.test_versions_after_delete();
create trigger test_versions_audit after update on public.test_versions
  for each row execute function private.test_versions_audit();
alter table public.test_versions enable always trigger test_versions_guard;
alter table public.test_versions enable always trigger test_versions_delete_guard;
alter table public.test_versions enable always trigger test_versions_after_delete;

-- sections ---------------------------------------------------------------------------------------
create function private.sections_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.test_version_status;
  v_test uuid;
  v_ws uuid;
begin
  if tg_op = 'INSERT' then
    -- FOR SHARE conflicts with the NO KEY UPDATE lock of a concurrent publish, so insert and publish serialise.
    select v.status, v.test_id, v.workspace_id into v_status, v_test, v_ws
    from public.test_versions as v where v.org_id = new.org_id and v.id = new.test_version_id for share;
    if not found then
      raise exception 'TRACE_GUARD: test version not found' using errcode = '23503';
    end if;
    if v_status <> 'draft' then
      raise exception 'TRACE_GUARD: the test version is frozen' using errcode = '42501';
    end if;
    new.test_id := v_test;
    new.workspace_id := v_ws;
    return new;
  end if;

  select v.status into v_status
  from public.test_versions as v where v.org_id = old.org_id and v.id = old.test_version_id for share;
  if v_status <> 'draft' then
    raise exception 'TRACE_GUARD: the test version is frozen' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.workspace_id is distinct from old.workspace_id or new.test_id is distinct from old.test_id
    or new.test_version_id is distinct from old.test_version_id or new.format is distinct from old.format
    or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: section id, org, scope, version and format are immutable' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.sections_guard() from public, anon, authenticated, service_role;

create trigger sections_guard before insert or update or delete on public.sections
  for each row execute function private.sections_guard();
alter table public.sections enable always trigger sections_guard;

-- item_versions ----------------------------------------------------------------------------------
create function private.item_versions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.test_version_status;
  v_tv uuid;
  v_test uuid;
  v_ws uuid;
begin
  if tg_op = 'INSERT' then
    select s.test_version_id, s.test_id, s.workspace_id into v_tv, v_test, v_ws
    from public.sections as s where s.org_id = new.org_id and s.id = new.section_id for share;
    if not found then
      raise exception 'TRACE_GUARD: section not found' using errcode = '23503';
    end if;
    select v.status into v_status
    from public.test_versions as v where v.org_id = new.org_id and v.id = v_tv for share;
    if v_status <> 'draft' then
      raise exception 'TRACE_GUARD: the test version is frozen' using errcode = '42501';
    end if;
    new.test_version_id := v_tv;
    new.test_id := v_test;
    new.workspace_id := v_ws;
    new.created_by := (select auth.uid());
    if new.rubric_version_id is not null then
      -- Serialise with rubric_versions_guard (an update of a rubric that is about to be referenced).
      perform 1 from public.rubric_versions as r
        where r.org_id = new.org_id and r.id = new.rubric_version_id for share;
    end if;
    return new;
  end if;

  select v.status into v_status
  from public.test_versions as v where v.org_id = old.org_id and v.id = old.test_version_id for share;
  if v_status <> 'draft' then
    raise exception 'TRACE_GUARD: the test version is frozen' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.workspace_id is distinct from old.workspace_id or new.test_id is distinct from old.test_id
    or new.test_version_id is distinct from old.test_version_id or new.section_id is distinct from old.section_id
    or new.format is distinct from old.format or new.item_id is distinct from old.item_id
    or new.version_no is distinct from old.version_no or new.origin is distinct from old.origin
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: item id, org, scope, section, format and identity are immutable'
      using errcode = '42501';
  end if;
  if new.rubric_version_id is not null and new.rubric_version_id is distinct from old.rubric_version_id then
    perform 1 from public.rubric_versions as r
      where r.org_id = new.org_id and r.id = new.rubric_version_id for share;
  end if;
  return new;
end
$$;
revoke execute on function private.item_versions_guard() from public, anon, authenticated, service_role;

create trigger item_versions_guard before insert or update or delete on public.item_versions
  for each row execute function private.item_versions_guard();
alter table public.item_versions enable always trigger item_versions_guard;

-- item_answer_keys -------------------------------------------------------------------------------
create function private.item_answer_keys_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.test_version_status;
  v_tv uuid;
  v_test uuid;
  v_ws uuid;
  v_options jsonb;
  v_item uuid := case when tg_op = 'DELETE' then old.item_version_id else new.item_version_id end;
  v_org uuid := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
begin
  select i.test_version_id, i.test_id, i.workspace_id, i.options into v_tv, v_test, v_ws, v_options
  from public.item_versions as i where i.org_id = v_org and i.id = v_item for share;
  if not found then
    raise exception 'TRACE_GUARD: item version not found' using errcode = '23503';
  end if;
  select v.status into v_status
  from public.test_versions as v where v.org_id = v_org and v.id = v_tv for share;
  if v_status <> 'draft' then
    raise exception 'TRACE_GUARD: the test version is frozen' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.test_id := v_test;
    new.workspace_id := v_ws;
    new.created_by := (select auth.uid());
  else
    if new.org_id is distinct from old.org_id or new.item_version_id is distinct from old.item_version_id
      or new.workspace_id is distinct from old.workspace_id or new.test_id is distinct from old.test_id
      or new.format is distinct from old.format or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'TRACE_GUARD: answer key org, item and scope are immutable' using errcode = '42501';
    end if;
  end if;
  -- The key is exactly {"option_id": <one of the item's option ids>}.
  if jsonb_typeof(new.key) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(new.key)) <> 1
    or jsonb_typeof(new.key -> 'option_id') is distinct from 'string'
    or not exists (
      select 1 from jsonb_array_elements(v_options) as o where o ->> 'id' = new.key ->> 'option_id'
    ) then
    raise exception 'TRACE_BAD_ANSWER_KEY' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function private.item_answer_keys_guard() from public, anon, authenticated, service_role;

create trigger item_answer_keys_guard before insert or update or delete on public.item_answer_keys
  for each row execute function private.item_answer_keys_guard();
alter table public.item_answer_keys enable always trigger item_answer_keys_guard;

-- assignments ------------------------------------------------------------------------------------
create function private.assignments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select t.workspace_id into v_ws
  from public.tests as t where t.org_id = new.org_id and t.id = new.test_id;
  if not found then
    raise exception 'TRACE_GUARD: test not found' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.memberships as m
    where m.org_id = new.org_id and m.id = new.membership_id and m.status = 'active'
      and new.as_role = any (m.roles)
  ) then
    raise exception 'TRACE_GUARD: the membership must be active and hold the role' using errcode = '42501';
  end if;
  new.workspace_id := v_ws;
  new.created_by := (select auth.uid());
  return new;
end
$$;
revoke execute on function private.assignments_guard() from public, anon, authenticated, service_role;

-- No UPDATE grant exists; this trigger makes the "no UPDATE" rule hold for every role including the owner.
create function private.assignments_no_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'TRACE_GUARD: assignments cannot be updated' using errcode = '42501';
end
$$;
revoke execute on function private.assignments_no_update() from public, anon, authenticated, service_role;

create function private.assignments_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.org_id, 'assignment.create', 'assignments', new.id,
      jsonb_build_object('test_id', new.test_id, 'membership_id', new.membership_id), new.workspace_id);
  else
    perform private.audit(old.org_id, 'assignment.delete', 'assignments', old.id,
      jsonb_build_object('test_id', old.test_id, 'membership_id', old.membership_id), old.workspace_id);
  end if;
  return null;
end
$$;
revoke execute on function private.assignments_audit() from public, anon, authenticated, service_role;

create trigger assignments_guard before insert on public.assignments
  for each row execute function private.assignments_guard();
create trigger assignments_no_update before update on public.assignments
  for each row execute function private.assignments_no_update();
create trigger assignments_audit after insert or delete on public.assignments
  for each row execute function private.assignments_audit();
alter table public.assignments enable always trigger assignments_guard;
alter table public.assignments enable always trigger assignments_no_update;

-- ---------------------------------------------------------------------------------------------
-- Grants and policies. One policy per operation per role set; nothing for anon / candidate; HM denied everywhere.
--   staff arm    = owner / admin / recruiter, inside their workspaces (children carry workspace_id, L-27)
--   reviewer arm = tests assigned to the reviewer (S*)
--   workers      = org_id bound to private.job_org_id(); trace_api = org_id bound to private.api_org_id()
-- "writes only while draft (d)" is enforced by the guard triggers above; the test_versions policies also carry
-- it where L-30 says so.
-- ---------------------------------------------------------------------------------------------

-- tests
grant select on public.tests to authenticated;
grant insert (org_id, workspace_id, name) on public.tests to authenticated;
grant update (name, archived_at) on public.tests to authenticated;
create policy tests_select_staff on public.tests for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy tests_select_reviewer on public.tests for select to authenticated
  using (id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy tests_insert_staff on public.tests for insert to authenticated
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy tests_update_staff on public.tests for update to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]))
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));

-- rubric_versions (org-level)
grant select on public.rubric_versions to authenticated;
grant insert (org_id, rubric_key, version_no, criteria, content_sha256) on public.rubric_versions to authenticated;
grant update (criteria, content_sha256) on public.rubric_versions to authenticated;
grant select on public.rubric_versions to trace_quality_worker;
create policy rubric_versions_select_member on public.rubric_versions for select to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin,recruiter,reviewer}'))::uuid[]));
create policy rubric_versions_insert_staff on public.rubric_versions for insert to authenticated
  with check (org_id = any ((select private.my_org_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy rubric_versions_update_staff on public.rubric_versions for update to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin,recruiter}'))::uuid[]))
  with check (org_id = any ((select private.my_org_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy rubric_versions_select_quality_worker on public.rubric_versions for select to trace_quality_worker
  using (org_id = (select private.job_org_id()));

-- notice_versions (no writer: migration 3's seed function inserts)
grant select on public.notice_versions to authenticated;
grant select on public.notice_versions to trace_api;
create policy notice_versions_select_member on public.notice_versions for select to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin,recruiter,reviewer}'))::uuid[]));
create policy notice_versions_select_api on public.notice_versions for select to trace_api
  using (org_id = (select private.api_org_id()));

-- ruleset_versions. Read-only for app roles: signal_settings and band_rule_version_id are set only by migration 3's
-- L-8 trigger, and the other columns are system-assigned, so no writable column is left for authenticated (the
-- matrix's SIU(d) cell is therefore select only; the draft ruleset is created and deleted by definer triggers).
grant select on public.ruleset_versions to authenticated;
grant select on public.ruleset_versions to trace_integrity_worker;
create policy ruleset_versions_select_staff on public.ruleset_versions for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy ruleset_versions_select_reviewer on public.ruleset_versions for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy ruleset_versions_select_integrity_worker on public.ruleset_versions
  for select to trace_integrity_worker
  using (org_id = (select private.job_org_id()));

-- test_versions
grant select on public.test_versions to authenticated;
grant insert (org_id, test_id, version_no, total_time_seconds, quality_cutoff) on public.test_versions to authenticated;
grant update (status, total_time_seconds, quality_cutoff, content_sha256) on public.test_versions to authenticated;
grant delete on public.test_versions to authenticated;
grant select on public.test_versions to trace_quality_worker;
grant select (id, org_id, test_id, status, total_time_seconds, ruleset_version_id, notice_version_id, content_sha256)
  on public.test_versions to trace_api;
create policy test_versions_select_staff on public.test_versions for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy test_versions_select_reviewer on public.test_versions for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy test_versions_insert_staff on public.test_versions for insert to authenticated
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
-- L-30: USING admits draft and published rows; WITH CHECK carries the role arm only, so publish (draft -> published)
-- and retire (published -> retired) pass; the guard trigger owns the state machine.
create policy test_versions_update_staff on public.test_versions for update to authenticated
  using (
    status in ('draft', 'published')
    and workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[])
  )
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy test_versions_delete_staff on public.test_versions for delete to authenticated
  using (
    status = 'draft'
    and workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[])
  );
create policy test_versions_select_quality_worker on public.test_versions for select to trace_quality_worker
  using (org_id = (select private.job_org_id()));
create policy test_versions_select_api on public.test_versions for select to trace_api
  using (org_id = (select private.api_org_id()));

-- sections
grant select, delete on public.sections to authenticated;
grant insert (org_id, test_version_id, position, name, format, weight, time_limit_seconds)
  on public.sections to authenticated;
grant update (position, name, weight, time_limit_seconds) on public.sections to authenticated;
grant select on public.sections to trace_quality_worker;
create policy sections_select_staff on public.sections for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy sections_select_reviewer on public.sections for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy sections_insert_staff on public.sections for insert to authenticated
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy sections_update_staff on public.sections for update to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]))
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy sections_delete_staff on public.sections for delete to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy sections_select_quality_worker on public.sections for select to trace_quality_worker
  using (org_id = (select private.job_org_id()));

-- item_versions
grant select, delete on public.item_versions to authenticated;
-- test_version_id is overwritten from the section by item_versions_guard; origin is pinned to 'human' by a CHECK,
-- so granting both adds no capability and lets the CHECK report 23514 (an AI-drafted item cannot exist).
grant insert (org_id, test_version_id, section_id, format, position, stem, options, rubric_version_id, origin,
  content_sha256) on public.item_versions to authenticated;
grant update (position, stem, options, rubric_version_id, content_sha256) on public.item_versions to authenticated;
grant select on public.item_versions to trace_quality_worker;
create policy item_versions_select_staff on public.item_versions for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy item_versions_select_reviewer on public.item_versions for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy item_versions_insert_staff on public.item_versions for insert to authenticated
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy item_versions_update_staff on public.item_versions for update to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]))
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy item_versions_delete_staff on public.item_versions for delete to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy item_versions_select_quality_worker on public.item_versions for select to trace_quality_worker
  using (org_id = (select private.job_org_id()));

-- item_answer_keys
grant select, delete on public.item_answer_keys to authenticated;
-- format is pinned to 'mcq' by a CHECK and the composite FK; granting it lets those report 23514 / 23503.
grant insert (org_id, item_version_id, format, key) on public.item_answer_keys to authenticated;
grant update (key) on public.item_answer_keys to authenticated;
grant select on public.item_answer_keys to trace_quality_worker;
create policy item_answer_keys_select_staff on public.item_answer_keys for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy item_answer_keys_select_reviewer on public.item_answer_keys for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy item_answer_keys_insert_staff on public.item_answer_keys for insert to authenticated
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy item_answer_keys_update_staff on public.item_answer_keys for update to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]))
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy item_answer_keys_delete_staff on public.item_answer_keys for delete to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy item_answer_keys_select_quality_worker on public.item_answer_keys for select to trace_quality_worker
  using (org_id = (select private.job_org_id()));

-- assignments (L-16: owner/admin any test; a recruiter only reviewer rows on tests they are assigned to, inside
-- their workspaces). No UPDATE grant.
grant select, delete on public.assignments to authenticated;
-- scope is pinned to 'test' by a CHECK; granting it lets the CHECK report 23514.
grant insert (org_id, membership_id, scope, test_id, as_role) on public.assignments to authenticated;
create policy assignments_select_staff on public.assignments for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
-- Reviewer: own rows only (a reviewer at aal1 holds no counting membership, so org_id never matches).
create policy assignments_select_reviewer_own on public.assignments for select to authenticated
  using (
    org_id = any ((select private.my_org_ids('{reviewer}'))::uuid[])
    and membership_id in (select m.id from public.memberships as m where m.user_id = (select auth.uid()))
  );
create policy assignments_insert_owner_admin on public.assignments for insert to authenticated
  with check (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]));
create policy assignments_insert_recruiter on public.assignments for insert to authenticated
  with check (
    as_role = 'reviewer'
    and workspace_id = any ((select private.my_workspace_ids('{recruiter}'))::uuid[])
    and test_id = any ((select private.my_assigned_test_ids('{recruiter}'))::uuid[])
  );
create policy assignments_delete_owner_admin on public.assignments for delete to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin}'))::uuid[]));
create policy assignments_delete_recruiter on public.assignments for delete to authenticated
  using (
    as_role = 'reviewer'
    and workspace_id = any ((select private.my_workspace_ids('{recruiter}'))::uuid[])
    and test_id = any ((select private.my_assigned_test_ids('{recruiter}'))::uuid[])
  );
