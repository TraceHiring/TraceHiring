-- MT-6.range_column: an enum from schema public with a reject label, used by an integrity column through the
-- multirange of a range over it, so both the multirange step and the range step (pg_range) are exercised.
create type public.mt_6_stage as enum ('open', 'rejected');
create type public.mt_6_stage_range as range (
  subtype = public.mt_6_stage,
  multirange_type_name = public.mt_6_stage_spans
);
create table integrity.mt_6_spans (org_id uuid not null, spans public.mt_6_stage_spans);
