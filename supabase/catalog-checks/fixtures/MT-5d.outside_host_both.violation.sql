-- MT-5d.outside_host_both: a policy on a public table whose USING reads a quality table and an integrity table.
-- A plain table outside the two schemas may hold foreign keys into both (founder decision 2026-10-11), but code on
-- it must not combine them.
create table quality.mt_5d_score (session_id uuid, points int);
create table integrity.mt_5d_signal (session_id uuid, band text);
create table public.mt_5d_report (org_id uuid not null, session_id uuid);
create policy mt_5d_report_select on public.mt_5d_report
for select
to authenticated
using (
  exists (
    select 1
    from quality.mt_5d_score as s
    join integrity.mt_5d_signal as g on g.session_id = s.session_id
    where s.session_id = mt_5d_report.session_id
  )
);
