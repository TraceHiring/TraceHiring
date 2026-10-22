-- MT-6.composite_column: an enum from schema public with a reject label, used by an integrity column through an
-- attribute of a composite type.
create type public.mt_6_flag as enum ('ok', 'rejected');
create type public.mt_6_wrap as (flag public.mt_6_flag);
create table integrity.mt_6_wrapped (org_id uuid not null, wrapped public.mt_6_wrap);
