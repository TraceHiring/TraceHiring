-- MT-11.for_all: a FOR ALL policy instead of one policy per operation.
create table public.mt_11_note (note_id uuid, owner_id uuid, body text);
create policy mt_11_note_all on public.mt_11_note
for all
to authenticated
using (owner_id is not null)
with check (owner_id is not null);
