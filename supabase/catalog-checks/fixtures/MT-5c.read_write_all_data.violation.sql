-- MT-5c.read_write_all_data: a new role made a member of pg_read_all_data. postgres holds ADMIN OPTION on
-- pg_read_all_data but not on pg_write_all_data (README day-one facts), so the fixture uses pg_read_all_data.
create role mt_5c_analyst nologin;
grant pg_read_all_data to mt_5c_analyst;
