-- MT-11.caller_bound_elsewhere (M0b review FR-1, M1 Wave 0): auth.uid() is compared to a column, but of another
-- table, in an EXISTS that is not correlated to the policy's table: any user with a membership in any org sees
-- every live row of every org.
create table public.mt_11_member (org_id uuid not null, deleted_at timestamptz);
alter table public.mt_11_member enable row level security;
create policy mt_11_member_select on public.mt_11_member
for select
to authenticated
using (
  deleted_at is null
  and exists (select 1 from public.memberships as m where m.user_id = (select auth.uid()))
);
