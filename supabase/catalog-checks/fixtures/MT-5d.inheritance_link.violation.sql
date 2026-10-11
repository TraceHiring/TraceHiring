-- MT-5d.inheritance_link: an integrity table that INHERITS from a quality table, so a scan of the quality table
-- returns integrity rows.
create table quality.mt_5d_score (session_id uuid, points int);
create table integrity.mt_5d_signal (band text) inherits (quality.mt_5d_score);
