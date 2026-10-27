-- MT-15.age_column: an in-scope table with an age column (rule 9: an under-18 row is never stored, R2-20).
create table public.mt_15_ages (org_id uuid not null, candidate_age int);
