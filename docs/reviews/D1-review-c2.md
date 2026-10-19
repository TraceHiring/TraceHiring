# D1 review — stream C2 (candidate app) and the lead's e2e-local real flow

Date: 2026-10-19 (Chat D, BUILD Wave 2b). Spec: `specs/d1-demo-slice.md` revisions 4e–4i, §4.1–§4.8, §7.1, §7.2, §11 C2 row.

- C2 diff: `git diff 81df093 d1/c2-candidate -- apps/candidate` (writer tip `b112637`, Opus writer).
- e2e-local diff: `git diff 301ba70 c8b1f62 -- scripts e2e` (Opus writer on `d1/e2e-real-flow`, placed by the lead at `c8b1f62`).
- Reviews (read-only, Opus, run in parallel, each told the other's focus): **spec-reviewer PASS WITH FIXES** (C2); **security-reviewer PASS WITH NOTES** (C2 and e2e-local; SEC-E1 to be fixed before `main`).

## Pre-flight and lead work before and during the writers
- Pre-flight (Sonnet, read-only) found three gaps, closed by the lead first: no DOM test runtime (`81df093`: happy-dom 20.14.5 + fast-check in `apps/candidate` devDependencies; jsdom 30 needs undici 8, pinned to 7 by the security override), no `VITE_EDGE_ORIGIN` in any build (`3fadfd1`, `301ba70`: the deploy-staging build sets the literal `https://trace-edge-staging.abhayraj.workers.dev`, pinned by `check-workflows`), no PhotoStep chunk budget (`45ad571`: `check-bundle-size` ≤ 60 kB gzip and camera code only in that chunk).
- The first real e2e-local run found that Chromium's `canvas.toBlob('image/jpeg')` writes an APP2 ICC profile (472 bytes) that the edge refuses (415). Lead decision, spec revision 4i (`fc78330`): the edge stays strict; the client strips APP1–APP15 and COM before hashing and uploading.
- e2e-local real flow: 6/6 candidate-store tests pass locally (87 s) and on Linux CI (run 39211084129, e2e-local OK in 186 s). **Closes r3a #1** (the real trace_api SQL of the candidate store: resolve, OTP, age, consent, photo, start, submit, receipt on re-login, minor's block, revoke, expire, and the mirror, quality and integrity jobs).

## Spec review (C2) — PASS WITH FIXES

| id | sev | where (b112637) | finding | disposition |
| --- | --- | --- | --- | --- |
| SR-1 | High | `test/signals.ts:97-112` | `untrusted_input` emitted only when its 5 s window closes, while the injected `answer.text` is sent within 2 s; a reload or close at ~3 s loses the signal | fix now (test first) |
| SR-2 | Medium | `test/Timer.tsx:21-23`, `test/Test.tsx:178-186` | mounting past the deadline: auto-submit runs before the outbox exists and never retries | fix now |
| SR-3 | Medium | `test/Test.tsx:151, 88-98` | item 410 past the deadline calls `attach`, which supersedes the live stream and ends as "invalid" | fix now |
| SR-4 | Medium | `test/outbox.ts:267-285` | 10-minute compaction drops unsent signals | fix now (keep signals, drop heartbeats) |
| SR-5 | Medium | no `Test` component test | submit, time-up, 410, superseded, offline paths untested | fix now (`test/Test.test.tsx`) |
| SR-6 | Low | `test/outbox.test.ts:260-267` | rate test passes trivially | fix now |
| SR-7 | Low | `test/clock.ts`, `flow.ts:144` | no client clock-skew or announcement tests | fix now |
| SR-8 | Low | `Test.tsx:203-207` | manual submit in flight at zero swallows the auto submit | fix now |
| SR-9 | Low | `candidate-guards.test.ts:131-138` | silent pass if `camera.ts` is renamed | fix now |
| SR-10 | Note | `photo/blur.test.ts:95` | a much weaker blur would pass AT-D9 | fix now (stricter case) |
| SR-11 | Note | `test/signals.ts:75-87` | `dragover` not prevented; a dropped file can navigate away | fix now |

Writer decisions: 1 (in-test paste prevented, not recorded) accepted; 2 (10-minute compaction) changed by SR-4; 3 (400/413 batch handling) accepted; 4 (`next:'start'` sends `declined`) accepted for D1, edge follow-up below; 5 (camera only after "Turn on camera"), 6 (fullscreen in the Start click, refusal tolerated) accepted; 7 (`untrusted_input` per item and `via`) accepted, timing changed by SR-1; 8 (offline manual submit) accepted after SR-2/3/8; 9 (AT-D9 metric) accepted; 10 (≤ 4 batches/s) accepted, test fixed by SR-6.

## Security review — C2 PASS WITH NOTES; e2e-local PASS WITH NOTES

| id | sev | where | finding | disposition |
| --- | --- | --- | --- | --- |
| SEC-1 | Low | `photo/PhotoStep.tsx:128-164` | overlapping camera starts can orphan a stream (camera stays on, rule 8 "every track stopped") | fix now |
| SEC-2 | Low | `App.tsx:87`, `test/Test.tsx:78-85` | sessionStorage keeps answer text after submit; never read back | fix now (store views without answers) |
| SEC-3 | Low | edge `routes-session.ts:194-214` | a lost DO recreated on a resume records `declined` although the canonical photo exists (can only move Clear → Insufficient evidence) | **carried to M3a** (edge: adopt the canonical photo hash on recreate) |
| SEC-4 | Note | `candidate-guards.test.ts:193` | helper-import regex misses `.js` specifiers | fix now |
| SEC-5 | Note | edge and client `jpeg.ts` | APPn/COM after the first SOS are not inspected (hand-crafted uploads only) | **carried to M4** (joins "SEC-5 deeper JPEG check") |
| SEC-6 | Note | `public/_headers:7` | `microphone=(self)` though never used | carried: spec change for later hardening (check-headers pins the value) |
| SEC-7 | Note | `test/AnswerEditor.tsx:31` | spellcheck can send answer text to a browser vendor's service | fix now (lead decision: `spellCheck={false}`) |
| SEC-E1 | Medium | `scripts/e2e-local.mjs` operator calls | a `TRACE_OPERATOR_DB_URL` in the shell would point create-org/add-member at a non-local DB | fix now (force the local URL; refuse a non-local value) |
| SEC-E2 | Low | `scripts/e2e-local.mjs:516-519` | signal path leaves the login roles | fix now |
| SEC-E3 | Note | `scripts/e2e-local.mjs` finally | a throwing log write could skip removing the env files | fix now (remove the state dir first) |
| SEC-E4 | Note | `e2e/tests/candidate-store.spec.ts` | no loopback check on the target URLs | fix now |

Checked clean by the security review: camera only in `camera.ts` with `audio:false`, only after consent, tracks stopped on take/skip/unmount; blur is a real control; JPEG strip refuses malformed input and the hash covers the uploaded bytes; CSP exact; tokens (fragment cleared, link and lobby in memory); signals metadata only; no XSS sink; logs literal; receipt only `receiptRef` and `submittedAt`; e2e-local values loopback-only, hex-checked SQL on stdin, redacted output, transactional trigger toggle.

## Fix rounds
(filled in below by the lead as the fixes land, with commits and the confirming re-review)
