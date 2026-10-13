-- MT-14.login_dml: a login role that can write a tenant table without SET ROLE.
create role mt_14_login login;
grant insert on public.teams to mt_14_login;
