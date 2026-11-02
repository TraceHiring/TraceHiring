# D1 migration 3 — database review (2026-10-14)

- **Reviewed:** `supabase/migrations/20261014151833_d1_results.sql` at `7e9e3fc` and its tests (`rls_d1_{cards,results,reports,rulesets_m3,sweep}`, the changed `rls_d1_consents` and `rls_roles`), against spec `specs/d1-demo-slice.md` §1.5–§1.7, §3.1–§3.7, §10-DB, migrations 1, 1-fixes, 2 and `docs/progress/d1-wave0-drafts/m3-tests/NOTES.md`.
- **Reviewer:** Opus `database-reviewer` agent. It read files only and ran no database, because the lead was running `pnpm verify` at the time.
- **Fixes:** lead, in `e253624`, test-first.

## Verdict: APPROVE WITH MINOR FIXES (no blocker)
0 Blocker, 1 Major (a test gap), 8 minor, 7 notes.
- **Rule 1:** no break. No function, trigger, policy or FK names both `quality.*` and `integrity.*`. The integrity side reads only `public.quality_cards.meets_cutoff`. The `reports` column grants hide the other worker's pointer.
- **Rule 6:** no break. The card and timeline policies require `review_state = 'reviewed'`, and `reports_set_once` refuses to attach a card that is not reviewed.
- **Lead decisions accepted:**
  - only a reviewed integrity card can be attached;
  - the sweep runs across orgs, with an age guard on DO times;
  - band/flag consistency is skipped for `awaiting_quality` (the flip re-checks it);
  - L-8 takes the highest rule-table version and the newest notice, and fails closed.
- **Rule-table hash:** recomputed independently: `c862bf65…ca0e` = canonical JSON of `docs/progress/d1-wave0-drafts/m3/d1-v1.json`.
- **Trigger order:** the L-8 trigger fires after `test_versions_guard`, and the card fill fires before the card guard.

## Findings and disposition
| ID | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| M-1 | Major | The rule-6 attach guard (only a `reviewed` integrity card attaches to `reports`) had no test | **Fixed** `e253624`: 7 cases in `rls_d1_reports`. An awaiting card and a below-cutoff card are refused, for the worker and the operator. The card attaches after the flip to `reviewed`. A same-value re-attach is a no-op (also covers m-7c) |
| m-1 | minor | Flags could be added after the card was final, so the band could stop matching its flags (I-3) | **Fixed:** `integrity_flags_guard` locks the session's card `FOR SHARE` and refuses a flag once the card is not `awaiting_quality`; test in `rls_d1_cards` |
| m-2 | minor | `coverage_floor_permille` was supplied by the worker, so Clear on thin coverage was possible with a floor of 0 | **Fixed:** `integrity_results_guard` requires the rule table's floor (an out-of-range value is left to the CHECK); test in `rls_d1_results` |
| m-3 | minor | The card's `photo_missing` was job-supplied and could disagree with the result | **Fixed:** the fill copies `integrity.results.photo_missing`; the `rls_d1_cards` fixture and assertion are adjusted |
| m-4 | minor | No TRUNCATE guard on `quality.scores`, `integrity.flags`, `integrity.results`, `quality_cards`, `integrity_cards`, `reports` | **Fixed:** ENABLE ALWAYS statement triggers (`42501 TRACE_GUARD`); 12 tests (normal and replica mode) |
| m-5 | minor | The sweep's stage-alphabetical order let poison rows of one stage starve the others | **Fixed:** round-robin across stages, oldest first within a stage; test with `p_limit 3` |
| m-6 | minor (uncertain) | A stage counts as done when its card exists, even if the `reports` pointer was never set | **Decided (spec §5.1 "Transactions and retries"):** each stage outcome is one transaction (card or flip, flags, timeline, pointer, idempotency key); the sweep keeps reading cards only |
| m-7 | minor | Test gaps: (a) the age guard on the quality/integrity stages (a fresh session is not listed); (b) band/flag consistency on the UPDATE flip; (c) same-value re-attach | (c) **fixed**; (a) and (b) **fixed** (tests only): `rls_d1_sweep` mirrors a fresh session and asserts it is on neither result stage; `rls_d1_cards` adds a T3 medium flag to a parked Clear card and asserts both flips are refused. A mutation run (aged session; soft flag) fails exactly those assertions |
| m-8 | minor | The L-8 notice lookup did not filter on `notice_key` | **Fixed:** `notice_key = 'candidate-notice' and language = 'en'` |
| n-1 | note | The consents TRUNCATE CASCADE assertion would also pass on a cascaded table's trigger | **Fixed** (test only, no message change): the consents test switches off every other TRUNCATE trigger inside its transaction, so the cascade assertion can only be met by `consents_no_truncate` |
| n-2 | note | The `reports` insert in `mirror_session` uses `on conflict do nothing` | Keep (exactly-once is tested) |
| n-3 | note | Only a manual recomputation ties the rule-table hash to its JSON | **Fixed:** `rls_d1_rulesets_m3` pins the exact hash; `band-rules-sync.test.mjs` still lands with `packages/band-engine` |
| n-4 | note (uncertain) | The seeded rubric's `content_sha256` hashes `jsonb::text`, not canonical JSON | **Decided (spec §5.1):** the job copies `rubric_versions.content_sha256` and never recomputes it; `rubric_set_sha256` = SHA-256 of `canonicalJson` of the sorted hashes, one `canonicalJson` in `@trace/shared` |
| n-5 | note | The global `unique (session_id)` duplicates m2's `(org_id, session_id)` index; `expires_at > created_at` compares two clocks | Keep for D1; revisit the duplicate index in M3a |
| n-6 | note | The card guard runs before `on conflict`, so a retried awaiting insert after the quality card has landed raises | **Decided (spec §5.1):** every run reads the existing card first; awaiting plus a quality card → flags then the single flip; never re-insert |
| n-7 | note | `sweep_pending` has no supporting index | M4: a partial index on `sessions (submitted_at) where state <> 'in_progress'` |

## After the fixes
- `pnpm test:rls` exit 0: 29 files, rls **2428** (floor raised from 2405), catalog 142, db-types current.
- `pnpm -s verify:fast` exit 0.
- Follow-up 2026-10-14 (late): m-6, n-4, n-6 written into spec §5.1; m-7a, m-7b, n-1 fixed test-only. Full `pnpm verify` exit 0 (rls **2435**, catalog 142).
