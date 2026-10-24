-- MT-11.coalesce_arg_without_caller (M0b review FR-1, M1 Wave 0): COALESCE falls back to true when its first
-- argument is null, and org_id = job_org_id() is null whenever no job org is set, so a worker without a job
-- context reads every org's rows.
create table public.mt_11_coalesce (org_id uuid not null);
alter table public.mt_11_coalesce enable row level security;
create policy mt_11_coalesce_select on public.mt_11_coalesce
for select
to trace_worker
using (coalesce(org_id = (select private.job_org_id()), true));
