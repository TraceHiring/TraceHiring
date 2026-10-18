# D1 C1b reviews (candidate edge, session half) — 2026-10-19

Scope: `git diff 668225c 99829b8 -- workers/edge` on `d1/c1b-session` (`99829b8` = writer tip `ea59b0a` merged with
`d1/integration` @ `22590fe`, which holds C1a and its fixes). Writer report: `D1-c1b-writer-report.md`.

- **Spec review (Opus, fresh context): PASS WITH FIXES.** 4 Minor, 1 Nit, 1 Note; no rule 1-9 broken. 18 files / 350
  tests, 349 green; the one red test is the static log allow-list for the two new events (lead step, pinned below).
- **Security review (Opus): PASS WITH NOTES.** 3 Medium, 2 Low, 1 Note; nothing Critical or High. "Do not merge until
  SEC-C1b-1 lands."

## Findings and lead dispositions

| ID | Sev | Where | Finding (short) | Lead disposition |
| --- | --- | --- | --- | --- |
| SEC-C1b-1 = SR-6 | Medium | `routes-session.ts:122-126` | `closePhotos()` (C1a SEC-1) is not called at session start | **Fix now (W2):** after the granted-token check (a refused grant must not lock uploads), before any photo read, on the photo and the skip path; close failure → 503, no start |
| SEC-1 residual | (C1a carry) | `routes-photo.ts:72`, start | An upload that took its slot before the close can land after start's check | **Fix now (W2), security reviewer's design:** uploads write a working key `start_photo.upload.jpg`; start gets it, checks size + hash (declared and metadata), the DO stores the photo hash once, and only start writes the canonical `start_photo.jpg` with bytes of that hash. A new immutable key was rejected: the DB guard (`20261014094801_d1_invites_sessions.sql:727`) and api `media-link.ts:229` hard-code `start_photo.jpg`. Spec rev 4e §4.5 |
| SEC-C1b-2 | Medium | `session-core.ts:648-686, 749-781`, `session-evidence.ts:193-209` | No per-session cap on stored events or bytes; finalise could exceed the DO's 128 MB and never mirror | **Fix now (W3):** 50 000 stored events, 20 MB stored payload (413 `too_large`, batch refused whole), one stored heartbeat per 5 s. Spec rev 4e §4.2 |
| SEC-C1b-3 | Medium | `session-core.ts:842-907` | A process killed mid-delivery leaves the lease; the 24 h give-up never runs | **Fix now (W3):** count the attempt and check 24 h when the lease is taken |
| SEC-C1b-4 | Low | `session-core.ts:565-566` | Items served during the 60 s grace | **Fix now (W3):** `item()` 410 `closed` after `deadline_at`; events keep the grace |
| SEC-C1b-5 | Low | `session-core.ts:338-368` | After submit the read-only token's `attach` returns all answer text | **Fix now (W2):** receipt only, `answers: []` (lead prefers least data over the spec review's "own answers are allowed") |
| SR-5 | Nit | `session-core.ts:344` | After submit an older token gets `token_invalid`, not `superseded` (RT-3) | **Fix now (W2)** |
| SR-2 | Minor | `session-do.ts` | No test runs the real DO wrapper (= C1a SR-6) | **Fix now (W1, lead files):** test-pool bindings + real-DO tests (edge and api DOs); `no-error-reporter.test.ts` pins the exact binding set |
| SR-3 | Minor | `session-do.autosave.test.ts:344-438` | AT-D25 is a seeded PRNG loop, not fast-check | **Fix now (W1):** `fast-check` devDependency (catalog 4.10.2), property test ported |
| SR-4 | Minor | spec AT-D11(b) vs `session-core.ts:614-616` | B's `streamId` is refused 400, not "ignored" | **Spec amended (rev 4e)**, code kept |
| SR-1 | Minor | `session-do.ts:53-61` | `MIRROR_TRANSPORT='service'` not built | **Carried** to DC-D2 / OPEN-9 (only if `service` is chosen) |
| SEC-C1b-6 | Note | SessionDO storage | No deletion path | **Carried to M7** (retention) |
| Log pins | (lead) | `log-hygiene.test.ts` | `session.package_invalid {sessionId, pkg}`, `session.mirror_failed {sessionId, n}` unlisted | **Fix now (W2 drafts, lead places):** listed + both paths driven with planted values |

**Residuals of the working-key design (W2 report; all fail closed: no photo is shown, nothing leaks).** (a) A first
canonical put fails, an in-flight upload then replaces the working copy, and the retry declares that new photo: the DO
keeps S1, nothing is pinned, the canonical object is missing. (b) The deadline auto-submit runs before a retried pin:
the mirror names a canonical key that does not exist. (c) A late upload after the working copy was deleted leaves an
orphan under the session's media prefix. Lead: accepted for D1. **Carried:** (a)+(b) to the R2 jobs stream (Chat C):
the mirror stage `head`s the canonical key and writes `media_objects` only when it exists with the mirrored `sha256`;
(c) to M7: retention deletes by the session's media prefix.

## Fix record (2026-10-19, three Opus writers in parallel, each in its own worktree from `99829b8`, tests first)

| ID | Commit | Tests (file › name, short) |
| --- | --- | --- |
| SEC-C1b-1 = SR-6 | `df24dae` | `start.test.ts` › "session/start closes the photo step before it reads the photo (C1a SEC-1)": order grant → close → read; refused grant leaves uploads open; skip path closes; later upload 410, no R2 write; close failure 503, nothing starts; retry works |
| SR-5, SEC-C1b-5 | `af43006` | `start.test.ts` › "session tokens after submit": older token 401 `superseded`; final token reads its receipt; attach after submit has no answer text |
| SEC-1 residual | `e2a5657` | `start.test.ts` › "session start pins the photo from the working key (SEC-1 residual)": in-flight upload after start leaves canonical = DO = mirror hash; canonical written once, by start; resume with another photo changes nothing; resume after the working copy went; bad bytes/metadata/size 400 with no DO call; failed pin 503 then retry with the first `startedAt`; static: `routes-photo.ts` never names the canonical key. `photo.test.ts` key assertions and `mirror.test.ts` photo test moved to the working key (behaviour change, not weakened) |
| Log pins | `8d00508` | `log-hygiene.test.ts`: both events and fields `sessionId`, `pkg`, `n` listed; invalid package (hash, schema) with planted values logs one `package_invalid` with the cause constant; 24 h mirror failure logs `{n, sessionId}` only |
| SEC-C1b-2 | `8c953a8` | new `session-do.limits.test.ts` (6): heartbeat flood bounded, finalise succeeds, `gaps: []`; honest 10 s cadence fully stored; 50 000-event and 20 MB (UTF-8) crossings refused whole, 413 over HTTP, survives a restart. **Lead accepts** the writer's heartbeat bucket (12, refill one per 5 s) over "one per 5 s": three AT-D24 tests send several heartbeats in one batch; same order of bound. A 30 s false gap needs a flooding client: accepted |
| SEC-C1b-3 | `56acbd1` | `mirror.test.ts` › "a delivery killed mid-attempt keeps counting; past 24 h the alarm marks failed once and stops" |
| SEC-C1b-4 | `e4fffa7` | `session-do.timer.test.ts` › "prompts are served up to the deadline only …", "over HTTP an item read after the deadline is 410 closed" |
| SR-3 | `4ff20fa` | AT-D25 on `fc.asyncProperty`, seed 20261018, 150 runs, independent model kept; an `applySplice` mutation fails it (shrinks to 5 steps) |
| SR-2 (= C1a SR-6) | `31fdd84`, `2287c0c`, `d488b65` | vitest projects `edge`/`edge-do` and `api`/`api-do`: miniflare-only bindings (no wrangler file or env block changes, nothing deployable); `otp-do.real.test.ts`, `session-do.real.test.ts` (start, dedupe across attach, alarm auto-submit writes the three objects and sends one message, `acked`), `outbox-do.real.test.ts`, `media-link-do.real.test.ts`; `no-error-reporter.test.ts` pins each pool's exact binding set |

Combined tip after placing: edge 22 files / 384 tests, api 33 / 379, all green; tsc, eslint, prettier, check-boundaries green.

## Writer decisions 1-14 (lead)
1 **stands** with SEC-C1b-5 (read-only slot, receipt only; spec §4.3 amended). 2 **stands** (replay needs the candidate's
own lobby token; RT-11). 3, 4 agree. 5 **stands** (`Math.min(grant.startedAt, now)` never extends time; §4.4 amended).
6-11 agree (11's counters do not bound storage: SEC-C1b-2). 12 **stands** with SEC-C1b-3 (§4.4 Submit amended, caveat:
R2 down 24 h → no `mirror.json`, `session.mirror_failed` is the signal). 13 agree. 14 fails closed; production uses
`queue` (SR-1 carried). Open question: a resume without `adultConfirmed` stays refused (`start.test.ts:45-52`).
All recorded in spec revision 4e.
