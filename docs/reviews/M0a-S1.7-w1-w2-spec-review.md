# M0a S1.7 spec review: W1 redactor (with fixes) and W2 harness, as merged into `m0a/integration`

- Date: 2026-10-11, fresh `spec-reviewer` agent, read-only.
- Scope: W1 `git diff 6d5f1c4 913353c` (`packages/shared/src/log/**`, the merge of `m0a/w1-fixes` @ `76dc548`); W2 `git diff 913353c 18ae1ff` (`scripts/test-rls.mjs`, `scripts/db-types.mjs`, `scripts/gen-catalog-tests.mjs` and their tests; the merge of `aabef91`). Checked against `specs/m0-foundations.md` revision 11 (§5, §8.3, §8.5, §9.1, §9.2, §13) and CLAUDE.md rules 1–9.
- Ran: `pnpm --filter @trace/shared test` 325/325; `vitest run --root scripts` on the 3 W2 test files 177/177; shared lint and typecheck clean; `prettier --check scripts packages/shared` clean. The redactor was compiled to a scratch dir and probed with node.

## Verdict: PASS WITH FINDINGS
W2 passes. W1 has 1 Medium and 5 Lows; nothing Blocking or High. Redactor review #1 is only partly fixed (findings 1–2).

| # | Sev | file:line | Problem (demonstrated) | Fix | Spec |
| --- | --- | --- | --- | --- | --- |
| 1 | Medium (review #1 partly fixed) | `packages/shared/src/log/redact.ts:363-370` | An over-cap (>2,000 chars) **array** element is split and filtered, so its frame-shaped lines survive: `redact({stackTrace:['Error: '+'q'.repeat(2500)+'\n    at g (file:///b.js:3:4)']})` → `{"stackTrace":["at g (file:///b.js:3:4)"]}` (before 439a833 it became `[TRUNCATED]`) | An element over `MAX_STRING` becomes `[TRUNCATED]`; test | §9.1 Caps: "never passed through" |
| 2 | Low (review #1 test missing) | `packages/shared/src/log/serialize-error.ts:26-35` | Message changed after the stack was captured: single-token frame-shaped message lines survive (`new Error('dup\nat qwzxkvbn.qwzxkvbn:1:1')`, read `.stack`, set `message='other'`) | Keep only the trailing run of 4-space-indented frame lines; add the review's test | §9.1 Errors: messages dropped |
| 3 | Low (regression from 1a4117b) | `packages/shared/src/log/redact.ts:361` | Not idempotent: `{stack:'x'.repeat(2001)}` → `{stack:"[TRUNCATED]"}` → second pass `{stack:[]}`; the test at `redact.test.ts:749-755` does not check a second pass | `redactStack` returns `[TRUNCATED]` unchanged; assert `redact(once)` equals `once` | §9.1 Tests: "is idempotent" |
| 4 | Low | `redact.ts:289`, `:309`; `redact.test.ts:249-262`, `:790-793` | Not idempotent for any Error: a second pass turns `name` into `[REDACTED]` (the `name` stem). The property arbitrary never generates Errors; the test at `:790` compares only stacks. Over-redaction only, no leak | Keep serialised errors stable on a second pass (or amend §9.1); add Errors to the arbitrary | §9.1 Tests; AT-8 |
| 5 | Low (pre-existing) | `packages/shared/src/log/error-reporter.ts:16-23` | `ctx.release` reaches the reporter unvalidated (`{release:'user x@okaxis.example'}` passes through) | Validate with the logger's `VERSION` regex (`/^[0-9a-f]{7,40}$\|^dev$/`) or drop it | §9.2 |
| 6 | Low (pre-existing) | `redact.ts:50-54` vs `redact.test.ts:99-103`, `:544-547` | 9 of 16 allow-list keys untested (`attemptid`, `invitationid`, `workspaceid`, `errorcode`, `stage`, `page`, `pagesize`, `contentlength`, `responsetimems`) | Test every allow-list entry | §9.1: allow-list "covered by tests" |

## Prior fixes verified
- Redactor review #2 (UPI before `.` or a dash): fixed, `redact.test.ts:153-164`. #5 (any Authorization scheme, every Cookie pair): fixed, `:167-179`. #7 (best-of-five timing): fixed, same budgets. #1: partly fixed (findings 1–3 above).

## W2 against the spec
- §8.3 steps 1–7 all match (Docker message; lock in `os.tmpdir()` keyed by `project_id` with PID and checkout; 15-minute wait then failure naming the holder; dead-PID takeover with a warning; release on exit, failure and signal; `-x` keeps gotrue; `test db --debug`; stdout only; fails on `not ok`/TODO/SKIP, plan mismatch, 0 tests, bad file name, file-set mismatch; prefix counts against the floors; byte-exact db-types drift against a temp file; `--stop`).
- §8.5 `--check` rules all match (stale file, missing check or fixture, stray files, floors vs base and ancestor `m*-reviewed` tags, missing-at-base = 0, unresolvable base fails, manifest subset, `unreachable` rules). Generated SQL matches the template, including the `v.branch` filter.
- CLAUDE.md: no PII, secret literals or service-role use; secret shapes built at run time; no test weakened.

## Acceptance tests
- AT-3 covered: `scripts/test/test-rls.test.mjs` Docker down `:118`, `:131`; floors `:586`, `:592`; 0 tests `:517`; lock `:182`–`:279`. Clean-clone case covered by implication (lock path depends only on `project_id` and the temp dir).
- AT-8 covered, with the gaps in findings 3–4: `redact.test.ts` stems `:84`, patterns `:144-204`, caps and cycles `:207-225`, properties `:246-279`, messages dropped `:227` and `logger.test.ts:155-196`.
- AT-9 unit part covered: `logger.test.ts:130-152`. App/jobs/api wiring tests belong to S2/S3.
- AT-19 unit tests `scripts/test/gen-catalog-tests.test.mjs:395-609` (lint wiring pending). AT-23 unit tests `test-rls.test.mjs:669-753`, `db-types.test.mjs:79-135`.

## Not checked
Real Supabase/Docker runs (AT-2, real AT-23); whether real pgTAP keeps `ok N` numbering in sequence after `rollback to savepoint` (the harness's out-of-sequence check would fail a real run if not); full `pnpm verify`; consumer wiring; W3 checks (not merged yet).

## Disposition (lead)
All six findings were sent to the writer already fixing redactor Lows #3, #4, #6 and #8 (branch from `m0a/w1-fixes` @ `76dc548`), test-first, one commit each. A fresh review of that branch follows before it merges.
