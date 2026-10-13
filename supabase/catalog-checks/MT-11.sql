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
--   qual_without_column: a USING or WITH CHECK that is not literally true (that is literal_true) and, in its node
--     tree, refers to no column of the policy's table (a VAR whose varlevelsup equals the number of QUERY nodes
--     around it), calls no function in schema private and none in schema auth (a function, operator function,
--     aggregate or window function), such as 1 = 1, not false or now() < '2030-01-01', on a table that is not on
--     the reference list below.
--   auth_only_clause: the same, except that the clause calls a function in schema auth, such as
--     (select auth.uid()) is not null or auth.role() = 'authenticated'. It only checks that the caller is logged
--     in, so every logged-in user of every org passes. A helper in private, such as (select private.is_staff()),
--     is compliant: only functions in private (matched by schema name) exempt a clause without a column.
--     Neither qual_without_column nor auth_only_clause looks at a RESTRICTIVE policy (as restrictive), which only
--     narrows what the permissive policies allow: Supabase's MFA pattern, as restrictive for select to
--     authenticated using ((select auth.jwt() ->> 'aal') = 'aal2'), is compliant.
--   no_caller_reference (M0b, M0a review DB-1, M0b review M0B-DB-2): a USING or WITH CHECK of a PERMISSIVE policy
--     that refers to a column of its table or calls a function in private, but calls none of the caller-dependent
--     helpers (the allow-list in helper_function: auth.uid, auth.jwt, private.my_org_ids, private.my_workspace_ids,
--     private.caller_roles), on a table that is not on the reference list, such as the soft-delete clause
--     using (deleted_at is null) or deleted_at is null or (select private.valid_roles(...)). It never depends on
--     who is asking, so it ORs open every org's rows. The same clause in a RESTRICTIVE policy only narrows and passes.
--   or_arm_without_caller (M0b review M0B-DB-2): the same kind of clause calls a caller-dependent helper, but its
--     root is an OR with an arm (followed through nested ORs) that has no caller-dependent call outside an
--     IS [NOT] NULL test, such as deleted_at is null or (select auth.uid()) is not null: that arm alone lets every
--     signed-in user of every org through.
--   caller_only_null_tested (M0b review M0B-DB-2): the same, with no OR at the root: every caller-dependent call
--     sits inside an IS [NOT] NULL test, such as deleted_at is null and (select auth.uid()) is not null, which only
--     asks whether someone is signed in. An OR below an AND or a NOT is not followed: the check is a net, and each
--     table's rls_* tests (allowed and denied cases per role) remain the proof.
--   system_list_policy (M0b, M0a catalog pass C review E3): any policy on any relation in a system-list schema,
--     whoever owns the relation (supautils lets postgres create policies on auth, storage and realtime tables).
--     Trace uses R2 and Durable Objects, not Supabase Storage or Realtime, and adds no policy there.
-- In-scope tables: every relation in public, private, quality and integrity, every relation whose owner postgres
-- is a member of in a system-list schema where a migration can still create objects (escape_schema below),
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
    -- The null row below only types the columns and is ignored.
    (null::name, null::name, null::text),
    -- M0b (spec specs/m0b-tenancy.md §3.8, D6): worker-only table, policies for trace_worker only.
    ('public', 'idempotency_keys', 'ADR-029 worker-only ledger, no app role has a grant')
),
scope_schema as (
  select n.oid
  from pg_namespace as n
  where n.nspname in ('public', 'private', 'quality', 'integrity')
),
-- shared:escape begin (the same text in MT-5a, MT-5b, MT-5d, MT-10 and MT-11)
-- escape_schema: system-list schemas where a migration can still create objects (spec §8.5 revision 12): postgres
-- is a member (INHERIT, SET or ADMIN) of the schema owner or of a role with CREATE on it. An ADMIN-only member can
-- grant itself SET. Locally: extensions, _realtime, supabase_functions and supabase_migrations, plus any listed
-- schema that a migration creates (cron, net and so on).
escape_schema as (
  select n.oid
  from pg_namespace as n
  where n.nspname in (
      'auth', 'storage', 'extensions', 'realtime', '_realtime', 'graphql', 'graphql_public', 'supabase_functions',
      'supabase_migrations', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgbouncer', '_analytics'
    )
    and (
      pg_has_role('postgres', n.nspowner, 'MEMBER')
      or exists (
        select 1
        from pg_roles as r
        where pg_has_role('postgres', r.oid, 'MEMBER')
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
    and pg_has_role('postgres', c.relowner, 'MEMBER')
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
-- helper_function: the functions in schemas private and auth, joined by schema name ('private'::regnamespace
-- would raise an error if the schema were missing). caller marks the allow-list of helpers whose result depends
-- on who is asking (M0b review M0B-DB-2): auth.uid, auth.jwt, private.my_org_ids, private.my_workspace_ids and
-- private.caller_roles. Any other function there, such as auth.role or the immutable private.valid_roles, is not
-- a caller check. A new caller-dependent helper must be added here.
helper_function (oid, nspname, caller) as (
  select
    p.oid,
    n.nspname::text,
    (n.nspname = 'auth' and p.proname in ('uid', 'jwt'))
    or (n.nspname = 'private' and p.proname in ('my_org_ids', 'my_workspace_ids', 'caller_roles'))
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname in ('private', 'auth')
),
scope_policy as (
  select
    pol.oid,
    pol.polcmd,
    pol.polroles,
    pol.polpermissive,
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
tree_node (oid, clause, ord, piece, end_ord, depth) as (
  select o.oid, o.clause, o.ord, o.piece, c.ord, o.depth
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
-- tree_call: each function a clause calls (a function, an operator's function, an aggregate or a window function)
-- that is in private or auth, with its schema, its node, whether it depends on the caller and whether it sits
-- inside an IS [NOT] NULL test (a NULLTEST node), which only asks whether there is a caller.
tree_call (oid, clause, nspname, ord, caller, null_tested) as (
  select
    fn.oid,
    fn.clause,
    hf.nspname,
    fn.ord,
    hf.caller,
    exists (
      select 1
      from tree_node as t
      where t.oid = fn.oid
        and t.clause = fn.clause
        and t.piece like '{NULLTEST %'
        and t.ord < fn.ord
        and fn.ord < t.end_ord
    )
  from tree_node as fn
  join helper_function as hf on hf.oid = coalesce(
      substring(fn.piece from '^\{FUNCEXPR :funcid ([0-9]+) '),
      substring(fn.piece from '^\{[A-Z]+ :opno [0-9]+ :opfuncid ([0-9]+) '),
      substring(fn.piece from '^\{AGGREF :aggfnoid ([0-9]+) '),
      substring(fn.piece from '^\{WINDOWFUNC :winfnoid ([0-9]+) ')
    )::oid
),
-- clause_fact: per USING or WITH CHECK of a scope policy, whether it refers to a column of its table (a VAR whose
-- varlevelsup equals the number of QUERY nodes around it), whether it calls a function in private or in auth,
-- whether it calls a caller-dependent helper, whether its root is an OR, and whether it is open: some arm reached
-- from the root through OR nodes only (the root itself when it is not an OR) has no caller-dependent call outside
-- a NULLTEST, so that arm alone lets any signed-in user of any org through. An OR below an AND or a NOT is not
-- followed (the catalog checks are a net, and every table's rls_* tests are the proof).
clause_fact (oid, clause, has_column, calls_private, calls_auth, calls_caller, root_is_or, open) as (
  select
    pt.oid,
    pt.clause,
    exists (
      select 1
      from tree_node as v
      where v.oid = pt.oid
        and v.clause = pt.clause
        and v.piece like '{VAR %'
        and substring(v.piece from ':varlevelsup ([0-9]+)')::int = (
          select count(*)
          from tree_node as q
          where q.oid = v.oid
            and q.clause = v.clause
            and q.piece like '{QUERY %'
            and q.ord < v.ord
            and v.ord < q.end_ord
        )
    ),
    exists (select 1 from tree_call as c where c.oid = pt.oid and c.clause = pt.clause and c.nspname = 'private'),
    exists (select 1 from tree_call as c where c.oid = pt.oid and c.clause = pt.clause and c.nspname = 'auth'),
    exists (select 1 from tree_call as c where c.oid = pt.oid and c.clause = pt.clause and c.caller),
    exists (
      select 1
      from tree_node as r
      where r.oid = pt.oid
        and r.clause = pt.clause
        and r.depth = 1
        and r.piece like '{BOOLEXPR :boolop or %'
    ),
    exists (
      select 1
      from tree_node as a
      where a.oid = pt.oid
        and a.clause = pt.clause
        and a.piece not like '{BOOLEXPR :boolop or %'
        and not exists (
          select 1
          from tree_node as up
          where up.oid = a.oid
            and up.clause = a.clause
            and up.ord < a.ord
            and a.ord < up.end_ord
            and up.piece not like '{BOOLEXPR :boolop or %'
        )
        and not exists (
          select 1
          from tree_call as c
          where c.oid = a.oid
            and c.clause = a.clause
            and c.caller
            and not c.null_tested
            and a.ord <= c.ord
            and c.ord < a.end_ord
        )
    )
  from policy_tree as pt
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
  select
    cf.oid,
    case
      when not cf.has_column and not cf.calls_private and cf.calls_auth then 'auth_only_clause'
      when not cf.has_column and not cf.calls_private then 'qual_without_column'
      when not cf.calls_caller then 'no_caller_reference'
      when cf.root_is_or then 'or_arm_without_caller'
      else 'caller_only_null_tested'
    end::text,
    case
      when not cf.has_column and not cf.calls_private and cf.calls_auth then format(
        '%s refers to no column of its table and calls no function in private, only auth functions',
        cf.clause
      )
      when not cf.has_column and not cf.calls_private then format(
        '%s refers to no column of its table and calls no function in private or auth',
        cf.clause
      )
      when not cf.calls_caller then format(
        '%s calls no caller-dependent helper such as auth.uid or private.my_org_ids, so it ignores the caller',
        cf.clause
      )
      when cf.root_is_or then format(
        '%s has an OR arm with no caller-dependent call outside IS NULL, so that arm ignores the caller',
        cf.clause
      )
      else format('%s only tests that a caller exists (IS NULL), so it ignores who the caller is', cf.clause)
    end::text
  from clause_fact as cf
  join scope_policy as sp on sp.oid = cf.oid
  where case cf.clause when 'USING' then sp.using_text else sp.check_text end <> 'true'
    and sp.polpermissive
    and (
      (not cf.has_column and not cf.calls_private)
      or not cf.calls_caller
      or cf.open
    )
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
union all
select
  'system_list_policy'::text,
  format('%I on %I.%I', pol.polname, n.nspname, c.relname)::text,
  'a policy on a relation in a system-list schema'::text
from pg_policy as pol
join pg_class as c on c.oid = pol.polrelid
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname in (
    'auth', 'storage', 'extensions', 'realtime', '_realtime', 'graphql', 'graphql_public', 'supabase_functions',
    'supabase_migrations', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgbouncer', '_analytics'
  )
  and not exists (
    select 1
    from pg_depend as d
    join pg_extension as x on x.oid = d.refobjid
    where d.classid = 'pg_class'::regclass
      and d.objid = c.oid
      and d.refclassid = 'pg_extension'::regclass
      and d.deptype = 'e'
      and x.extnamespace = c.relnamespace
  )
