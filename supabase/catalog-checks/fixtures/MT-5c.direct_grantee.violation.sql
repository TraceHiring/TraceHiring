-- MT-5c.direct_grantee: one role granted SELECT on a quality table and on an integrity table.
create role mt_5c_reader nologin;
create table quality.mt_5c_score (session_id uuid, points int);
create table integrity.mt_5c_signal (session_id uuid, band text);
grant select on quality.mt_5c_score to mt_5c_reader;
grant select on integrity.mt_5c_signal to mt_5c_reader;
