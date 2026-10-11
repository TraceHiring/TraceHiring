-- MT-11.insert_without_check: an INSERT policy with no WITH CHECK, so any row can be inserted.
create table public.mt_11_note (note_id uuid, owner_id uuid, body text);
create policy mt_11_note_insert on public.mt_11_note
for insert
to authenticated;
