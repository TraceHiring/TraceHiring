-- MT-8.schema_wrong_owner: the reserved schema quality is owned by a role other than postgres.
-- postgres has CREATEROLE, so it gets only ADMIN OPTION on the new role and must grant itself membership to hand over.
create role mt_8_owner nologin;
grant mt_8_owner to postgres;
alter schema quality owner to mt_8_owner;
