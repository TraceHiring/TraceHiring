# D1 wave-0 drafts: `rls_d1_candidate_denied` and `rls_d1_invariants` (not placed)

Target: `supabase/tests/`, on top of migrations 1 to 4 (also green on 1 to 3; the three `private.media_*` functions are covered generically). Both drafts are catalogue-only (no fixtures, no rows), run inside `begin; ... rollback;`, and contain no personas or PII.
Validated by piping a temporary copy (with `create extension if not exists pgtap with schema extensions;` after `begin;`) into `docker exec -i supabase_db_trace psql ...`; the drafts themselves do not contain that line. Both ran to completion: all ok, none not ok.

| File | `plan(n)` | Result |
| --- | --- | --- |
| `rls_d1_candidate_denied.test.sql.draft` | 36 (spec ~25) | 36/36 ok |
| `rls_d1_invariants.test.sql.draft` | 66 (spec ~35) | 66/66 ok |

Both overshoot the spec estimate; the surplus is one assertion per role per privilege kind (denied) and one assertion per §3.7 row mechanism (invariants). The lead can merge the three per-role blocks if a smaller file is wanted.

## rls_d1_candidate_denied (rule 5, AT-D11 first clause, I-12)

Helper functions in `pg_temp`: `leaks(role, kind)` returns a sorted array of every privilege held (empty array = none); `public_grants(kind)` returns every ACL entry whose grantee is PUBLIC.

- 1 assertion: the 25 D1 tables exist (so nothing is vacuous).
- 15 assertions: `trace_candidate`, `trace_candidate_gateway`, `anon` x (table/view privileges incl. TRUNCATE/REFERENCES/TRIGGER, column privileges, sequence privileges, EXECUTE on any function, schema USAGE/CREATE on quality/integrity/private and CREATE on public). The scans enumerate `pg_class` and `pg_proc` in public, quality, integrity and private, so `private.media_viewer_check`, `media_link_grant`, `media_view_grant` (and any later function) are covered without editing the file. Results include inherited and PUBLIC privileges because they use `has_*_privilege`.
- 4 assertions: no PUBLIC ACL entry on relations/sequences, functions or the internal schemas; no default ACL of `postgres` in the four schemas grants to PUBLIC, anon or the candidate roles.
- 13 assertions: direct calls as each role returning `42501 permission denied` (sessions, quality_cards, integrity_cards, insert into consents, `quality.scores`, `private.resolve_invitation_by_hash`; gateway: invitations, `integrity.results`, `private.mirror_session`; anon: media_objects, truncate reports, `integrity.flags`, `private.api_org_id`).
- 3 control assertions: after an in-transaction `grant select on public.sessions` and `grant execute on private.sweep_pending` to `trace_candidate`, the scans report exactly that, and the gateway (SET-only edge, no inherit) still reports nothing.

Result on the current schema: nothing is granted to any of the three roles on any D1 object. No rule-5 finding.

Noted, not a finding: all three roles (through PUBLIC) have `USAGE` on schema `public` and `anon` has `USAGE` on `auth` and `extensions`. That is the Supabase default and grants no object privilege; the draft asserts only `CREATE` on `public` and the three internal schemas. Exact queries are the `leaks(..., 'schema')` scan and `has_schema_privilege('anon', 'auth', 'USAGE')`.

## rls_d1_invariants (§3.7 I-1 to I-13, §3.5 MT-3 scan, MT-14, L-36)

Helpers: `reach(role, schema)`, `app_roles()`, `login_violations(map jsonb)`, `probe_only(list)`.

| Group | Assertions | Proves |
| --- | --- | --- |
| I-1, I-13 column placement | 5 | score/band/grade/outcome whole-word columns only in `quality.scores`, `quality_cards`, `integrity.results`, `integrity_cards` (2 named exceptions below); no `%score%|%band%|%grade%|%outcome%` column in responses, invitations, sessions, media_objects, reports, session_items; `integrity.band` type used by exactly one column; no public column has a quality/integrity type; no combined/overall/trust/honesty/cheat/emotion/voiceprint/face-template/gaze/dob/birth/AI-likeness column |
| I-2 (rules 2, 4) | 10 | no `%reject%` column; no table/view/sequence or function named reject/decision/decid/overturn/appeal/shortlist/decline/confirm; the only `notice` table is `notice_versions`; no such enum label; exact `invitation_status` and `integrity.band` labels; `flags_d1_no_confirm` exact definition; timeline `flag_state = 'pending'` CHECK; no CHECK admits confirmed/overturned/rejected/declined/appealed/upheld/decided |
| I-1 bridging (rule 1) | 12 | no view reads both internal schemas, no public/private view reads either; no function body names both; mirror/sweep/hash-lookup/media/`membership_counts_for` bodies name neither; no FK/CHECK links the two schemas; public-to-internal FKs are exactly `quality_cards->quality.scores`, `integrity_cards->integrity.results`, `ruleset_versions->integrity.band_rule_versions`; no policy names both; only `trace_quality_worker` reaches `quality`, only `trace_integrity_worker` reaches `integrity` (among platform, trace_* and existing login roles); the integrity worker's `quality_cards` column grant is exactly `org_id, session_id, meets_cutoff`; quality worker holds nothing on integrity cards/timeline; integrity worker holds nothing on responses/session_items/answer keys/item_versions/invitations |
| Roles and memberships | 11 | no `trace_*` role can log in; no privileged attribute; exact role set; the only usable edge into a `trace_*` role (besides postgres and the named logins) is gateway to candidate, `inherit false, set true`; no other `trace_*` role is a member of anything; anon/authenticated/service_role/authenticator cannot use or SET any `trace_*` role; no `trace_*` role can use/SET another (except gateway to candidate); `login_violations` over the four operator logins; 3 controls on a login role created inside the transaction (inherit-true edge flagged, unlisted login flagged, correct edge passes) |
| L-36 | 2 | `integrity.signals`/`flags` are plain, unpartitioned, uninherited; no partitioned table or partition in quality/integrity |
| I-3 | 4 | `rule_table_valid` CHECK; `clear` needs coverage >= floor CHECK; untrusted/raw_media only on T3 CHECK; card fill/guard, flag, result and timeline guard triggers ENABLE ALWAYS |
| I-4, I-5 | 4 | the eight freeze/guard triggers are DEFINER and ENABLE ALWAYS; `quality_cutoff` NOT NULL without default; the three composite session FKs; ruleset/notice/band-rule/signal-settings pins are outside the `authenticated` INSERT/UPDATE grants |
| I-6, I-7 (rule 9) | 6 | consent hash/consent id/invitation id NOT NULL; session to consent composite FK; consent/session/invitation guard triggers ENABLE ALWAYS; the two L-31 age CHECKs; `adult_confirmed_at_start` CHECK; no age/dob/birth column (`age_block_source` allowed) |
| I-8 (rule 8) | 3 | media `kind` and `blurred_on_device` CHECKs; `authenticated` cannot SELECT `r2_key`/`sha256`; the two media grant functions are executable by `trace_api` only, the check by nobody |
| I-9 (rule 6) | 2 | band/coverage/review_state/photo flag NOT NULL; every authenticated SELECT policy on cards and timeline requires `reviewed` |
| I-10 | 2 | UPDATE/DELETE/TRUNCATE revoked from the owner and `authenticated` on the four append-only tables; ENABLE ALWAYS BEFORE UPDATE, BEFORE DELETE and BEFORE TRUNCATE triggers |
| I-11 | 2 | the four natural unique keys; `grader_runs` NULLS NOT DISTINCT unique |
| I-12 | 3 | all 25 tables: RLS on, NOT NULL `org_id`, index leading with `org_id`; app-readable children carry NOT NULL `workspace_id` and `test_id`; no policy to PUBLIC or `FOR ALL` |

Mutation check: a temporary copy that added a score column to `responses`, a reject-named column on `sessions`, a bridging view, a SELECT of `quality.scores` and `quality_cards.score` for the integrity worker, an `authenticated` membership in `trace_candidate`, a mis-granted `jobs_mirror_login`, and a disabled append-only trigger made 14 of the intended assertions fail (and only those). The `decision_x` column on `integrity.flags` was deliberately not caught: the column scan bans only `%reject%` (spec 3.5); decision-like names are scanned for tables, views, sequences, functions and enum labels.

## Login roles

`select rolname from pg_roles` locally: no `api_login`, `jobs_mirror_login`, `jobs_quality_login` or `jobs_integrity_login` exist. The membership assertion (`login_violations`) therefore passes vacuously for the four named roles, and also fails for any unlisted non-`trace_*` role (other than `postgres`) that can inherit or SET a `trace_*` role. The controls create `jobs_probe_login` inside the transaction (rolled back) to prove the check bites. Once an environment creates the four logins, the same assertion enforces exactly one membership, the mapped role, `inherit false, set true`.

## Facts found (queries to re-run)

- `postgres` is a member of each `trace_*` role with `inherit false, set false` (creator ADMIN rows): `select r.rolname, m.rolname, am.inherit_option, am.set_option from pg_auth_members am join pg_roles r on r.oid = am.roleid join pg_roles m on m.oid = am.member where r.rolname like 'trace\_%';`. The membership assertions exclude member `postgres`, as `rls_roles` does.
- Spec 3.7 I-13 says score columns exist only in four tables, but `quality.grader_runs.raw_score` (spec 3.2 itself lists it) and `ruleset_versions.band_rule_version_id` (a pointer) also match the whole-word scan. Both are listed as explicit exceptions in assertion 1. If the lead prefers, the spec sentence should say "result columns".
- `authenticated` has column SELECT (not INSERT/UPDATE) on `test_versions.ruleset_version_id`, `notice_version_id`, `ruleset_versions.band_rule_version_id`, `signal_settings`, and INSERT on `invitations.link_token_hash` (no SELECT). Matches spec 3.3 notes; the I-5 assertion checks only INSERT/UPDATE.
- Spec AT-D13 says "no decision, notice or appeal object". `public.notice_versions` exists (consent text versions, spec 3.2), so the draft allows exactly that table and no other notice object. Rule 4's notice-of-rejection object is M6.
- `integrity.*` internal tables reference `public.sessions`/`ruleset_versions`/`orgs` (internal to public FKs are normal); the FK assertion restricts only edges between the two internal schemas and the public to internal edges.

## Not proven by these files (and why)

- "No operator bypass" on freeze triggers (Q20) and that triggers fire in replica mode: needs behaviour tests with fixtures (rls_d1_tests, rls_d1_consents); here only `tgenabled = 'A'` and SECURITY DEFINER are proven.
- "No automatic rejection anywhere" (rule 2) beyond schema objects: API and jobs are covered by `route-inventory.test.ts`, not SQL.
- The `report_candidate_view` projection (rule 5, later milestone) does not exist in D1, so the "no view reads quality/integrity from public" assertion will need a deliberate edit when it arrives.
- Types: PUBLIC holds the default USAGE on enum types; not asserted (not a data privilege).
