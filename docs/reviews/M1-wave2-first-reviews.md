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

## A3a jobs v2 (`893657a..74d9891`, branch `m1/a3a-jobs-v2`)
**Spec: PASS WITH FIXES. Security: APPROVE WITH FIXES. Database: APPROVE WITH FIXES.** Rule 1 and rule 3 clean; R5-59 a met.
- Security Medium — `served[].position` is never checked against the layout: a DO bug or crafted message that swaps two
  pool positions scores an answer with another item's key. → fix round 1 (slot check, `*_bad_served_position`).
- Spec/security Low — `poolSectionIds` taken from the message. → fix round 1 (set equality with the version).
- Spec Medium — band-engine-1 re-delivery (R5-52 f): the reviewer reads "A3 owns" as requiring an ack of a provably
  identical stored result; rule 3 → FOUNDER-QUEUE 2026-10-23 (default: DLQ, never overwrite). Not changed.
- Spec Medium — new SQL tested only against fakes. → fix round 1 adds `db-test/stages-v2.db.test.ts` (database
  reviewer's 12 cases).
- Spec Low — v2 keeps `d1-scoring-v1`. → lead decision: v2 records `m1-scoring-v1`.
- Database Low — replayed pool rows hit the guard (42501) before ON CONFLICT; comments wrong (exactly-once holds via the
  key under the invitation lock). Database Low — message `v` vs `package_version` unchecked on the v1 quality path.
  Info — fakes weaker than Postgres; dead `signal_settings` null branch.

## A3b jobs drafting and members (`893657a..2b706d0`, branch `m1/a3b-jobs-authoring`)
**Security: APPROVE WITH FIXES** (spec and database pending at the time of writing).
- High — E26 not built: after the Auth user is created, any failure makes every retry hit 422 `email_exists` → invite
  failed for good, orphaned `auth.users` row (DPDP), cross-tenant enumeration of existing accounts; the fake reuses the
  user, so tests pass. Fix: look up the existing user's id (lead migration, definer for `trace_admin_worker`), re-check
  inviter admin + invite pending before Auth, make the fake behave like the real adapter.
- Low — Auth fetch follows redirects (custom `apikey` header survives cross-origin) and has no timeout; pepper only
  non-empty (require ≥ 32 bytes); topic not tied to `topic_sha256`; drafter output size uncapped; `on conflict do
  nothing` with no target treats an id clash as a re-delivery. Note — DLQ retention of admin messages carrying the
  plaintext address belongs in retention/deletion.
