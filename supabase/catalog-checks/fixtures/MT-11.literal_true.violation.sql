-- MT-11.literal_true: a SELECT policy whose USING is literally true on a table that is not a reference table.
create table public.mt_11_note (note_id uuid, owner_id uuid, body text);
create policy mt_11_note_select on public.mt_11_note
for select
to authenticated
using (true);
