-- MT-11.qual_without_column: a SELECT policy whose USING is a constant that is not the literal true (1 = 1), so it
-- refers to no column of its table and calls no function, and every row is visible.
create table public.mt_11_note (note_id uuid, owner_id uuid, body text);
create policy mt_11_note_select on public.mt_11_note
for select
to authenticated
using (1 = 1);
