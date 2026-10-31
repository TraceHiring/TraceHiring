# D1 migration 2 — database review (Opus database-reviewer, 2026-10-14)

Scope: `supabase/migrations/20261014094801_d1_invites_sessions.sql` at `a5a85c3` and its tests `supabase/tests/rls_d1_{invitations,api,consents,age,sessions,responses,media,idempotency}.test.sql`, plus the amended `rls_idempotency` and `rls_roles`. Probes ran rolled back on the local Postgres 17.11.

**Verdict: APPROVE WITH MINOR FIXES**: 0 Blocking, 1 Major, 5 Minor, 7 Notes. No break of rules 2, 5 or 9, no cross-org write, and no readable `link_token_hash`, `r2_key` or `sha256`. The lead's placement decisions (a)–(d) in `docs/progress/d1-wave0-drafts/m2/NOTES.md` were accepted.

Migration 2 was never applied to a shared database (no `workflow_dispatch` deploy has run; `check-migrations` compares with `origin/main`), so the fixes are made **in place** in the migration file, not forward.

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| M-1 | **Major** | `mirror_session` used `on conflict do nothing` on `session_items`, `responses` and `media_objects`: a malformed message (an item served twice, two answers for one item) still returned `stored`, and the first answer silently won over the final one, feeding Answer Quality. | **FIXED:** each child insert raises `22023 TRACE_BAD_MIRROR` on a unique conflict (the invitation lock and key check already make the call the first writer). Tests in `rls_d1_sessions` (served twice, answered twice; nothing stored). |
| m-1 | Minor | `invitations_label` read and locked `test_versions`/`tests` before the RLS `WITH CHECK`, so an org-B admin or a hiring manager could tell published, draft/retired and missing versions apart. | **FIXED:** an app caller must be staff of the test's workspace (`my_workspace_ids`) before anything is read or locked: one generic `42501 TRACE_GUARD: not allowed to invite to this test`. Six `rls_d1_invitations` denials pinned to it. |
| m-2 | Minor | A late `sessionStarted` after the mirror stored the session fails forever (`submitted` is terminal) and `started_at` stays null; `trace_api` cannot read `sessions`. | **OPEN** (ordering edge: the mirror runs after submit). Decide when the api's lobby module lands (Wave 1, R3): either a same-session `started` on a `submitted` row is a no-op for `trace_api`, or the mirror copies `startedAt` into a null `started_at` (set once). |
| m-3 | Minor | Malformed field values (`consentId: "nope"`, `mirrorSeq: "1.5"`) raised `22P02`, not the contracted `22023`, so a job dead-lettering on 22023 would retry a poison message forever. | **FIXED:** `mirror_session` maps cast errors (`invalid_text_representation`, `invalid_datetime_format`, `datetime_field_overflow`, `numeric_value_out_of_range`) to `22023 TRACE_BAD_MIRROR: a field has the wrong type`. Two tests. |
| m-4 | Minor | The `occurred_at` (consents) and `workspace_id`/`test_id` (sessions) INSERT grants did nothing: the guards always overwrite them, so a supplied value was silently discarded. | **FIXED:** removed from the grants (a supplied value now fails loudly); 98 fixture inserts in seven test files stopped supplying them; NOTES corrected. |
| m-5 | Minor | The consents TRUNCATE assertions also accepted the FK's `0A000`, so they passed without ever reaching the append-only trigger. | **FIXED:** `truncate public.consents cascade`, pinned to `P0001 TRACE_APPEND_ONLY` (normal and replica mode). |
| n-1 | Note | The worker guards (`sessions_guard`, `session_items_guard`, `media_objects_guard`) also read and lock another org's rows before RLS refuses (trusted roles only). | OPEN: align with the org-first rule when touched next (M3a). |
| n-2 | Note | Server-chosen ids hit global PKs: a cross-org collision is an existence oracle for the trusted `trace_api`/`trace_worker` only. | Accepted; derive deterministic ids from org-scoped inputs (api/jobs code). |
| n-3 | Note | `invitations.session_id` is unique per org only, while session ids are global. | OPEN (cheap): a global `unique (session_id)` with migration 3. |
| n-4 | Note | The `mirror_seq` update branch of `mirror_session` is unreachable in D1 (the key is per session). | Accepted for D1; M3a redesigns it. |
| n-5 | Note | A null inviter answer still yields `adult_confirmed_at_start = true` (allowed by D1-12, §3.2 "is not false"). | Accepted; the column name overstates it, note for M2. |
| n-6 | Note | `expires_at` has no CHECK. | OPEN: `expires_at > created_at` with migration 3. |
| n-7 | Note | No two-connection test for duplicate mirrors; the lock order gives exactly-once under READ COMMITTED (40001 under REPEATABLE READ, retried). `rls_roles` still has no exact `trace_api` table allow-list (migration-1 review m-4). | OPEN: a two-connection test in `workers/jobs` (AT-D16, stream R2). The `trace_api` allow-list is **done** (2026-10-16, with the migration-1 m-4 item, `rls_roles`). |

Result after the fixes: `pnpm test:rls` 24 files, rls 1840, catalog 142, db-types current.
