-- MT-6.domain_column: an enum from schema public with a reject label, used by an integrity column through nested domains.
create type public.mt_6_verdict as enum ('ok', 'reject');
create domain public.mt_6_inner as public.mt_6_verdict;
create domain public.mt_6_outer as public.mt_6_inner;
create table integrity.mt_6_decision (org_id uuid not null, verdict public.mt_6_outer);
