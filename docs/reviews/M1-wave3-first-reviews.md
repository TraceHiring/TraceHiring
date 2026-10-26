# M1 BUILD 4 = Wave 3 — first reviews (2026-10-26)

Read-only Opus reviewers; findings summarised by the lead. Decisions: spec `specs/m1-test-authoring.md` R5-67, R5-68.

## A7 candidate app v2 (`c439617..b89e2ea`, branch `m1/a7-candidate`)
**Spec review: PASS WITH FIXES.** No rule 1-9 breach (rules 5, 7, 8 checked).
1. Medium — v1 sessions and MCQ-only tests are promised a per-section paste rule they never see (`copy.ts:118`). → R5-68 a.
2. Medium — the section transition gives up after three flush rounds and `stop()` drops queued signals
   (`useSectionTransition.ts:55`, `:93`; SR-4). → R5-68 b.
3. Medium — refused seqs lost on the 409 gap path and on a resend after a lost ack (`session-core.ts` `#accept`
   skips `seq <= hw`). → R5-67 (edge + contract, lead, `51a1077`..`6a07a60`); A7 side R5-68 e.
4. Medium — never-build skipped every directory named `test`, so `apps/candidate/src/test/**` was never scanned.
   → lead fix `b7695ee` (red) → `ecb53c0`.
5. Medium — every image failure is final, also network/429/503 (`media.ts:51`, `ItemImages.tsx:24`). → R5-68 c.
6. Low — forward-only: item N stays editable while N+1 is being requested; those edits are refused and reverted.
   → R5-68 d.
7. Low — test gaps: closed written textarea, v1 screen paste, flush path. → R5-68 i.
8. Info — 410 for a passed forward-only position costs one attach (heals); `attachLoop` retries `bad_request` and
   `not_eligible` for ever (→ R5-68 g); held signals take the `t` of the new stream (→ R5-68 b).
Writer choices: all accepted (R5-68 h); `afterSeq` = acked seq after flush accepted as a reading of R5-66 f (R5-68 f).
AT-M1-32 clauses, AT-M1-19 (A7 side), R5-20, R5-45, R5-59 d-e, R5-66 a-g, §4.6 states, contract guards and the
session store checked clean.

**Security review: PASS WITH FIXES.** Rules 5 and 8 touched and hold; nothing new leaves the device.
1. Medium — a signal raised during a section transition can be dropped (same as spec #2). → R5-68 b.
2. Medium — refused seqs lost on a resend after a lost ack, and on the gap path (same as spec #3). → R5-67, R5-68 e.
3. Low — a temporary image failure hides the image for good (same as spec #5). → R5-68 c.
4. Low — v1 sessions show no paste rule (writer question; supports the one-line proposal) (same as spec #1). Also:
   "Paste and drop attempts are recorded" whatever `captureSignals` says: overstates, never under-discloses. → R5-68 a.
5. Info — `afterSeq` choice acceptable; retry caps bounded; extra attaches converge; `out_of_order` on events
   cannot spin; other choices no objection.
Image types (allow-list from Content-Type, 1 MiB by length and streaming cap, SHA-256 re-checked, `data:` only, never
stored), fetch scope (edge origin only, `credentials: 'omit'`, `redirect: 'error'`), session token (Bearer only,
sessionStorage as D1), XSS (React text only), outbox validation and error copy checked clean.

## A7 fix round 1 (`209805f..177003a`, branch `m1/a7-fix-1`) — Opus confirming re-review (spec + security)
**Spec: NOT CONFIRMED. Security: CONFIRMED WITH NOTES.** R5-68 a, b, c, e, f, g, i fixed and tested; no rule 1-9 breach.
1. Medium (regression from R5-68 d) — positions whose GET was only sent count as served, so forward-only navigation
   reaches N+2 while N+1 is loading or failed; the DO then serves N+2 and the candidate skips an item they never saw
   (`Test.tsx:129-132`, `:304`; `sections.ts:79-84`). → fix round 2: sent GETs only make N read-only.
2. Low — a batch that failed in flight is handed over although the edge may have stored it: its signals can be
   stored twice (bounded, same `t`). → fix round 2: retry the unclear batch on the old stream first.
3. Info — no test for the image `Retry-After` 60 s cap; the attach loop's `Retry-After` is uncapped (D1 caps 60 s).
   → fix round 2.
Writer choices accepted: one time origin per screen (`t` is evidence context only), images 4 requests total, attach
codes mapped to D1's screens.

## A7 fix round 2 (`177003a..91d91be`) — Opus confirming re-review
**Spec: CONFIRMED WITH NOTES. Security: CONFIRMED.** All three round-1 re-review items fixed with failing-first tests;
no way found to get stuck (forward-only, free, after a transition, a 410 or a reload); no duplicate answer edits or
`section.finish` from the resend; no new egress or storage. Writer choice accepted: item N cannot be reopened while
N+1 is pending (stricter than R5-68 d). Notes (Info, carried to REVIEW): hand-over can take ~127 s on a hung network
before attach (R5-66 b order holds; signals are not section-gated at the edge; optional total time budget); the
`attachWaitMs` call site has no test; the outbox 429 and item-GET 429 `Retry-After` paths stay uncapped (outside this
round). **Merged** into `m1/integration` (`chore: merge m1/a7-fix-1`).

## A5d recruiter wizard wiring (`de5b9b4..2489db3`, branch `m1/a5d-wizard`; R5-69)
**Spec review: PASS WITH FIXES.** No rule 1-9 breach (rules 1, 2, 3 checked: no blended number, no reject control,
paste rule only ever the test's `paste_written`).
1. Medium — D1's `PUT /tests/:id` can wipe the pool sections of a draft that became v2 in another tab (api
   `tests/routes.ts:281-296` has no shape check). → R5-70 b.
2. Low — test gaps: test-wide 10-question limit wiring, the integrity-read fallback, `FREEZE_COPY` in the v2 dialog,
   "Reviewers" on the D1 published view. → R5-70 e.
3. Low — a stored pool not in the loaded pages shows "Choose a pool". → R5-70 e.
4. Info — the "stored" rule is stricter than R5-69 b's text (sections with navigation/paste rule count). → R5-70 d.
5. Info — Publish enabled with section issues (server decides, as D1): accepted.
D1 preservation (d1-slice labels and flow, `e2e/support/recruiter.ts`), R5-69 a-h checked clean.

**Security review: PASS WITH FIXES.** Client gating is UX only; locks, paste rule, pool workspace, one open draft and
publish guards are enforced by the api and Postgres. Rule 3 touched (paste_written) and holds.
1. Medium — a stale tab overwrites a newer draft made with "Edit as new version" (`saveDraftV2` sends no version; the
   api writes into the latest version). → R5-70 a.
2. Medium — a lock placed after settings were stored makes every step-2 save 400 with a misleading message (fails
   closed). → R5-70 c.
3. Low — unsaved or in-flight step-3 changes are dropped at publish. → R5-70 e.
4. Info — the pool picker lists other workspaces' pools; the FK refuses them as 404. → R5-70 f.
Locks, paste rule, N1 ordering, Edit as new version (no fork), error text, XSS, fixtures, origins checked clean.
