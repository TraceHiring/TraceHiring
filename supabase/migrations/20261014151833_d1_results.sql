-- D1 migration 3 of 4 (spec specs/d1-demo-slice.md §3.1 row 3, §3.2 results and read-model cards, §3.3, §3.4, §3.7;
-- decisions R-1, R-2, R-5, L-3, L-4, L-5, L-7, L-8, L-14, L-18, L-27, L-28, L-33, L-34, L-36).
-- The two internal schemas (quality.*, integrity.*), the per-worker read-model cards in public, the report pointer,
-- the org seed (notice, band rules v1, default rubric), the L-8 trigger on test_versions (it reads integrity.*, so it
-- lives here, L-34), private.sweep_pending (L-18) and mirror_session's reports row (m2 draft NOTES D-1).
--
-- Error contract (same as migrations 1-2; the rls_d1_* tests rely on it):
--   guard / freeze / set-once refusal   SQLSTATE 42501, message 'TRACE_GUARD: <reason>'
--   append-only table                    SQLSTATE P0001, message 'TRACE_APPEND_ONLY'
--   missing parent row                   SQLSTATE 23503, message 'TRACE_GUARD: <parent> not found'
--
-- Rule 1 wall: no function, trigger, policy or constraint here names both quality.* and integrity.*. Org roles read
-- only the public cards. The integrity side reads one boolean of the quality card (public.quality_cards.meets_cutoff),
-- never quality.*. public.reports references the public cards only.

-- ---------------------------------------------------------------------------------------------
-- integrity.band and the rule-table validator (§3.2, §5.2 Rule shape, rule 3)
-- ---------------------------------------------------------------------------------------------
create type integrity.band as enum ('clear', 'review', 'strong_concern', 'insufficient_evidence');

-- True iff p_rules is exactly the §5.2 Rule shape: an array of 1-50 objects with known keys only, a unique non-empty id,
-- kinds a non-empty array of strings, family one of p_families, tier T1-T3, severity soft/medium/hard, validated a
-- boolean, where an object, minDurationMs a non-negative number, and untrusted / rawMedia booleans on T3 rules only
-- (rule 3: the only two ways a T3 signal can reach Strong concern).
create function integrity.rule_table_valid(p_rules jsonb, p_families text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case
      when jsonb_typeof(p_rules) = 'array' and jsonb_array_length(p_rules) between 1 and 50 then
        not exists (
          select 1
          from jsonb_array_elements(p_rules) as r
          where jsonb_typeof(r) is distinct from 'object'
            or exists (
              select 1 from jsonb_object_keys(r) as k
              where k not in ('id', 'kinds', 'where', 'minDurationMs', 'family', 'tier', 'severity', 'validated',
                'untrusted', 'rawMedia')
            )
            or jsonb_typeof(r -> 'id') is distinct from 'string'
            or char_length(r ->> 'id') not between 1 and 64
            or jsonb_typeof(r -> 'kinds') is distinct from 'array'
            or jsonb_array_length(r -> 'kinds') < 1
            or exists (select 1 from jsonb_array_elements(r -> 'kinds') as kd where jsonb_typeof(kd) <> 'string')
            or jsonb_typeof(r -> 'family') is distinct from 'string'
            or not ((r ->> 'family') = any (p_families))
            or (r ->> 'tier') is null or (r ->> 'tier') not in ('T1', 'T2', 'T3')
            or (r ->> 'severity') is null or (r ->> 'severity') not in ('soft', 'medium', 'hard')
            or jsonb_typeof(r -> 'validated') is distinct from 'boolean'
            or (r ? 'where' and jsonb_typeof(r -> 'where') is distinct from 'object')
            or (r ? 'minDurationMs' and (jsonb_typeof(r -> 'minDurationMs') is distinct from 'number'
              or (r ->> 'minDurationMs')::numeric < 0))
            or (r ? 'untrusted' and (jsonb_typeof(r -> 'untrusted') is distinct from 'boolean' or r ->> 'tier' <> 'T3'))
            or (r ? 'rawMedia' and (jsonb_typeof(r -> 'rawMedia') is distinct from 'boolean' or r ->> 'tier' <> 'T3'))
        )
        and (select count(*) from jsonb_array_elements(p_rules) as r)
          = (select count(distinct r ->> 'id') from jsonb_array_elements(p_rules) as r)
      else false
    end,
    false
  )
$$;
revoke execute on function integrity.rule_table_valid(jsonb, text[]) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- integrity.band_rule_versions (immutable always; written only by private.seed_org_defaults, R-5)
-- ---------------------------------------------------------------------------------------------
create table integrity.band_rule_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  version_no int not null check (version_no >= 1),
  families text[] not null check (cardinality(families) between 1 and 8),
  coverage_floor_permille smallint not null check (coverage_floor_permille between 0 and 1000),
  coverage_photo_missing_factor_permille smallint not null
    check (coverage_photo_missing_factor_permille between 0 and 1000),
  rules jsonb not null check (integrity.rule_table_valid(rules, families)),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, version_no)
);
alter table integrity.band_rule_versions enable row level security;

create function private.band_rule_versions_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'TRACE_GUARD: band rule versions are immutable' using errcode = '42501';
end
$$;
revoke execute on function private.band_rule_versions_freeze() from public, anon, authenticated, service_role;
create trigger band_rule_versions_freeze before update or delete on integrity.band_rule_versions
  for each row execute function private.band_rule_versions_freeze();
create trigger band_rule_versions_no_truncate before truncate on integrity.band_rule_versions
  for each statement execute function private.band_rule_versions_freeze();
alter table integrity.band_rule_versions enable always trigger band_rule_versions_freeze;
alter table integrity.band_rule_versions enable always trigger band_rule_versions_no_truncate;

-- L-33: the ruleset's rule table is the org's own.
alter table public.ruleset_versions
  add constraint ruleset_versions_band_rule_fk foreign key (org_id, band_rule_version_id)
  references integrity.band_rule_versions (org_id, id) on delete restrict;
create index ruleset_versions_band_rule_idx on public.ruleset_versions (org_id, band_rule_version_id);

-- ---------------------------------------------------------------------------------------------
-- Shared append-only trigger function for the result ledgers (MT-15; I-10)
-- ---------------------------------------------------------------------------------------------
create function private.results_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'TRACE_APPEND_ONLY' using errcode = 'P0001';
end
$$;
revoke execute on function private.results_append_only() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- quality.scores (internal source; trace_quality_worker insert-only; immutable)
-- ---------------------------------------------------------------------------------------------
create table quality.scores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  session_id uuid not null,
  test_version_id uuid not null,
  score smallint not null check (score between 0 and 100),
  section_scores jsonb not null check (jsonb_typeof(section_scores) = 'array' and octet_length(section_scores::text) <= 4096),
  quality_cutoff smallint not null check (quality_cutoff between 0 and 100),
  meets_cutoff boolean not null,
  scoring_version text not null check (char_length(scoring_version) between 1 and 64),
  rubric_set_sha256 text not null check (rubric_set_sha256 ~ '^[0-9a-f]{64}$'),
  rubric_version_ids uuid[] not null default '{}' check (cardinality(rubric_version_ids) <= 20),
  grader_model_id text not null check (char_length(grader_model_id) between 1 and 64),
  grader_adapter_version text not null check (char_length(grader_adapter_version) between 1 and 64),
  computed_at timestamptz not null,
  unique (org_id, id),
  unique (org_id, id, session_id),
  unique (org_id, session_id, scoring_version),
  check (meets_cutoff = (score >= quality_cutoff)),
  foreign key (org_id, session_id) references public.sessions (org_id, id) on delete restrict,
  foreign key (org_id, test_version_id) references public.test_versions (org_id, id) on delete restrict
);
alter table quality.scores enable row level security;

-- The cutoff and the version are the session's pinned ones (I-4); a score never changes.
create function private.quality_scores_pin_cutoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tv uuid;
  v_cutoff smallint;
begin
  if tg_op <> 'INSERT' then
    raise exception 'TRACE_GUARD: a quality score is immutable' using errcode = '42501';
  end if;
  select s.test_version_id, v.quality_cutoff into v_tv, v_cutoff
  from public.sessions as s
  join public.test_versions as v on v.org_id = s.org_id and v.id = s.test_version_id
  where s.org_id = new.org_id and s.id = new.session_id;
  if not found then
    raise exception 'TRACE_GUARD: session not found' using errcode = '23503';
  end if;
  if new.test_version_id is distinct from v_tv then
    raise exception 'TRACE_GUARD: the score names another test version than the session' using errcode = '42501';
  end if;
  if new.quality_cutoff is distinct from v_cutoff then
    raise exception 'TRACE_GUARD: the cutoff is not the pinned test version cutoff' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.quality_scores_pin_cutoff() from public, anon, authenticated, service_role;
create trigger quality_scores_pin_cutoff before insert or update or delete on quality.scores
  for each row execute function private.quality_scores_pin_cutoff();
alter table quality.scores enable always trigger quality_scores_pin_cutoff;

-- ---------------------------------------------------------------------------------------------
-- quality.grader_runs (append-only; trace_quality_worker)
-- ---------------------------------------------------------------------------------------------
create table quality.grader_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  session_id uuid not null,
  session_item_id uuid not null,
  pass_no smallint not null default 1 check (pass_no >= 1),
  grader_kind text not null check (grader_kind in ('mcq_key', 'llm')),
  model_id text not null check (char_length(model_id) between 1 and 64),
  adapter_version text not null check (char_length(adapter_version) between 1 and 64),
  rubric_version_id uuid null,
  raw_score numeric(5, 4) not null check (raw_score between 0 and 1),
  criteria jsonb not null default '{}' check (jsonb_typeof(criteria) in ('object', 'array') and octet_length(criteria::text) <= 4096),
  computed_at timestamptz not null,
  unique (org_id, id),
  unique nulls not distinct (org_id, session_item_id, rubric_version_id, model_id, pass_no),
  foreign key (org_id, session_item_id, session_id) references public.session_items (org_id, id, session_id) on delete restrict,
  foreign key (org_id, rubric_version_id) references public.rubric_versions (org_id, id) on delete restrict
);
create index grader_runs_session_idx on quality.grader_runs (org_id, session_id);
alter table quality.grader_runs enable row level security;
revoke update, delete, truncate on quality.grader_runs from postgres;
create trigger grader_runs_append_only before update or delete on quality.grader_runs
  for each row execute function private.results_append_only();
create trigger grader_runs_no_truncate before truncate on quality.grader_runs
  for each statement execute function private.results_append_only();
alter table quality.grader_runs enable always trigger grader_runs_append_only;
alter table quality.grader_runs enable always trigger grader_runs_no_truncate;

-- ---------------------------------------------------------------------------------------------
-- integrity.signals (append-only; keyed by the session-global gseq, L-14; unpartitioned in D1, L-36)
-- ---------------------------------------------------------------------------------------------
create table integrity.signals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  session_id uuid not null,
  seq int not null check (seq >= 0),
  kind text not null
    check (kind in ('paste', 'drop', 'untrusted_input', 'tab_hidden', 'fullscreen_exit', 'connectivity_gap')),
  offset_ms int not null check (offset_ms >= 0),
  item_position int null check (item_position is null or item_position >= 1),
  details jsonb not null default '{}' check (
    jsonb_typeof(details) = 'object'
    and octet_length(details::text) <= 1024
    and details - array['len', 'duration_ms'] = '{}'::jsonb
  ),
  unique (org_id, id),
  unique (org_id, session_id, seq),
  foreign key (org_id, session_id) references public.sessions (org_id, id) on delete restrict
);
alter table integrity.signals enable row level security;
revoke update, delete, truncate on integrity.signals from postgres;
create trigger signals_append_only before update or delete on integrity.signals
  for each row execute function private.results_append_only();
create trigger signals_no_truncate before truncate on integrity.signals
  for each statement execute function private.results_append_only();
alter table integrity.signals enable always trigger signals_append_only;
alter table integrity.signals enable always trigger signals_no_truncate;

-- ---------------------------------------------------------------------------------------------
-- integrity.flags (insert-only ledger; validated rules only; no UPDATE in D1)
-- ---------------------------------------------------------------------------------------------
create table integrity.flags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  session_id uuid not null,
  rule_id text not null check (char_length(rule_id) between 1 and 64),
  family text not null check (char_length(family) between 1 and 32),
  tier text not null check (tier in ('T1', 'T2', 'T3')),
  severity text not null check (severity in ('soft', 'medium', 'hard')),
  untrusted boolean not null default false,
  raw_media boolean not null default false,
  count int not null check (count >= 1),
  first_offset_ms int not null check (first_offset_ms >= 0),
  state text not null default 'pending',
  signal_seqs int[] not null default '{}' check (cardinality(signal_seqs) <= 50),
  unique (org_id, id),
  unique (org_id, session_id, rule_id),
  -- Rule 3: only a T3 rule can carry the untrusted / raw-media escalation.
  check (not (untrusted or raw_media) or tier = 'T3'),
  -- D1 only: no confirm or overturn exists yet (M6 drops this constraint).
  constraint flags_d1_no_confirm check (state in ('pending', 'not_used')),
  foreign key (org_id, session_id) references public.sessions (org_id, id) on delete restrict
);
alter table integrity.flags enable row level security;

-- Rule 6 (R-2): a flag needs the session's quality card, and it is not_used exactly when the session is below its
-- cutoff. Reads the public quality card only (one boolean), never quality.*. Flags never change in D1.
create function private.integrity_flags_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meets boolean;
begin
  if tg_op <> 'INSERT' then
    raise exception 'TRACE_GUARD: flags are immutable in D1' using errcode = '42501';
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
-- integrity.results (internal source; the band is always stored; insert-only; immutable)
-- ---------------------------------------------------------------------------------------------
create table integrity.results (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  session_id uuid not null,
  ruleset_version_id uuid not null,
  band_rule_version_id uuid not null,
  engine_version text not null check (char_length(engine_version) between 1 and 64),
  band integrity.band not null,
  evidence_strength numeric(3, 2) not null check (evidence_strength between 0 and 1),
  coverage_permille smallint not null check (coverage_permille between 0 and 1000),
  coverage_floor_permille smallint not null check (coverage_floor_permille between 0 and 1000),
  photo_missing boolean not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  computed_at timestamptz not null,
  unique (org_id, id),
  unique (org_id, id, session_id),
  unique (org_id, session_id, ruleset_version_id),
  -- Never Clear on thin coverage (rule 3, §5.2 step 4).
  check (band <> 'clear' or coverage_permille >= coverage_floor_permille),
  foreign key (org_id, session_id) references public.sessions (org_id, id) on delete restrict,
  foreign key (org_id, ruleset_version_id) references public.ruleset_versions (org_id, id) on delete restrict,
  foreign key (org_id, band_rule_version_id) references integrity.band_rule_versions (org_id, id) on delete restrict
);
create index results_ruleset_idx on integrity.results (org_id, ruleset_version_id);
create index results_band_rule_idx on integrity.results (org_id, band_rule_version_id);
alter table integrity.results enable row level security;

-- The result names the session's pinned ruleset and that ruleset's rule table; a result never changes.
create function private.integrity_results_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rs uuid;
  v_band uuid;
begin
  if tg_op <> 'INSERT' then
    raise exception 'TRACE_GUARD: an integrity result is immutable' using errcode = '42501';
  end if;
  select s.ruleset_version_id, r.band_rule_version_id into v_rs, v_band
  from public.sessions as s
  join public.ruleset_versions as r on r.org_id = s.org_id and r.id = s.ruleset_version_id
  where s.org_id = new.org_id and s.id = new.session_id;
  if not found then
    raise exception 'TRACE_GUARD: session not found' using errcode = '23503';
  end if;
  -- A null id is left to the NOT NULL constraint (23502).
  if (new.ruleset_version_id is not null and new.ruleset_version_id is distinct from v_rs)
    or (new.band_rule_version_id is not null and new.band_rule_version_id is distinct from v_band) then
    raise exception 'TRACE_GUARD: the result names another ruleset or rule table than the session'
      using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.integrity_results_guard() from public, anon, authenticated, service_role;
create trigger integrity_results_guard before insert or update or delete on integrity.results
  for each row execute function private.integrity_results_guard();
alter table integrity.results enable always trigger integrity_results_guard;

-- ---------------------------------------------------------------------------------------------
-- public.quality_cards (read model; immutable; filled from quality.scores by a definer trigger, R-1)
-- ---------------------------------------------------------------------------------------------
create table public.quality_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  session_id uuid not null,
  quality_score_id uuid not null,
  score smallint not null check (score between 0 and 100),
  section_scores jsonb not null,
  quality_cutoff smallint not null check (quality_cutoff between 0 and 100),
  meets_cutoff boolean not null,
  scoring_version text not null check (char_length(scoring_version) between 1 and 64),
  rubric_set_sha256 text not null check (rubric_set_sha256 ~ '^[0-9a-f]{64}$'),
  rubric_version_ids uuid[] not null,
  grader_model_id text not null check (char_length(grader_model_id) between 1 and 64),
  grader_adapter_version text not null check (char_length(grader_adapter_version) between 1 and 64),
  test_version_id uuid not null,
  computed_at timestamptz not null,
  unique (org_id, id),
  unique (org_id, id, session_id),
  unique (org_id, session_id),
  foreign key (org_id, quality_score_id, session_id) references quality.scores (org_id, id, session_id) on delete restrict,
  foreign key (org_id, session_id) references public.sessions (org_id, id) on delete restrict,
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict
);
create index quality_cards_workspace_idx on public.quality_cards (org_id, workspace_id);
create index quality_cards_test_idx on public.quality_cards (org_id, test_id);
alter table public.quality_cards enable row level security;

create function private.quality_cards_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_test uuid;
begin
  if tg_op <> 'INSERT' then
    raise exception 'TRACE_GUARD: a quality card is immutable' using errcode = '42501';
  end if;
  select s.workspace_id, s.test_id into v_ws, v_test
  from public.sessions as s where s.org_id = new.org_id and s.id = new.session_id;
  if not found then
    raise exception 'TRACE_GUARD: session not found' using errcode = '23503';
  end if;
  select q.score, q.section_scores, q.quality_cutoff, q.meets_cutoff, q.scoring_version, q.rubric_set_sha256,
      q.rubric_version_ids, q.grader_model_id, q.grader_adapter_version, q.test_version_id, q.computed_at
    into new.score, new.section_scores, new.quality_cutoff, new.meets_cutoff, new.scoring_version,
      new.rubric_set_sha256, new.rubric_version_ids, new.grader_model_id, new.grader_adapter_version,
      new.test_version_id, new.computed_at
  from quality.scores as q
  where q.org_id = new.org_id and q.id = new.quality_score_id and q.session_id = new.session_id;
  if not found then
    raise exception 'TRACE_GUARD: quality score not found' using errcode = '23503';
  end if;
  new.workspace_id := v_ws;
  new.test_id := v_test;
  return new;
end
$$;
revoke execute on function private.quality_cards_fill() from public, anon, authenticated, service_role;
create trigger quality_cards_fill before insert or update or delete on public.quality_cards
  for each row execute function private.quality_cards_fill();
alter table public.quality_cards enable always trigger quality_cards_fill;

-- Now that quality_cards exists, the flag guard can be attached.
create trigger integrity_flags_guard before insert or update or delete on integrity.flags
  for each row execute function private.integrity_flags_guard();
alter table integrity.flags enable always trigger integrity_flags_guard;

-- ---------------------------------------------------------------------------------------------
-- public.integrity_cards (read model; filled from integrity.results; review_state flow L-4, guard L-28)
-- ---------------------------------------------------------------------------------------------
create table public.integrity_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  session_id uuid not null,
  integrity_result_id uuid not null,
  ruleset_version_id uuid not null,
  band_rule_version_id uuid not null,
  rule_table_version text not null check (char_length(rule_table_version) between 1 and 32),
  engine_version text not null check (char_length(engine_version) between 1 and 64),
  review_state text not null check (review_state in ('reviewed', 'not_reviewed_below_cutoff', 'awaiting_quality')),
  band text not null check (band in ('clear', 'review', 'strong_concern', 'insufficient_evidence')),
  evidence_strength numeric(3, 2) not null check (evidence_strength between 0 and 1),
  coverage_permille smallint not null check (coverage_permille between 0 and 1000),
  coverage_floor_permille smallint not null check (coverage_floor_permille between 0 and 1000),
  photo_missing boolean not null,
  computed_at timestamptz not null,
  unique (org_id, id),
  unique (org_id, id, session_id),
  unique (org_id, session_id, ruleset_version_id),
  foreign key (org_id, integrity_result_id, session_id)
    references integrity.results (org_id, id, session_id) on delete restrict,
  foreign key (org_id, session_id) references public.sessions (org_id, id) on delete restrict,
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict,
  foreign key (org_id, ruleset_version_id) references public.ruleset_versions (org_id, id) on delete restrict
);
create index integrity_cards_workspace_idx on public.integrity_cards (org_id, workspace_id);
create index integrity_cards_test_idx on public.integrity_cards (org_id, test_id);
alter table public.integrity_cards enable row level security;

-- Fill (L-7): every value column comes from the result and its rule table; the job supplies only the ids,
-- review_state and photo_missing (R-11: from the mirror message).
create function private.integrity_cards_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_test uuid;
  v_band integrity.band;
  v_version_no int;
begin
  if tg_op <> 'INSERT' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select s.workspace_id, s.test_id into v_ws, v_test
  from public.sessions as s where s.org_id = new.org_id and s.id = new.session_id;
  if not found then
    raise exception 'TRACE_GUARD: session not found' using errcode = '23503';
  end if;
  select r.ruleset_version_id, r.band_rule_version_id, r.engine_version, r.band, r.evidence_strength,
      r.coverage_permille, r.coverage_floor_permille, r.computed_at, b.version_no
    into new.ruleset_version_id, new.band_rule_version_id, new.engine_version, v_band, new.evidence_strength,
      new.coverage_permille, new.coverage_floor_permille, new.computed_at, v_version_no
  from integrity.results as r
  join integrity.band_rule_versions as b on b.org_id = r.org_id and b.id = r.band_rule_version_id
  where r.org_id = new.org_id and r.id = new.integrity_result_id and r.session_id = new.session_id;
  if not found then
    raise exception 'TRACE_GUARD: integrity result not found' using errcode = '23503';
  end if;
  new.band := v_band::text;
  new.rule_table_version := 'd1-v' || v_version_no::text;
  new.workspace_id := v_ws;
  new.test_id := v_test;
  return new;
end
$$;
revoke execute on function private.integrity_cards_fill() from public, anon, authenticated, service_role;

-- Guard (L-4, L-28): only review_state changes, once, from awaiting_quality to a final state; the final state matches
-- the quality card's meets_cutoff and the flag states; the band matches the flags (rule 3). Reads public.quality_cards
-- (one boolean) and integrity.flags only.
create function private.integrity_cards_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meets boolean;
  v_has_quality boolean;
  v_flags int;
  v_not_pending int;
  v_not_unused int;
  v_strong boolean;
  v_review boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'TRACE_GUARD: an integrity card is never deleted' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'review_state') is distinct from (to_jsonb(old) - 'review_state') then
      raise exception 'TRACE_GUARD: only review_state of an integrity card can change' using errcode = '42501';
    end if;
    if old.review_state <> 'awaiting_quality' or new.review_state = 'awaiting_quality' then
      raise exception 'TRACE_GUARD: review_state moves once, from awaiting_quality to a final state'
        using errcode = '42501';
    end if;
  end if;

  select c.meets_cutoff into v_meets
  from public.quality_cards as c where c.org_id = new.org_id and c.session_id = new.session_id;
  v_has_quality := found;
  select count(*), count(*) filter (where f.state <> 'pending'), count(*) filter (where f.state <> 'not_used'),
      coalesce(bool_or(f.tier in ('T1', 'T2') or f.untrusted or f.raw_media), false),
      coalesce(bool_or(f.tier = 'T3' and f.severity in ('medium', 'hard')), false)
        or count(distinct f.family) filter (where f.tier = 'T3') >= 2
    into v_flags, v_not_pending, v_not_unused, v_strong, v_review
  from integrity.flags as f where f.org_id = new.org_id and f.session_id = new.session_id;

  if new.review_state = 'awaiting_quality' then
    if v_has_quality or v_flags > 0 then
      raise exception 'TRACE_GUARD: awaiting_quality needs no quality card and no flags' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.review_state = 'reviewed' then
    if not v_has_quality or v_meets is not true or v_not_pending > 0 then
      raise exception 'TRACE_GUARD: reviewed needs a quality card at or above the cutoff and pending flags only'
        using errcode = '42501';
    end if;
  elsif new.review_state = 'not_reviewed_below_cutoff' then
    if not v_has_quality or v_meets is not false or v_not_unused > 0 then
      raise exception 'TRACE_GUARD: not_reviewed_below_cutoff needs a quality card below the cutoff and not_used flags only'
        using errcode = '42501';
    end if;
  end if;
  -- Band / flag consistency (not_used flags count too).
  if new.band = 'strong_concern' and not v_strong then
    raise exception 'TRACE_GUARD: strong_concern needs a T1/T2, untrusted or raw-media flag' using errcode = '42501';
  end if;
  if new.band = 'review' and (v_strong or not v_review) then
    raise exception 'TRACE_GUARD: review needs a T3 medium/hard flag or soft flags in two families, and no strong flag'
      using errcode = '42501';
  end if;
  if new.band in ('clear', 'insufficient_evidence') and (v_strong or v_review) then
    raise exception 'TRACE_GUARD: the band is lower than its flags' using errcode = '42501';
  end if;
  if new.band = 'clear' and new.coverage_permille < new.coverage_floor_permille then
    raise exception 'TRACE_GUARD: clear needs coverage at or above the floor' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.integrity_cards_guard() from public, anon, authenticated, service_role;
create trigger integrity_cards_fill before insert or update or delete on public.integrity_cards
  for each row execute function private.integrity_cards_fill();
create trigger integrity_cards_guard before insert or update or delete on public.integrity_cards
  for each row execute function private.integrity_cards_guard();
alter table public.integrity_cards enable always trigger integrity_cards_fill;
alter table public.integrity_cards enable always trigger integrity_cards_guard;

-- ---------------------------------------------------------------------------------------------
-- public.integrity_timeline_entries (append-only; reviewed cards only; flag_state pending only, L-3)
-- ---------------------------------------------------------------------------------------------
create table public.integrity_timeline_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  session_id uuid not null,
  integrity_card_id uuid not null,
  position smallint not null check (position >= 1),
  entry_kind text not null check (entry_kind in ('flag', 'context')),
  signal_kind text not null
    check (signal_kind in ('paste', 'drop', 'untrusted_input', 'tab_hidden', 'fullscreen_exit', 'connectivity_gap')),
  family text null check (family is null or family in ('paste', 'input_origin', 'focus', 'connectivity')),
  rule_id text null check (rule_id is null or char_length(rule_id) between 1 and 64),
  tier text null check (tier is null or tier in ('T1', 'T2', 'T3')),
  offset_ms int not null check (offset_ms >= 0),
  count smallint not null default 1 check (count >= 1),
  observed jsonb not null default '{}' check (
    jsonb_typeof(observed) = 'object'
    and octet_length(observed::text) <= 512
    and observed - array['len', 'duration_ms', 'count'] = '{}'::jsonb
  ),
  flag_state text null check (flag_state = 'pending'),
  signal_seqs int[] not null default '{}' check (cardinality(signal_seqs) <= 50),
  unique (org_id, id),
  unique (org_id, integrity_card_id, position),
  -- A flag entry carries its rule, tier and flag state; a context entry carries none of them.
  check (
    (entry_kind = 'flag' and rule_id is not null and tier is not null and flag_state is not null)
    or (entry_kind = 'context' and rule_id is null and tier is null and flag_state is null)
  ),
  -- A connectivity gap is context labelled connectivity, never focus and never a flag (D1-6).
  check ((signal_kind = 'connectivity_gap') = (family is not distinct from 'connectivity')),
  check (signal_kind <> 'connectivity_gap' or entry_kind = 'context'),
  foreign key (org_id, integrity_card_id, session_id)
    references public.integrity_cards (org_id, id, session_id) on delete restrict,
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict
);
create index integrity_timeline_entries_workspace_idx on public.integrity_timeline_entries (org_id, workspace_id);
create index integrity_timeline_entries_test_idx on public.integrity_timeline_entries (org_id, test_id);
alter table public.integrity_timeline_entries enable row level security;

create function private.integrity_timeline_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_ws uuid;
  v_test uuid;
begin
  select c.review_state, c.workspace_id, c.test_id into v_state, v_ws, v_test
  from public.integrity_cards as c
  where c.org_id = new.org_id and c.id = new.integrity_card_id and c.session_id = new.session_id;
  if not found or v_state is distinct from 'reviewed' then
    raise exception 'TRACE_GUARD: timeline entries exist only for a reviewed card' using errcode = '42501';
  end if;
  new.workspace_id := v_ws;
  new.test_id := v_test;
  return new;
end
$$;
revoke execute on function private.integrity_timeline_guard() from public, anon, authenticated, service_role;
revoke update, delete, truncate on public.integrity_timeline_entries from postgres;
create trigger integrity_timeline_guard before insert on public.integrity_timeline_entries
  for each row execute function private.integrity_timeline_guard();
create trigger integrity_timeline_append_only before update or delete on public.integrity_timeline_entries
  for each row execute function private.results_append_only();
create trigger integrity_timeline_no_truncate before truncate on public.integrity_timeline_entries
  for each statement execute function private.results_append_only();
alter table public.integrity_timeline_entries enable always trigger integrity_timeline_guard;
alter table public.integrity_timeline_entries enable always trigger integrity_timeline_append_only;
alter table public.integrity_timeline_entries enable always trigger integrity_timeline_no_truncate;

-- ---------------------------------------------------------------------------------------------
-- public.reports (ids only; one per session; each worker attaches its own card once, R-1)
-- ---------------------------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  workspace_id uuid not null,
  test_id uuid not null,
  session_id uuid not null,
  quality_card_id uuid null,
  integrity_card_id uuid null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, session_id),
  foreign key (org_id, session_id) references public.sessions (org_id, id) on delete restrict,
  foreign key (org_id, workspace_id) references public.workspaces (org_id, id) on delete restrict,
  foreign key (org_id, test_id) references public.tests (org_id, id) on delete restrict,
  foreign key (org_id, quality_card_id, session_id)
    references public.quality_cards (org_id, id, session_id) on delete restrict,
  foreign key (org_id, integrity_card_id, session_id)
    references public.integrity_cards (org_id, id, session_id) on delete restrict
);
create index reports_workspace_idx on public.reports (org_id, workspace_id);
create index reports_test_idx on public.reports (org_id, test_id);
create index reports_quality_card_idx on public.reports (org_id, quality_card_id);
create index reports_integrity_card_idx on public.reports (org_id, integrity_card_id);
alter table public.reports enable row level security;

-- Set-once pointers. The row is created with both card ids null (the mirror); each id goes null -> non-null once.
-- The integrity card is attached only once it is reviewed (rule 6: an org role never learns that an integrity card
-- exists below the cutoff or while it awaits the quality card; lead decision, m3 NOTES Q1, FOUNDER-QUEUE).
-- Reads public tables only (MT-5d).
create function private.reports_set_once()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_test uuid;
  v_state text;
begin
  if tg_op = 'DELETE' then
    raise exception 'TRACE_GUARD: a report pointer is never deleted' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    select s.workspace_id, s.test_id into v_ws, v_test
    from public.sessions as s where s.org_id = new.org_id and s.id = new.session_id;
    if not found then
      raise exception 'TRACE_GUARD: session not found' using errcode = '23503';
    end if;
    if new.quality_card_id is not null or new.integrity_card_id is not null then
      raise exception 'TRACE_GUARD: a report pointer starts with both card ids null' using errcode = '42501';
    end if;
    new.workspace_id := v_ws;
    new.test_id := v_test;
    return new;
  end if;
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id
    or new.workspace_id is distinct from old.workspace_id or new.test_id is distinct from old.test_id
    or new.session_id is distinct from old.session_id or new.created_at is distinct from old.created_at then
    raise exception 'TRACE_GUARD: report ids, scope and time are immutable' using errcode = '42501';
  end if;
  if (old.quality_card_id is not null and new.quality_card_id is distinct from old.quality_card_id)
    or (old.integrity_card_id is not null and new.integrity_card_id is distinct from old.integrity_card_id) then
    raise exception 'TRACE_GUARD: a card id is attached once and never changes' using errcode = '42501';
  end if;
  if old.integrity_card_id is null and new.integrity_card_id is not null then
    select c.review_state into v_state
    from public.integrity_cards as c
    where c.org_id = new.org_id and c.id = new.integrity_card_id and c.session_id = new.session_id;
    if found and v_state <> 'reviewed' then
      raise exception 'TRACE_GUARD: only a reviewed integrity card is attached' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke execute on function private.reports_set_once() from public, anon, authenticated, service_role;
create trigger reports_set_once before insert or update or delete on public.reports
  for each row execute function private.reports_set_once();
alter table public.reports enable always trigger reports_set_once;

-- ---------------------------------------------------------------------------------------------
-- Org seed (R-5): notice v1, band rules v1 (= packages/band-engine/src/rules/d1-v1.json), default rubric.
-- Idempotent (on conflict do nothing), so the trigger and the backfill share it.
-- ---------------------------------------------------------------------------------------------
create function private.seed_org(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notice text := 'Synthetic D1 candidate notice, version 1. This assessment records an Answer Quality score and, '
    || 'separately, integrity signals with evidence. No decision is made automatically. You may respond to any '
    || 'integrity flag before a decision is made.';
  v_rules jsonb := '[{"family":"paste","id":"D1-PASTE","kinds":["paste","drop"],"severity":"medium","tier":"T3",'
    || '"validated":true},{"family":"input_origin","id":"D1-UNTRUSTED-INPUT","kinds":["untrusted_input"],'
    || '"severity":"hard","tier":"T3","untrusted":true,"validated":true},{"family":"focus","id":"D1-TAB-HIDDEN",'
    || '"kinds":["tab_hidden"],"minDurationMs":3000,"severity":"soft","tier":"T3","validated":false},'
    || '{"family":"focus","id":"D1-FULLSCREEN-EXIT","kinds":["fullscreen_exit"],"severity":"soft","tier":"T3",'
    || '"validated":false}]';
  v_criteria jsonb := '[{"id":"c1","label":"Answers the question asked","max_points":4,'
    || '"anchors":{"0":"Does not answer","2":"Partly answers","4":"Fully answers"}}]';
begin
  insert into public.notice_versions (org_id, notice_key, version, language, body_template, template_sha256)
    values (p_org_id, 'candidate-notice', 1, 'en', v_notice, encode(sha256(convert_to(v_notice, 'UTF8')), 'hex'))
    on conflict do nothing;
  -- content_sha256 = SHA-256 of the canonical JSON (sorted keys) of the whole d1-v1 rule table
  -- (version, coverageFloorPermille, coveragePhotoMissingFactorPermille, families, rules), §5.2.
  insert into integrity.band_rule_versions (org_id, version_no, families, coverage_floor_permille,
      coverage_photo_missing_factor_permille, rules, content_sha256)
    values (p_org_id, 1, array['paste', 'input_origin', 'focus'], 700, 750, v_rules,
      'c862bf653c6284fbb4d2319c923cd1c8aa28bcc40a2a61ccbc10d6e6af96ca0e')
    on conflict do nothing;
  insert into public.rubric_versions (org_id, rubric_key, version_no, criteria, content_sha256)
    values (p_org_id, 'default', 1, v_criteria, encode(sha256(convert_to(v_criteria::text, 'UTF8')), 'hex'))
    on conflict do nothing;
end
$$;
revoke execute on function private.seed_org(uuid) from public, anon, authenticated, service_role;

create function private.seed_org_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_org(new.id);
  return null;
end
$$;
revoke execute on function private.seed_org_defaults() from public, anon, authenticated, service_role;
create trigger orgs_seed_defaults after insert on public.orgs
  for each row execute function private.seed_org_defaults();
alter table public.orgs enable always trigger orgs_seed_defaults;

-- Backfill every existing org.
select private.seed_org(o.id) from public.orgs as o;

-- ---------------------------------------------------------------------------------------------
-- L-8: a draft's ruleset row and notice pin come only from this trigger (fires after test_versions_guard, which
-- assigns version_no and the workspace). Fails closed when the org has no seeded rule table or notice.
-- ---------------------------------------------------------------------------------------------
create function private.test_versions_ruleset_seed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_band uuid;
  v_notice uuid;
  v_rs uuid;
begin
  select b.id into v_band from integrity.band_rule_versions as b
  where b.org_id = new.org_id order by b.version_no desc limit 1;
  select n.id into v_notice from public.notice_versions as n
  where n.org_id = new.org_id order by n.version desc, n.published_at desc limit 1;
  if v_band is null or v_notice is null then
    raise exception 'TRACE_GUARD: the org has no seeded band rule version or notice' using errcode = '42501';
  end if;
  insert into public.ruleset_versions (org_id, workspace_id, test_id, version_no, band_rule_version_id, signal_settings)
    values (new.org_id, new.workspace_id, new.test_id, new.version_no, v_band,
      '{"paste":{"enabled":true},"drop":{"enabled":true},"untrusted_input":{"enabled":true},'
      '"tab_hidden":{"enabled":true},"fullscreen_exit":{"enabled":true}}'::jsonb)
    returning id into v_rs;
  new.ruleset_version_id := v_rs;
  new.notice_version_id := v_notice;
  return new;
end
$$;
revoke execute on function private.test_versions_ruleset_seed() from public, anon, authenticated, service_role;
create trigger test_versions_ruleset_seed before insert on public.test_versions
  for each row execute function private.test_versions_ruleset_seed();
alter table public.test_versions enable always trigger test_versions_ruleset_seed;

-- ---------------------------------------------------------------------------------------------
-- mirror_session: unchanged from migration 2 except that it writes the session's reports row (both card ids null)
-- before the invitation is marked submitted (m2 draft NOTES D-1).
-- ---------------------------------------------------------------------------------------------
create or replace function private.mirror_session(p_org_id uuid, p_msg jsonb)
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

  -- The invitation lock and the key check above make this call the first writer, so a unique conflict on a child row
  -- can only mean the message repeats an item, answer or photo: a malformed message, never a retry. It is refused
  -- (22023) rather than skipped, so a later duplicate answer can never silently lose to an earlier one (m2 DB review M-1).
  for v_el in select e from jsonb_array_elements(coalesce(p_msg -> 'served', '[]'::jsonb)) as e loop
    begin
      insert into public.session_items (org_id, session_id, item_version_id, position, served_at)
        values (p_org_id, v_session, (v_el ->> 'itemVersionId')::uuid, (v_el ->> 'position')::int,
          (v_el ->> 'servedAt')::timestamptz);
    exception when unique_violation then
      raise exception 'TRACE_BAD_MIRROR: an item or position is served twice' using errcode = '22023';
    end;
  end loop;

  for v_el in select e from jsonb_array_elements(coalesce(p_msg -> 'responses', '[]'::jsonb)) as e loop
    select si.id into v_si
    from public.session_items as si
    where si.org_id = p_org_id and si.session_id = v_session and si.item_version_id = (v_el ->> 'itemVersionId')::uuid;
    if not found then
      raise exception 'TRACE_BAD_MIRROR: a response names an item that was not served' using errcode = '22023';
    end if;
    begin
      insert into public.responses (
        org_id, session_id, session_item_id, answer_kind, final_text, final_choice, answer_sha256, final_seq, submitted_at
      ) values (
        p_org_id, v_session, v_si, v_el ->> 'kind', v_el ->> 'text', v_el ->> 'choice', v_el ->> 'sha256',
        (v_el ->> 'finalSeq')::int, v_submitted
      );
    exception when unique_violation then
      raise exception 'TRACE_BAD_MIRROR: an item is answered twice' using errcode = '22023';
    end;
  end loop;

  if jsonb_typeof(v_photo) = 'object' then
    begin
      insert into public.media_objects (org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device)
        values (p_org_id, v_session, 'start_photo', v_photo ->> 'key', v_photo ->> 'sha256',
          (v_photo ->> 'bytes')::int, v_photo ->> 'mime', (v_photo ->> 'blurredOnDevice')::boolean);
    exception when unique_violation then
      raise exception 'TRACE_BAD_MIRROR: the start photo is already stored' using errcode = '22023';
    end;
  end if;

  -- The report pointer (both card ids null); the result workers attach their cards later (R-1).
  insert into public.reports (org_id, session_id) values (p_org_id, v_session) on conflict do nothing;

  update public.invitations as i
    set status = 'submitted'
    where i.org_id = p_org_id and i.id = v_invitation and i.status <> 'submitted';

  insert into public.idempotency_keys (org_id, scope, key, result_ref, expires_at)
    values (p_org_id, 'session_mirror', v_key, v_session::text, v_submitted + interval '90 days')
    on conflict do nothing;
  return 'stored';
-- A field of the wrong type (a uuid, int, timestamp or boolean that does not parse) is a malformed message too: the
-- error contract says 22023, and a job that dead-letters on 22023 must not retry a poison message (m2 DB review m-3).
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
    or numeric_value_out_of_range then
    raise exception 'TRACE_BAD_MIRROR: a field has the wrong type' using errcode = '22023';
end
$$;
revoke execute on function private.mirror_session(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.mirror_session(uuid, jsonb) to trace_worker;

-- ---------------------------------------------------------------------------------------------
-- private.sweep_pending (L-18): stalled stages for the jobs cron. Reads public tables only; returns rows for every org
-- (each row carries its org_id; the cron runs one job per row with that org as the job org). Only DO-supplied times
-- are compared (§10-DB clock skew). The age threshold is a constant: 30 minutes past the deadline for a missing
-- mirror, 15 minutes past submit for a missing card.
-- ---------------------------------------------------------------------------------------------
create function private.sweep_pending(p_limit int)
returns table (org_id uuid, session_id uuid, ruleset_version_id uuid, stage text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.org_id, p.session_id, p.ruleset_version_id, p.stage
  from (
    select i.org_id, i.session_id, v.ruleset_version_id, 'session_mirror'::text as stage
    from public.invitations as i
    join public.test_versions as v on v.org_id = i.org_id and v.id = i.test_version_id
    where i.status = 'started'
      and i.session_id is not null
      and i.started_at is not null
      and i.started_at + make_interval(secs => v.total_time_seconds) + interval '30 minutes' < now()
      and not exists (select 1 from public.sessions as s where s.org_id = i.org_id and s.id = i.session_id)
    union all
    select s.org_id, s.id, s.ruleset_version_id, 'quality_score'::text
    from public.sessions as s
    where s.state <> 'in_progress'
      and coalesce(s.submitted_at, s.server_deadline_at) + interval '15 minutes' < now()
      and not exists (select 1 from public.quality_cards as q where q.org_id = s.org_id and q.session_id = s.id)
    union all
    select s.org_id, s.id, s.ruleset_version_id, 'integrity_band'::text
    from public.sessions as s
    where s.state <> 'in_progress'
      and coalesce(s.submitted_at, s.server_deadline_at) + interval '15 minutes' < now()
      and (
        not exists (
          select 1 from public.integrity_cards as c
          where c.org_id = s.org_id and c.session_id = s.id and c.ruleset_version_id = s.ruleset_version_id
        )
        or (
          exists (
            select 1 from public.integrity_cards as c
            where c.org_id = s.org_id and c.session_id = s.id and c.review_state = 'awaiting_quality'
          )
          and exists (select 1 from public.quality_cards as q where q.org_id = s.org_id and q.session_id = s.id)
        )
      )
  ) as p
  order by p.stage, p.org_id, p.session_id
  limit greatest(coalesce(p_limit, 0), 0)
$$;
revoke execute on function private.sweep_pending(int) from public, anon, authenticated, service_role;
grant execute on function private.sweep_pending(int) to trace_worker;

-- ---------------------------------------------------------------------------------------------
-- m2 review notes folded in: session ids are global (n-3); an invitation expires after it is created (n-6).
-- ---------------------------------------------------------------------------------------------
alter table public.invitations add constraint invitations_session_id_key unique (session_id);
alter table public.invitations add constraint invitations_expires_after_created check (expires_at > created_at);

-- ---------------------------------------------------------------------------------------------
-- Grants and policies (§3.3). One policy per operation per role set; nothing for anon, service_role, trace_api or
-- the candidate roles. Workers are bound to org_id = private.job_org_id().
-- ---------------------------------------------------------------------------------------------

-- quality.scores / quality.grader_runs: trace_quality_worker S I
grant select, insert on quality.scores to trace_quality_worker;
create policy scores_select_quality_worker on quality.scores for select to trace_quality_worker
  using (org_id = (select private.job_org_id()));
create policy scores_insert_quality_worker on quality.scores for insert to trace_quality_worker
  with check (org_id = (select private.job_org_id()));
grant select, insert on quality.grader_runs to trace_quality_worker;
create policy grader_runs_select_quality_worker on quality.grader_runs for select to trace_quality_worker
  using (org_id = (select private.job_org_id()));
create policy grader_runs_insert_quality_worker on quality.grader_runs for insert to trace_quality_worker
  with check (org_id = (select private.job_org_id()));

-- integrity.*: trace_integrity_worker (band_rule_versions S; signals, flags, results S I)
grant select on integrity.band_rule_versions to trace_integrity_worker;
create policy band_rule_versions_select_integrity_worker on integrity.band_rule_versions
  for select to trace_integrity_worker using (org_id = (select private.job_org_id()));
grant select, insert on integrity.signals to trace_integrity_worker;
create policy signals_select_integrity_worker on integrity.signals for select to trace_integrity_worker
  using (org_id = (select private.job_org_id()));
create policy signals_insert_integrity_worker on integrity.signals for insert to trace_integrity_worker
  with check (org_id = (select private.job_org_id()));
grant select, insert on integrity.flags to trace_integrity_worker;
create policy flags_select_integrity_worker on integrity.flags for select to trace_integrity_worker
  using (org_id = (select private.job_org_id()));
create policy flags_insert_integrity_worker on integrity.flags for insert to trace_integrity_worker
  with check (org_id = (select private.job_org_id()));
grant select, insert on integrity.results to trace_integrity_worker;
create policy results_select_integrity_worker on integrity.results for select to trace_integrity_worker
  using (org_id = (select private.job_org_id()));
create policy results_insert_integrity_worker on integrity.results for insert to trace_integrity_worker
  with check (org_id = (select private.job_org_id()));

-- quality_cards: OW/AD/RC org-wide (workspace arm), RV assigned; quality worker S I; integrity worker reads one boolean
grant select on public.quality_cards to authenticated;
grant select, insert on public.quality_cards to trace_quality_worker;
grant select (org_id, session_id, meets_cutoff) on public.quality_cards to trace_integrity_worker;
create policy quality_cards_select_staff on public.quality_cards for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy quality_cards_select_reviewer on public.quality_cards for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy quality_cards_select_quality_worker on public.quality_cards for select to trace_quality_worker
  using (org_id = (select private.job_org_id()));
create policy quality_cards_insert_quality_worker on public.quality_cards for insert to trace_quality_worker
  with check (org_id = (select private.job_org_id()));
create policy quality_cards_select_integrity_worker on public.quality_cards for select to trace_integrity_worker
  using (org_id = (select private.job_org_id()));

-- integrity_cards: org roles see reviewed cards only (rule 6); integrity worker S I U(review_state)
grant select on public.integrity_cards to authenticated;
grant select, insert on public.integrity_cards to trace_integrity_worker;
grant update (review_state) on public.integrity_cards to trace_integrity_worker;
create policy integrity_cards_select_staff on public.integrity_cards for select to authenticated
  using (
    review_state = 'reviewed'
    and workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[])
  );
create policy integrity_cards_select_reviewer on public.integrity_cards for select to authenticated
  using (
    review_state = 'reviewed'
    and test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[])
  );
create policy integrity_cards_select_integrity_worker on public.integrity_cards for select to trace_integrity_worker
  using (org_id = (select private.job_org_id()));
create policy integrity_cards_insert_integrity_worker on public.integrity_cards for insert to trace_integrity_worker
  with check (org_id = (select private.job_org_id()));
create policy integrity_cards_update_integrity_worker on public.integrity_cards for update to trace_integrity_worker
  using (org_id = (select private.job_org_id()))
  with check (org_id = (select private.job_org_id()));

-- integrity_timeline_entries: as the card, and only while the card is reviewed; integrity worker S I
grant select on public.integrity_timeline_entries to authenticated;
grant select, insert on public.integrity_timeline_entries to trace_integrity_worker;
create policy integrity_timeline_entries_select_staff on public.integrity_timeline_entries for select to authenticated
  using (
    workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[])
    and exists (
      select 1 from public.integrity_cards as c
      where c.org_id = integrity_timeline_entries.org_id and c.id = integrity_timeline_entries.integrity_card_id
        and c.review_state = 'reviewed'
    )
  );
create policy integrity_timeline_entries_select_reviewer on public.integrity_timeline_entries
  for select to authenticated
  using (
    test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[])
    and exists (
      select 1 from public.integrity_cards as c
      where c.org_id = integrity_timeline_entries.org_id and c.id = integrity_timeline_entries.integrity_card_id
        and c.review_state = 'reviewed'
    )
  );
create policy integrity_timeline_entries_select_integrity_worker on public.integrity_timeline_entries
  for select to trace_integrity_worker using (org_id = (select private.job_org_id()));
create policy integrity_timeline_entries_insert_integrity_worker on public.integrity_timeline_entries
  for insert to trace_integrity_worker with check (org_id = (select private.job_org_id()));

-- reports: org roles S; trace_worker S I (ids only); each result worker reads the ids plus its own column and updates
-- only that column (R-1)
grant select on public.reports to authenticated;
grant select on public.reports to trace_worker;
grant insert (org_id, session_id) on public.reports to trace_worker;
grant select (id, org_id, session_id, quality_card_id) on public.reports to trace_quality_worker;
grant update (quality_card_id) on public.reports to trace_quality_worker;
grant select (id, org_id, session_id, integrity_card_id) on public.reports to trace_integrity_worker;
grant update (integrity_card_id) on public.reports to trace_integrity_worker;
create policy reports_select_staff on public.reports for select to authenticated
  using (workspace_id = any ((select private.my_workspace_ids('{org_owner,admin,recruiter}'))::uuid[]));
create policy reports_select_reviewer on public.reports for select to authenticated
  using (test_id = any ((select private.my_assigned_test_ids('{reviewer}'))::uuid[]));
create policy reports_select_worker on public.reports for select to trace_worker
  using (org_id = (select private.job_org_id()));
create policy reports_insert_worker on public.reports for insert to trace_worker
  with check (org_id = (select private.job_org_id()));
create policy reports_select_quality_worker on public.reports for select to trace_quality_worker
  using (org_id = (select private.job_org_id()));
create policy reports_update_quality_worker on public.reports for update to trace_quality_worker
  using (org_id = (select private.job_org_id()))
  with check (org_id = (select private.job_org_id()));
create policy reports_select_integrity_worker on public.reports for select to trace_integrity_worker
  using (org_id = (select private.job_org_id()));
create policy reports_update_integrity_worker on public.reports for update to trace_integrity_worker
  using (org_id = (select private.job_org_id()))
  with check (org_id = (select private.job_org_id()));
