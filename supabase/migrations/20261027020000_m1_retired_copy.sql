-- M1-u (M1 FIX, docs/reviews/M1.md M1-REV-2; spec specs/m1-test-authoring.md revision 5 R5-72 b): a retired library copy
-- is never reused. Before, private.library_copy reused a workspace's copy of a library version whatever its status, and
-- the unique index item_versions_library_copy covered retired copies too, so once a recruiter retired a copy (bank retire
-- route; there is no way out of `retired`) every later copy request answered the retired copy, a pool refused it and
-- public.create_test_from_template naming that library item failed for good in that workspace. Now one LIVE copy per org,
-- workspace and library version: the index leaves retired copies out, and the trigger reuses, counts for the daily cap
-- and audits only a live copy. Everything else is M1-a's body unchanged (20261023010000_m1_bank.sql); pinned by
-- rls_m1_review_fixes and rls_m1_bank.

drop index public.item_versions_library_copy;
create unique index item_versions_library_copy on public.item_versions (org_id, workspace_id, source_item_version_id)
  where source_item_version_id is not null and status <> 'retired';

create or replace function private.library_copy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lib uuid := private.library_org_id();
  v_uid uuid := (select auth.uid());
  v_src record;
  v_var record;
  v_new uuid;
  v_item uuid;
  v_rubric uuid;
  v_newvar uuid;
  v_out uuid[] := '{}';
  v_needed int;
  v_today int;
begin
  if tg_op <> 'INSERT' then
    raise exception 'TRACE_GUARD: library copy requests are immutable' using errcode = '42501';
  end if;
  if v_lib is null or new.org_id = v_lib then
    raise exception 'TRACE_GUARD: a copy goes from the library into a customer org' using errcode = '42501';
  end if;
  -- The insert policy checks staff of the workspace too; this trigger writes as the owner, so it checks again.
  if not (new.workspace_id = any (private.my_workspace_ids('{org_owner,admin,recruiter}'))) then
    raise exception 'TRACE_GUARD: staff of the workspace required' using errcode = '42501';
  end if;
  if (select count(distinct u) from unnest(new.library_item_version_ids) as u) <> cardinality(new.library_item_version_ids) then
    raise exception 'TRACE_GUARD: a library item is named twice' using errcode = '42501';
  end if;
  if (select count(*) from public.item_versions as v
      where v.org_id = v_lib and v.id = any (new.library_item_version_ids)
        and v.section_id is null and v.status = 'approved') <> cardinality(new.library_item_version_ids) then
    raise exception 'TRACE_GUARD: only approved library items can be copied' using errcode = '42501';
  end if;
  new.requested_by := v_uid;
  new.created_at := now();
  -- R3-8: one copier per org at a time, so the daily cap cannot be raced.
  perform pg_advisory_xact_lock(hashtextextended('library_copy:' || new.org_id::text, 0));
  -- M1-u: a retired copy is not reused, so its library version needs a new copy (and counts for the cap).
  select count(*) into v_needed from unnest(new.library_item_version_ids) as u(id)
  where not exists (
    select 1 from public.item_versions as c
    where c.org_id = new.org_id and c.workspace_id = new.workspace_id and c.source_item_version_id = u.id
      and c.status <> 'retired'
  );
  select count(*) into v_today from public.item_versions as c
  where c.org_id = new.org_id and c.origin = 'library'
    and c.created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC');
  if v_today + v_needed > 2000 then
    raise exception 'TRACE_GUARD: library copy cap reached' using errcode = '42501';
  end if;

  for v_src in
    select v.* from unnest(new.library_item_version_ids) with ordinality as u(id, n)
    join public.item_versions as v on v.org_id = v_lib and v.id = u.id
    order by u.n
  loop
    -- Reuse (R3-8): one live copy per org, workspace and library version (M1-u: never a retired one).
    select c.id into v_new from public.item_versions as c
    where c.org_id = new.org_id and c.workspace_id = new.workspace_id and c.source_item_version_id = v_src.id
      and c.status <> 'retired';
    if found then
      v_out := v_out || v_new;
      continue;
    end if;
    v_rubric := null;
    if v_src.rubric_version_id is not null then
      -- The library rubric becomes the customer's own frozen copy (key prefixed 'library-').
      insert into public.rubric_versions (org_id, rubric_key, version_no, criteria, content_sha256)
        select new.org_id, left('library-' || r.rubric_key, 64), r.version_no, r.criteria, r.content_sha256
        from public.rubric_versions as r where r.org_id = v_lib and r.id = v_src.rubric_version_id
        on conflict (org_id, rubric_key, version_no) do nothing;
      select c.id into v_rubric
      from public.rubric_versions as r
      join public.rubric_versions as c
        on c.org_id = new.org_id and c.rubric_key = left('library-' || r.rubric_key, 64) and c.version_no = r.version_no
      where r.org_id = v_lib and r.id = v_src.rubric_version_id and c.content_sha256 = r.content_sha256;
      if v_rubric is null then
        raise exception 'TRACE_GUARD: the library rubric copy differs from its source' using errcode = '42501';
      end if;
    end if;
    insert into public.items (org_id, workspace_id, format, skill_key)
      values (new.org_id, new.workspace_id, v_src.format, v_src.skill_key)
      returning id into v_item;
    -- SEC-M1-1 (I-M1-5): the spec is copied without correctOptionId, the key of every variant; the variant keys arrive
    -- library_sourced, readable by the quality worker only.
    insert into public.item_versions (org_id, item_id, format, stem, options, rubric_version_id, skill_key, difficulty,
        language, is_parameterised, param_spec, media, source_item_version_id, origin, content_sha256)
      values (new.org_id, v_item, v_src.format, v_src.stem, v_src.options, v_rubric, v_src.skill_key, v_src.difficulty,
        v_src.language, v_src.is_parameterised, v_src.param_spec - 'correctOptionId', v_src.media, v_src.id, 'library',
        v_src.content_sha256)
      returning id into v_new;
    insert into public.item_answer_keys (org_id, item_version_id, format, key, library_sourced)
      select new.org_id, v_new, k.format, k.key, true
      from public.item_answer_keys as k where k.org_id = v_lib and k.item_version_id = v_src.id;
    for v_var in
      select lv.* from public.item_variants as lv where lv.org_id = v_lib and lv.item_version_id = v_src.id
      order by lv.variant_no
    loop
      insert into public.item_variants (org_id, item_version_id, variant_no, params, stem, options, difficulty,
          content_sha256)
        values (new.org_id, v_new, v_var.variant_no, v_var.params, v_var.stem, v_var.options, v_var.difficulty,
          v_var.content_sha256)
        returning id into v_newvar;
      insert into public.item_variant_keys (org_id, item_variant_id, key, library_sourced)
        select new.org_id, v_newvar, k.key, true
        from public.item_variant_keys as k where k.org_id = v_lib and k.item_variant_id = v_var.id;
    end loop;
    update public.item_versions set status = 'approved' where org_id = new.org_id and id = v_new;
    v_out := v_out || v_new;
  end loop;
  new.result_item_version_ids := v_out;
  perform private.audit(new.org_id, 'library.copy', 'library_copy_requests', new.id,
    jsonb_build_object('count', v_needed, 'reused', cardinality(v_out) - v_needed), new.workspace_id);
  return new;
end
$$;
revoke execute on function private.library_copy() from public, anon, authenticated, service_role;
