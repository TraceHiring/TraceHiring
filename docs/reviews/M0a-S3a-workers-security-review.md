# M0a W-S3a review: Workers app factory, /health and error reporting (first review, Opus)

Reviewer: `security-reviewer` agent (Opus), read-only, 2026-10-12. It ran no tests.
Diff: `git diff fa147f8 e04446e` (branch `m0a/s3-workers`, 4 commits, 18 files).

**Verdict: PASS WITH FINDINGS.** Nothing blocks the merge. S3A-1 should be fixed before merge, or tracked with an owner.

## Findings

### S3A-1 · Medium · A thrown non-Error escapes `onError`, so the Worker crashes instead of returning the JSON 500
- **Where:** `services/api/src/app.ts:45`, `workers/jobs/src/app.ts:45`, `workers/edge/src/app.ts:44`, and each `src/index.ts:8` (`fetch: app.fetch`).
- **Evidence:** Hono 4.13.13 sends only `Error` instances to `onError`:
  - `hono/dist/hono-base.js:258-260`: `#handleError(err, c) { if (err instanceof Error) return this.errorHandler(err, c); throw err; }`
  - `dist/compose.js:37`: `if (err instanceof Error && onError) … else throw`
  - Anything else (a string, an object, `null`) is re-thrown out of `app.fetch`.
- **Repro (failing test):** `createApp({ reporter: spy, now: () => { throw <synthetic email string>; }, sink })`, then `app.request('https://api.test/health', undefined, { VERSION: 'dev' })`. It throws or rejects instead of returning `500 {"error":"internal"}`, and the reporter is never called.
- **Impact once deployed:**
  - workerd returns its own 500 page: not JSON, and without `cache-control: no-store`.
  - The thrown value is recorded as the exception text in tail / Workers Logs, outside the redactor. That breaks §9.1 ("messages are dropped").
- **Fix (all three apps):**
  - Register a first middleware that rethrows non-Errors as `new Error('non_error_thrown')`.
  - Wrap the `onError` body in try/catch, with a static `500 {"error":"internal"}` fallback (`content-type: application/json`, `cache-control: no-store`).
- **Tests:** throw a string, `null`, and an object with an email-shaped field. Assert the 500 JSON body, `no-store`, the reporter called once (api, jobs), and no synthesised value in any log line.

### S3A-2 · Low · The "nothing from the request" assertions pass trivially because no request data is sent
- **Where:** `services/api/src/error-reporting.test.ts:46`, `:61`; the same in `workers/jobs/src/error-reporting.test.ts` and the error-path test of each `index.test.ts`.
- **Evidence:** every request is `app.request(url, undefined, env)`: no headers, query, cookies or body.
- **Fix:** send values built at run time:
  - a query with email and token values;
  - headers: `authorization`, `cookie`, `cf-connecting-ip`, `x-forwarded-for`, `user-agent`;
  - a POST body for the 404 case.

  Then assert that none of them appears in the response body, any sink line, or the captured reporter payload.

### S3A-3 · Low · The edge "no reporter" guard is shallow, and its runtime test cannot fail
- **Where:** `workers/edge/src/no-error-reporter.test.ts:15`, `:25-40`.
- **Evidence:**
  - The guard checks only the keys of `AppDeps` and `Env`. Edge source could still import `reportError` / `noopErrorReporter` from `@trace/shared/log` or from the package root.
  - The runtime test cannot fail: unknown keys are ignored, and the `@ts-expect-error` already proves the key is absent.
- **Fix:**
  - Add a lead-owned `check-boundaries` / ESLint rule banning `ErrorReporter`, `reportError`, `noopErrorReporter` and `@sentry/*` imports under `workers/edge/**` (plan risk 9).
  - Until then, replace the runtime test with a raw-source scan of `workers/edge/src/**`.

**Note for the lead (shared code):** `ErrorReporter.capture` is synchronous and has no `ExecutionContext`. The pre-D1 Sentry adapter on Workers will need `ctx.waitUntil` to flush. Plan for this in the adapter spec.

## Checked and clean
- **500 body:** exactly `{"error":"internal"}`. Reporter and log both get `redactSerializedError(serializeError(err))`.
- **Error path:** `releaseForErrorPath` survives a throwing env or `VERSION` getter. `reportError` and the logger's `write` swallow their own errors.
- **Request data:** no headers, IP, user agent, cookies, query or body are read.
- **`cache-control: no-store`:** set on 200, 404, 500 and HEAD, and asserted.
- **404 body:** constant; the path is not echoed.
- **Edge:** no reporter dependency, no secrets, only the `VERSION` binding.
- **`vars`:** only `VERSION: "dev"`, at the top level and in `env.dev` / `env.staging`.
- **Worker config:**
  - the compatibility settings are unchanged;
  - top-level `workers_dev: false` and `preview_urls: false`;
  - no routes or Queue/R2/Durable Object/cron bindings.
- **Spec:** §9.2, §9.3, §9.4, AT-10 and D6 conform.
- **Owned paths:** respected (only `src/**`, `wrangler.jsonc` and `worker-configuration.d.ts` in the three Workers).

## Deviations
- **(a) `wrangler types --strict-vars=false`: accept.**
  - `wrangler types --check` reads the generating flags from the file header (wrangler 4.149.0 `wrangler-dist/cli.js` ~211491-211503).
  - The lead must still set `"types:gen": "wrangler types --strict-vars=false"` in the three `package.json` files. Otherwise a plain regen flips `VERSION` to the literal `"dev"`.
- **(b) Q6 `observability`: set it explicitly.**
  - Wrangler leaves it undefined when absent (cli.js:27257-27264), so account state decides whether logs are stored.
  - M0a: `"observability": { "enabled": false }` in each `wrangler.jsonc`, until ADR-027 records Workers Logs as an outside-India processor (§9.2).
  - Both keys exist in the 4.149.0 `config-schema.json` (lines 4271-4338).
- **(c) Bundle ~850 KiB / 141 KiB gzip: no action.**
  - It is not a spec gate (only `apps/candidate` has a budget).
  - A `@trace/shared/version` subpath would not shrink it: `health.ts` and `version.ts` both import `contracts.ts` → `zod`.
  - Record the measured size in the summary.
- **(d) `app.ts` copied into three Workers: acceptable for M0a.**
  - Before M0b adds middleware, extract a Workers-only package for the error and notFound handling.
  - That package should return `err.getResponse()` for Hono `HTTPException`.

## Resolution (lead)
- **Fixed on `m0a/s3-workers` by a Sonnet writer:** S3A-1, S3A-2, S3A-3 (raw-source scan) and deviation (b). Re-review below.
- **Lead-only follow-ups:**
  - (a) the `types:gen` scripts;
  - the S3A-3 boundaries rule: owner M0a, before REVIEW;
  - (d) extraction, owner M0b;
  - the Sentry `waitUntil` note: owner "before D1" with H6.
