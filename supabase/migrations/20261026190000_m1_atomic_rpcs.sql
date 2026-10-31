-- M1-q (spec specs/m1-test-authoring.md revision 5 R5-71 d, e): the lead's owed atomic writes, part 2.
-- 1. R5-63 f: public.create_test_from_template writes a template's job, test, draft version, pools, library copies,
--    pool items, sections and settings in one transaction as the caller. The api keeps every read before it (the
--    template, the settings catalog and the library browse as trace_api, the admin locks) and sends the result as one
--    payload; a failure anywhere leaves nothing behind (the api's best-effort archive of the job and test goes).
-- 2. R5-63 f / R5-64 b and the A2a re-review Low 4: public.save_bank_draft writes a bank draft's content and its answer
--    key in one transaction: `create` (item, version 1, key), `update` (the named draft version's content and key) and
--    `clone` (a new draft version of the item, its key). A submit can no longer land between the content and the key.
-- Both are SECURITY INVOKER with an empty search_path and EXECUTE for authenticated only, so RLS, the column grants and
-- every guard trigger apply exactly as for the api's earlier per-row writes. No result, band or decision is touched
-- (rules 1-3); no candidate data is read (rule 5).

-- ---------------------------------------------------------------------------------------------
-- 1. public.create_test_from_template(p_org, p_payload) → {jobId, testId, versionId}
-- p_payload (DB shape; the api computes it from CreateTestFromTemplateRequest, the template and the library browse):
--   {workspaceId, jobTitle, roleTemplateVersionId, jdSha256?, templateMatchPermille?, totalTimeSeconds, qualityCutoff,
--    presetKey?, presetVersion?, settings (object),
--    sections: 1..10 of {name, format, weight, drawCount, skillKey, shuffleItems, shuffleOptions, navigation,
--      libraryItemVersionIds: ≤ 1,000 approved library item versions (copied 500 a request, R3-8)}}
-- ---------------------------------------------------------------------------------------------
create function public.create_test_from_template(p_org uuid, p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ws uuid;
  v_job uuid;
  v_test uuid;
  v_ver uuid;
  v_ruleset uuid;
  v_sec jsonb;
  v_pool uuid;
  v_ids uuid[];
  v_copied uuid[];
  v_chunk uuid[];
  v_i int;
  v_sections jsonb := '[]'::jsonb;
begin
  if p_org is null or jsonb_typeof(p_payload) is distinct from 'object'
    or jsonb_typeof(p_payload -> 'sections') is distinct from 'array'
    or jsonb_array_length(p_payload -> 'sections') not between 1 and 10
    or jsonb_typeof(p_payload -> 'settings') is distinct from 'object' then
    raise exception 'TRACE_BAD_INPUT: a template draft has 1 to 10 sections and its settings' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_payload -> 'sections') as s
             where jsonb_typeof(s) is distinct from 'object'
               or jsonb_typeof(s -> 'libraryItemVersionIds') is distinct from 'array'
               or jsonb_array_length(s -> 'libraryItemVersionIds') > 1000) then
    raise exception 'TRACE_BAD_INPUT: every section names at most 1,000 library items' using errcode = '22023';
  end if;
  v_ws := (p_payload ->> 'workspaceId')::uuid;

  -- M1-17, E19: the job keeps only the JD's hash and the match permille (the guard checks the template is usable).
  insert into public.jobs (org_id, workspace_id, title, role_template_version_id, jd_sha256, template_match_permille)
    values (p_org, v_ws, p_payload ->> 'jobTitle', (p_payload ->> 'roleTemplateVersionId')::uuid,
      p_payload ->> 'jdSha256', (p_payload ->> 'templateMatchPermille')::int)
    returning id into v_job;
  insert into public.tests (org_id, workspace_id, name, job_id)
    values (p_org, v_ws, p_payload ->> 'jobTitle', v_job)
    returning id into v_test;
  insert into public.test_versions (org_id, test_id, total_time_seconds, quality_cutoff)
    values (p_org, v_test, (p_payload ->> 'totalTimeSeconds')::int, (p_payload ->> 'qualityCutoff')::smallint)
    returning id, ruleset_version_id into v_ver, v_ruleset;

  -- Each section gets a pool named after it, filled with copies of the library items (the copy guard reuses an earlier
  -- copy and refuses anything that is not an approved library item, R3-8; the pool guard the format and skill).
  for v_sec in select e from jsonb_array_elements(p_payload -> 'sections') as x(e) loop
    insert into public.pools (org_id, workspace_id, name, format, skill_key)
      values (p_org, v_ws, v_sec ->> 'name', (v_sec ->> 'format')::public.section_format, v_sec ->> 'skillKey')
      returning id into v_pool;
    select coalesce(array_agg(x::uuid order by n), '{}') into v_ids
    from jsonb_array_elements_text(v_sec -> 'libraryItemVersionIds') with ordinality as t(x, n);
    v_copied := '{}';
    v_i := 1;
    while v_i <= coalesce(array_length(v_ids, 1), 0) loop
      insert into public.library_copy_requests (org_id, workspace_id, library_item_version_ids)
        values (p_org, v_ws, v_ids[v_i:v_i + 499])
        returning result_item_version_ids into v_chunk;
      v_copied := v_copied || v_chunk;
      v_i := v_i + 500;
    end loop;
    insert into public.pool_items (org_id, pool_id, item_version_id)
      select distinct p_org, v_pool, c from unnest(v_copied) as c;
    v_sections := v_sections || jsonb_build_array(jsonb_build_object(
      'name', v_sec -> 'name', 'format', v_sec -> 'format', 'weight', v_sec -> 'weight', 'poolId', v_pool,
      'drawCount', v_sec -> 'drawCount', 'shuffleItems', v_sec -> 'shuffleItems',
      'shuffleOptions', v_sec -> 'shuffleOptions', 'navigation', v_sec -> 'navigation', 'items', '[]'::jsonb));
  end loop;

  -- The sections and the settings through save_test_draft (same guards, same transaction); it stores preset_version
  -- null, so the version whose values the api checked is pinned next (versioning rule; R5-34).
  perform public.save_test_draft(v_ver, jsonb_build_object(
    'name', p_payload -> 'jobTitle', 'totalTimeSeconds', p_payload -> 'totalTimeSeconds',
    'qualityCutoff', p_payload -> 'qualityCutoff', 'presetKey', p_payload -> 'presetKey',
    'settings', p_payload -> 'settings', 'sections', v_sections));
  if p_payload ->> 'presetKey' is not null and p_payload ->> 'presetVersion' is not null then
    update public.ruleset_versions
      set preset_version = (p_payload ->> 'presetVersion')::int
      where org_id = p_org and id = v_ruleset and preset_key = p_payload ->> 'presetKey' and published_at is null;
  end if;
  return jsonb_build_object('jobId', v_job, 'testId', v_test, 'versionId', v_ver);
end
$$;
revoke execute on function public.create_test_from_template(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.create_test_from_template(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. public.save_bank_draft(p_org, p_payload) → the version id, or null when an `update` matched no draft the caller
-- can edit (the api then answers 404 or 409 as before).
-- p_payload (DB shape; the api checks the body, images and param spec and computes the R5-49 a content hash):
--   {mode: 'create' | 'update' | 'clone', workspaceId (create), itemId (update, clone), versionId (update),
--    keyOptionId (an MCQ that is not parameterised; else null), content: {format, stem, options, rubric_version_id,
--    skill_key, difficulty, is_parameterised, param_spec, media, content_sha256}}
-- ---------------------------------------------------------------------------------------------
create function public.save_bank_draft(p_org uuid, p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mode text := p_payload ->> 'mode';
  v_c jsonb := p_payload -> 'content';
  v_key text := p_payload ->> 'keyOptionId';
  v_item uuid;
  v_ver uuid;
begin
  if p_org is null or jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(v_c) is distinct from 'object'
    or v_mode is null or v_mode not in ('create', 'update', 'clone') then
    raise exception 'TRACE_BAD_INPUT: a bank draft names its mode and its content' using errcode = '22023';
  end if;

  if v_mode = 'update' then
    -- I-M1-3: only a draft is edited; the format and the item never change (the item_versions guard too).
    update public.item_versions
      set stem = v_c ->> 'stem', options = nullif(v_c -> 'options', 'null'::jsonb),
        rubric_version_id = (v_c ->> 'rubric_version_id')::uuid, skill_key = v_c ->> 'skill_key',
        difficulty = (v_c ->> 'difficulty')::numeric, is_parameterised = (v_c ->> 'is_parameterised')::boolean,
        param_spec = nullif(v_c -> 'param_spec', 'null'::jsonb), media = nullif(v_c -> 'media', 'null'::jsonb),
        content_sha256 = v_c ->> 'content_sha256'
      where org_id = p_org and id = (p_payload ->> 'versionId')::uuid and item_id = (p_payload ->> 'itemId')::uuid
        and section_id is null and status = 'draft'
      returning id into v_ver;
    if v_ver is null then
      return null;
    end if;
    delete from public.item_answer_keys where org_id = p_org and item_version_id = v_ver;
  else
    if v_mode = 'create' then
      insert into public.items (org_id, workspace_id, format, skill_key)
        values (p_org, (p_payload ->> 'workspaceId')::uuid, (v_c ->> 'format')::public.section_format,
          v_c ->> 'skill_key')
        returning id into v_item;
    else
      v_item := (p_payload ->> 'itemId')::uuid;
    end if;
    -- The guard numbers the version and sets its origin (human), status (draft) and workspace.
    insert into public.item_versions (org_id, item_id, format, stem, options, rubric_version_id, skill_key, difficulty,
        is_parameterised, param_spec, media, content_sha256)
      values (p_org, v_item, (v_c ->> 'format')::public.section_format, v_c ->> 'stem',
        nullif(v_c -> 'options', 'null'::jsonb), (v_c ->> 'rubric_version_id')::uuid, v_c ->> 'skill_key',
        (v_c ->> 'difficulty')::numeric, coalesce((v_c ->> 'is_parameterised')::boolean, false),
        nullif(v_c -> 'param_spec', 'null'::jsonb), nullif(v_c -> 'media', 'null'::jsonb), v_c ->> 'content_sha256')
      returning id into v_ver;
  end if;
  if v_key is not null then
    insert into public.item_answer_keys (org_id, item_version_id, format, key)
      values (p_org, v_ver, 'mcq', jsonb_build_object('option_id', v_key));
  end if;
  return v_ver;
end
$$;
revoke execute on function public.save_bank_draft(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_bank_draft(uuid, jsonb) to authenticated;
