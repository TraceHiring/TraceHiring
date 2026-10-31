-- M1 migration e (spec specs/m1-test-authoring.md revision 5: binding row R5-56 d; the A1 database review Lows of BUILD
-- 2; R5-53 PageCursor). Lead migration of BUILD 3 = Wave 2, after M1-a…d:
-- 1. Publish race (A1 DB review Medium, R3-2): test_versions.snapshot_digest. The api builds the package from the live
--    pool and sends the digest of the rows it used (@trace/shared snapshotDigest) in the publish update; the publish
--    guard writes section_pool_snapshot, and test_versions_snapshot_digest (after it by name) recomputes the digest of
--    that snapshot and refuses a mismatch with 40001, so the api rebuilds and retries (at most 3 times, then conflict).
-- 2. Library browse pages on the keyset (created_at, id) of the api's PageCursor and returns created_at.
-- 3. A difficulty with a third decimal is refused instead of rounded (numeric(3, 2) turned 0.405 into 0.41 before any
--    check, so the stored value was not the one the ±0.10 rule of packages/item-variants checked).
-- 4. A parameterised item leaves draft only with variants numbered 1 to n.
--
-- PROVISIONAL TIMESTAMP (R5-30): see 20261023010000_m1_bank.sql.
--
-- Error contract (as M1-a…d): guard refusal 42501 'TRACE_GUARD: <reason>'; a digest of another snapshot 40001
-- 'TRACE_GUARD: the package was built from another snapshot' (retryable); a third decimal 23514 (CHECK).

-- ---------------------------------------------------------------------------------------------
-- 3. Difficulty precision: an unconstrained numeric with a two-decimal CHECK, so no write path rounds silently
-- ---------------------------------------------------------------------------------------------
alter table public.item_versions alter column difficulty type numeric;
alter table public.item_versions add constraint item_versions_difficulty_cents
  check (difficulty is null or difficulty = round(difficulty, 2));
alter table public.item_variants alter column difficulty type numeric;
alter table public.item_variants add constraint item_variants_difficulty_cents
  check (difficulty = round(difficulty, 2));

-- ---------------------------------------------------------------------------------------------
-- 4. Variants are numbered 1 to n when a parameterised item leaves draft (BEFORE UPDATE, after item_versions_guard by
-- name, which already requires at least one variant, a key on each and the ±0.10 rule). variant_no is unique per
-- version and at least 1, so count = max means 1..n.
-- ---------------------------------------------------------------------------------------------
create function private.item_versions_variants_numbered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status is distinct from 'draft' and new.is_parameterised and exists (
    select 1 from public.item_variants as v
    where v.org_id = new.org_id and v.item_version_id = new.id
    having count(*) <> max(v.variant_no)
  ) then
    raise exception 'TRACE_GUARD: variants are numbered 1 to n' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.item_versions_variants_numbered() from public, anon, authenticated, service_role;
create trigger item_versions_variants_numbered before update of status on public.item_versions
  for each row execute function private.item_versions_variants_numbered();
alter table public.item_versions enable always trigger item_versions_variants_numbered;

-- ---------------------------------------------------------------------------------------------
-- 1. Publish digest (R5-56 d)
-- ---------------------------------------------------------------------------------------------
alter table public.test_versions add column snapshot_digest text null
  check (snapshot_digest is null or snapshot_digest ~ '^[0-9a-f]{64}$');
grant update (snapshot_digest) on public.test_versions to authenticated;

-- The digest of snapshot lines '<section id>:<item version id>:<exposure at publish>' (lower-case ids): SHA-256 hex of
-- the lines sorted by code point and joined by '\n', exactly as @trace/shared snapshotDigest (pinned to one vector in
-- packages/shared/src/item-hash.test.ts and rls_m1_snapshot).
create function private.snapshot_digest_of(p_lines text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(
    (select string_agg(l.line, E'\n' order by l.line collate "C") from unnest(p_lines) as l(line)), ''), 'UTF8')), 'hex')
$$;
revoke execute on function private.snapshot_digest_of(text[]) from public, anon, authenticated, service_role;

-- BEFORE INSERT OR UPDATE, after test_versions_guard by name: on a v2 publish the guard has written the snapshot and set
-- package_version, so this trigger compares the api's digest with the snapshot. A v1 version has no snapshot and stores
-- no digest; a draft stores none; a published or retired version keeps its digest.
create function private.test_versions_snapshot_digest()
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
  select private.snapshot_digest_of(array_agg(
      sp.section_id::text || ':' || sp.item_version_id::text || ':' || sp.exposure_at_publish::text))
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
create trigger test_versions_snapshot_digest before insert or update on public.test_versions
  for each row execute function private.test_versions_snapshot_digest();
alter table public.test_versions enable always trigger test_versions_snapshot_digest;

-- ---------------------------------------------------------------------------------------------
-- 2. Library browse on the keyset (created_at, id) (R5-53 PageCursor); same rows and fields as M1-a plus created_at
-- ---------------------------------------------------------------------------------------------
drop function private.library_browse(uuid, text, text[], text, public.section_format, numeric, numeric, uuid, int);
create function private.library_browse(
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
    -- Both cursor parts or neither: a half cursor compares with null and returns no row.
    and ((p_after_created_at is null and p_after_id is null) or (v.created_at, v.id) > (p_after_created_at, p_after_id))
  order by v.created_at, v.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;
revoke execute on function private.library_browse(uuid, text, text[], text, public.section_format, numeric, numeric,
  timestamptz, uuid, int) from public, anon, authenticated, service_role;
grant execute on function private.library_browse(uuid, text, text[], text, public.section_format, numeric, numeric,
  timestamptz, uuid, int) to trace_api;
create index item_versions_library_page_idx on public.item_versions (org_id, created_at, id)
  where section_id is null and status = 'approved';
