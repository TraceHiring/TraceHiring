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
--     in, so every logged-in user of every org passes. A clause without a column that calls a function in private
--     (matched by schema name) is not reported by these two branches. It still has to call a caller-dependent
--     helper (the allow-list below), or no_caller_reference reports it.
--     Neither qual_without_column nor auth_only_clause looks at a RESTRICTIVE policy (as restrictive), which only
--     narrows what the permissive policies allow: Supabase's MFA pattern, as restrictive for select to
--     authenticated using ((select auth.jwt() ->> 'aal') = 'aal2'), is compliant.
--   no_caller_reference (M0b, M0a review DB-1, M0b review M0B-DB-2): a USING or WITH CHECK of a PERMISSIVE policy
--     that refers to a column of its table or calls a function in private, but calls none of the caller-dependent
--     helpers (the allow-list in helper_function: auth.uid, auth.jwt, private.my_org_ids, private.my_workspace_ids,
--     private.caller_roles, private.is_operator and D1's private.job_org_id, private.api_org_id and
--     private.my_assigned_test_ids), on a table that is not on the reference list, such as the
--     soft-delete clause using (deleted_at is null) or deleted_at is null or (select private.valid_roles(...)). It
--     never depends on who is asking, so it ORs open every org's rows. The same clause in a RESTRICTIVE policy only
--     narrows and passes.
--   The next seven branches (M0b review M0B-DB-2, M0b FR-1 closed in M1 Wave 0) look at a clause of a PERMISSIVE
--   policy that calls a caller-dependent helper, and report it when it is open: some way for it to be true passes no
--   bound caller call (tree_call.bound: the call is compared to a column of the policy's table) outside an
--   IS [NOT] NULL test. Openness is followed through AND, OR, NOT, a boolean CASE and a boolean COALESCE
--   (guard_round), so that path alone lets every signed-in user of every org through. First match wins:
--   or_arm_without_caller: the root is an OR, such as deleted_at is null or (select auth.uid()) is not null.
--   caller_only_null_tested: every caller-dependent call sits inside an IS [NOT] NULL test, such as
--     deleted_at is null and (select auth.uid()) is not null, which only asks whether someone is signed in.
--   caller_bound_elsewhere: no caller call is bound, but one is compared to a column of another table only, such as
--     deleted_at is null and exists (select 1 from memberships as m where m.user_id = (select auth.uid())), where
--     the EXISTS is not correlated to the policy's table: any member of any org passes.
--   caller_unbound (M0b FIX re-review FR-1): no caller call is bound or compared to any column:
--     deleted_at is null and (select auth.jwt() ->> 'role') = 'authenticated', (select auth.uid()) =
--     (select auth.uid()), or org_id in (select m.org_id from memberships as m where (select auth.jwt() ->> 'role')
--     = 'authenticated').
--   case_branch_without_caller: a caller call is bound, but a CASE has a branch (its ELSE included) that is true
--     without one, such as case when owner_id = (select auth.uid()) then true else deleted_at is null end.
--   coalesce_arg_without_caller: the same through a COALESCE argument, such as
--     coalesce(org_id = (select private.job_org_id()), true), true whenever no job org is set.
--   nested_or_arm_without_caller: the same through an OR below the root, or an AND below an odd number of NOTs,
--     such as status = 'draft' and (owner_id = (select auth.uid()) or deleted_at is null), or
--     not (deleted_at is not null and owner_id = (select auth.uid())).
--   Still not followed (the check is a net, and each table's rls_* tests, allowed and denied cases per role, remain
--   the proof): the boolean structure inside a sub-select (an OR in an EXISTS's WHERE), what the comparison is (a
--   caller compared with <> to a column counts as bound), a simple CASE (case x when ...: its WHEN compares the
--   operand, not a column, so a caller call there is not bound, and the check may report a compliant clause), and a
--   boolean function that takes a caller call and a column (not a comparison, so not bound).
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
-- on who is asking (M0b review M0B-DB-2): auth.uid, auth.jwt, private.my_org_ids, private.my_workspace_ids,
-- private.caller_roles, private.is_operator (FIX re-review) and, from D1, private.job_org_id, private.api_org_id
-- (per-transaction job/api org context) and private.my_assigned_test_ids. Any other function there, such as auth.role or the
-- immutable private.valid_roles, is not a caller check. A new caller-dependent helper must be added here. M1's
-- private.library_org_id is deliberately not on the list: it returns the same org for every caller.
helper_function (oid, nspname, caller, returns_bool) as (
  select
    p.oid,
    n.nspname::text,
    (n.nspname = 'auth' and p.proname in ('uid', 'jwt'))
    or (
      n.nspname = 'private'
      and p.proname in (
        'my_org_ids', 'my_workspace_ids', 'caller_roles', 'is_operator', 'job_org_id', 'api_org_id', 'my_assigned_test_ids'
      )
    ),
    p.prorettype = 'bool'::regtype
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
-- query_node: each sub-select (QUERY node) with qlevel, the number of QUERY nodes around it, itself included. A
-- scalar sub-select such as (select auth.uid()) is one too.
query_node (oid, clause, ord, end_ord, qlevel) as (
  select
    q.oid,
    q.clause,
    q.ord,
    q.end_ord,
    (
      select count(*)
      from tree_node as o
      where o.oid = q.oid
        and o.clause = q.clause
        and o.piece like '{QUERY %'
        and o.ord <= q.ord
        and q.ord < o.end_ord
    )
  from tree_node as q
  where q.piece like '{QUERY %'
),
-- var_ref: each column reference (VAR) with ref_level, the query level whose table it reads: the number of QUERY
-- nodes around it less its varlevelsup. 0 is the policy's table. For n > 0, ref_query is the QUERY node at level n
-- around it and ref_sublink the innermost SUBLINK node around that QUERY.
var_ref (oid, clause, ord, ref_level, ref_query, ref_sublink) as (
  select v.oid, v.clause, v.ord, x.ref_level, q.ord, s.ord
  from tree_node as v
  cross join lateral (
    select
      (
        select count(*)
        from query_node as q
        where q.oid = v.oid
          and q.clause = v.clause
          and q.ord < v.ord
          and v.ord < q.end_ord
      ) - substring(v.piece from ':varlevelsup ([0-9]+)')::int as ref_level
  ) as x
  left join query_node as q on q.oid = v.oid
    and q.clause = v.clause
    and q.qlevel = x.ref_level
    and q.ord < v.ord
    and v.ord < q.end_ord
  left join lateral (
    select max(t.ord) as ord
    from tree_node as t
    where t.oid = v.oid
      and t.clause = v.clause
      and t.piece like '{SUBLINK %'
      and t.ord < q.ord
      and q.ord < t.end_ord
  ) as s on true
  where v.piece like '{VAR %'
),
-- anchored_sublink: a SUBLINK node that reads a column of the policy's table (in its test expression or as a
-- correlation), or that sits inside the sub-select of an anchored SUBLINK and reads a column of that sub-select's
-- tables, such as the inner sub-select of test_id in (select t.id from tests as t where t.workspace_id in (...)).
anchored_sublink (oid, clause, ord) as (
  select s.oid, s.clause, s.ord
  from tree_node as s
  where s.piece like '{SUBLINK %'
    and exists (
      select 1
      from var_ref as v
      where v.oid = s.oid
        and v.clause = s.clause
        and v.ref_level = 0
        and s.ord < v.ord
        and v.ord < s.end_ord
    )
  union
  select s.oid, s.clause, s.ord
  from anchored_sublink as a
  join var_ref as v on v.oid = a.oid and v.clause = a.clause and v.ref_sublink = a.ord
  join tree_node as s on s.oid = v.oid
    and s.clause = v.clause
    and s.piece like '{SUBLINK %'
    and v.ref_query < s.ord
    and s.ord < v.ord
    and v.ord < s.end_ord
),
-- anchored_var: a VAR that reads the policy's table, or a table of the sub-select of an anchored SUBLINK.
anchored_var (oid, clause, ord) as (
  select v.oid, v.clause, v.ord
  from var_ref as v
  where v.ref_level = 0
    or exists (
      select 1
      from anchored_sublink as a
      where a.oid = v.oid
        and a.clause = v.clause
        and a.ord = v.ref_sublink
    )
),
-- pred_node: the comparisons a caller call can be bound by: a boolean operator (OPEXPR with opresulttype 16),
-- SCALARARRAYOPEXPR, DISTINCTEXPR, NULLIFEXPR, ROWCOMPAREEXPR, an EXISTS, ALL, ANY/IN or row-compare sub-select
-- (subLinkType 0 to 3), and NULLTEST, which binds nothing. The test expression of an ALL, ANY/IN or row-compare
-- sub-select (any node in it with no QUERY node between it and that SUBLINK) is left out: it compares with the
-- sub-select's output, so the SUBLINK node stands for it.
pred_node (oid, clause, ord, end_ord, null_test) as (
  select p.oid, p.clause, p.ord, p.end_ord, p.piece like '{NULLTEST %'
  from tree_node as p
  where (
      (p.piece like '{OPEXPR %' and p.piece like '% :opresulttype 16 %')
      or p.piece like '{SCALARARRAYOPEXPR %'
      or p.piece like '{DISTINCTEXPR %'
      or p.piece like '{NULLIFEXPR %'
      or p.piece like '{ROWCOMPAREEXPR %'
      or p.piece like '{NULLTEST %'
      or p.piece ~ '^\{SUBLINK :subLinkType [0-3] '
    )
    and not exists (
      select 1
      from tree_node as s
      where s.oid = p.oid
        and s.clause = p.clause
        and s.piece ~ '^\{SUBLINK :subLinkType [1-3] '
        and s.ord < p.ord
        and p.ord < s.end_ord
        and not exists (
          select 1
          from query_node as q
          where q.oid = p.oid
            and q.clause = p.clause
            and s.ord < q.ord
            and q.ord < p.ord
            and p.ord < q.end_ord
        )
    )
),
-- tree_call: each function a clause calls (a function, an operator's function, an aggregate or a window function)
-- that is in private or auth, with its schema, its node, whether it depends on the caller and whether it sits
-- inside an IS [NOT] NULL test (a NULLTEST node), which only asks whether there is a caller. bound (M0b FR-1): the
-- helper returns boolean itself (a predicate on the caller, such as private.is_operator), or the innermost
-- comparison around the call (pred_node) is not a NULLTEST and reads an anchored column (anchored_var), such as
-- org_id = any((select private.my_org_ids(...))), org_id in (select unnest((select private.my_org_ids(...)))),
-- membership_id in (select m.id from memberships as m where m.user_id = (select auth.uid())) or an EXISTS
-- correlated to the policy's table. A call compared only to a constant, such as (select auth.jwt() ->> 'role') =
-- 'authenticated', to itself, or to a column of a sub-select not tied to the policy's table, is not bound: it does
-- not pick rows. bound_elsewhere: that comparison reads some column, only not an anchored one.
tree_call (oid, clause, nspname, ord, caller, null_tested, bound, bound_elsewhere) as (
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
    ),
    hf.returns_bool or coalesce(ip.anchored, false),
    coalesce(ip.reads_column, false)
  from tree_node as fn
  join helper_function as hf on hf.oid = coalesce(
      substring(fn.piece from '^\{FUNCEXPR :funcid ([0-9]+) '),
      substring(fn.piece from '^\{[A-Z]+ :opno [0-9]+ :opfuncid ([0-9]+) '),
      substring(fn.piece from '^\{AGGREF :aggfnoid ([0-9]+) '),
      substring(fn.piece from '^\{WINDOWFUNC :winfnoid ([0-9]+) ')
    )::oid
  left join lateral (
    select
      not p.null_test
      and exists (
        select 1
        from anchored_var as v
        where v.oid = p.oid
          and v.clause = p.clause
          and p.ord < v.ord
          and v.ord < p.end_ord
      ) as anchored,
      not p.null_test
      and exists (
        select 1
        from tree_node as v
        where v.oid = p.oid
          and v.clause = p.clause
          and v.piece like '{VAR %'
          and p.ord < v.ord
          and v.ord < p.end_ord
      ) as reads_column
    from pred_node as p
    where p.oid = fn.oid
      and p.clause = fn.clause
      and p.ord < fn.ord
      and fn.ord < p.end_ord
    order by p.ord desc
    limit 1
  ) as ip on true
),
-- tree_kind: each node's role in the boolean skeleton of its clause: and, or, not, case (a CASE of type boolean),
-- when (its CASEWHEN arms), coalesce (a COALESCE of type boolean), else leaf.
tree_kind (oid, clause, ord, end_ord, depth, piece, kind) as (
  select
    t.oid,
    t.clause,
    t.ord,
    t.end_ord,
    t.depth,
    t.piece,
    case
      when t.piece like '{BOOLEXPR :boolop and %' then 'and'
      when t.piece like '{BOOLEXPR :boolop or %' then 'or'
      when t.piece like '{BOOLEXPR :boolop not %' then 'not'
      when t.piece like '{CASEEXPR :casetype 16 %' then 'case'
      when t.piece like '{CASEWHEN %' then 'when'
      when t.piece like '{COALESCEEXPR :coalescetype 16 %' then 'coalesce'
      else 'leaf'
    end::text
  from tree_node as t
),
-- skel: the boolean skeleton, walked from the root (depth 1) down to its leaves: the arms of AND and OR, the operand
-- of NOT, the WHEN arms and the ELSE of a CASE (not its operand, which comes before the first WHEN), the condition
-- and the result of a WHEN, and the arguments of COALESCE. pol is true below an odd number of NOTs, and a WHEN's
-- condition starts again at false.
skel (oid, clause, ord, end_ord, depth, parent, kind, pol) as (
  select r.oid, r.clause, r.ord, r.end_ord, r.depth, null::bigint, r.kind, false
  from tree_kind as r
  where r.depth = 1
  union all
  select
    ch.oid,
    ch.clause,
    ch.ord,
    ch.end_ord,
    ch.depth,
    s.ord,
    ch.kind,
    case
      when s.kind = 'when'
        and ch.ord = (
          select min(f.ord)
          from tree_node as f
          where f.oid = s.oid
            and f.clause = s.clause
            and f.depth = s.depth + 1
            and s.ord < f.ord
            and f.ord < s.end_ord
        ) then false
      when s.kind = 'not' then not s.pol
      else s.pol
    end
  from skel as s
  join tree_kind as ch on ch.oid = s.oid
    and ch.clause = s.clause
    and ch.depth = s.depth + 1
    and s.ord < ch.ord
    and ch.ord < s.end_ord
  where s.kind <> 'leaf'
    and (
      s.kind <> 'case'
      or ch.kind = 'when'
      or ch.ord > (
        select max(w.ord)
        from tree_node as w
        where w.oid = s.oid
          and w.clause = s.clause
          and w.depth = s.depth + 1
          and w.piece like '{CASEWHEN %'
          and s.ord < w.ord
          and w.ord < s.end_ord
      )
    )
),
-- skel_node: mode says when a skeleton node is guarded (it can be true only through a bound caller call): leaf by
-- itself, any when one child is (AND, NOT, a WHEN, and OR below an odd number of NOTs), all when every child is (OR,
-- CASE, COALESCE, and AND below an odd number of NOTs).
skel_node (oid, clause, ord, end_ord, depth, parent, kind, pol, mode) as (
  select
    s.oid,
    s.clause,
    s.ord,
    s.end_ord,
    s.depth,
    s.parent,
    s.kind,
    s.pol,
    case
      when s.kind = 'leaf' then 'leaf'
      when s.kind in ('case', 'coalesce') then 'all'
      when s.kind in ('when', 'not') then 'any'
      when (s.kind = 'or') <> s.pol then 'all'
      else 'any'
    end::text
  from skel as s
),
-- leaf_guard: a guarded leaf: it holds a bound caller call outside a NULLTEST, or it is the boolean constant null,
-- false (not below a NOT) or true (below an odd number of NOTs), which is never true there.
leaf_guard (oid, clause, ord) as (
  select s.oid, s.clause, s.ord
  from skel_node as s
  join tree_node as t on t.oid = s.oid and t.clause = s.clause and t.ord = s.ord
  where s.mode = 'leaf'
    and (
      exists (
        select 1
        from tree_call as c
        where c.oid = s.oid
          and c.clause = s.clause
          and c.caller
          and not c.null_tested
          and c.bound
          and s.ord <= c.ord
          and c.ord < s.end_ord
      )
      or (
        t.piece like '{CONST :consttype 16 %'
        and (t.piece like '% :constisnull true %' or (t.piece like '% :constvalue 1 [ 0 %') <> s.pol)
      )
    )
),
-- guard_round: the guarded skeleton nodes of each clause, from the guarded leaves up, one level per round, until no
-- node is added.
guard_round (oid, clause, guarded) as (
  select pt.oid, pt.clause, array(select g.ord from leaf_guard as g where g.oid = pt.oid and g.clause = pt.clause)
  from policy_tree as pt
  union all
  select r.oid, r.clause, x.guarded
  from guard_round as r
  cross join lateral (
    select array(
        select s.ord
        from skel_node as s
        where s.oid = r.oid
          and s.clause = r.clause
          and (
            s.ord = any(r.guarded)
            or (
              s.mode = 'any'
              and exists (
                select 1
                from skel_node as ch
                where ch.oid = s.oid
                  and ch.clause = s.clause
                  and ch.parent = s.ord
                  and ch.ord = any(r.guarded)
              )
            )
            or (
              s.mode = 'all'
              and not exists (
                select 1
                from skel_node as ch
                where ch.oid = s.oid
                  and ch.clause = s.clause
                  and ch.parent = s.ord
                  and not ch.ord = any(r.guarded)
              )
            )
          )
      ) as guarded
  ) as x
  where cardinality(x.guarded) > cardinality(r.guarded)
),
clause_guard (oid, clause, guarded) as (
  select distinct on (r.oid, r.clause) r.oid, r.clause, r.guarded
  from guard_round as r
  order by r.oid, r.clause, cardinality(r.guarded) desc
),
-- clause_fact: per USING or WITH CHECK of a scope policy, whether it refers to a column of its table (a VAR whose
-- varlevelsup equals the number of QUERY nodes around it), whether it calls a function in private or in auth,
-- whether it calls a caller-dependent helper, whether some caller-dependent call sits outside a NULLTEST
-- (calls_unnulled), whether one of those is bound (has_bound) or reads another column (has_bound_elsewhere), whether
-- its root is an OR, whether it is open (its root is not guarded), and open_kind: for the shallowest unguarded
-- skeleton node of mode all with no guarded node above it, case, coalesce or else or.
clause_fact (
  oid,
  clause,
  has_column,
  calls_private,
  calls_auth,
  calls_caller,
  calls_unnulled,
  has_bound,
  has_bound_elsewhere,
  root_is_or,
  open,
  open_kind
) as (
  select
    pt.oid,
    pt.clause,
    exists (
      select 1
      from var_ref as v
      where v.oid = pt.oid
        and v.clause = pt.clause
        and v.ref_level = 0
    ),
    exists (select 1 from tree_call as c where c.oid = pt.oid and c.clause = pt.clause and c.nspname = 'private'),
    exists (select 1 from tree_call as c where c.oid = pt.oid and c.clause = pt.clause and c.nspname = 'auth'),
    exists (select 1 from tree_call as c where c.oid = pt.oid and c.clause = pt.clause and c.caller),
    exists (
      select 1
      from tree_call as c
      where c.oid = pt.oid
        and c.clause = pt.clause
        and c.caller
        and not c.null_tested
    ),
    exists (
      select 1
      from tree_call as c
      where c.oid = pt.oid
        and c.clause = pt.clause
        and c.caller
        and not c.null_tested
        and c.bound
    ),
    exists (
      select 1
      from tree_call as c
      where c.oid = pt.oid
        and c.clause = pt.clause
        and c.caller
        and not c.null_tested
        and c.bound_elsewhere
    ),
    exists (
      select 1
      from tree_node as r
      where r.oid = pt.oid
        and r.clause = pt.clause
        and r.depth = 1
        and r.piece like '{BOOLEXPR :boolop or %'
    ),
    not exists (
      select 1
      from skel_node as s
      join clause_guard as g on g.oid = s.oid and g.clause = s.clause
      where s.oid = pt.oid
        and s.clause = pt.clause
        and s.depth = 1
        and s.ord = any(g.guarded)
    ),
    (
      select case when s.kind in ('case', 'coalesce') then s.kind else 'or' end
      from skel_node as s
      join clause_guard as g on g.oid = s.oid and g.clause = s.clause
      where s.oid = pt.oid
        and s.clause = pt.clause
        and s.mode = 'all'
        and not s.ord = any(g.guarded)
        and not exists (
          select 1
          from skel_node as a
          where a.oid = s.oid
            and a.clause = s.clause
            and a.ord < s.ord
            and s.ord < a.end_ord
            and a.ord = any(g.guarded)
        )
      order by s.depth, s.ord
      limit 1
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
      when not cf.calls_unnulled then 'caller_only_null_tested'
      when not cf.has_bound and cf.has_bound_elsewhere then 'caller_bound_elsewhere'
      when not cf.has_bound then 'caller_unbound'
      when cf.open_kind = 'case' then 'case_branch_without_caller'
      when cf.open_kind = 'coalesce' then 'coalesce_arg_without_caller'
      when cf.open_kind = 'or' then 'nested_or_arm_without_caller'
      else 'caller_unbound'
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
        '%s has an OR arm with no bound caller call outside IS NULL, so that arm ignores the caller',
        cf.clause
      )
      when not cf.calls_unnulled then format(
        '%s only tests that a caller exists (IS NULL), so it ignores who the caller is',
        cf.clause
      )
      when not cf.has_bound and cf.has_bound_elsewhere then format(
        '%s compares the caller only to columns of a sub-select not tied to its table, so it picks no rows',
        cf.clause
      )
      when not cf.has_bound then format(
        '%s compares the caller only to constants, never to a column, so it picks no rows',
        cf.clause
      )
      when cf.open_kind = 'case' then format(
        '%s has a CASE branch (or ELSE) that is true without a bound caller call, so it ignores the caller',
        cf.clause
      )
      when cf.open_kind = 'coalesce' then format(
        '%s has a COALESCE argument that is true without a bound caller call, so it ignores the caller',
        cf.clause
      )
      when cf.open_kind = 'or' then format(
        '%s has a nested OR (or a negated AND) with an arm that has no bound caller call, so it ignores the caller',
        cf.clause
      )
      else format('%s compares the caller only to constants, never to a column, so it picks no rows', cf.clause)
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
