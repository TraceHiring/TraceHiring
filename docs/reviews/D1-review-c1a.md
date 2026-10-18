# D1 C1a reviews (candidate edge, lobby half) — 2026-10-18

Scope: `git diff 76f3d69 d17b6aa -- workers/edge` on `d1/c1a-edge-lobby` (writer report: `D1-c1a-writer-report.md`).
The lead added AT-D31/AT-D32 edge tests in `9db46ef` (`no-secrets.test.ts`, `log-hygiene.test.ts`) after the reviews started.

- **Spec review (Opus, fresh context): PASS WITH FIXES.** 7 Minor items, 2 Nits; no rule 1-9 broken. Ran 6 C1a test files (187 tests) green.
- **Security review (Opus): PASS WITH NOTES.** 2 Medium items, 3 Low, 3 Notes; nothing Critical or High.

## Findings and lead dispositions

| ID | Sev | Where | Finding (short) | Lead disposition |
| --- | --- | --- | --- | --- |
| SEC-1 | Medium | `routes-photo.ts:40-69`, `otp-core.ts` | `photoPermit` (`locked`) is checked before the body is read; a slow upload that started before `session/start` can overwrite the pinned start photo afterwards | **Fix now (C1a):** (a) read and validate the body before `photoPermit`; (b) `OtpCore.closePhotos()` sets a set-once flag; `takePhotoSlot()` refuses with `closed` (410) after it. **C1b must call `closePhotos()` on the invitation's InviteOtpDO before its start-time `head()` of the photo** (carried to the C1b merge). Test: deferred body stream, close, release → 410, no R2 write |
| SEC-2 | Medium | `routes-invite.ts` → api `api-db.ts` | Random well-formed link tokens are never rate limited; each resolve opens a Postgres connection, so a loop can exhaust connection slots | **Carried, owner: staging-readiness chat (before the first staging dispatch).** Needs a binding (wrangler is a lead file) and a spec note: volumetric limit at the edge (Workers Rate Limiting binding keyed on a coarse key, never a flag, rule 7) and/or a pooler in front of the api DB URL. Recorded in spec rev 4d as OPEN-13 |
| SEC-3 | Low | `otp-core.ts:150-201` | Attempt counter resets with each new code: 12 guesses per 10 min with no lock | **Fix now:** failures count per invitation across codes; the 5th failure since the last success (or lock end) locks, whichever code it is for. Test: issue, 4 wrong, +30 s, issue, 1 wrong → `otp_locked` |
| SEC-4 = SR-1 | Low / Minor | `routes-photo.ts:62-72` | A failed R2 put still uses a photo slot; 3 transient failures leave only "skip photo" | **Fix now:** `releasePhotoSlot(n)` on a failed put (atomic in the DO). Test: put throws twice → 503, 503; then 3 uploads 200 and the 4th 429 |
| SEC-5 | Low | `jpeg.ts`, `routes-photo.ts` | APP1-APP15 (EXIF, thumbnails), COM and bytes after EOI are accepted, breaking rule 8's "only the processed JPEG" | **Fix now:** reject any APPn other than APP0, reject COM, require the body to end `FF D9`. Header walking only. Tests: APP1 "Exif" → 415; trailing bytes → 415 |
| SEC-6 | Note | `otp-core.ts:216` | Stale-nonce requests use no budget (cost: one ECDSA verify + one DO call, no DB) | Accepted as designed (writer decision 5) |
| SEC-7 | Note | `otp-core.ts:124` | A salted hash of a 6-digit code is reversible offline | Accepted (code also in the api outbox, 10 min life); recorded so nobody relies on it |
| SEC-8 | Note | `routes-invite.ts:86-99` | Nonce rotates before `lobbyMint`; a failed mint costs a code | Accepted (fails closed); candidate app copy explains retry (C2) |
| SR-2 | Minor | `routes-invite.ts:65-72` | `issue()` uses a send slot even when `messagingSend` fails | **Fix now:** release the issue (`releaseIssue(challengeId)`) when `messagingSend` answers `unavailable`. Test: send fails twice, third request succeeds and a code is sent |
| SR-3 | Minor | spec §4.2 vs RT-6 | "3 per 10 min" vs "3 resends per 10 min" | **Lead: §4.2 wins** (3 codes in total: one send plus two resends). Spec rev 4d rewords RT-6 |
| SR-4 | Minor | `routes-photo.ts:64` | 4th upload is 429 without Retry-After; §4.2 lists every 429 with Retry-After | **Lead: keep 429 `rate_limited` without Retry-After** (the cap is permanent for the session); spec rev 4d notes it; `photo.test.ts` asserts the header is absent |
| SR-5 | Minor | `token.test.ts:219-227` | The every-lobby-route table leaves out `PUT /v1/lobby/photo` | **Fix now:** add photo (body + hash header), assert no `photoPermit` call and no R2 object |
| SR-6 | Minor | `otp-do.ts` | No test runs the real `InviteOtpDO` (no OTP binding in the test pool) | **Carried, owner: C1b review chat** (lead files: vitest config, test-pool wrangler, `no-error-reporter.test.ts`); due before D1 CLOSE |
| SR-7 | Minor | `routes-invite.ts:89-92` | `otp.locked` logged on every refused verify during the lock | **Fix now:** OtpCore returns `lockedNow: true` only on the attempt that creates the lock; log only then. Test: 5th wrong logs one line, 6th logs none |
| SR-8 | Nit | `otp-do.test.ts:84` | Conditional assertion skipped on a 1-in-10^6 collision | **Fix now:** inject `random` into OtpCore; assert unconditionally |
| SR-9 | Nit | `routes-photo.ts:66` | Key `orgId` from `photoPermit` is not compared with `claims.org_id` | **Fix now:** mismatch → 503 `unavailable`, no object stored |

Writer decisions 1-10 and open question OQ1 (rule 9: refuse `blocked_age`/`expired`/`revoked`, allow `started`/`submitted`): consistent with the spec per the spec review; **no founder question needed**. OQ2 (test-pool bindings) = SR-6.

## Fix record

(filled in as fixes land)
