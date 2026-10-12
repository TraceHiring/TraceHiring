# M0b BUILD reviews — B5, B0/B1 and the B4 pieces on `m0b/b0-db` (2026-10-12)

Spec: `specs/m0b-tenancy.md` revision 5. Reviewers ran read-only; DB probes only in rolled-back transactions.

## B5 `@trace/workers-http` (merged into `m0b/integration`)
- Sonnet spec-reviewer: PASS WITH FINDINGS (B5-SP1, B5-SP2 Low). Sonnet security-reviewer: PASS WITH FINDINGS (B5-SEC1 Medium, B5-SEC2, B5-SEC3 Low).
- All fixed test-first on `m0b/b5-fixes` (`1347532` 4xx-only HTTPException answers with no-store and no set-cookie, other statuses logged/reported as failures; `fc07cd8` edge passes only its sink; `a4dc4c2` log line asserted after a throwing reporter; `9f639d8` stale comment). Lead checked the diff; merged.

## B0/B1/B4 on `m0b/b0-db`
| Reviewer | Verdict |
| --- | --- |
| database-reviewer (Opus) | CHANGES REQUIRED: 2 Medium, 5 Low |
| security-reviewer (Sonnet) | PASS WITH FINDINGS: 1 Medium, 7 Low |
| spec-reviewer (Sonnet, on `4ba26ec..729d08d`; ops scripts not in its range) | PASS WITH FINDINGS: 1 Medium, 6 Low |

| ID | Sev | Finding | Status |
| --- | --- | --- | --- |
| B0-DB1 | Medium | `memberships_update_own` let a non-counting membership (aal1 privileged, password aal1, suspended, suspended org) edit its own `display_name` | **Fixed** (policy needs `my_org_ids(all 5)`; 4 denied cases in `rls_memberships`, seen failing first) |
| B0-DB2 | Medium | write-skew lock taken after the guard's role checks (READ COMMITTED) | **Fixed** (lock first, INSERT and UPDATE); no two-session test yet — add a manual or scripted concurrency check |
| B0-DB3 | Low | archive+rename or remove+role change in one UPDATE audits only one event | Open |
| B0-DB4 | Low | MT-13 counts a `WHEN (false)` / `UPDATE OF col` trigger as the append-only trigger | Open (add `tgqual is null and tgattr = '{}'` + fixture) |
| B0-DB5 | Low | MT-11 `no_caller_reference` accepts any `auth.*`/`private.*` call, even caller-independent ones | Open (needs a spec §5 wording change) |
| B0-DB6 | Low | MT-2 `org_id_not_indexed` accepts a partial index | Open (add `ix.indpred is null`) |
| B0-DB7 | Low | `grant_staff_access` does not check staff/approver `active` or `capabilities` | Open |
| B0-SEC1 | Medium | operator DB URL could connect without TLS | **Fixed** (`PGSSLMODE=require` for non-local; weak `sslmode` refused; test first) |
| B0-SEC2 | Low | docker fallback runs locally when `TRACE_OPERATOR_DB_URL` is a loopback tunnel | Open (fallback only when the URL came from the local stack) |
| B0-SEC3 | Low | `supabase status` child inherits SMOKE_PASSWORD etc. | Open (scrub env there too) |
| B0-SEC4 | Low | smoke session not logged out; no session timebox/inactivity | Open (logout; timebox → founder H8 note) |
| B0-SEC5 | Low | auth keys not pinned: `sms.enable_signup`, `max_frequency` "1s", redirect URLs | Open |
| B0-SEC6 | Low | rule 3 name-only exemption; rule 10 misses transitive packages | Open |
| B0-SEC7 | Low | `audit_details_ok` checks keys, not values | Open |
| B0-SP1 | Medium | no recorded evidence for AT-B1/DC-3 "db reset twice" and DC-10 | **Resolved by record:** the lead ran `supabase db reset --local` 6 times in a row of sessions on 2026-10-12 with the roles already present (all exit 0) plus `pnpm db:types` and `pnpm test:rls` (each resets); DC-10: gen types lists `audit_log_default` + 15 `audit_log_2026_10…2027_12` as tables. Spec §9 rows to be updated in revision 6 |
| B0-SP2 | Low | own-row update ignores aal/status | Same as B0-DB1, **fixed** |
| B0-SP3 | Low | sign-in triggers skip suspended orgs (`o.status = 'active'`) — not in §2.5 | Open (spec sentence + test, or drop the filter) |
| B0-SP4 | Low | contracts at `@trace/shared/contracts/tenancy`, spec says `@trace/shared/contracts` | Open (spec revision 6 note; B2 imports the subpath) |
| B0-SP5 | Low | strict `MembershipRow`/`OrgRow` fail on extra PostgREST columns | Open (B2 brief: select exactly the §4.5 columns; extra-column test) |
| B0-SP6 | Low | catalog floor 133 not recorded in spec §5; comma vs `;` | Open (revision 6) |
| B0-SP7 | Low | small coverage gaps (gateway `set role` not executed; owner revoke; admin slug/kind; EXECUTE cases could pass on schema denial) | Open |
| B0-SEC8 | Low | `SUPABASE_STAGING_URL` not pinned to the staging project ref | Open |

Also found during BUILD and fixed: the `text[] || 'name'` audit-trigger bug (found by the rls_* tests), the plain-node import break of `contracts.ts` (found by the ops writer), and the M0a db-types test asserting no tables (found by full verify).
