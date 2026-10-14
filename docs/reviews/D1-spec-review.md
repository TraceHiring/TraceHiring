# D1 spec review — `specs/d1-demo-slice.md`
## Revision 1 (commit `bd8bc9e`) — Opus `spec-reviewer`, fresh context, read-only, 2026-10-14
**Verdict: CHANGES REQUIRED.** The main cause: §3–§11 were drafted by three parallel writers *before* the lead's §1.5 resolutions R-1…R-19, and the merge did not carry the resolutions into those sections. Two places also contradict founder answers (S1, S2). The database-reviewer has **not run yet**; it runs on revision 2 (Opus, fresh), together with a confirming spec re-review.

Verified clean by the reviewer:
- Rule 2: no reject, decision or bulk path.
- Rule 5: receipt only.
- Rule 7: AT-D21.
- Rule 9: under-18 paths tested.
- Rule 3: the validated flag matches the founder answer.
- Vendors are behind interfaces with mocks.
- At most 3 writers, with disjoint owned directories.
- Every applicable plan §5 "Done when" line has an AT.

| # | Sev. | Finding (short) | Lead disposition for revision 2 |
| --- | --- | --- | --- |
| S1 | Blocking | §5.2 returns `insufficient_evidence` before evaluating flags (P5, the example, OPEN-3); this contradicts the founder's "evidence wins" (build-notes §0, R-3) | **Fixed in this commit** (§5.2 order and P5 rewritten; OPEN-3 closed) |
| S2 | Blocking | D1-18 and §11 let BUILD start before H6 Sentry (build-notes §0 D1 row; build-order.md:38). AT-D22 cites an AT-9-sentry that was never written (m0-foundations.md:884, 905) | **Fixed in this commit** (D1-18 and §11: H6 plus a green AT-9-sentry gate every writer; the lead owns AT-9-sentry) |
| S3 | Blocking | §3.1–§3.3, §3.6 and §5.1 ignore R-1: `reports` FKs point at the internal tables; the cards have no columns, RLS or pgTAP | Rewrite §3.2, §3.3, §3.6 and §5.1 to R-1. `quality_cards` gets score, section scores, `meets_cutoff`, scoring/rubric/model versions. `integrity_cards` gets band, evidence strength, coverage, `review_state`, `band_rule_version_id`, `engine_version`. Add `integrity_timeline_entries` and `reports` FKs to the cards, plus `rls_d1_cards.test.sql` |
| S4 | Blocking | `not_used` is read-time, against R-2; the band-null CHECK; the mutable cutoff (`PUT …/cutoff`, AT-D14 re-project) versus a frozen `test_versions.quality_cutoff` | **The cutoff is pinned in the published version**: delete the PUT endpoint and re-project. The integrity worker gets SELECT on `public.quality_cards(org_id, session_id, meets_cutoff)` only, never the score. A test asserts `BandInput` has no quality field. Drop the band-null CHECK (the band is always stored). If the quality job dead-letters, the integrity card stays `review_state = 'awaiting_quality'` and the UI shows "Pending" |
| S5 | Blocking | No API DB access is defined (consents, invitation states, token-hash lookup, `media_view_grant`) | Define **`trace_api` login role** (secret `API_DB_URL`, check-staging-secrets allow-list), with exact grants and policies via `private.job_org_id()`-style context, and its own RLS tests. The consent row is inserted **at step 4 by the api** (before any `getUserMedia`, D1-13/Q36); the mirror only references it. `media_view_grant` is EXECUTE to `trace_api` only |
| S6 | Major | §4.2/§4.3 put `InviteOtpDO` and the lobby nonce in trace-api, against R-9 | Move both to trace-edge; the api mints the lobby token over RPC after the edge verifies the OTP; delete §4 OPEN(2) |
| S7 | Major | Two mirror designs (signals written by `trace_worker`; 1 vs 3 queues; two message contracts) | **One** `SessionMirrorMessage` contract and one queue (`max_retries 5` + DLQ). The mirror writes only public session rows. The integrity job writes `integrity.signals` from the R2 `events.ndjson` |
| S8 | Major | Rule data mismatch between §3.2 and §5.2; coverage floor units; R-11 factor missing; **bug**: `D1-PASTE-BLOCKED` needs `origin` + `policy`, but the paste payload is `{item, len}`, so a real paste is Clear | One rule schema (the §5.2 `Rule` shape, stored as jsonb in `band_rule_versions`). Coverage floor is in **permille** everywhere (700). Add `coverage_photo_missing_factor` (permille, 750). Paste rule: **any paste/drop in an item** → Review (T3); drop the `origin`/`policy` clause, `D1-PASTE-ALLOWED` and per-item paste policy (scope creep) |
| S9 | Major | Rule 8: views are audited only at link issue; secret and route names differ; owner/admin/recruiter bypass assignment; the creator auto-assign fails a CHECK | **Single-use link** (`jti` stored in a DO, burnt on first fetch), audit **per fetch** (`media.view`) plus `media.link_issued`. One route `/media/:jti`, one secret `MEDIA_LINK_HMAC_KEY`. Every role needs an assignment (R-15). `assignments.as_role` allows `recruiter`; the creator is auto-assigned by the publish function |
| S10 | Major | AT files missing from §3.6; §4.8 tests unnumbered; no AT-D9 pixel-test file; AT-D11 trivially passes | Reconcile §9 with §3.6. Number every §4.8 test (AT-D23…). AT-D9 → `apps/candidate/src/photo/blur.test.ts`. AT-D11 tests tampered claims, ids in URL/body being ignored, and token A unable to read B's receipt |
| S11 | Minor | Naming contradictions (JWK/JWKS, origin/URL, buckets, flag `state`/`status`, unique keys, band-engine imports, receipt fields, `invitations.candidate_id`/`session_id`) | One name each: `CANDIDATE_TOKEN_PUBLIC_JWK`, `CANDIDATE_APP_ORIGIN`, two buckets `trace-packages-<env>` (api write, edge read-only) and `trace-evidence-<env>` (edge write), flags `state`, `band-engine` imports nothing, receipt `{receiptRef, submittedAt}`; add R-10 columns |
| S12 | Minor | §11: nobody owns `CandidateRpc`, `DemoOutboxDO`, `apps/candidate/public/_headers`; C1/C2 reviewers undefined | Assign them to R-streams; C1/C2 get spec + security reviewers (security-reviewer is mandatory for tokens, media and auth) |

Next: revision 2 (lead plus writers), then the Opus database-reviewer and a confirming spec re-review, both fresh.

## Revision 2b (commit `3ebafdd`) — Opus spec re-review and Opus database-reviewer, in parallel, fresh context, 2026-10-14
**Spec re-review: CHANGES REQUIRED.** S1–S9, S11 and S12 resolved; S10 partly. New findings SR-1…SR-11 (6 Major: the event-seq collision across streams, null-cutoff semantics, an E2E assign step the roles forbid, no mechanism for L-12, an unrunnable sweep, one endpoint returning both cards; 5 Minor). Clean: rules 2, 3, 5, 6, 7, 8 and 9; exit gate and plan §5 mapped; AT numbers unique; §11 streams; no scope creep.

**Database review: CHANGES REQUIRED.** Probe: a rolled-back prototype of the cards, fill triggers, guard, `reports` FKs and column grants gives **0 rows from MT-5a/5c/5d**, so the rule-1 wall holds. MT-14 `login_dml` fires for a login role with default inherit (DB-7). Findings DB-1…DB-15: 6 Major (`membership_counts` needs the JWT, which is absent on the api connection; media audit rows have no viewer; missing `test_id`/`workspace_id` scoping columns; no guard tying `review_state` to `meets_cutoff` (rule 6); idempotency grants; the sweep cannot read the cards) and 9 Minor.

**Dispositions:** spec §1.7, L-14…L-36 (lead). Conflicting suggestions settled: the cutoff is mandatory (SR-2 vs DB-13), and each worker gets job-bound `idempotency_keys` grants (SR-7 vs DB-5).

## Revision 3 (commit `66c5fe8`): final confirming reviews, Sonnet spec-reviewer and database-reviewer, in parallel, 2026-10-14
**Spec re-review: APPROVE WITH MINOR FIXES.**
- SR-1…SR-11 and L-14…L-36 are resolved in §4–§11, except four leftovers from the fold-in: the AT-D27 path; whether the sweep re-enqueues or runs in-process; a stale `membership_counts_for` signature; missing bindings and data items.
- One real bug: the `integrity_band` key must be written only with the card's final state, or an `awaiting_quality` card is stuck forever.
- No rule regression.

**Database re-review: APPROVE WITH MINOR FIXES.**
- DB-1…DB-15 are all resolved. A probe on PG 17.11 confirmed `nulls not distinct`, `inherit false, set true`, the L-31 truth table and the CHECK-function grant behaviour.
- New defects found and fixed:
  - (C1) The M0b literal-true `idempotency_keys` worker policies would OR away the L-20 scope; they are dropped.
  - (C2) `authenticated` cannot execute the `signal_settings` CHECK validator; that column is moved out of its grant.
  - (C3) A deleted draft left its ruleset row behind; the delete trigger now removes it.
  - (C4) The card guard's Clear/Insufficient wording is fixed.
- Nits fixed as well.

All fixes are applied in revision 4 (editor agent, lead-chosen options: the sweep re-enqueues; `signal_settings` is excluded from the `authenticated` grant). **Outcome: spec approved by autopilot reviewers.**
