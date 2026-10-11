-- MT-11.auth_only_clause: two policies whose clause only checks that the caller is logged in. They refer to no
-- column of their table and call no function in private, so every logged-in user of any org sees (or deletes)
-- every row. auth.uid() is wrapped in a scalar sub-select and auth.role() is not auth.uid() or auth.jwt(), so
-- auth_call_unwrapped does not fire.
create table public.mt_11_note (org_id uuid not null, owner_id uuid, body text);
alter table public.mt_11_note enable row level security;
create policy mt_11_note_select on public.mt_11_note
for select
to authenticated
using ((select auth.uid()) is not null);
create policy mt_11_note_delete on public.mt_11_note
for delete
to authenticated
using (auth.role() = 'authenticated');
