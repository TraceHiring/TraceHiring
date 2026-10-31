-- M1 migration c of d (spec specs/m1-test-authoring.md revision 5: §3.1 row M1-c, §3.2 import_jobs, import_row_errors,
-- ai_draft_jobs, §3.4 import_item_batch, save_test_draft, save_item_variants, §3.5, §4.3, §4.4, §6.4, §6.9, §7 E13, E14;
-- binding rows R2-5, R2-6, R2-9, R2-22, R3-4, R3-5, R5-14, R5-26, R5-35, R5-37, R5-40; M1-9, M1-18, M1-19). Imports and
-- AI drafting: the two job tables and the per-row import errors, the item_versions job keys and the R5-35 CHECK, the two
-- drafting/import hooks of migration M1-a, and the three INVOKER functions the api calls through PostgREST.
--
-- PROVISIONAL TIMESTAMP (R5-30): see 20261023010000_m1_bank.sql. This file replaces only M1-a's two hook bodies
-- (private.ai_draft_job_running, private.import_job_open); it replaces no D1 function.
--
-- Nothing here reads or names quality.* or integrity.* (I-M1-10, MT-5). Error contract (as D1 and M1-a):
--   guard / state refusal          42501 'TRACE_GUARD: <reason>'
--   missing parent row             23503 'TRACE_GUARD: <parent> not found'
--   malformed function input       22023 'TRACE_BAD_INPUT: <reason>' (an api bug: the api validates with zod first)
--
-- Data minimisation (M1-9, §6.4, rule "no PII"): no column holds a spreadsheet cell, a file, a file name or an AI topic.
-- import_row_errors holds a row number, a template field name and an error code; ai_draft_jobs holds the topic's
-- SHA-256 only (the topic travels in the queue message, scrubbed and capped, §6.4).
--
-- The three public functions are SECURITY INVOKER (M1-18, R2-5): they run as the caller (authenticated, with the
-- caller's JWT), so RLS, column grants and every guard trigger apply, and they reference only public objects and
-- pg_catalog built-ins (authenticated has no USAGE on private, MT-8). Their privileged checks live in the definer guard
-- triggers. EXECUTE goes to authenticated only.

-- ---------------------------------------------------------------------------------------------
-- import_jobs and import_row_errors (§3.2, §4.3; M1-9)
-- ---------------------------------------------------------------------------------------------
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  source_kind text not null check (source_kind in ('xlsx', 'docx')),
  template_version text not null check (template_version ~ '^trace-items-v[1-9][0-9]{0,2}$'),
  status text not null default 'open' check (status in ('open', 'validating', 'completed', 'cancelled', 'failed')),
  -- Counts are written by the guard from the stored rows when the job ends (never client-written).
  rows_total int not null default 0 check (rows_total between 0 and 2000),
  rows_ok int not null default 0 check (rows_ok >= 0),
  rows_error int not null default 0 check (rows_error >= 0),
  images_ok int not null default 0 check (images_ok between 0 and 2000),
  -- Why a job failed (an enum, never free text; R5-26 import.fail).
  error_code text null check (error_code is null or error_code in ('row_limit', 'image_limit', 'timeout', 'internal')),
  created_by uuid null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  unique (org_id, id),
  unique (org_id, id, workspace_id),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  check (rows_ok + rows_error = rows_total),
  check ((status = 'failed') = (error_code is not null)),
  check ((status in ('completed', 'cancelled', 'failed')) = (completed_at is not null))
);
create index import_jobs_workspace_idx on public.import_jobs (org_id, workspace_id);
alter table public.import_jobs enable row level security;

-- One row per (row, field) with an error: a template field name and a code, never a cell value (AT-M1-11). Row numbers
-- are sheet rows: 1 is the header, so data rows are 2..2001 (max 2,000 rows per job, §4.3).
create table public.import_row_errors (
  org_id uuid not null references public.orgs (id) on delete restrict,
  import_job_id uuid not null,
  row_no int not null check (row_no between 2 and 2001),
  field text not null check (field in ('row', 'format', 'skill', 'difficulty', 'stem', 'options', 'option_a', 'option_b',
    'option_c', 'option_d', 'option_e', 'option_f', 'correct', 'rubric_key', 'image_file', 'image_alt',
    'param_spec_json')),
  error_code text not null check (error_code in ('missing_field', 'bad_format', 'bad_skill', 'bad_difficulty',
    'bad_options', 'bad_key', 'too_long', 'bad_image_ref', 'image_missing', 'image_too_large', 'image_bad_type',
    'duplicate_in_file', 'duplicate_in_bank', 'bad_param_spec', 'variant_generation_failed', 'row_limit')),
  workspace_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (org_id, import_job_id, row_no, field),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, import_job_id, workspace_id)
    references public.import_jobs (org_id, id, workspace_id) on delete restrict
);
create index import_row_errors_workspace_idx on public.import_row_errors (org_id, workspace_id);
alter table public.import_row_errors enable row level security;

-- ---------------------------------------------------------------------------------------------
-- ai_draft_jobs (§3.2, §4.4, §6.4; M1-8, M1-19). No topic text: topic_sha256 only.
-- ---------------------------------------------------------------------------------------------
create table public.ai_draft_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  requested_by uuid null,
  format public.section_format not null check (format in ('mcq', 'written')),
  skill_key text not null check (skill_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  difficulty numeric(3, 2) not null check (difficulty between 0 and 1),
  count int not null check (count between 1 and 10),
  topic_sha256 text not null check (topic_sha256 ~ '^[0-9a-f]{64}$'),
  -- Versioned like every model use (CLAUDE.md "Everything is versioned"): which drafter, model and prompt ran.
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{0,39}$'),
  model_id text not null check (model_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  prompt_version text not null check (prompt_version ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  -- drafts_created is counted by the guard from the stored drafts; drafts_discarded is the worker's count of drafts
  -- that failed the duplicate, readability or placeholder checks (§6.4).
  drafts_created int not null default 0 check (drafts_created >= 0 and drafts_created <= count),
  drafts_discarded int not null default 0 check (drafts_discarded >= 0 and drafts_discarded <= count),
  error_code text null
    check (error_code is null or error_code in ('drafter_error', 'bad_output', 'no_draft_passed', 'timeout', 'internal')),
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  unique (org_id, id),
  unique (org_id, id, workspace_id),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  check ((status = 'failed') = (error_code is not null)),
  check ((status in ('completed', 'failed')) = (completed_at is not null))
);
create index ai_draft_jobs_workspace_idx on public.ai_draft_jobs (org_id, workspace_id);
alter table public.ai_draft_jobs enable row level security;

-- ---------------------------------------------------------------------------------------------
-- item_versions: the job keys (R2-9 fence-preserving: a draft or an imported row stays in its job's workspace) and the
-- R5-35 CHECK (every AI draft names its drafting job, and only an AI draft does).
-- ---------------------------------------------------------------------------------------------
alter table public.item_versions
  add constraint item_versions_ai_draft_job_fk foreign key (org_id, ai_draft_job_id, workspace_id)
    references public.ai_draft_jobs (org_id, id, workspace_id) on delete restrict,
  add constraint item_versions_import_job_fk foreign key (org_id, import_job_id, workspace_id)
    references public.import_jobs (org_id, id, workspace_id) on delete restrict,
  add constraint item_versions_ai_draft_job check ((origin = 'ai_draft') = (ai_draft_job_id is not null));
create index item_versions_ai_draft_job_idx on public.item_versions (org_id, ai_draft_job_id)
  where ai_draft_job_id is not null;
-- DB review M3: duplicate_in_bank looks up a content hash among the workspace's bank rows for every imported row.
create index item_versions_bank_content_idx on public.item_versions (org_id, workspace_id, content_sha256)
  where section_id is null;

-- ---------------------------------------------------------------------------------------------
-- The hooks of M1-a's item_versions guard (same signatures; CREATE OR REPLACE keeps the owner and the ACL).
-- ---------------------------------------------------------------------------------------------
-- R5-35: an AI draft (and its key) is written only for a running drafting job of the same org and workspace; the cap on
-- the number of drafts is ai_draft_job_has_room below. DB review M1: the job row is locked FOR NO KEY UPDATE (the mode
-- has_room takes next, so the two never deadlock by upgrading a shared lock), so draft and key writes and the job's end
-- are serialised: nothing lands after the job ended.
create or replace function private.ai_draft_job_running(p_org uuid, p_workspace uuid, p_job uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select j.status into v_status
  from public.ai_draft_jobs as j
  where j.org_id = p_org and j.id = p_job and j.workspace_id = p_workspace
  for no key update;
  return coalesce(v_status = 'running', false);
end
$$;

-- The job's cap: fewer drafts stored than its count. Only the draft insert checks it (the key of the last draft is added
-- after that draft is counted). DB review M1, security review L-3: the job row is locked FOR NO KEY UPDATE before the
-- count, so two deliveries of one job take turns and the second sees the first's draft; a job never ends over its count.
create or replace function private.ai_draft_job_has_room(p_org uuid, p_job uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  select j.count into v_count
  from public.ai_draft_jobs as j
  where j.org_id = p_org and j.id = p_job
  for no key update;
  if not found then
    return false;
  end if;
  return (select count(*) from public.item_versions as v where v.org_id = p_org and v.ai_draft_job_id = p_job) < v_count;
end
$$;

-- The M1-a fix round's third hook (lead, 2026-10-23): true when the org and workspace have a running drafting job. M1-a
-- uses it where the job id is not at hand (the authoring worker's answer-key insert for its own in-review draft).
-- CREATE OR REPLACE keeps M1-a's owner and ACL; the revoke below is a no-op there and keeps a fresh create closed.
create or replace function private.ai_draft_job_running_in(p_org uuid, p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ai_draft_jobs as j
    where j.org_id = p_org and j.workspace_id = p_workspace and j.status = 'running'
  )
$$;
revoke execute on function private.ai_draft_job_running_in(uuid, uuid) from public, anon, authenticated, service_role;

-- An imported row is inserted only while its job (same org and workspace) is open or validating (§4.3). DB review H1:
-- the job row is held FOR SHARE until the batch commits, so a cancel or completion waits for the batch (and then counts
-- its rows), and a batch that waits for an ending job then finds it ended.
create or replace function private.import_job_open(p_org uuid, p_workspace uuid, p_job uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform 1 from public.import_jobs as j
    where j.org_id = p_org and j.id = p_job and j.workspace_id = p_workspace and j.status in ('open', 'validating')
    for share;
  return found;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Guards and audit
-- ---------------------------------------------------------------------------------------------

-- import_jobs: §4.3 open → validating → completed | failed; open|validating → cancelled. Counts come from the stored
-- rows when the job ends, so a re-sent batch (E13) cannot change them.
create function private.import_jobs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op boolean := private.is_operator();
begin
  if tg_op = 'INSERT' then
    if not v_op and current_setting('role') <> 'authenticated' then
      raise exception 'TRACE_GUARD: an import job is started by an org user' using errcode = '42501';
    end if;
    new.status := 'open';
    new.rows_total := 0;
    new.rows_ok := 0;
    new.rows_error := 0;
    new.images_ok := 0;
    new.error_code := null;
    new.completed_at := null;
    new.created_by := case when v_op then new.created_by else (select auth.uid()) end;
    new.created_at := now();
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'TRACE_GUARD: import jobs are kept' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.workspace_id is distinct from old.workspace_id or new.source_kind is distinct from old.source_kind
    or new.template_version is distinct from old.template_version or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: import job id, org, workspace, source and creator are immutable' using errcode = '42501';
  end if;
  if old.status in ('completed', 'cancelled', 'failed') then
    raise exception 'TRACE_GUARD: a finished import job is frozen' using errcode = '42501';
  end if;
  if new.status = old.status or (old.status = 'open' and new.status = 'validating') then
    if new.rows_total is distinct from old.rows_total or new.rows_ok is distinct from old.rows_ok
      or new.rows_error is distinct from old.rows_error or new.error_code is distinct from old.error_code
      or new.completed_at is distinct from old.completed_at then
      raise exception 'TRACE_GUARD: import counts are written when the job ends' using errcode = '42501';
    end if;
    return new;
  end if;
  -- §4.3 (DB review L1): only a validating job completes; an open job may still be cancelled or fail (a file over the
  -- row or image limit fails before any batch).
  if new.status not in ('completed', 'cancelled', 'failed') or (old.status = 'open' and new.status = 'completed') then
    raise exception 'TRACE_GUARD: import job status change not allowed' using errcode = '42501';
  end if;
  select count(*) into new.rows_ok
  from public.item_versions as v where v.org_id = new.org_id and v.import_job_id = new.id;
  select count(distinct e.row_no) into new.rows_error
  from public.import_row_errors as e where e.org_id = new.org_id and e.import_job_id = new.id;
  new.rows_total := new.rows_ok + new.rows_error;
  new.completed_at := now();
  return new;
end
$$;
revoke execute on function private.import_jobs_guard() from public, anon, authenticated, service_role;

create function private.import_jobs_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  if new.status = 'completed' then
    perform private.audit(new.org_id, 'import.complete', 'import_jobs', new.id,
      jsonb_build_object('import_job_id', new.id, 'rows_ok', new.rows_ok, 'rows_error', new.rows_error,
        'images_ok', new.images_ok), new.workspace_id);
  elsif new.status = 'cancelled' then
    perform private.audit(new.org_id, 'import.cancel', 'import_jobs', new.id,
      jsonb_build_object('import_job_id', new.id), new.workspace_id);
  elsif new.status = 'failed' then
    perform private.audit(new.org_id, 'import.fail', 'import_jobs', new.id,
      jsonb_build_object('import_job_id', new.id, 'error_code', new.error_code), new.workspace_id);
  end if;
  return null;
end
$$;
revoke execute on function private.import_jobs_audit() from public, anon, authenticated, service_role;

create trigger import_jobs_guard before insert or update or delete on public.import_jobs
  for each row execute function private.import_jobs_guard();
create trigger import_jobs_audit after update on public.import_jobs
  for each row execute function private.import_jobs_audit();
alter table public.import_jobs enable always trigger import_jobs_guard;

-- import_row_errors: written while the job is open or validating (by public.import_item_batch); never changed.
create function private.import_row_errors_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_status text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'TRACE_GUARD: import row errors are never changed' using errcode = '42501';
  end if;
  select j.workspace_id, j.status into v_ws, v_status
  from public.import_jobs as j where j.org_id = new.org_id and j.id = new.import_job_id for share;
  if not found then
    raise exception 'TRACE_GUARD: import job not found' using errcode = '23503';
  end if;
  if v_status not in ('open', 'validating') then
    raise exception 'TRACE_GUARD: the import job is not open' using errcode = '42501';
  end if;
  new.workspace_id := v_ws;
  new.created_at := now();
  return new;
end
$$;
revoke execute on function private.import_row_errors_guard() from public, anon, authenticated, service_role;
create trigger import_row_errors_guard before insert or update or delete on public.import_row_errors
  for each row execute function private.import_row_errors_guard();
alter table public.import_row_errors enable always trigger import_row_errors_guard;

-- ai_draft_jobs: §4.4 queued → running → completed | failed (queued → failed too). Org users create a job; only the
-- authoring worker moves it (status columns only); a job never moves an item (the item_versions guard owns that).
create function private.ai_draft_jobs_guard()
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
    if not v_op and v_role <> 'authenticated' then
      raise exception 'TRACE_GUARD: a drafting job is requested by an org user' using errcode = '42501';
    end if;
    if not private.skill_key_exists(new.skill_key) then
      raise exception 'TRACE_GUARD: skill not found' using errcode = '23503';
    end if;
    new.status := 'queued';
    new.drafts_created := 0;
    new.drafts_discarded := 0;
    new.error_code := null;
    new.completed_at := null;
    new.requested_by := case when v_op then new.requested_by else (select auth.uid()) end;
    new.created_at := now();
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'TRACE_GUARD: drafting jobs are kept' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.workspace_id is distinct from old.workspace_id or new.requested_by is distinct from old.requested_by
    or new.format is distinct from old.format or new.skill_key is distinct from old.skill_key
    or new.difficulty is distinct from old.difficulty or new.count is distinct from old.count
    or new.topic_sha256 is distinct from old.topic_sha256 or new.provider is distinct from old.provider
    or new.model_id is distinct from old.model_id or new.prompt_version is distinct from old.prompt_version
    or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: a drafting job request is immutable' using errcode = '42501';
  end if;
  if old.status in ('completed', 'failed') then
    raise exception 'TRACE_GUARD: a finished drafting job is frozen' using errcode = '42501';
  end if;
  if not v_op and v_role <> 'trace_authoring_worker' then
    raise exception 'TRACE_GUARD: only the authoring worker moves a drafting job' using errcode = '42501';
  end if;
  if new.status = old.status or (old.status = 'queued' and new.status = 'running') then
    if new.drafts_created is distinct from old.drafts_created or new.drafts_discarded is distinct from old.drafts_discarded
      or new.error_code is distinct from old.error_code or new.completed_at is distinct from old.completed_at then
      raise exception 'TRACE_GUARD: drafting counts are written when the job ends' using errcode = '42501';
    end if;
    return new;
  end if;
  if not ((old.status = 'running' and new.status = 'completed') or new.status = 'failed') then
    raise exception 'TRACE_GUARD: drafting job status change not allowed' using errcode = '42501';
  end if;
  -- Exactly-once truth: the count of stored drafts, whatever the worker believes it wrote.
  select count(*) into new.drafts_created
  from public.item_versions as v where v.org_id = new.org_id and v.ai_draft_job_id = new.id;
  new.completed_at := now();
  return new;
end
$$;
revoke execute on function private.ai_draft_jobs_guard() from public, anon, authenticated, service_role;

create function private.ai_draft_jobs_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.actor_kind := case when current_setting('role') like 'trace\_%' then 'system'::public.actor_kind end;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  if new.status = 'completed' then
    perform private.audit(new.org_id, 'ai_draft.complete', 'ai_draft_jobs', new.id,
      jsonb_build_object('ai_draft_job_id', new.id, 'drafts_created', new.drafts_created), new.workspace_id,
      p_actor_kind => v_kind);
  elsif new.status = 'failed' then
    perform private.audit(new.org_id, 'ai_draft.fail', 'ai_draft_jobs', new.id,
      jsonb_build_object('ai_draft_job_id', new.id, 'error_code', new.error_code), new.workspace_id,
      p_actor_kind => v_kind);
  end if;
  return null;
end
$$;
revoke execute on function private.ai_draft_jobs_audit() from public, anon, authenticated, service_role;

create trigger ai_draft_jobs_guard before insert or update or delete on public.ai_draft_jobs
  for each row execute function private.ai_draft_jobs_guard();
create trigger ai_draft_jobs_audit after update on public.ai_draft_jobs
  for each row execute function private.ai_draft_jobs_audit();
alter table public.ai_draft_jobs enable always trigger ai_draft_jobs_guard;

-- ---------------------------------------------------------------------------------------------
-- public.save_item_variants (§3.4, §6.3, M1-7; R2-22, R3-4): replaces the variants and their keys of a draft
-- parameterised bank version in one transaction. The api generates them with packages/item-variants (one evaluator).
-- p_variants: 1-200 of {variantNo, params, stem, options: [{id, text}], difficulty, contentSha256, correctOptionId}.
-- Returns the number of variants stored. Guards: item_variants_guard (draft, parameterised, ±0.10),
-- item_variant_keys_guard (key is one of the variant's options).
-- ---------------------------------------------------------------------------------------------
create function public.save_item_variants(p_item_version uuid, p_variants jsonb)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_var jsonb;
  v_id uuid;
  v_n int := 0;
begin
  if p_item_version is null or jsonb_typeof(p_variants) is distinct from 'array'
    or jsonb_array_length(p_variants) not between 1 and 200 then
    raise exception 'TRACE_BAD_INPUT: 1 to 200 variants' using errcode = '22023';
  end if;
  select v.org_id into v_org
  from public.item_versions as v where v.id = p_item_version and v.section_id is null;
  if not found then
    raise exception 'TRACE_GUARD: item version not found' using errcode = '23503';
  end if;
  delete from public.item_variant_keys as k
    using public.item_variants as v
    where k.org_id = v.org_id and k.item_variant_id = v.id and v.org_id = v_org and v.item_version_id = p_item_version;
  delete from public.item_variants as v where v.org_id = v_org and v.item_version_id = p_item_version;
  for v_var in select e from jsonb_array_elements(p_variants) as e loop
    if jsonb_typeof(v_var) is distinct from 'object' or jsonb_typeof(v_var -> 'variantNo') is distinct from 'number'
      or jsonb_typeof(v_var -> 'difficulty') is distinct from 'number'
      or jsonb_typeof(v_var -> 'correctOptionId') is distinct from 'string' then
      raise exception 'TRACE_BAD_INPUT: a variant is {variantNo, params, stem, options, difficulty, contentSha256, correctOptionId}'
        using errcode = '22023';
    end if;
    insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty,
        content_sha256)
      values (v_org, p_item_version, (v_var ->> 'variantNo')::int, v_var -> 'params', v_var ->> 'stem',
        v_var -> 'options', (v_var ->> 'difficulty')::numeric, v_var ->> 'contentSha256')
      returning id into v_id;
    insert into public.item_variant_keys (org_id, item_variant_id, key)
      values (v_org, v_id, jsonb_build_object('option_id', v_var ->> 'correctOptionId'));
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.save_item_variants(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_item_variants(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- public.import_item_batch (§3.4, §4.3, §6.9; M1-9, Q23, R3-4, R3-5, R5-37, R5-40, E13, E14). Up to 100 rows the api
-- has already validated (zod + rules). Each row becomes one bank item: items + item_versions (draft, origin 'import' set
-- by the guard) + its key or its variants and their keys + media refs, then approved by the importer in the same call
-- (Q23), or moved to in_review in a trace_library org (R5-37: library content keeps its expert review). A row with
-- errors stores its error codes instead; nothing of that row is inserted (a per-row savepoint, E14).
-- Idempotent on (import_job_id, row_no) (R3-5, E13): a row already stored as an item or as errors is skipped, and the
-- response is rebuilt from what is stored, so a re-sent batch returns the same answer and changes no count. Batches of
-- one job are serialised by an advisory lock (R5-40), so a concurrent retry leaves no orphan items row.
-- p_rows: [{rowNo (2..2001), errors?: [{field, code}] (api-found; when present and non-empty the row is stored as these
--   errors only), format: 'mcq'|'written', skillKey, difficulty (0..1, two decimals), stem, contentSha256 (64 hex, the
--   api's canonical hash of the item content), options?: string[] 2..6 (ids a..f), correct?: 'a'..'f', rubricKey?
--   (written; the latest version of that org rubric), imageKey?, imageAlt? (a content-addressed key the api stored,
--   item-media/{org}/{sha256}.{ext}), paramSpec?: ParamSpec, variants?: as public.save_item_variants}].
-- Returns ImportRowsResponse: {accepted: rows of this batch stored as items, errors: [{rowNo, field, code}]}.
-- ---------------------------------------------------------------------------------------------
create function public.import_item_batch(p_job uuid, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_ws uuid;
  v_status text;
  v_lib boolean;
  v_row jsonb;
  v_no int;
  v_nos int[] := '{}';
  v_errs jsonb;
  v_format text;
  v_skill text;
  v_diff numeric;
  v_stem text;
  v_opts jsonb;
  v_correct text;
  v_media jsonb;
  v_param jsonb;
  v_rubric uuid;
  v_sha text;
  v_item uuid;
  v_ver uuid;
  v_var jsonb;
  v_var_id uuid;
  v_msg text;
  v_constraint text;
begin
  if p_job is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'TRACE_BAD_INPUT: 1 to 100 rows per batch' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('import:' || p_job::text, 0));
  select j.org_id, j.workspace_id, j.status into v_org, v_ws, v_status
  from public.import_jobs as j where j.id = p_job;
  if not found then
    raise exception 'TRACE_GUARD: import job not found' using errcode = '23503';
  end if;
  if v_status not in ('open', 'validating') then
    raise exception 'TRACE_GUARD: the import job is not open' using errcode = '42501';
  end if;
  if v_status = 'open' then
    update public.import_jobs set status = 'validating' where org_id = v_org and id = p_job;
  end if;
  select o.kind = 'trace_library' into v_lib from public.orgs as o where o.id = v_org;
  v_lib := coalesce(v_lib, false);

  for v_row in select e from jsonb_array_elements(p_rows) as e loop
    if jsonb_typeof(v_row) is distinct from 'object' or coalesce(v_row ->> 'rowNo', '') !~ '^[0-9]{1,4}$' then
      raise exception 'TRACE_BAD_INPUT: every row has an integer rowNo' using errcode = '22023';
    end if;
    v_no := (v_row ->> 'rowNo')::int;
    if v_no not between 2 and 2001 then
      raise exception 'TRACE_BAD_INPUT: rowNo is 2 to 2001' using errcode = '22023';
    end if;
    if v_no = any (v_nos) then
      raise exception 'TRACE_BAD_INPUT: a row is sent twice in one batch' using errcode = '22023';
    end if;
    v_nos := v_nos || v_no;
    -- E13: a row stored before (as an item or as errors) is not written again.
    if exists (select 1 from public.item_versions as v
               where v.org_id = v_org and v.import_job_id = p_job and v.import_row_no = v_no)
      or exists (select 1 from public.import_row_errors as e
                 where e.org_id = v_org and e.import_job_id = p_job and e.row_no = v_no) then
      continue;
    end if;

    v_errs := '[]'::jsonb;
    if jsonb_typeof(v_row -> 'errors') = 'array' and jsonb_array_length(v_row -> 'errors') > 0 then
      select jsonb_agg(jsonb_build_object('field', x ->> 'field', 'code', x ->> 'code'))
        into v_errs from jsonb_array_elements(v_row -> 'errors') as x;
    else
      v_format := v_row ->> 'format';
      v_skill := v_row ->> 'skillKey';
      v_stem := v_row ->> 'stem';
      v_opts := v_row -> 'options';
      v_correct := v_row ->> 'correct';
      v_param := case when jsonb_typeof(v_row -> 'paramSpec') = 'object' then v_row -> 'paramSpec' end;
      v_sha := v_row ->> 'contentSha256';
      v_rubric := null;
      v_media := null;
      v_diff := null;
      if coalesce(v_sha, '') !~ '^[0-9a-f]{64}$' then
        raise exception 'TRACE_BAD_INPUT: every row carries its contentSha256' using errcode = '22023';
      end if;
      if v_format is null then
        v_errs := v_errs || '[{"field": "format", "code": "missing_field"}]';
      elsif v_format not in ('mcq', 'written') then
        v_errs := v_errs || '[{"field": "format", "code": "bad_format"}]';
      end if;
      if coalesce(v_skill, '') = '' then
        v_errs := v_errs || '[{"field": "skill", "code": "missing_field"}]';
      elsif v_skill !~ '^[a-z][a-z0-9_]{1,40}$' then
        v_errs := v_errs || '[{"field": "skill", "code": "bad_skill"}]';
      end if;
      if v_row -> 'difficulty' is null or jsonb_typeof(v_row -> 'difficulty') = 'null' then
        v_errs := v_errs || '[{"field": "difficulty", "code": "missing_field"}]';
      elsif jsonb_typeof(v_row -> 'difficulty') <> 'number'
        or (v_row ->> 'difficulty')::numeric not between 0 and 1
        or (v_row ->> 'difficulty')::numeric <> round((v_row ->> 'difficulty')::numeric, 2) then
        v_errs := v_errs || '[{"field": "difficulty", "code": "bad_difficulty"}]';
      else
        v_diff := (v_row ->> 'difficulty')::numeric;
      end if;
      if coalesce(v_stem, '') = '' then
        v_errs := v_errs || '[{"field": "stem", "code": "missing_field"}]';
      elsif char_length(v_stem) > 4000 then
        v_errs := v_errs || '[{"field": "stem", "code": "too_long"}]';
      end if;
      if v_format = 'mcq' then
        if v_opts is null or jsonb_typeof(v_opts) = 'null' then
          v_errs := v_errs || '[{"field": "options", "code": "missing_field"}]';
        elsif jsonb_typeof(v_opts) <> 'array' or jsonb_array_length(v_opts) not between 2 and 6
          or exists (select 1 from jsonb_array_elements(v_opts) as o
                     where jsonb_typeof(o) <> 'string' or char_length(o #>> '{}') not between 1 and 500) then
          v_errs := v_errs || '[{"field": "options", "code": "bad_options"}]';
        else
          select jsonb_agg(jsonb_build_object('id', chr(96 + o.n::int), 'text', o.t) order by o.n)
            into v_opts from jsonb_array_elements_text(v_opts) with ordinality as o(t, n);
          if v_param is null then
            if coalesce(v_correct, '') = '' then
              v_errs := v_errs || '[{"field": "correct", "code": "missing_field"}]';
            elsif v_correct !~ '^[a-f]$' or ascii(v_correct) - 96 > jsonb_array_length(v_opts) then
              v_errs := v_errs || '[{"field": "correct", "code": "bad_key"}]';
            end if;
          end if;
        end if;
      elsif v_format = 'written' then
        if coalesce(v_row ->> 'rubricKey', '') = '' then
          v_errs := v_errs || '[{"field": "rubric_key", "code": "missing_field"}]';
        else
          select r.id into v_rubric from public.rubric_versions as r
          where r.org_id = v_org and r.rubric_key = v_row ->> 'rubricKey'
          order by r.version_no desc limit 1;
          if v_rubric is null then
            v_errs := v_errs || '[{"field": "rubric_key", "code": "bad_format"}]';
          end if;
        end if;
      end if;
      if coalesce(v_row ->> 'imageKey', '') <> '' then
        if coalesce(v_row ->> 'imageAlt', '') = '' then
          v_errs := v_errs || '[{"field": "image_alt", "code": "missing_field"}]';
        elsif char_length(v_row ->> 'imageAlt') > 300 then
          v_errs := v_errs || '[{"field": "image_alt", "code": "too_long"}]';
        end if;
        -- Only an image stored under this org's own prefix (§6.9 content-addressed key).
        if (v_row ->> 'imageKey') !~ ('^item-media/' || v_org::text || '/[0-9a-f]{64}\.(png|jpg|webp)$') then
          v_errs := v_errs || '[{"field": "image_file", "code": "bad_image_ref"}]';
        else
          v_media := jsonb_build_array(jsonb_build_object('key', v_row ->> 'imageKey', 'alt', v_row ->> 'imageAlt'));
        end if;
      end if;
      if v_param is not null then
        if v_format is distinct from 'mcq' then
          v_errs := v_errs || '[{"field": "param_spec_json", "code": "bad_param_spec"}]';
        elsif jsonb_typeof(v_row -> 'variants') is distinct from 'array' or jsonb_array_length(v_row -> 'variants') = 0 then
          v_errs := v_errs || '[{"field": "param_spec_json", "code": "variant_generation_failed"}]';
        end if;
      end if;
      if jsonb_array_length(v_errs) = 0 then
        if exists (select 1 from public.item_versions as v
                   where v.org_id = v_org and v.import_job_id = p_job and v.content_sha256 = v_sha) then
          v_errs := '[{"field": "row", "code": "duplicate_in_file"}]';
        elsif exists (select 1 from public.item_versions as v
                      where v.org_id = v_org and v.workspace_id = v_ws and v.section_id is null
                        and v.import_job_id is distinct from p_job and v.content_sha256 = v_sha
                        and v.status <> 'not_approved') then
          v_errs := '[{"field": "row", "code": "duplicate_in_bank"}]';
        end if;
      end if;
    end if;

    if jsonb_array_length(v_errs) = 0 then
      begin
        insert into public.items (org_id, workspace_id, format, skill_key)
          values (v_org, v_ws, v_format::public.section_format, v_skill)
          returning id into v_item;
        insert into public.item_versions (org_id, item_id, format, stem, options, rubric_version_id, skill_key, difficulty,
            media, is_parameterised, param_spec, content_sha256, import_job_id, import_row_no)
          values (v_org, v_item, v_format::public.section_format, v_stem, case when v_format = 'mcq' then v_opts end,
            v_rubric, v_skill, v_diff, v_media, v_param is not null, v_param, v_sha, p_job, v_no)
          returning id into v_ver;
        if v_format = 'mcq' and v_param is null then
          insert into public.item_answer_keys (org_id, item_version_id, format, key)
            values (v_org, v_ver, 'mcq', jsonb_build_object('option_id', v_correct));
        end if;
        if v_param is not null then
          for v_var in select e from jsonb_array_elements(v_row -> 'variants') as e loop
            insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty,
                content_sha256)
              values (v_org, v_ver, (v_var ->> 'variantNo')::int, v_var -> 'params', v_var ->> 'stem', v_var -> 'options',
                (v_var ->> 'difficulty')::numeric, v_var ->> 'contentSha256')
              returning id into v_var_id;
            insert into public.item_variant_keys (org_id, item_variant_id, key)
              values (v_org, v_var_id, jsonb_build_object('option_id', v_var ->> 'correctOptionId'));
          end loop;
        end if;
        -- Q23: the importer approves at import; R5-37: a library import waits for its expert review.
        update public.item_versions
          set status = case when v_lib then 'in_review' else 'approved' end::public.item_status
          where org_id = v_org and id = v_ver;
      exception when others then
        get stacked diagnostics v_msg = message_text, v_constraint = constraint_name;
        v_errs := case
          when v_msg = 'TRACE_GUARD: skill not found' then '[{"field": "skill", "code": "bad_skill"}]'
          when v_msg in ('TRACE_GUARD: a variant difficulty must be within 0.10 of its item',
              'TRACE_GUARD: a parameterised item needs its variants', 'TRACE_GUARD: every variant needs its answer key')
            or v_constraint like 'item\_variant%' then '[{"field": "param_spec_json", "code": "variant_generation_failed"}]'
          when v_msg in ('TRACE_BAD_ANSWER_KEY', 'TRACE_GUARD: a multiple-choice item needs its answer key')
            then '[{"field": "correct", "code": "bad_key"}]'
          when v_constraint = 'item_versions_media_check' then '[{"field": "image_file", "code": "bad_image_ref"}]'
          when v_constraint in ('item_versions_param_spec_check', 'item_versions_parameterised')
            then '[{"field": "param_spec_json", "code": "bad_param_spec"}]'
          when v_constraint = 'item_versions_check' then '[{"field": "options", "code": "bad_options"}]'
          when v_constraint = 'item_versions_stem_check' then '[{"field": "stem", "code": "too_long"}]'
        end;
        -- Anything else is not a row error: the whole batch fails and the api retries or reports it.
        if v_errs is null then
          raise;
        end if;
      end;
    end if;

    if jsonb_array_length(v_errs) > 0 then
      insert into public.import_row_errors (org_id, import_job_id, row_no, field, error_code)
        select v_org, p_job, v_no, x ->> 'field', x ->> 'code' from jsonb_array_elements(v_errs) as x
        on conflict do nothing;
    end if;
  end loop;

  return jsonb_build_object(
    'accepted', (select count(*) from public.item_versions as v
                 where v.org_id = v_org and v.import_job_id = p_job and v.import_row_no = any (v_nos)),
    'errors', coalesce((
      select jsonb_agg(jsonb_build_object('rowNo', e.row_no, 'field', e.field, 'code', e.error_code)
               order by e.row_no, e.field)
      from public.import_row_errors as e
      where e.org_id = v_org and e.import_job_id = p_job and e.row_no = any (v_nos)), '[]'::jsonb));
end
$$;
revoke execute on function public.import_item_batch(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.import_item_batch(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- public.save_test_draft (§3.4, §5 SaveTestDraftRequest; M1-18; fixes D1 r3 m-4's non-atomic chain). Replaces a draft
-- version's sections, inline items and their keys, the version's time and cutoff, the test name and (when given) the
-- ruleset settings, in one transaction as the caller. Every guard applies: a published version is refused by the
-- test_versions guard ('TRACE_GUARD: a published test version is frozen', E1), the settings by the ruleset guard
-- (catalog, locks, always-locked; signal_settings derived), sections and inline items by their D1 guards.
-- p_payload (DB shape; the api maps SaveTestDraftRequest and computes every content hash with canonical JSON):
--   {name, totalTimeSeconds, qualityCutoff, presetKey?, settings? (object; absent or null keeps the ruleset's),
--    sections: ≤ 10 of {name, format, weight, timeLimitSeconds?, poolId?, drawCount?, shuffleItems?, shuffleOptions?,
--      navigation?, pasteRule?, blueprint?, items: [{format, stem, contentSha256, options? [{id, text}],
--      correctOptionId? (mcq), rubricVersionId? | rubric? {criteria, contentSha256} (written)}]}}, ≤ 200 inline items.
-- Returns {sections, items}: the counts written.
-- ---------------------------------------------------------------------------------------------
create function public.save_test_draft(p_test_version uuid, p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_test uuid;
  v_ruleset uuid;
  v_sec jsonb;
  v_spos bigint;
  v_item jsonb;
  v_ipos bigint;
  v_sec_id uuid;
  v_ver uuid;
  v_rubric uuid;
  v_n_sec int := 0;
  v_n_items int := 0;
  v_rows int;
begin
  if p_test_version is null or jsonb_typeof(p_payload) is distinct from 'object'
    or jsonb_typeof(p_payload -> 'sections') is distinct from 'array'
    or jsonb_array_length(p_payload -> 'sections') > 10 then
    raise exception 'TRACE_BAD_INPUT: a draft is an object with at most 10 sections' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_payload -> 'sections') as s
             where jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(s -> 'items') is distinct from 'array'
               or (jsonb_typeof(s -> 'poolId') = 'string' and jsonb_array_length(s -> 'items') > 0))
    or (select coalesce(sum(jsonb_array_length(s -> 'items')), 0)
        from jsonb_array_elements(p_payload -> 'sections') as s) > 200 then
    raise exception 'TRACE_BAD_INPUT: every section has an items array, a pool section has none, at most 200 items'
      using errcode = '22023';
  end if;

  select v.org_id, v.test_id, v.ruleset_version_id into v_org, v_test, v_ruleset
  from public.test_versions as v where v.id = p_test_version;
  if not found then
    raise exception 'TRACE_GUARD: test version not found' using errcode = '23503';
  end if;
  -- The version first (as D1's PUT): the guard refuses a published version, and the row lock serialises two editors.
  update public.test_versions
    set total_time_seconds = (p_payload ->> 'totalTimeSeconds')::int,
      quality_cutoff = (p_payload ->> 'qualityCutoff')::smallint
    where org_id = v_org and id = p_test_version;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'TRACE_GUARD: test version not found' using errcode = '23503';
  end if;
  update public.tests set name = p_payload ->> 'name' where org_id = v_org and id = v_test;
  if jsonb_typeof(p_payload -> 'settings') = 'object' then
    update public.ruleset_versions
      set preset_key = p_payload ->> 'presetKey', preset_version = null, settings = p_payload -> 'settings'
      where org_id = v_org and id = v_ruleset;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'TRACE_GUARD: ruleset version not found' using errcode = '23503';
    end if;
  end if;

  delete from public.item_answer_keys as k
    using public.item_versions as i
    where k.org_id = i.org_id and k.item_version_id = i.id and i.org_id = v_org and i.test_version_id = p_test_version;
  delete from public.item_versions as i where i.org_id = v_org and i.test_version_id = p_test_version;
  delete from public.sections as s where s.org_id = v_org and s.test_version_id = p_test_version;

  for v_sec, v_spos in select e, n from jsonb_array_elements(p_payload -> 'sections') with ordinality as x(e, n) loop
    insert into public.sections (org_id, test_version_id, position, name, format, weight, time_limit_seconds, pool_id,
        draw_count, shuffle_items, shuffle_options, navigation, paste_rule, blueprint)
      values (v_org, p_test_version, v_spos::int, v_sec ->> 'name', (v_sec ->> 'format')::public.section_format,
        (v_sec ->> 'weight')::numeric, (v_sec ->> 'timeLimitSeconds')::int, (v_sec ->> 'poolId')::uuid,
        (v_sec ->> 'drawCount')::int, coalesce((v_sec ->> 'shuffleItems')::boolean, false),
        coalesce((v_sec ->> 'shuffleOptions')::boolean, false), v_sec ->> 'navigation', v_sec ->> 'pasteRule',
        case when jsonb_typeof(v_sec -> 'blueprint') = 'object' then v_sec -> 'blueprint' end)
      returning id into v_sec_id;
    v_n_sec := v_n_sec + 1;
    for v_item, v_ipos in select e, n from jsonb_array_elements(v_sec -> 'items') with ordinality as x(e, n) loop
      v_rubric := null;
      if v_item ->> 'format' = 'written' then
        if jsonb_typeof(v_item -> 'rubric') = 'object' then
          -- A referenced rubric is frozen, so each draft write makes a new one (as D1's PUT).
          insert into public.rubric_versions (org_id, rubric_key, version_no, criteria, content_sha256)
            values (v_org, gen_random_uuid()::text, 1, v_item -> 'rubric' -> 'criteria',
              v_item -> 'rubric' ->> 'contentSha256')
            returning id into v_rubric;
        else
          v_rubric := (v_item ->> 'rubricVersionId')::uuid;
        end if;
      end if;
      insert into public.item_versions (org_id, section_id, format, position, stem, options, rubric_version_id,
          content_sha256)
        values (v_org, v_sec_id, (v_item ->> 'format')::public.section_format, v_ipos::int, v_item ->> 'stem',
          case when v_item ->> 'format' = 'mcq' then v_item -> 'options' end, v_rubric, v_item ->> 'contentSha256')
        returning id into v_ver;
      if v_item ->> 'format' = 'mcq' then
        insert into public.item_answer_keys (org_id, item_version_id, format, key)
          values (v_org, v_ver, 'mcq', jsonb_build_object('option_id', v_item ->> 'correctOptionId'));
      end if;
      v_n_items := v_n_items + 1;
    end loop;
  end loop;
  return jsonb_build_object('sections', v_n_sec, 'items', v_n_items);
end
$$;
revoke execute on function public.save_test_draft(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_test_draft(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Grants and policies (§3.5). Staff arm = owner/admin/recruiter of the row's workspace (fence, M0b D16b); the
-- authoring worker is bound to private.job_org_id() (R5-35). Nothing for anon, service_role, reviewers, hiring managers
-- or the candidate roles.
-- ---------------------------------------------------------------------------------------------

-- import_jobs: staff start, read and end (complete, fail, cancel) their workspace's imports; the guard owns the
-- state machine and the counts.
grant select on public.import_jobs to authenticated;
grant insert (id, org_id, workspace_id, source_kind, template_version) on public.import_jobs to authenticated;
grant update (status, images_ok, error_code) on public.import_jobs to authenticated;
create policy import_jobs_select_staff on public.import_jobs for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy import_jobs_insert_staff on public.import_jobs for insert to authenticated
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy import_jobs_update_staff on public.import_jobs for update to authenticated
  using (status in ('open', 'validating')
    and workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]))
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));

-- import_row_errors: read by staff; written through public.import_item_batch (invoker, so the insert grant and policy
-- are the caller's; the guard requires an open job).
grant select on public.import_row_errors to authenticated;
grant insert (org_id, import_job_id, row_no, field, error_code) on public.import_row_errors to authenticated;
create policy import_row_errors_select_staff on public.import_row_errors for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy import_row_errors_insert_staff on public.import_row_errors for insert to authenticated
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));

-- ai_draft_jobs: staff request and read; the authoring worker reads and moves its job org's jobs (status columns only).
grant select on public.ai_draft_jobs to authenticated;
grant insert (id, org_id, workspace_id, format, skill_key, difficulty, count, topic_sha256, provider, model_id,
  prompt_version) on public.ai_draft_jobs to authenticated;
grant select on public.ai_draft_jobs to trace_authoring_worker;
grant update (status, drafts_discarded, error_code) on public.ai_draft_jobs to trace_authoring_worker;
create policy ai_draft_jobs_select_staff on public.ai_draft_jobs for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy ai_draft_jobs_insert_staff on public.ai_draft_jobs for insert to authenticated
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy ai_draft_jobs_select_authoring_worker on public.ai_draft_jobs for select to trace_authoring_worker
  using (org_id = (select private.job_org_id()));
create policy ai_draft_jobs_update_authoring_worker on public.ai_draft_jobs for update to trace_authoring_worker
  using (org_id = (select private.job_org_id()))
  with check (org_id = (select private.job_org_id()));

-- idempotency_keys (§6.4): the authoring worker's own scope, bound to its job org (as D1's L-20 worker policies).
grant select, insert on public.idempotency_keys to trace_authoring_worker;
create policy idempotency_keys_select_authoring_worker on public.idempotency_keys for select to trace_authoring_worker
  using (scope = 'ai_draft' and org_id = (select private.job_org_id()));
create policy idempotency_keys_insert_authoring_worker on public.idempotency_keys for insert to trace_authoring_worker
  with check (scope = 'ai_draft' and org_id = (select private.job_org_id()));
