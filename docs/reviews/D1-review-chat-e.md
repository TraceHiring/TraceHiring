# D1 review — Chat E (staging readiness: OPEN-13 edge limit, recruiter env, staging secrets script, org CORS)

Date: 2026-10-19 (Chat E, BUILD). Spec: `specs/d1-demo-slice.md` revision 4k (this branch `d1/chat-e-docs`), §3, §4.2, §4.8, §6.2, §7.1, §7.2, §8, §9, §11. ADR: `docs/adr/ADR-032-edge-link-rate-limit.md`.

Four streams, each on its own branch, each with a spec review and a security review (read-only agents). The lead merged each stream into `d1/integration`; the tip before this record is `f3af009`.

| Stream | Branch | Writer tip (+ fixes) | Merge | Spec review | Security review |
| --- | --- | --- | --- | --- | --- |
| W1 edge link rate limit (OPEN-13) | `d1/open13-edge-limit` | `2061dcb` (+ `51f96b0`, `eba9dec`) | `502737e`, fix merge `2704e1b` | PASS WITH FIXES | PASS WITH NOTES |
| W2 recruiter env and local origins | `d1/recruiter-env-local` | `202d933` (+ `15e38c5`, `cee0725`) | `f0d6749` | PASS | PASS WITH NOTES |
| W3 staging worker secrets script | `d1/staging-secrets-script` | `4a16350` (+ `6df0a81`, `e485b4e`, `0640714`, `a3788b6`, `063f516`, `4d607d0`, `4fecb90`) | `653def6`; lead `f3af009` wires the db test into `test:rls` | PASS WITH FIXES | PASS WITH NOTES |
| W4 api org CORS | `d1/api-org-cors` | `1a52449` | `4a11c66` | PASS | PASS |

## W1 — edge link rate limit (`d1/open13-edge-limit`, ADR-032)

`LINK_LIMITER` (Workers Rate Limiting binding, dev and staging only) guards `invite/resolve`, `otp/request` and `otp/verify` with one constant key per route. A spent counter is 429 `rate_limited` (`Retry-After: 10`); a missing or failing limiter is 503 `unavailable`. Files: `workers/edge/src/link-limit.ts`, `link-limit.test.ts`, `link-limit.real.test.ts`, `workers/edge/wrangler.jsonc`.

Spec review: **PASS WITH FIXES.**

| id | sev | finding | disposition |
| --- | --- | --- | --- |
| SR-E-1 | Medium | No test pinned the wrangler `LINK_LIMITER` binding (the limiter could vanish from an env block, or the two envs could share a namespace id) | **Fixed**: lead test `c2ccf66` (`scripts/test/wrangler-bindings.test.mjs`) |
| SR-E-2 | Low | ADR-032 had to record the per-location availability trade-off and the M3a owner | **Fixed**: ADR-032 `b4ee74e` and `2db2226` |

Security review: **PASS WITH NOTES.**

| id | sev | finding | disposition |
| --- | --- | --- | --- |
| SEC-W1-1 | Medium (availability) | One constant key per route and location lets one client, or a big drive opening its links at the same minute, use up the budget; honest candidates then get 429 on resolve and OTP. It is a speed bump, not a connection cap | **Accepted for D1, owner M3a.** Size the limit from real drive sizes. Put the real guard behind api: a concurrency cap and a short negative cache for unknown token hashes, or Hyperdrive, through an ADR-031 amendment. Written into ADR-032 and spec §11 |
| SEC-W1-2 | Low | The candidate resolve screen showed the generic error on a 429 | **Fixed**: `51f96b0` (wait copy, Retry held for `Retry-After`); the wait is capped at 60 s in `eba9dec` |

Open (staging only): plan availability of `ratelimits` and the API-token permission for it are confirmed by the first staging dispatch.

## W2 — recruiter env and local origins (`d1/recruiter-env-local`)

Closes the R4 re-review note 1 (the outbox gate) and the 4i "before R5" item: the headers template accepts loopback origins under `VITE_TRACE_ENV=dev` only; `e2e-local` builds the recruiter with the local stack's Supabase URL, its publishable key and `http://127.0.0.1:8788`; the outbox is built only with `VITE_DEMO_OUTBOX=1` and `VITE_TRACE_ENV` exactly `dev` or `staging`; the staging deploy Build step sets `VITE_TRACE_ENV: staging`; `main.tsx` passes named env fields only.

Spec review: **PASS.**

| id | sev | finding | disposition |
| --- | --- | --- | --- |
| SR-E-3 | Low | `e2e-local` fell back to the anon key (a JWT) when the publishable key was empty, which the headers plugin rejects late in the build | **Fixed**: `cee0725` (no fallback; an empty publishable key makes the stack read as bad) |
| SR-E-4 | Info | No CI job builds a flagged production flavour, so that arm is covered by unit tests only | **Accepted** (the `check-no-demo-outbox` dist scan and `check-workflows` pins back it) |

Security review: **PASS WITH NOTES.**

| id | sev | finding | disposition |
| --- | --- | --- | --- |
| SEC-W2-1 | Low | The outbox gate was a deny-list (`!== 'production'`): `prod` or `Production` with the flag would ship the outbox | **Fixed**: `15e38c5` (allow-list `dev`, `staging`; app and script agree; `check-workflows` pins `VITE_TRACE_ENV: staging`) |
| SEC-W2-2 | Low (note) | The bare-env guard covers only `apps/recruiter/src` | **Accepted** (the dist scan is the backstop) |

## W3 — staging worker secrets script (`d1/staging-secrets-script`)

`scripts/ops/staging-worker-secrets.mjs` and the runbook in `scripts/ops/README.md`: four login roles create-or-alter with a locally computed SCRAM-SHA-256 verifier, one grant each `with inherit false, set true`, TR001 and TR002 guards, session pooler URLs, five Worker secrets set on stdin only. Tests: `scripts/test/staging-worker-secrets.test.mjs`, `scripts/test-staging-roles-local.mjs` (run by `test:rls` step 5d).

Security review: **PASS WITH NOTES.** All four fixed.

| id | sev | finding | disposition |
| --- | --- | --- | --- |
| SEC-W3-1 | Low | The wrangler child env could write debug logs (with a `secret put` body) under `~/.wrangler/logs` | **Fixed**: `6df0a81` (`WRANGLER_LOG` dropped, `WRANGLER_WRITE_LOGS=false`, `WRANGLER_LOG_SANITIZE=true`) |
| SEC-W3-2 | Low | A lost connection, a psql exit or a timeout was reported as a rollback | **Fixed**: `e485b4e` (unknown-outcome text: passwords may have changed, all five secrets possibly stale, re-run with `--yes`) |
| SEC-W3-3 | Low | The rotation window was understated | **Fixed**: `0640714` (five sequential `secret put` calls each deploy a Worker version, so old passwords live for tens of seconds) |
| SEC-W3-4 | Low | The operator URL was not tied to the staging project | **Fixed**: `a3788b6` (pinned `STAGING_PROJECT_REF`; the optional shell variable must equal it) |

Spec review: **PASS WITH FIXES.**

| id | sev | finding | disposition |
| --- | --- | --- | --- |
| SR-E-5 | Medium | The role SQL had never run on Postgres | **Fixed**: `063f516` (real SQL on the local stack, rolled back); the lead wired it into `test:rls` in `f3af009` |
| SR-E-6 | Low | The runbook had no ordered first-deploy checklist: the first dispatch must run with `run_e2e=false` | **Fixed**: `4d607d0` (dispatch, then private JWK, the script and smoke users, then a dispatch with E2E) |
| SR-E-7 | Low | The key-pair section put `CANDIDATE_TOKEN_PRIVATE_JWK` before the Worker exists; `wrangler secret put` on a missing Worker silently creates a draft Worker | **Fixed**: `4fecb90` (variables before the first deploy, the secret only once `trace-api-staging` exists) |

Open (staging only, proved by the first `--yes` run; DC-D7 staging half): Supavisor accepting `<login>.<ref>` users and TLS on the session pooler, and the hosted `postgres` role's rights to create and alter roles.

## W4 — api org CORS (`d1/api-org-cors`)

`services/api/src/org-cors.ts`: exact match on `ALLOWED_ORIGINS`; ACAO and `Vary: Origin` on every answer, errors included; never credentials; an allowed preflight is 204 before auth and the database; any other preflight is the generic 404. Closes N1 of `docs/reviews/D1-security-review-r3.md`.

Spec review: **PASS.** Security review: **PASS.** Info notes accepted: no `Vary` header when no origin is allowed (every answer is `no-store`); a 500 from a non-`Error` throw lacks ACAO.

## Lead work

- ADR-032 (`b4ee74e`, amended `2db2226`).
- Spec revision 4k and this record (branch `d1/chat-e-docs`).
- Closing lines added to older records: `D1-review-c1a.md` SEC-2 (edge half closed, rest M3a), `D1-review-r4.md` re-review note 1 (closed), `D1-security-review-r3.md` N1 (closed).

## Carried

- **M3a (SEC-W1-1):** size the link limit from real drives; the guard behind api (concurrency cap, negative cache or Hyperdrive, ADR-031 amendment).
- **First staging runs:** `ratelimits` plan and token permission (W1); Supavisor `<login>.<ref>`, TLS and `postgres` admin rights (W3).

## Confirming re-review

Sonnet spec-reviewer on `f3af009`: W1 CONFIRMED, W2 CONFIRMED, W3 CONFIRMED WITH NOTES, W4 CONFIRMED (merge integrity checked per stream; rules 1-9 hold). Notes: (1) `test-staging-roles-local.mjs` was not run by the re-reviewer; the lead ran it in `test:rls` (full `pnpm verify`). (2) README step 2 says to wait for a green deploy-staging job but the org sign-in smoke step is red until H9; intent clear, wording to tidy with the first staging run.

## Checks

- `verify:fast` exit 0 on `f3af009` (242 s): edge 417, api 403, jobs 240, scripts 2390 + 1 skipped.
- `e2e-local` on this machine on `f3af009`: 17 passed, 1 skipped (109 s), the recruiter built with the local sign-in config.
- Full `pnpm verify` and Linux CI on PR #4: recorded in the handoff with the `cp/d1-10` tag.
- CI on PR #4 green on `f3af009` (static, rls, security, migrations, e2e-local).

## Stream R5 (slice E2E): W5 `d1/r5-slice`, W6 `d1/r5-ci`

A Sonnet pre-flight found the missing pieces: no `e2e-staging` job, no `local`/`staging` projects, no `e2e:record` or `e2e:staging:preflight`, no slice helpers. W5 (Opus) wrote the slice spec and helpers; W6 (Opus) the CI job, the check-workflows pins, the preflight launcher and `enrol-smoke-user --roles reviewer`.

| Review | Verdict | Findings and dispositions |
| --- | --- | --- |
| Security, W6 @ `ab43431` | PASS WITH FIXES | SEC-W6-1 Medium no concurrency group (fixed: `concurrency: deploy-staging`); SEC-W6-2 Low a fresh enrolment secret could be filmed (fixed in W5: a verified TOTP factor is checked over GoTrue before any page); SEC-W6-3 Low cache `with:` unpinned (fixed); SEC-W6-4 Info exclude every `*.zip` (fixed); SEC-W6-5 Info needs W5 (merged together) |
| Security, W5 @ `2bdf802` | BLOCK (staging only) | SEC-W5-1 High a password in the error-context aria snapshot on a timeout; SEC-W5-2 High the org-wide outbox matched by label (fails from run 2 on and prints links); SEC-W5-3 Medium the link token in the goto call log; SEC-W5-4..7 Low (OTP typed with `fill`, sessions not logged out, staging host guard, end-of-run SHA checked on api only); SEC-W5-8 Low no cleanup (accepted for D1, documented in the spec header). 1-7 sent to W5 |
| Spec, W5 + W6 | W5 PASS WITH FIXES, W6 PASS | SR-R5-1 Medium AT-D17 timer; SR-R5-2 Medium rule 7 not asserted; SR-R5-4, 5, 7 Low; SR-W6-1 Low step timeout: sent to the writers. SR-R5-6 and SR-R5-8 become spec rev 4l text. **SR-R5-3 (AT-D2: record mode writes one video per context; which file is the 5-minute deliverable) is carried to D1 REVIEW (Chat F).** Rev 4l also takes the spec review's sentence list 1-12 (artifact contents, secret map, dispatch `if` and concurrency, layout, steps 1-4 and 10 wording, manifest fields, `e2e:record`, reviewer smoke user `smoke-reviewer+staging@example.com`) |

e2e-local run 1 of a trial merge (W5 `2bdf802` + W6 `62615c1`, scratch branch `d1/r5-trial`, local only): slice steps 1-3 passed on the real stack (UI sign-in with TOTP enrolment, default cutoff, reviewer assignment); step 4 failed on the label-matched outbox (SEC-W5-2); every other spec passed (20 passed, 1 skipped).
