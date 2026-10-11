-- MT-11 (spec specs/m0-foundations.md §8.5, separate per-operation policies, CLAUDE.md): a policy on an in-scope
-- table that is:
--   for_all: FOR ALL (polcmd *).
--   insert_without_check: an INSERT policy without WITH CHECK.
--   update_missing_clause: an UPDATE policy without USING or without WITH CHECK.
--   select_delete_without_using: a SELECT or DELETE policy without USING.
--   public_role: applied to PUBLIC (0 in polroles, which is what a policy with no TO clause gets).
--   literal_true: USING or WITH CHECK is literally true, on a table that is not on the reference list below.
--   auth_call_unwrapped: USING or WITH CHECK calls auth.uid() or auth.jwt() (a FUNCEXPR node in the stored node
--     tree, polqual or polwithcheck) that does not sit inside a scalar sub-select (an EXPR_SUBLINK node,
--     subLinkType 4), so the call runs per row. (select (auth.jwt() ->> 'org_id')::uuid) is compliant.
-- In-scope tables: every relation in public, private, quality and integrity, every relation that postgres can SET
-- ROLE to the owner of in a system-list schema where a migration can still create objects (escape_schema below),
-- and every pg_inherits descendant of those (INHERITS children and partitions, recursively, wherever they live).
-- Extension members are skipped by the README rule. A policy that breaks a rule above on a table outside the four
-- schemas is reported under one branch for where the table lives, with the rule in the detail:
--   system_schema_policy: the table is in a system-list schema.
--   inherited_table_policy: the table is a descendant in any other schema.
with recursive
reference_table (schema_name, table_name, adr) as (
  values
    -- One row per reference table whose policies may be literally true, each citing its ADR, e.g.
    -- ('public', 'countries', 'ADR-0NN reference data'),
    -- Empty in M0a. The null row below only types the columns and is ignored.
    (null::name, null::name, null::text)
),
scope_schema as (
  select n.oid
  from pg_namespace as n
  where n.nspname in ('public', 'private', 'quality', 'integrity')
),
-- shared:escape begin (the same text in MT-5a, MT-5b, MT-5d, MT-10 and MT-11)
-- escape_schema: system-list schemas where a migration can still create objects (spec §8.5 revision 12): postgres
-- can SET ROLE to the schema owner, or to a role with CREATE on it. Locally: extensions, _realtime,
-- supabase_functions and supabase_migrations, plus any listed schema that a migration creates (cron, net and so on).
escape_schema as (
  select n.oid
  from pg_namespace as n
  where n.nspname in (
      'auth', 'storage', 'extensions', 'realtime', '_realtime', 'graphql', 'graphql_public', 'supabase_functions',
      'supabase_migrations', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgbouncer', '_analytics'
    )
    and (
      pg_has_role('postgres', n.nspowner, 'SET')
      or exists (
        select 1
        from pg_roles as r
        where pg_has_role('postgres', r.oid, 'SET')
          and has_schema_privilege(r.oid, n.oid, 'CREATE')
      )
    )
),
-- shared:escape end
scope_rel (oid) as (
  select c.oid
  from pg_class as c
  where c.relnamespace in (select s.oid from scope_schema as s)
  union
  select c.oid
  from pg_class as c
  where c.relnamespace in (select es.oid from escape_schema as es)
    and pg_has_role('postgres', c.relowner, 'SET')
  union
  select i.inhrelid
  from scope_rel as s
  join pg_inherits as i on i.inhparent = s.oid
),
auth_function as (
  select p.oid
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'auth'
    and p.proname in ('uid', 'jwt')
),
scope_policy as (
  select
    pol.oid,
    pol.polcmd,
    pol.polroles,
    pol.polqual is not null as has_using,
    pol.polwithcheck is not null as has_check,
    coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') as using_text,
    coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') as check_text,
    n.nspname,
    c.relname,
    format('%I on %I.%I', pol.polname, n.nspname, c.relname)::text as qualified_name,
    case
      when c.relnamespace in (select s.oid from scope_schema as s) then 'scope'
      when c.relnamespace in (select es.oid from escape_schema as es) then 'system'
      else 'inherited'
    end as location
  from pg_policy as pol
  join pg_class as c on c.oid = pol.polrelid
  join scope_rel as s on s.oid = c.oid
  join pg_namespace as n on n.oid = c.relnamespace
  where not exists (
    select 1
    from pg_depend as d
    join pg_extension as x on x.oid = d.refobjid
    where d.classid = 'pg_class'::regclass
      and d.objid = c.oid
      and d.refclassid = 'pg_extension'::regclass
      and d.deptype = 'e'
      and x.extnamespace = c.relnamespace
  )
),
-- policy_tree: each USING and WITH CHECK of a scope policy as its stored node tree, with every backslash-escaped
-- character removed, so every brace left opens or closes a node.
policy_tree (oid, clause, tree) as (
  select pol.oid, 'USING'::text, regexp_replace(pol.polqual::text, '\\.', '', 'g')
  from pg_policy as pol
  where pol.polqual is not null
    and pol.oid in (select sp.oid from scope_policy as sp)
  union all
  select pol.oid, 'WITH CHECK'::text, regexp_replace(pol.polwithcheck::text, '\\.', '', 'g')
  from pg_policy as pol
  where pol.polwithcheck is not null
    and pol.oid in (select sp.oid from scope_policy as sp)
),
-- tree_piece: the tree split before every brace, in order. depth is the nesting level after the piece's brace.
tree_piece (oid, clause, ord, piece, depth) as (
  select
    pt.oid,
    pt.clause,
    x.ord,
    x.piece,
    sum(case left(x.piece, 1) when '{' then 1 when '}' then -1 else 0 end)
      over (partition by pt.oid, pt.clause order by x.ord)
  from policy_tree as pt
  cross join lateral regexp_split_to_table(pt.tree, '(?=[{}])') with ordinality as x(piece, ord)
),
-- tree_node: one row per node ({NODE ...), with end_ord, the piece that closes it. Opens at one level and the closes
-- back from that level alternate, so the n-th of each pair up.
tree_node (oid, clause, ord, piece, end_ord) as (
  select o.oid, o.clause, o.ord, o.piece, c.ord
  from (
    select
      p.oid,
      p.clause,
      p.ord,
      p.piece,
      p.depth,
      row_number() over (partition by p.oid, p.clause, p.depth order by p.ord) as rn
    from tree_piece as p
    where left(p.piece, 1) = '{'
  ) as o
  join (
    select
      p.oid,
      p.clause,
      p.ord,
      p.depth + 1 as lvl,
      row_number() over (partition by p.oid, p.clause, p.depth order by p.ord) as rn
    from tree_piece as p
    where left(p.piece, 1) = '}'
  ) as c on c.oid = o.oid and c.clause = o.clause and c.lvl = o.depth and c.rn = o.rn
),
finding (oid, branch, detail) as (
  select
    sp.oid,
    'for_all'::text,
    'policy is FOR ALL, not one policy per operation'::text
  from scope_policy as sp
  where sp.polcmd = '*'
  union all
  select
    sp.oid,
    'insert_without_check'::text,
    'INSERT policy has no WITH CHECK'::text
  from scope_policy as sp
  where sp.polcmd = 'a'
    and not sp.has_check
  union all
  select
    sp.oid,
    'update_missing_clause'::text,
    format(
      'UPDATE policy has no %s',
      case
        when not sp.has_using and not sp.has_check then 'USING and no WITH CHECK'
        when not sp.has_using then 'USING'
        else 'WITH CHECK'
      end
    )::text
  from scope_policy as sp
  where sp.polcmd = 'w'
    and (not sp.has_using or not sp.has_check)
  union all
  select
    sp.oid,
    'select_delete_without_using'::text,
    format('%s policy has no USING', case when sp.polcmd = 'r' then 'SELECT' else 'DELETE' end)::text
  from scope_policy as sp
  where sp.polcmd in ('r', 'd')
    and not sp.has_using
  union all
  select
    sp.oid,
    'public_role'::text,
    'policy applies to PUBLIC'::text
  from scope_policy as sp
  where 0::oid = any(sp.polroles)
  union all
  select
    sp.oid,
    'literal_true'::text,
    'USING or WITH CHECK is literally true'::text
  from scope_policy as sp
  where (sp.using_text = 'true' or sp.check_text = 'true')
    and not exists (
      select 1
      from reference_table as rt
      where rt.schema_name = sp.nspname
        and rt.table_name = sp.relname
        and rt.adr ~ '^ADR-[0-9]+'
    )
  union all
  select distinct
    f.oid,
    'auth_call_unwrapped'::text,
    format('auth.uid() or auth.jwt() is called outside a scalar sub-select in %s', f.clause)::text
  from tree_node as f
  where substring(f.piece from '^\{FUNCEXPR :funcid ([0-9]+) ')::oid in (select af.oid from auth_function as af)
    and not exists (
      select 1
      from tree_node as s
      where s.oid = f.oid
        and s.clause = f.clause
        and s.piece like '{SUBLINK :subLinkType 4 %'
        and s.ord < f.ord
        and f.ord < s.end_ord
    )
)
select
  case sp.location
    when 'system' then 'system_schema_policy'
    when 'inherited' then 'inherited_table_policy'
    else f.branch
  end::text as branch,
  sp.qualified_name as object,
  case sp.location
    when 'system' then format('on a table in a system schema: %s (%s)', f.detail, f.branch)
    when 'inherited' then format('on an inherited table outside the four schemas: %s (%s)', f.detail, f.branch)
    else f.detail
  end::text as detail
from finding as f
join scope_policy as sp on sp.oid = f.oid
