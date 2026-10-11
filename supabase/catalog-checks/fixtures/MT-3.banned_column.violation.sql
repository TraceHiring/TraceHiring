-- MT-3.banned_column: an in-scope table with a date_of_birth column (matches the banned pattern %birth%).
create table public.mt_3_people (org_id uuid not null, date_of_birth date);
