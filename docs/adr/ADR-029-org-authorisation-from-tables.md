# ADR-029: Org authorisation from tables, not JWT claims; worker-only tables

- **Status:** Accepted (2026-10-12). Records build-notes Q3 (accepted) as decided in `specs/m0b-tenancy.md` §2.1–§2.2, §2.8 and §3.8 (approved revision 5).
- **Source:** `docs/build-notes.md` §0 Q3, Q8, Q12 and §4 "M0 — Foundations"; spec §2.1 (DC-1), §2.2, §2.8, §3.8 (D6), §3.9.

## Context
RLS needs to know, for every statement, which orgs and roles the caller holds. Supabase's common pattern copies roles into JWT custom claims through an auth hook. A claim lives as long as the token (up to an hour after a refresh), so a removed or suspended member, or a member of a suspended org, keeps access until the token expires. Trace's integrity decisions are high-stakes (CLAUDE.md rules 2 and 4), and a reviewer who has been removed must stop seeing evidence at once.

Some tables are not tenant data at all but server bookkeeping (M0b: `idempotency_keys`, the exactly-once ledger). No app role should touch them, yet CLAUDE.md requires RLS on every table and separate policies per operation.

## Decision
1. **Roles come from tables.** RLS resolves the caller's orgs through `private` `STABLE SECURITY DEFINER` helpers (`private.my_org_ids(org_role[])`, `private.my_workspace_ids(org_role[])`, `search_path = ''`) that read `memberships` and `orgs` on every statement. Only `active` memberships in `active` orgs count. The JWT is used only for `sub` (`auth.uid()`), `aal` and `amr`.
2. **Policy form** (DC-1): `org_id = any ((select private.my_org_ids('{…}'))::uuid[])` — the helper is evaluated once per statement as an init plan. `authenticated` gets EXECUTE on the two helpers and on `private.valid_roles` only, and no USAGE on schema `private` (policies store function OIDs).
3. **Assurance level in the database** (Q8): a membership with `org_owner`, `admin` or `reviewer` counts only at `aal2`; a membership with only `recruiter`/`hiring_manager` counts at `aal1` only after an email-OTP first factor. A person always sees their own membership rows, so the app can route them to TOTP.
4. **Writes are guarded by triggers**, all `SECURITY DEFINER` in `private`. The caller is identified by `auth.uid()`; the operator path is exactly `session_user = 'postgres'`, role setting `none`/`postgres` and no JWT (`private.is_operator()`), never by the effective user, which is always the owner inside a definer.
5. **Worker-only tables.** A table that no app role may touch has grants and policies for worker roles only (`trace_worker` in M0b). Its policies may be literally `true`, because the grant is the boundary; the table is listed on MT-11's reference-table list citing this ADR. MT-4 shows no app-role grant, and the `rls_*` denied cases (`authenticated`, `service_role`, `trace_candidate`, `anon`) prove it.

## Rejected alternatives, and why
- **Roles in JWT custom claims (auth hook):** stale for the token's lifetime; a removed reviewer could keep reading evidence. Also needs a hook function exposed to `supabase_auth_admin`.
- **An `active_org_id` claim hint** (allowed by Q3): not needed, because the helpers return every org the caller may see; the app's org picker filters the UI only (spec §2.1, logged under build-notes "Autopilot changes").
- **Invoker helpers:** an invoker policy helper that reads `memberships` would recurse into `memberships`' own RLS and would need USAGE on `private`.
- **Service-role access for worker tables:** `service_role` has BYPASSRLS; CLAUDE.md keeps it out of anything that serves candidates, and a named NOLOGIN role with explicit grants is narrower.

## Consequences
- Every policy calls a helper that runs a small indexed query (`memberships (user_id) include (…)`), once per statement as an init plan (not yet measured at load; M1 measures it with real query plans).
- Revocation is immediate: AT-B5 proves a removed or suspended member, or a suspended org, loses access under the same JWT.
- GoTrue's `aal`/`amr` claim shapes are a dependency; AT-B8 pins them on real sessions.
- Login roles that Workers use from M2/M3a must `SET LOCAL ROLE` to their NOLOGIN role; MT-14 `login_dml` keeps DML away from login roles so the operator predicate stays sound.
