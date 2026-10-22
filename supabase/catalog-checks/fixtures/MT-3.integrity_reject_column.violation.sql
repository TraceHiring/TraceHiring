-- MT-3.integrity_reject_column: a table in schema integrity with an auto_reject column.
create table integrity.mt_3_flags (org_id uuid not null, auto_reject boolean not null);
