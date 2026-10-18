# D1 C1a writer report (candidate edge, lobby half) — 2026-10-18

Writer: Opus agent in its own worktree, stopped early by the lead at the usage limit. Tree clean, nothing uncommitted.
**Not reviewed and not merged yet.** The lead copied this report from the writer's final message.

- Branch `d1/c1a-edge-lobby`, tip `d17b6aa`, based on `76f3d69` (`cp/d1-05`).
- Each commit passed, inside `workers/edge`: vitest (9 files, 219 tests), `tsc --noEmit`, `eslint --max-warnings=0`, prettier and `scripts/check-boundaries.mjs`. Not run: `pnpm verify`, `wrangler types --check`.

## Commits

| SHA | Subject |
| --- | --- |
| `9b5c1a3` | feat(edge): common candidate rules and the candidaterpc client |
| `4da8c41` | feat(edge): verify candidate tokens at the edge (at-d23) |
| `093c9d5` | feat(edge): inviteotpdo and the invite and otp routes (at-d28) |
| `3663af0` | feat(edge): lobby age, notice and consent routes |
| `d17b6aa` | feat(edge): start photo upload route (at-d29 photo half) |

## Acceptance tests (files under `workers/edge/src/`)

- **AT-D23** `token.test.ts`:
  - "verifyCandidateToken (AT-D23)": wrong alg or none, unknown kid, wrong typ, lifetime over cap, expired, iat skew, edited claims (also AT-D11 a).
  - "the public key var fails closed": missing, empty, malformed or private-member var → 503.
  - "lobby routes refuse a bad token before api is called": stale nonce 401 superseded, cleared nonce 401 token_invalid.
- **AT-D28** `otp-do.test.ts`: "OtpCore issue (resend limits)", "OtpCore verify (attempts, lock, expiry)", "OtpCore lobby nonce and limits", "invite and OTP routes".
- **AT-D29 (photo half)** `photo.test.ts`, "PUT /v1/lobby/photo (AT-D29)": JPEG magic, 413, dimensions, hash, deterministic key, 3 uploads, permit, locked. The `maxChars` batch rejection belongs to C1b (session events).
- Common rules: `http.test.ts`, `rpc.test.ts`. Lobby routes: `lobby.test.ts`.

## Not done (budget stop)

- Step 6: `no-secrets.test.ts` (AT-D31 edge part) and `log-hygiene.test.ts` (AT-D32 edge half). check-boundaries rule 1 scans edge test files too, so credential names must be built at run time.
- All of C1b: `SessionDO`, the `session/*` routes, the mirror and the clock. `index.ts` still holds the `SessionDO` stub.

## Pieces C1b can reuse

- `route-support.ts`: `lobbyAuth` (bucket `start` at 6/min already in `LOBBY_LIMITS`), `rpc`, `otpFor`, `otpCall`, `refuse`.
- `http.ts`: `handle`, `fail`, `readJson`, `sendJson`, `bearer`, `capBody`.
- `token.ts`: `verifyCandidateToken(token, env, 'session', nowSec)`.
- `otp-do.ts`: `InviteOtpDO.clearLobbyNonce`, to call at session grant.
- `routes-photo.ts`: `startPhotoKey`.
- Test harness: `edge.test-helpers.ts` (fake API, OTP namespace, R2, clock) and `token.test-helpers.ts`.

## Writer decisions where the spec is silent (for the reviewers)

1. **DO tests.** The test pool has no OTP binding (the vitest config and wrangler are lead files). The logic is `OtpCore` over `ctx.storage.kv` (the synchronous KV of SQLite-backed DOs), tested on a Map fake as api does for `MediaLinkDO`. The real `InviteOtpDO` class is a thin wrapper that no test runs.
2. **OTP limits.**
   - "3 per 10 min" counts every code issued, including the first: one send plus two resends.
   - The 5th wrong code answers 429 `otp_locked` and starts the 15-minute lock. A lock also refuses new OTP requests.
   - An expired code, or a verify with no challenge, is 401 `otp_wrong` and counts no attempt.
3. **Lobby nonce.** The edge DO generates it at verify and stores only its hash, before calling `lobbyMint`. If `lobbyMint` then fails, the old lobby token is already dead.
4. **Stale and missing nonces.** A stale nonce (a newer login) is 401 `superseded`. No stored nonce (cleared, or a token for another invitation) is 401 `token_invalid`.
5. **Rate limits.** 10/min per invitation per route (age, notice, consent, photo), in a fixed 60 s window. A token with a stale nonce uses no budget. Photo also gets the 10/min, which the spec does not state.
6. **Photo.**
   - The 3-upload cap is counted atomically in `InviteOtpDO`, because R2 head-then-put is not atomic. R2 `customMetadata.n` records the count.
   - The 4th upload is 429 `rate_limited` with no Retry-After (the cap is permanent).
   - `locked` from photoPermit is 410 `closed`.
   - A rejected body uses no slot.
7. **JSON routes** require `content-type: application/json` (400 otherwise), so a browser always preflights. Auth runs before body validation.
8. **503 `unavailable`** for a missing or invalid key var, a missing binding, a DO failure, or an RPC answer that breaks its contract. The route wrapper `handle()` returns it, because the shared error path would log it and answer 500.
9. **RPC errors.** The RPC client maps an api error message to its code only when it is an exact code in the contract list; anything else becomes `unavailable`.
10. **Log lines** emitted: `candidate_rpc.unavailable {method}` and `otp.locked {invitationId}` only.

## Open questions

- **Rule 9 (minor).** otp/request and otp/verify refuse `blocked_age`, `expired` and `revoked`, using `inviteResolve`'s state, before any OTP exists. `started` and `submitted` are allowed, so a later login can resume or see the receipt. Lead to confirm in the C1a review.
- **Lead request.** Add OTP, SESSION and EVIDENCE bindings to a test-pool config so the real DO classes run in tests. The `no-error-reporter.test.ts` check that the pool env holds only VERSION would need the matching change.
- No contract change and no new binding were needed.
