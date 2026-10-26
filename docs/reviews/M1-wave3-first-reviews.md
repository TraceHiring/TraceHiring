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
