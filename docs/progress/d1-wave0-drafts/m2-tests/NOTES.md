# D1 migration 2 pgTAP tests (RED first)

Target: `<ts2>_d1_invites_sessions.sql` (specs/d1-demo-slice.md §3.1 row 2). Style copied from `supabase/tests/rls_teams.test.sql` and
`rls_idempotency.test.sql`: standalone `begin; select plan(N); ... select * from finish(); rollback;`, fixed UUIDs, synthetic
`@example.test` personas, `pg_temp.try`, JWT claims as in `specs/m0b-tenancy.md` §6, worker/api org through `set local trace.job_org_id` /
`trace.api_org_id`. `plan(N)` equals the real assertion count (one `select is|ok|matches(...)` line each). Files are generated, so every
file repeats the same personas and authoring fixtures. Each file carries the `D1-M1-SHIM` block (copied from `45206c8:supabase/tests/rls_d1_tests.test.sql`)
so that publishing works without migration 3; the shim is skipped once `integrity.band_rule_versions` exists. Remove it from these files with the
migration-1 ones when migration 3 lands.

| File | §3.6 estimate | Written | Covers |
| --- | --- | --- | --- |
| rls_d1_invitations.test.sql.draft | 70 | 138 | label sequence, S arms (OW/AD/RC/ws-RC/RV/RV-aal1/HM/pw/removed/suspended/cross-org/workers/api), I arms and denials, pin to a published version, contact and hash CHECKs, immutable columns, authenticated revoke-only (R-14), L-1 `sent` by `trace_api`, L-17 `started` and set-once `started_at`, L-32 `expired`, L-35 `submitted` needs a session, audit keys |
| rls_d1_api.test.sql.draft | 50 | 87 | `trace_api` cells (`test_versions` S(c), `notice_versions`, `invitations` S(c) U(c), `consents` S I), no grant elsewhere, no `quality`/`integrity` privilege, `resolve_invitation_by_hash` (rows, columns, EXECUTE, definer, search_path), `api_org_id` |
| rls_d1_consents.test.sql.draft | 35 | 69 | insert guard (otp_verified, both adult flags), replay no-op, CHECKs, composite FKs, writers (`trace_api` only), S arms, append-only (revoke 42501 then `P0001 TRACE_APPEND_ONLY`, normal and replica), notice immutability, no consent no session |
| rls_d1_age.test.sql.draft | 25 | 49 | inviter `false` forces `blocked_age`, self-declared minor, terminal state for every role, L-31 CHECK probes, no consent or session on a blocked invitation, MT-3 column scan |
| rls_d1_sessions.test.sql.draft | 40 | 93 | S arms, insert pins (consent, ruleset, session id, version), CHECKs, uniques, set-once and forward-only `mirror_seq`, `session_items` triggers, `private.mirror_session` (happy path, `'duplicate'` incl. different `mirror_seq`, cross-org raise, `'dead_invitation'`, EXECUTE, INVOKER) |
| rls_d1_responses.test.sql.draft | 20 | 67 | `session_items` cells, `responses` (no app-role access, worker S I, quality worker S), CHECKs, insert-only, I-1/I-2 column and enum scans |
| rls_d1_media.test.sql.draft | 30 | 52 | `media_objects` S(c) (no `r2_key`/`sha256`), insert CHECKs (rule 8 allow-list, blurred, mime, bytes, key shape), one photo per session, cross-org, insert-only, no biometric column |
| rls_d1_idempotency.test.sql.draft | 25 | 78 | L-20: each worker inserts and selects only its own scope for `job_org_id()`, other scope/org/unset denied, UPDATE/DELETE/TRUNCATE denied, M0b policies dropped, no literal-true policy, key shape, replay `on conflict do nothing` |

Total 633 assertions in 8 files. Counts exceed the §3.6 estimates because every §3.3 cell gets an allowed case, a denied case and cross-org / unset cases.

## Dependencies on other migrations
- **Migration 1 only** (with the shim): the user/org/authoring fixtures of every file, all of `rls_d1_idempotency` except the policy-name assertions (which need migration 2 to drop the M0b policies).
- **Migration 3 for real** (not the shim): `reports` assertions in rls_d1_sessions (`mirror_session` writes `public.reports`), and the SELECT denials in rls_d1_api on (`quality_cards`, `integrity_cards`, `integrity_timeline_entries`, `reports`, `quality.scores`, `integrity.results` must exist for the 42501 to be the error).
- Everything else needs migration 2 only.
- **Existing file `supabase/tests/rls_idempotency.test.sql` (M0b) will turn red** when migration 2 lands: it asserts that `trace_worker` updates, deletes and reads every org's rows. The lead must update it (or drop the worker cases) in the same change.

## Spec ambiguities (flagged, not resolved)
1. **Invitation insert columns and defaults.** §3.3 says "INSERT of the creation columns". The tests insert `(org_id, test_id, test_version_id, contact_email, link_token_hash, adult_confirmed_by_inviter, expires_at)` and assume `status` defaults to `created`, `candidate_label`, `workspace_id`, `created_by` come from triggers, and `expires_at` is supplied by the client.
2. **Guard error codes.** The SQLSTATE and tag of the invitation, consent and session guards are not pinned. The tests accept `^(42501 TRACE_GUARD|P0001 TRACE_FROZEN)` (plus `23503` where a composite FK could fire if the trigger does not) and `^(23514|42501 TRACE_GUARD)` for the L-31 CHECK probes, since BEFORE triggers run before CHECKs. Pin and tighten.
3. **Role-specific denial vs RLS-hidden rows.** All org roles share `authenticated`, so a hidden row gives `OK 0` on UPDATE and `42501 new row violates row-level security` on INSERT. Reviewer/HM revoke is accepted as `OK 0` or `42501`; pin once the policies exist.
4. **USAGE on schema `private`.** The lead says no app/worker role holds it today, but `trace_api` must call `private.resolve_invitation_by_hash` and `private.media_*_grant`, and `trace_worker` must call `private.mirror_session` and `sweep_pending`, over SQL after `SET LOCAL ROLE`. The tests assert `has_schema_privilege('trace_api'|'trace_worker', 'private', 'USAGE')` is true and call the functions as the role. If the design instead wraps them, change those assertions.
5. **`mirror_session` message and return values.** The success return value is unspecified (tests accept anything except `'duplicate'`/`'dead_invitation'`, cast to text). The SQL function receives `SessionMirrorMessage` as `p_msg`, but that message has no answers (they live in R2 `final.json`) and no `section_id` for `served` items; an INVOKER `trace_worker` cannot read `item_versions`/`sections` (§3.3 shows `·`). So how `responses` and `session_items.section_id` reach the function is open; the tests assert the `session_items` row count only and assert nothing about `responses`.
6. **`mirror_session` and migration order.** It writes `public.reports`, which migration 3 creates. The happy-path assertions need migrations 2 and 3 together.
7. **`dead_invitation` setup.** §10-DB describes it for a revoke that wins after a DO start, which the state machine forbids. The test uses a revoked invitation with no consent or session and expects `'dead_invitation'` with nothing stored.
8. **`sessions.workspace_id` / `test_id`.** §3.2 lists them as columns but names the scoping-copy trigger only for consents, session_items and media_objects. The tests supply both on session inserts (correct values) and omit them on the other three.
9. **Which `sessions` columns the worker may update.** The tests assume `state`, `submit_kind`, `submitted_at`, `mirror_seq` are updatable; `started_at`, `server_deadline_at`, `submitted_at` (once set), `receipt_ref` set-once; the spec lists no column grant. `mirror_seq` equal/lower is expected as `42501|P0001` ("hard error at the trigger").
10. **`media_objects.sha256` format** has no CHECK in the spec (the tests do not assert one). The key-shape violation error is accepted as `TRACE_GUARD` or `23514`.
11. **`consents` insert privilege.** Tests insert `(id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event, occurred_at)` as `trace_api`; `occurred_at` and `language` defaults are not specified.
12. **Idempotency policies.** The spec says "scope equal to its own job" with SELECT and INSERT policies per worker role. The count assertion (six SELECT/INSERT policies, each mentioning `job_org_id`) assumes exactly one policy per operation per role and no other policy on the table.
13. **Quality/integrity worker reads on `sessions`.** §3.3 gives them `S`; the tests assume org-wide visibility bounded by `job_org_id()` (no column limit).
14. **Plan file ownership.** The task list excludes `rls_d1_media_view`, `rls_d1_results`, `rls_d1_cards`, `rls_d1_reports`, `rls_d1_sweep`, `rls_d1_candidate_denied` and `rls_d1_invariants`; `sweep_pending` and the media grant functions are not covered here.
15. **Under-18 and `mirror_session`.** §3.4 does not say what `mirror_session` returns for a `blocked_age` invitation; not asserted.

## Checking done
Each file was run (rolled back, `ON_ERROR_STOP` off) against the local DB with migration 1 applied: the personas, authoring fixtures (shim, publish, retire, second draft, reviewer assignment) execute, every statement parses, and the first failure in each file is `relation "public.invitations" does not exist` (expected, migration 2 is absent). The dynamic `pg_temp.try($$...$$)` bodies were parsed with `PREPARE`: no syntax errors. `rls_d1_idempotency` runs against the M0b policies and fails where expected (literal-true policies).
