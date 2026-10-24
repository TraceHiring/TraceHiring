-- Migration M1-o (specs/m1-test-authoring.md R5-65, R5-63 f). A v2 package build read its source with up to ~300
-- sequential PostgREST calls (pool pages, then item, variant and exposure chunks of 50), and a publish attempt builds
-- twice (live, then frozen): over the Workers subrequest limit at 5,000 items (OPEN-8a). public.publish_source_v2
-- returns the whole source in one call.
--
-- SECURITY INVOKER (M1-18): it runs as the caller (authenticated, with the caller's JWT), so RLS and column grants
-- apply exactly as for the PostgREST reads it replaces; it references only public objects. It returns null unless the
-- caller sees the version in the named org (another org reads null, never an error that names the version).
--   members   live:   the approved bank versions (section_id null) of each pool section's pool, and the inline items
--                     of each inline section (the rows publish guard v2 freezes)
--             frozen: the version's section_pool_snapshot rows (with exposure_at_publish), inline rows included
--   items     each member item version once, with exactly the package columns (never a key or a rubric body)
--   variants  the variants of parameterised members (no params, no key)
--   exposure  live only: served count per item, summed over v_item_exposure; frozen: empty
-- Nothing here reads or names quality.* or integrity.* (I-M1-10).

create function public.publish_source_v2(p_org_id uuid, p_test_version_id uuid, p_frozen boolean)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with v as (
    select tv.id, tv.org_id
    from public.test_versions as tv
    where tv.org_id = p_org_id and tv.id = p_test_version_id
  ),
  members as (
    select s.id as section_id, iv.id as item_version_id, null::int as exposure_at_publish
    from v
    join public.sections as s on s.org_id = v.org_id and s.test_version_id = v.id and s.pool_id is not null
    join public.pool_items as pi on pi.org_id = s.org_id and pi.pool_id = s.pool_id
    join public.item_versions as iv
      on iv.org_id = pi.org_id and iv.id = pi.item_version_id and iv.status = 'approved' and iv.section_id is null
    where p_frozen is false
    union all
    select s.id, iv.id, null::int
    from v
    join public.sections as s on s.org_id = v.org_id and s.test_version_id = v.id and s.pool_id is null
    join public.item_versions as iv on iv.org_id = s.org_id and iv.section_id = s.id
    where p_frozen is false
    union all
    select sp.section_id, sp.item_version_id, sp.exposure_at_publish
    from v
    join public.section_pool_snapshot as sp on sp.org_id = v.org_id and sp.test_version_id = v.id
    where p_frozen is true
  ),
  items as (
    select iv.id, iv.item_id, iv.test_version_id, iv.section_id, iv.format, iv.position, iv.stem, iv.options,
      iv.rubric_version_id, iv.media, iv.skill_key, iv.difficulty, iv.is_parameterised
    from public.item_versions as iv
    where iv.org_id = p_org_id and iv.id in (select m.item_version_id from members as m)
  ),
  variants as (
    select va.id, va.item_version_id, va.variant_no, va.stem, va.options
    from public.item_variants as va
    where va.org_id = p_org_id
      and va.item_version_id in (select i.id from items as i where i.is_parameterised)
  ),
  exposure as (
    select e.item_id, sum(e.served_count)::int as served_count
    from public.v_item_exposure as e
    where p_frozen is false and e.org_id = p_org_id and e.item_id in (select i.item_id from items as i)
    group by e.item_id
  )
  select case when exists (select 1 from v) then jsonb_build_object(
    'members', coalesce((select jsonb_agg(to_jsonb(m) order by m.section_id, m.item_version_id) from members as m),
      '[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from items as i), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(to_jsonb(va) order by va.item_version_id, va.variant_no)
      from variants as va), '[]'::jsonb),
    'exposure', coalesce((select jsonb_agg(to_jsonb(e) order by e.item_id) from exposure as e), '[]'::jsonb)
  ) end
$$;

revoke all on function public.publish_source_v2(uuid, uuid, boolean) from public;
grant execute on function public.publish_source_v2(uuid, uuid, boolean) to authenticated;
