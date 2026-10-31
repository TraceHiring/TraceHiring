-- Migration M1-i (specs/m1-test-authoring.md R5-62 b; A3a confirming re-review). The mirror stage (trace_worker) checks
-- each served slot and the pool section list against the pinned version (R5-59 a) before it stores responses, so it
-- reads the layout of a version: the position and draw count of its sections and the placement of its inline items.
-- Column-level SELECT only (no names, stems, options, keys or weights), bound to the job org like every worker read.
grant select (id, org_id, test_version_id, position, draw_count) on public.sections to trace_worker;
create policy sections_select_mirror_worker on public.sections for select to trace_worker
  using (org_id = (select private.job_org_id()));

grant select (id, org_id, section_id, test_version_id) on public.item_versions to trace_worker;
create policy item_versions_select_mirror_worker on public.item_versions for select to trace_worker
  using (org_id = (select private.job_org_id()));
