# D1 stream R1 (band-engine + vendors) — spec review (2026-10-17)

- **Reviewed:** `git diff c514c7a d1/r1-band-engine` at `5e1eaa3` (4 commits, files only under `packages/band-engine/src/` and `packages/vendors/src/`). Opus `spec-reviewer`, read-only. It ran band-engine 126 tests and vendors 101 tests, all passing. `rules/d1-v1.json` is byte-unchanged, so the migration-seed sync still holds.
- **Verdict: PASS WITH FIXES.** No rule 1, 3 or 7 violation and no ADR breach. Determinism confirmed: no imports, no clock, randomness or I/O, a stable sort and strict parsing. The property tests are meaningful.

## Findings and disposition
| ID | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| M1 | Medium | No test exercises the escalation branches (T1/T2 → strong_concern; T3 `rawMedia` with and without `mediaRef`; two soft families → review; two soft flags in one family → clear). Deleting a branch would keep every test green (rule 3). | Sent to R1: table-driven cases, plus one hand mutation per branch to show it goes red. |
| M2 | Medium | The mock grader matched each anchor against single tokens, so a multi-word anchor (`"binary search"`) never scored, and duplicate anchors could make `minHits` unreachable. | **Lead decision (§5.3 was silent):** anchors match as phrases. An anchor is tokenised like the answer and matched against consecutive answer tokens. `parseGradeRequest` rejects an anchor with no tokens and a criterion with fewer distinct normalised anchors than `minHits`. Sent to R1. |
| L1 | Low | Candidate signals allow `item: null`, and `tab_hidden` carries `ms` rather than `durationMs`. The engine refuses null attrs, and `minDurationMs` never matches without `durationMs`. | **R2:** drop null attrs and map `ms` → `durationMs` before `computeBand`. |
| L2 | Low | `ContextItem.ruleId` conflicts with the card contract, which forbids a rule on a context entry. | **R2:** strip it when building the card. |
| L3 | Low | `reasons` is not capped at 10, the card contract's maximum. | Sent to R1: cap at 10 in table order. |
| L4 | Low | Sparse arrays crash with a TypeError instead of `bad_rule` / `bad_event`. | Sent to R1: index loops plus tests. |
| L5 | Low | Tests use the literal `'gaze'`, which the planned AT-D21 scan may flag. | Sent to R1: `'not_a_family'`. |

## The writer's choices (accepted)
`Flag.observed` and `ContextItem.observed` are objects summed over the matched events. The reason codes are `tier_t1:`, `tier_t2:`, `untrusted:`, `raw_media:`, `t3_severity:` and `t3_families:`; `low_coverage` appears only when the band is `insufficient_evidence`, and Clear has no reason. `connectivity_gap` becomes context in the family `connectivity`, and the parser reserves that family and kind. A duplicate `gseq` throws. Coverage is capped at 1000 permille. An unmatched event becomes context. Flags follow rule-table order. `untrusted` and `rawMedia` keys are refused on T1/T2 rules. **`GradeRequest` is parsed by a hand-written strict parser, not zod:** vendors imports only `@trace/shared` (§5.3), the key set is pinned by a test, and identity keys are refused at run time. This deviates from §5.3's "strict zod type" (lead decision, 2026-10-17).

## Still due before the merge
The R1 fixes above. The security-reviewer pass on the vendors production guard (§11: the demo outbox and the mock grader must refuse production). Then the merge `--no-ff` into `d1/integration`, verify:fast, full `pnpm verify` and CI.

## Security pass on the production guard (lead, Opus, 2026-10-17; spec section 11)
- `packages/vendors/src/messaging.ts` at `89a29fe`: the mock Messaging accepts only `dev` and `staging` (an allow-list held in a module-private, unexported array), checked in `createMessaging`, in the `OutboxMessaging` constructor and on every `send`; any other value, `production` or a missing one, throws `MessagingMockInProductionError` (fail closed). Recipients must match `@example.test`; error messages carry only a code (no PII). AT-D18 tests cover the factory, the constructor and idempotency. **PASS, no finding.**
- **For R3 (L-11):** the api passes `env.TRACE_ENV` to `createMessaging` and must treat a missing or unknown `TRACE_ENV` as production (refuse), never default to `dev`.
- Merged `--no-ff` into `d1/integration` after this pass.
