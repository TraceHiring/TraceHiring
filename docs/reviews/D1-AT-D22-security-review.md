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
