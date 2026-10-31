-- M1-p (spec specs/m1-test-authoring.md revision 5 R5-71): the lead's owed atomic writes, part 1.
-- 1. R5-70 re-review Low 1: public.save_test_draft re-checks D1's shape under its row lock. D1's `PUT …/tests/:testId`
--    sends `requireD1Shape: true`; after the version row is locked (its first UPDATE), a stored section that D1's
--    request cannot express (a pool, shuffle, a timer, a blueprint, a navigation other than its format's default, or a
--    second section of a format) refuses the save, so a concurrent v2 save can no longer be overwritten between the
--    api's check and the write. The api keeps its own check before the call (an early 409 without a write).
-- 2. R5-63 f: the navigation default and the written paste rule are derived in the database from the draft's settings
--    (R5-63 b, DB-M1-1). A sections BEFORE INSERT/UPDATE trigger gives a section of a version whose ruleset has settings
--    its format's default navigation when it names none and, when written, the settings' paste_written (a request's
--    other value is never stored); a ruleset_versions AFTER UPDATE trigger re-applies both to its draft versions'
--    sections when the settings change. So the integrity PUT is one write (the api's three section updates go), and
--    publish's DB-M1-1 checks stay as defence in depth. A version without settings keeps D1's nulls (R5-39 c).
-- 3. R5-64 g / R5-51 f: `id` leaves the authenticated INSERT grants of import_jobs and ai_draft_jobs (the api inserts
--    with `returning id`; a client never chooses a job id). Fixtures assign ids through a test-only trigger.
-- Nothing here touches a rule's tier, threshold or `validated` flag (rule 3), a result (rule 1) or a decision (rule 2).

-- ---------------------------------------------------------------------------------------------
-- 1. public.save_test_draft v2 (re-derived from 20261023030000_m1_imports_drafts.sql; only the D1 shape check is new)
-- ---------------------------------------------------------------------------------------------
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
  -- The version first (as D1's PUT): the guard refuses a published version, and the row lock serialises two editors.
  update public.test_versions
    set total_time_seconds = (p_payload ->> 'totalTimeSeconds')::int,
      quality_cutoff = (p_payload ->> 'qualityCutoff')::smallint
    where org_id = v_org and id = p_test_version;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'TRACE_GUARD: test version not found' using errcode = '23503';
  end if;
  -- R5-70 b under the row lock (re-review Low 1): every section writer goes through this function, so what is read
  -- here is what this save replaces. D1's request maps to inline, unshuffled, untimed sections without a blueprint,
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

-- ---------------------------------------------------------------------------------------------
-- 2. Navigation and written paste rule derived from the draft's settings (R5-63 b, DB-M1-1)
-- ---------------------------------------------------------------------------------------------
-- A section of a version whose ruleset has settings: no null navigation (its format's default), and a written section
-- takes the settings' paste_written. DEFINER so a writer's RLS on ruleset_versions never hides the settings; it reads
-- only the row's own version and ruleset. Runs after sections_guard (name order), which already locked the version.
create function private.sections_settings_derive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb;
begin
  select r.settings into v_settings
  from public.test_versions as v
  join public.ruleset_versions as r on r.org_id = v.org_id and r.id = v.ruleset_version_id
  where v.org_id = new.org_id and v.id = new.test_version_id;
  if v_settings is null then
    return new;
  end if;
  new.navigation := coalesce(new.navigation, case new.format when 'mcq' then 'free' else 'forward_only' end);
  if new.format = 'written' then
    new.paste_rule := v_settings ->> 'paste_written';
  end if;
  return new;
end
$$;
revoke execute on function private.sections_settings_derive() from public, anon, authenticated, service_role;
create trigger sections_settings_derive before insert or update on public.sections
  for each row execute function private.sections_settings_derive();
alter table public.sections enable always trigger sections_settings_derive;

-- When a draft ruleset's settings change, its versions' sections are re-derived in the same statement (the integrity
-- PUT is one write). A published ruleset never changes (its guard), so only draft sections move.
create function private.ruleset_settings_to_sections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sections as s
    set navigation = coalesce(s.navigation, case s.format when 'mcq' then 'free' else 'forward_only' end),
      paste_rule = case when s.format = 'written' then new.settings ->> 'paste_written' else s.paste_rule end
    from public.test_versions as v
    where v.org_id = new.org_id and v.ruleset_version_id = new.id and v.status = 'draft'
      and s.org_id = v.org_id and s.test_version_id = v.id;
  return null;
end
$$;
revoke execute on function private.ruleset_settings_to_sections() from public, anon, authenticated, service_role;
create trigger ruleset_settings_to_sections after update of settings on public.ruleset_versions
  for each row when (new.settings is not null and new.settings is distinct from old.settings)
  execute function private.ruleset_settings_to_sections();
alter table public.ruleset_versions enable always trigger ruleset_settings_to_sections;

-- ---------------------------------------------------------------------------------------------
-- 3. A client never chooses a job id (R5-64 g, R5-51 f security L-2)
-- ---------------------------------------------------------------------------------------------
revoke insert (id) on public.import_jobs from authenticated;
revoke insert (id) on public.ai_draft_jobs from authenticated;
