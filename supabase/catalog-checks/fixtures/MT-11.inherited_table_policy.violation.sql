-- MT-11.inherited_table_policy: a FOR ALL policy on an INHERITS child of a public table. The child lives in a new
-- schema outside the four, so only the pg_inherits path brings it into scope.
create table public.mt_11_note (note_id uuid, owner_id uuid, body text);
create schema mt_11_ext;
create table mt_11_ext.mt_11_note_child () inherits (public.mt_11_note);
create policy mt_11_note_all on mt_11_ext.mt_11_note_child
for all
to authenticated
using (owner_id is not null)
with check (owner_id is not null);
