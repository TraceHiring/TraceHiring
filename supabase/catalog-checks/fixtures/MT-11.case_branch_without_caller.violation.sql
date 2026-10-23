-- MT-11.case_branch_without_caller (M0b review FR-1, M1 Wave 0): a CASE whose WHEN binds a D1 caller helper to
-- a column, but whose ELSE ignores the caller, so a reviewer sees every live row of every org.
create table public.mt_11_case (org_id uuid not null, test_id uuid, deleted_at timestamptz);
alter table public.mt_11_case enable row level security;
create policy mt_11_case_select on public.mt_11_case
for select
to authenticated
using (
  case
    when test_id = any((select private.my_assigned_test_ids('{reviewer}'::public.org_role[]))::uuid[]) then true
    else deleted_at is null
  end
);
