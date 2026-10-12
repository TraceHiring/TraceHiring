-- MT-6.direct_column: an enum from schema public with a reject label, used directly by a column of an integrity table.
create type public.mt_6_status as enum ('kept', 'rejected');
create table integrity.mt_6_review (org_id uuid not null, status public.mt_6_status);
