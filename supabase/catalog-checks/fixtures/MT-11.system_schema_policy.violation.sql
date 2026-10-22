-- MT-11.system_schema_policy: a FOR ALL policy on a table in _realtime, a system-list schema where postgres can
-- create objects.
create table _realtime.mt_11_note (note_id uuid, owner_id uuid, body text);
create policy mt_11_note_all on _realtime.mt_11_note
for all
to authenticated
using (owner_id is not null)
with check (owner_id is not null);
