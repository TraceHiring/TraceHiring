-- MT-11.update_missing_clause: an UPDATE policy with USING but no WITH CHECK.
create table public.mt_11_note (note_id uuid, owner_id uuid, body text);
create policy mt_11_note_update on public.mt_11_note
for update
to authenticated
using (owner_id is not null);
