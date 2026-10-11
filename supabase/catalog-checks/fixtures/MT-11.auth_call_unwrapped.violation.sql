-- MT-11.auth_call_unwrapped: auth.uid() called directly, so it runs once per row instead of once per
-- statement as (select auth.uid()) would.
create table public.mt_11_note (note_id uuid, owner_id uuid, body text);
create policy mt_11_note_select on public.mt_11_note
for select
to authenticated
using (owner_id = auth.uid());
