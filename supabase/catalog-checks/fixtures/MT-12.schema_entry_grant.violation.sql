-- MT-12.schema_entry_grant: a per-schema default that gives anon SELECT on every new table in public.
alter default privileges for role postgres in schema public grant select on tables to anon;
