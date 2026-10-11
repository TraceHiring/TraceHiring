-- MT-5d.table_rule: a rewrite rule on an integrity table that writes a quality table. A rule runs with the table
-- owner's rights, so it also bypasses the caller's RLS. Trace never needs table rules.
create table quality.mt_5d_score (session_id uuid, points int);
create table integrity.mt_5d_signal (session_id uuid, confirmed boolean);
create rule mt_5d_reset as on update to integrity.mt_5d_signal
where new.confirmed
do also update quality.mt_5d_score set points = 0 where session_id = new.session_id;
