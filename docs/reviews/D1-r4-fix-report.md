# D1 R4 fix report (recruiter app)

Branch `d1/r4-fixes`, from `c0b2dab` (tip of `d1/r4-recruiter`) plus the lead's merge `b86829d`.
All paths below are under `apps/recruiter/src/`. Package checks after the last commit: typecheck, lint, build clean;
vitest 27 files, 354 tests passed.

| # | Finding | Commit | Tests | What the tests prove |
|---|---------|--------|-------|----------------------|
| 1 | "How the band is set" shows the bundled rule table | `3ff806a` | `reports/RuleTable.test.tsx` (6 tests) | Rows of `@trace/band-engine/rules/d1-v1.json` (id, kinds, family, tier, severity, Validated or Context only) appear for a `ready` card whose `ruleTableVersion` matches; the families, coverage floor (70%) and photo factor (75%) are shown; a mismatched version shows "Rule table not available in this build" with both version strings and no table at all; pending, below-cutoff, loading and unavailable cards show no rule rows. Code: `reports/rule-table.ts`, `reports/Cards.tsx`. |
| 2 | AT-D19 flag cards show `signalSeqs` | `28a0c3f` | `reports/FlagCard.test.tsx` "shows every signal sequence number of every flag as evidence" | Every `signalSeqs` value of every fixture flag appears as `#n` in an "Events" row (fails on the old card, passes on the new one). The existing AT-D19 test keeps asserting `atMs`, `ruleId`, observed and tier. |
| 3 | Terminal errors end the report page | `1ba1412` | `common/poller.test.ts` (2 new), `reports/ReportPage.test.tsx` "ReportPage terminal errors" (3 + 3 tests) | A terminal code (`not_found`, `aal2_required`, `unauthorized`) on the header call shows `errorText(code)` in the header, not "Loading...", hides the cards, and with fake timers no call is made in the next 300 s (3 calls in total). A transient header failure keeps retrying and the cards keep polling. A card that gets a 404 shows "Not available right now", never a failed state. |
| 4 | Editor for staff only | `4e0c134` | `authoring/staff-gate.test.tsx` (8 tests) | A reviewer gets no "Edit"/"Open" link (Results stays), the editor route shows the no-access text with no form, and `testDetailLoader` returns null so no detail request exists; staff (owner, admin, recruiter) get the loader and the request path. 4 of 8 fail on the old code. |
| 5 | AT-D13 coverage | `c634290` | `d1-guards.test.tsx` (screens 26 to 39; new coverage test) | Now rendered and checked for forbidden words, combined numbers, bands, selection, export, never-build words, inline styles: `EditorBody` (draft and published), `NewTestRoute`, the invitations table (and empty), the invite error, every fixed error text, quality/integrity cards in loading, unavailable and slow states, the start photo idle/working/shown/error(aal2, generic)/missing, a `band: 'clear'` report and the terminal not-found report. The outside-the-card check now uses every `BAND_LABEL` (incl. `\bClear\b`) plus "band", with negative controls. |
| 6 | AT-D3 one card pending leaves the other unchanged | `3822d1d` | `reports/ReportPage.test.tsx` "one card pending or unavailable leaves the other card exactly as in the all-ready page" | Four directions (quality pending, integrity pending, quality unavailable, integrity unavailable): the other card's opening tag and text equal the all-ready baseline. |
| 7 | Demo outbox gate needs both conditions | `93d0518` | `demo-gate.test.ts` (3 tests), `d1-source-guards.test.ts` (updated) | The real route table is rebuilt under the four combinations of `VITE_DEMO_OUTBOX` and `VITE_TRACE_ENV`: the route exists only for flag `1` and a `VITE_TRACE_ENV` other than `production`. The source guard pins the inline condition `VITE_DEMO_OUTBOX === '1' && VITE_TRACE_ENV !== 'production' ? demoOutboxExtras : null` and that both variables are read only in `routes.tsx` and typed in `vite-env.d.ts`. |

## Build checks

- Plain `pnpm build` in `apps/recruiter`, then `node scripts/check-no-demo-outbox.mjs`: `OK`.
- `VITE_DEMO_OUTBOX=1` for build and check: `skipped (a VITE_DEMO_OUTBOX=1 demo build)`; the build contains
  `dist/assets/OutboxPage-*.js` and `demo-outbox` in the entry chunk.
- Extra, not required: `VITE_DEMO_OUTBOX=1 VITE_TRACE_ENV=production` produces no `OutboxPage` chunk.

## Notes and things not done

- Finding 7: the gate is written inline in `routes.tsx`, not as a helper function. A first try with a helper
  `demoOutboxEnabled(flag, env)` kept the outbox in a production-flavour bundle (the bundler does not fold the call),
  which `check-no-demo-outbox` caught. The test therefore exercises the real route table under stubbed env values.
- In an `VITE_DEMO_OUTBOX=1` + `VITE_TRACE_ENV=production` build the entry chunk still contains the key name
  `VITE_DEMO_OUTBOX` inside an `import.meta.env` object that another module (not owned by R4: Sentry/env wiring)
  reads whole. The checker skips any build with the flag set, so it is not flagged; the outbox route, page and labels
  are gone. Not changed (outside my files).
- Finding 3: when the header is terminal the cards are not drawn at all (instead of "Loading..." forever). Card
  pollers have no terminal state of their own, by design (a card never fails for readiness).
- Finding 4 changes the UX for a reviewer only; the api side is the lead's.
- Test-first: findings 5 and 6 add coverage for behaviour that was already correct, so those tests pass on first run
  (finding 5 adds a count/name check that fails without the new screens). For 1 to 4 and 7 the tests were seen failing
  before the fix, except finding 1 where the rule-table test was run red first and findings 2 and 4 were re-run against
  the old source to confirm they fail.
- Small refactors needed for testability: `EditorBody` and `InvitationsView` are now exported.
