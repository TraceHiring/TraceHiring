-- MT-11.nested_or_arm_without_caller (M0b review FR-1, M1 Wave 0): the root is an AND, so or_arm_without_caller
-- does not apply, and the clause binds a D1 caller helper to a column, but in one arm of an OR below the AND only:
-- the other arm, deleted_at is null, lets the API read every org's live drafts.
create table public.mt_11_nested (org_id uuid not null, status text, deleted_at timestamptz);
alter table public.mt_11_nested enable row level security;
create policy mt_11_nested_select on public.mt_11_nested
for select
to trace_api
using (status = 'draft' and (org_id = (select private.api_org_id()) or deleted_at is null));
