-- MT-5c.role_membership: two roles that each hold one schema, and a third role that is a member of both.
create role mt_5c_quality_reader nologin;
create role mt_5c_integrity_reader nologin;
create role mt_5c_worker nologin;
grant usage on schema quality to mt_5c_quality_reader;
grant usage on schema integrity to mt_5c_integrity_reader;
grant mt_5c_quality_reader, mt_5c_integrity_reader to mt_5c_worker;
