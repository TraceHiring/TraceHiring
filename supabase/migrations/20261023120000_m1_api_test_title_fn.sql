-- Migration M1-l (specs/m1-test-authoring.md R5-63 i; supersedes M1-k). The candidate invite resolve shows the test's
-- title. M1-k granted trace_api SELECT (id, org_id, name) on public.tests, which loosened the D1 pin
-- "tests: trace_api has no SELECT privilege" (rls_d1_api; not on the R5-28/R5-50 supersession lists). Instead
-- trace_api keeps no privilege on public.tests and reads one test version's name through this definer function,
-- bound to the api org of the transaction (unset → no row), returning nothing else.
drop policy tests_select_api on public.tests;
revoke select (id, org_id, name) on public.tests from trace_api;

create function private.api_test_title(p_test_version_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.name
  from public.test_versions as v
  join public.tests as t on t.org_id = v.org_id and t.id = v.test_id
  where v.id = p_test_version_id
    and v.org_id = (select private.api_org_id())
$$;
revoke execute on function private.api_test_title(uuid) from public, anon, authenticated, service_role;
grant execute on function private.api_test_title(uuid) to trace_api;
