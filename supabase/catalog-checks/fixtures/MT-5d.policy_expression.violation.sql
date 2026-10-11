-- MT-5d.policy_expression: a policy on a quality table whose USING expression reads an integrity table.
create table quality.mt_5d_score (session_id uuid, points int);
create table integrity.mt_5d_signal (session_id uuid, band text);
create policy mt_5d_score_select on quality.mt_5d_score
for select
to authenticated
using (
  exists (
    select 1
    from integrity.mt_5d_signal as g
    where g.session_id = mt_5d_score.session_id
  )
);
