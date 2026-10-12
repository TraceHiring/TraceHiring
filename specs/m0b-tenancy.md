# Spec — M0b · Tenancy, roles, audit and org auth

- **Revision 1 (2026-10-12, lead session, draft for the autopilot reviewers).** Written in the M0b SPEC phase. The founder's overnight decision (build-notes §0, "Overnight session") lets M0b *start* before `m0a-reviewed`; M0b still **closes** only after `m0a-reviewed` (build-order rule 5). Branches are cut from `milestone/m0a`; `main` is not touched.
- **Status:** DRAFT — not yet approved. Approval = `spec-reviewer` and `database-reviewer` pass, every finding fixed (AUTOPILOT §2 SPEC).

Sources, in precedence order (AUTOPILOT §1): CLAUDE.md rules 1–9 and Engineering rules; `docs/build-notes.md` §0 (Q2, Q2b, Q3, Q6, Q8, Q9, Q11, Q12 — all accepted) and §4 "M0 — Foundations" data model; `docs/plan-conflicts.md`; ADR-017, ADR-027, ADR-028; `docs/plan.md` §2, §9.1, §10.1; `docs/build-order.md` M0b; `specs/m0-foundations.md` (M0a spec, rev 16) §8 (baseline migration rules, catalog checks, harness) and §16.

---

## 1. Scope

### 1.1 In scope (build-order M0b, word for word first)
> Core schema from plan §9.1 for: orgs, workspaces, teams, memberships, audit_log, platform staff + break-glass grants, idempotency keys; RLS on all; role model from §2 (ABH-73 core) as decided in build-notes Q2/Q2b/Q3; `quality` and `integrity` schemas created empty with separate worker grants (rule 1).
> Org auth (Supabase Auth: email OTP / password + TOTP; AAL2 for owner, admin and reviewer). Org creation via an audited operator path. Candidate token design (invite + OTP → Trace-issued token that RLS understands) — spec plus a local spike only, implemented in M3a.
> Append-only audit log (no UPDATE/DELETE/TRUNCATE for any role, including workers).
> **Exit gate:** `supabase db reset` rebuilds from zero; ≥50 RLS tests (allowed + denied per role, including cross-org) pass — counted separately from the catalog checks; audit log rejects UPDATE/DELETE/TRUNCATE for every role; an org user can sign in on staging; migrations reach staging from CI only.

Concretely:
1. One migration `<ts>_m0b_tenancy.sql` (created with `pnpm exec supabase migration new m0b_tenancy`): enums, the 8 tables of §3, `private` helpers, guard and audit triggers, the Postgres group roles of §2.3, the `quality`/`integrity` worker grants, audit partitions.
2. Catalog-check additions (§5): MT-13 (audit append-only on every partition), MT-14 (Trace role attributes), the E3 carry-over into MT-11/MT-5d, candidate roles in MT-10. Floors go up.
3. ≥ 50 `rls_*` pgTAP assertions (§6); `rls-min-count` = 50 (or the real, higher count).
4. Supabase Auth configuration (§4): public sign-up off, email OTP on, password + TOTP, AAL rules enforced **in the database**.
5. Recruiter app: sign-in (email OTP or password), TOTP enrolment and challenge, a signed-in shell that reads the caller's own org and roles through RLS (§4.3).
6. Operator scripts (§4.4): `create-org` (audited, via `private.create_org`), `create-smoke-user` (staging smoke account).
7. Local auth end-to-end test against the local stack, and a staging smoke sign-in step (§7).
8. ADR-029 "org authorisation from tables, not JWT claims" (build-notes Q3 asks for it). ADR-030 "candidate token" (Proposed; implemented in M3a) with the local spike (§8).
9. **Carry-overs owned by M0b** (from M0a reviews): (a) M0a REVIEW DB-1, DB-2 and the E3 items (§5); (b) **S3a deviation (d)**: extract the duplicated Workers `app.ts` error/notFound handling (the non-Error middleware, `onError` with its static fallback, JSON 404) into a Workers-only package `packages/workers-http` (`@trace/workers-http`, no new dependency; Hono is already a Worker dependency, ADR-028), returning `err.getResponse()` for Hono `HTTPException`; the three Workers' existing tests move with it and each Worker keeps one wiring test; (c) **M0a REVIEW SPEC-F2, Workers Logs:** turn them **on** for `workers/jobs`, `services/api` and `workers/edge` with `"observability": { "enabled": true, "head_sampling_rate": 1, "logs": { "invocation_logs": false } }`, so only the redacting logger's lines are stored (no request URL, headers or client IP from invocation logs). ADR-027 already records Workers Logs as a processor outside India; spec M0a §9.2's "edge logs to Workers Logs" becomes true. Key names are checked against the installed wrangler `config-schema.json` (DC-7); `check-workflows`/`check-boundaries` gain a test that pins these values.

### 1.2 Out of scope (owner)
- `assignments`, `org_policies` and every M1+ table → M1/M2 (build-notes §4 lists them under M1/M2). `create_org()` gains the `org_policies` row when that table lands (M2).
- Admin UI and API for inviting members, changing roles and teams → M1 (first recruiter-admin screens). In M0b, members are added with RLS-guarded SQL from tests and the operator script.
- Trust & Safety **read** path (audited RPC, staff UI) → when first needed (build-notes Q2: "no staff UI until needed"), at the latest M7. See §3.7: M0b ships the grant tables and their invariants but **no SELECT policy that lets staff read tenant data**, because Postgres cannot audit a SELECT and plan §2 forbids hidden staff access.
- SAML SSO (Enterprise) → later phase. Candidate token implementation → M3a. Audit-partition maintenance job and retention drop → M7 (Q11).
- Sentry (H6) → before D1, unchanged.

### 1.3 Founder prerequisites (H) — only the staging gate needs them
| H | What | Blocks |
| --- | --- | --- |
| H3–H5 (M0a, still open) | `CLOUDFLARE_API_TOKEN`, `SUPABASE_STAGING_DB_URL` (`?sslmode=require`) | AT-B9, AT-B10 (staging) |
| H8 (new) | On the staging project's Auth settings: sign-ups **off**, email provider on, TOTP **enrol + verify on**, minimum password length 12, Site URL = the staging recruiter Pages URL. Exact clicks in FOUNDER-QUEUE. | AT-B9 |
| H9 (new) | Run `node scripts/ops/create-smoke-user.mjs` once against staging (needs the staging service-role key **in the founder's local env only**), then store `STAGING_SMOKE_EMAIL`, `STAGING_SMOKE_PASSWORD`, `STAGING_SMOKE_TOTP_SECRET` as `staging` environment secrets. | AT-B9 |

Everything else is built and tested locally.

---

## 2. Decisions specific to M0b

### 2.1 Authorisation reads tables, not role claims (build-notes Q3 → ADR-029)
RLS resolves the caller's orgs and roles through `private` `STABLE SECURITY DEFINER` helpers that read `memberships`; JWT claims are used only for `sub` (`auth.uid()`), `aal` and `amr`. A removed or suspended member loses access on the next statement, not when the JWT expires. Policies call the helpers inside a scalar sub-select so they are evaluated once per statement.

**Schema USAGE.** `authenticated` keeps **no** USAGE on `private` (MT-8 forbids it). A policy stores the helper's OID, so execution needs only EXECUTE on the function, not USAGE on its schema. This is a day-one check (§9, DC-1): a pgTAP case proves that `authenticated`, without USAGE on `private`, is filtered correctly by a policy that calls a `private` helper. If PostgreSQL disagrees, stop and re-spec (do not grant USAGE).

### 2.2 Assurance level (build-notes Q8, enforced in the database)
- `privileged roles` = `{org_owner, admin, reviewer}`.
- A membership that holds **any** privileged role counts only when the JWT has `aal = 'aal2'`. At `aal1` the helpers return nothing for that org, so the person sees no org data until they pass TOTP (the app then shows enrolment or the challenge).
- A membership with only non-privileged roles (`recruiter`, `hiring_manager`) counts at `aal1` **only if** the session's first factor was email OTP (`amr` contains `otp` or `magiclink`, and not `password`). A password sign-in needs `aal2` for every membership ("password sign-in requires TOTP").
- The exact claim names (`aal`, `amr[].method` values) are checked against the installed GoTrue on day one (DC-2) and pinned by the local auth end-to-end test (AT-B8), so a GoTrue upgrade that renames them fails loudly.

### 2.3 Postgres principals (build-notes §4 Conventions, Q6, Q12)
| Role | Kind | Purpose in M0b |
| --- | --- | --- |
| `anon` | Supabase | no grant anywhere (MT-4) |
| `authenticated` | Supabase | org users; table/column grants of §3; RLS decides rows |
| `service_role` | Supabase (BYPASSRLS) | **no table grants** (baseline revoked the defaults); used only by server code for the Auth admin API |
| `trace_worker` | NOLOGIN, NOBYPASSRLS, NOINHERIT | server workers' row access (M0b: `idempotency_keys`) |
| `trace_quality_worker` | NOLOGIN, NOBYPASSRLS | USAGE on schema `quality` only (rule 1) |
| `trace_integrity_worker` | NOLOGIN, NOBYPASSRLS | USAGE on schema `integrity` only (rule 1) |
| `trace_candidate` | NOLOGIN, NOBYPASSRLS | candidate requests (`SET LOCAL ROLE`); no grant on any M0b table |
| `trace_candidate_gateway` | NOLOGIN in M0b, NOINHERIT, NOBYPASSRLS | its only membership is `trace_candidate` (Q6); the M3a login role inherits nothing else |

- No `trace_*` role has `BYPASSRLS`, `CREATEROLE`, `CREATEDB`, `SUPERUSER` or `REPLICATION`; none is `LOGIN` in M0b (MT-14). Login roles with passwords are created per environment by an operator runbook when a Worker first connects (M2/M3a), never in a migration (no secret in git).
- `trace_quality_worker` and `trace_integrity_worker` hold nothing in common (MT-5c already proves it once grants exist); a pgTAP case asserts each has USAGE on its own schema and none on the other.
- Day-one check DC-3: `postgres` can `create role … nologin` in a migration on CLI 2.120.0 and on hosted Supabase (`postgres` has CREATEROLE there). If staging refuses, the roles move to an operator script and the migration only grants (recorded in the summary).

### 2.4 Audit log (build-notes Q11)
- `public.audit_log` is partitioned **by range on `occurred_at`, monthly**. The migration creates a `DEFAULT` partition (no row is ever lost to a missing month) and the monthly partitions from 2026-10 through 2027-12. `private.create_audit_partition(month date)` (owner-only, no grants) adds one month and applies every per-partition rule; the maintenance job that calls it and the retention drop are M7 (Q11; the 2027-12 horizon gives M7 a year).
- Every partition, the parent and the default: RLS on; no UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN for any role but the owner; a `BEFORE UPDATE OR DELETE … FOR EACH ROW` trigger and a `BEFORE TRUNCATE … FOR EACH STATEMENT` trigger that raise `TRACE_APPEND_ONLY` (SQLSTATE `P0001`) for **every** role, the owner included. Detaching or dropping a partition (M7 retention) does not fire them; only the migration owner can do that.
- Rows are written only by `private.audit(...)` (SECURITY DEFINER, no EXECUTE grant to any role; called from triggers) and by `private.create_org` / `private.grant_staff_access`. No role has INSERT on `audit_log`.
- Row content: IDs and roles only, never names, emails or free text. `details jsonb` ≤ 4 KB (CHECK) and its top-level keys must match `^[a-z_]{1,40}$` (CHECK via a `private` immutable function); the triggers write only ids, enum labels and booleans.
- `actor_roles` and `org_id` are captured at event time (the candidate later sees viewers "by role and organisation", M7).
- **M0b events:** `org.create`, `workspace.create|update|archive`, `team.create|update|delete`, `membership.create|update|remove` (with old/new roles and status), `staff_grant.create|revoke`, `auth.sign_in` (§2.5).

### 2.5 Sign-in audit event
Q11 lists sign-in among the M0 audit events. M0b writes `auth.sign_in` from an `AFTER INSERT` trigger on `auth.sessions` (one row per active membership of that user, `actor_kind = 'org_user'`, `details = {"aal": …}`; no IP, no user agent). Day-one check DC-4: `postgres` can create that trigger locally (supautils) and on staging; the trigger function is `private.on_auth_session()` (SECURITY DEFINER, `search_path = ''`), and MT-5d's `system_table_trigger` branch keeps checking it. A failure inside the trigger aborts the sign-in (fail closed; an unaudited sign-in is worse than a retry). **If DC-4 fails on staging**, the event moves to the API layer (owner M1) and the change goes to FOUNDER-QUEUE (it changes *when* a Q11 event is recorded).

### 2.6 Org creation (build-notes Q9)
- `private.create_org(p_name text, p_slug text, p_kind org_kind, p_owner_user_id uuid, p_request_id uuid) returns uuid`: SECURITY DEFINER, `search_path = ''`, **no EXECUTE grant to any role** (only the owner `postgres` can call it, i.e. an operator with the database URL). One transaction creates the org, its `default` workspace, and the first membership with roles `{org_owner, admin}` for an existing `auth.users` row, then writes `org.create` with `actor_kind = 'system'` and the operator-supplied `request_id`.
- `scripts/ops/create-org.mjs`: reads the DB URL from the environment (`TRACE_OPERATOR_DB_URL`; default = the local stack URL read from `supabase status -o env`, never printed), prompts for nothing, validates arguments with zod, calls the function through `psql` with variables (no string interpolation into SQL), prints only the new org id.
- `trace_internal` org (Trace staff home for `platform_staff`) is created with the same script, `--kind trace_internal`.

### 2.7 Session storage in the recruiter app
supabase-js with `persistSession: true` on **`sessionStorage`** (cleared when the tab closes; shared machines in recruiting floors), `autoRefreshToken: true`, `detectSessionInUrl: false` (no magic links: OTP codes only), `flowType: 'pkce'`. The Supabase URL and publishable key come from build-time `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (public values; M0a §7.3 variables). A production build without them fails.

---

## 3. Data model (one migration; every rule of M0a spec §8.2 applies)

Conventions (build-notes §4): `org_id uuid not null`, `unique (org_id, id)`, composite foreign keys `(org_id, x_id)`, RLS on, one policy per operation, no `anon` grant, explicit grants, invariants in triggers and CHECKs, no DELETE policy on people's data, no column matching MT-3. Timestamps are `timestamptz not null default now()`. Text columns have length CHECKs.

### 3.1 Enums
`org_kind (customer, trace_library, trace_internal)` · `org_status (active, suspended)` · `data_residency (r2_apac, s3_mumbai)` · `workspace_kind (default, client)` · `org_role (org_owner, admin, recruiter, reviewer, hiring_manager)` · `membership_status (invited, active, suspended, removed)` · `actor_kind (org_user, candidate, staff, system)` · `staff_grant_scope (support_read)`.

### 3.2 `orgs`
`id uuid pk default gen_random_uuid()`, `org_id uuid generated always as (id) stored not null`, `kind org_kind not null`, `name text` (1–200), `slug text unique` (`^[a-z0-9][a-z0-9-]{2,62}$`), `data_residency data_residency not null default 'r2_apac'`, `status org_status not null default 'active'`, `created_at`. `unique (org_id, id)`.

### 3.3 `workspaces`
`id`, `org_id → orgs`, `name` (1–200), `kind workspace_kind`, `is_default boolean not null`, `archived_at timestamptz null`, `created_at`. `unique (org_id, id)`; partial unique `(org_id) where is_default`; CHECK `is_default = (kind = 'default')`. Guard trigger: `kind`, `is_default` and `org_id` immutable; the default workspace cannot be archived.

### 3.4 `teams`
`id`, `org_id`, `name` (1–200), `created_at`; `unique (org_id, id)`, `unique (org_id, name)`. Organisational only (Q2): no policy anywhere reads `team_id`.

### 3.5 `memberships`
`id`, `org_id`, `user_id uuid not null references auth.users (id) on delete restrict`, `roles org_role[] not null` (CHECK: 1–5 elements, no nulls, no duplicates — via an immutable `private` function), `workspace_id uuid null` (composite FK to `workspaces`), `team_id uuid null` (composite FK to `teams`, `on delete restrict`), `display_name text` (1–120), `status membership_status not null default 'invited'`, `created_by uuid null`, `created_at`, `removed_at timestamptz null` (CHECK `removed_at is not null = (status = 'removed')`). `unique (org_id, id)`, `unique (org_id, user_id)`.

Guard trigger `private.memberships_guard()` (BEFORE INSERT OR UPDATE):
1. Only a caller who holds `org_owner` in that org (at aal2) may add `org_owner` to any membership or remove it from one.
2. Nobody changes their own `roles` or `status` (the caller's `auth.uid()` = `user_id`), except an owner removing nothing — i.e. no self-edit at all; the owner path is another owner.
3. The org must keep ≥ 1 `active` membership holding `org_owner` after the statement (also checked on removal and suspension). Enforced by a `DEFERRABLE INITIALLY DEFERRED` constraint trigger so a two-row hand-over in one transaction works.
4. `org_id`, `user_id`, `created_by`, `created_at` are immutable; `removed` is terminal (no update after it); ids are never deleted (no DELETE grant, rule 4 needs stable ids).
5. `created_by` is set from `auth.uid()` on insert (ignores the client value).
When the caller is the owner role `postgres` (operator path) rules 1–2 are skipped; rules 3–5 always apply.

### 3.6 `audit_log` (partitioned, §2.4)
`id uuid default gen_random_uuid()`, `occurred_at timestamptz not null default now()`, `org_id uuid not null`, `actor_kind actor_kind not null`, `actor_user_id uuid null`, `actor_roles org_role[] not null default '{}'`, `action text not null` (`^[a-z_]+\.[a-z_]+$`), `object_table text null`, `object_id uuid null`, `workspace_id uuid null`, `request_id uuid null`, `staff_grant_id uuid null`, `details jsonb not null default '{}'` (§2.4 CHECKs). Primary key `(org_id, occurred_at, id)` (a partitioned table's unique keys must include the partition key; this also serves `unique (org_id, id, occurred_at)`). FK `org_id → orgs` (`on delete restrict`). Index `(org_id, occurred_at desc)`. `candidate_id` arrives with candidates (M2).

### 3.7 `platform_staff` and `staff_access_grants`
- `platform_staff`: `user_id uuid pk references auth.users`, `org_id` (must be an org of kind `trace_internal`, checked by trigger), `active boolean not null default true`, `capabilities text[]` (subset of `{support_read}`), `created_at`; `unique (org_id, user_id)`. Written by the operator only (no grant).
- `staff_access_grants`: `id`, `org_id` (tenant), `staff_user_id → platform_staff`, `ticket_ref text not null` (`^[A-Za-z0-9_-]{3,64}$`), `scope staff_grant_scope not null`, `granted_at`, `expires_at` (CHECK `expires_at > granted_at and expires_at <= granted_at + interval '4 hours'`), `approved_by uuid not null references platform_staff` (CHECK `approved_by <> staff_user_id`), `revoked_at`, `revoked_by`. Created only by `private.grant_staff_access(...)` (owner-only, audited `staff_grant.create`). Guard trigger: only `revoked_at`/`revoked_by` may change, once, by a tenant owner/admin (`revoked_by := auth.uid()`, `revoked_at := now()`), audited `staff_grant.revoke`.
- **No staff read policy in M0b** (§1.2). `private.ts_org_ids()` is not created until the audited read path exists.

### 3.8 `idempotency_keys`
`org_id`, `scope text` (1–64), `key text` (1–200), `first_seen_at`, `result_ref text null` (≤ 200), `expires_at timestamptz not null`; `primary key (org_id, scope, key)`; `unique (org_id, scope, key)` doubles as the convention's `(org_id, id)` (there is no `id`; MT-2 only needs `org_id`). Worker-only: grants and policies to `trace_worker` only. The policies have a literally-true clause, so `public.idempotency_keys` joins the **MT-11 reference-table list** with the reason "worker-only ledger; no app role has a grant (proved by MT-4 and rls tests)".

### 3.9 Grants and RLS matrix
`agg` = the helper `private.my_org_ids(roles)` (§2.1–2.2); `ws` = `private.my_workspace_ids(roles)` (a membership with `workspace_id null` sees every workspace of its org). Every cell is a separate policy; every policy names its roles (never PUBLIC).

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `orgs` | `authenticated`: `org_id = any(agg(all 5 roles))` | ✗ (`create_org` only) | `authenticated`: owner → `name`, `data_residency`; admin → `name` (column grant `update (name, data_residency)` + guard trigger) | ✗ |
| `workspaces` | `authenticated`: `id = any(ws(all 5 roles))` | owner, admin (`kind = 'client'` only) | owner, admin: `name`, `archived_at` | ✗ (archive) |
| `teams` | owner, admin, recruiter, reviewer, hiring_manager of the org | admin | admin: `name` | admin (FK restrict ⇒ only when no membership points at it) |
| `memberships` | own row (`user_id = (select auth.uid())`, any status); owner, admin, recruiter, reviewer: every row of the org (the directory; build-notes' `v_org_directory` is not needed because every column is directory-safe) | owner, admin (status `invited` or `active`) | owner, admin: `roles`, `workspace_id`, `team_id`, `display_name`, `status`, `removed_at` (column grant) + guard trigger | ✗ |
| `audit_log` | owner, admin of the org | ✗ | ✗ | ✗ (+ triggers; TRUNCATE revoked) |
| `platform_staff` | own row (`user_id = (select auth.uid())` and `active`) | ✗ | ✗ | ✗ |
| `staff_access_grants` | owner, admin of the tenant org; the staff member's own grants | ✗ | owner, admin: `revoked_at`, `revoked_by` only (+ guard) | ✗ |
| `idempotency_keys` | `trace_worker` | `trace_worker` | `trace_worker` | `trace_worker` (expired keys) |

`trace_candidate`, `trace_quality_worker`, `trace_integrity_worker`, `anon` and `service_role`: no grant on any table above. Helpers get `EXECUTE` for `authenticated` only (and nothing else). Sequences: none (uuid keys).

---

## 4. Org auth

### 4.1 Supabase Auth configuration (`supabase/config.toml`, mirrored on staging by H8)
`[auth] enable_signup = false`, `enable_anonymous_sign_ins = false`, `minimum_password_length = 12`, `password_requirements = "letters_digits"`, `site_url` / `additional_redirect_urls` = the local recruiter dev origin. `[auth.email] enable_signup = false`, `otp_length = 6`, `otp_expiry = 600`. `[auth.mfa.totp] enroll_enabled = true`, `verify_enabled = true`. `[auth.mfa.phone]` stays off. `check-boundaries` gains an assertion that these keys hold (a config drift test).

### 4.2 Flows (recruiter app)
- **Email OTP:** `signInWithOtp({ email, options: { shouldCreateUser: false } })` → `verifyOtp({ email, token, type: 'email' })`.
- **Password:** `signInWithPassword` → always continues to TOTP (Q8).
- **TOTP:** `mfa.listFactors()`; none and the user needs aal2 → `mfa.enroll({ factorType: 'totp' })` shows the QR (SVG from Supabase, rendered as an `<img>`; no QR library) and the secret for manual entry → `mfa.challengeAndVerify`. Existing factor → challenge + verify.
- **Signed-in shell:** reads `memberships` (own rows) and `orgs` through PostgREST; shows the org name and the caller's roles; "Sign out". If RLS returns no org (aal too low, removed, suspended), the shell shows "No active organisation for this sign-in" and offers TOTP when `aal1`.
- Errors shown to the user are generic ("That code didn't work. Try again."); nothing from the server error text is rendered or logged (logger rules, M0a §9.1).
- CSP `connect-src` adds exactly the origin of `VITE_SUPABASE_URL`; `check-headers` asserts it is present in the recruiter `dist/` and absent from the candidate `dist/` (candidates never call Supabase, Q6).

### 4.3 Packages
- `@supabase/supabase-js` (data access is supabase-js + SQL, ADR-028/Q13) is added by the lead to `apps/recruiter` only, pinned exactly in the pnpm catalog. `check-boundaries` asserts it is not imported by `apps/candidate`, `workers/edge` or `packages/shared`.
- No other runtime dependency. TOTP for tests is computed with WebCrypto (RFC 6238, ~30 lines in `scripts/lib/totp.mjs`, unit-tested against the RFC 6238 SHA-1 vectors).

### 4.4 Operator scripts (`scripts/ops/`, lead-owned)
- `create-org.mjs` (§2.6).
- `create-smoke-user.mjs --env local|staging`: creates (or reuses) the synthetic user `smoke+<env>@example.com` via the Auth admin API, sets a generated password, enrols and verifies a TOTP factor, creates an org `smoke-<env>` with `create-org` and a `recruiter`-only membership. Prints the three values to store as secrets **once, to the terminal only** (never to a file or log), and only for `staging`. Uses the service-role key from the founder's local environment (`SUPABASE_SERVICE_ROLE_KEY`) — never in CI, never in a Worker.

---

## 5. Catalog checks (M0a spec §8.5 rules apply: one fixture per branch, floors only go up)
| ID | Violation query finds… | Branches |
| --- | --- | --- |
| **MT-13** (new) | for every member of `pg_partition_tree('public.audit_log')`: RLS off; a non-owner ACL entry with UPDATE, DELETE, TRUNCATE, INSERT, TRIGGER, REFERENCES or MAINTAIN; no enabled `BEFORE UPDATE OR DELETE` row trigger calling `private.audit_log_append_only()`; no enabled `BEFORE TRUNCATE` statement trigger calling it; or `public.audit_log` missing or not partitioned (the check must not pass vacuously) | `rls_off`, `acl`, `no_row_trigger`, `no_truncate_trigger`, `missing_parent` |
| **MT-14** (new) | a role whose name starts with `trace_` that has `rolbypassrls`, `rolsuper`, `rolcreaterole`, `rolcreatedb`, `rolreplication` or `rolcanlogin`; or `trace_candidate_gateway` with a membership other than `trace_candidate`, or without NOINHERIT; or any role (other than superusers) that is a member of `trace_candidate` besides `trace_candidate_gateway` | `attribute`, `gateway_membership`, `candidate_member` |
| MT-10 | adds `trace_candidate`, `trace_candidate_gateway`, `trace_worker` to the roles that must have no privilege on a materialized view | (existing branch) |
| MT-11 | **E3:** a policy on any relation in a system-list schema (`system_list_policy`) | +1 |
| MT-5d | **E3:** policy hosts are taken from every relation, as trigger hosts are (`system_relation_policy`) | +1 |
| MT-11 | **M0a REVIEW DB-1 (Medium, owner M0b):** a **permissive** policy whose USING or WITH CHECK calls no `auth.*` and no `private.*` function, on a table not on the reference-table list (`no_caller_reference`). Catches the soft-delete shape (`using (deleted_at is null)` as its own permissive policy), which ORs open every org's rows, and an UPDATE WITH CHECK that lets a row move org. Fixture = the soft-delete shape; negative control in `catalog_probe.test.sql` = the same clause as a **restrictive** policy. | +1 (+1 probe) |
| MT-2 | **M0a REVIEW DB-2 (Low, owner M0b):** no valid index on the table (or its partitioned parent) has `org_id` as its first key column (`org_id_not_indexed`) | +1 |
| MT-14 | **M0a REVIEW note (unproven, checked here):** also flags `rolbypassrls` on any non-superuser role outside the Supabase list (`supabase_owner` of MT-9 plus `service_role`), and any membership between `anon`, `authenticated` and `service_role` (`supabase_role_membership`). DC-6 records whether supautils lets `postgres` run `grant service_role to authenticated`. | +2 |

MT-14's `rolcanlogin` rule is **M0b-only**; M2/M3a relax it for named login roles with a spec revision. The `catalog-min-count` floor rises by the new clean checks + branch controls (exact number set at implementation and recorded here).

---

## 6. RLS tests (`supabase/tests/rls_*.test.sql`)
- Each file: `begin; select plan(n); …; select * from finish(); rollback;`. Personas are created inside the transaction as `postgres` (synthetic users `p-<role>@example.test` in `auth.users`, fixed UUIDs), then each case runs as `set local role authenticated` with `set local request.jwt.claims` = `{"sub": …, "aal": …, "amr": [{"method": …}], "role": "authenticated"}` (or `set local role trace_worker` / `trace_candidate` / `anon` / `service_role`).
- **Personas:** org A — `owner_admin` (aal2), `admin` (aal2), `admin_aal1` (privileged at aal1), `recruiter_otp` (aal1, amr otp), `recruiter_pw_aal1` (password, aal1), `reviewer` (aal2), `hm` (hiring manager, otp), `ws_recruiter` (recruiter limited to workspace A2), `removed`, `suspended`; org B — `b_admin` (aal2); plus `staff` (platform_staff with an active grant on org A), `trace_worker`, `trace_candidate`, `anon`, `service_role`.
- **Minimum matrix** (each line ≥ 1 allowed and ≥ 1 denied case; cross-org denial for every table and operation that any org role can perform):

| File | Cases |
| --- | --- |
| `rls_orgs` | S: each of the 5 roles sees own org (allowed) / org B row invisible (denied); aal1 privileged, password-aal1, removed, suspended, staff, anon, candidate see nothing. U: owner name+residency; admin name only (residency denied); recruiter denied; b_admin cannot touch org A. I/D: denied for everyone incl. owner. |
| `rls_workspaces` | S: org-wide member sees all; `ws_recruiter` sees A2 only; org B denied. I: owner/admin `client` allowed, `default` denied, recruiter denied, b_admin into org A denied. U: rename allowed for admin; archive default denied; change `kind` denied. D: denied. |
| `rls_teams` | S allowed for 5 roles / org B denied. I/U/D: admin allowed; recruiter denied; delete of a team with members denied (FK). |
| `rls_memberships` | S: own row (even when removed); directory for owner/admin/recruiter/reviewer; `hm` sees only own row; org B denied. I: admin adds recruiter (allowed); admin adds `org_owner` (denied); owner adds `org_owner` (allowed). U: self role change denied (owner and admin); demote last owner denied; hand-over in one transaction allowed; change `org_id`/`user_id` denied; update after `removed` denied. D: denied for all. |
| `rls_audit_log` | S: owner/admin see org A rows; recruiter/reviewer/hm denied; org B denied. I: denied for authenticated, trace_worker, service_role. **U/D/TRUNCATE denied for every role: authenticated, trace_worker, trace_quality_worker, trace_integrity_worker, trace_candidate, trace_candidate_gateway, service_role, and the owner `postgres`** (`throws_ok … 'P0001'` or `42501`), on the parent and on a specific partition and the default partition. Membership change writes exactly one row with ids only (no `display_name` value in `details`). |
| `rls_staff` | platform_staff: own row allowed / other staff row denied / authenticated non-staff denied. staff_access_grants: tenant owner/admin see grants, b_admin denied, staff sees own; revoke by admin allowed once, second revoke denied, changing `expires_at` denied; insert denied for all app roles; `create_org`/`grant_staff_access` EXECUTE denied for authenticated, service_role, trace_worker. Staff **cannot read org A rows** (orgs, memberships, workspaces) even with an active grant. |
| `rls_idempotency` | trace_worker S/I/U/D allowed; authenticated, service_role, trace_candidate denied on each. |
| `rls_roles` | `trace_quality_worker` USAGE on `quality` only; `trace_integrity_worker` on `integrity` only; `trace_candidate` has no privilege on any M0b table; `trace_candidate_gateway` can `set role trace_candidate`; DC-1 (policy filters without USAGE on `private`). |

Target: ≥ 120 `rls_*` assertions; the floor `supabase/tests/rls-min-count` is set to the real count at the end of BUILD (never below 50).

---

## 7. Acceptance tests
| AT | Exit-gate item / behaviour | How |
| --- | --- | --- |
| AT-B1 | `supabase db reset` rebuilds from zero | `pnpm test:rls` (existing harness, inside `pnpm verify`; CI `rls` repeats it) |
| AT-B2 | ≥ 50 RLS tests, allowed + denied per role incl. cross-org, counted separately from catalog checks | §6 files; harness counts `rls_*` assertions against `rls-min-count` (existing AT-3 mechanism) |
| AT-B3 | Audit log rejects UPDATE/DELETE/TRUNCATE for every role | `rls_audit_log` (every role incl. owner, parent + partitions) + MT-13 clean and its 5 fixtures firing |
| AT-B4 | Org creation is audited and operator-only | `rls_staff` / `rls_orgs` cases on `create_org` + a pgTAP case that `create_org` writes `org.create` with the request id; `scripts/test/ops-create-org.test.mjs` (argument validation, no SQL interpolation, no URL printed) |
| AT-B5 | Roles from tables: a removed/suspended member loses access within the same JWT | `rls_memberships`: same claims, before/after `status = 'suspended'` |
| AT-B6 | AAL rules (§2.2) | `rls_orgs` aal1/password cases |
| AT-B7 | Rule 1: separate worker grants | `rls_roles` + MT-5c clean |
| AT-B8 | Local org sign-in end to end | `scripts/test-auth-local.mjs` (run by the harness after pgTAP, lead-only stack): creates a synthetic user via the local Auth admin API, `create_org`, password sign-in → aal1 sees no org → TOTP enrol/verify (code from `scripts/lib/totp.mjs`) → aal2 sees exactly its org via PostgREST; email-OTP path for a recruiter using the local mail catcher is **not** used (mailpit is excluded from the stack), so OTP is covered by the RLS `amr` cases + unit tests of the app flow |
| AT-B9 | **An org user can sign in on staging** | `deploy-staging` smoke step `smoke-staging-auth`: password + TOTP sign-in for the H9 smoke user over the Auth REST API, then `select` own membership and org via PostgREST returns exactly 1 row each; asserts `GET /auth/v1/settings` reports sign-ups disabled. **Deferred (needs H3–H5, H8, H9; runs at M0b CLOSE).** |
| AT-B10 | **Migrations reach staging from CI only** | M0a's `deploy-staging` job + `check-workflows` (no other job or workflow may run `supabase db push` / hold `SUPABASE_STAGING_DB_URL`; unit-tested). **Deferred part:** the staging run. |
| AT-B11 | Recruiter app flows | Vitest with a fake supabase client: OTP path, password→TOTP path, enrolment shows QR + manual secret, generic errors, sign-out clears sessionStorage, no server error text rendered |
| AT-B12 | CSP/boundaries | `check-headers` (recruiter has the Supabase origin; candidate does not); `check-boundaries` (supabase-js only in recruiter; auth config keys) |
| AT-B13 | db-types current | existing step 6 |

---

## 8. Candidate token spike (build-notes Q6 → ADR-030, Proposed)
- `docs/spikes/m0b-candidate-token/` (excluded from the build; linted and formatted like `scripts/`): `spike.mjs` mints an ES256 token with WebCrypto (`crypto.subtle`, no library), verifies it with the public JWK, then — against the local stack — opens a transaction as `trace_candidate_gateway`'s stand-in (`set local role trace_candidate` from `postgres`), sets `request.jwt.claims` from the verified token, and shows that `trace_candidate` sees zero rows of every M0b table and cannot write any. The README records the commands and output.
- ADR-030 (status **Proposed — implement in M3a**): ES256 Trace key held only by a server worker; edge verifies with the public key; candidates never call PostgREST; gateway login role with NOINHERIT whose only membership is `trace_candidate`; token types per Q7 (lobby / session / portal); the open question for M3a (whether Supabase third-party/asymmetric JWT support makes direct RLS evaluation possible) with the doc links checked at M3a SPEC.

---

## 9. Day-one checks (lead, local stack, before the first M0b checkpoint; results recorded here)
- **DC-1** policy calling a `private` helper filters correctly for `authenticated` with no USAGE on `private` (§2.1).
- **DC-2** installed GoTrue's `aal` and `amr` claim shapes for password, OTP and TOTP sessions (§2.2).
- **DC-3** `create role … nologin` works in a migration locally; hosted check at the first staging push (§2.3).
- **DC-4** `postgres` can create the `auth.sessions` trigger locally; hosted check at the first staging push (§2.5).
- **DC-6** whether supautils lets `postgres` grant `service_role` to `authenticated` or alter `rolbypassrls` on the Supabase roles (M0a REVIEW database note); MT-14 covers both regardless.
- **DC-7** the installed wrangler's `config-schema.json` accepts `observability.head_sampling_rate` and `observability.logs.invocation_logs` (§1.1 item 9c).
- **DC-5** `BEFORE TRUNCATE` triggers fire on a partition truncated directly and on the parent (`truncate public.audit_log` cascades to partitions; each partition's trigger must fire or the parent's must).

---

## 10. Edge cases and failure modes
| Case | Behaviour |
| --- | --- |
| Last owner removes/suspends themselves | Denied (rule 2 + rule 3 of §3.5) |
| Two owners demote each other in one transaction | Deferred constraint trigger refuses at commit (no owner left) |
| Admin escalates a recruiter to owner | Denied (only owners grant `org_owner`) |
| Removed member's JWT still valid | Helpers read `memberships.status` → no rows on the next statement (AT-B5) |
| Privileged user signs in with OTP only (aal1) | Sees no org data; app routes to TOTP |
| Password sign-in by a recruiter without TOTP | Sees no org data; app routes to TOTP enrolment |
| Audit month partition missing | Row lands in the DEFAULT partition; MT-13 covers it |
| `details` carries an email or name | CHECKs can't detect free text; triggers write ids only and `rls_audit_log` asserts the exact `details` keys of each event |
| Staff with an active grant queries tenant tables via PostgREST | Zero rows (no staff read policy in M0b) |
| Grant longer than 4 h, or self-approved | CHECK violation |
| `auth.users` row deleted while a membership references it | FK `restrict` refuses (ids never disappear; rule 4) |
| Supabase Auth upgrade renames `aal`/`amr` | AT-B8 and the RLS amr cases fail loudly |
| Sign-in trigger fails | Sign-in fails (fail closed) |

---

## 11. Streams (AUTOPILOT §2; max 2 writers at once this session; migrations, lockfile, root `package.json`, `scripts/` and `supabase/config.toml` are lead-only)
| Step | Who | Scope | Owns |
| --- | --- | --- | --- |
| B0 | Lead | Day-one checks DC-1..DC-5; migration; `config.toml` auth; db-types; `rls_*` tests written **first** (red), then the migration to green; `rls-min-count` | `supabase/migrations/`, `supabase/tests/`, `supabase/config.toml`, `packages/db-types/` |
| B1 | Lead | MT-13, MT-14, E3 branches + fixtures, manifest, floors; `gen-catalog-tests` | `supabase/catalog-checks/`, `scripts/gen-catalog-tests.mjs` |
| B2 | Writer (Opus) | Recruiter sign-in, TOTP, signed-in shell, tests (AT-B11) | `apps/recruiter/src/**` except lead-only files |
| B3 | Writer (Sonnet) | Candidate token spike + ADR-030 draft | `docs/spikes/m0b-candidate-token/`, `docs/adr/ADR-030*` |
| B5 | Writer (Sonnet) | `@trace/workers-http` extraction (§1.1 item 9b) after the lead creates the package skeleton (`package.json`, tsconfig, Vitest config, lockfile) | `packages/workers-http/src/**`, `workers/*/src/app.ts` and their tests |
| B4 | Lead | Workers Logs settings (item 9c), `supabase-js` dependency, CSP/headers, `check-boundaries`/`check-headers`/`check-workflows` additions, `scripts/lib/totp.mjs`, `scripts/ops/*`, `test-auth-local.mjs`, the staging smoke step, ADR-029 | root/lead files |
Reviews: `database-reviewer` + `security-reviewer` on B0/B1/B4, `security-reviewer` + `spec-reviewer` on B2, `spec-reviewer` on B3. Then the M0b REVIEW in its own pass.

---

## Approval
- Revision 1: pending `spec-reviewer` and `database-reviewer`.
