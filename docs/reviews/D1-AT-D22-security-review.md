# D1 AT-D22 (Sentry adapter): security review (Opus security-reviewer, 2026-10-14)

Scope: `git diff 5b0d457..d8b1b3a` (`9581677` shared scrubber and adapter, `d8b1b3a` wiring in the recruiter app, services/api and workers/jobs). The reviewer read the installed SDK sources (`@sentry/*` 11.1.0).

**Verdict: BLOCK** → **fixed by the lead the same day** (commit after `bb71c36`; see dispositions). A confirming re-review is still due before D1 writers start (HANDOFF "Next step").

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| B-1 | Blocker | `sendDefaultPii` no longer exists in SDK 11: `dataCollection` replaced it and every default is on (user info, cookies, headers, bodies, query strings, frame variables, 5 context lines). The browser then sets `sdk.settings.infer_ip = "auto"`, which is added **after** beforeSend, so Relay would store the recruiter's IP. | **FIXED:** `SENTRY_DATA_COLLECTION` turns every switch off (shared `sentryOptions`). Verified in core 11.1.0 (`resolveDataCollectionOptions.js`, `@sentry/browser` `client.js:21`). Test: the recruiter's real-SDK event carries `sdk.settings.infer_ip = "never"`. |
| B-2 | Blocker | `tracesSampleRate: 0` counts as tracing **on** (`hasSpansEnabled` checks `!= null`). An incoming `sentry-trace: …-1` header then forces a sampled transaction that never passes beforeSend, with headers, query, body and IP. | **FIXED:** no `tracesSampleRate` at all. Test (api and jobs): a sampled `sentry-trace` header on a healthy and a failing request yields envelope types exactly `['event']`, no `span`. The test was seen failing with `tracesSampleRate: 0` (two `span` envelopes), then green without it. |
| M-3 | Major | The scrubber ran `extra`, `tags` and `contexts` through the redactor (a deny-list): the browser's wrapped callbacks put raw arguments (`button[aria-label="Shortlist <name>"]`) into `extra.arguments`, and names pass the redactor. | **FIXED:** `tags` and `extra` are dropped, and `contexts` keeps only the trace ids. Test with `extra.arguments` and `extra.__serialized__`. |
| m-4 | Minor | The recruiter kept data-collecting default integrations (HttpContext, CultureContext, Console, BrowserApiErrors) with no test. | **FIXED:** one shared integration allow-list (`Dedupe`, `EventFilters`, `FunctionToString`, `LinkedErrors`, `Breadcrumbs`) for all three consumers, tested in `sentry-reporter.test.ts`. |
| n-5 | Nit | Boundary rule 7 did not match `@trace/shared/sentry` or `createSentryReporter`. | **FIXED** in `scripts/check-boundaries.mjs`, with a test case. |
| NC-1 | Not checked | Whether the Workers load `node:async_hooks` without an explicit compat flag. | **Checked by the lead:** `wrangler deploy --dry-run` builds both Workers (1368 KiB, 253 KiB gzip). The compatibility date 2026-08-15 turns `nodejs_compat` on by default, and the wiring tests run the real SDK in workerd. |

Checked and clean (reviewer): BrowserSession dropped, client reports off, no Replay/Feedback/logs/metrics/check-ins, the allow-list scrubber's event and breadcrumb fields, the DSN is never logged, the no-DSN path skips init, candidate and edge cannot hold `@sentry/*`, all versions are at least 2 weeks old.

Note for the founder (H6): in the Sentry projects, keep "Prevent storing of IP addresses" and server-side data scrubbing on (already part of H6).

## Confirming re-review (Opus security-reviewer, 2026-10-14): PASS WITH NOTES

All five findings verified closed against the SDK 11.1.0 sources (B-1, B-2, M-3, m-4, n-5). Per-request isolation still holds without the HttpServer/RequestData/Fetch integrations (`withInvocationIsolationScope`), and no envelope type other than `event` can be sent. Its notes, all fixed by the lead the same day:

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| Mi-1 | Minor | With no `tracesSampleRate`, @sentry/cloudflare falls back to `env.SENTRY_TRACES_SAMPLE_RATE` (and reads `SENTRY_TUNNEL`, `SENTRY_DSN`, `SENTRY_DEBUG`, …): an operator-set var would reopen B-2 or redirect envelopes. | **FIXED:** `workerSentryOptions` returns undefined (no SDK) when the env holds any `SENTRY_*` name but `SENTRY_DSN_WORKERS`; tests for five names, seen red first (api and jobs). |
| N-1 | Nit | The Cloudflare client sets no `sdk.settings`, so `infer_ip` is not `never` on Worker events. | **FIXED:** Worker options carry `_metadata.sdk.settings` `infer_ip`/`infer_user_agent` = `never`; the real-SDK wiring test asserts it on the sent event. |
| N-2 | Nit | The server client appends SpanStreaming after the integration filter, so "the only integrations that run" was not strictly true. | **FIXED:** comment corrected in `sentry-reporter.ts` (inert while tracing is off). |
| NC | Not checked | `withErrorReporting` wraps only `fetch`; the jobs queue consumer and cron (Wave 2) would report to no client. | **OPEN (reliability, not a leak):** when the lead wires `queue`/`scheduled` in `workers/jobs/src/index.ts` (spec §11 Wave 2), wrap them too, with a wiring test. |

Also in the same change (AT-D20 part of L-24): the recruiter CSP gets the Sentry ingest origin (`__SENTRY_ORIGIN__` filled from `VITE_SENTRY_DSN`, `check-headers` allow-list), and the staging deploy passes `VITE_SENTRY_DSN` to the recruiter build and `SENTRY_DSN_WORKERS` to jobs and api only (`check-workflows`).

**AT-D22 is green; with this re-review the D1-18 gate for writer streams is met** (H6 done, AT-D22 passing).
