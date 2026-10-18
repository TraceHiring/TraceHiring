# D1 C1b writer report (candidate edge, session half) — 2026-10-18

Writer: Opus agent in its own worktree (`.claude/worktrees/agent-a5af1e6c4e791ea3b`), started by Chat A. **Not reviewed and
not merged.** The lead copied this report from the writer's final message (condensed; nothing dropped that the review needs).

- Branch **`d1/c1b-session`**, tip **`ea59b0a`**, based on **`d17b6aa`** (C1a *before* its review fixes). Tree clean.
- **It does not contain the C1a fixes** (`9db46ef..596e7d7`, merged into `d1/integration` as `668225c`). Both sides changed
  `workers/edge/src/edge.test-helpers.ts`, `otp-core.ts`/`otp-do.ts` (C1a) and `route-support.ts`/`http.ts`/`app.ts`/
  `index.ts` (C1b). Chat B first merges `d1/integration` into `d1/c1b-session` and resolves (do not rebase; it is pushed at
  the end of Chat A).
- Each commit was green inside `workers/edge`: vitest (16 files, 309 tests), `tsc --noEmit`, eslint, prettier,
  `check-boundaries`. Not run: `pnpm verify`, `wrangler types --check`.

## Commits
| SHA | Subject |
| --- | --- |
| `3bf142f` | feat(edge): sessiondo, session routes and autosave (at-d24, at-d25) |
| `cb23b82` | test(edge): sessiondo timer and mirror delivery (at-d26, at-d27) |
| `d863c5b` | test(edge): session start and the do clock authority (at-d35, at-d37) |
| `4997052` | refactor(edge): keep each final answer under its own key in the sessiondo |
| `ea59b0a` | test(edge): cross-session and receipt checks on the session routes (at-d11) |

## Files (`workers/edge/src/`)
New: `session-core.ts` (logic over injected kv, transaction, alarm, packages, evidence, mirror, logger, clock),
`session-evidence.ts` (splice, replay, coverage, receiptRef, `events.ndjson`/`final.json`), `session-do.ts` (thin wrapper:
`ctx.storage.kv`, `transactionSync`, `setAlarm`, `PACKAGES?.get(`, `MIRROR_QUEUE.send`), `routes-session.ts`,
`session.test-helpers.ts`. Changed: `index.ts` (real `SessionDO`), `app.ts`, `http.ts` (`EVENTS_BODY_LIMIT`,
`failOutOfOrder(ackSeq)`), `route-support.ts` (`edgeLogger`, `sessionFor`), `edge.test-helpers.ts` (kv list,
`mapTransaction`, bucket `get`/ops log/failure switches, `fakeQueue`, `fakeSessionNamespace`; harness env has SESSION,
PACKAGES, MIRROR_QUEUE).

## Tests per AT line
- **AT-D24/D7** `session-do.autosave.test.ts`: dedupe/gseq, resend idempotent, gap → 409 + `ackSeq`, attach supersedes,
  new login supersedes, unknown stream 400, 5 batches/s, **two streams (L-14)**, **no answer kind/text in events.ndjson
  (L-21)**, attach restores answers/timer/items (RT-4). **AT-D29 maxChars** (whole batch rejected, exactly maxChars ok,
  bad splice/kind/option/item 400, >64 KB 413).
- **AT-D25** same file: seeded property test (mulberry32, 150 seeds) vs an independent model; mutation of `applySplice`
  confirmed to fail it. **Not fast-check** (not resolvable from `workers/edge`).
- **AT-D26** `session-do.timer.test.ts`: started_at once from the DO clock; grace boundary (+60 s accepted, +1 ms 410);
  alarm auto-submits once; client cannot extend; submit idempotent.
- **AT-D27 (edge)** `mirror.test.ts`: one message, final/events/mirror.json before the send; backoff 5/15/60/300 s; 24 h →
  `failed` + `session.mirror_failed`; lease; retried start keeps `startedAt`.
- **AT-D35 edge + AT-D12 (L-13)** `start.test.ts`: refuses without `adultConfirmed`; package missing/hash/schema/too
  large/mismatch → 503 + `session.package_invalid {sessionId, pkg}`; failed DO start → no `sessionStarted`, retry works;
  dead links never touch the DO; photo head-check; identity keys ignored.
- **AT-D37** `clock.test.ts`. **AT-D11 (a)-(d) edge** `cross-session.test.ts`, `receipt.test.ts`.

## Writer decisions where the spec was silent or conflicted (review must confirm)
1. Session token after submit: nonce hash moves to a read-only slot (submit idempotent, attach shows receipt; events/items
   410; other tokens 401). Spec says "cleared on submit".
2. Lobby nonce cleared only after `SessionDO.start` and `sessionStarted` both succeed (RT-11 retry without a new OTP);
   failure to clear → 503.
3. Edge verifies the granted session token (typ, invitation, org, candidate, nonce); mismatch → 503.
4. Photo head-check: missing → 403 `step_required`; sha mismatch → 400.
5. Start after the grace: an existing session is lazily auto-submitted and start answers the receipt; 410 only when a new
   object would be created past the grace; a lost object is recreated with `grant.startedAt` (never extends time).
6. Package checks (missing, >256 KB, sha256, strict schema, version/duration vs grant); `pkg` log value is the cause
   constant, not the R2 key; an R2 outage is 503 with no `package_invalid` line.
7. Lazy auto-submit on any request after deadline + 60 s.
8. Coverage: active = start..min(submit, deadline); `tab_hidden` covers `[arrival − ms, arrival]` clamped; first 50 gaps.
9. Written item without `maxChars` capped at 10 000 chars.
10. Batch: a gap commits the events before it; any invalid event rejects the whole batch; rate limit counts before
    validation; unknown stream 400, older stream 401 `superseded`.
11. Limits per session (fixed windows): events 5/s, attach 6/min, items 60/min (tight for >60 items), submit 6/min; start
    reuses InviteOtpDO's `start` bucket.
12. **Submit order deviates:** state frozen first in the transaction, receipt returned at once, R2 writes + send inline then
    retried by the alarm (shared backoff; 24 h from `submittedAt`; lease 30 s; message built once and reused).
13. Formats: client `len` mismatch → `replay: 'mismatch'` (context only); `resumeCount = streamCount − 1`; final.json
    lists every answered item (cleared choice = null + sha of ''); ndjson lines end `\n`.
14. `MIRROR_TRANSPORT='service'` has no binding: sends fail, the sweep recovers.

## Needs from the lead (lead files)
1. `"fast-check": "catalog:"` in `workers/edge/package.json` devDependencies (then move AT-D25 to fast-check).
2. Test-pool bindings (SESSION, OTP, PACKAGES, EVIDENCE, MIRROR_QUEUE) so the real DO classes run; matching change in
   `no-error-reporter.test.ts` (= C1a SR-6).
3. JOBS → `MirrorRpc` binding only if DC-D2 picks `service`.
No contract change was needed.

## New log events (pin in `log-hygiene.test.ts` at the merge)
`session.package_invalid {sessionId, pkg}` (error, route) and `session.mirror_failed {sessionId, n}` (error, DO). The
redactor turns synthetic ids such as `44444444-…` into `[REDACTED]-[REDACTED]`, so fixtures must not expect raw ids.

## Carried into the C1b review from C1a
- **SEC-1 wiring:** `session/start` must call `otpFor(c, claims.invitation_id).closePhotos()` before its photo `head()`
  (interface in `otp-do.ts`, added by C1a `e31a405`; not on this branch yet). Residual gap: an upload that took its slot
  before the close may still be inside `EVIDENCE.put` when `head()` runs — decide a mitigation in the review.
- C1a SR-6 (real DO tests) = need 2 above.

## Open questions from the writer
- Do decisions 1, 2, 5 and 12 stand?
- Should a resume without `adultConfirmed` also be refused? (It is now; only reachable if the contract's `literal(true)`
  broke.)
