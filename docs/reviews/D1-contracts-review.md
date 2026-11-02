# D1 wire contracts — spec review (2026-10-14)

- **Reviewed:** `0b9a949..87bbc8d`: `packages/shared/src/contracts-candidate.ts`, `contracts-d1.ts`, their tests, `contracts-schema-walk.ts`, the package exports and the spec §4.2 "Contracts" paragraph. Drafted by a Sonnet helper (`33af756`), placed with lead decisions (`87bbc8d`).
- **Reviewer:** Opus `spec-reviewer` agent; ran the contract tests (198 pass) and probed zod 4.6.5 internals.
- **Fixes:** spec edits by the lead (`131318f`); code fixes by a Sonnet writer (`c8c0fb3`, placed as `9890b9e`), checked by the lead with a mutation run (F4 and F7 assertions fail when their fix is removed).

## Verdict: PASS WITH FIXES (2 Medium, rest Low; rules 1-9 and ADRs unbroken)
Verified: `SessionMirrorMessage` is identical to §4.4; token claims match ADR-030 §7; rule 5 (`Receipt` exact, `TestPackage` keyless, no other person's data), rule 1 (cards independent, `sharedNodes` empty with a guard proving detection), rule 6 (`pending` and `not_used_below_cutoff` are `{state}` only), rule 7 (signal payloads metadata only), identity keys discarded (AT-D11(b)), card rows match migration 3, error codes match §4.2.

## Findings and disposition
| ID | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| F1 | Med | 409 `out_of_order` body could not carry `ackSeq` (§4.4, RT-2) | **Fixed:** `OutOfOrderBody {error:'out_of_order', ackSeq}` |
| F2 | Med | No contract for the R2 evidence files written by the edge and read by the jobs | **Fixed:** strict `EvidenceEventLine` (signal and heartbeat only, no text key; L-21) and `FinalAnswers` |
| F3 | Low-Med | Most request/response types missing for the zod-free candidate app (`import type` only) | **Fixed:** `z.infer` types for every export |
| F4 | Low | `SessionGrantRpcOut` allowed `startedAt` without `resume` | **Fixed:** refine + failing case |
| F5 | Low | The schema walker skipped unknown def types silently | **Fixed:** explicit leaf list, throws on unknown types; `allObjectsStrict` false on zero objects |
| F6 | Low | Rule-1/rule-7 sweeps ran over `contracts-d1` only | **Fixed:** also over every candidate export |
| F7 | Low | A flag timeline entry with a null family (allowed by the table) could not be projected | **Fixed:** the contract requires a non-connectivity family on flag entries; the integrity job must always write it (NOTES) |
| F8 | Low | `sections.weight` is `numeric`; the driver returns a string | **Spec §5.4:** the job writes integer weights and parses the jsonb with the contract |
| F9 | Low | NOTES stale on `workspaceId` | **Fixed** |
| F10 | Low | §4.5 relative media URL vs §6.2 absolute | **Spec §4.5:** absolute |
| F11 | Info | `canonicalJson`, `SIGNAL_CATALOG`, `canonicalNoticeText` not yet in `@trace/shared` | `canonicalJson` **added** (`@trace/shared/canonical-json`, pinned to the rule-table hash `c862bf65…ca0e`); `SIGNAL_CATALOG` and `canonicalNoticeText` **open** (Wave 0, before writers C1 and R2) |

`packages/shared`: 1142 tests pass; `verify:fast` exit 0.
