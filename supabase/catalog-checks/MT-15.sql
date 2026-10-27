-- MT-15 (spec specs/m2-scheduling-invites.md revision 5 R2-20, R5-16, I-M2-1, I-M2-9, rule 9): a column (attnum > 0,
-- not dropped) of a table, partitioned table, view, materialized view or foreign table in scope that looks like a
-- plaintext contact or an age.
--   plaintext_contact_column: the lower-cased name contains phone, mobile, email, full_name, first_name, last_name or
--     surname and does not end in _ct, _bidx, _hint or _hmac (ciphertext, blind index, display hint, HMAC). The one
--     allowed column is public.invitations.contact_email, whose CHECK pins it to synthetic @example.test addresses (D1).
--   age_column: the name is age or ends in _age or _age_years (an under-18 row is never stored, and MT-3 bans dob and
--     birth patterns).
-- Same scope (partitions and INHERITS descendants included) and skips as MT-1 and MT-3. Underscores are escaped with the
-- default LIKE escape.
with recursive scope_schema as (
  select n.oid
  from pg_namespace as n
  where n.nspname in ('public', 'private', 'quality', 'integrity')
),
scope_rel (oid) as (
  select c.oid
  from pg_class as c
  where c.relnamespace in (select s.oid from scope_schema as s)
  union
  select t.relid
  from pg_class as c
  cross join lateral pg_partition_tree(c.oid) as t
  where c.relkind = 'p'
    and c.relnamespace in (select s.oid from scope_schema as s)
  union
  select i.inhrelid
  from pg_inherits as i
  join scope_rel as r on r.oid = i.inhparent
),
scope_column as (
  select n.nspname, c.relname, lower(a.attname) as attname
  from pg_class as c
  join scope_rel as s on s.oid = c.oid
  join pg_namespace as n on n.oid = c.relnamespace
  join pg_attribute as a on a.attrelid = c.oid
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and a.attnum > 0
    and not a.attisdropped
    and not exists (
      select 1
      from pg_depend as d
      join pg_extension as e on e.oid = d.refobjid
      where d.classid = 'pg_class'::regclass
        and d.objid = c.oid
        and d.refclassid = 'pg_extension'::regclass
        and d.deptype = 'e'
        and e.extnamespace = c.relnamespace
    )
),
contact_word (pattern) as (
  values ('%phone%'), ('%mobile%'), ('%email%'), ('%full\_name%'), ('%first\_name%'), ('%last\_name%'), ('%surname%')
),
allowed (nspname, relname, attname) as (
  values ('public'::name, 'invitations'::name, 'contact_email'::text)
)
select distinct
  'plaintext_contact_column'::text as branch,
  format('%I.%I.%I', sc.nspname, sc.relname, sc.attname)::text as object,
  format('column name matches %s without a _ct, _bidx, _hint or _hmac suffix', w.pattern)::text as detail
from scope_column as sc
join contact_word as w on sc.attname like w.pattern
where sc.attname not like '%\_ct'
  and sc.attname not like '%\_bidx'
  and sc.attname not like '%\_hint'
  and sc.attname not like '%\_hmac'
  and not exists (
    select 1 from allowed as al
    where al.nspname = sc.nspname and al.relname = sc.relname and al.attname = sc.attname
  )
union all
select
  'age_column'::text,
  format('%I.%I.%I', sc.nspname, sc.relname, sc.attname)::text,
  'column is an age'::text
from scope_column as sc
where sc.attname = 'age'
  or sc.attname like '%\_age'
  or sc.attname like '%\_age\_years'
