-- MT-13.owner_dml: a partition created without the revokes has a NULL ACL, so its owner holds every privilege.
create table public.mt_13_owner_dml partition of public.audit_log
  for values from ('2099-03-01 00:00:00+00') to ('2099-04-01 00:00:00+00');
