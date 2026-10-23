# M1 BUILD 3 = Wave 2 — first reviews (2026-10-23)

Read-only Opus reviewers; findings summarised by the lead. Decisions: spec `specs/m1-test-authoring.md` R5-59, R5-60.

## A4 edge delivery (`03693fb..7f2fb9c`, branch `m1/a4-edge-delivery`)
**Spec review: PASS WITH FIXES.**
1. Medium — mirror `served[].position` is session-wide, R5-42 calls `position` the draw order; the DB refuses a pool row with
   `position > draw_count` (`20261023020000_m1_tests.sql`), so A3a must not copy it. → R5-59 a (two positions).
2. Medium — the DO keeps signal kinds outside `captureSignals` (§6.7: "the DO drops any other kind"). → R5-59 c; coverage
   side effect → FOUNDER-QUEUE 2026-10-23 "coverage when tab focus is off".
3. Medium — a GET for a `not_entered` section returns 400 even when it overtook a queued `section.finish`. → R5-59 d (409).
4. Low — untimed `section.finish` closes the section (confirmed, R5-59 e; A7 copy warns).
5. Low — no edge test that a 101-slot package is refused at start.
No AT requires a real-DO alarm test (fake clock meets AT-M1-19). Storage, draws, alarm, refused events, media route conform.

**Security review: APPROVE WITH FIXES.**
1. Medium — answers to drawn but unserved positions are accepted (`session-core.ts` `#navigator().answer`); `final.json`
   then has a position the mirror's `served[]` lacks → jobs `mirror_final_invalid` → no result ever reaches Postgres (a
   candidate can wipe their own result). Same gap latent in v1. → R5-59 b.
2. Low — the draw seed `SHA-256(session‖section)` is derivable from the view; the "never leaves the object" comment
   promises secrecy. → R5-59 f (comment corrected; random salt deferred, owner M8).
3. Low — the forward-only image refusal has no test.
4. Low — the 60 s section grace overlaps the next section (R5-20 sanctioned; kept, R5-59 g).
Media route auth, leakage, package storage, refused events and logging checked clean.

## M1-e lead migration (`5478442..8050482`)
**Database review: APPROVE WITH FIXES.**
1. Medium — `library_browse` half cursor `(created_at, null)` still returns rows (row comparison stops at the first
   differing pair). → M1-f.
2. Medium — exposure counts in the digest: an item served between package build and publish gives 40001 on every retry
   while a drive is live. → R5-60 (digest covers `section:item` only).
3. Low — `ai_draft_jobs.difficulty` is still `numeric(3, 2)` (rounds 0.405). → M1-f.
4. Low — pgTAP gaps: trigger `tgenabled`/order, denied cases of the `snapshot_digest` column grant, variant deleted in
   the middle, half cursor. → M1-f.
5. Info — the digest does not cover section settings (draw count, navigation, time limits); same gap as D1's
   `content_sha256`. Recorded for REVIEW.
6. Info — unconstrained `numeric` keeps the written scale (`0.500`). 7. Info — 40001 is generic: the api matches the
   `TRACE_GUARD` message, not the SQLSTATE alone (A2b brief).
Trigger order, no TOCTOU, digest lifecycle, column grant, SQL = JS digest, keyset ties, variant race: clean.
