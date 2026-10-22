-- MT-6.array_column: an enum from schema public with a reject label, used as an array by a column of an integrity table.
create type public.mt_6_state as enum ('open', 'reject_pending');
create table integrity.mt_6_history (org_id uuid not null, states public.mt_6_state[]);
