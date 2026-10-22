-- rls_d1_invariants (spec specs/d1-demo-slice.md 3.6 row "rls_d1_invariants"; 3.7 invariants I-1 to I-13; 3.5 MT-3 stricter scan,
-- MT-14 login roles; AT-D13 "supabase/tests/rls_d1_invariants.test.sql"; rules 1, 2, 4, 5, 6, 8, 9; L-31, L-36).
-- Catalogue-level proofs only: no fixtures, no rows. Every assertion reads pg_catalog, so a later migration that breaks an
-- invariant (a score column on responses, a view over both internal schemas, a partitioned integrity.signals) fails here.
-- Login roles that the spec says an operator creates (api_login, jobs_mirror_login, jobs_quality_login, jobs_integrity_login)
-- may not exist in a local database: their assertions check whatever exists and pass when it does not, and controls built
-- on a role created inside this transaction prove the check bites.
begin;
-- Helpers live in pg_temp (rolled back with the transaction).
-- reach(role, schema): true when the role can use the schema or holds any privilege on a relation or function in it.
create function pg_temp.reach(p_role text, p_schema text) returns boolean language sql as $f$
  select has_schema_privilege(p_role, p_schema, 'USAGE')
    or exists (select 1 from pg_catalog.pg_class as c
                where c.relnamespace = p_schema::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
                  and (has_any_column_privilege(p_role, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
                       or has_table_privilege(p_role, c.oid, 'DELETE, TRUNCATE, TRIGGER')))
    or exists (select 1 from pg_catalog.pg_proc as pr
                where pr.pronamespace = p_schema::regnamespace and has_function_privilege(p_role, pr.oid, 'EXECUTE'))
$f$;
-- app_roles(): the roles whose reach is compared (platform roles, the five trace_* group roles plus trace_api, and any of the four named login roles that exist).
create function pg_temp.app_roles() returns text[] language sql as $f$
  select array_agg(r.rolname::text order by r.rolname) from pg_catalog.pg_roles as r
   where r.rolname in ('anon', 'authenticated', 'service_role', 'api_login', 'jobs_mirror_login', 'jobs_quality_login', 'jobs_integrity_login', 'jobs_authoring_login', 'jobs_admin_login')
      or r.rolname like 'trace\_%'
$f$;
-- login_violations(map): for the login roles named in the map {login: trace role} that exist, lists every departure from
-- MT-14: attributes (must log in; no trace_ name; no superuser, bypassrls, createrole, createdb, replication), exactly one
-- membership and it is the mapped role, and that edge is `inherit false, set true`. It also lists any other role (not
-- postgres, not a trace_* role, not in the map) that can use a trace_* role (inherit or set), so an unlisted login cannot
-- slip in. A listed login that does not exist produces nothing.
create function pg_temp.login_violations(p_map jsonb) returns text[] language sql as $f$
  select coalesce(array_agg(q.v order by q.v), '{}'::text[]) from (
    select r.rolname || ':attributes' as v
      from pg_catalog.pg_roles as r join jsonb_each_text(p_map) as m(login, target) on m.login = r.rolname
     where not r.rolcanlogin or r.rolname like 'trace\_%' or r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolreplication
    union all
    select r.rolname || ':membership'
      from pg_catalog.pg_roles as r join jsonb_each_text(p_map) as m(login, target) on m.login = r.rolname
     where (select count(*) from pg_catalog.pg_auth_members as am where am.member = r.oid) <> 1
        or not exists (select 1 from pg_catalog.pg_auth_members as am where am.member = r.oid and am.roleid = m.target::regrole)
    union all
    select r.rolname || ':inherit_set'
      from pg_catalog.pg_roles as r join jsonb_each_text(p_map) as m(login, target) on m.login = r.rolname
     where exists (select 1 from pg_catalog.pg_auth_members as am where am.member = r.oid and am.roleid = m.target::regrole
                      and not (am.inherit_option = false and am.set_option = true))
    union all
    select mem.rolname || '->' || grp.rolname || ':unlisted'
      from pg_catalog.pg_auth_members as am
      join pg_catalog.pg_roles as grp on grp.oid = am.roleid
      join pg_catalog.pg_roles as mem on mem.oid = am.member
     where grp.rolname like 'trace\_%' and mem.rolname not like 'trace\_%' and mem.rolname <> 'postgres'
       and (am.inherit_option or am.set_option)
       and not (p_map ? mem.rolname)
  ) as q
$f$;
-- probe_only(list) keeps the entries about the probe login created below, so the controls hold even if an operator-created login role exists.
create function pg_temp.probe_only(p_list text[]) returns text[] language sql as $f$
  select coalesce(array_agg(v order by v), '{}'::text[]) from unnest(p_list) as u(v) where v like 'jobs_probe_login%'
$f$;
select plan(66);

-- ===== I-1, I-13 (rule 1): where score and band columns may exist =====
-- Columns named with the whole words score, scores, band, grade or outcome exist only in quality.scores, quality_cards,
-- integrity.results and integrity_cards, plus two pointers/raw values that are not results: quality.grader_runs.raw_score
-- (a per-item grader output that lives in the quality schema) and ruleset_versions.band_rule_version_id (the pinned rule table id).
select is_empty($q$
  select n.nspname || '.' || c.relname || '.' || a.attname
    from pg_catalog.pg_attribute as a join pg_catalog.pg_class as c on c.oid = a.attrelid join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
   where n.nspname in ('public', 'quality', 'integrity', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f') and not c.relispartition
     and a.attnum > 0 and not a.attisdropped
     and a.attname ~ '(^|_)(score|scores|band|grade|outcome)(_|$)'
     and (n.nspname, c.relname) not in (('quality', 'scores'), ('public', 'quality_cards'), ('integrity', 'results'), ('public', 'integrity_cards'))
     and (n.nspname, c.relname, a.attname) not in (('quality', 'grader_runs', 'raw_score'), ('public', 'ruleset_versions', 'band_rule_version_id'))
$q$, 'I-13: score, band, grade and outcome columns exist only in quality.scores, quality_cards, integrity.results and integrity_cards (two named exceptions)');
-- MT-3 stricter scan (spec 3.5): responses, invitations, sessions, media_objects, reports (and session_items) carry no such column, by the loose LIKE patterns.
select is_empty($q$
  select c.relname || '.' || a.attname
    from pg_catalog.pg_attribute as a join pg_catalog.pg_class as c on c.oid = a.attrelid
   where c.relnamespace = 'public'::regnamespace and c.relname in ('responses', 'invitations', 'sessions', 'media_objects', 'reports', 'session_items')
     and a.attnum > 0 and not a.attisdropped
     and (a.attname ilike '%score%' or a.attname ilike '%band%' or a.attname ilike '%grade%' or a.attname ilike '%outcome%')
$q$, 'I-1: responses, invitations, sessions, media_objects, reports and session_items carry no column like %score%, %band%, %grade% or %outcome%');
-- The band enum is used by exactly one column, and no public column has a type from quality or integrity (the cards hold text).
select is((select array_agg(c.oid::regclass::text || '.' || a.attname order by c.oid::regclass::text) from pg_catalog.pg_attribute as a join pg_catalog.pg_class as c on c.oid = a.attrelid
            where a.atttypid = 'integrity.band'::regtype and a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p', 'v', 'm', 'f')),
  array['integrity.results.band'], 'I-1: the integrity.band type is used by exactly one column, integrity.results.band');
select is_empty($q$
  select c.oid::regclass::text || '.' || a.attname
    from pg_catalog.pg_attribute as a join pg_catalog.pg_class as c on c.oid = a.attrelid join pg_catalog.pg_type as t on t.oid = a.atttypid
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped
     and t.typnamespace in ('quality'::regnamespace, 'integrity'::regnamespace)
$q$, 'I-1: no public column has a type from schema quality or integrity (cards hold text, so public never depends on an internal type)');
-- No combined number: no column named like an overall, combined, composite, trust or honesty figure in any schema; MT-3 names.
select is_empty($q$
  select n.nspname || '.' || c.relname || '.' || a.attname
    from pg_catalog.pg_attribute as a join pg_catalog.pg_class as c on c.oid = a.attrelid join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
   where n.nspname in ('public', 'quality', 'integrity', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f') and not c.relispartition
     and a.attnum > 0 and not a.attisdropped
     and a.attname ~* '(overall|combined|composite|(^|_)trust(_|$)|honest|cheat|emotion|stress|personality|voiceprint|face_template|gaze|dob|birth|ai_like|likelihood)'
$q$, 'I-1: no combined, overall, trust, honesty, cheat, emotion, voiceprint, face-template, gaze or AI-likeness column exists (rules 1 and 7, MT-3)');

-- ===== I-2 (rules 2, 4): no rejection, decision, notice-of-rejection or appeal object =====
select is_empty($q$
  select n.nspname || '.' || c.relname || '.' || a.attname
    from pg_catalog.pg_attribute as a join pg_catalog.pg_class as c on c.oid = a.attrelid join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
   where n.nspname in ('public', 'quality', 'integrity', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and a.attnum > 0 and not a.attisdropped and a.attname ~* 'reject'
$q$, 'I-2: no column named like %reject% in any schema, including partitions');
select is_empty($q$
  select n.nspname || '.' || c.relname || ':' || c.relkind::text
    from pg_catalog.pg_class as c join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
   where n.nspname in ('public', 'quality', 'integrity', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
     and c.relname ~* '(reject|decision|decid|overturn|appeal|shortlist|declin|confirm)'
$q$, 'I-2: no table, view or sequence is named like reject, decision, overturn, appeal, shortlist, decline or confirm (rules 2, 4, 6)');
select is_empty($q$
  select n.nspname || '.' || p.proname
    from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
   where n.nspname in ('public', 'quality', 'integrity', 'private')
     and p.proname ~* '(reject|decision|decid|overturn|appeal|shortlist|declin|confirm)'
$q$, 'I-2: no function is named like reject, decision, overturn, appeal, shortlist, decline or confirm');
select is((select array_agg(c.relname::text order by c.relname) from pg_catalog.pg_class as c
            where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace, 'private'::regnamespace)
              and c.relkind in ('r', 'p', 'v', 'm', 'f') and c.relname ~* 'notice'),
  array['notice_versions'], 'I-2: the only notice object is notice_versions, the consent text version (no notice-of-rejection object exists in D1; rule 4 is M6)');
select is_empty($q$
  select t.typnamespace::regnamespace::text || '.' || t.typname || '=' || e.enumlabel
    from pg_catalog.pg_enum as e join pg_catalog.pg_type as t on t.oid = e.enumtypid
   where t.typnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace, 'private'::regnamespace)
     and e.enumlabel ~* '(reject|decision|decid|overturn|appeal|shortlist|declin|confirm|upheld|fail)'
$q$, 'I-2: no enum label in the D1 schemas is a rejection, decision, confirmation, overturn or appeal value');
select is((select array_agg(e.enumlabel::text order by e.enumsortorder) from pg_catalog.pg_enum as e where e.enumtypid = 'public.invitation_status'::regtype),
  array['created', 'sent', 'otp_verified', 'started', 'submitted', 'expired', 'revoked', 'blocked_age'], 'I-2: invitation_status has exactly the eight D1 labels and no rejected value');
select is((select array_agg(e.enumlabel::text order by e.enumsortorder) from pg_catalog.pg_enum as e where e.enumtypid = 'integrity.band'::regtype),
  array['clear', 'review', 'strong_concern', 'insufficient_evidence'], 'I-2: integrity.band has exactly the four labels, none a rejection');
-- Flags and timeline entries cannot be confirmed or overturned in D1.
select is((select count(*)::int from pg_catalog.pg_constraint as k
            where k.conname = 'flags_d1_no_confirm' and k.conrelid = 'integrity.flags'::regclass and k.convalidated
              and pg_get_constraintdef(k.oid) = $d$CHECK ((state = ANY (ARRAY['pending'::text, 'not_used'::text])))$d$), 1,
  'I-2: integrity.flags.state is limited to pending and not_used by flags_d1_no_confirm (validated)');
select is((select count(*)::int from pg_catalog.pg_constraint as k
            where k.conrelid = 'public.integrity_timeline_entries'::regclass and k.contype = 'c' and k.convalidated
              and pg_get_constraintdef(k.oid) = $d$CHECK ((flag_state = 'pending'::text))$d$), 1,
  'I-2: integrity_timeline_entries.flag_state is limited to pending by a validated CHECK (L-3)');
select is_empty($q$
  select k.conrelid::regclass::text || '.' || k.conname
    from pg_catalog.pg_constraint as k
   where k.contype = 'c' and k.connamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace)
     and pg_get_constraintdef(k.oid) ~* $re$'(confirmed|overturned|rejected|declined|appealed|upheld|decided|decision)'$re$
$q$, 'I-2: no CHECK constraint in the D1 schemas admits a confirmed, overturned, rejected, declined, appealed or decided value');

-- ===== I-1, I-5 (rule 1): nothing bridges quality.* and integrity.* =====
select is_empty($q$
  select v.oid::regclass::text
    from pg_catalog.pg_class as v
    join pg_catalog.pg_rewrite as rw on rw.ev_class = v.oid
    join pg_catalog.pg_depend as d on d.objid = rw.oid and d.refclassid = 'pg_class'::regclass
    join pg_catalog.pg_class as t on t.oid = d.refobjid
   where v.relkind in ('v', 'm') and v.relnamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
   group by v.oid
  having bool_or(t.relnamespace = 'quality'::regnamespace) and bool_or(t.relnamespace = 'integrity'::regnamespace)
$q$, 'I-1: no view or materialised view in any schema reads both quality.* and integrity.*');
select is_empty($q$
  select v.oid::regclass::text
    from pg_catalog.pg_class as v
    join pg_catalog.pg_rewrite as rw on rw.ev_class = v.oid
    join pg_catalog.pg_depend as d on d.objid = rw.oid and d.refclassid = 'pg_class'::regclass
    join pg_catalog.pg_class as t on t.oid = d.refobjid
   where v.relkind in ('v', 'm') and v.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
     and t.relnamespace in ('quality'::regnamespace, 'integrity'::regnamespace)
$q$, 'I-1: no view in public or private reads quality.* or integrity.* (org users read only the public cards)');
select is_empty($q$
  select n.nspname || '.' || p.proname
    from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
   where n.nspname in ('public', 'quality', 'integrity', 'private')
     and p.prosrc ~* $re$\mquality\.$re$ and p.prosrc ~* $re$\mintegrity\.$re$
$q$, 'I-1: no function body in the D1 schemas names both quality.* and integrity.*');
select is_empty($q$
  select n.nspname || '.' || p.proname
    from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in ('mirror_session', 'sweep_pending', 'resolve_invitation_by_hash', 'media_viewer_check', 'media_link_grant', 'media_view_grant', 'membership_counts_for')
     and (p.prosrc ~* $re$\mquality\.$re$ or p.prosrc ~* $re$\mintegrity\.$re$)
$q$, 'I-1: the mirror, sweep, token-hash lookup and media functions reach public only (no body names quality.* or integrity.*)');
select is_empty($q$
  select k.conrelid::regclass::text || '.' || k.conname
    from pg_catalog.pg_constraint as k
   where (k.contype = 'f'
          and ((k.conrelid::regclass::text like 'quality.%' and k.confrelid::regclass::text like 'integrity.%')
            or (k.conrelid::regclass::text like 'integrity.%' and k.confrelid::regclass::text like 'quality.%')))
      or (k.contype in ('c', 'x') and k.connamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace)
          and pg_get_constraintdef(k.oid) ~* $re$\mquality\.$re$ and pg_get_constraintdef(k.oid) ~* $re$\mintegrity\.$re$)
$q$, 'I-1: no foreign key or CHECK links quality.* and integrity.* to each other');
-- Cross-schema foreign keys from public tables are exactly the card, ruleset and (nothing else) edges of spec 3.2; reports reaches public cards only.
select is((select array_agg(k.conrelid::regclass::text || '->' || k.confrelid::regclass::text order by k.conrelid::regclass::text, k.confrelid::regclass::text)
            from pg_catalog.pg_constraint as k
           where k.contype = 'f' and k.conrelid::regclass::text !~ '^(quality|integrity)\.'
             and (k.confrelid::regclass::text ~ '^(quality|integrity)\.')),
  array['integrity_cards->integrity.results', 'quality_cards->quality.scores', 'ruleset_versions->integrity.band_rule_versions'],
  'I-1: public tables reference an internal schema only through quality_cards (quality.scores), integrity_cards (integrity.results) and ruleset_versions (band_rule_versions); reports and the rest reach none');
select is_empty($q$
  select pol.polrelid::regclass::text || '.' || pol.polname
    from pg_catalog.pg_policy as pol
   where (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) ~* $re$\mquality\.$re$
     and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) ~* $re$\mintegrity\.$re$
$q$, 'I-1: no policy expression names both quality.* and integrity.*');
-- Grants: exactly one worker role reaches each internal schema.
select is((select array_agg(r order by r) from unnest(pg_temp.app_roles()) as u(r) where pg_temp.reach(r, 'quality')),
  array['trace_quality_worker'], 'I-1: among platform, trace_* and login roles, only trace_quality_worker reaches schema quality');
select is((select array_agg(r order by r) from unnest(pg_temp.app_roles()) as u(r) where pg_temp.reach(r, 'integrity')),
  array['trace_integrity_worker'], 'I-1: among platform, trace_* and login roles, only trace_integrity_worker reaches schema integrity');
-- The integrity job sees one boolean of the quality card (rule 6 gate), never the score.
select is((select array_agg(a.attname::text order by a.attname) from pg_catalog.pg_attribute as a
            where a.attrelid = 'public.quality_cards'::regclass and a.attnum > 0 and not a.attisdropped
              and has_column_privilege('trace_integrity_worker', a.attrelid, a.attnum, 'SELECT')),
  array['meets_cutoff', 'org_id', 'session_id'], 'I-1, rule 6: trace_integrity_worker may select only org_id, session_id and meets_cutoff of quality_cards (never score)');
select is((select count(*)::int from unnest(array['integrity_cards', 'integrity_timeline_entries']) as t(n)
            where has_table_privilege('trace_quality_worker', ('public.' || t.n)::regclass, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
               or has_any_column_privilege('trace_quality_worker', ('public.' || t.n)::regclass, 'SELECT, INSERT, UPDATE, REFERENCES')), 0,
  'I-1: trace_quality_worker holds nothing on integrity_cards or integrity_timeline_entries');
select is((select count(*)::int from unnest(array['responses', 'session_items', 'item_answer_keys', 'item_versions', 'invitations']) as t(n)
            where has_any_column_privilege('trace_integrity_worker', ('public.' || t.n)::regclass, 'SELECT, INSERT, UPDATE, REFERENCES')
               or has_table_privilege('trace_integrity_worker', ('public.' || t.n)::regclass, 'DELETE, TRUNCATE, TRIGGER')), 0,
  'I-1: trace_integrity_worker holds nothing on responses, session_items, item_answer_keys, item_versions or invitations (it works from signals, not answers)');

-- ===== Roles and memberships (I-12; MT-14; ADR-029) =====
select is((select count(*)::int from pg_catalog.pg_roles where rolname like 'trace\_%' and rolcanlogin), 0, 'roles: no trace_* role can log in');
select is((select count(*)::int from pg_catalog.pg_roles where rolname like 'trace\_%' and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication)), 0,
  'roles: no trace_* role is superuser, bypasses RLS, creates roles or databases, or replicates');
select is((select array_agg(rolname::text order by rolname) from pg_catalog.pg_roles where rolname like 'trace\_%'),
  array['trace_admin_worker', 'trace_api', 'trace_authoring_worker', 'trace_candidate', 'trace_candidate_gateway', 'trace_integrity_worker', 'trace_quality_worker', 'trace_worker'],
  'roles: the trace_* roles are exactly api, candidate, candidate_gateway, worker, quality_worker, integrity_worker and the M1 authoring and admin workers (M1 R5-28 a)');
-- The only role that is a member of a trace_* role with a usable edge (inherit or set), other than the creator row of postgres
-- and the named login roles, is the gateway into trace_candidate (set true, inherit false).
select is((select array_agg(mem.rolname::text || '->' || grp.rolname::text || ':inherit=' || am.inherit_option::text || ',set=' || am.set_option::text order by mem.rolname)
            from pg_catalog.pg_auth_members as am join pg_catalog.pg_roles as grp on grp.oid = am.roleid join pg_catalog.pg_roles as mem on mem.oid = am.member
           where grp.rolname like 'trace\_%' and mem.rolname <> 'postgres' and mem.rolname not in ('api_login', 'jobs_mirror_login', 'jobs_quality_login', 'jobs_integrity_login', 'jobs_authoring_login', 'jobs_admin_login')),
  array['trace_candidate_gateway->trace_candidate:inherit=false,set=true'], 'memberships: the only edge into a trace_* role (besides postgres and the named login roles) is gateway -> trace_candidate, inherit false, set true');
select is((select count(*)::int from pg_catalog.pg_auth_members as am join pg_catalog.pg_roles as mem on mem.oid = am.member where mem.rolname like 'trace\_%' and mem.rolname <> 'trace_candidate_gateway'), 0,
  'memberships: no trace_* role other than the gateway is a member of any role');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role', 'authenticator']) as s(r) cross join pg_catalog.pg_roles as g
            where g.rolname like 'trace\_%' and (pg_has_role(s.r, g.oid, 'USAGE') or pg_has_role(s.r, g.oid, 'SET'))), 0,
  'memberships: anon, authenticated, service_role and authenticator cannot use or set any trace_* role');
select is((select count(*)::int from pg_catalog.pg_roles as a cross join pg_catalog.pg_roles as b
            where a.rolname like 'trace\_%' and b.rolname like 'trace\_%' and a.oid <> b.oid
              and (pg_has_role(a.oid, b.oid, 'USAGE') or pg_has_role(a.oid, b.oid, 'SET'))
              and not (a.rolname = 'trace_candidate_gateway' and b.rolname = 'trace_candidate')), 0,
  'memberships: no trace_* role can use or set another trace_* role (worker roles stay separate, rule 1); the one exception is the gateway SET into trace_candidate');
select is(pg_temp.login_violations('{"api_login": "trace_api", "jobs_mirror_login": "trace_worker", "jobs_quality_login": "trace_quality_worker", "jobs_integrity_login": "trace_integrity_worker", "jobs_authoring_login": "trace_authoring_worker", "jobs_admin_login": "trace_admin_worker"}'::jsonb),
  '{}'::text[], 'MT-14: every operator-created login role that exists (api_login, jobs_*_login) is a member of exactly its one trace_* role with inherit false, set true, has no privileged attribute, and no unlisted login can use a trace_* role (absent roles pass)');
-- Controls: a login role created in this transaction is judged by the same check.
create role jobs_probe_login login;
grant trace_worker to jobs_probe_login;
select is(pg_temp.probe_only(pg_temp.login_violations('{"jobs_probe_login": "trace_worker"}'::jsonb)), array['jobs_probe_login:inherit_set'],
  'control: a login role granted a trace_* role with the default (inherit true) edge is flagged');
select is(pg_temp.probe_only(pg_temp.login_violations('{}'::jsonb)), array['jobs_probe_login->trace_worker:unlisted'],
  'control: a login role missing from the map that can use a trace_* role is flagged as unlisted');
revoke trace_worker from jobs_probe_login;
grant trace_worker to jobs_probe_login with inherit false, set true;
select is(pg_temp.probe_only(pg_temp.login_violations('{"jobs_probe_login": "trace_worker"}'::jsonb)), '{}'::text[],
  'control: the same login role with inherit false, set true on exactly one trace_* role passes');

-- ===== L-36: nothing in the result schemas is partitioned in D1 =====
select is((select count(*)::int from pg_catalog.pg_class as c where c.oid in ('integrity.signals'::regclass, 'integrity.flags'::regclass)
            and (c.relkind <> 'r' or c.relispartition or exists (select 1 from pg_catalog.pg_partitioned_table as p where p.partrelid = c.oid)
                 or exists (select 1 from pg_catalog.pg_inherits as i where i.inhparent = c.oid or i.inhrelid = c.oid))), 0,
  'L-36: integrity.signals and integrity.flags are plain, unpartitioned, uninherited tables in D1 (M4 partitions them by a forward migration)');
select is((select count(*)::int from pg_catalog.pg_class as c where c.relnamespace in ('quality'::regnamespace, 'integrity'::regnamespace) and (c.relkind = 'p' or c.relispartition)), 0,
  'L-36: no partitioned table or partition exists in quality or integrity');

-- ===== I-3: band rules are data; clear needs coverage; T3 reaches Strong only by untrusted or raw media =====
select is((select count(*)::int from pg_catalog.pg_constraint as k
            where k.conrelid = 'integrity.band_rule_versions'::regclass and k.contype = 'c' and k.convalidated
              and pg_get_constraintdef(k.oid) = 'CHECK (integrity.rule_table_valid(rules, families))'), 1,
  'I-3: band_rule_versions.rules is validated by integrity.rule_table_valid in a CHECK (the Rule shape)');
select is((select count(*)::int from pg_catalog.pg_constraint as k
            where k.conrelid = 'integrity.results'::regclass and k.contype = 'c' and k.convalidated
              and pg_get_constraintdef(k.oid) = $d$CHECK (((band <> 'clear'::integrity.band) OR (coverage_permille >= coverage_floor_permille)))$d$), 1,
  'I-3: integrity.results never stores clear on thin coverage (CHECK band <> clear or coverage >= floor)');
select is((select count(*)::int from pg_catalog.pg_constraint as k
            where k.conrelid = 'integrity.flags'::regclass and k.contype = 'c' and k.convalidated
              and pg_get_constraintdef(k.oid) = $d$CHECK (((NOT (untrusted OR raw_media)) OR (tier = 'T3'::text)))$d$), 1,
  'I-3: integrity.flags allows untrusted or raw_media only on tier T3 (rule 3)');
select is((select count(*)::int from pg_catalog.pg_trigger as t where not t.tgisinternal and t.tgenabled = 'A'
            and (t.tgrelid, t.tgname) in (('public.integrity_cards'::regclass, 'integrity_cards_guard'), ('public.integrity_cards'::regclass, 'integrity_cards_fill'),
                                          ('integrity.flags'::regclass, 'integrity_flags_guard'), ('integrity.results'::regclass, 'integrity_results_guard'),
                                          ('public.integrity_timeline_entries'::regclass, 'integrity_timeline_guard'))), 5,
  'I-3, I-9: the integrity card fill and guard, flag guard, result guard and timeline guard triggers exist and are ENABLE ALWAYS');

-- ===== I-4, I-5: frozen versions and pinned rulesets =====
select is((select count(*)::int from pg_catalog.pg_trigger as t join pg_catalog.pg_proc as p on p.oid = t.tgfoid
            where not t.tgisinternal and t.tgenabled = 'A' and p.prosecdef
              and t.tgname in ('sections_guard', 'item_versions_guard', 'item_answer_keys_guard', 'rubric_versions_guard', 'ruleset_versions_guard', 'test_versions_guard',
                               'notice_versions_freeze', 'band_rule_versions_freeze')), 8,
  'I-4: the eight freeze/guard triggers (sections, items, keys, rubrics, rulesets, test versions, notices, band rules) are SECURITY DEFINER and ENABLE ALWAYS, so no role or replica mode skips them');
select is((select a.attnotnull and not a.atthasdef from pg_catalog.pg_attribute as a where a.attrelid = 'public.test_versions'::regclass and a.attname = 'quality_cutoff'), true,
  'I-4: test_versions.quality_cutoff is NOT NULL with no default (L-15)');
select is((select count(*)::int from pg_catalog.pg_constraint as k
            where k.conrelid = 'public.sessions'::regclass and k.contype = 'f'
              and pg_get_constraintdef(k.oid) in (
                'FOREIGN KEY (org_id, test_version_id, ruleset_version_id) REFERENCES test_versions(org_id, id, ruleset_version_id) ON DELETE RESTRICT',
                'FOREIGN KEY (org_id, invitation_id, test_version_id) REFERENCES invitations(org_id, id, test_version_id) ON DELETE RESTRICT',
                'FOREIGN KEY (org_id, invitation_id, id) REFERENCES invitations(org_id, id, session_id) ON DELETE RESTRICT')), 3,
  'I-5: a session is pinned to its invitation, session id and test version, and to that version''s ruleset, by composite foreign keys');
select is((select count(*)::int from unnest(array['ruleset_version_id', 'notice_version_id']) as c(n)
            where has_column_privilege('authenticated', 'public.test_versions'::regclass, c.n, 'INSERT') or has_column_privilege('authenticated', 'public.test_versions'::regclass, c.n, 'UPDATE'))
          + (select count(*)::int from unnest(array['band_rule_version_id', 'signal_settings']) as c(n)
              where has_column_privilege('authenticated', 'public.ruleset_versions'::regclass, c.n, 'INSERT') or has_column_privilege('authenticated', 'public.ruleset_versions'::regclass, c.n, 'UPDATE')), 0,
  'I-5: the ruleset and notice pins (test_versions) and the band rule and signal settings (ruleset_versions) are outside the authenticated INSERT and UPDATE grants (only the L-8 trigger sets them)');

-- ===== I-6, I-7 (rule 9): consent before session; adults only =====
select is((select count(*)::int from pg_catalog.pg_attribute as a
            where (a.attrelid, a.attname) in (('public.consents'::regclass, 'rendered_sha256'), ('public.sessions'::regclass, 'consent_id'), ('public.sessions'::regclass, 'invitation_id'))
              and a.attnotnull and not a.attisdropped), 3,
  'I-6: consents.rendered_sha256, sessions.consent_id and sessions.invitation_id are NOT NULL (no session without a consent that stored the rendered text hash)');
select is((select count(*)::int from pg_catalog.pg_constraint as k
            where k.conrelid = 'public.sessions'::regclass and k.contype = 'f'
              and pg_get_constraintdef(k.oid) = 'FOREIGN KEY (org_id, consent_id, invitation_id, ruleset_version_id) REFERENCES consents(org_id, id, invitation_id, ruleset_version_id) ON DELETE RESTRICT'), 1,
  'I-6: sessions reference the consent by composite FK on the same invitation and ruleset');
select is((select count(*)::int from pg_catalog.pg_trigger as t where not t.tgisinternal and t.tgenabled = 'A'
            and (t.tgrelid, t.tgname) in (('public.consents'::regclass, 'consents_guard'), ('public.sessions'::regclass, 'sessions_guard'), ('public.invitations'::regclass, 'invitations_guard'))), 3,
  'I-6, I-7: the consent, session and invitation guard triggers (age before consent, consent before session) are ENABLE ALWAYS');
select is((select count(*)::int from pg_catalog.pg_constraint as k
            where k.conrelid = 'public.invitations'::regclass and k.contype = 'c' and k.convalidated
              and pg_get_constraintdef(k.oid) in (
                $d$CHECK ((((adult_confirmed_by_inviter IS FALSE) OR (adult_self_declared IS FALSE)) = (status = 'blocked_age'::invitation_status)))$d$,
                $d$CHECK (((status = 'blocked_age'::invitation_status) = (age_block_source IS NOT NULL)))$d$)), 2,
  'I-7: a minor flag and blocked_age imply each other, and blocked_age implies a source (L-31 CHECKs)');
select is((select count(*)::int from pg_catalog.pg_constraint as k
            where k.conrelid = 'public.sessions'::regclass and k.contype = 'c' and k.convalidated and pg_get_constraintdef(k.oid) = 'CHECK (adult_confirmed_at_start)'), 1,
  'I-7: a session row records adult_confirmed_at_start = true or cannot exist');
select is_empty($q$
  select n.nspname || '.' || c.relname || '.' || a.attname
    from pg_catalog.pg_attribute as a join pg_catalog.pg_class as c on c.oid = a.attrelid join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
   where n.nspname in ('public', 'quality', 'integrity', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f') and not c.relispartition
     and a.attnum > 0 and not a.attisdropped
     and a.attname ~* '(^|_)(age|ages|dob|birth|birthdate|birthday|years_old)(_|$)' and a.attname <> 'age_block_source'
$q$, 'I-7: only booleans and a source are stored about age: no age, date-of-birth or birth column exists (age_block_source is the one allowed name)');

-- ===== I-8 (rule 8): media allow-list =====
select is((select count(*)::int from pg_catalog.pg_constraint as k
            where k.conrelid = 'public.media_objects'::regclass and k.contype = 'c' and k.convalidated
              and pg_get_constraintdef(k.oid) in ($d$CHECK ((kind = 'start_photo'::text))$d$, 'CHECK (blurred_on_device)')), 2,
  'I-8: media_objects admits only kind start_photo and only blurred_on_device = true');
select is((select count(*)::int from unnest(array['r2_key', 'sha256']) as c(n)
            where has_column_privilege('authenticated', 'public.media_objects'::regclass, c.n, 'SELECT')), 0,
  'I-8: authenticated cannot select media_objects.r2_key or sha256 (bytes are reached only through the audited grant functions)');
select is((select array_agg(p.proname::text || '=' || coalesce((select string_agg(coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC'), ',' order by coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC'))
                                                              from aclexplode(p.proacl) as a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '-') order by p.proname)
            from pg_catalog.pg_proc as p where p.pronamespace = 'private'::regnamespace and p.proname like 'media\_%\_grant'),
  array['media_link_grant=trace_api', 'media_view_grant=trace_api'], 'I-8: the two media grant functions are executable by trace_api only (L-2); the viewer check is not executable by anyone but its owner');

-- ===== I-9 (rule 6): review state and visibility =====
select is((select count(*)::int from pg_catalog.pg_attribute as a
            where (a.attrelid, a.attname) in (('integrity.results'::regclass, 'band'), ('public.integrity_cards'::regclass, 'band'), ('public.integrity_cards'::regclass, 'photo_missing'),
                                              ('public.integrity_cards'::regclass, 'review_state'), ('integrity.results'::regclass, 'coverage_permille'))
              and a.attnotnull), 5, 'I-9: the band is always stored (NOT NULL on results and cards), with the review state, coverage and photo flag');
select is((select count(*)::int from pg_catalog.pg_policies where schemaname = 'public' and tablename in ('integrity_cards', 'integrity_timeline_entries')
            and cmd = 'SELECT' and 'authenticated' = any(roles) and qual ~ 'reviewed'), 4,
  'I-9: every authenticated SELECT policy on integrity_cards and integrity_timeline_entries (staff arm and reviewer arm) requires the reviewed state');

-- ===== I-10: append-only for every role including the owner =====
select is_empty($q$
  select t.n
    from unnest(array['public.consents', 'public.integrity_timeline_entries', 'integrity.signals', 'quality.grader_runs']) as t(n)
   where has_table_privilege('postgres', t.n::regclass, 'UPDATE') or has_table_privilege('postgres', t.n::regclass, 'DELETE') or has_table_privilege('postgres', t.n::regclass, 'TRUNCATE')
      or has_table_privilege('authenticated', t.n::regclass, 'UPDATE') or has_table_privilege('authenticated', t.n::regclass, 'DELETE') or has_table_privilege('authenticated', t.n::regclass, 'TRUNCATE')
$q$, 'I-10: UPDATE, DELETE and TRUNCATE are revoked on consents, timeline entries, signals and grader_runs, including from the owner');
select is_empty($q$
  select t.n
    from unnest(array['public.consents', 'public.integrity_timeline_entries', 'integrity.signals', 'quality.grader_runs']) as t(n)
   where not exists (select 1 from pg_catalog.pg_trigger as g where g.tgrelid = t.n::regclass and not g.tgisinternal and g.tgenabled = 'A' and (g.tgtype & 1) = 1 and (g.tgtype & 2) = 2 and (g.tgtype & 16) = 16)
      or not exists (select 1 from pg_catalog.pg_trigger as g where g.tgrelid = t.n::regclass and not g.tgisinternal and g.tgenabled = 'A' and (g.tgtype & 1) = 1 and (g.tgtype & 2) = 2 and (g.tgtype & 8) = 8)
      or not exists (select 1 from pg_catalog.pg_trigger as g where g.tgrelid = t.n::regclass and not g.tgisinternal and g.tgenabled = 'A' and (g.tgtype & 1) = 0 and (g.tgtype & 2) = 2 and (g.tgtype & 32) = 32)
$q$, 'I-10: each append-only table has ENABLE ALWAYS BEFORE UPDATE and BEFORE DELETE row triggers and a BEFORE TRUNCATE statement trigger');

-- ===== I-11: exactly-once keys =====
select is((select count(*)::int from pg_catalog.pg_indexes where indexdef in (
  'CREATE UNIQUE INDEX signals_org_id_session_id_seq_key ON integrity.signals USING btree (org_id, session_id, seq)',
  'CREATE UNIQUE INDEX scores_org_id_session_id_scoring_version_key ON quality.scores USING btree (org_id, session_id, scoring_version)',
  'CREATE UNIQUE INDEX results_org_id_session_id_ruleset_version_id_key ON integrity.results USING btree (org_id, session_id, ruleset_version_id)',
  'CREATE UNIQUE INDEX flags_org_id_session_id_rule_id_key ON integrity.flags USING btree (org_id, session_id, rule_id)')), 4,
  'I-11: natural unique keys exist on signals (gseq), quality scores (scoring version), integrity results (ruleset) and flags (rule)');
select is((select count(*)::int from pg_catalog.pg_index as i where i.indrelid = 'quality.grader_runs'::regclass and i.indisunique and i.indnullsnotdistinct
            and pg_get_indexdef(i.indexrelid) ~ '\(org_id, session_item_id, rubric_version_id, model_id, pass_no\)'), 1,
  'I-11: quality.grader_runs is unique per item, rubric, model and pass with NULLS NOT DISTINCT (a null rubric cannot duplicate)');

-- ===== I-12 (rule 5, tenancy): every D1 table is org-scoped, RLS-protected, and carries the scoping columns =====
select is_empty($q$
  select t.n
    from unnest(array['public.tests','public.test_versions','public.sections','public.item_versions','public.item_answer_keys','public.rubric_versions','public.ruleset_versions',
      'public.notice_versions','public.assignments','public.invitations','public.consents','public.sessions','public.session_items','public.responses','public.media_objects',
      'public.quality_cards','public.integrity_cards','public.integrity_timeline_entries','public.reports',
      'quality.scores','quality.grader_runs','integrity.band_rule_versions','integrity.signals','integrity.flags','integrity.results']) as t(n)
    join pg_catalog.pg_class as c on c.oid = t.n::regclass
   where not c.relrowsecurity
      or not exists (select 1 from pg_catalog.pg_attribute as a where a.attrelid = c.oid and a.attname = 'org_id' and a.attnotnull and not a.attisdropped)
      or not exists (select 1 from pg_catalog.pg_index as i join pg_catalog.pg_attribute as a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                      where i.indrelid = c.oid and a.attname = 'org_id')
$q$, 'I-12: all 25 D1 tables have RLS enabled, a NOT NULL org_id and an index that leads with org_id');
select is_empty($q$
  select c.relname
    from pg_catalog.pg_class as c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     -- M1 R5-28 c / R5-44: item_versions and item_answer_keys left this NOT NULL list (bank rows have no test); their
     -- inline rows still always carry the test: rls_m1_bank (placement CHECK, R2-2) and rls_m1_keys (key guard).
     and c.relname in ('sections','assignments','invitations','consents','sessions','session_items','media_objects',
                       'quality_cards','integrity_cards','integrity_timeline_entries','reports','test_versions','ruleset_versions')
     and (select count(*) from pg_catalog.pg_attribute as a where a.attrelid = c.oid and a.attname in ('workspace_id', 'test_id') and a.attnotnull and not a.attisdropped) <> 2
$q$, 'I-12 (L-27): every app-readable child table carries NOT NULL workspace_id and test_id for the workspace and reviewer fences');
select is((select count(*)::int from pg_catalog.pg_policy as pol where pol.polrelid in (
  select c.oid from pg_catalog.pg_class as c where c.relnamespace in ('public'::regnamespace, 'quality'::regnamespace, 'integrity'::regnamespace) and c.relkind in ('r', 'p'))
  and (0 = any(pol.polroles) or pol.polcmd = '*')), 0,
  'I-12: no policy in the D1 schemas is granted to PUBLIC or written FOR ALL (one policy per operation and role set)');

select * from finish();
rollback;
