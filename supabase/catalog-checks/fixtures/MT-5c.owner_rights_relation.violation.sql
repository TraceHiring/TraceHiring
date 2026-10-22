-- MT-5c.owner_rights_relation: a worker that may read a quality table and a materialized view in private over an
-- integrity table. A materialized view (like a view without security_invoker=true) reads with its owner's rights,
-- so the worker reads both schemas without holding any privilege in integrity.
create role mt_5c_qworker nologin;
create table quality.mt_5c_score (session_id uuid, points int);
create table integrity.mt_5c_signal (session_id uuid, confirmed boolean);
grant usage on schema quality to mt_5c_qworker;
grant select on quality.mt_5c_score to mt_5c_qworker;
create materialized view private.mt_5c_flags as
select g.session_id, g.confirmed from integrity.mt_5c_signal as g;
grant usage on schema private to mt_5c_qworker;
grant select on private.mt_5c_flags to mt_5c_qworker;
