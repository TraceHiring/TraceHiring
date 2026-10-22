-- MT-11.caller_only_null_tested (M0b review M0B-DB-2): no OR, and the clause refers to a column and calls
-- auth.uid(), but only to test that a caller exists (IS NOT NULL), so any signed-in user of any org passes.
create table public.mt_11_signed (org_id uuid not null, deleted_at timestamptz);
alter table public.mt_11_signed enable row level security;
create policy mt_11_signed_select on public.mt_11_signed
for select
to authenticated
using (deleted_at is null and (select auth.uid()) is not null);
