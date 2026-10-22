-- MT-9.wrong_owner: an in-scope table owned by a role other than postgres.
-- postgres has CREATEROLE but only ADMIN OPTION on the new role, so it grants itself membership to hand over.
create role mt_9_owner nologin;
grant mt_9_owner to postgres;
grant create on schema private to mt_9_owner;
create table private.mt_9_foreign_owned (org_id uuid not null);
alter table private.mt_9_foreign_owned owner to mt_9_owner;
