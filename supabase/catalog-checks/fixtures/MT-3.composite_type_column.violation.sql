-- MT-3.composite_type_column: an in-scope composite type with a date_of_birth attribute (banned pattern %birth%). A
-- table column of this type would store the banned field under a harmless column name.
create type public.mt_3_person as (date_of_birth date);
