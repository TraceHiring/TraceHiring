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

## Fix-round confirmations (A3a, A3b) and later reviews
- A3a fix 1 (`402a3ac`): CONFIRMED WITH NOTES (new Low: quality checks the message but scores stored rows → R5-62 b, M1-i
  grant; the mirror-side check is owed). A3b fix 1 (`1866c92`): CONFIRMED WITH NOTES (inviter re-check → M1-h; two-accounts
  branch untested).

## A2b api (`09e4ed8..8f7b52c`, branch `m1/a2b-api-tests`)
**Spec: PASS WITH FIXES. Security: APPROVE WITH FIXES. Database: APPROVE WITH FIXES.** No rule 1-9 issue; decisions R5-63.
- Spec Medium — a losing publisher's R2 put can land over the winner's package (SessionDO then refuses every session).
- Spec/security/database — pepper 16 chars (api) vs 32 bytes (jobs); the local HMAC helper takes `(pepper, email)`, the
  shared one `(email, pepper)` (a swap would type-check and break every invite).
- Spec Medium (merge blocker) — the recruiter app still parses `TestDetailResponse` from GET/POST/PUT (R5-53 a).
- Database Medium — from-template not atomic (leftover job/test/pools/copies; copy cap); publish reads N+1 (~300-500
  sequential subrequests per attempt at 5,000 items).
- Lows — R5-34 not applied on clone; settings + null navigation never publishable; AT-M1-29 v2 retire/loser untested;
  unmapped guard keys answer 404; invite resolve parses the whole package for its title; preset_version dropped;
  from-template bypasses the LibraryLimiter; settings + paste rule in two writes; no invite keyset index; template list
  not paged; owner-without-admin cannot manage invites (spec AD).
- Database review of lead migrations M1-f…M1-i: **APPROVE** (Lows: pin `ai_draft_jobs_outcome`; the M1-g comment
  overstates the lookup's binding; the M1-i grant is not used yet).


## A2b fix round 1 (`8490579..5c2a892`, branch `m1/a2b-fix-1`) — confirming re-review (Opus, 2026-10-23)
**Spec: CONFIRMED WITH NOTES. Security: CONFIRMED. Database: CONFIRMED WITH NOTES.** No rule 1-9 issue. All eight claimed
items (R5-63 a-e, R5-53 a, R5-34 on clone/versions, guard keys, title from `tests.name`) verified; test removals justified.
Merged `f9a6ad4`; red `ea849cd`, mounts + `LIBRARY_LIMITER` (60/60 s) `fca81ee`; migration M1-k `0b52059`→`9a06211`.
- Low 1 (test gap): no test for an unbound limiter → **done** by the lead (`templates.test.ts`, 503 before any write).
- Low 2 (database): the missing-object `uploadedBefore(readAt)` compares R2's clock with the Worker's; the fake assumes R2
  passes `uploadedBefore` on a missing object → owed: a staging measurement (lead ask 3; FOUNDER-QUEUE staging go-ahead).
- Low 3: clone answers an error if `pinPresetVersion` fails after `save_test_draft` committed (e.g. 23503 when the
  catalog differs); from-template archives, clone does not → owed, folds into the R5-63 f atomic RPC work (lead).
- Note 4: guard keys `invite_settled`, `item_frozen`, `item_status_change`, `approver_required`, `pool_archived`,
  `import_not_open`, `library_not_approved` still fall to 404 → A2a maps its own keys (in the A2a brief).
- Note 5: settings PUT and a draft save can interleave (null navigation after defaults) → refused at publish, not
  corrupted; covered by R5-63 f (one-write derivation in the database).

## Lead migrations M1-k → M1-l, A2b mounts, LIBRARY_LIMITER (`c8d3b84..4fca331`) — Opus database review: **APPROVE**
The first full verify after the A2b merge failed `rls_d1_api` 41 (M1-k's column grant loosened the D1 pin "tests: trace_api
has no SELECT privilege"); M1-l (`d1342de` red, `4fca331`) drops it and adds `private.api_test_title` (definer, org-bound).
Full serial verify green on `4fca331` (rls 3716, catalog 150). Findings: Low 1 `testTitle` relies only on the
`api_org_id()` binding → documented in the store header (must run inside `inOrg`); Info 2 the `library/items` consumer of
`LIBRARY_LIMITER` lands with A2a; Info 3 `ratelimits` on staging is confirmed only by the next staging dispatch (ADR-032).

## A2a api (`620065a..08b27ce`, branch `m1/a2a-api-bank`) — Opus first reviews
Writer (Opus): red `b0ab28a` (72 failing), api 55 files / 596 tests, typecheck + lint clean. Lead ask 1 done `0eb91ac`
(item-variants `crypto.subtle`).
**Security: APPROVE WITH FIXES** (no rule 1-9 issue):
- Low S1 — `pathId` keeps an upper-case org UUID; the image PUT writes `item-media/{UPPER}/…` outside the org prefix, then
  answers 503 (erasure/retention by prefix misses it). Fix: lower-case in `pathId` (all modules) + test.
- Low S2 — `scrubDraftTopic` can lengthen a topic and `.slice(0, 500)` can cut a surrogate; the message then fails
  `AuthoringQueueMessage` after the job insert → job stuck `queued` (no org role may fail it). Fix: parse the message
  before the insert; cut by code point (shared, lead); a sweep `queued` → `failed` (`enqueue_failed`) for any enqueue failure.
- Notes — `import_item_batch`/`save_item_variants` INVOKER + authenticated EXECUTE make the api's hash/variant checks
  advisory (same org only; R2-5); image sniff checks headers only (serve with fixed type + nosniff); no per-job image cap;
  `POST …/bank/ai-drafts` unlimited (cost exposure when ABH-87 lands a real LLM).
