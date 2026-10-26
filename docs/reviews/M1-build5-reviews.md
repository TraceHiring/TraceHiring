# M1 BUILD 5 — the lead's owed items before the M1 exit (reviews and decisions)

Spec row: `specs/m1-test-authoring.md` R5-71 (a-f). Branch `m1/integration`. Opened 2026-10-27.

## M1-p (`20261026180000_m1_atomic_writes.sql`, commits `2ed0d6c`..`0031fac`)
D1 shape re-checked inside `save_test_draft` under its row lock (R5-70 re-review Low 1); navigation default and
written paste rule derived in the database (R5-63 f); `id` out of the import/drafting job insert grants (R5-64 g).

Opus first reviews, all without a rule 1-9 breach:
- **Database: APPROVE WITH FIXES.** (1) Medium: a v2 draft save racing an integrity PUT could derive the old paste
  rule (fail-closed: publish refuses until a re-save). (2) Low: the integrity PUT (ruleset, then version) and a save
  carrying settings (version, then ruleset) could deadlock. (3) Low: the shape-check comment overstated "every section
  writer". (4) Low: pgTAP gaps (roles, written forward-only, string flag). (5) Info: `rls_m1_imports` audit assertions
  not scoped (fails on a database holding committed e2e rows).
- **Security: PASS WITH FIXES.** (1) Low: the same race as database 1. (2) Low: no denied-case pgTAP for the DEFINER
  derive trigger (probed: no cross-tenant reach). (3) Info, pre-existing: `sections_guard` answers distinguish a
  foreign version's existence and status (needs its uuid) — for REVIEW.
- **Spec: PASS WITH FIXES.** (1) Low: the api race test lost its key assertion (the fake's rollback snapshot wiped
  the concurrent write). (2) Low: the refused-save check did not cover the version update. (3) Low: R5-71 b wording vs
  a draft without settings. (4) Low: RLS floor not raised. (5) Low: full verify owed. (6) Info: spec bookkeeping and
  two stale comments.

Fix round (lead, tests first: red `0316b9c`, green `5504e4d`, migration M1-r `20261026200000_m1_lock_order.sql`):
- DB 1 / SEC 1 / DB 2: one lock order (ruleset, then version) in `save_test_draft`; a two-connection scenario
  "draft save during a settings write" in `scripts/test-concurrency-local.mjs` (red before, green after); publish keeps
  version-then-ruleset, a 40P01 is answered 409 `conflict` (api test).
- DB 3: comment corrected. DB 4 / SEC 2 / SPEC 2: `rls_m1_atomic` 37 → 48. SPEC 1: fake `beforeRpc` runs before the
  snapshot; the assertion is back. SPEC 3 / 6: R5-71 b, c amended, comments fixed. DB 5: audit assertions scoped.
- SPEC 4 / 5: the floor and the full verify are done at the merge of BUILD 5 (below).

## M1-q (`20261026190000_m1_atomic_rpcs.sql`, commits `7e9defe`, `16c58c4`)
`create_test_from_template` and `save_bank_draft` (R5-71 d, e); `rls_m1_rpcs` 34. Api switch: writer streams
`m1/a8-templates-rpc` (from-template + template list paging) and `m1/a9-bank-rpc` (bank draft writes).

## Lead decisions on the rest of the owed list (HANDOFF 2d, 2e; AUTOPILOT §4)
- **2d E2E library seeding:** deferred gate. AT-M1-01 runs from-template against an empty local library (spec §8 known
  limit); the library copy path is covered by `rls_m1_rpcs` (real database, one transaction), `rls_m1_templates_jobs`
  and the api from-template tests. A local-only seeding route would add a write surface to the api for a test; the
  staging E2E with seeded library content stays with the founder-approved staging dispatch. Recorded in the M1
  summary's Deferred gates table.
- **2e carried Info, deferred to the M1 REVIEW (listed in the summary):** the A7 hand-over total time budget (~127 s
  worst case); uncapped `Retry-After` on the outbox 429 and item-GET 429 paths; an integrity PUT "invalid body + stale
  version" test. None touches rules 1-9.
