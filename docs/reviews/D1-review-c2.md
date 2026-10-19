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
- **C2 (Opus, the original writer, tests first):** `d1/c2-candidate` `b112637..58c0d76` (12 commits): SR-1 `93f6212`, SR-4 `d7802b6`, SR-6 `9c7cd18`, SR-11 `6c8d009`, SR-7 `84e649f`, SR-10 `03edec9`, SR-9 `f9d7cd8`, SEC-4 `04f5d69`, SEC-7 `7f71044`, SEC-1 and the lead item (photo buttons disabled until the stripped JPEG is ready) `3e14d31`, SEC-2 `ee55f1a`, SR-2 + SR-3 + SR-8 with the SR-5 tests `58c0d76` (one commit: all three change `submit()` in `Test.tsx`). Candidate tests 208 → 239; initial JS 81.8 kB gzip, PhotoStep chunk 3.47 kB.
- **e2e-local (Opus, lead files):** `d1/e2e-real-flow` `bd1f898..05a8051`: SEC-E1 `0aa5c78` (exit 1 on a non-loopback `TRACE_OPERATOR_DB_URL`; the variable is removed from the operators' env, stronger than forcing it, and keeps the docker-exec fallback), SEC-E2 `5cb59ab`, SEC-E3 `b4992b5`, SEC-E4 `6684d3c`, plus `05a8051` (a dedicated `e2e-ui-recruiter@example.test`); placed at `04d9e87`.
- **Real Chromium:** `e2e/tests/candidate-ui.spec.ts` (Sonnet writer, lead file) drives the real candidate app: fragment cleared, OTP, age, consent (notice text and hash), `getUserMedia` exactly once with `audio:false` after the consent response, every track stopped, the PUT body a JPEG with no APP1–APP15/COM and a matching hash, test, reload restores answers and a smaller timer, submit, receipt only; every request to the candidate or edge origin only. e2e-local on the trial integration: 17 passed in 95 s.
- **Confirming re-review (Sonnet, one agent for both rounds):** C2 **CONFIRMED WITH NOTES**; e2e-local **CONFIRMED**. RR-1 (spec drift) fixed in spec revision 4j. Carried to D1 REVIEW: RR-2 (no test for the `toBlob` null and `arrayBuffer` reject branches of the photo step), RR-4 (tighten the SR-10 32 px bound after re-measuring), the e2e-local note that a rejecting `h.stop()` would skip the state-dir removal, and SEC-E4 has no unit test (it runs in every e2e-local run). RR-3 accepted (only a window's remainder count can be lost on unload).
- Process note: the re-reviewer ran `git checkout` in the lead's shared worktree (reflog 12:47) and moved it mid-run; nothing was lost. Reviewer briefs now say "read other revisions with `git show`/`git diff` only".
