-- M1-r (spec specs/m1-test-authoring.md revision 5 R5-71 f): the M1-p review fix round.
-- public.save_test_draft v3 (re-derived from 20261026180000_m1_atomic_writes.sql; only the lock order and a comment
-- change): it locks the draft's ruleset row before its version row, the order a settings write takes (its row, then
-- the sections and, through sections_guard, the version). So a draft save during an integrity PUT waits and derives
-- the committed paste rule (database review Medium 1, security Low 1), and the two writers no longer deadlock
-- (database Low 2). Publish still locks the version and then the ruleset: a save racing a publish of the same draft
-- may be broken by the deadlock detector (40P01), which the api answers 409 `conflict` (the editor reloads).
-- Pinned by `rls_m1_atomic` and the two-connection scenario in scripts/test-concurrency-local.mjs.

create or replace function public.save_test_draft(p_test_version uuid, p_payload jsonb)
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
  -- M1-r (M1-p reviews: database Medium 1 and Low 2, security Low 1): one lock order for every authoring write, the
  -- draft's ruleset row and then its version row. A settings write (the integrity PUT) locks the ruleset first too,
  -- so a save waits for it and its sections derive the settings it commits; without this lock a save could derive
  -- the old paste rule while a settings write was in flight, and the two could deadlock.
  if v_ruleset is not null then
    perform 1 from public.ruleset_versions as r where r.org_id = v_org and r.id = v_ruleset for no key update;
  end if;
  -- Then the version (as D1's PUT): the guard refuses a published version, and the row lock serialises two editors.
  update public.test_versions
    set total_time_seconds = (p_payload ->> 'totalTimeSeconds')::int,
      quality_cutoff = (p_payload ->> 'qualityCutoff')::smallint
    where org_id = v_org and id = p_test_version;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'TRACE_GUARD: test version not found' using errcode = '23503';
  end if;
  -- R5-70 b under the row lock (re-review Low 1): the api writes sections only through this function, and a direct
  -- section write (authenticated keeps its column grants) takes the version row FOR SHARE in sections_guard, which
  -- waits for this save; so what is read here is what this save replaces. D1's request maps to inline, unshuffled, untimed sections without a blueprint,
  -- one per format, with no navigation or its format's default (a draft with stored settings, R5-63 b).
  if p_payload -> 'requireD1Shape' = 'true'::jsonb and exists (
    select 1 from public.sections as s
    where s.org_id = v_org and s.test_version_id = p_test_version
      and (s.pool_id is not null or s.shuffle_items or s.shuffle_options or s.time_limit_seconds is not null
        or s.blueprint is not null
        or (s.navigation is not null
          and s.navigation <> case s.format when 'mcq' then 'free' else 'forward_only' end)
        or exists (select 1 from public.sections as o
                   where o.org_id = s.org_id and o.test_version_id = s.test_version_id and o.format = s.format
                     and o.id <> s.id))
  ) then
    raise exception 'TRACE_GUARD: the draft has sections the D1 editor cannot save' using errcode = '55000';
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
