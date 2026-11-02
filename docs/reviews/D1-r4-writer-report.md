# D1 stream R4 (recruiter and reviewer app) writer report

Branch `d1/r4-recruiter`, based on `d1/integration` at `42fd3e2`. Owned files only: `apps/recruiter/src/**` except
`auth/**` and `error-reporting.test.ts` (read, never edited). Spec: `specs/d1-demo-slice.md` §6, §9, §11. Synthetic data only.

## Screens and files

| Screen (route) | Files |
| --- | --- |
| Shell: nav by role, "no access in this release", api client for the signed-in org | `shell/SignedIn.tsx`, `shell/nav.ts`, `shell/org-info.ts`, `api/runtime.ts` |
| Tests list `/tests` | `authoring/TestsListPage.tsx` |
| Editor `/tests/new`, `/tests/:testId` (+ publish dialog) | `authoring/TestEditorPage.tsx`, `DraftFormView.tsx`, `editor-model.ts`, `editor-actions.ts` |
| Reviewers panel `/tests/:testId/reviewers` (also inside the editor) | `authoring/ReviewersPanel.tsx`, `directory.ts` |
| Invite `/tests/:testId/invite` | `authoring/InvitePage.tsx` |
| Results `/tests/:testId/results` | `review/ResultsPage.tsx` |
| Review queue `/review` | `review/ReviewQueuePage.tsx` |
| Demo outbox `/demo-outbox` (flag only) | `outbox/OutboxPage.tsx`, `outbox/demo-extras.ts` |
| Report page `/reports/:reportId` | `reports/ReportPage.tsx`, `Cards.tsx`, `FlagCard.tsx`, `EvidenceTimeline.tsx`, `StartPhotoPanel.tsx`, `start-photo.ts`, `report-controller.ts`, `labels.ts`, `Report.module.css` |
| Shared | `api/client.ts` (the one door to the api, zod-parsed), `api/endpoints.ts`, `common/poller.ts`, `common/useResource.ts`, `common/messages.ts`, `common/format.ts`, `common/Ui.module.css` |
| Wiring (existing files edited) | `routes.tsx`, `main.tsx` (runtime context), `App.tsx` (link to Tests), `App.module.css` (max width 72rem), `vite-env.d.ts` (two env names) |

## Decisions (spec refs)

- **No DOM in the test runtime.** The app has no jsdom or testing-library and I may not add a dependency. All logic is in pure functions and
  small external stores (`CardPoller`, `StartPhotoController`, `ReportController`); views are pure and tested with `renderToString`; the
  canvas is behind `PhotoDeps` (a fake draws in tests). Polling is tested with fake timers.
- **Rule 1 by construction (§6.1, L-19).** `ReportController` holds three separate pollers. `QualityCardPanel` subscribes only to the quality
  poller, `IntegrityCardPanel` only to the integrity poller; both use the same `CardShell`, so width, height and class names are identical.
  An unreadable or failed answer is the card's "Not available right now. Retrying." state and polling continues (there is no failed state).
  Each card has one `data-headline` element (the score for quality, the band chip for integrity).
- **Rule 6 (§6.3).** Evidence sections render only for `ready`. `not_used_below_cutoff` renders the two sentences and nothing else.
- **Cutoff (L-15).** `setCutoffInput` refuses empty or non-0..100 text, so the field cannot be cleared; `toRequest` and `publishDraft` never
  send a request without a valid cutoff (no request at all, `cutoff_required`). No paste-policy control exists.
- **Start photo (R-13, rule 8).** `view()`: link endpoint, one `fetchImageBytes` (api origin and `/media/` path only, no credentials, no
  Authorization, `referrerPolicy: no-referrer`), canvas with tiled watermark text `role · org · time (IST)`, `data:image/` URL. The media URL
  is a local variable only: not in state, errors, console, or storage. Source guards: no `console.`, no browser storage outside `auth/`,
  `/media/` named only in `api/client.ts`, raw `fetch` only in `main.tsx`.
- **Demo outbox gating (AT-D18).** `routes.tsx` passes `demoOutboxExtras` only when `import.meta.env.VITE_DEMO_OUTBOX === '1'`; the outbox
  path, screen and nav label live only in `outbox/`. Checked: a normal `vite build` of the recruiter has no `demo-outbox`, `Demo outbox` or
  `DemoOutbox` string in `dist/`; a build with `VITE_DEMO_OUTBOX=1` emits an `OutboxPage` chunk. The flag name is my choice (see request 1).
- **Roles for link gating.** The app reads the caller's own memberships (same supabase slice and `MembershipRow` as the sign-in flow) to decide
  which links to show. Staff: Tests (+ Demo outbox when the build has it). Reviewer: Tests and Review queue. Hiring manager only: "You have no
  access in this release." Every request is still decided by the server.
- **Access token.** `auth/**` is read-only and does not expose the token, so `main.tsx` builds a `Runtime` from the same supabase client and
  reads `data.session.access_token` per call (`accessTokenOf` parses it defensively). No change to `auth/**` was needed.
- **Header label.** The spec's "notice hash prefix" is shown as "Consent text hash": AT-D13 forbids the word "notice" as a label.

## Lead requests (nothing outside my files was touched)

1. **CI staging build flag, so the staging recruiter shows the outbox.** Without it the staging build looks like production. Diff:
   - `.github/workflows/ci.yml`, deploy-staging "Build" step env, after `VITE_API_ORIGIN`: add `VITE_DEMO_OUTBOX: '1'`.
   - `scripts/check-workflows.mjs`: add `VITE_DEMO_OUTBOX: '1',` to `BUILD_ONLY_ENV` (after `VITE_API_ORIGIN`) and `'VITE_DEMO_OUTBOX',` to the
     build-only allow-list next to `'VITE_API_ORIGIN'` (about line 824), with its test in `scripts/test/check-workflows.test.mjs`.
2. **`scripts/check-no-demo-outbox.mjs` does not exist yet (AT-D18).** Suggested: after the production-flavour recruiter build (no
   `VITE_DEMO_OUTBOX`), fail if any file under `apps/recruiter/dist` matches `/demo-outbox|Demo outbox|DemoOutbox|DEMO_OUTBOX/i`, with a negative
   control built with `VITE_DEMO_OUTBOX=1`. I ran this check by hand (see above) and it passes.
3. **Rule table for "How the band is set" (§6.1).** `@trace/band-engine` is not a dependency of `apps/recruiter` (I may not edit `package.json`), and
   the integrity card carries only `ruleTableVersion` and `engineVersion`. The disclosure therefore shows the version, engine and the fixed
   rules statements; it does not list families, severities and thresholds. To show the table: add `"@trace/band-engine": "workspace:*"` to
   `apps/recruiter/package.json` dependencies (and the `check-boundaries` element rule allowing recruiter -> band-engine, plus the lockfile);
   then I render `rules/d1-v1.json` for the card's `ruleTableVersion` (a one-component change in `reports/Cards.tsx`).
4. **Bundle size.** The recruiter initial JS is 349 kB gzip (zod, supabase-js and Sentry dominate; `check-bundle-size` has no budget for it
   yet). A `build.rolldownOptions` code split would need `vite.config.ts`; not requested, just noted.

## Tests

`pnpm typecheck`, `pnpm lint`, `pnpm build` clean in `apps/recruiter`; `pnpm test`: 24 files, **325 passed** (207 existed before R4, 118 new).
New files and counts: `api/client.test.ts` 8, `common/poller.test.ts` 7, `reports/ReportPage.test.tsx` 11 (AT-D3, D14, D17),
`reports/FlagCard.test.tsx` 8 (AT-D19), `reports/start-photo.test.ts` 10 (AT-D10 recruiter half), `review/Results.test.tsx` 5,
`outbox/OutboxPage.test.tsx` 2, `shell/shell.test.tsx` 8, `authoring/editor-model.test.ts` 11, `editor-actions.test.ts` 5,
`TestEditor.test.tsx` 5, `ReviewersPanel.test.tsx` 6, `Invite.test.tsx` 10, `d1-guards.test.tsx` 12 (AT-D13),
`d1-source-guards.test.ts` 10 (AT-D13, D18). The existing `recruiter-guards`, `security-hygiene` (no inline style, CSP) and `error-reporting`
tests still pass. Root checks: `node scripts/check-headers.mjs` passes for the recruiter (its only violation is the candidate app's
unbuilt `dist/_headers`); `node scripts/check-bundle-size.mjs` reports the recruiter (information only, candidate not built);
`check-no-demo-outbox.mjs` does not exist (request 2). Not run: root `pnpm verify`, supabase, db, e2e.

## Open questions and ambiguities (the conservative reading was implemented)

- **Nav "Reports" for staff.** There is no org-wide report list endpoint except the reviewer's `/review`, so staff reach reports from each test's
  results page; the nav shows "Tests" and, for reviewers, "Review queue" (no "Reports" item). Confirm.
- **Results "status" column (§6.1).** `ResultRow` has no status field, so the table has Candidate, Answer Quality, Submitted and Report; the
  state is shown in the Answer Quality cell ("Scoring..." or the score, with "Below cutoff" as plain text).
- **"Only one number in each card" (AT-D3).** Read as one headline value per card (score; band chip). The quality card also shows its section
  bars with their section scores, and the integrity card shows evidence strength and coverage %, all as §6.1 lists them.
- **Flag tier note.** `family === 'input_origin'` (rule `D1-UNTRUSTED-INPUT`) shows "Untrusted input, hard evidence"; every other T3 flag shows
  "Client-reported (T3), can reach Review only"; T1 and T2 get their own plain notes.
- **Reviewer role needs aal2 for the report and queue endpoints** (`aal2_required`). The app shows a fixed "two-step sign-in is needed" text; it does
  not start a step-up itself.
- **Invite page** also lists the test's invitations (label and status only); revoke is not in the D1 screens and is not offered.
