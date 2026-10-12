-- MT-14.both_schemas: one role given USAGE on both quality and integrity (rule 1).
create role mt_14_both nologin;
grant usage on schema quality, integrity to mt_14_both;
