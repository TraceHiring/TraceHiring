# M0b SPEC review — `specs/m0b-tenancy.md`

Lead: Opus 5.5 session, 2026-10-12. Reviewers: fresh-context Opus subagents (AUTOPILOT §2 SPEC self-approval).

## Day-one checks run by the lead (local stack, rolled-back transactions, 2026-10-12)
- **DC-1 PASS.** `authenticated` with **no** USAGE on `private` (`has_schema_privilege` = false) is filtered correctly by a SELECT policy that calls a `private` SECURITY DEFINER helper it has EXECUTE on: it saw only its org's row. The policy form must be `org_id = any ((select private.fn())::uuid[])`; `org_id = any ((select private.fn()))` fails with `operator does not exist: uuid = uuid[]`.
- **DC-5.** BEFORE TRUNCATE statement triggers are **not** inherited: truncating a partition directly (including the DEFAULT partition) bypasses the parent's trigger; with its own trigger the partition is blocked, and truncating the parent fires the parent's trigger. BEFORE UPDATE OR DELETE **row** triggers on the parent are cloned to every partition (3 `pg_trigger` rows for parent + 2 partitions) and fire for the owner `postgres`. So every partition, the DEFAULT one included, needs its own TRUNCATE trigger (as revision 1 §2.4 says) and MT-13 must check each.

## spec-reviewer (revision 1): CHANGES REQUIRED — 1 Blocking, 15 Medium, 9 Low
No rule 1–9 violation; build-notes §4 invariant 12 room-left items kept; every exit-gate clause maps to an AT.

| # | Sev | § | Problem | Fix to apply in revision 2 |
| --- | --- | --- | --- | --- |
| S1 | Blocking | 2.7, 4.2, 1.3 | Build-time Supabase vars unworkable: a production build without them "fails" but CI `static`/`pnpm verify` build without staging vars; `VITE_SUPABASE_PUBLISHABLE_KEY` contains `KEY` (forbidden by `scripts/check-boundaries.mjs:50-51`); deploy-step env mapping unspecified; CSP origin in a static `_headers` undefined (`apps/recruiter/src/security-hygiene.test.ts:70-71` pins `'self'`); no H row for staging URL/key | Define verify/CI default; exact `ALLOWED_VITE_NAMES` entry + test; deploy env mapping; how `_headers` gets the origin; H row for `SUPABASE_STAGING_{URL,PUBLISHABLE_KEY}` |
| S2 | Medium | 4.1, 4.2, AT-B8, 10 | Email-OTP can ship broken: default magic-link template has no `{{ .Token }}`; OTP only tested with a fake client; §10 claim "RLS amr cases fail loudly" is false (synthetic claims) | `[auth.email.template.magic_link]` with `{{ .Token }}` (+H8); enable mailpit for AT-B8 and run OTP end to end asserting real `amr`; fix §10 |
| S3 | Medium | AT-B8, 11 | AT-B8 needs PostgREST + Kong but the harness excludes them (`scripts/test-rls.mjs:52-80`) | Specify the new `-x` list; AT-B8 runs in `test:rls` locally and in CI |
| S4 | Medium | 2.3, 2.5, 9 | Hosted-only failures (role creation, `auth.sessions` trigger) surface after the migration is frozen; a failing file can't be fixed forward | Separate migration files for hosted-sensitive statements, or prove on `trace-dev` via a founder step before CLOSE; idempotent role creation; "db reset twice" in DC-3 |
| S5 | Medium | 5 MT-14, 6, 8 | PG16+: non-superuser `postgres` with CREATEROLE becomes an ADMIN member (INHERIT/SET false) of roles it creates → MT-14 `candidate_member` flags `postgres`; `set local role trace_worker` as `postgres` fails without SET | DC-3; MT-14 counts only memberships with inherit or set; tests grant SET to `postgres` inside their transaction |
| S6 | Medium | 2.4, MT-13, AT-B3 | Owner-blocking rests on ordinary triggers; `session_replication_role = replica` disables them (if supautils allows it); `anon` missing from the role list | Triggers `ENABLE ALWAYS`; MT-13 checks `tgenabled = 'A'`; revoke UPDATE/DELETE/TRUNCATE from the owner too; DC + pgTAP under replica mode; add `anon` |
| S7 | Medium | 2.4, 6, 10 | Audit events incomplete/untested: no `org.update` (Q11 "settings changes"); `details` keys per event undefined; only the membership event tested; `auth.sign_in` untested | Add `org.update`; per-event `details` contract table; one pgTAP case per event incl. sign-in |
| S8 | Medium | 3.1, 3.5, 2.6 | No membership state machine: `create_org` leaves the owner `invited` (no access, last-owner rule fails); who moves invited→active undefined; invited access undefined; removed + `unique (org_id, user_id)` blocks rejoin; `org_status = suspended` undefined | Transition table (who, transition, audit event); `create_org` inserts `active`; partial unique `where status <> 'removed'` or state rejoin out of scope; suspended-org behaviour in helpers |
| S9 | Medium | 3.5, 3.9 | Admins can suspend/remove an owner, strip an owner's admin role, or workspace-restrict an owner | Any UPDATE of a row holding `org_owner` is owner-only; say whether `workspace_id` limits admin powers; tests |
| S10 | Medium | 2.3, MT-14, rls_roles | Rule-1 role check covers only the two worker roles; a role granted both worker roles passes | MT-14 branch + pgTAP: no non-owner role holds USAGE on both schemas through any membership chain; no role is a member of both worker roles |
| S11 | Medium | 1.3 H9, 4.4 | `create-smoke-user` uses the service-role key outside a server worker (CLAUDE.md Tenancy) | Founder creates the user in the dashboard; script signs in with password, enrols TOTP, calls `create_org` over `TRACE_OPERATOR_DB_URL`; both in H9 |
| S12 | Medium | 3.9 | Directory policy exposes `status`, `removed_at`, `created_by`, `user_id` of removed/suspended colleagues | RC/RV directory rows limited to `status in ('invited','active')`; log under build-notes "Autopilot changes" |
| S13 | Medium | 1.2, 3.7 | T&S read path has no owner milestone | Name the owner; Deferred table, Autopilot-changes row, FOUNDER-QUEUE FYI |
| S14 | Medium | 8 | Spike doesn't show RLS "understands" the token (zero rows only from missing grants) | Throwaway table + policy keyed on a candidate claim, one allowed + one denied row; zod claim shape in ADR-030 |
| S15 | Medium | whole | No zod contracts (create-org args, auth form inputs, shell rows, audit `details`); no recruiter auth UI state machine | Contracts section + state diagram |
| S16 | Medium | 11 | Stream reviews don't follow AUTOPILOT §2 (no spec-reviewer on B0/B1/B4, none on B5) | spec-reviewer on every stream |
| S17 | Low | 2.4 | Trigger functions must be SECURITY DEFINER in `private` | State it |
| S18 | Low | 2.2 vs 3.9 | Own-row membership SELECT not AAL-gated | Decide, state, test |
| S19 | Low | 2.5 | `details.aal` always `aal1` (step-up updates the session) | Record `amr` methods or also trigger on `UPDATE OF aal` |
| S20 | Low | 2.4 | A month whose rows landed in DEFAULT can never get its partition | Edge-case row + `create_audit_partition` behaviour |
| S21 | Low | 2.1 | Q3's `active_org_id` hint dropped; multi-org shell undefined | Note the deviation; define multi-org shell |
| S22 | Low | 1.2 | `org_policies` is listed under M3 (`docs/build-notes.md:549`), not M1/M2 | Fix cite and owner (M3a) |
| S23 | Low | 11 vs 9 | B0 lists DC-1..5 but DC-6/7 exist; no stream owns the ESLint boundary for `@trace/workers-http` | Assign both |
| S24 | Low | AT-B9 | Staging gate proven via REST API, not the deployed app | State the proxy is accepted, or add a headless browser step |
| S25 | Low | 6 | Missing personas: second owner, invited member, workspace-scoped admin | Add them |

HOW-vs-WHAT (reviewer): every scope call in revision 1 is HOW (no T&S read policy — needs an owner and logging; directory widening — log and narrow; `auth.sign_in` trigger; AAL rules; sessionStorage; Workers Logs on with `invocation_logs: false`; dropping `active_org_id` — document). None needs the founder.

## database-reviewer (revision 1)
Pending at the time of this record; see the next section when it lands.
