-- MT-13 (spec specs/m0b-tenancy.md §2.4, §5, AT-B3): the audit log stays append-only for every role. For every
-- member of pg_partition_tree('public.audit_log') (the parent, each month and DEFAULT):
--   rls_off: row level security is off.
--   acl: a role other than the owner holds INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES or MAINTAIN.
--   owner_dml: the owner holds UPDATE, DELETE or TRUNCATE. ACLs are read through
--     coalesce(relacl, acldefault('r', relowner)), because a relation created without the revokes has a NULL ACL,
--     which means every privilege for its owner (E4).
--   no_row_trigger: no BEFORE UPDATE OR DELETE row trigger calling private.audit_log_append_only().
--   no_truncate_trigger: no BEFORE TRUNCATE statement trigger calling it (TRUNCATE triggers are not inherited).
--   not_always: such a trigger exists but is not ENABLE ALWAYS (tgenabled A), so replica mode would skip it (D3).
--   missing_parent: public.audit_log is missing or is not a partitioned table.
-- Owner DDL (DROP or DISABLE TRIGGER, DETACH PARTITION) stays possible by design and is what this check catches.
with part as (
  select c.oid, n.nspname, c.relname, c.relrowsecurity, c.relacl, c.relowner
  from pg_partition_tree(to_regclass('public.audit_log')) as t
  join pg_class as c on c.oid = t.relid
  join pg_namespace as n on n.oid = c.relnamespace
),
acl as (
  select p.nspname, p.relname, p.relowner, a.grantee, a.privilege_type
  from part as p
  cross join lateral aclexplode(coalesce(p.relacl, acldefault('r', p.relowner))) as a
),
guard_trigger as (
  select
    p.oid,
    tg.tgenabled,
    (tg.tgtype & 1) = 1 and (tg.tgtype & 2) = 2 and (tg.tgtype & 8) = 8 and (tg.tgtype & 16) = 16 as is_row,
    (tg.tgtype & 1) = 0 and (tg.tgtype & 2) = 2 and (tg.tgtype & 32) = 32 as is_truncate
  from part as p
  join pg_trigger as tg on tg.tgrelid = p.oid
  where tg.tgfoid = to_regprocedure('private.audit_log_append_only()')
)
select
  'missing_parent'::text as branch,
  'public.audit_log'::text as object,
  'public.audit_log is missing or not partitioned'::text as detail
where not exists (
  select 1
  from pg_class as c
  where c.oid = to_regclass('public.audit_log')
    and c.relkind = 'p'
)
union all
select
  'rls_off'::text,
  format('%I.%I', p.nspname, p.relname)::text,
  'row level security is off'::text
from part as p
where not p.relrowsecurity
union all
select
  'acl'::text,
  format('%I.%I', a.nspname, a.relname)::text,
  format('%s holds %s', case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
    a.privilege_type)::text
from acl as a
where a.grantee <> a.relowner
  and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
union all
select
  'owner_dml'::text,
  format('%I.%I', a.nspname, a.relname)::text,
  format('the owner holds %s', a.privilege_type)::text
from acl as a
where a.grantee = a.relowner
  and a.privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
union all
select
  'no_row_trigger'::text,
  format('%I.%I', p.nspname, p.relname)::text,
  'no BEFORE UPDATE OR DELETE row trigger calling private.audit_log_append_only()'::text
from part as p
where not exists (
  select 1
  from guard_trigger as g
  where g.oid = p.oid
    and g.is_row
)
union all
select
  'no_truncate_trigger'::text,
  format('%I.%I', p.nspname, p.relname)::text,
  'no BEFORE TRUNCATE statement trigger calling private.audit_log_append_only()'::text
from part as p
where not exists (
  select 1
  from guard_trigger as g
  where g.oid = p.oid
    and g.is_truncate
)
union all
select
  'not_always'::text,
  format('%I.%I', p.nspname, p.relname)::text,
  format('an append-only trigger has tgenabled %s, not A', g.tgenabled)::text
from part as p
join guard_trigger as g on g.oid = p.oid
where (g.is_row or g.is_truncate)
  and g.tgenabled <> 'A'
