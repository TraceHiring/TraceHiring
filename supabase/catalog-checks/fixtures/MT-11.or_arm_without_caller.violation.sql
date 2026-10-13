-- MT-11.or_arm_without_caller (M0b review M0B-DB-2): the clause calls auth.uid(), but one arm of its top-level OR
-- does not depend on the caller, so that arm alone opens every org's rows to any signed-in user. The other arm
-- only tests that a caller exists, which is no caller check either.
create table public.mt_11_open (org_id uuid not null, deleted_at timestamptz);
alter table public.mt_11_open enable row level security;
create policy mt_11_open_select on public.mt_11_open
for select
to authenticated
using (deleted_at is null or (select auth.uid()) is not null);
