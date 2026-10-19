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
(filled in after the fix writer and the confirming re-review)
