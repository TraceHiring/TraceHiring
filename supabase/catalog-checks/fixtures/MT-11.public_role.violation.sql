-- MT-11.public_role: a policy applied to PUBLIC instead of a named role.
create table public.mt_11_note (note_id uuid, owner_id uuid, body text);
create policy mt_11_note_select on public.mt_11_note
for select
to public
using (owner_id is not null);
