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

## M1-q first reviews and the M1-p confirming re-review
- **Database (Job 1, M1-p fix round): CONFIRMED WITH NOTES.** Medium 1, Lows 2-4 and Info 5 fixed (two-connection
  scenario red without the lock). N1 (Low): a direct PostgREST section write still reads the settings without a
  lock; N2 (Info): integrity PUT vs publish may also deadlock (pre-existing, 409); N3 (Info): scenario covers a draft
  without sections only.
- **Database (Job 2, M1-q): APPROVE WITH FIXES.** (1) Medium: pgTAP role and edge coverage; (2) Low-Medium: one
  call under one 8 s statement timeout; (3) Low: update without `is_parameterised` → 23502; (4) Low: an id named
  twice → 42501 (api 404); (5) Info: clone refusals (E7, R5-64 f) api-only; (6) Info: no content size bounds (INVOKER).
- **Security (M1-q): PASS WITH FIXES.** (1) Low: a ruleset can name a preset while its values differ (pre-existing:
  the direct UPDATE grant and `save_test_draft` allow it too; the api refuses it); (2) Low: denied-case pgTAP gaps;
  (3) Info: existence oracle by uuid on clone; (4) Info: limiter and R5-64 f api-only. M1-p confirmations: Low 1 and
  Low 2 CONFIRMED; Info 3 (`sections_guard` oracle) not addressed — accepted below.
- **Stream a8 (templates, Opus spec+security): PASS WITH FIXES.** (1) Medium: a template with only voice/typing
  sections now 400 instead of 201 (M1-q required 1-10 sections); (2) Low: no test for it. Fix writer `m1/a8-fix-1`.
- **Stream a9 (bank, Opus security+spec): PASS**, no findings.

Fix round M1-s (lead, red `rls_m1_rpcs` 7 of 59, green with migration `20261026210000_m1_rpc_fixes.sql`): 0-10
sections (a8 1), ≤ 2,000 ids a call (DB 2), ids de-duplicated (DB 4), `is_parameterised` defaulted on update (DB 3),
role and edge cases (DB 1, SEC 2). The api half (zero sections, total-id cap) is on `m1/a8-fix-1`.

Accepted or deferred (lead decisions, AUTOPILOT §4; none touches rules 1-9):
- SEC 1 (preset name vs values in the database): deferred to the M1 REVIEW; the api refuses a mislabelled preset on
  every path, and a database check would change 23 existing settings fixtures. Tracked in the M1 summary.
- DB N1 (unlocked derive on a direct section write): accepted; it fails closed at publish (DB-M1-1), and a lock there
  would bring back a deadlock with `save_test_draft` on that raw path. The api never writes sections directly.
- DB 2 measurement (the largest template under the 8 s timeout on staging): with the founder-approved staging
  dispatch; locally 1,200 copies + 2,000 pool items took 2.6 s.
- DB 5, SEC 3, SEC 4, SEC Info 3 (`sections_guard`): uuid-only existence oracles and api-only clone refusals are
  equally reachable through the existing direct grants; noted for the M1 REVIEW.
