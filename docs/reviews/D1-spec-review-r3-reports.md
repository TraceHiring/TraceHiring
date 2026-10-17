# D1 spec review: stream R3 api, reports half

- Date: 2026-10-18. Reviewer: spec-reviewer agent (Opus, fresh context), read-only.
- Scope: `git diff 6ffe4e1 d1/r3-merge` over `services/api/src/modules/{reports,report-quality,report-integrity}`,
  `services/api/src/app.ts`, `services/api/src/log-hygiene.test.ts` at `9c8db45` (writer R3b commits f492580, 728030c,
  6070bc8, c92d80b, 7f6965c; lead 9c8db45).
- Against: spec `specs/d1-demo-slice.md` §6.2, §6.3, §3.2/§3.3, §9 AT-D3, AT-D13, AT-D14, AT-D15 (api), AT-D17,
  AT-D32 (api), §11 R3 row; CLAUDE.md rules 1-9.

## Verdict: PASS WITH FIXES

Rules 1, 2, 5 and 6 hold for the reports half. Twelve test files run alone in workerd, all green (projection 9,
integrity-dto 10, integrity readiness 11, integrity rule1 4, quality-dto 9, quality readiness 8, quality rule1 4,
results 9, report-meta 8, reports rule1 4, mount 2, log-hygiene 9).

## Findings and their state

| # | Severity | Finding | State |
| --- | --- | --- | --- |
| 1 | Medium-High | `createOrgDeps()` defaults to the bare global `fetch`, which org-context then calls as `opts.fetch(...)` (`org-context.ts:163`, `:276`): in workerd a host method called with another `this` throws "Illegal invocation", so on the production mount every org route would answer 503. Tests inject their own fetcher, so none reached it. | **Fixed at the mount** (lead, `app.ts`: `createOrgDeps((input, init) => fetch(input, init))`). Still due: the same fix in `createOrgDeps`' default (org-context belongs to the r3a2 writer) and a workerd test of the default path. |
| 2 | Medium | `services/api/src/route-inventory.test.ts` (AT-D13) missing. | Due with the full mount once r3a2 lands (lead draft ready). |
| 3 | Low | report-quality also reads `sections` (section names), report-meta reads `tests` (`testName`); §6.2 lists fewer tables. Forced by the contracts, no integrity data. | Lead: amend the §6.2 sentence. |
| 4 | Low | Read caps cut silently: timeline `MAX_ENTRIES = 500` builds flags and reasons from a cut list as `ready`; results take the 500 newest then sort by score; the review queue slices before the time sort. | Due before merge: fail closed (`unavailable`) at the cap for the integrity timeline; document or fix the list caps (pagination is M2). |
| 5 | Info | AT-D32 api half plants values only in the report routes and CandidateRpc; `/media/:jti`, invitations and the outbox are not covered yet. | Extend `log-hygiene.test.ts` when r3a2 lands. |
| 6 | Info | Test-first order not visible (tests and code in the same commits). | Noted. |

Checked and correct: the neutral reports module imports no card module and selects no integrity table; the card
modules import only their own folder and their own contract types; the ESLint wall covers both; the cohort test bites
(an added key fails the strict contract); the integrity route reads only `meets_cutoff` from `quality_cards`, reads no
integrity row below the cutoff, requires `review_state = reviewed` in the query and in the projection; `pending` and
`not_used_below_cutoff` carry only `state`; 404 for malformed, other-org and hidden ids with constant bodies; `org_id`
on every select; strict parsing of rows and answers; the review queue checks aal2 before any DB call; no log calls and
no service key in the three modules.
