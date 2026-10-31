-- Migration M1-f (specs/m1-test-authoring.md R5-60; Opus database review of M1-e, APPROVE WITH FIXES).
-- 1. The publish digest covers section:item lines only. Exposure counts grow with every served item, so a digest that
--    held them refused (40001) every publish of a new version of a live test whose pool items were served between the
--    api's package build and the publish update. section_pool_snapshot.exposure_at_publish still freezes the count at
--    the publish statement; the package carries the count read at build time (never above it).
-- 2. library_browse returns no row for a half cursor. A row comparison (a, b) > (x, null) is true whenever a > x, so
--    the M1-e predicate let a cursor with only created_at through.
-- 3. ai_draft_jobs.difficulty refuses a third decimal instead of rounding it (numeric(3, 2) turned 0.405 into 0.41).

-- ---------------------------------------------------------------------------------------------
-- 1. Digest without exposure (the trigger keeps its name, order and ENABLE ALWAYS state)
-- ---------------------------------------------------------------------------------------------
create or replace function private.test_versions_snapshot_digest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_digest text;
begin
  if tg_op = 'INSERT' then
    new.snapshot_digest := null;
    return new;
  end if;
  if old.status <> 'draft' then
    if new.snapshot_digest is distinct from old.snapshot_digest then
      raise exception 'TRACE_GUARD: a published test version is frozen' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from 'published' or new.package_version is distinct from 2 then
    new.snapshot_digest := null;
    return new;
  end if;
  if new.snapshot_digest is null then
    raise exception 'TRACE_GUARD: publish needs the snapshot digest' using errcode = '42501';
  end if;
  select private.snapshot_digest_of(array_agg(sp.section_id::text || ':' || sp.item_version_id::text))
    into v_digest
  from public.section_pool_snapshot as sp
  where sp.org_id = new.org_id and sp.test_version_id = new.id;
  if v_digest is distinct from new.snapshot_digest then
    raise exception 'TRACE_GUARD: the package was built from another snapshot' using errcode = '40001';
  end if;
  return new;
end
$$;
revoke execute on function private.test_versions_snapshot_digest() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Library browse: both cursor parts or neither
-- ---------------------------------------------------------------------------------------------
create or replace function private.library_browse(
  p_viewer uuid,
  p_aal text,
  p_amr text[],
  p_skill text,
  p_format public.section_format,
  p_difficulty_min numeric,
  p_difficulty_max numeric,
  p_after_created_at timestamptz,
  p_after_id uuid,
  p_limit int
)
returns table (
  library_item_version_id uuid,
  format public.section_format,
  skill_key text,
  difficulty numeric,
  stem text,
  options jsonb,
  is_parameterised boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.format, v.skill_key, v.difficulty, v.stem,
    case when v.options is null then null
      else (select jsonb_agg(o.e -> 'text' order by o.n) from jsonb_array_elements(v.options) with ordinality as o(e, n))
    end,
    v.is_parameterised, v.created_at
  from public.item_versions as v
  where private.library_viewer_ok(p_viewer, p_aal, p_amr, false)
    and v.org_id = private.library_org_id()
    and v.section_id is null
    and v.status = 'approved'
    and (p_skill is null or v.skill_key = p_skill)
    and (p_format is null or v.format = p_format)
    and (p_difficulty_min is null or v.difficulty >= p_difficulty_min)
    and (p_difficulty_max is null or v.difficulty <= p_difficulty_max)
    -- No cursor: the first page. Both parts: the rows after them. One part only: no row.
    and case
      when p_after_created_at is null and p_after_id is null then true
      when p_after_created_at is null or p_after_id is null then false
      else (v.created_at, v.id) > (p_after_created_at, p_after_id)
    end
  order by v.created_at, v.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;
revoke execute on function private.library_browse(uuid, text, text[], text, public.section_format, numeric, numeric,
  timestamptz, uuid, int) from public, anon, authenticated, service_role;
grant execute on function private.library_browse(uuid, text, text[], text, public.section_format, numeric, numeric,
  timestamptz, uuid, int) to trace_api;

-- ---------------------------------------------------------------------------------------------
-- 3. AI draft job difficulty: no rounding type (same CHECK as item_versions and item_variants, R5-57 c)
-- ---------------------------------------------------------------------------------------------
alter table public.ai_draft_jobs alter column difficulty type numeric;
alter table public.ai_draft_jobs add constraint ai_draft_jobs_difficulty_cents
  check (difficulty = round(difficulty, 2));
