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

Fix writer, 2026-10-18, on `d1/c1a-edge-lobby` from `78923ac`. One commit per finding, test first. All test files are in
`workers/edge/src/`. Each commit ran `vitest run`, `tsc --noEmit`, `eslint --max-warnings=0 src`, `prettier --check src`
(in `workers/edge`) and `node scripts/check-boundaries.mjs`, all green (260 tests at the last fix).

| ID | Commit | Test (file › name) |
| --- | --- | --- |
| SR-8 | `9b395fe` | `otp-do.test.ts` › "a new challenge invalidates the old code" (injected `random`, unconditional) |
| SR-4 | `b13939e` | `photo.test.ts` › "a retake overwrites the same key; the fourth upload is 429 without Retry-After and nothing changes" |
| SR-5 | `0b3c3f9` | `token.test.ts` › "PUT /v1/lobby/photo: a stale lobby nonce …", "… a cleared lobby nonce …", "… expired, session-typed, none-alg and missing tokens are 401" (no api call, no `photoPermit`, no R2 object) |
| SEC-5 | `1cd79ad` | `photo.test.ts` › "jpeg checks (rule 8 …)" table (APP1 Exif, APP2, APP15, COM, bytes after EOI, no final `FF D9`); route table › "an APP1 "Exif\0\0" segment is 415 bad_media", "a COM segment …", "trailing bytes after EOI is 415 bad_media" |
| SEC-1 (a, b) | `e31a405` | `photo.test.ts` › "PUT /v1/lobby/photo after session start (SEC-1)": "every byte check runs before photoPermit …", "after closePhotos an upload is 410 closed …", "a slow upload that started before session start cannot land after it (closed mid-body)" (truly interleaved: a deferred body stream, past lobby auth, closed mid-body → 410, no R2 object, no slot); `otp-do.test.ts` › "closePhotos is set-once …" |
| SEC-4 = SR-1 | `c8b8120` | `photo.test.ts` › "a failed R2 put is 503 and gives its slot back (SEC-4)"; `otp-do.test.ts` › "releasePhotoSlot gives back only the slot it names, once, never below zero (SEC-4)" |
| SR-9 | `24cff5b` | `photo.test.ts` › "a permit for another org than the token is 503 unavailable: nothing stored, no slot (SR-9)" |
| SEC-3 | `ddf6461` | `otp-do.test.ts` › "failures count per invitation across codes: 4 wrong, +30 s, a new code, 1 wrong locks (SEC-3)", "a correct code resets the failure count (SEC-3)", "the end of a lock starts a fresh count of 5 (SEC-3)" |
| SR-7 | `405fb17` | `otp-do.test.ts` › "otp.locked is logged once, by the attempt that locks; a 6th attempt logs nothing (SR-7)"; `log-hygiene.test.ts` › OTP lock case unchanged and green |
| SR-2 | `edaf34a` | `otp-do.test.ts` › "releaseIssue gives back the send and drops the challenge, only while it is current (SR-2)", "a send that fails unavailable gives the send back …", "a send refused with another code keeps the send used (SR-2)" |

Tests changed because they pinned old behaviour: `otp-do.test.ts` "the attempt count is per challenge: 4 wrong, a new
code, 4 wrong does not lock" (replaced, SEC-3); "three photo slots per session" (refusal now `{ ok: false, error:
'rate_limited' }`, SEC-1); "allows 5 attempts per challenge, then locks for 15 minutes" (`lockedNow: true` on the 5th,
SR-7). `log-hygiene.test.ts` (lead file) "lobby routes: api failures log the method only …": its photo body was not a
JPEG and is now refused before `photoPermit` (SEC-1a), so it sends a valid JPEG with the planted values in its scan
data and still drives the `photoPermit` failure.

**C1b interface (SEC-1, carried):** `closePhotos(): void | Promise<void>` on `OtpApi` (`workers/edge/src/otp-do.ts`),
implemented by `InviteOtpDO.closePhotos()` over `OtpCore.closePhotos()` (`otp-core.ts`). Session start calls it on
`otpFor(c, claims.invitation_id)` before its `head()` of the start photo. Residual: an upload whose slot was taken
before the close may still be inside its single `EVIDENCE.put` when `head()` runs; the C1b review should decide whether
that window needs more (for example, C1b re-checks `sha256` after the DO ack).

## Confirming re-review of the fixes (Sonnet, 2026-10-18): CONFIRMED WITH NOTES
Scope `git diff 78923ac 596e7d7 -- workers/edge`. Every "fix now" row is fixed as dispositioned; each regression test
would fail on revert (reasoned from the code); no new defect; the tests changed for old behaviour were made stricter, not
weaker. Notes and lead dispositions:
1. Spec §4.2 otp/verify row still said "per challenge" → fixed in the spec (revision 4d wording).
2. SEC-5 is header walking only: bytes inside or after the first scan are not examined, so a modified client can still
   append data. Accepted for D1 (512 KB cap, size check); a decode-and-re-encode check is a candidate for M4 (capture).
3. SEC-4 releases the slot on any `put` exception, even one thrown after R2 committed: worst case one extra overwrite of
   the same key. Accepted.
4. SR-2: a released resend also drops the previous live challenge; retry works at once. Accepted.
5. `noSlotUsed` keys are proven right by the mid-body test. No change.

**SEC-1 residual (carried to the C1b review, Chat B):** after `closePhotos()` and `head()`, session start should `get`
the object, check its bytes against `customMetadata.sha256`, and pin it (copy to an immutable key such as
`.../start_photo.pinned.jpg`, or record etag + sha and re-`head()` once; on mismatch retry once, else treat as absent).
Heavier option: `confirmPhotoSlot(n)` after the put, with `closePhotos()` returning the in-flight slots (start answers a
retryable 409 until zero).
