# Spec — M0b · Tenancy, roles, audit and org auth

- **Revision 7 (2026-10-13, lead session, BUILD).** One correction found by AT-B8 and one UI note; no scope change. (a) §4.1: on the Supabase CLI, `[auth.email] enable_signup` is the **email provider** switch, so `false` made GoTrue refuse every email sign-in (`422 email_provider_disabled`). It is now `true`; `[auth] enable_signup = false` alone disables sign-ups (proved live: `/signup` and `/otp` with `create_user` return `422 signup_disabled`). **H8 mirrors this on staging: email provider on, "Allow new users to sign up" off.** (b) §4.6 gains a `starting` state while a stored session is read at load (B2 spec review). Record: `docs/reviews/M0b-B2-B4-review.md`.
- **Revision 6 (2026-10-13, lead session, BUILD).** Records BUILD results and HOW-level deviations only (AUTOPILOT §4); no scope change. DC-3 and DC-10 results (§9). Deviations from the text below, each kept by the reviewers: (a) the tenancy contracts are imported from the subpath `@trace/shared/contracts/tenancy` (a re-export from `contracts.ts` breaks the plain-node operator scripts; B0-SP4); (b) MT-11's `no_caller_reference` reason separates with a comma, not `;` (catalog-check README rule 1); (c) the catalog floor is **133** assertions and the rls floor **686** (`supabase/tests/catalog-min-count`, `rls-min-count`; B0-SP6); (d) §2.7's CSP template is `apps/recruiter/_headers.template` (outside `public/`, so it is not served) and the Vite plugin lives in `@trace/config/vite/headers` because a Vite config file may not touch `fs` (`trace/vite-config-env`); `vite.config.ts` only wires it; (e) `@supabase/supabase-js` is pinned at 2.117.2, the newest release older than two weeks on 2026-10-13; (f) B0 review fixes beyond the text: MT-13 ignores an append-only trigger with a WHEN condition or an UPDATE OF list (B0-DB4), MT-2 ignores a partial index (B0-DB6), the operator scripts' docker fallback serves only the local stack's own URL (B0-SEC2) and no child inherits the smoke secrets (B0-SEC3); (g) `check-headers` allows at most one connect-src origin per allow-list entry (AT-B12); the staging org sign-in smoke is its own script, `scripts/smoke-staging-auth.mjs`, run as its own deploy step (AT-B9).
- **Revision 5 (2026-10-12, lead session).** Applies the two new findings of the Sonnet confirming re-review of revision 4 exactly as the reviewer specified — V1 (`rls_audit_log` creates the current UTC month's partition first; far-future fixture months) and V2 (a source pin on `private.is_operator()`) — and one lead clarification: the spike is formatted like `scripts/` through a `.prettierignore` re-include (§8). **Spec approved by autopilot reviewers** (see Approval).
- **Revision 4 (2026-10-12, lead session).** Applies the Opus re-review of revision 3 (`docs/reviews/M0b-spec-review.md`): spec-reviewer R1–R8 and database-reviewer E1–E9, cited inline as `[R#]`/`[E#]`, plus the lead's day-one results DC-6 and DC-7. Where both reviewers found the same problem the narrower fix wins: a fixed partition range with the horizon check owned by M7 (R6 over E1), and an operator predicate that names `postgres` only (R2 over E6).
- **Revision 3 (2026-10-12, lead session).** Applies the eight findings of the Sonnet re-review of revision 2 (`docs/reviews/M0b-spec-review.md`, N1–N8), cited inline as `[N#]`: per-org `audit.repartition` rows (N1); the operator path may insert `invited` (N2); owner and replica-mode cases re-grant the privilege so they prove the trigger (N3); `private.add_member` + `add-member.mjs`, and an owner smoke user on staging (N4); service-role wording (N5); own rows in a suspended org (N6); `private.orgs_guard()` and the `org.update` trigger (N7); the staging smoke order (N8).
- **Revision 2 (2026-10-12, lead session).** Applies every finding of the revision 1 reviews (`docs/reviews/M0b-spec-review.md`: spec-reviewer S1–S25, database-reviewer D1–D16) and the lead's day-one results DC-1 and DC-5. Finding IDs are cited inline as `[S#]`/`[D#]`.
- **Revision 1 (2026-10-12).** First draft. The founder's overnight decision (build-notes §0, "Overnight session") lets M0b *start* before `m0a-reviewed`; M0b still **closes** only after `m0a-reviewed` (build-order rule 5). Branch `m0b/integration` is cut from `milestone/m0a` @ `7dc8c0d` (`cp/m0a-06`); `main` is not touched.
- **Status:** **APPROVED, revision 5** (AUTOPILOT §2 SPEC self-approval, 2026-10-12); revision 6 only records BUILD results and HOW-level deviations. Phase: BUILD per §11.

Sources, in precedence order (AUTOPILOT §1): CLAUDE.md rules 1–9 and Engineering rules; `docs/build-notes.md` §0 (Q2, Q2b, Q3, Q6, Q7, Q8, Q9, Q11, Q12 — all accepted) and §4 "M0 — Foundations"; `docs/plan-conflicts.md`; ADR-017, ADR-027, ADR-028; `docs/plan.md` §2, §9.1, §10.1; `docs/build-order.md` M0b; `specs/m0-foundations.md` (M0a spec, rev 17) §8 and §16; `docs/reviews/M0a.md` (carry-overs).

---

## 1. Scope

### 1.1 In scope (build-order M0b, word for word first)
> Core schema from plan §9.1 for: orgs, workspaces, teams, memberships, audit_log, platform staff + break-glass grants, idempotency keys; RLS on all; role model from §2 (ABH-73 core) as decided in build-notes Q2/Q2b/Q3; `quality` and `integrity` schemas created empty with separate worker grants (rule 1).
> Org auth (Supabase Auth: email OTP / password + TOTP; AAL2 for owner, admin and reviewer). Org creation via an audited operator path. Candidate token design (invite + OTP → Trace-issued token that RLS understands) — spec plus a local spike only, implemented in M3a.
> Append-only audit log (no UPDATE/DELETE/TRUNCATE for any role, including workers).
> **Exit gate:** `supabase db reset` rebuilds from zero; ≥50 RLS tests (allowed + denied per role, including cross-org) pass — counted separately from the catalog checks; audit log rejects UPDATE/DELETE/TRUNCATE for every role; an org user can sign in on staging; migrations reach staging from CI only.

Concretely:
1. **Three migrations** (each created with `pnpm exec supabase migration new …`), so a hosted-only failure is isolated to one small file [S4]:
   - `<ts>_m0b_roles.sql`: the NOLOGIN group roles of §2.3, each created idempotently (`do $$ … if not exists (select from pg_roles where rolname = …) … $$`), their attributes, the gateway → candidate edge, and the `quality`/`integrity` worker USAGE grants.
   - `<ts>_m0b_tenancy.sql`: enums, the 8 tables of §3, `private` helpers, guard and audit triggers, audit partitions, grants and policies.
   - `<ts>_m0b_auth_audit.sql`: the `auth.sessions` triggers of §2.5 (the only objects on Supabase's `auth` schema besides the `auth.users` foreign keys).
2. Catalog-check additions (§5): MT-13, MT-14, the M0a REVIEW carry-overs DB-1 and DB-2, the E3 items, candidate roles in MT-10. Floors go up.
3. ≥ 50 `rls_*` pgTAP assertions (§6); `rls-min-count` set to the real count.
4. Supabase Auth configuration (§4.1): public sign-up off, email OTP with a code template, password + TOTP, AAL rules enforced **in the database**.
5. Recruiter app: sign-in (email OTP or password), TOTP enrolment and challenge, an org picker and a signed-in shell that reads the caller's own memberships and orgs through RLS (§4.2–4.3), with zod contracts (§4.5) and a UI state machine (§4.6).
6. Operator scripts (§4.4): `create-org` (audited, via `private.create_org`), `add-member` (audited, via `private.add_member`) [N4], `enrol-smoke-user` (no staging or production service-role key) [N5].
7. Local auth end-to-end test inside `test:rls` (AT-B8) and a staging sign-in smoke step (AT-B9).
8. ADR-029 "org authorisation from tables, not JWT claims; worker-only tables" (Q3). ADR-030 "candidate token" (Proposed; implemented in M3a) with the local spike (§8).
9. **Carry-overs owned by M0b:**
   - (a) M0a REVIEW DB-1, DB-2 and the E3 items (§5).
   - (b) **S3a deviation (d):** extract the duplicated Workers `app.ts` error/notFound handling (non-Error middleware, `onError` with its static fallback, JSON 404) into a Workers-only package `packages/workers-http` (`@trace/workers-http`; no new dependency — Hono is already a Worker dependency, ADR-028), returning `err.getResponse()` for Hono `HTTPException`. The three Workers' tests move with it; each Worker keeps one wiring test. `@trace/config`'s boundary rules gain the package (Workers may import it; apps and `packages/shared` may not).
   - (c) **M0a REVIEW SPEC-F2, Workers Logs on:** `"observability": { "enabled": true, "head_sampling_rate": 1, "redact_query_string": true, "logs": { "invocation_logs": false }, "traces": { "enabled": false } }` in all three `wrangler.jsonc` (`services/api`, `workers/edge`, `workers/jobs`; today each has `"observability": { "enabled": false }` at line 23), so only the redacting logger's lines are stored (no request URL, headers or client IP from invocation logs; no traces; query strings stripped should invocation logs ever return). ADR-027 already lists Workers Logs as a processor outside India. Key names verified against the installed wrangler 4.149.0 `config-schema.json` (DC-7 PASS); a `check-boundaries` test pins the values, and that each `env` block inherits them (no `env.*.observability` override).

### 1.2 Out of scope (owner)
- `assignments` → M1/M2 (build-notes §4 M2 table); `org_policies` → **M3a** (`docs/build-notes.md` §4 M3 table) [S22]: `create_org()` gains the `org_policies` row then.
- Admin UI/API for inviting members and accepting invitations (the `invited → active` transition by the invitee, a SECURITY DEFINER RPC) → **M1** [D16a]. In M0b members are added directly as `active` by an owner/admin or the operator (§3.5 state machine), and `invited` is rejected by the guard for app callers until M1 enables it (the operator path may insert it for test fixtures, §3.5 [N2]).
- **Trust & Safety read path** (an audited RPC; plan §2 "every staff view is shown to the tenant") → **M6**, together with the audited evidence-read path (build-notes §4 Conventions: "Evidence reads (from M6) and staff reads go through audited API/RPC paths"). M0b ships the staff and grant tables and their invariants but **no SELECT policy that lets staff read tenant data**, because Postgres cannot audit a SELECT. Logged under build-notes "Autopilot changes", listed in the M0b summary's Deferred table, and an FYI row in FOUNDER-QUEUE [S13].
- SAML SSO → later phase. Candidate token implementation → M3a. Audit-partition maintenance job and retention drop → M7 (Q11). Sentry (H6) → before D1.

### 1.3 Founder prerequisites (H) — only the staging gates need them
| H | What | Blocks |
| --- | --- | --- |
| H3–H5 (M0a, open) | Roll the exposed token; `CLOUDFLARE_API_TOKEN`; `SUPABASE_STAGING_DB_URL` (`?sslmode=require`) | AT-B9, AT-B10 |
| H8 (new) | Staging Auth settings: sign-ups **off**; email provider on; the **Magic Link email template body contains `{{ .Token }}`** (the code, not only the link); TOTP enrol + verify on; minimum password length 12, letters + digits; Site URL = the staging recruiter Pages URL. | AT-B9 |
| H9 (new) [S11, R4] | (1) In the staging dashboard, **Authentication → Add user** twice, each with a generated password (no service-role key involved): `smoke-owner+staging@example.com` (its password is **discarded**, never stored: this user only owns the smoke org) and `smoke+staging@example.com`. (2) Run `node scripts/ops/enrol-smoke-user.mjs --env staging --email smoke+staging@example.com --owner-email smoke-owner+staging@example.com` locally with `SUPABASE_STAGING_URL`, `SUPABASE_STAGING_PUBLISHABLE_KEY`, `TRACE_OPERATOR_DB_URL` (= the staging DB URL) and `SMOKE_PASSWORD` in your local environment only: it signs in as the smoke user, enrols TOTP, creates the `smoke-staging` org owned by the credential-less owner (`create-org`), adds the smoke user as **`recruiter` only** (`add-member`), and prints the TOTP secret once (§4.4). Least privilege: the only credentials CI holds are a recruiter's in an empty org [R4]. (3) Store `STAGING_SMOKE_EMAIL`, `STAGING_SMOKE_PASSWORD`, `STAGING_SMOKE_TOTP_SECRET` as `staging` environment secrets. **Order [N8, R5]:** H9 needs the M0b migrations on staging, and `deploy-staging` runs only on a push to `main` (`.github/workflows/ci.yml:125`). So the first run is the push of the M0b CLOSE merge: it applies the migrations and **fails at the smoke step** (no smoke user yet; expected); then H9; then re-run the job. AT-B9 passes on the re-run, and `m0b-reviewed` is tagged only after that. | AT-B9 |
| H10 (new) [S1, R5] | `staging` **environment variables** (public values, spec M0a §7.3 variables row): `SUPABASE_STAGING_URL`, `SUPABASE_STAGING_PUBLISHABLE_KEY` (the `sb_publishable_…` key, never the secret key). | AT-B9 |
| H11 (new) [S4] | Before the CLOSE merge: apply the three M0b migrations to **`trace-dev`** (not staging) with your own DB URL — `pnpm exec supabase db push --db-url "$TRACE_DEV_DB_URL"` — and paste the output into the M0b summary. Also run `select session_user, current_setting('role')` over the same URL and paste the result (DC-9: the operator predicate of §2.8 needs `postgres` / `none`) [R2]. The autopilot cannot run either (deny rules); a failure is fixed by amending the not-yet-frozen migration before CLOSE. | M0b CLOSE |

---

## 2. Decisions specific to M0b

### 2.1 Authorisation reads tables, not role claims (Q3 → ADR-029)
- RLS resolves the caller's orgs and roles through `private` `STABLE SECURITY DEFINER` helpers (`search_path = ''`) that read `memberships` and `orgs`; JWT claims are used only for `sub` (`auth.uid()`), `aal` and `amr`. A removed or suspended member, or a member of a suspended org, loses access on the next statement.
- **Exact policy form (DC-1, D11):** `org_id = any ((select private.my_org_ids('{…}'::org_role[]))::uuid[])` — the helper returns `uuid[]` and the scalar sub-select is cast; the uncast form fails with `operator does not exist: uuid = uuid[]`.
- **Schema USAGE (DC-1 PASS, 2026-10-12):** policies and CHECK constraints store function OIDs, so the caller needs EXECUTE on the helper but **no USAGE on `private`** (MT-8 forbids it). This does **not** hold for plpgsql/SQL function bodies — hence §2.8.
- **`active_org_id` claim hint dropped [S21]:** Q3 allowed claims to carry an `active_org_id` hint; M0b does not need one because the helpers return every org the caller may see. A user in several orgs picks one in the app's org picker (§4.6); the choice lives in `sessionStorage` and only filters the UI. Deviation logged under build-notes "Autopilot changes".

### 2.2 Assurance level (Q8, enforced in the database)
- `privileged roles` = `{org_owner, admin, reviewer}`.
- A membership holding **any** privileged role counts only when the JWT has `aal = 'aal2'`.
- A membership with only `recruiter`/`hiring_manager` counts at `aal1` **only if** the session's first factor was email OTP (`amr` has a method in `{otp, magiclink}` and none `= 'password'`). A password sign-in needs `aal2` for every membership ("password sign-in requires TOTP").
- **Exception [S18]:** a person can always SELECT **their own** membership rows (any aal), so the app can tell "you have an organisation but need TOTP" from "no organisation". Own rows contain no other person's data.
- **Suspended org [N6]:** the exception holds there too — a member of a suspended org still sees their own membership rows (and nothing else: not the org row, its workspaces, teams, other members or audit rows). The app then sees no org row and shows `no_org` (§4.6). `rls_roles` and `rls_memberships` assert both halves with `s_admin`.
- The claim shapes are pinned by AT-B8, which reads them from **real** GoTrue sessions (password, email OTP via the local mail catcher, TOTP step-up) and asserts them [S2]. The RLS cases in §6 use those pinned shapes; they do not by themselves detect a GoTrue rename (AT-B8 does).

### 2.3 Postgres principals (build-notes §4, Q6, Q12)
| Role | Kind | Purpose in M0b |
| --- | --- | --- |
| `anon` | Supabase | no grant anywhere (MT-4) |
| `authenticated` | Supabase | org users; table/column grants of §3.9; RLS decides rows |
| `service_role` | Supabase (BYPASSRLS) | **no table grants** (the baseline revoked the defaults); used only by server code for the Auth admin API (none in M0b) |
| `trace_worker` | NOLOGIN, NOBYPASSRLS | server workers' row access (M0b: `idempotency_keys`) |
| `trace_quality_worker` | NOLOGIN, NOBYPASSRLS | USAGE on schema `quality` only (rule 1) |
| `trace_integrity_worker` | NOLOGIN, NOBYPASSRLS | USAGE on schema `integrity` only (rule 1) |
| `trace_candidate` | NOLOGIN, NOBYPASSRLS | candidate requests (`SET LOCAL ROLE`); no grant on any M0b table |
| `trace_candidate_gateway` | NOLOGIN in M0b, NOINHERIT, NOBYPASSRLS | its only membership is `trace_candidate`, granted `with inherit false, set true` (Q6) |
- No `trace_*` role has `BYPASSRLS`, `SUPERUSER`, `CREATEROLE`, `CREATEDB`, `REPLICATION` or `LOGIN` in M0b (MT-14). Login roles with passwords are created per environment by an operator runbook when a Worker first connects (M2/M3a), never in a migration.
- **PostgreSQL 16+ creator membership [S5, D4]:** `postgres` (non-superuser with CREATEROLE) automatically becomes an ADMIN-only member (inherit false, set false) of every role it creates. MT-14 ignores such ADMIN-only rows. Tests need to `SET ROLE` to these roles, so **each `rls_*` file**, inside its own rolled-back transaction, runs `grant <role> to postgres with inherit false, set true` for the roles it uses and `grant usage on schema extensions to <role>` (pgTAP lives in `extensions`). The migration grants neither.
- Day-one check DC-3 (local, done by the database-reviewer 2026-10-12): `postgres` can `create role … nologin` in a transaction. Still to record in BUILD: `supabase db reset` run **twice** succeeds (cluster-global roles survive a reset, hence `if not exists`). Hosted: H11.

### 2.4 Audit log (Q11)
- `public.audit_log` is partitioned **by range on `occurred_at`, monthly**: a `DEFAULT` partition plus the **fixed** monthly partitions 2026-10 … 2027-12, all created by `private.create_audit_partition(p_month date)` (owner-only, no grants), which applies every per-partition rule through one helper `private.apply_audit_partition_rules(regclass)` (RLS, the owner and non-owner revokes, the TRUNCATE trigger, `ENABLE ALWAYS`; a new relation starts with a NULL ACL, so the revokes are explicit) [E8]. The migration never reads `now()`: the same migration builds the same database on any date, and `db-types` cannot drift by month [R6].
- **Months are UTC [E2]:** partition bounds are `p_month::timestamp at time zone 'UTC'` to `(p_month + interval '1 month')::timestamp at time zone 'UTC'`; the function is declared `set timezone = 'UTC'` and raises unless `p_month = date_trunc('month', p_month)`. Every "rows of month M" and coverage computation uses `date_trunc('month', x, 'UTC')`. (Database-reviewer probe: under `Asia/Kolkata` the naive form overlaps the previous month.)
- **Partition horizon (owner M7) [R6, E1]:** keeping partitions ahead of time is the M7 maintenance job's duty (Q11), with its own test and alert. M0b checks only what it creates: the fixed range and an empty DEFAULT. A row written past 2027-12 before M7 exists lands in DEFAULT and is moved by the recovery below; the M0b summary's Deferred table lists the horizon job with "must run before 2027-09" (when a 3-month horizon would first be short).
- **Every partition, the parent and the default:** RLS on; no INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN for any non-owner; UPDATE, DELETE and TRUNCATE **also revoked from the owner** `postgres` [S6]; a `BEFORE UPDATE OR DELETE … FOR EACH ROW` trigger on the parent (PostgreSQL clones it to every partition, DC-5) and a `BEFORE TRUNCATE … FOR EACH STATEMENT` trigger **on each partition and the parent** (not inherited, DC-5), all calling `private.audit_log_append_only()` which raises `TRACE_APPEND_ONLY` (SQLSTATE `P0001`).
- **`ENABLE ALWAYS` [D3]:** every one of these triggers is set `ALTER TABLE … ENABLE ALWAYS TRIGGER …` so `session_replication_role = replica` cannot switch them off (proved by the database-reviewer: in replica mode an ordinary trigger lets `postgres` delete; `ENABLE ALWAYS` blocks it). MT-13 requires `tgenabled = 'A'`.
- **What "every role" means:** every role's **DML** is refused, the owner included. DDL by the owner (`DROP TRIGGER`, `DISABLE TRIGGER`, `DETACH PARTITION`) stays possible — it is what M7 retention uses — and is caught by MT-13 and by review of every migration. **Replica mode is owner power like DDL [E9]:** only `audit_log`'s triggers are `ENABLE ALWAYS`; the guards, audit triggers and FK checks of the other tables are ordinary, so the owner in `session_replication_role = replica` bypasses them. The operator path (§2.8) is audited only in normal mode; replica mode is reserved for a data-only restore from a consistent dump, a procedure owned by the M7 DR runbook (ABH-80) and listed in the M0b summary's Deferred table.
- **DEFAULT partition recovery [S20, D8, E8]:** if rows for month M sit in DEFAULT, creating M's partition fails. `create_audit_partition` then runs, in one transaction and in this order (prototyped by the database-reviewer on PG 17.11):
  1. require that the partition of the current UTC month exists (or that M is the current month), else raise — the events of step 6 must not land in DEFAULT;
  2. lock the parent; detach DEFAULT (this drops its cloned row trigger; its own TRUNCATE trigger stays) and **rename** it (`audit_log_default_old`), so the new DEFAULT can take the name;
  3. create M and apply the rules (`apply_audit_partition_rules`);
  4. create the new empty DEFAULT and apply the rules;
  5. `insert into public.audit_log select * from` the old table — one INSERT routes M's rows to M and the rest to the new DEFAULT; INSERT fires no append-only trigger;
  6. write the `audit.repartition` events (below);
  7. drop the old table (DDL; its TRUNCATE trigger does not fire on DROP).

  **Audit [N1]:** every moved row belongs to a real org (`org_id` is NOT NULL, in the PK and an FK), so the function writes one `audit.repartition` row **per org whose rows moved into M** (`org_id` = that org, `actor_kind = 'system'`, `details = {"month", "rows_moved"}` counting that org's rows only); no rows moved → no event. The event lands in the org's own log (owner/admin can see it), needs no `trace_internal` org, and goes into the current month's partition (step 1). An `rls_audit_log` case proves the recovery and the per-org events, and asserts DEFAULT is empty and the fixed range 2026-10 … 2027-12 exists [R6].
- Rows are written only by `private.audit(...)` (SECURITY DEFINER, no EXECUTE grant to any role), called from the trigger functions of §2.8 and from `private.create_org` / `private.grant_staff_access` / `private.create_audit_partition`.
- **`request_id` on trigger-written rows [N4, R3]:** `private.create_org` and `private.add_member` save the current `current_setting('trace.request_id', true)`, run `set_config('trace.request_id', p_request_id::text, true)` before their writes, and **restore the saved value** (`coalesce(v_prev, '')`) before returning — `set_config(…, true)` lasts to the end of the transaction, not the function, so without the restore a later write in the same transaction would inherit the id. `private.audit` fills `request_id` from `nullif(current_setting('trace.request_id', true), '')::uuid` when its caller passes none (database-reviewer probe: NULL before any set, `''` after one, both read as null). App callers in M0b cannot set it (`set_config` lives in `pg_catalog`, which PostgREST does not expose; there is no `db-pre-request`), so their rows carry `null`; a forged value could only relabel the caller's own correlation id, never the actor columns. A malformed value fails the cast and aborts the write (fail closed).
- **Row content:** IDs, enum labels and booleans only — never names, emails, IPs or free text. `details jsonb` ≤ 4 KB (CHECK) with top-level keys matching `^[a-z_]{1,40}$` (CHECK through an immutable `private` function, EXECUTE granted to nobody — only definer code writes rows). The exact keys per event are the contract in §4.5 [S7].
- `actor_roles` and `org_id` are captured at event time.
- **Events (each with one pgTAP case, §6) [S7]:** `org.create`, `org.update` (owner/admin settings changes, Q11), `workspace.create`, `workspace.update`, `workspace.archive`, `team.create`, `team.update`, `team.delete`, `membership.create`, `membership.update`, `membership.remove`, `staff_grant.create`, `staff_grant.revoke`, `auth.sign_in`, `auth.step_up`, `audit.repartition`.

### 2.5 Sign-in audit events
- `auth.sign_in`: `AFTER INSERT ON auth.sessions` → one row per active membership of that user **in an active org** (`actor_kind = 'org_user'`, `details = {"aal": …}`). A membership in a suspended org writes no event, for `auth.sign_in` and `auth.step_up` alike: the org is closed, and its owners cannot read its log (`private.my_org_ids` skips suspended orgs) [B0-SP3, pinned in `rls_audit_log`].
- `auth.step_up` [S19, D12]: GoTrue raises a session from aal1 to aal2 by **updating** `auth.sessions.aal`, so a second trigger `AFTER UPDATE OF aal ON auth.sessions … WHEN (new.aal is distinct from old.aal)` writes `auth.step_up` with `{"aal": "aal2"}`. AT-B8 pins both on a real GoTrue session.
- No IP, no user agent. Both trigger functions are `private` SECURITY DEFINER (`search_path = ''`); MT-5d's `system_table_trigger` branch keeps checking them. A failure aborts the sign-in (fail closed).
- Local DC-4 passed (database-reviewer 2026-10-12: `postgres` can create a trigger on `auth.sessions`). Hosted: H11 on `trace-dev`. If hosted refuses, the event moves to the API layer (owner M1) and the change goes to FOUNDER-QUEUE (it changes *when* a Q11 event is recorded).

### 2.6 Org creation (Q9)
- `private.create_org(p_name text, p_slug text, p_kind org_kind, p_owner_user_id uuid, p_display_name text, p_request_id uuid) returns uuid`: SECURITY DEFINER, `search_path = ''`, **no EXECUTE grant to any role**. One transaction creates the org, its `default` workspace and the first membership with roles `{org_owner, admin}`, **status `active`** [S8], for an existing `auth.users` row; then writes `org.create` with `actor_kind = 'system'` and `request_id`.
- `scripts/ops/create-org.mjs`: reads the DB URL from `TRACE_OPERATOR_DB_URL` (default: the local stack URL from `supabase status -o env`, never printed); validates arguments with the zod contract of §4.5; calls the function through `psql -v` variables (no string interpolation into SQL); prints only the new org id.
- The `trace_internal` org (home of `platform_staff`) is created with the same script, `--kind trace_internal`.
- **Adding a member as the operator [N4]:** `private.add_member(p_org_id uuid, p_user_id uuid, p_roles org_role[], p_display_name text, p_request_id uuid) returns uuid`: SECURITY DEFINER, `search_path = ''`, **no EXECUTE grant to any role**. It inserts one `active` membership for an existing `auth.users` row; the guard runs on the operator path (rules 3–5 apply, so an org keeps its owner) and the membership audit trigger writes `membership.create` (`actor_kind = 'system'`, `request_id` from §2.4). `scripts/ops/add-member.mjs` mirrors `create-org.mjs` (same URL handling, zod `AddMemberArgs` of §4.5, `psql -v` variables, prints only the membership id). Used by AT-B8 for the recruiter-only OTP user; M1's admin UI replaces it for tenants.

### 2.7 Recruiter app configuration [S1]
- supabase-js with `persistSession: true` on **`sessionStorage`**, `autoRefreshToken: true`, `detectSessionInUrl: false`, `flowType: 'pkce'`.
- Build-time variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. `scripts/check-boundaries.mjs` `ALLOWED_VITE_NAMES` gains exactly `'VITE_SUPABASE_PUBLISHABLE_KEY'` (it contains the forbidden word `KEY`), with a test that no other `KEY` name passes. `scan-dist` already fails on `sb_secret_` and service-role JWT shapes; a new `scan-dist` test asserts a `dist/` containing an `sb_publishable_` value passes and one with `sb_secret_` fails.
- **When the variables are unset** (local `pnpm verify`, CI `static`, clean clones): the build succeeds, no Supabase client is created, and the app shows "Sign-in is not configured for this build". The **deploy job** sets them for the staging build only: `VITE_SUPABASE_URL: ${{ vars.SUPABASE_STAGING_URL }}`, `VITE_SUPABASE_PUBLISHABLE_KEY: ${{ vars.SUPABASE_STAGING_PUBLISHABLE_KEY }}` (variables, not secrets — both are public; H10). `check-workflows` gains a test that only the deploy job's build step sets them.
- **CSP:** `apps/recruiter/public/_headers` becomes `_headers.template` with the token `__SUPABASE_ORIGIN__` in `connect-src`; a small Vite plugin in `apps/recruiter/vite.config.ts` writes `dist/_headers`, replacing the token with the origin of `VITE_SUPABASE_URL` (must be `https://<20 lowercase alnum>.supabase.co`, else the build fails) or removing it when unset. `check-headers` asserts: recruiter `connect-src` is `'self'` plus at most that one origin; candidate `connect-src` never names `supabase.co` (candidates never call Supabase, Q6). `apps/recruiter/src/security-hygiene.test.ts` is updated to read the template.

### 2.8 Trigger functions and the operator path [D1, S17]
- Every guard, audit and sign-in trigger function is **`SECURITY DEFINER`, `search_path = ''`, in `private`**: `orgs_guard`/`orgs_audit` (§3.2) [N7], the `workspaces`, `teams`, `memberships` and `staff_access_grants` guards and audit triggers (§3.3–§3.7), `memberships_last_owner` (§3.5), `audit_log_append_only` (§2.4) and the `auth.sessions` triggers (§2.5). An invoker trigger cannot even resolve `private.audit()` for `authenticated` (database-reviewer probe: "permission denied for schema private").
- Inside a definer function `current_user` is always the owner `postgres`, so it **must not** be used to detect the caller. `session_user` is **not** changed by SECURITY DEFINER: it stays the login role (`authenticator` for PostgREST, `supabase_auth_admin` for GoTrue, a Worker's login role from M2/M3a) [R2, E6]. The **operator path** is exactly: `session_user = 'postgres' and current_setting('role') in ('none', 'postgres') and (select auth.uid()) is null` (probes: `role = none` for a plain `postgres` session; `authenticated` under `set local role authenticated`; `authenticator` can only switch to `anon`, `authenticated` or `service_role`, each of which sets `role`). Every other session — including `supabase_admin` and any login role that skips `SET ROLE` — is an app caller whose identity is `auth.uid()` (null → it holds no role, so every rule that needs a role refuses: fail closed). Worker login roles (M2/M3a) must `SET LOCAL ROLE` to their NOLOGIN role; MT-14 (g) keeps login roles away from DML. Every guard calls the one function `private.is_operator()` (its truth table is tested in `rls_memberships`, §6).
- DC-9 (H11, not yet verified): the hosted operator URL's `session_user` must be `postgres`; if hosted reports anything else (for example through the pooler), the predicate is revised in a spec revision before CLOSE, never widened by guesswork.
- pgTAP proves that `postgres` running `set local role authenticated` with claims is **not** treated as the operator.

---

## 3. Data model (three migrations; every rule of M0a spec §8.2 applies)

Conventions (build-notes §4): `org_id uuid not null`, `unique (org_id, id)`, composite foreign keys `(org_id, x_id)`, RLS on, one policy per operation, no `anon` grant, explicit grants, invariants in triggers and CHECKs, no DELETE policy on people's data, no column matching MT-3. Timestamps `timestamptz not null default now()`. Text columns have length CHECKs. Every RLS predicate column leads an index [D15].

### 3.1 Enums
`org_kind (customer, trace_library, trace_internal)` · `org_status (active, suspended)` · `data_residency (r2_apac, s3_mumbai)` · `workspace_kind (default, client)` · `org_role (org_owner, admin, recruiter, reviewer, hiring_manager)` · `membership_status (invited, active, suspended, removed)` · `actor_kind (org_user, candidate, staff, system)` · `staff_grant_scope (support_read)`.

### 3.2 `orgs`
`id uuid pk default gen_random_uuid()`, `org_id uuid generated always as (id) stored not null`, `kind`, `name` (1–200), `slug unique` (`^[a-z0-9][a-z0-9-]{2,62}$`), `data_residency default 'r2_apac'`, `status default 'active'`, `created_at`. `unique (org_id, id)`. **Suspended org [S8]:** the helpers return nothing for an org whose `status = 'suspended'`, for every role; only the operator changes `status` (no column grant).
**Guard and audit [N7]** (both SECURITY DEFINER, `search_path = ''`, §2.8):
- Column grant: `authenticated` gets `UPDATE (name, data_residency)` only; the UPDATE policy allows rows of `agg('{org_owner,admin}')`.
- `private.orgs_guard()` (BEFORE UPDATE, row): for an app caller, a change to `data_residency` needs `org_owner` (active, aal2) in that org; `admin` may change `name` only. On every path `id`, `kind`, `slug` and `created_at` are immutable (the operator may change `name`, `data_residency` and `status`). No INSERT or DELETE path for app callers (no grant). **Never read `NEW.org_id` in a BEFORE trigger on `orgs` [E3]:** on PG 17 a stored generated column is NULL there (probe), and a `WHEN` clause cannot reference it; `org_id` protects itself (`column "org_id" can only be updated to DEFAULT`, probe) and follows the guarded `id`. The AFTER trigger may read it.
- `private.orgs_audit()` (AFTER UPDATE, row): when any of `name`, `data_residency`, `status` changed, writes `org.update` with `details = {"changed": [...]}` listing those column names (never the values); `actor_kind = 'org_user'` with the caller's roles, or `'system'` on the operator path (suspending an org is therefore audited).

### 3.3 `workspaces`
`id`, `org_id → orgs`, `name` (1–200), `kind`, `is_default`, `archived_at`, `created_at`. `unique (org_id, id)`; partial unique `(org_id) where is_default`; CHECK `is_default = (kind = 'default')`. Guard trigger (§2.8): `kind`, `is_default`, `org_id` immutable; the default workspace cannot be archived.

### 3.4 `teams`
`id`, `org_id`, `name` (1–200), `created_at`; `unique (org_id, id)`, `unique (org_id, name)`. Organisational only (Q2).

### 3.5 `memberships`
Columns: `id`, `org_id`, `user_id uuid not null references auth.users (id) on delete restrict`, `roles org_role[] not null` (CHECK via immutable `private.valid_roles(org_role[])`: 1–5 elements, no nulls, no duplicates; **EXECUTE granted to `authenticated`** because a CHECK runs with the writer's privileges [D7]), `workspace_id uuid null` (composite FK), `team_id uuid null` (composite FK, `on delete restrict`), `display_name` (1–120), `status membership_status not null default 'active'`, `created_by uuid null`, `created_at`, `removed_at` (CHECK `(removed_at is not null) = (status = 'removed')`).
Keys and indexes: `unique (org_id, id)`; **partial** unique `(org_id, user_id) where status <> 'removed'` (a removed person can be added again as a new row; the old row and id stay) [S8]; index `(user_id) include (org_id, roles, status, workspace_id)` [D15]. CHECK `workspace_id is null or not (roles && '{org_owner,admin}')` — owners and admins are org-wide [D16b].

**Workspace scope [D16b]:** `workspace_id` limits a recruiter, reviewer or hiring manager to one workspace for **workspace-owned data** (M1+: jobs, tests, drives, candidates) and for the `workspaces` table. The org row and the directory stay org-wide for every member. `audit_log` is owner/admin only, and those are org-wide by the CHECK.

**State machine [S8]:**
| From → To | Who | Event |
| --- | --- | --- |
| (none) → `active` | operator via `create_org` (first owner+admin) or `add_member` [R1]; an owner (any roles) or an admin (roles without `org_owner`) via INSERT | `membership.create` |
| (none) → `invited` | **rejected for app callers in M0b** (guard); the operator path may insert it (test fixtures only; nothing in M0b's scripts does) [N2]; enabled for admins in M1 with the invite flow | `membership.create` |
| `invited` → `active` | **M1** (the invitee's acceptance RPC) | `membership.update` |
| `active` ↔ `suspended` | owner; admin only on rows without `org_owner` (rule 1′) | `membership.update` |
| `active`/`suspended` → `removed` | owner; admin only on rows without `org_owner` | `membership.remove` |
| `removed` → anything | nobody (terminal; add a new row instead) | — |
Access: only `active` memberships count in the helpers; `invited`/`suspended`/`removed` see only their own row (§2.2 exception).

**Guard `private.memberships_guard()`** (BEFORE INSERT OR UPDATE, SECURITY DEFINER, §2.8):
1. **Rule 1′ [D2, S9]:** if `org_owner` is in `OLD.roles` or `NEW.roles`, the caller must hold `org_owner` (active, aal2) in that org. So only owners create, edit, suspend, remove or re-scope an owner's membership.
2. Nobody changes their own `roles`, `status` or `workspace_id` (`NEW.user_id = auth.uid()`); they may change only their own `display_name`.
3. The org keeps ≥ 1 `active` membership holding `org_owner`: a `DEFERRABLE INITIALLY DEFERRED` constraint trigger checks at commit (so a hand-over in one transaction works). **Write-skew guard [D9, E7]:** before any change that touches `org_owner` or `status`, the guard takes `select 1 from public.orgs where id = new.org_id for no key update`, serialising concurrent owner changes in one org. `for no key update` (not `for update`) because every FK check on `orgs` (workspaces, teams, each `audit_log` row) takes `FOR KEY SHARE`, which `FOR UPDATE` would block — and two transactions that each insert a referencing row and then change a membership would deadlock upgrading their locks.
4. `org_id`, `user_id`, `created_by`, `created_at` are immutable; `removed` is terminal; no DELETE grant (ids never disappear; rule 4).
5. `created_by := auth.uid()` on insert (always; `null` on the operator path). For **app callers** `status` on insert must be `active` in M0b; the operator path may also insert `invited` [N2], never `suspended` or `removed`.
6. **Status transitions on UPDATE follow the state table [R1]:** `active ↔ suspended` and `active`/`suspended → removed` only. Any change **to or from `invited`** is refused for every caller in M0b, the operator included (`invited → active` is M1's acceptance RPC); `removed` is terminal (rule 4).
On the operator path (§2.8) rules 1–2 and the `invited` ban of rule 5 are skipped; rules 3, 4, 6 and the rest of 5 always apply.

**User erasure [D13]:** `auth.users` rows of members are never hard-deleted (the FK is `restrict`; GoTrue's own FKs cascade). Erasure of an org user uses GoTrue's soft delete, which keeps the `id`. An `rls_memberships` case proves a hard delete is refused (23503).

### 3.6 `audit_log` (partitioned, §2.4)
`id uuid default gen_random_uuid()`, `occurred_at`, `org_id`, `actor_kind`, `actor_user_id uuid null`, `actor_roles org_role[] not null default '{}'`, `action text` (`^[a-z_]+\.[a-z_]+$`), `object_table text null`, `object_id uuid null`, `candidate_id uuid null` (build-notes §4; always null in M0b, its FK to `candidates` arrives in M3a) [R8], `workspace_id uuid null`, `request_id uuid null`, `staff_grant_id uuid null`, `details jsonb not null default '{}'`. Primary key `(org_id, occurred_at, id)`; FK `org_id → orgs` (`restrict`); index `(org_id, occurred_at desc)`.

### 3.7 `platform_staff` and `staff_access_grants`
- `platform_staff`: `user_id uuid pk references auth.users (restrict)`, `org_id` (a `trace_internal` org, trigger-checked), `active`, `capabilities text[]` (⊆ `{support_read}`), `created_at`; `unique (org_id, user_id)`. Operator-written only.
- `staff_access_grants`: `id`, `org_id` (tenant), `staff_user_id → platform_staff`, `ticket_ref` (`^[A-Za-z0-9_-]{3,64}$`), `scope`, `granted_at`, `expires_at` (CHECK `> granted_at` and `<= granted_at + interval '4 hours'`), `approved_by → platform_staff` (CHECK `<> staff_user_id`), `revoked_at`, `revoked_by`. Index `(staff_user_id)` [D15]. Created only by `private.grant_staff_access(...)` (owner-only, audited), which refuses an inactive grantee or approver (`42501 TRACE_STAFF_INACTIVE`) and a grantee without `scope` in its `capabilities` (`42501 TRACE_STAFF_SCOPE`) [B0-DB7, fixed forward in `…_m0b_staff_grant_checks.sql`]. Guard: only `revoked_at`/`revoked_by` may change, once, by a tenant owner/admin (`revoked_by := auth.uid()`, `revoked_at := now()`), audited.
- **No staff read policy on tenant tables in M0b** (§1.2; owner M6).

### 3.8 `idempotency_keys`
`org_id`, `scope` (1–64), `key` (1–200), `first_seen_at`, `result_ref` (≤ 200), `expires_at`; `primary key (org_id, scope, key)`. Worker-only: grants and policies to `trace_worker` only, with literally-true clauses, so the **MT-11 reference-table list** gets the entry `('public', 'idempotency_keys', 'ADR-029 worker-only ledger; no app role has a grant')` — MT-11 exempts only reasons starting `ADR-<n>` (`supabase/catalog-checks/MT-11.sql:249`, `:295`) [D6]. ADR-029 records the worker-only-table rule: such a table has policies only for worker roles, MT-4 shows no app-role grant, and `rls_*` denied cases prove it.

### 3.9 Grants and RLS matrix
`agg(roles)` = `(select private.my_org_ids('{…}'))::uuid[]` (§2.1–2.2). `ws(roles)` = `(select private.my_workspace_ids('{…}'))::uuid[]`. Every cell is a separate policy naming its roles.

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `orgs` | `authenticated`: `org_id = any(agg(all 5))` | ✗ (`create_org`) | owner → `name`, `data_residency`; admin → `name` (column grant + guard), audited `org.update` | ✗ |
| `workspaces` | `id = any(ws(all 5))` | owner, admin (`kind = 'client'`) | owner, admin: `name`, `archived_at` | ✗ |
| `teams` | 5 roles of the org | admin | admin: `name` | admin (FK restrict ⇒ only when empty) |
| `memberships` | own rows (any status, any aal; §2.2); owner, admin: every row of the org; recruiter, reviewer: rows of the org with `status in ('invited','active')` (the directory) [S12] | owner, admin (+ guard) | owner, admin: `roles`, `workspace_id`, `team_id`, `display_name`, `status`, `removed_at`; any member: own `display_name` (+ guard) | ✗ |
| `audit_log` | owner, admin of the org | ✗ | ✗ | ✗ (+ ALWAYS triggers; owner's UPDATE/DELETE/TRUNCATE revoked) |
| `platform_staff` | own active row | ✗ | ✗ | ✗ |
| `staff_access_grants` | owner, admin of the tenant; staff's own grants | ✗ | owner, admin: `revoked_at`, `revoked_by` (+ guard) | ✗ |
| `idempotency_keys` | `trace_worker` | `trace_worker` | `trace_worker` | `trace_worker` |

**Directory deviation [S12]:** build-notes §4 named a `v_org_directory` view (id, name, roles). A `security_invoker` view (MT-10) cannot show fewer columns than the base table grants for the same role, so the directory is the `memberships` SELECT policy limited to `invited`/`active` rows. Logged under build-notes "Autopilot changes".
**EXECUTE grants:** `authenticated` gets EXECUTE on `private.my_org_ids`, `private.my_workspace_ids` and `private.valid_roles` only [D7]. Nothing else in `private` is granted. `trace_candidate`, `trace_quality_worker`, `trace_integrity_worker`, `anon`, `service_role`: no grant on any table above.

---

## 4. Org auth

### 4.1 Supabase Auth configuration (`supabase/config.toml`; staging mirrors it via H8)
`[auth] enable_signup = false`, `enable_anonymous_sign_ins = false`, `minimum_password_length = 12`, `password_requirements = "letters_digits"`. `[auth.email] enable_signup = true` (the CLI's email provider switch, revision 7; sign-ups stay off through `[auth] enable_signup = false`), `otp_length = 6`, `otp_expiry = 600`. `[auth.email.template.magic_link]` with a committed template file whose body contains `{{ .Token }}` (so the email carries the 6-digit code) [S2]. `[auth.mfa.totp] enroll_enabled = true`, `verify_enabled = true`. `check-boundaries` asserts these keys (config drift test).

### 4.2 Flows
- **Email OTP:** `signInWithOtp({ email, options: { shouldCreateUser: false } })` → `verifyOtp({ email, token, type: 'email' })`.
- **Password:** `signInWithPassword` → always continues to TOTP (Q8).
- **TOTP:** `mfa.listFactors()`; none and aal2 is needed → `mfa.enroll({ factorType: 'totp' })` shows the QR (SVG from Supabase as an `<img>`; no QR library) and the secret for manual entry → `mfa.challengeAndVerify`. Existing factor → challenge + verify.
- Errors shown are generic ("That code didn't work. Try again."); server error text is never rendered or logged.

### 4.3 Packages
- `@supabase/supabase-js` (ADR-028/Q13: data access is supabase-js + SQL), added by the lead to `apps/recruiter` only, pinned exactly in the pnpm catalog. `check-boundaries` asserts it is not imported by `apps/candidate`, `workers/edge` or `packages/shared`.
- TOTP codes for tests and the operator script are computed with WebCrypto (RFC 6238) in `scripts/lib/totp.mjs`, unit-tested against the RFC 6238 SHA-1 vectors. No new dependency.

### 4.4 Operator scripts (`scripts/ops/`, lead-owned) [S11, N5]
**Keys:** no **staging or production** service-role (secret) key is used anywhere. The only service key any script touches is the local stack's **demo** key, read from `supabase status -o env` at run time, never written anywhere, and refused unless the Auth URL's host is `127.0.0.1` (a unit test pins the refusal).
- `create-org.mjs` (§2.6) and `add-member.mjs` (§2.6) [N4].
- `enrol-smoke-user.mjs` (arguments parsed with `EnrolSmokeUserArgs`, §4.5; the password comes only from the environment variable `SMOKE_PASSWORD`, never an argument) [R7]:
  - `--env local --email <e>`: **only** creates one confirmed synthetic user with that password through the local stack's Auth admin endpoint with the local demo key (above) and prints its user id. No TOTP, no org. Run once per test user.
  - `--env staging --email <smoke> --owner-email <owner>`: both users already exist (H9 step 1). Signs in as `<smoke>` over the public Auth API, enrols and verifies a TOTP factor, resolves both user ids by email through `TRACE_OPERATOR_DB_URL` (`psql -v`), calls `create-org` for `smoke-staging` owned by `<owner>` and `add-member --roles recruiter` for `<smoke>` [R4], and prints the TOTP secret once to the terminal (never to a file or log).
  - `scripts/test/ops-enrol-smoke-user.test.mjs` covers both modes with fakes (argument contract, the 127.0.0.1 refusal, no secret on any output but the one TOTP line in staging mode).

### 4.5 Contracts (zod, in `@trace/shared/contracts`) [S15, S7]
- `CreateOrgArgs`: `{ name: string 1–200, slug: /^[a-z0-9][a-z0-9-]{2,62}$/, kind: 'customer'|'trace_library'|'trace_internal', ownerUserId: uuid, displayName: string 1–120, requestId: uuid }`.
- `AddMemberArgs` [N4]: `{ orgId: uuid, userId: uuid, roles: OrgRole[] 1–5 unique, displayName: string 1–120, requestId: uuid }` (`status` is not an argument: always `active`).
- `EnrolSmokeUserArgs` [R7]: a discriminated union on `env` — `{ env: 'local', email: string email ≤ 254 }` | `{ env: 'staging', email: string email ≤ 254, ownerEmail: string email ≤ 254, ownerEmail ≠ email }`.
- `SignInEmail`: `{ email: string email ≤ 254 }`; `OtpCode` / `TotpCode`: `/^[0-9]{6}$/`; `Password`: string 12–128.
- `MembershipRow` (what the shell reads): `{ id, org_id, user_id: uuid, roles: OrgRole[] 1–5, workspace_id: uuid|null, team_id: uuid|null, display_name: string, status: MembershipStatus }`; `OrgRow`: `{ id: uuid, name: string, slug: string, kind, status }`. The shell parses PostgREST rows with these and treats a parse failure as "no organisation".
- `AuditDetails` per action (the exact top-level keys; `rls_audit_log` asserts them, and a SQL CHECK limits key shape):
  | action | details keys |
  | --- | --- |
  | `org.create` | `kind`, `default_workspace_id`, `first_membership_id` |
  | `org.update` | `changed` (array of column names: `name`, `data_residency`, `status`) [N7] |
  | `workspace.create` / `workspace.update` / `workspace.archive` | `kind`; `changed` (update) |
  | `team.create` / `team.update` / `team.delete` | `changed` (update) or `{}` |
  | `membership.create` | `roles`, `status`, `workspace_id`, `team_id` |
  | `membership.update` | `old_roles`, `new_roles`, `old_status`, `new_status`, `changed` |
  | `membership.remove` | `old_status` |
  | `staff_grant.create` / `staff_grant.revoke` | `scope`, `expires_at` / `{}` |
  | `auth.sign_in` / `auth.step_up` | `aal` |
  | `audit.repartition` | `month`, `rows_moved` |
  No event ever stores `display_name`, `name`, `slug`, email or ticket text.

### 4.6 Recruiter UI state machine [S15]
`unconfigured` (no build variables) · `starting` (reading a stored session at load, revision 7) · `signed_out` → (`email` submitted) `code_sent` → (`code` verified) `session_aal1` | (`password` ok) `session_aal1`. From `session_aal1`: own memberships read; none → `no_org`; some need aal2 (privileged role or password session) → `totp_enrol` (no factor) or `totp_challenge` (factor) → `session_aal2`. Then: one visible org → `signed_in(org)`; several → `org_picker` → `signed_in(org)`; none (suspended org, or only non-`active` memberships) → `no_org` [N6]. Any state → `signed_out` on sign-out (clears `sessionStorage`). Errors keep the state and show the generic message. AT-B11 covers every edge.

---

## 5. Catalog checks (M0a spec §8.5 rules: one fixture per branch, floors only go up)
| ID | Violation query finds… | Branches |
| --- | --- | --- |
| **MT-13** (new) | for every member of `pg_partition_tree('public.audit_log')`: RLS off; a non-owner ACL entry with INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN; the **owner** holding UPDATE, DELETE or TRUNCATE (ACLs read through `coalesce(relacl, acldefault('r', relowner))` as `MT-5c.sql:313` does — a partition created without the revoke has a NULL ACL, so `aclexplode(relacl)` alone sees nothing; the `owner_dml` fixture is exactly such a partition) [E4]; no `BEFORE UPDATE OR DELETE` row trigger calling `private.audit_log_append_only()` with `tgenabled = 'A'`; no such `BEFORE TRUNCATE` statement trigger with `tgenabled = 'A'`; or `public.audit_log` missing or not partitioned | `rls_off`, `acl`, `owner_dml`, `no_row_trigger`, `no_truncate_trigger`, `not_always`, `missing_parent` |
| **MT-14** (new) | (a) a `trace_*` role with `rolbypassrls`, `rolsuper`, `rolcreaterole`, `rolcreatedb`, `rolreplication` or `rolcanlogin`; (b) the `trace_candidate_gateway` → `trace_candidate` edge missing, or with `inherit_option = true` or `set_option = false`, or the gateway holding any other membership, or the gateway without NOINHERIT [D14]; (c) any role other than the gateway with a membership in `trace_candidate` that has `inherit_option` or `set_option` (ADMIN-only creator rows are ignored [S5, D4]); (d) any non-superuser role with `rolbypassrls` outside the allow-list `postgres` (migration owner; evidence: database-reviewer 2026-10-12), `service_role`, `supabase_etl_admin`, `supabase_read_only_user` [D5]; (e) any membership between `anon`, `authenticated` and `service_role`; (f) **rule 1** [S10]: any non-owner role that holds USAGE on both `quality` and `integrity`, directly or through any chain of memberships with inherit or set, or that is a member of both worker roles; (g) **[E6]** any LOGIN role other than `postgres` and superusers that holds INSERT, UPDATE, DELETE or TRUNCATE on any table in `public`, `private`, `quality` or `integrity` (`has_table_privilege`, so inherited grants count) — login roles act only after `SET ROLE`, which keeps the operator predicate of §2.8 sound; the allow-list starts empty and any entry needs probe evidence recorded here (DC-6 showed `postgres` can grant Supabase roles to each other, so this is checked, not assumed) | `attribute`, `gateway_edge`, `candidate_member`, `bypassrls`, `supabase_role_membership`, `both_schemas`, `login_dml` |
| MT-10 | adds `trace_candidate`, `trace_candidate_gateway`, `trace_worker` to the roles that must have no privilege on a materialized view | (existing branch) |
| MT-11 | **E3:** a policy on any relation in a system-list schema (`system_list_policy`). **DB-1:** a **permissive** policy whose USING or WITH CHECK calls no `auth.*` and no `private.*` function, on a table not on the reference-table list (`no_caller_reference`); fixture = the soft-delete shape `using (deleted_at is null)`; negative control in `catalog_probe.test.sql` = the same clause as a **restrictive** policy | +2 (+1 probe) |
| MT-5d | **E3:** policy hosts from every relation, as trigger hosts (`system_relation_policy`) | +1 |
| MT-2 | **DB-2:** no valid index on the table (or its partitioned parent) has `org_id` as its first key column (`org_id_not_indexed`) | +1 |
MT-14 (a)'s `rolcanlogin` rule is **M0b-only**; M2/M3a relax it for named login roles with a spec revision. `catalog-min-count` rises by the new clean checks, branch controls and probes (exact number recorded here at implementation).

---

## 6. RLS tests (`supabase/tests/rls_*.test.sql`)
- Each file: `begin; select plan(n); …; select * from finish(); rollback;`. Personas are created inside the transaction as `postgres` (synthetic users `p-<persona>@example.test` in `auth.users`, fixed UUIDs). App cases run as `set local role authenticated` with `set local request.jwt.claims` = `{"sub": …, "aal": …, "amr": [{"method": …, "timestamp": …}], "role": "authenticated"}` using the claim shapes pinned by AT-B8. Role cases first run, inside the transaction, `grant <role> to postgres with inherit false, set true` and `grant usage on schema extensions to <role>` (§2.3).
- **Deferred constraints [D10]:** cases that test the last-owner rule run `set constraints memberships_last_owner immediate` inside `throws_ok` (the file ends in `rollback`, so a deferred check would never fire otherwise).
- **Personas [S25]:** org A — `owner_admin` (aal2), `owner2` (second owner, aal2), `admin` (aal2), `admin_aal1`, `recruiter_otp` (aal1, otp), `recruiter_pw_aal1` (password, aal1), `reviewer` (aal2), `hm` (otp), `ws_recruiter` (recruiter scoped to workspace A2), `invited` (status invited, inserted on the operator path for the test), `removed`, `suspended`; org S (`status = suspended`) — `s_admin`; org B — `b_admin` (aal2); plus `staff` (platform_staff with an active grant on org A), `trace_worker`, `trace_quality_worker`, `trace_integrity_worker`, `trace_candidate`, `trace_candidate_gateway`, `anon`, `service_role`, and `postgres` (operator path).

| File | Cases (each line ≥ 1 allowed and ≥ 1 denied; cross-org denial for every op any org role can perform) |
| --- | --- |
| `rls_orgs` | S: each of the 5 roles sees own org / org B invisible; aal1 privileged, password-aal1, invited, removed, suspended member, suspended org (`s_admin`), staff, anon, candidate see nothing. U: owner name+residency (audited `org.update` with `changed`); admin name only, residency denied (guard); recruiter denied; b_admin cannot touch org A; no app caller updates `status`, `slug` or `kind` (column grant); the operator suspends org S → `org.update` with `changed = ["status"]` and `actor_kind = 'system'`, and changing `slug`/`kind` is refused even for the operator (guard) [N7]. I/D denied for everyone incl. owner. |
| `rls_workspaces` | S: org-wide member sees all; `ws_recruiter` sees A2 only; org B denied. I: owner/admin `client` allowed, `default` denied, recruiter denied, b_admin into A denied. U: rename allowed (admin); archive default denied; change `kind` denied. D denied. Events `workspace.*`. |
| `rls_teams` | S: 5 roles / org B denied. I/U/D: admin allowed; recruiter denied; delete of a team with members denied (FK). Events `team.*`. |
| `rls_memberships` | S: own row at aal1 and when removed; own row (only) for `invited` and for `s_admin` in suspended org S [N2, N6]; owner/admin all rows; recruiter/reviewer directory excludes removed/suspended rows; `hm` own row only; org B denied. I: admin adds recruiter (allowed, `active`); app caller inserts `invited` denied (M0b); operator inserts `invited` allowed, `suspended`/`removed` denied [N2]; `private.add_member` adds a recruiter (allowed; `membership.create` carries `actor_kind = 'system'` and the `request_id`) [N4], and a later admin insert in the same transaction writes `request_id is null` (the saved value was restored) [R3]; status transitions [R1]: admin `invited → active` denied, owner `active → invited` denied, operator `invited → active` denied, owner `suspended → active` allowed; admin adds `org_owner` denied; owner adds owner allowed; admin with `workspace_id` denied (CHECK). U: self role/status change denied (owner and admin); own `display_name` allowed; **admin suspends owner2 denied; admin sets owner2 `workspace_id` denied; admin drops `admin` from owner2 denied** [D2]; owner suspends owner2 allowed; demote last owner denied (`set constraints … immediate`); hand-over in one transaction allowed; change `org_id`/`user_id` denied; update after `removed` denied; re-add a removed user as a new row allowed. D denied for all. Hard delete of a member's `auth.users` row refused (23503). Operator detection: `postgres` + `set local role authenticated` + claims of `admin` cannot add `org_owner` [D1]; the predicate is one immutable function `private.is_operator_session(p_session_user name, p_role text, p_uid uuid)` (wrapped by `private.is_operator()`, which passes `session_user`, `current_setting('role')` and `auth.uid()`), so its truth table is tested directly — `('postgres','none',null)` and `('postgres','postgres',null)` true; `('authenticator','none',null)`, `('supabase_auth_admin','none',null)`, `('supabase_admin','none',null)`, `('postgres','authenticated',null)` and `('postgres','none',<uuid>)` false — because a non-superuser `postgres` cannot change `session_user` inside a test (`set session authorization` → 42501, probed) [R2]. **Wrapper pin [V2]:** a case asserts that `pg_get_functiondef('private.is_operator()'::regprocedure)` passes `session_user` and `current_setting('role')` to `is_operator_session` and never mentions `current_user` (inside a definer `current_user` is always `postgres`, which would reopen the R2/E6 hole while passing every truth-table case). EXECUTE on `private.valid_roles` present for `authenticated` (insert works) [D7]. Events `membership.*`. |
| `rls_audit_log` | S: owner/admin see org A rows; recruiter/reviewer/hm denied; org B denied. I denied for `authenticated`, `trace_worker`, `service_role`, `anon`. **U/D/TRUNCATE denied for every role: `anon`, `authenticated`, `trace_worker`, `trace_quality_worker`, `trace_integrity_worker`, `trace_candidate`, `trace_candidate_gateway`, `service_role`, and the owner `postgres` — on the parent, a monthly partition and the DEFAULT partition** (these fail with `42501`: they prove the missing or revoked privilege) [S6, D3]. **Trigger cases [N3]:** inside the same rolled-back transaction, `grant update, delete, truncate` on the parent, the monthly partition and the DEFAULT partition back to `postgres`, then assert UPDATE, DELETE and TRUNCATE on each raise `P0001` `TRACE_APPEND_ONLY` — once in normal mode and once after `set local session_replication_role = replica` — so the ALWAYS triggers are proven on their own, not hidden behind the revoke. **Date independence [V1]:** the file's **first statement**, before any persona row (persona setup fires audit triggers with `occurred_at = now()`), creates the current UTC month's partition if it is missing — `private.create_audit_partition(date_trunc('month', now(), 'UTC')::date)` inside the rolled-back transaction — so the file passes after 2027-12 too; the recovery case and every "uncreated month" fixture use far-future months (2099-01, 2099-02), never one near today. **Traps [E5]:** (a) a row trigger never fires on an empty table, so just before these cases (and after the "DEFAULT empty" assertion) the file inserts one row into the monthly partition and one into DEFAULT (month 2099-02, which has no partition) as `postgres`; (b) the replica cases come last in the file, and `set local session_replication_role = origin` runs right after them; pgTAP calls are never wrapped in savepoints (the counters would roll back). One case per event of §2.4 asserting the exact `details` keys of §4.5 (`auth.sign_in`/`auth.step_up` by inserting/updating an `auth.sessions` row as `postgres`). DEFAULT-partition recovery: rows of two orgs for an uncreated month (2099-01) land in DEFAULT, `create_audit_partition` moves them, DEFAULT ends empty, and each org gets exactly one `audit.repartition` row whose `rows_moved` counts only its own rows [N1]; with the current month's partition missing the recovery refuses (E8 step 1). `create_audit_partition` rejects a `p_month` that is not a month start, and under `set local timezone = 'Asia/Kolkata'` still creates UTC-aligned bounds [E2]. DEFAULT empty + the fixed partitions 2026-10 … 2027-12 exist (no `now()` in any assertion) [R6]. |
| `rls_staff` | platform_staff: own row allowed / other staff denied / non-staff denied. staff_access_grants: tenant owner/admin see grants, b_admin denied, staff sees own; revoke by admin once allowed, second revoke denied, changing `expires_at` denied; insert denied for all app roles; grant > 4 h and self-approved grant violate CHECKs. EXECUTE on `create_org`/`add_member`/`grant_staff_access`/`create_audit_partition` denied for `authenticated`, `service_role`, `trace_worker` [N4]. **Staff with an active grant read zero org A rows** (orgs, memberships, workspaces). |
| `rls_idempotency` | `trace_worker` S/I/U/D allowed; `authenticated`, `service_role`, `trace_candidate`, `anon` denied on each. |
| `rls_roles` | `trace_quality_worker` USAGE on `quality` only; `trace_integrity_worker` on `integrity` only; no role holds USAGE on both [S10]; `trace_candidate` has no privilege on any M0b table; the gateway can `set role trace_candidate` and inherits nothing; DC-1 (policy filters without USAGE on `private`); suspended org hides everything except the member's own membership rows (§2.2) [N6]. |

Target ≥ 140 `rls_*` assertions; the floor `supabase/tests/rls-min-count` is set to the real count at the end of BUILD (never below 50).

---

## 7. Acceptance tests
| AT | Exit-gate item / behaviour | How |
| --- | --- | --- |
| AT-B1 | `supabase db reset` rebuilds from zero | `pnpm test:rls` (inside `pnpm verify`; CI `rls`), and run twice in a row once in BUILD (idempotent roles) |
| AT-B2 | ≥ 50 RLS tests, allowed + denied per role incl. cross-org, counted separately from catalog checks | §6 files; harness counts `rls_*` against `rls-min-count` |
| AT-B3 | Audit log rejects UPDATE/DELETE/TRUNCATE for every role | `rls_audit_log` (every role incl. owner, parent + partitions + DEFAULT: the revoke refuses with `42501`; after a test-local re-grant to the owner, the ALWAYS triggers refuse with `P0001` in normal and replica mode [N3]) + MT-13 clean and its 7 fixtures firing |
| AT-B4 | Org creation and operator member adds are audited and operator-only | `rls_staff`/`rls_orgs`/`rls_memberships` cases on `create_org` and `add_member` + the `org.create`/`membership.create` event cases; `scripts/test/ops-create-org.test.mjs` and `scripts/test/ops-add-member.test.mjs` (zod validation, `psql -v` variables only, URL never printed) [N4]; `scripts/test/ops-enrol-smoke-user.test.mjs` (both modes; the demo key refused for a non-`127.0.0.1` URL) [N5, R7] |
| AT-B5 | Roles from tables: a removed/suspended member or suspended org loses access within the same JWT | `rls_memberships`/`rls_orgs`: same claims before/after the change |
| AT-B6 | AAL rules (§2.2) | `rls_orgs` aal1/password cases + own-row exception |
| AT-B7 | Rule 1: separate worker grants | `rls_roles` + MT-14 `both_schemas` + MT-5c clean |
| AT-B8 | Local org sign-in end to end, and the pinned claim shapes | `scripts/test-auth-local.mjs`, run by `test:rls` after pgTAP, locally and in CI `rls`. The harness's `supabase start -x` list stops excluding `postgrest`, `kong` and `mailpit` (it still excludes the rest) [S3]. Steps (the test generates `SMOKE_PASSWORD` at run time): `enrol-smoke-user --env local --email p-owner@example.test` (user 1) + `create-org` (user 1 owner of `smoke-local`); `enrol-smoke-user --env local --email p-recruiter@example.test` (user 2) + `add-member --roles recruiter` [N4, R7]; (1) password sign-in of user 1 → aal1 sees no org → TOTP enrol/verify → aal2 sees exactly its org via PostgREST; (2) email OTP for the recruiter-only user 2: request the code, read it from the mailpit API, `verifyOtp` → aal1 sees its org; (3) asserts `aal` and `amr[].method` for both sessions match the shapes the `rls_*` files use; (4) asserts one `auth.sign_in` row per sign-in and one `auth.step_up` row after TOTP |
| AT-B9 | **An org user can sign in on staging** | `deploy-staging` smoke step: password + TOTP sign-in for the H9 recruiter over the Auth REST API, then its own membership (`memberships?user_id=eq.<sub>`, because a recruiter also sees the owner's directory row) and its org via PostgREST return exactly 1 row each [R4]; `GET /auth/v1/settings` reports sign-ups disabled; the deployed recruiter page loads with a CSP `connect-src` naming the staging Supabase origin. The REST sign-in is an accepted proxy for the browser flow, whose UI is covered by AT-B11 [S24]. **Deferred (H3–H5, H8–H10; runs at M0b CLOSE).** |
| AT-B10 | **Migrations reach staging from CI only** | M0a's `deploy-staging` job + `check-workflows` (no other job or workflow may run `supabase db push` or hold `SUPABASE_STAGING_DB_URL`; unit-tested). **[R5]** `STAGING_SMOKE_EMAIL`, `STAGING_SMOKE_PASSWORD` and `STAGING_SMOKE_TOTP_SECRET` join `check-workflows`' `STAGING_SECRET_USERS` (bound to the smoke command only) and `ENV_ALLOW_LIST` (`scripts/check-workflows.mjs:543-546`, `:675-696`), with a test that any other step holding one fails; spec M0a §7.3's secrets row gains the three names (revision 18). H11 proves the three migrations on `trace-dev` first. **Deferred part:** the staging run. |
| AT-B11 | Recruiter app flows | Vitest with a fake supabase client over every edge of §4.6: unconfigured build, OTP path, password → TOTP, enrolment shows QR + manual secret, challenge, org picker, `no_org`, generic errors, sign-out clears `sessionStorage`, no server error text rendered, rows parsed with the §4.5 contracts |
| AT-B12 | CSP and boundaries | `check-headers` (recruiter: `'self'` + at most the configured Supabase origin; candidate: never `supabase.co`); `check-boundaries` (supabase-js only in recruiter; `ALLOWED_VITE_NAMES`; auth config keys; Workers Logs settings; `@trace/workers-http` import rules); `scan-dist` publishable vs secret key tests |
| AT-B13 | db-types current | existing step 6 |
| AT-B14 | Workers keep their behaviour after the `@trace/workers-http` extraction | the moved tests + one wiring test per Worker (`/health`, 404 JSON, 500 JSON, non-Error throw) |

---

## 8. Candidate token spike (Q6 → ADR-030, Proposed)
- `docs/spikes/m0b-candidate-token/` (excluded from the build; formatted like `scripts/`: `prettier --check` covers it because the lead changes `.prettierignore`'s `docs/` to `docs/*` + `!docs/spikes/` before B3 starts; like `scripts/`, it is not ESLint-ed): `spike.mjs` mints an ES256 token with WebCrypto (no library), verifies it with the public JWK, then — on the local stack, in one rolled-back transaction — creates a throwaway table `public.spike_cand (org_id uuid not null, candidate_id uuid not null, v text)` with RLS and a SELECT policy `to trace_candidate using (candidate_id = ((select auth.jwt()) ->> 'candidate_id')::uuid)`, grants SELECT to `trace_candidate`, inserts two rows, `grant trace_candidate to postgres with inherit false, set true`, `set local role trace_candidate`, sets `request.jwt.claims` from the **verified** token, and shows **one row allowed and one denied** [S14]. It also shows `trace_candidate` reads zero rows of every M0b table. The README records commands and output.
- ADR-030 (**Proposed — implement in M3a**): ES256 Trace key held only by a server worker; edge verifies with the public key; candidates never call PostgREST; gateway login role (NOINHERIT, only membership `trace_candidate` with set true / inherit false); token types per Q7 (lobby / session / portal); the zod claim shape `{ sub: uuid (candidate id), candidate_id: uuid, invitation_id: uuid, org_id: uuid, typ: 'lobby'|'session'|'portal', nonce: string, iat, exp }`; the open M3a question (whether Supabase third-party/asymmetric JWT support makes direct RLS evaluation possible), docs checked at M3a SPEC.

---

## 9. Day-one checks
| DC | What | Result |
| --- | --- | --- |
| DC-1 | Policy calling a `private` helper filters `authenticated` without USAGE on `private` | **PASS** (lead + database-reviewer, 2026-10-12); exact form in §2.1 |
| DC-2 | GoTrue `aal`/`amr` claim shapes for password, OTP and TOTP | BUILD, pinned by AT-B8 |
| DC-3 | `create role … nologin` in a migration; `db reset` twice | create: PASS locally (database-reviewer); reset twice: **PASS** (lead, 2026-10-12: `supabase db reset --local` 6 times with the roles already present, all exit 0, plus every `pnpm test:rls` since); hosted: H11 |
| DC-4 | Trigger on `auth.sessions` | PASS locally (database-reviewer); hosted: H11 |
| DC-5 | TRUNCATE/row trigger inheritance on partitions | **Done** (lead + database-reviewer): row triggers clone, TRUNCATE triggers do not → per-partition triggers (§2.4) |
| DC-6 | Whether supautils lets `postgres` grant `service_role` to `authenticated` or alter Supabase roles' `bypassrls` | **Done** (lead, local PG 17.11, rolled back, 2026-10-12): `grant service_role to authenticated` and `grant anon to authenticated` **succeed** (so MT-14 (e) is the only guard); `alter role authenticated bypassrls` and `alter role service_role nobypassrls` fail ("reserved role, only superusers can modify it"); `postgres` **can** `alter role <a role it created> bypassrls` (so MT-14 (a) is needed). Hosted: assumed the same; MT-14 runs on staging (`staging-catalog-checks`) |
| DC-7 | Installed wrangler `config-schema.json` accepts `observability.head_sampling_rate` and `observability.logs.invocation_logs` | **PASS** (lead, wrangler 4.149.0): `Observability` has `enabled`, `head_sampling_rate`, `redact_query_string` (default false), `logs.{enabled, head_sampling_rate, invocation_logs, persist, destinations}`, `traces.{enabled, …}`; §1.1 (c) sets the last three explicitly |
| DC-9 | Hosted operator URL: `session_user` and `current_setting('role')` [R2] | H11 (founder); must be `postgres` / `none` |
| DC-10 | Whether `supabase gen types --schema public` lists the audit partitions as tables (AT-B13 output size; stable either way, because the range is fixed) [E1] | **Yes** (lead, 2026-10-12): `audit_log_default` and the 15 months `audit_log_2026_10` … `audit_log_2027_12` appear as tables; `test:rls` keeps the file current |
| DC-8 | `session_replication_role = replica` is settable by `postgres` locally | **Yes** (database-reviewer probe) → `ENABLE ALWAYS` (§2.4) |

---

## 10. Edge cases and failure modes
| Case | Behaviour |
| --- | --- |
| Last owner removes/suspends/demotes themselves | Denied (rule 2 + rule 3) |
| Two owners demote each other in one transaction | Deferred check refuses at commit |
| Two owners demote each other in **concurrent** transactions | The `orgs` row lock serialises them; the second sees the first's commit and is refused [D9] |
| Admin edits any membership that holds `org_owner` | Denied (rule 1′) [D2] |
| Admin escalates a recruiter to owner | Denied |
| Removed member's JWT still valid | Helpers read `status` → nothing on the next statement |
| Org suspended by the operator | Every member sees only their own membership rows (§2.2); the app shows `no_org`; the suspension is audited as `org.update` (`changed = ["status"]`) [N6, N7] |
| Rows of several orgs land in DEFAULT for one month | `create_audit_partition` moves them all; one `audit.repartition` per org, counting only that org's rows [N1] |
| A test needs an `invited` member | Only the operator path can insert one in M0b [N2]; nobody can move it to `active` until M1 [R1] |
| `create_audit_partition` called from an IST session, or with a mid-month date | UTC bounds regardless of the session `TimeZone`; a non-month-start `p_month` raises [E2] |
| Audit rows written after 2027-12 with no M7 job yet | They land in DEFAULT; the recovery moves them once their month is created; the horizon is M7's [R6] |
| A login role connects without `SET ROLE` and with no claims | Not the operator (`session_user` ≠ `postgres`); holds no role, so every guarded write is refused; MT-14 (g) keeps login roles from holding DML [R2, E6] |
| Data-only restore | Owner in replica mode from a consistent dump (guards, FKs and ordinary audit triggers off; `audit_log` INSERT still allowed); runbook owner M7 (ABH-80) [E9] |
| Privileged user at aal1, or password sign-in at aal1 | Sees only own membership rows; app routes to TOTP |
| Audit month partition missing | Row lands in DEFAULT; `create_audit_partition` moves it (§2.4) |
| `session_replication_role = replica` | ALWAYS triggers still refuse DML |
| `details` carries free text | Triggers write only the §4.5 keys; `rls_audit_log` asserts the exact keys per event |
| Staff with an active grant query tenant tables | Zero rows (no staff read policy until M6) |
| Grant longer than 4 h, or self-approved | CHECK violation |
| `auth.users` hard delete of a member | Refused (FK restrict); erasure uses GoTrue soft delete |
| Supabase Auth renames `aal`/`amr` | AT-B8 fails (it reads real sessions) |
| Sign-in or step-up trigger fails | Sign-in fails (fail closed) |
| Build without Supabase variables | Builds; app shows "Sign-in is not configured" |

---

## 11. Streams (AUTOPILOT §2; at most 2 writers at once this session; migrations, lockfile, root `package.json`, `scripts/`, `supabase/config.toml` and `packages/config/` are lead-only)
| Step | Who | Scope | Owns | Reviews (AUTOPILOT §2) [S16] |
| --- | --- | --- | --- | --- |
| B0 | Lead | DC-2, DC-3 (reset twice), DC-10; the three migrations; `config.toml` auth + email template; db-types; `rls_*` tests written **first** (red), then the migrations to green; `rls-min-count` | `supabase/migrations/`, `supabase/tests/`, `supabase/config.toml`, `supabase/templates/`, `packages/db-types/` | spec-reviewer, database-reviewer, security-reviewer |
| B1 | Lead | MT-13, MT-14, DB-1, DB-2, E3 branches + fixtures, manifest, floors; `gen-catalog-tests` | `supabase/catalog-checks/`, `scripts/gen-catalog-tests.mjs` | spec-reviewer, database-reviewer |
| B2 | Writer (Opus) | Recruiter sign-in, TOTP, org picker, shell, §4.5 contracts used in the app, tests (AT-B11) — after B4 adds supabase-js and the contracts | `apps/recruiter/src/**` except lead-only files | spec-reviewer, security-reviewer |
| B3 | Writer (Sonnet) | Candidate token spike + ADR-030 draft | `docs/spikes/m0b-candidate-token/`, `docs/adr/ADR-030*` | spec-reviewer, security-reviewer |
| B4 | Lead | Workers Logs settings (DC-7 done); `check-workflows` smoke secrets + M0a spec §7.3 row (R5); supabase-js; `@trace/shared` contracts (§4.5); CSP template + Vite plugin; `check-boundaries`/`check-headers`/`check-workflows`/`scan-dist` additions; `scripts/lib/totp.mjs`; `scripts/ops/*`; `test-auth-local.mjs` and the harness `-x` change; staging smoke step; ADR-029; `@trace/config` boundary rules for `@trace/workers-http`; the `packages/workers-http` skeleton (package.json, tsconfig, Vitest config, lockfile) | root/lead files, `packages/shared/src/contracts*`, `packages/config/` | spec-reviewer, security-reviewer, database-reviewer (ops scripts, harness) |
| B5 | Writer (Sonnet) | `@trace/workers-http` extraction (§1.1 item 9b) after B4's skeleton | `packages/workers-http/src/**`, `workers/*/src/app.ts` and their tests, `services/api/src/app.ts` and its tests | spec-reviewer, security-reviewer |
Then the M0b REVIEW (`trace-milestone-review`) in its own pass.

---

## Approval
- Revision 1: `spec-reviewer` CHANGES REQUIRED (1 Blocking, 15 Medium, 9 Low); `database-reviewer` CHANGES REQUIRED (2 Blocking, 7 Medium, 7 Low). Recorded in `docs/reviews/M0b-spec-review.md`; every finding addressed in revision 2.
- Revision 2: Sonnet `spec-reviewer` re-review CHANGES REQUIRED: all 41 findings RESOLVED; 4 Medium + 4 Low new (N1–N8), every one addressed in revision 3.
- Revision 3: Opus `spec-reviewer` CHANGES REQUIRED (1 Medium, 7 Low: R1–R8); Opus `database-reviewer` CHANGES REQUIRED (3 Medium, 6 Low: E1–E9; N1–N3 proven by prototype). Every finding addressed in revision 4.
- Revision 4: Sonnet `spec-reviewer` confirming re-review: R1–R8 and E1–E9 all RESOLVED (E2, E8, the operator premise, MT-14 (g) and DC-6/DC-7 re-probed on the local stack); 1 Medium + 1 Low new (V1, V2), both applied in revision 5 exactly as the reviewer specified.
- **Spec approved by autopilot reviewers** — revision 5, 2026-10-12: spec-reviewer (Opus rev 1, Sonnet rev 2, Opus rev 3, Sonnet rev 4) and database-reviewer (Opus rev 1 and rev 3). Every finding (S1–S25, D1–D16, N1–N8, R1–R8, E1–E9, V1–V2) is resolved in the spec; hosted-only facts stay open as DC-9 (H11) and the founder rows H8–H11.
