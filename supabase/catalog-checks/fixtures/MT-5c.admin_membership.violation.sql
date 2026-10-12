-- MT-5c.admin_membership: a worker that inherits a quality role and holds only ADMIN OPTION (no inherit, no set) on
-- an integrity role. ADMIN lets it grant itself inherit and set later, so it holds both schemas.
create role mt_5c_quality_reader nologin;
create role mt_5c_integrity_reader nologin;
create role mt_5c_worker nologin;
grant usage on schema quality to mt_5c_quality_reader;
grant usage on schema integrity to mt_5c_integrity_reader;
grant mt_5c_quality_reader to mt_5c_worker;
grant mt_5c_integrity_reader to mt_5c_worker with admin true, inherit false, set false;
