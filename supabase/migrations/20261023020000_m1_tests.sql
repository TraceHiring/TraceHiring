-- M1 migration b of d (spec specs/m1-test-authoring.md revision 5: §3.1 row M1-b, §3.2, §3.3, §3.4, §3.5, §3.6, §6.6,
-- §6.7; binding rows R2-1, R2-9, R2-12, R2-13, R3-1, R3-2, R3-3, R5-5, R5-18, R5-19, R5-29, R5-31, R5-33, R5-34, R5-39,
-- R5-41, R5-43). Jobs and role templates, the widened sections and test versions, the publish guard v2 and its snapshot,
-- the integrity settings catalog, presets and admin locks, the ruleset settings and their derivation, the widened
-- session_items with the serving gate and the exposure trigger, the drive pool-ratio check, and the R5-5 flags guard.
--
-- PROVISIONAL TIMESTAMP (R5-30): see 20261023010000_m1_bank.sql. Functions replaced here and re-derived from the newest
-- D1 body at the D1 CLOSE merge: test_versions_guard (from 20261014093232_d1_authoring_fixes.sql, R5-18),
-- ruleset_versions_guard, session_items_guard, responses_guard (R5-43) and integrity_flags_guard (from
-- 20261021091905_d1_flags_rule_table.sql, R5-5).
--
-- First reviews folded in place (provisional file, R5-30): DB-M1-1 (a written section's paste rule is the settings'
-- paste_written), DB-M1-3 (no snapshot row for a published version), DB-M1-4 (pool-section slots), DB-M1-7 (no preset
-- without settings), DB-M1-8 (sealed settings catalog), DB-M1-9 (E4 read from the written snapshot), DB-M1-10 (index),
-- DB-M1-12 (strata quotas, the 5,000-item cap, template skills).
--
-- I-M1-10: the only integrity.* object touched is private.integrity_flags_guard (R5-5), which already read
-- public.sessions, public.ruleset_versions and integrity.band_rule_versions; it now also reads
-- ruleset_versions.signal_settings. Nothing here names quality.*. The band rule table is never changed (rule 3): a setting
-- only switches a signal on or off (M1-13).

-- ---------------------------------------------------------------------------------------------
-- Validators
-- ---------------------------------------------------------------------------------------------
-- §5 BlueprintProposal source: {"sections": [{title, format, skillKey, drawCount, available}] 1-10, "totalTimeSeconds"}.
-- Formats not yet servable (voice, typing) are listed with available = false and skipped when a draft is made (M1-16).
create function private.blueprint_valid(p_blueprint jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case
      when jsonb_typeof(p_blueprint) = 'object' and octet_length(p_blueprint::text) <= 8192
        and (select array_agg(k order by k) from jsonb_object_keys(p_blueprint) as k)
          = array['sections', 'totalTimeSeconds']::text[]
        and jsonb_typeof(p_blueprint -> 'totalTimeSeconds') = 'number'
        and (p_blueprint ->> 'totalTimeSeconds')::numeric between 60 and 7200
        and jsonb_typeof(p_blueprint -> 'sections') = 'array'
        and jsonb_array_length(p_blueprint -> 'sections') between 1 and 10 then
        not exists (
          select 1 from jsonb_array_elements(p_blueprint -> 'sections') as s
          where jsonb_typeof(s) is distinct from 'object'
            or (select array_agg(k order by k) from jsonb_object_keys(s) as k)
              is distinct from array['available', 'drawCount', 'format', 'skillKey', 'title']::text[]
            or jsonb_typeof(s -> 'title') is distinct from 'string' or char_length(s ->> 'title') not between 1 and 120
            or (s ->> 'format') is null or (s ->> 'format') not in ('mcq', 'written', 'voice', 'typing')
            or jsonb_typeof(s -> 'skillKey') is distinct from 'string' or (s ->> 'skillKey') !~ '^[a-z][a-z0-9_]{1,40}$'
            or jsonb_typeof(s -> 'drawCount') is distinct from 'number'
            or (s ->> 'drawCount')::numeric not between 1 and 100
            or jsonb_typeof(s -> 'available') is distinct from 'boolean'
            or ((s ->> 'available')::boolean and (s ->> 'format') not in ('mcq', 'written'))
        )
      else false
    end,
    false
  )
$$;
revoke execute on function private.blueprint_valid(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.blueprint_valid(jsonb) to authenticated;

-- The new ruleset_versions UPDATE grant makes its D1 CHECK run as authenticated (R5-32).
grant execute on function private.signal_settings_valid(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- role_templates and jobs (ABH-5, M1-16, M1-17)
-- ---------------------------------------------------------------------------------------------
create table public.role_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  template_key text not null check (template_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  version int not null check (version >= 1),
  name text not null check (char_length(name) between 1 and 120),
  keywords text[] not null check (cardinality(keywords) between 1 and 80 and array_position(keywords, null) is null),
  blueprint jsonb not null check (private.blueprint_valid(blueprint)),
  preset_key text not null check (preset_key in ('strict', 'standard', 'open_book')),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  created_by uuid null,
  created_at timestamptz not null default now(),
  published_at timestamptz null,
  unique (org_id, id),
  unique (org_id, template_key, version),
  check ((status = 'draft') = (published_at is null))
);
alter table public.role_templates enable row level security;

-- No JD text column (M1-17): only its hash and the match result.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  role_template_version_id uuid null,
  jd_sha256 text null check (jd_sha256 is null or jd_sha256 ~ '^[0-9a-f]{64}$'),
  template_match_permille smallint null check (template_match_permille is null or template_match_permille between 0 and 1000),
  created_by uuid null,
  created_at timestamptz not null default now(),
  archived_at timestamptz null,
  unique (org_id, id),
  unique (org_id, id, workspace_id),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict
);
create index jobs_workspace_idx on public.jobs (org_id, workspace_id);
alter table public.jobs enable row level security;

create function private.role_templates_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blueprint_changed boolean := tg_op = 'INSERT';
begin
  if exists (select 1 from unnest(new.keywords) as k where char_length(k) not between 2 and 40) then
    raise exception 'TRACE_GUARD: a template keyword has 2 to 40 characters' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    v_blueprint_changed := new.blueprint is distinct from old.blueprint;
  end if;
  -- DB-M1-12: every blueprint section names a live skill of the library taxonomy (a malformed blueprint is left for
  -- blueprint_valid's CHECK).
  if v_blueprint_changed and exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(new.blueprint -> 'sections') = 'array' then new.blueprint -> 'sections' else '[]'::jsonb end
    ) as s
    where jsonb_typeof(s -> 'skillKey') = 'string' and not private.skill_key_exists(s ->> 'skillKey')
  ) then
    raise exception 'TRACE_GUARD: skill not found' using errcode = '23503';
  end if;
  if tg_op = 'INSERT' then
    if not private.is_operator() then
      new.status := 'draft';
      new.published_at := null;
      new.created_by := (select auth.uid());
    end if;
    new.created_at := now();
    return new;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.template_key is distinct from old.template_key or new.version is distinct from old.version
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: template id, org, key, version and creator are immutable' using errcode = '42501';
  end if;
  if old.status = 'draft' and new.status = 'draft' then
    return new;
  end if;
  if old.status = 'draft' and new.status = 'published' then
    new.published_at := now();
    return new;
  end if;
  -- Immutable from published (§3.2): only published -> retired, nothing else changes.
  if old.status = 'published' and new.status = 'retired' and new.name is not distinct from old.name
    and new.keywords is not distinct from old.keywords and new.blueprint is not distinct from old.blueprint
    and new.preset_key is not distinct from old.preset_key and new.published_at is not distinct from old.published_at then
    return new;
  end if;
  raise exception 'TRACE_GUARD: a published template is frozen' using errcode = '42501';
end
$$;
revoke execute on function private.role_templates_guard() from public, anon, authenticated, service_role;

create function private.role_templates_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'published' then
    perform private.audit(new.org_id, 'role_template.publish', 'role_templates', new.id,
      jsonb_build_object('version', new.version));
  end if;
  return null;
end
$$;
revoke execute on function private.role_templates_audit() from public, anon, authenticated, service_role;

create trigger role_templates_guard before insert or update on public.role_templates
  for each row execute function private.role_templates_guard();
create trigger role_templates_audit after update on public.role_templates
  for each row execute function private.role_templates_audit();
alter table public.role_templates enable always trigger role_templates_guard;

-- A job's template is a published template of its own org or of the library (cross-org reference by plain uuid, R2-9).
create function private.jobs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.role_template_version_id is not null and not exists (
      select 1 from public.role_templates as t
      where t.id = new.role_template_version_id and t.status = 'published'
        and (t.org_id = new.org_id or t.org_id = private.library_org_id())
    ) then
      raise exception 'TRACE_GUARD: role template not found' using errcode = '23503';
    end if;
    new.created_by := case when private.is_operator() then new.created_by else (select auth.uid()) end;
    new.created_at := now();
    return new;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.workspace_id is distinct from old.workspace_id
    or new.role_template_version_id is distinct from old.role_template_version_id
    or new.jd_sha256 is distinct from old.jd_sha256 or new.template_match_permille is distinct from old.template_match_permille
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: job id, org, workspace, template match and creator are immutable' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.jobs_guard() from public, anon, authenticated, service_role;
create trigger jobs_guard before insert or update on public.jobs
  for each row execute function private.jobs_guard();
alter table public.jobs enable always trigger jobs_guard;

-- ---------------------------------------------------------------------------------------------
-- tests, sections, test_versions widened (§3.3)
-- ---------------------------------------------------------------------------------------------
alter table public.tests add column job_id uuid null;
alter table public.tests add constraint tests_job_fk foreign key (org_id, job_id, workspace_id)
  references public.jobs (org_id, id, workspace_id) on delete restrict;
create index tests_job_idx on public.tests (org_id, job_id);

alter table public.sections
  add column pool_id uuid null,
  add column draw_count int null check (draw_count is null or draw_count > 0),
  add column shuffle_items boolean not null default false,
  add column shuffle_options boolean not null default false,
  add column navigation text null check (navigation is null or navigation in ('free', 'forward_only')),
  add column paste_rule text null check (paste_rule is null or paste_rule in ('blocked', 'allowed_logged')),
  add column blueprint jsonb null check (blueprint is null or (jsonb_typeof(blueprint) = 'object'
    and octet_length(blueprint::text) <= 4096)),
  add constraint sections_pool_draw check ((pool_id is null) = (draw_count is null)),
  -- R2-1: null navigation is package v1 behaviour; written sections are one-way (Q26).
  add constraint sections_written_forward_only check (navigation is null or format <> 'written' or navigation = 'forward_only'),
  add constraint sections_paste_rule_written check (paste_rule is null or format = 'written'),
  add constraint sections_pool_fk foreign key (org_id, pool_id, workspace_id)
    references public.pools (org_id, id, workspace_id) on delete restrict;
create index sections_pool_idx on public.sections (org_id, pool_id);

alter table public.test_versions
  add column min_pool_ratio numeric(6, 2) null,
  add column package_version smallint not null default 1 check (package_version in (1, 2)),
  add column role_template_version_id uuid null;

-- ---------------------------------------------------------------------------------------------
-- section_pool_snapshot (§3.2; R3-2, R3-3): what a published v2 version serves, written only by the publish guard
-- ---------------------------------------------------------------------------------------------
create table public.section_pool_snapshot (
  org_id uuid not null references public.orgs (id) on delete restrict,
  section_id uuid not null,
  item_version_id uuid not null,
  workspace_id uuid not null,
  test_id uuid not null,
  test_version_id uuid not null,
  exposure_at_publish int not null check (exposure_at_publish >= 0),
  primary key (org_id, section_id, item_version_id),
  unique (org_id, test_version_id, item_version_id),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict,
  foreign key (org_id, test_version_id) references public.test_versions (org_id, id) on delete restrict,
  foreign key (org_id, section_id) references public.sections (org_id, id) on delete restrict,
  foreign key (org_id, item_version_id) references public.item_versions (org_id, id) on delete restrict
);
create index section_pool_snapshot_item_idx on public.section_pool_snapshot (org_id, item_version_id);
create index section_pool_snapshot_test_idx on public.section_pool_snapshot (org_id, test_id);
-- DB-M1-10: the staff policy reads by workspace.
create index section_pool_snapshot_workspace_idx on public.section_pool_snapshot (org_id, workspace_id);
alter table public.section_pool_snapshot enable row level security;

-- Insert only inside the publish guard, which sets trace.publishing to the version it publishes. No app or worker role
-- holds INSERT, so only the owner's definer code (or the operator naming that version) reaches this branch; never
-- updated, deleted or truncated, for every role (I-M1-2). DB-M1-3: the version must still be a draft; the publish guard
-- is a BEFORE UPDATE trigger, so the row it publishes still reads 'draft' while the snapshot is written.
create function private.section_pool_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'TRACE_GUARD: the snapshot is written by publish only and is immutable' using errcode = '42501';
  end if;
  if current_setting('trace.publishing', true) is distinct from new.test_version_id::text
    or not exists (
      select 1 from public.test_versions as v
      where v.org_id = new.org_id and v.id = new.test_version_id and v.status = 'draft'
    ) then
    raise exception 'TRACE_GUARD: the snapshot is written by publish only and is immutable' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.section_pool_snapshot_guard() from public, anon, authenticated, service_role;
create trigger section_pool_snapshot_guard before insert or update or delete on public.section_pool_snapshot
  for each row execute function private.section_pool_snapshot_guard();
create trigger section_pool_snapshot_no_truncate before truncate on public.section_pool_snapshot
  for each statement execute function private.section_pool_snapshot_guard();
alter table public.section_pool_snapshot enable always trigger section_pool_snapshot_guard;
alter table public.section_pool_snapshot enable always trigger section_pool_snapshot_no_truncate;

-- ---------------------------------------------------------------------------------------------
-- Integrity settings catalog, presets and admin locks (Q18, M1-13, M1-14, screen 04)
-- ---------------------------------------------------------------------------------------------
create table public.integrity_setting_defs (
  org_id uuid not null references public.orgs (id) on delete restrict,
  catalog_version text not null check (catalog_version ~ '^[a-z0-9-]{1,40}$'),
  setting_key text not null check (setting_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  value_kind text not null check (value_kind in ('on_off', 'on_off_warn', 'paste_rule', 'fixed')),
  allowed_values text[] not null check (cardinality(allowed_values) between 1 and 4),
  default_value text not null,
  always_locked boolean not null,
  available_from text not null check (available_from in ('D1', 'M3b', 'M4', 'phase2')),
  maps_to_signals text[] not null default '{}'
    check (maps_to_signals <@ array['paste', 'drop', 'untrusted_input', 'tab_hidden', 'fullscreen_exit']::text[]),
  primary key (org_id, catalog_version, setting_key),
  check (default_value = any (allowed_values)),
  check (not always_locked or cardinality(allowed_values) = 1)
);
alter table public.integrity_setting_defs enable row level security;

create table public.integrity_presets (
  org_id uuid not null references public.orgs (id) on delete restrict,
  preset_key text not null check (preset_key in ('strict', 'standard', 'open_book')),
  version int not null check (version >= 1),
  catalog_version text not null,
  preset_values jsonb not null check (jsonb_typeof(preset_values) = 'object'),
  primary key (org_id, preset_key, version)
);
alter table public.integrity_presets enable row level security;

create function private.settings_catalog_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'TRACE_GUARD: the settings catalog and presets are immutable' using errcode = '42501';
end
$$;
revoke execute on function private.settings_catalog_frozen() from public, anon, authenticated, service_role;
create trigger integrity_setting_defs_frozen before update or delete on public.integrity_setting_defs
  for each row execute function private.settings_catalog_frozen();
create trigger integrity_setting_defs_no_truncate before truncate on public.integrity_setting_defs
  for each statement execute function private.settings_catalog_frozen();
create trigger integrity_presets_frozen before update or delete on public.integrity_presets
  for each row execute function private.settings_catalog_frozen();
create trigger integrity_presets_no_truncate before truncate on public.integrity_presets
  for each statement execute function private.settings_catalog_frozen();
alter table public.integrity_setting_defs enable always trigger integrity_setting_defs_frozen;
alter table public.integrity_setting_defs enable always trigger integrity_setting_defs_no_truncate;
alter table public.integrity_presets enable always trigger integrity_presets_frozen;
alter table public.integrity_presets enable always trigger integrity_presets_no_truncate;

create table public.org_integrity_locks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  setting_key text not null check (setting_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  locked_value text not null check (char_length(locked_value) between 1 and 40),
  locked_by uuid null,
  locked_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, setting_key)
);
alter table public.org_integrity_locks enable row level security;

-- The current catalog of the library org.
create function private.current_settings_catalog()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'm1-settings-v1'::text
$$;
revoke execute on function private.current_settings_catalog() from public, anon, authenticated, service_role;

create function private.org_integrity_locks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def public.integrity_setting_defs;
begin
  if tg_op = 'UPDATE' then
    raise exception 'TRACE_GUARD: a lock is removed and added, never changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  select d.* into v_def from public.integrity_setting_defs as d
  where d.org_id = private.library_org_id() and d.catalog_version = private.current_settings_catalog()
    and d.setting_key = new.setting_key;
  if not found then
    raise exception 'TRACE_GUARD: setting not found' using errcode = '23503';
  end if;
  if v_def.always_locked then
    raise exception 'TRACE_GUARD: this setting is always locked' using errcode = '42501';
  end if;
  if not (new.locked_value = any (v_def.allowed_values)) then
    raise exception 'TRACE_GUARD: setting value not allowed' using errcode = '23514';
  end if;
  new.locked_by := case when private.is_operator() then new.locked_by else (select auth.uid()) end;
  new.locked_at := now();
  return new;
end
$$;
revoke execute on function private.org_integrity_locks_guard() from public, anon, authenticated, service_role;

create function private.org_integrity_locks_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.org_id, 'integrity_lock.create', 'org_integrity_locks', new.id,
      jsonb_build_object('setting_key', new.setting_key));
  else
    perform private.audit(old.org_id, 'integrity_lock.delete', 'org_integrity_locks', old.id,
      jsonb_build_object('setting_key', old.setting_key));
  end if;
  return null;
end
$$;
revoke execute on function private.org_integrity_locks_audit() from public, anon, authenticated, service_role;

create trigger org_integrity_locks_guard before insert or update or delete on public.org_integrity_locks
  for each row execute function private.org_integrity_locks_guard();
create trigger org_integrity_locks_audit after insert or delete on public.org_integrity_locks
  for each row execute function private.org_integrity_locks_audit();
alter table public.org_integrity_locks enable always trigger org_integrity_locks_guard;

-- ---------------------------------------------------------------------------------------------
-- ruleset_versions settings (M1-13, R3-1, I-M1-6, I-M1-7)
-- ---------------------------------------------------------------------------------------------
alter table public.ruleset_versions
  add column catalog_version text null,
  add column preset_key text null check (preset_key is null or preset_key in ('strict', 'standard', 'open_book')),
  add column preset_version int null check (preset_version is null or preset_version >= 1),
  add column settings jsonb null check (settings is null or (jsonb_typeof(settings) = 'object'
    and octet_length(settings::text) <= 4096)),
  add constraint ruleset_versions_settings_catalog check ((settings is null) = (catalog_version is null));

-- Raises unless p_settings names every setting of the catalog with an allowed value, and every admin-locked setting of
-- the org with its locked value (I-M1-6). Always-locked settings have one allowed value, so the value check holds them.
create function private.integrity_settings_check(p_org uuid, p_settings jsonb, p_catalog text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lib uuid := private.library_org_id();
begin
  if not exists (
    select 1 from public.integrity_setting_defs as d where d.org_id = v_lib and d.catalog_version = p_catalog
  ) then
    raise exception 'TRACE_GUARD: unknown settings catalog' using errcode = '42501';
  end if;
  if jsonb_typeof(p_settings) is distinct from 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(p_settings) as k)
      is distinct from (select array_agg(d.setting_key order by d.setting_key) from public.integrity_setting_defs as d
                        where d.org_id = v_lib and d.catalog_version = p_catalog) then
    raise exception 'TRACE_GUARD: the settings name every setting of the catalog' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.integrity_setting_defs as d
    where d.org_id = v_lib and d.catalog_version = p_catalog
      and (jsonb_typeof(p_settings -> d.setting_key) is distinct from 'string'
        or not ((p_settings ->> d.setting_key) = any (d.allowed_values)))
  ) then
    raise exception 'TRACE_GUARD: setting value not allowed' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.org_integrity_locks as l
    where l.org_id = p_org and p_settings ? l.setting_key and (p_settings ->> l.setting_key) <> l.locked_value
  ) then
    raise exception 'TRACE_GUARD: setting locked by admin' using errcode = '42501';
  end if;
end
$$;
revoke execute on function private.integrity_settings_check(uuid, jsonb, text) from public, anon, authenticated, service_role;

-- The D1 five-key signal_settings, derived from the settings (R2-11, M1-13; STABLE: reads the catalog). A D1 signal is
-- enabled unless a setting that maps it is 'off' or 'allowed_logged' (§6.7: an allowed, logged paste is context only).
-- A setting switches its mapped signals whatever its "runs from" (R5-39 d).
create function private.derive_signal_settings(p_settings jsonb, p_catalog text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lib uuid := private.library_org_id();
  v_out jsonb;
begin
  if not exists (
    select 1 from public.integrity_setting_defs as d where d.org_id = v_lib and d.catalog_version = p_catalog
  ) then
    raise exception 'TRACE_GUARD: unknown settings catalog' using errcode = '42501';
  end if;
  select jsonb_object_agg(s.sig, jsonb_build_object('enabled', coalesce((
      select bool_and(coalesce(p_settings ->> d.setting_key, d.default_value) not in ('off', 'allowed_logged'))
      from public.integrity_setting_defs as d
      where d.org_id = v_lib and d.catalog_version = p_catalog and s.sig = any (d.maps_to_signals)
    ), true)))
    into v_out
  from unnest(array['drop', 'fullscreen_exit', 'paste', 'tab_hidden', 'untrusted_input']) as s(sig);
  return v_out;
end
$$;
revoke execute on function private.derive_signal_settings(jsonb, text) from public, anon, authenticated, service_role;

-- ruleset_versions guard v2 (re-derived from 20261014065417_d1_authoring.sql, R5-30). Rows without settings behave
-- exactly as D1 (R5-39 c); a row with settings has them validated and its signal_settings derived on every write.
create or replace function private.ruleset_versions_guard()
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
  else
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
    if old.settings is not null and new.settings is null then
      raise exception 'TRACE_GUARD: settings once set are not removed' using errcode = '42501';
    end if;
  end if;
  if new.settings is not null then
    new.catalog_version := coalesce(new.catalog_version, private.current_settings_catalog());
    if new.preset_key is not null then
      new.preset_version := coalesce(new.preset_version, (
        select max(p.version) from public.integrity_presets as p
        where p.org_id = private.library_org_id() and p.preset_key = new.preset_key));
      if not exists (
        select 1 from public.integrity_presets as p
        where p.org_id = private.library_org_id() and p.preset_key = new.preset_key and p.version = new.preset_version
          and p.catalog_version = new.catalog_version
      ) then
        raise exception 'TRACE_GUARD: preset not found' using errcode = '23503';
      end if;
    else
      new.preset_version := null;
    end if;
    perform private.integrity_settings_check(new.org_id, new.settings, new.catalog_version);
    -- I-M1-7: derived, never client-written.
    new.signal_settings := private.derive_signal_settings(new.settings, new.catalog_version);
  elsif new.preset_key is not null or new.preset_version is not null then
    -- DB-M1-7: a preset is a set of settings; it is never named without them. D1 rows never set either column, so the D1
    -- path (R5-39 c) is unchanged.
    raise exception 'TRACE_GUARD: a preset needs its settings' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.ruleset_versions_guard() from public, anon, authenticated, service_role;

create function private.ruleset_versions_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.settings is not null and (new.settings is distinct from old.settings or new.preset_key is distinct from old.preset_key) then
    perform private.audit(new.org_id, 'test.integrity_settings', 'ruleset_versions', new.id,
      jsonb_build_object('preset_key', new.preset_key, 'catalog_version', new.catalog_version), new.workspace_id);
  end if;
  return null;
end
$$;
revoke execute on function private.ruleset_versions_audit() from public, anon, authenticated, service_role;
create trigger ruleset_versions_audit after update on public.ruleset_versions
  for each row execute function private.ruleset_versions_audit();

-- ---------------------------------------------------------------------------------------------
-- test_versions guard v2 (re-derived from 20261014093232_d1_authoring_fixes.sql, R5-18, R5-30). D1's checks stay; a
-- version that uses any M1 feature or has settings is package v2 and meets §3.4's extra rules; publish writes the
-- snapshot (v2) and min_pool_ratio.
-- ---------------------------------------------------------------------------------------------
create or replace function private.test_versions_guard()
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
  v_settings jsonb;
  v_catalog text;
  v_v2 boolean;
  v_timed int;
  v_sections int;
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
    new.created_by := case when private.is_operator() then new.created_by else v_uid end;  -- as tests_guard (m-1)
    new.published_at := null;
    new.published_by := null;
    if new.version_no is null then
      select coalesce(max(v.version_no), 0) + 1 into new.version_no
      from public.test_versions as v where v.org_id = new.org_id and v.test_id = new.test_id;
    end if;
    -- The M1 columns are set by test_versions_m1_insert (below), so this insert path still runs on a D1-shaped row.
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
        or new.published_by is distinct from old.published_by
        -- R5-33: the M1 columns freeze with the version.
        or new.min_pool_ratio is distinct from old.min_pool_ratio
        or new.package_version is distinct from old.package_version
        or new.role_template_version_id is distinct from old.role_template_version_id then
        raise exception 'TRACE_GUARD: a published test version is frozen' using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'TRACE_GUARD: status change not allowed' using errcode = '42501';
  end if;

  -- old.status = 'draft'
  new.min_pool_ratio := old.min_pool_ratio;
  new.package_version := old.package_version;
  new.role_template_version_id := old.role_template_version_id;
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
  select r.band_rule_version_id, r.settings, r.catalog_version into v_band, v_settings, v_catalog
  from public.ruleset_versions as r where r.org_id = new.org_id and r.id = new.ruleset_version_id;
  if v_band is null then
    raise exception 'TRACE_GUARD: publish needs a ruleset with a band rule version' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sections as s where s.org_id = new.org_id and s.test_version_id = new.id) then
    raise exception 'TRACE_GUARD: publish needs at least one section' using errcode = '42501';
  end if;
  -- R2-1: replaces D1's "every section has an item": an inline section has its items, a pool section has none of its
  -- own and draws from its pool.
  if exists (
    select 1 from public.sections as s
    where s.org_id = new.org_id and s.test_version_id = new.id and s.pool_id is null
      and not exists (select 1 from public.item_versions as i where i.org_id = s.org_id and i.section_id = s.id)
  ) then
    raise exception 'TRACE_GUARD: every section needs at least one item' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.sections as s
    where s.org_id = new.org_id and s.test_version_id = new.id and s.pool_id is not null
      and exists (select 1 from public.item_versions as i where i.org_id = s.org_id and i.section_id = s.id)
  ) then
    raise exception 'TRACE_GUARD: a section either serves its own items or draws from one pool' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.sections as s
    join public.pools as p on p.org_id = s.org_id and p.id = s.pool_id
    where s.org_id = new.org_id and s.test_version_id = new.id and (p.status <> 'active' or p.format <> s.format)
  ) then
    raise exception 'TRACE_GUARD: a section draws from an active pool of its format' using errcode = '42501';
  end if;
  -- E4 (a pool section needs at least draw_count approved items) is checked on the written snapshot below (DB-M1-9), so
  -- a pool change committed between a check and the snapshot cannot leave a section short.
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
  -- The same for the approved pool items a pool section can draw (each variant of a parameterised item).
  if exists (
    select 1 from public.sections as s
    join public.pool_items as pi on pi.org_id = s.org_id and pi.pool_id = s.pool_id
    join public.item_versions as i on i.org_id = pi.org_id and i.id = pi.item_version_id
    where s.org_id = new.org_id and s.test_version_id = new.id and i.status = 'approved' and i.format = 'mcq'
      and ((not i.is_parameterised and not exists (
              select 1 from public.item_answer_keys as k, jsonb_array_elements(i.options) as o
              where k.org_id = i.org_id and k.item_version_id = i.id and o ->> 'id' = k.key ->> 'option_id'))
        or (i.is_parameterised and (
              not exists (select 1 from public.item_variants as v where v.org_id = i.org_id and v.item_version_id = i.id)
              or exists (
                select 1 from public.item_variants as v
                where v.org_id = i.org_id and v.item_version_id = i.id
                  and not exists (select 1 from public.item_variant_keys as vk
                                  where vk.org_id = v.org_id and vk.item_variant_id = v.id)))))
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

  -- Package version (R3-1): v2 when the version uses any M1 feature or has settings; a v1 draft publishes as D1.
  v_v2 := v_settings is not null
    or exists (
      select 1 from public.sections as s
      where s.org_id = new.org_id and s.test_version_id = new.id
        and (s.pool_id is not null or s.navigation is not null or s.shuffle_items or s.shuffle_options
          or s.paste_rule is not null or s.blueprint is not null)
    )
    or exists (
      select 1 from public.item_versions as i
      where i.org_id = new.org_id and i.test_version_id = new.id and i.media is not null
    );
  -- R5-34: a draft without settings cannot dodge the org's admin locks.
  if v_settings is null and exists (select 1 from public.org_integrity_locks as l where l.org_id = new.org_id) then
    raise exception 'TRACE_GUARD: settings required while admin locks exist' using errcode = '42501';
  end if;
  if v_v2 and v_settings is null then
    raise exception 'TRACE_GUARD: a version that uses M1 features needs its integrity settings' using errcode = '42501';
  end if;
  if v_settings is not null then
    -- E16: a lock added after the settings were saved is enforced at publish.
    perform private.integrity_settings_check(new.org_id, v_settings, v_catalog);
  end if;

  if v_v2 then
    select count(*), count(s.time_limit_seconds) into v_sections, v_timed
    from public.sections as s where s.org_id = new.org_id and s.test_version_id = new.id;
    if exists (
      select 1 from public.sections as s
      where s.org_id = new.org_id and s.test_version_id = new.id and s.navigation is null
    ) then
      raise exception 'TRACE_GUARD: every section of a version 2 test has its navigation' using errcode = '42501';
    end if;
    -- DB-M1-1 (rule 3, fairness): the candidate's paste rule and the band input come from one setting. A written section
    -- names its paste rule and it equals the settings' paste_written (a paste rule without settings is refused above).
    if exists (
      select 1 from public.sections as s
      where s.org_id = new.org_id and s.test_version_id = new.id and s.format = 'written' and s.paste_rule is null
    ) then
      raise exception 'TRACE_GUARD: a written section of a version 2 test has its paste rule' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.sections as s
      where s.org_id = new.org_id and s.test_version_id = new.id and s.format = 'written'
        and s.paste_rule is distinct from v_settings ->> 'paste_written'
    ) then
      raise exception 'TRACE_GUARD: a written section''s paste rule follows the test''s paste setting'
        using errcode = '42501';
    end if;
    -- R2-13 / Q26: weights sum to 100.
    if (select sum(s.weight) from public.sections as s where s.org_id = new.org_id and s.test_version_id = new.id) <> 100 then
      raise exception 'TRACE_GUARD: section weights must sum to 100' using errcode = '42501';
    end if;
    -- M1-11: every section timed or none; when timed, the total is their sum.
    if v_timed not in (0, v_sections) then
      raise exception 'TRACE_GUARD: either every section is timed or none is' using errcode = '42501';
    end if;
    if v_timed = v_sections and new.total_time_seconds <> (
      select sum(s.time_limit_seconds) from public.sections as s where s.org_id = new.org_id and s.test_version_id = new.id
    ) then
      raise exception 'TRACE_GUARD: the total time is the sum of the section times' using errcode = '42501';
    end if;
    -- R5-9: a candidate is served at most 100 items.
    if (select coalesce(sum(s.draw_count), 0) from public.sections as s
        where s.org_id = new.org_id and s.test_version_id = new.id and s.pool_id is not null)
      + (select count(*) from public.item_versions as i where i.org_id = new.org_id and i.test_version_id = new.id) > 100 then
      raise exception 'TRACE_GUARD: a candidate is served at most 100 items' using errcode = '42501';
    end if;
    -- DB-M1-12 (§5 SectionDraft.blueprint, M1-10): strata quotas belong to a pool section and sum to its draw.
    if exists (
      select 1 from public.sections as s
      cross join lateral (
        select case when jsonb_typeof(s.blueprint -> 'strata') = 'array' then s.blueprint -> 'strata' else '[]'::jsonb end
          as strata
      ) as b
      where s.org_id = new.org_id and s.test_version_id = new.id and s.blueprint is not null
        and (s.pool_id is null
          or jsonb_typeof(s.blueprint -> 'strata') is distinct from 'array'
          or exists (
            select 1 from jsonb_array_elements(b.strata) as e where jsonb_typeof(e -> 'count') is distinct from 'number'
          )
          or (select coalesce(sum(case when jsonb_typeof(e -> 'count') = 'number' then (e ->> 'count')::numeric end), 0)
              from jsonb_array_elements(b.strata) as e) <> s.draw_count)
    ) then
      raise exception 'TRACE_GUARD: a section''s strata quotas sum to its draw' using errcode = '42501';
    end if;
    -- R3-3: an item may appear in only one section of a version.
    if exists (
      select x.item_version_id from (
        select pi.item_version_id
        from public.sections as s
        join public.pool_items as pi on pi.org_id = s.org_id and pi.pool_id = s.pool_id
        join public.item_versions as i on i.org_id = pi.org_id and i.id = pi.item_version_id and i.status = 'approved'
        where s.org_id = new.org_id and s.test_version_id = new.id
        union all
        select i.id from public.item_versions as i where i.org_id = new.org_id and i.test_version_id = new.id
      ) as x
      group by x.item_version_id having count(*) > 1
    ) then
      raise exception 'TRACE_GUARD: an item may appear in only one section' using errcode = '42501';
    end if;
    -- The snapshot (R3-2): what each section can serve, with the exposure frozen for the weighted draw.
    perform set_config('trace.publishing', new.id::text, true);
    insert into public.section_pool_snapshot (org_id, section_id, item_version_id, workspace_id, test_id, test_version_id,
        exposure_at_publish)
      select s.org_id, s.id, i.id, s.workspace_id, s.test_id, s.test_version_id,
        (select count(*) from public.item_exposure_events as e where e.org_id = i.org_id and e.item_id = i.item_id)
      from public.sections as s
      join public.pool_items as pi on pi.org_id = s.org_id and pi.pool_id = s.pool_id
      join public.item_versions as i on i.org_id = pi.org_id and i.id = pi.item_version_id and i.status = 'approved'
      where s.org_id = new.org_id and s.test_version_id = new.id
      union all
      select s.org_id, s.id, i.id, s.workspace_id, s.test_id, s.test_version_id,
        (select count(*) from public.item_exposure_events as e where e.org_id = i.org_id and e.item_id = i.item_id)
      from public.sections as s
      join public.item_versions as i on i.org_id = s.org_id and i.section_id = s.id
      where s.org_id = new.org_id and s.test_version_id = new.id and s.pool_id is null;
    perform set_config('trace.publishing', '', true);
    -- E4 on the snapshot just written (DB-M1-9): a pool section holds at least draw_count items.
    if exists (
      select 1 from public.sections as s
      where s.org_id = new.org_id and s.test_version_id = new.id and s.pool_id is not null
        and s.draw_count > (
          select count(*) from public.section_pool_snapshot as sp where sp.org_id = s.org_id and sp.section_id = s.id
        )
    ) then
      raise exception 'TRACE_GUARD: the pool has fewer approved items than the section draws' using errcode = '42501';
    end if;
    -- E22 (DB-M1-12): a package holds at most 5,000 items (R5-9), which also bounds min_pool_ratio (numeric(6, 2)).
    if (select count(*) from public.section_pool_snapshot as sp
        where sp.org_id = new.org_id and sp.test_version_id = new.id) > 5000 then
      raise exception 'TRACE_GUARD: a version holds at most 5,000 items' using errcode = '42501';
    end if;
    new.min_pool_ratio := (
      select min(round((select count(*) from public.section_pool_snapshot as sp
                        where sp.org_id = s.org_id and sp.section_id = s.id)::numeric / s.draw_count, 2))
      from public.sections as s
      where s.org_id = new.org_id and s.test_version_id = new.id and s.pool_id is not null
    );
    new.package_version := 2;
  else
    new.min_pool_ratio := null;
    new.package_version := 1;
  end if;

  new.published_at := now();
  new.published_by := v_uid;

  -- The ruleset freezes with the version (Q20).
  update public.ruleset_versions
    set published_at = new.published_at
    where org_id = new.org_id and id = new.ruleset_version_id and published_at is null;

  -- The creator is assigned automatically so they can view evidence (R-15). as_role = the highest of
  -- org_owner | admin | recruiter that their membership holds; skipped if the membership is no longer active, or
  -- is scoped to another workspace than the test's (M-1). Only on the test's first publish (DB review m1 m-2): a
  -- later version's publish never re-adds a creator that an owner or admin unassigned.
  select m.id,
    case
      when 'org_owner' = any (m.roles) then 'org_owner'::public.org_role
      when 'admin' = any (m.roles) then 'admin'::public.org_role
      when 'recruiter' = any (m.roles) then 'recruiter'::public.org_role
    end
  into v_member, v_role
  from public.tests as t
  join public.memberships as m on m.org_id = t.org_id and m.user_id = t.created_by and m.status = 'active'
  where t.org_id = new.org_id and t.id = new.test_id
    and (m.workspace_id is null or m.workspace_id = t.workspace_id)
    and not exists (
      select 1 from public.test_versions as v
      where v.org_id = new.org_id and v.test_id = new.test_id and v.id <> new.id and v.published_at is not null
    );
  if v_member is not null and v_role is not null then
    insert into public.assignments (org_id, membership_id, test_id, as_role)
      values (new.org_id, v_member, new.test_id, v_role)
      on conflict (org_id, membership_id, test_id) do nothing;
  end if;
  return new;
end
$$;
revoke execute on function private.test_versions_guard() from public, anon, authenticated, service_role;

-- The M1 columns of a new version (BEFORE INSERT, after test_versions_guard by name): the publish guard sets the ratio
-- and the package version; the template comes from the test's job (a client value never counts).
create function private.test_versions_m1_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.min_pool_ratio := null;
  new.package_version := 1;
  select j.role_template_version_id into new.role_template_version_id
  from public.tests as t join public.jobs as j on j.org_id = t.org_id and j.id = t.job_id
  where t.org_id = new.org_id and t.id = new.test_id;
  return new;
end
$$;
revoke execute on function private.test_versions_m1_insert() from public, anon, authenticated, service_role;
create trigger test_versions_m1_insert before insert on public.test_versions
  for each row execute function private.test_versions_m1_insert();
alter table public.test_versions enable always trigger test_versions_m1_insert;

-- "Edit as new version" (§4.2) is audited test.new_version (R5-26).
create function private.test_versions_audit_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.version_no > 1 then
    perform private.audit(new.org_id, 'test.new_version', 'test_versions', new.id,
      jsonb_build_object('version_no', new.version_no), new.workspace_id);
  end if;
  return null;
end
$$;
revoke execute on function private.test_versions_audit_insert() from public, anon, authenticated, service_role;
create trigger test_versions_audit_insert after insert on public.test_versions
  for each row execute function private.test_versions_audit_insert();

-- ABH-10 (AT-M1-12): called by M2's drive trigger. Raises unless every section draws from a snapshot at least ten times
-- its draw; an inline section serves all its items (ratio 1), so it always raises.
create function private.assert_drive_pool_ratio(p_org uuid, p_test_version uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.test_versions as v where v.org_id = p_org and v.id = p_test_version
                 and v.status = 'published') then
    raise exception 'TRACE_GUARD: published test version not found' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.sections as s
    where s.org_id = p_org and s.test_version_id = p_test_version
      and (s.pool_id is null or (
        select count(*) from public.section_pool_snapshot as sp where sp.org_id = s.org_id and sp.section_id = s.id
      ) < 10 * s.draw_count)
  ) then
    raise exception 'TRACE_GUARD: pool must be at least 10x the draw for drives' using errcode = '42501';
  end if;
end
$$;
revoke execute on function private.assert_drive_pool_ratio(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- session_items widened: draws, variants and option order (R2-1, R5-19, R5-39, R5-41, R5-43)
-- ---------------------------------------------------------------------------------------------
alter table public.session_items
  alter column served_at drop not null,
  add column item_variant_id uuid null,
  add column option_order jsonb null check (option_order is null or jsonb_typeof(option_order) = 'array'),
  add column draw_seed_sha256 text null check (draw_seed_sha256 is null or draw_seed_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint session_items_variant_fk foreign key (org_id, item_variant_id, item_version_id)
    references public.item_variants (org_id, id, item_version_id) on delete restrict;
create index session_items_variant_idx on public.session_items (org_id, item_variant_id);

-- The exit gate's last line (ABH-8, AT-M1-08): fires before session_items_guard (BEFORE triggers run in name order).
create function private.session_items_a_ai_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.item_versions as i
    where i.org_id = new.org_id and i.id = new.item_version_id
      and ((i.origin = 'ai_draft' and i.approved_by is null) or i.status not in ('approved', 'retired'))
  ) then
    raise exception 'TRACE_GUARD: unapproved item cannot be served' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.session_items_a_ai_gate() from public, anon, authenticated, service_role;
create trigger session_items_a_ai_gate before insert on public.session_items
  for each row execute function private.session_items_a_ai_gate();
alter table public.session_items enable always trigger session_items_a_ai_gate;

-- session_items guard v2 (re-derived from 20261014094801_d1_invites_sessions.sql, R5-30): package v1 keeps D1's rule;
-- package v2 checks the published snapshot of the mirrored section.
create or replace function private.session_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tv uuid;
  v_ws uuid;
  v_test uuid;
  v_pkg smallint;
  v_item_tv uuid;
  v_section uuid;
  v_param boolean;
  v_format public.section_format;
  v_options jsonb;
  v_pool uuid;
  v_draw int;
begin
  if tg_op = 'UPDATE' then
    raise exception 'TRACE_GUARD: session items are insert-only' using errcode = '42501';
  end if;
  if current_setting('role') is distinct from 'trace_worker' then
    raise exception 'TRACE_GUARD: session items are written by the mirror only' using errcode = '42501';
  end if;
  select s.test_version_id, s.workspace_id, s.test_id, v.package_version into v_tv, v_ws, v_test, v_pkg
  from public.sessions as s
  join public.test_versions as v on v.org_id = s.org_id and v.id = s.test_version_id
  where s.org_id = new.org_id and s.id = new.session_id;
  if not found then
    raise exception 'TRACE_GUARD: session not found' using errcode = '23503';
  end if;
  select i.test_version_id, i.section_id, i.is_parameterised, i.format, i.options
    into v_item_tv, v_section, v_param, v_format, v_options
  from public.item_versions as i where i.org_id = new.org_id and i.id = new.item_version_id;
  if not found then
    raise exception 'TRACE_GUARD: item version not found' using errcode = '23503';
  end if;

  if v_pkg = 1 then
    if v_item_tv is distinct from v_tv then
      raise exception 'TRACE_GUARD: the item belongs to another test version' using errcode = '42501';
    end if;
    if new.section_id is not null and new.section_id is distinct from v_section then
      raise exception 'TRACE_GUARD: the item belongs to another section' using errcode = '42501';
    end if;
    -- R5-43: a version 1 session stores served items only.
    if new.served_at is null then
      raise exception 'TRACE_GUARD: a version 1 item is stored when served' using errcode = '42501';
    end if;
    if new.item_variant_id is not null or new.option_order is not null or new.draw_seed_sha256 is not null then
      raise exception 'TRACE_GUARD: a version 1 item has no variant, option order or draw seed' using errcode = '42501';
    end if;
    new.section_id := v_section;
  else
    if new.section_id is null then
      raise exception 'TRACE_GUARD: a version 2 item names its section' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.section_pool_snapshot as sp
      where sp.org_id = new.org_id and sp.test_version_id = v_tv and sp.section_id = new.section_id
        and sp.item_version_id = new.item_version_id
    ) then
      raise exception 'TRACE_GUARD: the item is not in the published snapshot of its section' using errcode = '42501';
    end if;
    select s.pool_id, s.draw_count into v_pool, v_draw
    from public.sections as s where s.org_id = new.org_id and s.id = new.section_id;
    if v_pool is null and new.served_at is null then
      raise exception 'TRACE_GUARD: an inline item is stored when served' using errcode = '42501';
    end if;
    -- DB-M1-4 (R5-19 slots): a pool section stores at most draw_count rows per session, at positions 1..draw_count. The
    -- session row lock serialises concurrent mirror inserts of the same session.
    if v_pool is not null then
      perform 1 from public.sessions as s where s.org_id = new.org_id and s.id = new.session_id for no key update;
      if new.position > v_draw then
        raise exception 'TRACE_GUARD: the position is outside the section''s draw' using errcode = '42501';
      end if;
      if (select count(*) from public.session_items as si
          where si.org_id = new.org_id and si.session_id = new.session_id and si.section_id = new.section_id) >= v_draw then
        raise exception 'TRACE_GUARD: the section''s draw is full' using errcode = '42501';
      end if;
    end if;
    -- R5-39 a: a parameterised item is served as exactly one of its variants.
    if (new.item_variant_id is not null) is distinct from v_param then
      raise exception 'TRACE_GUARD: a parameterised item is served as one of its variants' using errcode = '42501';
    end if;
    if new.item_variant_id is not null then
      select v.options into v_options from public.item_variants as v
      where v.org_id = new.org_id and v.id = new.item_variant_id;
    end if;
    if new.option_order is not null and (
      v_format <> 'mcq'
      or jsonb_array_length(new.option_order) <> jsonb_array_length(v_options)
      or exists (select 1 from jsonb_array_elements(new.option_order) as e where jsonb_typeof(e) <> 'string')
      or (select array_agg(e order by e) from jsonb_array_elements_text(new.option_order) as e)
        is distinct from (select array_agg(o ->> 'id' order by o ->> 'id') from jsonb_array_elements(v_options) as o)
    ) then
      raise exception 'TRACE_GUARD: the option order is a permutation of the served options' using errcode = '42501';
    end if;
  end if;
  new.workspace_id := v_ws;
  new.test_id := v_test;
  return new;
end
$$;
revoke execute on function private.session_items_guard() from public, anon, authenticated, service_role;

-- M1-6, R2-7, R5-41: one exposure event per served item, exactly once (session_items is insert-once).
create function private.session_items_exposure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.item_exposure_events (org_id, workspace_id, session_item_id, item_id, source_item_id, served_at)
    select new.org_id, new.workspace_id, new.id, i.item_id, src.item_id, new.served_at
    from public.item_versions as i
    left join public.item_versions as src on src.id = i.source_item_version_id
    where i.org_id = new.org_id and i.id = new.item_version_id;
  return null;
end
$$;
revoke execute on function private.session_items_exposure() from public, anon, authenticated, service_role;
create trigger session_items_exposure after insert on public.session_items
  for each row when (new.served_at is not null) execute function private.session_items_exposure();
alter table public.session_items enable always trigger session_items_exposure;

-- responses guard v2 (re-derived from 20261014094801_d1_invites_sessions.sql; R5-43): a response needs a served item.
create or replace function private.responses_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_format public.section_format;
  v_served timestamptz;
begin
  if tg_op = 'UPDATE' then
    raise exception 'TRACE_GUARD: responses are insert-only' using errcode = '42501';
  end if;
  if current_setting('role') is distinct from 'trace_worker' then
    raise exception 'TRACE_GUARD: responses are written by the mirror only' using errcode = '42501';
  end if;
  select i.format, si.served_at into v_format, v_served
  from public.session_items as si
  join public.item_versions as i on i.org_id = si.org_id and i.id = si.item_version_id
  where si.org_id = new.org_id and si.id = new.session_item_id and si.session_id = new.session_id;
  if not found then
    raise exception 'TRACE_GUARD: session item not found' using errcode = '23503';
  end if;
  if v_served is null then
    raise exception 'TRACE_GUARD: an item that was not served has no response' using errcode = '42501';
  end if;
  if (v_format = 'written') is distinct from (new.answer_kind = 'text') then
    raise exception 'TRACE_GUARD: the answer kind does not match the item format' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.responses_guard() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- integrity_flags_guard (re-derived from 20261021091905_d1_flags_rule_table.sql; R5-5, R5-31): every D1-DB-1 check stays,
-- plus one: a flag whose rule's kinds are all switched off in the session's ruleset is refused (a missing key counts as
-- enabled, R5-23 b). D1 rulesets have all five keys enabled, so they are unaffected.
-- ---------------------------------------------------------------------------------------------
create or replace function private.integrity_flags_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meets boolean;
  v_card_state text;
  v_rule jsonb;
  v_ss jsonb;
begin
  if tg_op <> 'INSERT' then
    raise exception 'TRACE_GUARD: flags are immutable in D1' using errcode = '42501';
  end if;
  -- The T3-only rule is refused here with the CHECK's own code (23514), so it never depends on the CHECK staying.
  if (new.untrusted or new.raw_media) and new.tier is distinct from 'T3' then
    raise exception 'TRACE_GUARD: untrusted or raw_media needs a T3 flag (rule 3)' using errcode = '23514';
  end if;
  -- D1-DB-1 (rule 3): the flag is a validated rule of the session's own pinned rule table, field for field.
  select r, rv.signal_settings into v_rule, v_ss
  from public.sessions as s
  join public.ruleset_versions as rv on rv.org_id = s.org_id and rv.id = s.ruleset_version_id
  join integrity.band_rule_versions as b on b.org_id = rv.org_id and b.id = rv.band_rule_version_id
  cross join lateral jsonb_array_elements(b.rules) as r
  where s.org_id = new.org_id and s.id = new.session_id and r ->> 'id' = new.rule_id
    and r -> 'validated' = 'true'::jsonb;
  if not found then
    raise exception 'TRACE_GUARD: a flag needs a validated rule of the session''s rule table' using errcode = '42501';
  end if;
  if new.family is distinct from v_rule ->> 'family'
    or new.tier is distinct from v_rule ->> 'tier'
    or new.severity is distinct from v_rule ->> 'severity'
    or new.untrusted is distinct from coalesce((v_rule ->> 'untrusted')::boolean, false)
    or new.raw_media is distinct from coalesce((v_rule ->> 'rawMedia')::boolean, false) then
    raise exception 'TRACE_GUARD: the flag does not match its rule' using errcode = '42501';
  end if;
  -- R5-5 / R5-31 (rule 3): a signal switched off by the test settings never makes a flag.
  if not exists (
    select 1 from jsonb_array_elements_text(v_rule -> 'kinds') as k
    where coalesce((v_ss -> k ->> 'enabled')::boolean, true)
  ) then
    raise exception 'TRACE_GUARD: signal disabled by the test settings' using errcode = '42501';
  end if;
  -- Once the session's integrity card is final its band can no longer be re-checked, so no flag is added (I-3). The
  -- share lock serialises this insert with the card's single flip (DB review m3 m-1).
  select c.review_state into v_card_state
  from public.integrity_cards as c where c.org_id = new.org_id and c.session_id = new.session_id
  for share;
  if found and v_card_state <> 'awaiting_quality' then
    raise exception 'TRACE_GUARD: no flag is added once the integrity card is final' using errcode = '42501';
  end if;
  select c.meets_cutoff into v_meets
  from public.quality_cards as c where c.org_id = new.org_id and c.session_id = new.session_id;
  if not found then
    raise exception 'TRACE_GUARD: a flag needs the session quality card' using errcode = '42501';
  end if;
  if (new.state = 'not_used') is distinct from (not v_meets) then
    raise exception 'TRACE_GUARD: a flag is not_used exactly when the session is below its cutoff'
      using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.integrity_flags_guard() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Library reference reads for trace_api (R2-5, R3-7): skills, published templates, the settings catalog and presets.
-- ---------------------------------------------------------------------------------------------
create function private.library_reference(p_viewer uuid, p_aal text, p_amr text[], p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lib uuid := private.library_org_id();
begin
  if p_kind is null or p_kind not in ('skills', 'templates', 'settings') then
    raise exception 'TRACE_GUARD: unknown reference kind' using errcode = '22023';
  end if;
  if not private.library_viewer_ok(p_viewer, p_aal, p_amr, false) then
    return '[]'::jsonb;
  end if;
  if p_kind = 'skills' then
    return coalesce((select jsonb_agg(jsonb_build_object('skillKey', t.skill_key, 'label', t.label,
        'formatHint', t.format_hint) order by t.skill_key)
      from public.skill_taxonomy as t where t.org_id = v_lib and t.retired_at is null), '[]'::jsonb);
  elsif p_kind = 'templates' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'templateKey', r.template_key, 'version', r.version,
        'name', r.name, 'keywords', to_jsonb(r.keywords), 'blueprint', r.blueprint, 'presetKey', r.preset_key)
        order by r.template_key, r.version)
      from public.role_templates as r where r.org_id = v_lib and r.status = 'published'), '[]'::jsonb);
  end if;
  return jsonb_build_array(
    jsonb_build_object('catalogVersion', private.current_settings_catalog(), 'settings',
      coalesce((select jsonb_agg(jsonb_build_object('settingKey', d.setting_key, 'valueKind', d.value_kind,
          'allowedValues', to_jsonb(d.allowed_values), 'defaultValue', d.default_value, 'alwaysLocked', d.always_locked,
          'availableFrom', d.available_from) order by d.setting_key)
        from public.integrity_setting_defs as d
        where d.org_id = v_lib and d.catalog_version = private.current_settings_catalog()), '[]'::jsonb),
      'presets',
      coalesce((select jsonb_agg(jsonb_build_object('presetKey', p.preset_key, 'version', p.version, 'values', p.preset_values)
          order by p.preset_key)
        from public.integrity_presets as p
        where p.org_id = v_lib and p.catalog_version = private.current_settings_catalog()), '[]'::jsonb)));
end
$$;
revoke execute on function private.library_reference(uuid, text, text[], text) from public, anon, authenticated, service_role;
grant execute on function private.library_reference(uuid, text, text[], text) to trace_api;

-- ---------------------------------------------------------------------------------------------
-- Library seeds (operator path; synthetic, R5-4; no item content, R5-28): taxonomy, settings catalog, presets, the two
-- wedge templates (plan-conflicts #13).
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_lib uuid := private.library_org_id();
begin
  -- The skill taxonomy is seeded by migration M1-a (its items guard needs it).
  insert into public.integrity_setting_defs (org_id, catalog_version, setting_key, value_kind, allowed_values,
      default_value, always_locked, available_from, maps_to_signals) values
    (v_lib, 'm1-settings-v1', 'calibration_warmup', 'on_off', '{on,off}', 'on', false, 'M4', '{}'),
    (v_lib, 'm1-settings-v1', 'typing_provenance', 'on_off', '{on,off}', 'on', false, 'D1', '{untrusted_input}'),
    (v_lib, 'm1-settings-v1', 'burst_after_tab', 'on_off', '{on,off}', 'on', false, 'M4', '{}'),
    (v_lib, 'm1-settings-v1', 'fullscreen_tab_focus', 'on_off_warn', '{off,warn_first,on}', 'warn_first', false, 'D1',
      '{tab_hidden,fullscreen_exit}'),
    (v_lib, 'm1-settings-v1', 'single_screen', 'on_off', '{on,off}', 'off', false, 'M4', '{}'),
    (v_lib, 'm1-settings-v1', 'camera_face_presence', 'on_off', '{on,off}', 'on', false, 'M4', '{}'),
    (v_lib, 'm1-settings-v1', 'mic_speech_presence', 'on_off', '{on,off}', 'off', false, 'M4', '{}'),
    (v_lib, 'm1-settings-v1', 'explain_probe', 'on_off', '{on,off}', 'off', false, 'M4', '{}'),
    (v_lib, 'm1-settings-v1', 'question_copy', 'on_off', '{on,off}', 'on', false, 'M4', '{}'),
    (v_lib, 'm1-settings-v1', 'paste_written', 'paste_rule', '{blocked,allowed_logged}', 'allowed_logged', false, 'D1',
      '{paste,drop}'),
    (v_lib, 'm1-settings-v1', 'integrity_review_scope', 'fixed', '{shortlist_only}', 'shortlist_only', true, 'D1', '{}'),
    (v_lib, 'm1-settings-v1', 'accommodations', 'fixed', '{on}', 'on', true, 'M3b', '{}'),
    (v_lib, 'm1-settings-v1', 'id_verification', 'fixed', '{off}', 'off', true, 'phase2', '{}')
    on conflict do nothing;

  insert into public.integrity_presets (org_id, preset_key, version, catalog_version, preset_values) values
    (v_lib, 'strict', 1, 'm1-settings-v1', '{"calibration_warmup": "on", "typing_provenance": "on",
      "burst_after_tab": "on", "fullscreen_tab_focus": "on", "single_screen": "on", "camera_face_presence": "on",
      "mic_speech_presence": "on", "explain_probe": "on", "question_copy": "on", "paste_written": "blocked",
      "integrity_review_scope": "shortlist_only", "accommodations": "on", "id_verification": "off"}'),
    (v_lib, 'standard', 1, 'm1-settings-v1', '{"calibration_warmup": "on", "typing_provenance": "on",
      "burst_after_tab": "on", "fullscreen_tab_focus": "warn_first", "single_screen": "off", "camera_face_presence": "on",
      "mic_speech_presence": "off", "explain_probe": "off", "question_copy": "on", "paste_written": "allowed_logged",
      "integrity_review_scope": "shortlist_only", "accommodations": "on", "id_verification": "off"}'),
    (v_lib, 'open_book', 1, 'm1-settings-v1', '{"calibration_warmup": "on", "typing_provenance": "on",
      "burst_after_tab": "off", "fullscreen_tab_focus": "off", "single_screen": "off", "camera_face_presence": "off",
      "mic_speech_presence": "off", "explain_probe": "off", "question_copy": "off", "paste_written": "allowed_logged",
      "integrity_review_scope": "shortlist_only", "accommodations": "on", "id_verification": "off"}')
    on conflict do nothing;

  insert into public.role_templates (org_id, template_key, version, name, keywords, blueprint, preset_key, status,
      published_at) values
    (v_lib, 'customer_support', 1, 'Customer Support',
      '{customer,support,service,helpdesk,ticket,email,chat,complaint,resolution,query,escalation,empathy}',
      '{"sections": [
         {"title": "Verbal ability", "format": "mcq", "skillKey": "verbal", "drawCount": 10, "available": true},
         {"title": "Customer service situations", "format": "mcq", "skillKey": "customer_service_sjt", "drawCount": 10,
          "available": true},
         {"title": "Written communication", "format": "written", "skillKey": "written_communication", "drawCount": 1,
          "available": true},
         {"title": "Typing", "format": "typing", "skillKey": "typing", "drawCount": 1, "available": false}],
        "totalTimeSeconds": 2400}',
      'standard', 'published', now()),
    (v_lib, 'bpo_voice', 1, 'BPO Voice',
      '{bpo,voice,call,calls,inbound,outbound,telecaller,process,english,communication,customer,accent}',
      '{"sections": [
         {"title": "Verbal ability", "format": "mcq", "skillKey": "verbal", "drawCount": 10, "available": true},
         {"title": "Reading comprehension", "format": "mcq", "skillKey": "reading", "drawCount": 8, "available": true},
         {"title": "Written communication", "format": "written", "skillKey": "written_communication", "drawCount": 1,
          "available": true},
         {"title": "Spoken English", "format": "voice", "skillKey": "spoken_english", "drawCount": 1, "available": false},
         {"title": "Typing", "format": "typing", "skillKey": "typing", "drawCount": 1, "available": false}],
        "totalTimeSeconds": 2100}',
      'standard', 'published', now())
    on conflict (org_id, template_key, version) do nothing;
end
$$;

-- DB-M1-8: a seeded catalog is sealed. Its settings and presets are written above, then no row joins it, for any role,
-- the owner included (UPDATE, DELETE and TRUNCATE are refused by settings_catalog_frozen). A later migration that adds
-- a catalog inserts its rows first, then replaces sealed_settings_catalogs() with a list that names it. A function, not
-- a table: no new public relation (db-types, catalog and candidate checks stay unchanged).
create function private.sealed_settings_catalogs()
returns text[]
language sql
stable
set search_path = ''
as $$
  select array['m1-settings-v1']::text[]
$$;
revoke execute on function private.sealed_settings_catalogs() from public, anon, authenticated, service_role;

create function private.settings_catalog_sealed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.catalog_version = any (private.sealed_settings_catalogs()) then
    raise exception 'TRACE_GUARD: the settings catalog and presets are immutable' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.settings_catalog_sealed() from public, anon, authenticated, service_role;
create trigger integrity_setting_defs_sealed before insert on public.integrity_setting_defs
  for each row execute function private.settings_catalog_sealed();
create trigger integrity_presets_sealed before insert on public.integrity_presets
  for each row execute function private.settings_catalog_sealed();
alter table public.integrity_setting_defs enable always trigger integrity_setting_defs_sealed;
alter table public.integrity_presets enable always trigger integrity_presets_sealed;

-- ---------------------------------------------------------------------------------------------
-- Grants and policies (§3.5)
-- ---------------------------------------------------------------------------------------------

-- role_templates: own org only (library templates reach customers through the api, R2-5)
grant select on public.role_templates to authenticated;
grant insert (id, org_id, template_key, version, name, keywords, blueprint, preset_key) on public.role_templates
  to authenticated;
grant update (name, keywords, blueprint, preset_key, status) on public.role_templates to authenticated;
create policy role_templates_select_staff on public.role_templates for select to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy role_templates_insert_admin on public.role_templates for insert to authenticated
  with check (org_id = any ((select private.my_org_ids('{admin}'))::uuid[]));
create policy role_templates_update_admin on public.role_templates for update to authenticated
  using (status in ('draft', 'published') and org_id = any ((select private.my_org_ids('{admin}'))::uuid[]))
  with check (org_id = any ((select private.my_org_ids('{admin}'))::uuid[]));

-- jobs
grant select on public.jobs to authenticated;
grant insert (id, org_id, workspace_id, title, role_template_version_id, jd_sha256, template_match_permille)
  on public.jobs to authenticated;
grant update (title, archived_at) on public.jobs to authenticated;
create policy jobs_select_staff on public.jobs for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy jobs_select_reviewer on public.jobs for select to authenticated
  using (id in (
    select t.job_id from public.tests as t
    where t.id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[])
  ));
create policy jobs_insert_staff on public.jobs for insert to authenticated
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy jobs_update_staff on public.jobs for update to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]))
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));

-- tests.job_id; sections' M1 columns; trace_api reads the package version
grant insert (job_id) on public.tests to authenticated;
grant insert (pool_id, draw_count, shuffle_items, shuffle_options, navigation, paste_rule, blueprint)
  on public.sections to authenticated;
grant update (pool_id, draw_count, shuffle_items, shuffle_options, navigation, paste_rule, blueprint)
  on public.sections to authenticated;
grant select (package_version) on public.test_versions to trace_api;

-- section_pool_snapshot: read-only for everyone (written by the publish guard)
grant select on public.section_pool_snapshot to authenticated, trace_quality_worker;
create policy section_pool_snapshot_select_staff on public.section_pool_snapshot for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy section_pool_snapshot_select_reviewer on public.section_pool_snapshot for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy section_pool_snapshot_select_quality_worker on public.section_pool_snapshot
  for select to trace_quality_worker using (org_id = (select private.job_org_id()));

-- org_integrity_locks: members read; admins (aal2) add and remove
grant select, delete on public.org_integrity_locks to authenticated;
grant insert (id, org_id, setting_key, locked_value) on public.org_integrity_locks to authenticated;
create policy org_integrity_locks_select_member on public.org_integrity_locks for select to authenticated
  using (org_id = any ((select private.my_org_ids('{org_owner,admin,recruiter,reviewer}'))::uuid[]));
create policy org_integrity_locks_insert_admin on public.org_integrity_locks for insert to authenticated
  with check (org_id = any ((select private.my_org_ids('{admin}'))::uuid[]));
create policy org_integrity_locks_delete_admin on public.org_integrity_locks for delete to authenticated
  using (org_id = any ((select private.my_org_ids('{admin}'))::uuid[]));

-- ruleset_versions: staff write the settings of an unpublished ruleset (the guard validates and derives)
grant update (preset_key, preset_version, settings) on public.ruleset_versions to authenticated;
create policy ruleset_versions_update_staff on public.ruleset_versions for update to authenticated
  using (published_at is null
    and workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]))
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));

-- session_items: the mirror writes the draw columns (R5-39 a)
grant insert (item_variant_id, option_order, draw_seed_sha256) on public.session_items to trace_worker;
