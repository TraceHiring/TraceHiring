-- D1 migration 2 of 4 (spec specs/d1-demo-slice.md §3.1 row 2, §3.2 "Invitations, consent, sessions", §3.3,
-- §3.4, §3.5, §3.7, §10-DB; binding decisions R-10, R-14, L-1, L-6, L-12, L-17, L-20, L-23, L-27, L-29, L-31, L-32,
-- L-35). Invitations, consents, sessions and their children; the label, state-machine, age, append-only and
-- forward-only triggers; private.resolve_invitation_by_hash() and private.mirror_session(); api and worker grants and
-- policies; the L-20 rewrite of the idempotency_keys worker policies.
-- Builds on migration 1 (role trace_api, private.job_org_id(), private.api_org_id(), private.my_assigned_test_ids(),
-- tests.invitation_seq). Nothing here reads or names the quality or integrity schemas (MT-5).
--
-- Login roles (api_login, jobs_mirror_login, jobs_quality_login, jobs_integrity_login) are NOT created here: spec §3
-- intro says they are operator-created, with passwords from the operator runbook, never in a migration (M0b §2.3).
-- The runbook grants each one exactly one trace_* role `with inherit false, set true` (L-29).
--
-- Error contract (same as M0b and migration 1; the rls_d1_* tests rely on it):
--   guard / state-machine refusal   SQLSTATE 42501, message 'TRACE_GUARD: <reason>'
--   missing parent row              SQLSTATE 23503, message 'TRACE_GUARD: <parent> not found'
--   malformed mirror message        SQLSTATE 22023, message 'TRACE_BAD_MIRROR: <reason>'
--   consents UPDATE/DELETE/TRUNCATE SQLSTATE P0001, message 'TRACE_APPEND_ONLY'
--
-- Caller detection: guards read current_setting('role') (the SET ROLE target: 'authenticated' for PostgREST,
-- 'trace_api' / 'trace_worker' after SET LOCAL ROLE), never current_user, which is the owner inside a definer
-- function (M0b §2.8). Every write guard on these tables admits exactly the roles the spec names as writers; the
-- plain operator session (role 'none') is refused like any other role (fail closed; NOTES Q-1).

-- ---------------------------------------------------------------------------------------------
-- Role trace_api (spec §3.1 row 2). Migration 1 already creates it; this block is then a no-op apart from
-- re-asserting the attributes (roles are cluster-global and survive db reset, M0b §2.3).
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select from pg_catalog.pg_roles where rolname = 'trace_api') then
    create role trace_api nologin;
  end if;
  alter role trace_api nologin nocreatedb nocreaterole nobypassrls;
end
$$;

-- trace_api calls private.resolve_invitation_by_hash() and trace_worker calls private.mirror_session() by name, and
-- mirror_session (INVOKER) calls private.job_org_id() from its body: a by-name call needs USAGE on the schema
-- (M0b §2.1: only policies and CHECKs, which store OIDs, do without it). MT-8 forbids USAGE for anon and
-- authenticated only. Every private function's EXECUTE is revoked from PUBLIC, so USAGE exposes nothing else.
grant usage on schema private to trace_api, trace_worker;

-- ---------------------------------------------------------------------------------------------
-- Enum (no rejected value: MT-6, rule 2)
-- ---------------------------------------------------------------------------------------------
create type public.invitation_status as enum (
  'created', 'sent', 'otp_verified', 'started', 'submitted', 'expired', 'revoked', 'blocked_age'
);

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

-- invitations. Synthetic-only by construction (D1-1): a generated label and an @example.test contact; no name,
-- phone, date of birth or age column (MT-3). Only booleans and their source are stored for rule 9.
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  test_version_id uuid not null,
  candidate_id uuid not null default gen_random_uuid(),
  session_id uuid null,
  started_at timestamptz null,
  candidate_label text not null check (candidate_label ~ '^Candidate [1-9][0-9]{0,8}$'),
  contact_email text not null
    check (char_length(contact_email) <= 77 and contact_email ~ '^[a-z0-9._+-]{1,64}@example\.test$'),
  link_token_hash text not null check (link_token_hash ~ '^[0-9a-f]{64}$'),
  adult_confirmed_by_inviter boolean null,
  adult_self_declared boolean null,
  age_block_source text null check (age_block_source in ('inviter', 'self_declared')),
  status public.invitation_status not null default 'created',
  expires_at timestamptz not null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, id, test_version_id),
  unique (org_id, id, session_id),
  unique (org_id, session_id),
  unique (candidate_id),
  unique (link_token_hash),
  unique (org_id, test_id, candidate_label),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict,
  foreign key (org_id, test_version_id) references public.test_versions (org_id, id) on delete restrict,
  -- L-31: a stated minor (either source) <=> blocked_age; null means "not yet stated".
  constraint invitations_age_block
    check (((adult_confirmed_by_inviter is false) or (adult_self_declared is false)) = (status = 'blocked_age')),
  constraint invitations_age_block_source check ((status = 'blocked_age') = (age_block_source is not null)),
  constraint invitations_started_needs_session check (started_at is null or session_id is not null),
  constraint invitations_started_has_time check (status <> 'started' or started_at is not null)
);
create unique index invitations_one_live_contact on public.invitations (org_id, test_id, contact_email)
  where status <> 'revoked';
create index invitations_test_idx on public.invitations (org_id, test_id);
create index invitations_workspace_idx on public.invitations (org_id, workspace_id);
create index invitations_test_version_idx on public.invitations (org_id, test_version_id);
alter table public.invitations enable row level security;

-- consents (append-only, written by trace_api at step 4 before any getUserMedia: D1-13, Q36)
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  invitation_id uuid not null,
  test_version_id uuid not null,
  ruleset_version_id uuid not null,
  notice_version_id uuid not null,
  rendered_sha256 text not null check (rendered_sha256 ~ '^[0-9a-f]{64}$'),
  language text not null default 'en' check (language = 'en'),
  event text not null default 'granted' check (event = 'granted'),
  occurred_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, id, invitation_id, ruleset_version_id),
  unique (org_id, invitation_id, event),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict,
  foreign key (org_id, invitation_id, test_version_id)
    references public.invitations (org_id, id, test_version_id) on delete restrict,
  foreign key (org_id, test_version_id, ruleset_version_id)
    references public.test_versions (org_id, id, ruleset_version_id) on delete restrict,
  foreign key (org_id, notice_version_id) references public.notice_versions (org_id, id) on delete restrict
);
create index consents_test_idx on public.consents (org_id, test_id);
create index consents_workspace_idx on public.consents (org_id, workspace_id);
create index consents_version_idx on public.consents (org_id, test_version_id, ruleset_version_id);
create index consents_notice_idx on public.consents (org_id, notice_version_id);
alter table public.consents enable row level security;

-- sessions (the mirror of SessionDO; written by trace_worker only)
create table public.sessions (
  id uuid primary key,
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  test_version_id uuid not null,
  ruleset_version_id uuid not null,
  invitation_id uuid not null,
  consent_id uuid not null,
  state text not null check (state in ('in_progress', 'submitted', 'auto_submitted')),
  submit_kind text null check (submit_kind in ('candidate', 'deadline')),
  adult_confirmed_at_start boolean not null check (adult_confirmed_at_start),
  started_at timestamptz not null,
  server_deadline_at timestamptz not null,
  submitted_at timestamptz null,
  mirror_seq int not null check (mirror_seq >= 1),
  receipt_ref text not null check (receipt_ref ~ '^[A-Z0-9]{8,16}$'),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, invitation_id),
  unique (org_id, receipt_ref),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict,
  -- The pins (§3.2): the session id is the invitation's, the version is the invitation's, the ruleset is the
  -- version's, and the consent is this invitation's for this ruleset.
  foreign key (org_id, invitation_id, id) references public.invitations (org_id, id, session_id) on delete restrict,
  foreign key (org_id, invitation_id, test_version_id)
    references public.invitations (org_id, id, test_version_id) on delete restrict,
  foreign key (org_id, test_version_id, ruleset_version_id)
    references public.test_versions (org_id, id, ruleset_version_id) on delete restrict,
  foreign key (org_id, consent_id, invitation_id, ruleset_version_id)
    references public.consents (org_id, id, invitation_id, ruleset_version_id) on delete restrict,
  check (server_deadline_at > started_at),
  check ((state = 'in_progress') = (submitted_at is null and submit_kind is null)),
  check (submitted_at is null or submitted_at >= started_at),
  check ((state = 'auto_submitted') = (submit_kind = 'deadline'))
);
create index sessions_test_idx on public.sessions (org_id, test_id);
create index sessions_workspace_idx on public.sessions (org_id, workspace_id);
create index sessions_version_idx on public.sessions (org_id, test_version_id, ruleset_version_id);
create index sessions_consent_idx on public.sessions (org_id, consent_id);
alter table public.sessions enable row level security;

-- session_items (served items; insert-only by trace_worker)
create table public.session_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  session_id uuid not null,
  section_id uuid not null,
  item_version_id uuid not null,
  position int not null check (position >= 1),
  served_at timestamptz not null,
  unique (org_id, id),
  unique (org_id, id, session_id),
  unique (org_id, session_id, section_id, position),
  unique (org_id, session_id, item_version_id),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict,
  foreign key (org_id, session_id) references public.sessions (org_id, id) on delete restrict,
  foreign key (org_id, section_id) references public.sections (org_id, id) on delete restrict,
  foreign key (org_id, item_version_id) references public.item_versions (org_id, id) on delete restrict
);
create index session_items_test_idx on public.session_items (org_id, test_id);
create index session_items_workspace_idx on public.session_items (org_id, workspace_id);
create index session_items_item_idx on public.session_items (org_id, item_version_id);
create index session_items_section_idx on public.session_items (org_id, section_id);
alter table public.session_items enable row level security;

-- responses (final answers rebuilt by the DO; no app-role grant, R-8; no score/grade/band/outcome column, I-1)
create table public.responses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  session_id uuid not null,
  session_item_id uuid not null unique,
  answer_kind text not null check (answer_kind in ('text', 'choice')),
  final_text text null check (final_text is null or char_length(final_text) <= 20000),
  final_choice text null check (final_choice is null or char_length(final_choice) between 1 and 64),
  answer_sha256 text not null check (answer_sha256 ~ '^[0-9a-f]{64}$'),
  final_seq int not null check (final_seq >= 0),
  submitted_at timestamptz not null,
  unique (org_id, id),
  foreign key (org_id, session_id) references public.sessions (org_id, id) on delete restrict,
  foreign key (org_id, session_item_id, session_id)
    references public.session_items (org_id, id, session_id) on delete restrict,
  check ((answer_kind = 'text') = (final_text is not null)),
  check ((answer_kind = 'choice') = (final_choice is not null))
);
create index responses_session_idx on public.responses (org_id, session_id);
alter table public.responses enable row level security;

-- media_objects (rule 8 allow-list: start_photo only in D1; bytes reached only via migration 4's grant functions)
create table public.media_objects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  session_id uuid not null,
  kind text not null check (kind = 'start_photo'),
  r2_key text not null check (char_length(r2_key) <= 200),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes int not null check (bytes between 1 and 1500000),
  mime text not null check (mime = 'image/jpeg'),
  blurred_on_device boolean not null check (blurred_on_device),
  upload_state text not null default 'uploaded' check (upload_state = 'uploaded'),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, session_id, kind),
  unique (r2_key),
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict,
  foreign key (org_id, session_id) references public.sessions (org_id, id) on delete restrict
);
create index media_objects_test_idx on public.media_objects (org_id, test_id);
create index media_objects_workspace_idx on public.media_objects (org_id, workspace_id);
alter table public.media_objects enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Triggers. All SECURITY DEFINER, search_path = '', EXECUTE revoked, ENABLE ALWAYS (replica mode cannot skip them).
-- ---------------------------------------------------------------------------------------------

-- invitations: BEFORE INSERT (label, scoping copy, pin check, inviter age) --------------------------
create function private.invitations_label()
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
begin
  -- Org users create invitations; the operator path (plain postgres, no JWT; M0b §2.8) may too, as on the
  -- migration-1 authoring tables (NOTES Q-1, decided 2026-10-14). The rule-9 inviter block below holds for both.
  if current_setting('role') is distinct from 'authenticated' and not private.is_operator() then
    raise exception 'TRACE_GUARD: invitations are created by org users only' using errcode = '42501';
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
  return new;
end
$$;
revoke execute on function private.invitations_label() from public, anon, authenticated, service_role;

-- invitations: BEFORE UPDATE (immutability, set-once columns, forward-only state machine per role) ---
create function private.invitations_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := current_setting('role');
  v_old_rank int;
  v_new_rank int;
begin
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.workspace_id is distinct from old.workspace_id or new.test_id is distinct from old.test_id
    or new.test_version_id is distinct from old.test_version_id or new.candidate_id is distinct from old.candidate_id
    or new.candidate_label is distinct from old.candidate_label or new.contact_email is distinct from old.contact_email
    or new.link_token_hash is distinct from old.link_token_hash
    or new.adult_confirmed_by_inviter is distinct from old.adult_confirmed_by_inviter
    or new.expires_at is distinct from old.expires_at or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: invitation identity, pin, contact and inviter answer are immutable'
      using errcode = '42501';
  end if;
  -- An update that changes nothing is a no-op (a retried sessionStarted with the stored started_at, L-17).
  if new is not distinct from old then
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

  if v_role = 'authenticated' then
    -- Revoke from created|sent only (R-14); nothing else is writable by org users.
    if new.session_id is distinct from old.session_id or new.started_at is distinct from old.started_at
      or new.adult_self_declared is distinct from old.adult_self_declared
      or new.age_block_source is distinct from old.age_block_source then
      raise exception 'TRACE_GUARD: org users may only revoke an invitation' using errcode = '42501';
    end if;
    if new.status <> 'revoked' or old.status not in ('created', 'sent') then
      raise exception 'TRACE_GUARD: org users may revoke only a created or sent invitation' using errcode = '42501';
    end if;
    return new;

  elsif v_role = 'trace_api' then
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
        -- L-32: a lazy expiry lands only before consent minted the session id.
        if old.session_id is not null or new.session_id is not null then
          raise exception 'TRACE_GUARD: an invitation with a session cannot expire' using errcode = '42501';
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
    -- The mirror sets submitted only, from any non-terminal state, once the sessions row exists (L-35).
    if new.session_id is distinct from old.session_id or new.started_at is distinct from old.started_at
      or new.adult_self_declared is distinct from old.adult_self_declared
      or new.age_block_source is distinct from old.age_block_source
      or new.status is distinct from 'submitted' then
      raise exception 'TRACE_GUARD: the mirror may only set submitted' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.sessions as s where s.org_id = new.org_id and s.invitation_id = new.id
    ) then
      raise exception 'TRACE_GUARD: submitted needs the sessions row' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'TRACE_GUARD: this role cannot change an invitation' using errcode = '42501';
end
$$;
revoke execute on function private.invitations_guard() from public, anon, authenticated, service_role;

create function private.invitations_audit()
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
      jsonb_build_object('old_status', old.status), new.workspace_id);
  end if;
  return null;
end
$$;
revoke execute on function private.invitations_audit() from public, anon, authenticated, service_role;

create trigger invitations_label before insert on public.invitations
  for each row execute function private.invitations_label();
create trigger invitations_guard before update on public.invitations
  for each row execute function private.invitations_guard();
create trigger invitations_audit after insert or update on public.invitations
  for each row execute function private.invitations_audit();
alter table public.invitations enable always trigger invitations_label;
alter table public.invitations enable always trigger invitations_guard;

-- consents: BEFORE INSERT guard (age before consent, rule 9; otp_verified; pinned notice) ------------
create function private.consents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.invitation_status;
  v_inviter boolean;
  v_self boolean;
  v_ws uuid;
  v_test uuid;
  v_tv uuid;
  v_notice uuid;
begin
  if current_setting('role') is distinct from 'trace_api' then
    raise exception 'TRACE_GUARD: consents are recorded by the api only' using errcode = '42501';
  end if;
  -- The org comes first: without it, the replay no-op below would tell an api call scoped to no org (or another org)
  -- whether a consent exists (lead fix 2026-10-14, rls_d1_api "api without an api org cannot insert").
  if new.org_id is distinct from (select private.api_org_id()) then
    raise exception 'TRACE_GUARD: the consent is outside the api org' using errcode = '42501';
  end if;
  -- A replayed consent (double click, retry) is a no-op at any later step: the api re-reads the stored row.
  if exists (
    select 1 from public.consents as c
    where c.org_id = new.org_id and c.invitation_id = new.invitation_id and c.event = new.event
  ) then
    return null;
  end if;
  -- FOR SHARE: a concurrent status change (NO KEY UPDATE) waits for this insert.
  select i.status, i.adult_confirmed_by_inviter, i.adult_self_declared, i.workspace_id, i.test_id, i.test_version_id
    into v_status, v_inviter, v_self, v_ws, v_test, v_tv
  from public.invitations as i where i.org_id = new.org_id and i.id = new.invitation_id for share;
  if not found then
    raise exception 'TRACE_GUARD: invitation not found' using errcode = '23503';
  end if;
  if v_status <> 'otp_verified' then
    raise exception 'TRACE_GUARD: consent needs an otp_verified invitation' using errcode = '42501';
  end if;
  if v_inviter is false or v_self is not true then
    raise exception 'TRACE_GUARD: consent needs both adult answers' using errcode = '42501';
  end if;
  select v.notice_version_id into v_notice
  from public.test_versions as v where v.org_id = new.org_id and v.id = v_tv;
  if new.notice_version_id is distinct from v_notice then
    raise exception 'TRACE_GUARD: consent uses the pinned notice of the test version' using errcode = '42501';
  end if;
  new.workspace_id := v_ws;
  new.test_id := v_test;
  new.occurred_at := now();
  return new;
end
$$;
revoke execute on function private.consents_guard() from public, anon, authenticated, service_role;

-- consents: append-only for every role including the owner (the audit_log recipe) -------------------
create function private.consents_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'TRACE_APPEND_ONLY' using errcode = 'P0001';
end
$$;
revoke execute on function private.consents_append_only() from public, anon, authenticated, service_role;

create trigger consents_guard before insert on public.consents
  for each row execute function private.consents_guard();
create trigger consents_append_only before update or delete on public.consents
  for each row execute function private.consents_append_only();
create trigger consents_no_truncate before truncate on public.consents
  for each statement execute function private.consents_append_only();
alter table public.consents enable always trigger consents_guard;
alter table public.consents enable always trigger consents_append_only;
alter table public.consents enable always trigger consents_no_truncate;

-- sessions: guard (rule 9 gate, scoping copy, set-once, forward-only state and mirror_seq) ----------
create function private.sessions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.invitation_status;
  v_inviter boolean;
  v_self boolean;
  v_ws uuid;
  v_test uuid;
begin
  if current_setting('role') is distinct from 'trace_worker' then
    raise exception 'TRACE_GUARD: sessions are written by the mirror only' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    select i.status, i.adult_confirmed_by_inviter, i.adult_self_declared, i.workspace_id, i.test_id
      into v_status, v_inviter, v_self, v_ws, v_test
    from public.invitations as i where i.org_id = new.org_id and i.id = new.invitation_id for share;
    if not found then
      raise exception 'TRACE_GUARD: invitation not found' using errcode = '23503';
    end if;
    if v_status in ('blocked_age', 'expired', 'revoked') then
      raise exception 'TRACE_GUARD: no session for a blocked, expired or revoked invitation' using errcode = '42501';
    end if;
    -- Rule 9: both adult answers (the consent guard already required them; checked again here).
    if v_inviter is false or v_self is not true then
      raise exception 'TRACE_GUARD: a session needs both adult answers' using errcode = '42501';
    end if;
    new.workspace_id := v_ws;
    new.test_id := v_test;
    return new;
  end if;

  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.workspace_id is distinct from old.workspace_id or new.test_id is distinct from old.test_id
    or new.test_version_id is distinct from old.test_version_id
    or new.ruleset_version_id is distinct from old.ruleset_version_id
    or new.invitation_id is distinct from old.invitation_id or new.consent_id is distinct from old.consent_id
    or new.adult_confirmed_at_start is distinct from old.adult_confirmed_at_start
    or new.started_at is distinct from old.started_at or new.server_deadline_at is distinct from old.server_deadline_at
    or new.receipt_ref is distinct from old.receipt_ref or new.created_at is distinct from old.created_at
    or (old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at)
    or (old.submit_kind is not null and new.submit_kind is distinct from old.submit_kind) then
    raise exception 'TRACE_GUARD: session pins, times and receipt are set once' using errcode = '42501';
  end if;
  if old.state <> 'in_progress' and new.state is distinct from old.state then
    raise exception 'TRACE_GUARD: a submitted session is terminal' using errcode = '42501';
  end if;
  -- Forward-only: every update carries a higher mirror_seq (equal or lower is refused here; mirror_session turns it
  -- into 'duplicate' before it reaches the table).
  if new.mirror_seq <= old.mirror_seq then
    raise exception 'TRACE_GUARD: mirror_seq moves forward only' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.sessions_guard() from public, anon, authenticated, service_role;

create trigger sessions_guard before insert or update on public.sessions
  for each row execute function private.sessions_guard();
alter table public.sessions enable always trigger sessions_guard;

-- session_items: insert-only; the item belongs to the session's test version ------------------------
create function private.session_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tv uuid;
  v_ws uuid;
  v_test uuid;
  v_item_tv uuid;
  v_section uuid;
begin
  if tg_op = 'UPDATE' then
    raise exception 'TRACE_GUARD: session items are insert-only' using errcode = '42501';
  end if;
  if current_setting('role') is distinct from 'trace_worker' then
    raise exception 'TRACE_GUARD: session items are written by the mirror only' using errcode = '42501';
  end if;
  select s.test_version_id, s.workspace_id, s.test_id into v_tv, v_ws, v_test
  from public.sessions as s where s.org_id = new.org_id and s.id = new.session_id;
  if not found then
    raise exception 'TRACE_GUARD: session not found' using errcode = '23503';
  end if;
  select i.test_version_id, i.section_id into v_item_tv, v_section
  from public.item_versions as i where i.org_id = new.org_id and i.id = new.item_version_id;
  if not found then
    raise exception 'TRACE_GUARD: item version not found' using errcode = '23503';
  end if;
  if v_item_tv is distinct from v_tv then
    raise exception 'TRACE_GUARD: the item belongs to another test version' using errcode = '42501';
  end if;
  if new.section_id is not null and new.section_id is distinct from v_section then
    raise exception 'TRACE_GUARD: the item belongs to another section' using errcode = '42501';
  end if;
  new.section_id := v_section;
  new.workspace_id := v_ws;
  new.test_id := v_test;
  return new;
end
$$;
revoke execute on function private.session_items_guard() from public, anon, authenticated, service_role;

create trigger session_items_guard before insert or update on public.session_items
  for each row execute function private.session_items_guard();
alter table public.session_items enable always trigger session_items_guard;

-- responses: insert-only; the answer kind matches the item format ----------------------------------
create function private.responses_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_format public.section_format;
begin
  if tg_op = 'UPDATE' then
    raise exception 'TRACE_GUARD: responses are insert-only' using errcode = '42501';
  end if;
  if current_setting('role') is distinct from 'trace_worker' then
    raise exception 'TRACE_GUARD: responses are written by the mirror only' using errcode = '42501';
  end if;
  select i.format into v_format
  from public.session_items as si
  join public.item_versions as i on i.org_id = si.org_id and i.id = si.item_version_id
  where si.org_id = new.org_id and si.id = new.session_item_id and si.session_id = new.session_id;
  if not found then
    raise exception 'TRACE_GUARD: session item not found' using errcode = '23503';
  end if;
  if (v_format = 'written') is distinct from (new.answer_kind = 'text') then
    raise exception 'TRACE_GUARD: the answer kind does not match the item format' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.responses_guard() from public, anon, authenticated, service_role;

create trigger responses_guard before insert or update on public.responses
  for each row execute function private.responses_guard();
alter table public.responses enable always trigger responses_guard;

-- media_objects: insert-only; deterministic key media/{org}/{session}/start_photo.jpg (D1-5) ---------
create function private.media_objects_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_test uuid;
begin
  if tg_op = 'UPDATE' then
    raise exception 'TRACE_GUARD: media objects are insert-only' using errcode = '42501';
  end if;
  if current_setting('role') is distinct from 'trace_worker' then
    raise exception 'TRACE_GUARD: media objects are written by the mirror only' using errcode = '42501';
  end if;
  select s.workspace_id, s.test_id into v_ws, v_test
  from public.sessions as s where s.org_id = new.org_id and s.id = new.session_id;
  if not found then
    raise exception 'TRACE_GUARD: session not found' using errcode = '23503';
  end if;
  if new.r2_key is distinct from ('media/' || new.org_id::text || '/' || new.session_id::text || '/start_photo.jpg') then
    raise exception 'TRACE_GUARD: the media key does not match its org and session' using errcode = '42501';
  end if;
  new.workspace_id := v_ws;
  new.test_id := v_test;
  return new;
end
$$;
revoke execute on function private.media_objects_guard() from public, anon, authenticated, service_role;

create trigger media_objects_guard before insert or update on public.media_objects
  for each row execute function private.media_objects_guard();
alter table public.media_objects enable always trigger media_objects_guard;

-- ---------------------------------------------------------------------------------------------
-- Functions for the api and the mirror (spec §3.4)
-- ---------------------------------------------------------------------------------------------

-- The only token-hash lookup (cross-org by an unguessable 256-bit token's SHA-256). Returns at most one row and only
-- the listed columns; never the contact, label or hash. Reads public.invitations only.
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
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.org_id, i.id, i.status, i.candidate_id, i.session_id, i.started_at, i.test_id, i.test_version_id,
    i.expires_at
  from public.invitations as i
  where p_hash ~ '^[0-9a-f]{64}$'
    and i.link_token_hash = p_hash
$$;
revoke execute on function private.resolve_invitation_by_hash(text) from public, anon, authenticated, service_role;
grant execute on function private.resolve_invitation_by_hash(text) to trace_api;

-- The mirror stage (§3.4, §5.1, §10-DB). INVOKER: it runs with trace_worker's grants and RLS, and every trigger
-- above still fires. One transaction (the caller's): session -> items -> responses -> media -> invitation submitted
-- -> idempotency key. Writes no consent and no signal. Returns 'stored', 'duplicate' (the session_mirror key exists,
-- or the stored mirror_seq is >= the message's) or 'dead_invitation' (revoked / expired / blocked_age: nothing
-- stored, the job dead-letters it). The public.reports row (both card FKs null) is added by migration 3, which
-- creates that table and re-creates this function (NOTES D-1).
--
-- p_msg is the SessionMirrorMessage (§4.4) plus one key added by the job from the hash-checked R2 final.json:
--   responses: [{itemVersionId, kind: 'text'|'choice', text?, choice?, sha256, finalSeq}]   (NOTES Q-3)
create function private.mirror_session(p_org_id uuid, p_msg jsonb)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_session uuid;
  v_invitation uuid;
  v_tv uuid;
  v_rs uuid;
  v_consent uuid;
  v_seq int;
  v_state text;
  v_key text;
  v_submitted timestamptz;
  v_inv_status public.invitation_status;
  v_inv_session uuid;
  v_inviter boolean;
  v_self boolean;
  v_stored_seq int;
  v_photo jsonb;
  v_el jsonb;
  v_si uuid;
begin
  if p_org_id is null or p_org_id is distinct from (select private.job_org_id()) then
    raise exception 'TRACE_GUARD: the mirror org is not the job org' using errcode = '42501';
  end if;
  if jsonb_typeof(p_msg) is distinct from 'object' or p_msg ->> 'v' is distinct from '1'
    or p_msg ->> 'jobKind' is distinct from 'session_mirror' then
    raise exception 'TRACE_BAD_MIRROR: not a v1 session_mirror message' using errcode = '22023';
  end if;
  v_session := (p_msg ->> 'sessionId')::uuid;
  v_invitation := (p_msg ->> 'invitationId')::uuid;
  v_tv := (p_msg ->> 'testVersionId')::uuid;
  v_rs := (p_msg ->> 'rulesetVersionId')::uuid;
  v_consent := (p_msg ->> 'consentId')::uuid;
  v_seq := (p_msg ->> 'mirrorSeq')::int;
  v_state := p_msg ->> 'state';
  v_submitted := (p_msg ->> 'submittedAt')::timestamptz;
  if (p_msg ->> 'orgId')::uuid is distinct from p_org_id then
    raise exception 'TRACE_BAD_MIRROR: orgId differs from the job org' using errcode = '22023';
  end if;
  if v_session is null or v_invitation is null or v_tv is null or v_rs is null or v_consent is null
    or v_seq is null or v_seq < 1 or v_submitted is null or v_state is null
    or v_state not in ('submitted', 'auto_submitted') then
    raise exception 'TRACE_BAD_MIRROR: missing or invalid field' using errcode = '22023';
  end if;
  v_key := v_session::text || ':session_mirror:' || v_rs::text;
  if p_msg ->> 'jobKey' is distinct from v_key then
    raise exception 'TRACE_BAD_MIRROR: jobKey is not session:session_mirror:ruleset' using errcode = '22023';
  end if;
  v_photo := p_msg -> 'photo';
  if (coalesce(jsonb_typeof(v_photo), 'null') = 'null') = (coalesce(jsonb_typeof(p_msg -> 'photoSkippedReason'), 'null') = 'null') then
    raise exception 'TRACE_BAD_MIRROR: exactly one of photo and photoSkippedReason' using errcode = '22023';
  end if;

  -- Serialise mirrors of one invitation: a concurrent duplicate waits here and then sees the committed rows.
  select i.status, i.session_id, i.adult_confirmed_by_inviter, i.adult_self_declared
    into v_inv_status, v_inv_session, v_inviter, v_self
  from public.invitations as i where i.org_id = p_org_id and i.id = v_invitation for update;
  if not found then
    raise exception 'TRACE_GUARD: invitation not found' using errcode = '23503';
  end if;

  if exists (
    select 1 from public.idempotency_keys as k
    where k.org_id = p_org_id and k.scope = 'session_mirror' and k.key = v_key
  ) then
    return 'duplicate';
  end if;
  select s.mirror_seq into v_stored_seq from public.sessions as s where s.org_id = p_org_id and s.id = v_session;
  if v_stored_seq is not null and v_seq <= v_stored_seq then
    return 'duplicate';
  end if;
  if v_inv_status in ('revoked', 'expired', 'blocked_age') then
    return 'dead_invitation';
  end if;
  if v_inv_session is distinct from v_session then
    raise exception 'TRACE_GUARD: the session is not the invitation''s session' using errcode = '42501';
  end if;

  if v_stored_seq is null then
    insert into public.sessions (
      id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, submit_kind,
      adult_confirmed_at_start, started_at, server_deadline_at, submitted_at, mirror_seq, receipt_ref
    ) values (
      v_session, p_org_id, v_tv, v_rs, v_invitation, v_consent, v_state,
      case v_state when 'submitted' then 'candidate' else 'deadline' end,
      (v_self is true and v_inviter is not false),
      (p_msg ->> 'startedAt')::timestamptz, (p_msg ->> 'deadlineAt')::timestamptz, v_submitted, v_seq,
      p_msg ->> 'receiptRef'
    );
  else
    -- A later mirror (M3a; D1 sends mirrorSeq 1 only): forward-only, the guard checks the rest.
    update public.sessions as s
      set state = v_state,
        submit_kind = case v_state when 'submitted' then 'candidate' else 'deadline' end,
        submitted_at = v_submitted,
        mirror_seq = v_seq
      where s.org_id = p_org_id and s.id = v_session;
  end if;

  for v_el in select e from jsonb_array_elements(coalesce(p_msg -> 'served', '[]'::jsonb)) as e loop
    insert into public.session_items (org_id, session_id, item_version_id, position, served_at)
      values (p_org_id, v_session, (v_el ->> 'itemVersionId')::uuid, (v_el ->> 'position')::int,
        (v_el ->> 'servedAt')::timestamptz)
      on conflict do nothing;
  end loop;

  for v_el in select e from jsonb_array_elements(coalesce(p_msg -> 'responses', '[]'::jsonb)) as e loop
    select si.id into v_si
    from public.session_items as si
    where si.org_id = p_org_id and si.session_id = v_session and si.item_version_id = (v_el ->> 'itemVersionId')::uuid;
    if not found then
      raise exception 'TRACE_BAD_MIRROR: a response names an item that was not served' using errcode = '22023';
    end if;
    insert into public.responses (
      org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at
    ) values (
      p_org_id, v_session, v_si, v_el ->> 'kind', v_el ->> 'text', v_el ->> 'choice', v_el ->> 'sha256',
      (v_el ->> 'finalSeq')::int, v_submitted
    )
    on conflict do nothing;
  end loop;

  if jsonb_typeof(v_photo) = 'object' then
    insert into public.media_objects (org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device)
      values (p_org_id, v_session, 'start_photo', v_photo ->> 'key', v_photo ->> 'sha256',
        (v_photo ->> 'bytes')::int, v_photo ->> 'mime', (v_photo ->> 'blurredOnDevice')::boolean)
      on conflict do nothing;
  end if;

  update public.invitations as i
    set status = 'submitted'
    where i.org_id = p_org_id and i.id = v_invitation and i.status <> 'submitted';

  insert into public.idempotency_keys (org_id, scope, key, result_ref, expires_at)
    values (p_org_id, 'session_mirror', v_key, v_session::text, v_submitted + interval '90 days')
    on conflict do nothing;
  return 'stored';
end
$$;
revoke execute on function private.mirror_session(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.mirror_session(uuid, jsonb) to trace_worker;

-- ---------------------------------------------------------------------------------------------
-- Grants and policies (§3.3). One policy per operation per role set, all `to <role>`; nothing for anon or the
-- candidate roles; HM is excluded by the helper role lists.
--   staff arm    = owner / admin / recruiter inside their workspaces (workspace_id is copied by trigger, L-27)
--   reviewer arm = tests assigned to the reviewer (S*)
--   workers      = org_id = private.job_org_id(); trace_api = org_id = private.api_org_id()
-- ---------------------------------------------------------------------------------------------

-- invitations. link_token_hash is never selectable by any role (only resolve_invitation_by_hash reaches it).
grant select (id, org_id, workspace_id, test_id, test_version_id, candidate_id, session_id, started_at, candidate_label,
  contact_email, adult_confirmed_by_inviter, adult_self_declared, age_block_source, status, expires_at, created_by,
  created_at) on public.invitations to authenticated, trace_api;
grant insert (org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at)
  on public.invitations to authenticated;
grant update (status) on public.invitations to authenticated;
grant update (status, adult_self_declared, age_block_source, session_id, started_at) on public.invitations to trace_api;
-- The mirror needs ids, pins, status and the adult answers; not the contact or the hash.
grant select (id, org_id, workspace_id, test_id, test_version_id, candidate_id, session_id, started_at,
  adult_confirmed_by_inviter, adult_self_declared, age_block_source, status, expires_at)
  on public.invitations to trace_worker;
grant update (status) on public.invitations to trace_worker;
create policy invitations_select_staff on public.invitations for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy invitations_select_reviewer on public.invitations for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy invitations_insert_staff on public.invitations for insert to authenticated
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
-- Revoke only (R-14): USING admits created/sent rows; WITH CHECK carries the role arm only; the guard owns the rest.
create policy invitations_update_staff on public.invitations for update to authenticated
  using (
    status in ('created', 'sent')
    and workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[])
  )
  with check (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy invitations_select_worker on public.invitations for select to trace_worker
  using (org_id = (select private.job_org_id()));
create policy invitations_update_worker on public.invitations for update to trace_worker
  using (org_id = (select private.job_org_id()))
  with check (org_id = (select private.job_org_id()));
create policy invitations_select_api on public.invitations for select to trace_api
  using (org_id = (select private.api_org_id()));
create policy invitations_update_api on public.invitations for update to trace_api
  using (org_id = (select private.api_org_id()))
  with check (org_id = (select private.api_org_id()));

-- consents (append-only: no UPDATE/DELETE/TRUNCATE for anyone, the owner included). Unlike audit_log, consents is
-- referenced by an FK (sessions -> consents), and the FK check runs `SELECT ... FOR KEY SHARE` on consents as its owner,
-- which needs UPDATE on at least one column. So the owner keeps a column-level UPDATE on `id` only; any UPDATE still
-- hits consents_append_only (ENABLE ALWAYS) and raises TRACE_APPEND_ONLY (NOTES D-3).
revoke update, delete, truncate on public.consents from postgres;
grant update (id) on public.consents to postgres;
grant select on public.consents to authenticated, trace_worker, trace_api;
-- id and occurred_at are the api's own (decided 2026-10-14, NOTES D-18/Q-7): a server-chosen uuid is a deterministic key
-- for at-least-once api retries, and occurred_at is the server's consent time. Only trace_api inserts.
grant insert (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language,
  event, occurred_at) on public.consents to trace_api;
create policy consents_select_staff on public.consents for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy consents_select_reviewer on public.consents for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy consents_select_worker on public.consents for select to trace_worker
  using (org_id = (select private.job_org_id()));
create policy consents_select_api on public.consents for select to trace_api
  using (org_id = (select private.api_org_id()));
create policy consents_insert_api on public.consents for insert to trace_api
  with check (org_id = (select private.api_org_id()));

-- sessions
grant select on public.sessions to authenticated, trace_worker, trace_integrity_worker;
-- §3.3 note 5: the quality worker reads id, org, version ids and state.
grant select (id, org_id, test_version_id, ruleset_version_id, state) on public.sessions to trace_quality_worker;
-- workspace_id and test_id may be supplied (tests NOTES 8), but sessions_guard always overwrites them from the test
-- version, so a supplied value never sticks.
grant insert (id, org_id, workspace_id, test_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state,
  submit_kind, adult_confirmed_at_start, started_at, server_deadline_at, submitted_at, mirror_seq, receipt_ref)
  on public.sessions to trace_worker;
grant update (state, submit_kind, submitted_at, mirror_seq) on public.sessions to trace_worker;
create policy sessions_select_staff on public.sessions for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy sessions_select_reviewer on public.sessions for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy sessions_select_worker on public.sessions for select to trace_worker
  using (org_id = (select private.job_org_id()));
create policy sessions_insert_worker on public.sessions for insert to trace_worker
  with check (org_id = (select private.job_org_id()));
create policy sessions_update_worker on public.sessions for update to trace_worker
  using (org_id = (select private.job_org_id()))
  with check (org_id = (select private.job_org_id()));
create policy sessions_select_quality_worker on public.sessions for select to trace_quality_worker
  using (org_id = (select private.job_org_id()));
create policy sessions_select_integrity_worker on public.sessions for select to trace_integrity_worker
  using (org_id = (select private.job_org_id()));

-- session_items
grant select on public.session_items to authenticated, trace_worker, trace_quality_worker;
-- The worker supplies id on its child rows (decided 2026-10-14): deterministic ids keep the at-least-once mirror
-- exactly-once (CLAUDE.md engineering rules).
grant insert (id, org_id, session_id, section_id, item_version_id, position, served_at)
  on public.session_items to trace_worker;
create policy session_items_select_staff on public.session_items for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy session_items_select_reviewer on public.session_items for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy session_items_select_worker on public.session_items for select to trace_worker
  using (org_id = (select private.job_org_id()));
create policy session_items_insert_worker on public.session_items for insert to trace_worker
  with check (org_id = (select private.job_org_id()));
create policy session_items_select_quality_worker on public.session_items for select to trace_quality_worker
  using (org_id = (select private.job_org_id()));

-- responses (no app-role grant in D1, R-8)
grant select on public.responses to trace_worker, trace_quality_worker;
grant insert (id, org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256,
  final_seq, submitted_at) on public.responses to trace_worker;
create policy responses_select_worker on public.responses for select to trace_worker
  using (org_id = (select private.job_org_id()));
create policy responses_insert_worker on public.responses for insert to trace_worker
  with check (org_id = (select private.job_org_id()));
create policy responses_select_quality_worker on public.responses for select to trace_quality_worker
  using (org_id = (select private.job_org_id()));

-- media_objects (app roles read metadata without r2_key / sha256)
grant select (id, org_id, workspace_id, test_id, session_id, kind, bytes, mime, blurred_on_device, upload_state,
  created_at) on public.media_objects to authenticated;
grant select on public.media_objects to trace_worker;
-- upload_state is pinned to 'uploaded' by its CHECK, so supplying it changes nothing.
grant insert (id, org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device, upload_state)
  on public.media_objects to trace_worker;
create policy media_objects_select_staff on public.media_objects for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy media_objects_select_reviewer on public.media_objects for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy media_objects_select_worker on public.media_objects for select to trace_worker
  using (org_id = (select private.job_org_id()));
create policy media_objects_insert_worker on public.media_objects for insert to trace_worker
  with check (org_id = (select private.job_org_id()));

-- idempotency_keys (L-20, §3.3 note 7): drop the four literal-true M0b policies, revoke UPDATE and DELETE from
-- trace_worker, then give each worker role INSERT and SELECT bound to job_org_id() and to its own job's scope.
drop policy idempotency_keys_select_worker on public.idempotency_keys;
drop policy idempotency_keys_insert_worker on public.idempotency_keys;
drop policy idempotency_keys_update_worker on public.idempotency_keys;
drop policy idempotency_keys_delete_worker on public.idempotency_keys;
revoke update, delete on public.idempotency_keys from trace_worker;
grant select, insert on public.idempotency_keys to trace_worker, trace_quality_worker, trace_integrity_worker;
create policy idempotency_keys_select_mirror_worker on public.idempotency_keys for select to trace_worker
  using (scope = 'session_mirror' and org_id = (select private.job_org_id()));
create policy idempotency_keys_insert_mirror_worker on public.idempotency_keys for insert to trace_worker
  with check (scope = 'session_mirror' and org_id = (select private.job_org_id()));
create policy idempotency_keys_select_quality_worker on public.idempotency_keys for select to trace_quality_worker
  using (scope = 'quality_score' and org_id = (select private.job_org_id()));
create policy idempotency_keys_insert_quality_worker on public.idempotency_keys for insert to trace_quality_worker
  with check (scope = 'quality_score' and org_id = (select private.job_org_id()));
create policy idempotency_keys_select_integrity_worker on public.idempotency_keys for select to trace_integrity_worker
  using (scope = 'integrity_band' and org_id = (select private.job_org_id()));
create policy idempotency_keys_insert_integrity_worker on public.idempotency_keys for insert to trace_integrity_worker
  with check (scope = 'integrity_band' and org_id = (select private.job_org_id()));
