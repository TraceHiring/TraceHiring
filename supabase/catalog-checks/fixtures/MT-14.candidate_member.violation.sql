-- MT-14.candidate_member: another role made a member of trace_candidate with inherit.
create role mt_14_member nologin;
grant trace_candidate to mt_14_member with inherit true, set false;
