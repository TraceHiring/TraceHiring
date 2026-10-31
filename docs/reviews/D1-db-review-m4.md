# D1 migration 4 — database review (2026-10-14)

- **Reviewed:** `f6a0144`: `supabase/migrations/20261014175327_d1_media_audit.sql`, `supabase/tests/rls_d1_media_view.test.sql` (48 assertions), the `rls_roles` allow-list, `rls-min-count`, `AUDIT_ACTIONS` / `AuditDetails`; skimmed `26cd6eb` (m3 items m-7a, m-7b, n-1 and spec §5.1). Against spec `specs/d1-demo-slice.md` §3.1 row 4, §3.4, §3.6, L-2, L-25, L-26, R-7, R-15, §4.5, §6.2, AT-D10 and CLAUDE.md rules 1-9.
- **Reviewer:** Opus `database-reviewer` agent; read-only, rolled-back repros on the test fixtures; MT-5a/5b/6/7/8 read-only with no violations.
- **Fixes:** lead, test-first, together with `docs/reviews/D1-security-review-m4.md` (same day).

## Verdict: APPROVE WITH MINOR FIXES (0 Blocker, 0 Major, 4 minor, 8 notes)
- **Rule 1:** no break (the functions read `media_objects`, `orgs`, `memberships`, `assignments` and write `audit_log` through `private.audit`).
- **Rule 8:** no break in the database part; one row per granted call, none for a refusal, the viewer as actor (L-26).
- **Tenancy:** no break. Edge cases re-run and correct: removed, removed then re-added, suspended, suspended org, assigned role dropped, `{recruiter,reviewer}` at aal1 OTP (denied, as M0b), `magiclink` at aal1 (allowed), null aal/amr, unknown media.
- **Hygiene:** owner `postgres`, DEFINER, `search_path = ''`, ACLs exactly `{postgres, trace_api}` on the grants and owner-only on the check; volatility right. One refusal message for every case: agreed.

## Findings and disposition
| ID | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| m-1 | minor | The held-role predicate `a.as_role = any (m.roles)` had no test (deleting it left 48/48 green) | **Fixed:** a member demoted to `{recruiter}` with an `admin` assignment is denied at fetch |
| m-2 | minor | AT-D10 asks for "membership **removed** between issue and fetch"; only suspension was tested; removed then re-added not covered | **Fixed:** removed between issue and fetch, and re-added as a new active membership, both denied |
| m-3 | minor | "No audit row, no key" holds only inside the caller's transaction | **Fixed:** header reworded; spec §6.2 R3-2 (one transaction per grant, link or bytes only after COMMIT) and R3-9 (injected COMMIT failure → no bytes) |
| m-4 | minor | `link_id` is `z.uuid()` (RFC version/variant bits) while the spec said "random 128-bit jti" | **Fixed:** spec pins `jti = crypto.randomUUID()` (§4.5, §6.2 R3-4); contract test: a v4 id passes, a non-RFC 128-bit id fails |
| n-1 | note | `trace.api_org_id` is not read; reviewer suggests keeping that | **Overruled by security review F3:** the check now requires `mo.org_id = private.api_org_id()` (the §3.4 invariant "unset ⇒ trace_api sees nothing"); unset and other-org tests added |
| n-2 | note | `ttl_seconds` hard-coded 300 while the api spec said `exp <= now + 300` | **Fixed in spec:** `exp` = issue time + 300 s exactly (R3-4) |
| n-3 | note | `media_view_grant` not tied to a prior `media.link_issued` (optional defence) | **Fixed** (security F2): issued to this viewer for this media within 330 s, never viewed, per-link advisory lock; reused link ids refused at issue |
| n-4 | note | Missing positive controls (admin and OTP recruiter keys, reviewer through `link_grant`, fence control) and suspended org | **Fixed:** every allowed role now issues and fetches; the password recruiter is allowed at aal2 before the narrowing; suspended org denied |
| n-5 | note | No `FOR SHARE` on the membership row; a removal racing the audit insert grants that one fetch | Keep |
| n-6 | note | Multi-role memberships use all roles for the aal rule | Keep; one sentence added to the §3.4 row |
| n-7 | note | The `r2_key` is derivable | Keep (security F1, R3-3: the key is never treated as a capability) |
| n-8 | note | `26cd6eb` is correct (m-7a, m-7b, n-1, §5.1) | None |

## After the fixes
`rls_d1_media_view`: 73 assertions. The new F2/F3 cases ran red against the reviewed functions (11 failures) and green after the change.
