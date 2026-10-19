# D1 stream R2 (jobs: mirror, quality, integrity, sweep): reviews and dispositions

Chat C, 2026-10-19. Writer: Opus, branch `d1/r2-jobs` (`42fd3e2..2ad15be`, 9 commits, 33 files; report
`docs/reviews/D1-r2-writer-report.md`; `workers/jobs` 12 files / 184 unit tests, 2 files / 14 real-DB tests).
Reviews (Opus, read-only, on `42fd3e2..2ad15be`): spec-reviewer **PASS WITH FIXES**, security-reviewer **PASS WITH
NOTES**, database-reviewer **APPROVE WITH MINOR FIXES**. None found a breach of rules 1-9.

## Findings and dispositions
| # | Source | Sev | Finding | Disposition |
| --- | --- | --- | --- | --- |
| DB-1 | db | Minor | Concurrent integrity runs: 42501 (direct final) or 40P01 (flip); the db-test retried any rejection | **Fix now** (R2 fix writer): advisory xact lock on the job key after `keyExists`, re-check; test both runs fulfil with the same ids |
| DB-2 | db | Minor | Bare catch maps every awaiting-insert error to `integrity_retry` | **Fix now**: only 42501 from the card guard |
| DB-3 / SEC-1 | db, security | Minor / Medium | `JOBS_TEST_DB_URL` accepted any host (roles, trigger disabling, deletes) | **Fix now**: local hosts only |
| DB-4 / SEC-3 | db, security | Minor / Low | Stale cleanup could hit a concurrent run | **Fix now**: idle roles only, orgs older than 30 min |
| DB-5 | db | Note | Cleanup locks could block pgTAP | **Fix now**: `lock_timeout 5s` |
| DB-6 | db | Note | Job writes the mirror rows itself, not via `private.mirror_session` (writer request 6); no `mirror_seq` duplicate check | **Accepted: keep the job's writes** (it reproduces every guard; spec 4g). **Carried (M3a):** revoke EXECUTE on `private.mirror_session` from `trace_worker` (or drop it) in a fix-forward migration, and add the `mirror_seq` check |
| DB-7 | db | Note | Grader called inside the open transaction | **Carried (M5)**: grade before BEGIN or set `idle_in_transaction_session_timeout` |
| DB-8 | db | Note | Quality items ordered by position only | **Fix now**: section position, item position, id |
| DB-9 / O2 | db, spec | Note | The org's seeded default rubric cannot be graded (`quality_bad_rubric`) | **Accepted for D1** (api items never use it). **Carried:** align or stop seeding it in the next fix-forward migration |
| DB-10 / O3 / F3 | db, spec | Note / Low | 1 000-entry timeline cap, count clamp, not in the spec; context undercount not visible | **Accepted** (all signals stored, band from all; every flag keeps its entry); spec 4g. **Carried (M4):** make the cut visible on the timeline |
| DB-11 / F2 / O4 | db, spec | Note / Low | Flip re-heads the photo; a vanished object dead-letters the flip | **Fix now**: flip takes `photo_missing` from the stored result |
| DB-12 | db | Note | Gap seqs `lastEventSeq + 1 + i` can collide once mirrors repeat | **Carried (M3a)** |
| SEC-2 | security | Medium | NUL or a lone surrogate in answer text poisons the mirror (no result ever) | **Fixed (lead)** `a52f6e4`: the contract refuses unstorable text; **fix now** (R2 fix writer): job constant code `mirror_final_invalid` and the edge refuses an edit whose rebuilt text is unstorable |
| SEC-4 | security | Low | Grader criteria stored unchecked | **Fix now**: validate ids, points, max, count |
| SEC-5 | security | Note | Writer's StageDb sketch differs from the lead's `withStageConnection` | **Lead wiring** uses `withStageConnection` (constant role SQL; `null` org only for the sweep) |
| F1 | spec | Medium | Engine version check is dead code; the stored result's engine and band are never compared (rule 3) | **Fix now** |
| F4 | spec | Low | "Exactly one of photo / photoSkippedReason" guard missing | **Fix now** |
| F5 | spec | Low | final.json and the photo are read before the duplicate-key check | **Fix now**: lock and key check first |
| F6 | spec | Medium (process) | db-tests not in `pnpm verify` | **Lead**: tsconfig.node include and `test:rls` step |
| F7 | spec | Low | Memory measured in Node on the jobs read path, not workerd finalise | **Accepted**: the SessionDO finalise was measured in workerd separately (`docs/reviews/D1-review-c1b.md` note 4) |
| F8 | spec | Low | Property tests are seeded loops, not fast-check | **Accepted** (500 seeded iterations each) |

Writer requests: 1 wiring and 5 (ack-and-alert, optional; **carried**, retries then DLQ stay correct) by the lead; 2, 3
(F6) by the lead; 4 (fixture catalog version) done by the lead; 6 see DB-6. Writer open question O1 (a named photo that
fails the check counts as missing): **accepted** (fail closed; by P10 it can only move Clear to Insufficient evidence).

## Fix round
Opus fix writer on `d1/r2-fixes` (`2ad15be` + merge `fff6e36` of `a52f6e4`, tip `9817ce5`; report
`docs/reviews/D1-r2-fix-report.md`; jobs 15 files / 234 unit tests, 4 files / 37 db tests): DB-1 `a2698ca`, DB-2 `3b7fb62`,
DB-3 `0b7c3ea`, DB-4/DB-5 `10e91e5`, DB-8 `b4dc3f6`, SEC-4 `d02476d`, SEC-2 job `a24f57c` and edge `b3b6e1f`, F1 + F2
`d6773b4`, F4 `aac7ad7`, F5 `a173eb8`. **Sonnet confirming re-review: CONFIRMED WITH NOTES** (all eleven fixed with
regression tests; no rule breach). Notes and lead dispositions:
1. Medium: the AT-D25 model derived UTF-16 splices that can split a pair, which the contract refuses, and never
   parsed with the contract. **Fixed (lead)** test first: the alphabet gains a second emoji sharing the high
   surrogate (red: `unstorable_text`), every event is parsed with `ClientEvent`, `spliceOf` is code-point aligned;
   spec rev 4h (binding for C2).
2. Low: R2 reads happen under the invitation lock. **Accepted** (only a concurrent mirror of the same invitation waits).
3. Low: the 42501 retry predicate matches the guard text. **Accepted**: the real-guard db test now runs in `test:rls`.
4. Low: the fake lock is a no-op; the lock order is proven only by the db test. **Accepted** (same reason).
5. Note: `db-test/**` was in no tsconfig. **Fixed (lead)** `6d504da` (tsconfig.node include).

Merged `--no-ff` into `d1/integration` as `3c51438`; lead wiring `6d504da` (`queue/wiring.ts`, `index.ts`, `test:rls` step).
