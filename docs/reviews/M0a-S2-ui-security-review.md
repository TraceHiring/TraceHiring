# M0a W-S2 (UI and apps): security and spec review, first pass (Opus)

Reviewer: `security-reviewer` agent (Opus), read-only, 2026-10-12. Diff: `git diff fa147f8 m0a/s2-ui` (tip `54620e6`, 7 commits, 38 files).

## Verdict
**PASS WITH FINDINGS.** Nothing Blocking, High or Medium. Four Low findings, all test gaps. No lead-only file was touched.

## Findings
| # | Severity | Area | file:line | Problem | Fix / failing-test idea |
| --- | --- | --- | --- | --- | --- |
| S2-1 | Low | Tokens generator CSS-injection guards | `packages/ui/scripts/build-tokens.mjs:82, 93, 105, 127, 132, 140, 148, 165` | The guards are correct, but most have no negative test (only hex colours, NaN, a missing section and an unknown family have one). If someone loosens a guard, a value such as `X"; } body{…}` or a key such as `a;b` reaches `tokens.css`. | In `tokens.test.ts`, inject `;`, `}`, `"`, `/*`, `url(`, a newline and out-of-range numbers into `font.*`, key names (`radius`, `component`, `space`, `color`), `type.*.textTransform` and `space.4 = 1e6`. Expect `buildTokens()` to throw. |
| S2-2 | Low | AT-9 recruiter wiring | `apps/recruiter/src/main.tsx:15`, `App.tsx:34-36` | The real call sites (`installGlobalErrorReporting(window)`, the `reportAppError` effect) are never exercised. | Add a raw-source guard: `main.tsx` installs reporting before `createRoot`; `RouteError` calls `reportAppError`; no recruiter source outside `error-reporting.ts` calls `.capture(` or imports `reportError` / `serializeError`. Include negative controls. |
| S2-3 | Low | Rule 8 guard coverage (candidate) | `apps/candidate/src/candidate-guards.test.ts:9, :19` | `MEDIA_CAPTURE` misses HTML Media Capture (`capture=` / `capture:`). `index.html` is not scanned, and the guards never look at the built bundle. | Add `\bcapture\s*[=:]`. Scan `index.html` too. In the real-build test, assert that no candidate output chunk contains `getUserMedia`, `MediaRecorder`, `sentry` or `capture=`. |
| S2-4 | Low | CSP hygiene | `apps/*/src/security-hygiene.test.ts:17, 77` | Only source files are checked; the built `dist/index.html` and emitted CSS are not (Vite inlines assets under 4 KB as `data:`). | In the real-build test, assert that the output `index.html` has no inline `<script>`/`<style>` and no `style=`, and that the emitted CSS has no `url(data:font` and no `http(s)://`. |

## Checked and clean
- **CSP / `_headers` (§10.3):**
  - one `/*` rule and one CSP per app;
  - every directive is `'self'` or `'none'` (plus `img-src data:`), with no `unsafe-*`, wildcards or external origins;
  - HSTS, nosniff, `no-referrer`, and the per-app Permissions-Policy are present;
  - the `TODO(H4)` and `TODO(M0b)` comments are skipped by `check-headers.mjs`.
- **Candidate:**
  - no camera, mic, reporter, Sentry or analytics;
  - the logger is imported only from `@trace/shared/log` (an allow-list test with negative controls);
  - the dependencies test bans sentry, analytics and zod;
  - log output is parsed as `LogLine`, and redaction is tested with synthetic values.
- **Recruiter errors:**
  - only `reportError` (serialise, then redact);
  - the release passes through `safeContext`;
  - the reporter is `noopErrorReporter`;
  - the error page shows no error text.
- **Version injection:**
  - `/^[0-9a-f]{7,40}$|^dev$/` in both the configs and the code, with a trailing-newline test;
  - fallback `dev`;
  - the configs read `config.env` only;
  - a real `vite build` test parses `dist/version.json` with `AppVersionFile`.
- **Tokens:**
  - validated colours, keys, numbers, families and transforms;
  - deterministic LF output;
  - `--check` compares bytes, with a negative test;
  - AT-20 contrast covers every §11 pair, with a negative control.
- **Secrets and paths:**
  - no secret-shaped literals; PII-like values are built at run time;
  - no lead-only path touched.
- **Rules 1–9:** nothing blends results, renders integrity data, captures media or infers anything.

## Not checked by the reviewer
- The reviewer ran no tests or builds.
- The lead ran the dist checks in the W-S2 worktree (2026-10-12 00:35 IST):
  - `check-headers` OK for both apps;
  - `check-bundle-size`: candidate initial JS **72.4 kB gzip** (budget 150 kB), recruiter 123.5 kB (information only).

## Lead-only follow-ups
1. `packages/ui/package.json`: add `tokens` / `tokens:check` scripts, and add `node scripts/build-tokens.mjs --check` to `lint` (spec §5).
2. `scripts/verify-fast.mjs:34-46`: `docs/design/tokens.json` is classed as docs-only. Map it to `@trace/ui` and its dependents, with a test case.
3. Record the deferred CSP origins in the M0a summary:
   - candidate edge origin: H4;
   - recruiter Supabase origin: M0b;
   - Sentry ingest: before D1.
4. Plan risk 9: a lead-owned dist-level guard (candidate `dist/assets/*.js` must not contain `getUserMedia`, `MediaRecorder` or `sentry`). S2-3's bundle test covers it from the app side.
5. Record the candidate initial JS size in the M0a summary (72.4 kB gzip).

## Resolution (lead)
S2-1 to S2-4 are fixed on `m0a/s2-fixes` by a Sonnet writer (see the re-review). Follow-ups 1 and 2 are done by the lead on `m0a/integration`; 3 and 5 go in the M0a summary.
