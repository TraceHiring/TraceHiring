-- MT-11.select_delete_without_using: a SELECT policy with no USING (PostgreSQL accepts it, README day-one
-- facts), so every row is visible.
create table public.mt_11_note (note_id uuid, owner_id uuid, body text);
create policy mt_11_note_select on public.mt_11_note
for select
to authenticated;
