-- MT-11.caller_unbound (M0b FIX re-review FR-1): no OR, and the caller call is not null-tested, but it is
-- compared to a constant, not to a column of the table: every signed-in user has role 'authenticated', so any
-- signed-in user of any org passes.
create table public.mt_11_role (org_id uuid not null, deleted_at timestamptz);
alter table public.mt_11_role enable row level security;
create policy mt_11_role_select on public.mt_11_role
for select
to authenticated
using (deleted_at is null and (select auth.jwt() ->> 'role') = 'authenticated');
