-- Migration M1-k (specs/m1-test-authoring.md R5-63; A2b lead ask 1). The candidate invite resolve shows the test's
-- title from tests.name instead of parsing the whole stored package, so trace_api reads a test's id, org and name.
-- Column-level SELECT only (no workspace, creator, job or invitation counter), bound to the api org of the
-- transaction like every trace_api read; no write.
grant select (id, org_id, name) on public.tests to trace_api;
create policy tests_select_api on public.tests for select to trace_api
  using (org_id = (select private.api_org_id()));
