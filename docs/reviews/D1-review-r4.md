# D1 stream R4 (recruiter and reviewer app): reviews and dispositions

Chat C, 2026-10-19. Writer: Sonnet, branch `d1/r4-recruiter` (`42fd3e2..c0b2dab`, 6 commits, 54 files; report
`docs/reviews/D1-r4-writer-report.md`; `apps/recruiter` 24 files / 325 tests). Reviews (Opus, read-only, on
`42fd3e2..c0b2dab`): spec-reviewer **PASS WITH FIXES**, security-reviewer **BLOCK** (one Medium, fixed below). No
breach of rules 1–9 was found by either.

## Findings and dispositions
| # | Source | Sev | Finding | Disposition |
| --- | --- | --- | --- | --- |
| SEC-1 | security | Medium | The shared Sentry breadcrumb scrubber kept the `/media/<jti>` path of the new start-photo fetch (R3-6) | **Fixed (lead)** `b86829d`: breadcrumbs naming `/media/` dropped, media `request.url` omitted; tests in `packages/shared/src/log/sentry-scrub.test.ts` and a real-SDK test in `apps/recruiter/src/error-reporting.test.ts` |
| SEC-2 | security | Low | Outbox gate `VITE_DEMO_OUTBOX` differs from spec §7.1 `VITE_TRACE_ENV`; the CI check did not exist | **Fix now:** both conditions (R4 fix writer); check `e8c62a7` (lead); spec rev 4f |
| SR-1 | spec | Medium | "How the band is set" shows versions only, not the bundled rule table (§6.1) | **Fix now:** dependency `a4a37b4` (lead), rendering by the R4 fix writer |
| SR-2 | spec | Medium | Flag cards omit `signalSeqs` (AT-D19) | **Fix now** (R4 fix writer) |
| SR-3 | spec | Low | Terminal errors (`not_found`, `aal2_required`) poll forever with "Loading..." | **Fix now** (R4 fix writer) |
| SR-4 | spec | Low | Reviewer gets the editor link; api GET `/tests/:testId` has no role check (answer keys) | **Fix now:** api `e38bb55` (lead, test first); UI by the R4 fix writer |
| SR-5 | spec | Low | AT-D13 guard test misses several states and the `clear` band | **Fix now** (R4 fix writer) |
| SR-6 | spec | Low | AT-D3 "one card pending leaves the other unchanged" not compared with a baseline | **Fix now** (R4 fix writer) |
| SR-7 | spec | Note | AT-D18 check and the staging flag missing | **Fixed (lead)** `e8c62a7` |
| SR-8 | spec | Note | Same as SEC-1 | **Fixed** `b86829d` |

Writer lead requests: 1 (staging flag) and 2 (check script) done in `e8c62a7`; 3 (band-engine dependency) done in
`a4a37b4`; 4 (bundle size 349 kB gzip, recruiter has no budget) noted only. Writer open questions: all accepted as
the spec reviewer recommended (spec revision 4f).

## Fix round
Sonnet fix writer on `d1/r4-fixes` (`c0b2dab` + merge of `b86829d`, tip `e9497e5`; report
`docs/reviews/D1-r4-fix-report.md`; `apps/recruiter` 27 files / 354 tests): SR-1 `3ff806a` (bundled `d1-v1` rule
table for a `ready` card with a matching `ruleTableVersion`, fallback text otherwise), SR-2 `28a0c3f`, SR-3 `1ba1412`
(terminal header errors stop all three pollers), SR-4 UI `4e0c134`, SR-5 `c634290`, SR-6 `3822d1d`, SEC-2 `93d0518`
(the gate is inline in `routes.tsx`: a helper defeated tree-shaking and `check-no-demo-outbox` caught it).

**Sonnet confirming re-review: CONFIRMED WITH NOTES** (every assigned finding fixed with a test that fails on revert;
SR-5 and SR-6 add coverage of behaviour that was already right and are meaningful guards; no new defect; rules 1, 2,
6, 7, 8 hold). Notes and lead dispositions:
1. Low: the `VITE_DEMO_OUTBOX=1` + `VITE_TRACE_ENV=production` arm has no automated bundle check (the script skips
   any flagged build; `main.tsx:19,26` pass the whole `import.meta.env`, so a flagged build's entry chunk names the
   key). Only public `VITE_*` values reach the bundle. **Carried to Chat E** (before the first staging dispatch):
   `main.tsx` passes only the fields it needs, and the check skips only when `VITE_TRACE_ENV !== 'production'`.
   **Closed** in Chat E (stream W2, spec rev 4k), with a stricter rule: the outbox needs `VITE_TRACE_ENV` exactly
   `dev` or `staging` (docs/reviews/D1-review-chat-e.md).
2. Low: `unauthorized` is terminal on the report page (a session refresh needs a reload). **Accepted** (matches the
   finding's intent and the text shown).
3. Info: `VITE_TRACE_ENV` is set by no workflow; the flag's absence is the primary guard. **Accepted** (rev 4f).
