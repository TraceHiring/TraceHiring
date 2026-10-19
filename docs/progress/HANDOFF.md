# HANDOFF — 2026-10-19 13:25 IST (end of Chat D)
Reason for stopping: **Chat D's task is done** (C2 candidate app and the `e2e-local` real flow merged, verified, tagged `cp/d1-09`). Claude Max: one chat = one big task (`docs/progress/SESSION-PLAN.md`; AUTOPILOT §6 first bullet). Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt). The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (no `m*-reviewed` tag, `main` still `fe77a87`). M0a and M0b are built, reviewed and fixed but **not CLOSED** (founder gates, "Path to close" unchanged).
- **D1 ≈ 92%**: Wave 0 (`cp/d1-03`), R1 (`cp/d1-04`), R3 (`cp/d1-05`), C1a (`cp/d1-06`), C1b (`cp/d1-07`), R2 + R4 (`cp/d1-08`), **C2 + e2e-local real flow (`cp/d1-09`)**. Left: staging + R5 (Chat E), D1 REVIEW (F), FIX + CLOSE (G).
- **Current phase: D1 BUILD, Wave 2b done → Chat E (staging readiness) next.**

## Where we are (verified this chat)
- **`d1/integration`** = `986540f` + this handoff. **Full `pnpm verify` exit 0 on `3e82da6`** (candidate 239, edge 387, api 383, jobs 240, recruiter 354, scripts 2243 + 1 skipped; test:rls 32 files, rls 2616, catalog 142, jobs db tests; build: candidate initial JS 81.8 kB gzip, PhotoStep chunk 3.5 kB). `986540f` only widens one e2e timeout: verify:fast exit 0 (203 s). **CI on PR #4 green on `986540f`** (run 39217597910: static, rls, security, migrations, **e2e-local 17 passed incl. both new specs on Linux**). **Tag `cp/d1-09` → `986540f`** (pushed).
- **C2** (Opus writer): `d1/c2-candidate` `b112637` → 12 fix commits → `58c0d76` → merged `ffe134f`. Reviews `docs/reviews/D1-review-c2.md`: spec PASS WITH FIXES (SR-1 High fixed), security PASS WITH NOTES, Sonnet re-review CONFIRMED WITH NOTES.
- **e2e-local real flow** (Opus writer, lead files): `d1/e2e-real-flow` → placed `c8b1f62`, security fixes SEC-E1..E4 + UI recruiter → `04d9e87`. `e2e/tests/candidate-store.spec.ts` runs the real trace_api candidate SQL end to end — **closes r3a #1** (record in the D1 summary). `e2e/tests/candidate-ui.spec.ts` (Sonnet writer, cherry-picked `1229158`, `3e82da6`) drives the real candidate app in Chromium (camera after consent, stripped JPEG, reload, receipt).
- Lead commits: `81df093` (happy-dom 20.14.5 + fast-check dev deps), `45ad571` (check-bundle-size: PhotoStep ≤ 60 kB, camera code only there), `3fadfd1` + `301ba70` (staging build `VITE_EDGE_ORIGIN` literal, pinned), `fc78330` (spec rev 4i), `8cf8754` (rev 4j), `ba01686` + `49464ea` (review record), `986540f` (CI encode timeout).
- Writer worktrees (keep): `agent-a84897a107df571f2` (c2), `agent-a5394f62ea06afe3b` (e2e-real-flow), `agent-a0fd42cca54c9517e` (e2e-candidate-ui). Scratch branch `d1/c2-trial` (`b018cf3`, the pre-merge trial; local only, keep).
- Unchanged: `main` `fe77a87`, `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`; tags `cp/d1-01..08`.

## Next chat: **Chat E — staging readiness**. Done when staging is deployed and smoked, AT-D1/D2 E2E green, `cp/d1-10`.
## Next step (in order)
1. Verify (below). If anything differs from this file, stop and report.
2. Lead, before any staging dispatch (tests first): **OPEN-13** (edge volumetric limit for `invite/resolve` and `otp/*`; spec §11 OPEN; may need a wrangler binding and an ADR if it adds a Cloudflare product); **R4 re-review note 1** (`apps/recruiter/src/main.tsx` passes only the env fields it needs; `check-no-demo-outbox` then skips only when `VITE_TRACE_ENV !== 'production'`); **R5 prerequisite (rev 4i)**: the recruiter headers template (`packages/config/vite/headers-template.js`) accepts local Supabase/api origins for an explicitly local build, so `e2e-local` can build the recruiter with sign-in config and R5 can drive the recruiter UI locally.
3. **Ask the founder** (gate): widen the Cloudflare token (R2 + Queues Edit); run the key script and set `CANDIDATE_TOKEN_KID`, `CANDIDATE_TOKEN_PUBLIC_JWK`, `API_STAGING_ORIGIN`; the jobs DB login secrets; per `scripts/ops/README.md`. Then the first `workflow_dispatch` from `d1/integration`, smoke, DC-D8.
4. Writer **R5** (Sonnet; `e2e/tests/d1-slice.spec.ts`, `e2e/support/**`; reuse `e2e/support/{auth,outbox,candidate,jpeg,http,recruiter}.ts`); spec + security review; `e2e-staging`; tag `cp/d1-10`.
5. Carried, due later: **M3a:** C2 SEC-3 (edge: on a recreated DO for a started session adopt the canonical photo hash instead of a client skip); revoke `private.mirror_session` from `trace_worker` + `mirror_seq` (DB-6); gap-signal key space (DB-12); SessionDO `events.ndjson` single `Uint8Array` (C1b note 4). **M4:** C2 SEC-5 joins "SEC-5 deeper JPEG check" (APPn/COM after the first SOS); visible timeline cut (F3). **M5:** grader outside the transaction (DB-7). **D1 REVIEW notes:** C2 RR-2 (tests for `toBlob` null / `arrayBuffer` reject), RR-4 (tighten the SR-10 bound), e2e-local `h.stop()` reject skips state-dir removal, SEC-E4 has no unit test. **Spec hardening:** C2 SEC-6 `microphone=()` (check-headers pins today's value). Earlier carries unchanged (M7 SessionDO deletion + media prefix; N1 org CORS (R5); N3 `redact_query_string`; db n-4 (M1); m2 n-1 (M3a); m3 n-7 (M4); O2 fix-forward rubric shape; `MIRROR_TRANSPORT='service'` only if DC-D2 picks it).

## Decisions this chat (spec revisions 4i, 4j; `docs/reviews/D1-review-c2.md`)
- Chromium's canvas JPEG carries an APP2 ICC profile: the edge stays strict; the client strips APP1–APP15 and COM, and the hash covers the stripped bytes (4i).
- `VITE_EDGE_ORIGIN` = literal `https://trace-edge-staging.abhayraj.workers.dev` on the staging build (no new founder variable); `http://127.0.0.1:8787` in e2e-local; the app fails closed without it (4i).
- happy-dom (not jsdom) for candidate DOM tests (undici override). PhotoStep chunk ≤ 60 kB and the only place for camera code (4i).
- `untrusted_input` first event sent at once; signals survive offline compaction; sessionStorage never holds answers; spellcheck off; camera only on "Turn on camera" (4j).
- e2e-local: per-run local login roles (dropped at the end), in-memory ES256 keys, env files in the temp state dir, a non-loopback `TRACE_OPERATOR_DB_URL` refuses the run.

## Founder items (`docs/progress/FOUNDER-QUEUE.md`)
- **Due in Chat E (before the first staging dispatch):** widen the Cloudflare token (R2 + Queues Edit); key script + `staging` variables (`CANDIDATE_TOKEN_KID`, `CANDIDATE_TOKEN_PUBLIC_JWK`, `API_STAGING_ORIGIN`); `JOBS_{MIRROR,QUALITY,INTEGRITY}_DB_URL`. Unchanged: Rule 9 correction question (M3a); S1 residual risk; H9, H11, SES SMTP, Workers Paid only if DC-D2/D8 need it.

## Gotchas
- **Reviewers share the lead's worktree:** a re-reviewer ran `git checkout` mid-run (reflog 12:47, nothing lost). Every reviewer brief must say "read other revisions with `git show` / `git diff` only; never checkout, switch, stash or reset".
- Worktree guard: no heredocs, `$(…)`, loops or git in another worktree from this session; run `node` in another worktree with a plain `cd`. Use the Edit tool for multi-line edits.
- Scripts tests run from `scripts/` (`cd scripts && pnpm exec vitest run`); running `vitest -c scripts/vitest.config.mjs` from the root picks up the whole repo. The `scripts/` folder is not eslinted (prettier only).
- e2e-local locally ≈ 90 s; the recruiter build there has no Supabase/api origins (headers template). CI runners encode the JPEG slowly the first time (allow 30 s).
- commitlint: body lines ≤ 100; `merge:` type refused (use `chore: merge …`); lowercase subject. gitleaks: no `KEY` identifier next to a uuid literal.
- Short RAM: `npm_config_workspace_concurrency=1`; never two chats running verify or db commands at once.
- Usage on Max (Chat D): 3 Opus writers (C2, e2e, C2 fixes), 1 Sonnet writer, 2 Opus reviews, 1 Sonnet pre-flight, 1 Sonnet re-review, six e2e-local runs, one full verify: 49% → 58% of one 5-hour window, then 2% → 24% of the next; weekly 11% → 18%; context ~40%.

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` (tip = this handoff) · `git rev-parse --short "cp/d1-09^{commit}"` (`986540f`) · `git status` (clean) · `docker ps` · `npm_config_workspace_concurrency=1 pnpm -s verify:fast` · `gh pr checks 4 --repo TraceHiring/TraceHiring`
