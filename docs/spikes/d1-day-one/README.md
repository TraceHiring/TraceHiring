# D1 day-one spike: DC-D2, DC-D3, DC-D4, DC-D5, DC-D6 (Windows), DC-D7

Throwaway, standalone npm project (not in the pnpm workspace). Run locally on 2026-10-14 for
`specs/d1-demo-slice.md` section 8. Synthetic data only; keys are generated at run time and never printed.
DC-D5 and DC-D6 (Windows half) were added on 2026-10-16, DC-D8 (staging) on 2026-10-22 (sections at the end). DC-D1 is NOT RUN;
DC-D9 and the Linux CI half of DC-D6 passed in the `e2e-local` CI job (`cp/d1-03`).

## How to run

```sh
cd docs/spikes/d1-day-one
npm install                     # .npmrc sets legacy-peer-deps (npm 10 arborist crash without it)

# DC-D4
npm run d4:node                 # Node 22
npx vitest run --reporter=verbose --silent=false   # workerd, @cloudflare/vitest-pool-workers; projects d4 and d5 (DC-D5 a, b)

# DC-D5 (c) and DC-D6: real Chromium via Playwright 1.63.0. The spike downloads nothing: it needs Playwright's
# Chromium in %LOCALAPPDATA%\ms-playwright (chromium-1243, chromium_headless_shell-1243, ffmpeg-1011).
# global-setup starts `wrangler dev` for workers/media-link on 127.0.0.1:8811 and a static site on localhost:8812,
# with a run-time random HMAC key in a git-ignored workers/media-link/.dev.vars that is deleted at teardown.
npx playwright test                    # 28 tests = 2 Chromium flavours x (9 @d5 + 5 @d6)
npx playwright test --grep @d5         # or --grep @d6

# DC-D2 and DC-D3: three Workers in one wrangler dev session (edge is the exposed one)
npm run dev:multi               # port 8801
curl localhost:8801/d2/do/set; sleep 2; curl localhost:8801/d2/do/dump
curl "localhost:8801/d2/enqueue?id=ok1"; curl "localhost:8801/d2/enqueue?id=bad1&fail=1"
curl localhost:8801/cdn-cgi/handler/scheduled            # cron (needs --test-scheduled)
sleep 12; curl localhost:8801/d2/jobs-stats; curl localhost:8801/d2/do/dump
curl localhost:8801/d3/rpc; curl localhost:8801/d3/http-probe
node --experimental-strip-types scripts/d4-cross.ts      # Node signs, workerd verifies

# DC-D7 (needs the local Supabase Postgres already running; transactions are rolled back)
printf 'PG_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres\n' > workers/pg-postgres/.dev.vars
cp workers/pg-postgres/.dev.vars workers/pg-pg/.dev.vars            # .dev.vars is git-ignored
npx wrangler dev -c workers/pg-postgres/wrangler.jsonc --port 8802 --inspector-port 9332 &
npx wrangler dev -c workers/pg-pg/wrangler.jsonc --port 8803 --inspector-port 9333 &
curl localhost:8802/; curl localhost:8803/
npx wrangler deploy -c workers/pg-postgres/wrangler.jsonc --dry-run --outdir .out/x   # bundle size
```

## Results

| Check | Result | Evidence (from the run output) |
| --- | --- | --- |
| DC-D4 ES256 + HMAC, Node 22 | PASS | `DC-D4 node: PASS (node v22.23.3)`; `jwt_sig_bytes:64, es256_verify_ok:true, es256_tampered_rejected:true, es256_wrong_key_rejected:true, hmac_verify_ok:true, ct_equal_flipped_rejected:true` |
| DC-D4 ES256 + HMAC, workerd | PASS | vitest-pool-workers: `DC-D4 workerd: {"runtime":"workerd (...)","results":{"jwt_parts":3,"jwt_sig_bytes":64,"es256_verify_ok":true,...,"subtle_timingSafeEqual_ok":true},"allPass":true}`; 1 test passed |
| DC-D4 cross-runtime | PASS | `DC-D4 cross-runtime (Node sign -> workerd verify): {"verified":true}` (wrangler dev edge, POST `/d4/verify`) |
| DC-D2 SQLite DO + alarm | PASS | `{"value":"hello","storage_kind":"sqlite","alarm_fired_at":"2026-10-14T05:03:31.490Z"}` (`new_sqlite_classes`, `ctx.storage.sql`, `setAlarm`) |
| DC-D2 Queue producer -> consumer in another Worker, max_retries 5, DLQ | PASS | jobs-stats: `main attempt=1 ... attempt=6 id=bad1 fail=true` then `DLQ received id=bad1 (queue=d1-spike-dlq)`; `ok1` acked after `attempt=1` |
| DC-D2 cron `scheduled` | PASS | `GET /cdn-cgi/handler/scheduled` returned `ok`; DO dump shows `"cron_count":"1"` |
| DC-D3 `WorkerEntrypoint` RPC service binding | PASS | `/d3/rpc`: `{"ping":"pong to edge","whoami":{"service":"d1-spike-api","entrypoint":"CandidateRpc"}}` in `wrangler dev -c edge -c api -c jobs` |
| DC-D3 RPC not reachable over plain HTTP | PASS | `/d3/http-probe`: `/ping` 404, `/whoami` 404, `/CandidateRpc/ping` 404, `/health` 200 (default entrypoint `fetch` only serves `/health`) |
| DC-D7 `postgres` (porsager) in workerd | PASS | `{"driver":"postgres@3.4.9","ok":true,"inTx":{"before":{"cu":"postgres","su":"postgres"},"after":{"cu":"authenticated","su":"postgres"}},"afterRollback":{"cu":"postgres"},"ms":179}` |
| DC-D7 `pg` in workerd (fallback, also tried) | PASS | `{"driver":"pg@8.23.0","ok":true,"inTx":{... "after":{"cu":"authenticated","su":"postgres"}},"afterRollback":{"cu":"postgres"},"ms":44}` |
| DC-D7 staging session pooler (TLS), user-JWT PostgREST, `api_login` roles | NOT RUN | needs staging credentials and the D1 roles; only local Supabase (no TLS) was exercised |

`SET LOCAL ROLE authenticated` inside `BEGIN` works with both drivers: `current_user` is `authenticated`
inside, `postgres` after `ROLLBACK`; `session_user` stays `postgres`.

### Bundle size (`wrangler deploy --dry-run`, Total Upload, minified by wrangler defaults)

| Worker | Raw | gzip |
| --- | --- | --- |
| baseline (no driver) | 0.17 KiB | 0.15 KiB |
| `postgres` 3.4.9 | 84.36 KiB | 22.00 KiB |
| `pg` 8.23.0 | 195.11 KiB | 40.11 KiB |

`postgres` is about 2.3x smaller than `pg`; both are far under the 3 MB Free limit.

## DC-D5 Media link (run 2026-10-16, local)

Code: `workers/media-link/src/{handler,index}.ts` (Worker, SQLite `MediaLinkDO`, R2 binding), `test/media-link.test.ts`
(workerd), `browser/tests/d5-media-link.spec.ts` (Chromium). No Postgres: the DO record stands in for the grant and
`deps.viewGrant` stands in for `private.media_view_grant`. The `/_spike/*` routes (issue, seed, config, stats) exist only
when `SPIKE_ROUTES=1` and are not part of the design.

| Sub-check | Result | Evidence |
| --- | --- | --- |
| (a) Worker streams an R2 object through the binding, no S3 keys, `no-store`, `image/jpeg` | PASS | 4 MiB pull-counting body: 1 of 64 chunks pulled when the response headers exist, all 64 on drain; real R2 binding (miniflare) returns the exact bytes with `content-length`; headers below |
| (b) atomic single-use burn in SQLite `MediaLinkDO`, 25 concurrent fetches | PASS | workerd: 5 rounds, each 1x200 + 24x404, later fetches 404, R2 get called once and the grant once; DO method alone: 25 concurrent `burn()` give one record; real HTTP against `wrangler dev` (Node fetch): 3 rounds of 1x200/24x404 |
| (b) HMAC-SHA-256 `v1\|jti\|exp`, `crypto.subtle.verify`, expiry | PASS | `verify` spy called once per well-formed link; `exp < now` or `exp > now+300` refused before any I/O; boundary `now == exp` still valid (inclusive); the DO record's own `exp` is checked too |
| (b) tampered or expired never touches R2 | PASS | 25 tamper and malformed variants (flipped sig, exp+-1, other jti, swapped sigs, truncated, padded, non-canonical, v0 domain, uppercase jti, extra or duplicate params, nested path) all 404 with R2 get count 0 and the DO touched only for the one validly signed unknown jti; the real link was still usable afterwards; every failure kind returns the identical body and headers |
| (c) Chromium: CORS fetch, canvas watermark, `data:` display under the recruiter CSP | PASS | both Chromium flavours: 200, `type: cors`, canvas not tainted, 54,925 (shell) and 54,791 (new headless) pixels changed by the watermark, `data:image/jpeg;base64,` image 480x320 loads, zero `securitypolicyviolation` events, zero console errors |

Mutation checks (not committed): a burn that reads, awaits, then writes gave 5 winners of 25 (workerd round) and 7 of 25
(DO alone), and the tests failed; replacing the R2 pass-through with `arrayBuffer()` made the pull count 64 at headers and
the stream test failed.

### Recruiter CSP: what DC-D5 needs
The planned template on d1/integration is `connect-src 'self' __SUPABASE_ORIGIN__ __API_ORIGIN__ __SENTRY_ORIGIN__` with
`img-src 'self' data:`. Because `/media/:jti` is served by the api Worker, **no CSP change beyond the planned
`__API_ORIGIN__` token is needed**: the media origin sits in `connect-src` only. Spike CSP (synthetic Supabase origin, api
token filled with the media Worker, Sentry dropped), verified byte for byte in the served document headers:

`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://synthetic-project.supabase.example http://127.0.0.1:8811; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`

Do not add `blob:` or the api origin to `img-src`. The spike loaded the template fixture
`browser/site/recruiter-headers.d1-integration.template` because this worktree's `apps/recruiter/_headers.template`
predates the `__API_ORIGIN__` token (`env.ts` prefers the checked-out file once it has the token).

| Browser case (`@d5`, run in both Chromium flavours) | Result |
| --- | --- |
| designed path: `fetch(url, {mode:'cors', credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer'})` -> `blob()` -> `createImageBitmap(blob)` -> canvas -> text watermark -> `toDataURL` -> `<img src=data:>` | PASS, canvas **not tainted**, zero violations |
| display through `blob:` (`canvas.toBlob` + `URL.createObjectURL` into `<img>`) | blocked: one `img-src` violation (`blockedURI` is just `blob`); `data:` is the display route (the canvas element itself needs no URL at all) |
| `<img src=media-url>` (with or without `crossorigin`) under the strict CSP | blocked by `img-src` before the network (Worker saw nothing, link not burnt): `connect-src` alone is the design |
| unmodified template (no media origin) | `fetch` fails with a `connect-src` violation before the network, link not burnt: the token is required |
| origin missing from `ALLOWED_ORIGINS` | `fetch` rejects with `TypeError` (console: CORS policy), no CSP event; the Worker had already served and burnt the link |
| `mode: 'no-cors'` fetch | with `Cross-Origin-Resource-Policy: same-origin`: `TypeError`; without it: opaque, size 0, `createImageBitmap` fails, Worker saw no `Origin` |
| `Authorization` header on the fetch | preflight `OPTIONS` reaches the Worker (404), fetch rejects, link stays usable |
| `<img>` without `crossorigin` (img-src variant page, CORP off) | loads but taints the canvas: `toDataURL` and `getImageData` throw `SecurityError` |
| `<img crossorigin=anonymous>` with ACAO (img-src variant) | canvas clean (`toDataURL` ok), also under CORP `same-origin`; without ACAO the image fails to load |
| replay of a used link from the page | CORS-readable 404 `{"error":{"code":"not_found"}}`, type `cors` |

### Media response headers (all verified in Chromium with `response.allHeaders()`)
`Content-Type: image/jpeg`, `Cache-Control: no-store`, `Content-Length: <R2 size>`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, `Access-Control-Allow-Origin: <exact request origin, only if in ALLOWED_ORIGINS>`,
`Vary: Origin`, no `Access-Control-Allow-Credentials`, no `Access-Control-Expose-Headers`, and (spike addition, spec R3-6
does not list it) `Cross-Origin-Resource-Policy: same-origin`. The 404 carries the same CORS, `Vary` and `no-store`
headers so the page can read it. Request seen by the Worker: plain `GET`, `Origin` = recruiter origin, **no `Referer`**
(the page's `Referrer-Policy: no-referrer`), no cookie, no `Authorization`, `Sec-Fetch-Site: cross-site`
(`localhost:8812` -> `127.0.0.1:8811`), `Sec-Fetch-Mode: cors`; no preflight for a plain GET.

### Findings that change the design
- **CORS needs ACAO only.** The page sees only CORS-safelisted headers (`content-type`, `cache-control`, `content-length`),
  which is all it needs; `Access-Control-Expose-Headers` and credentials are not needed. ACAO itself is invisible to page
  script (not safelisted); check it through the network layer.
- **CORP `same-origin` is safe to add:** it blocks no-cors embedding and `<img>` loads, and does not affect the CORS fetch.
  Suggest adding it to the R3-6 header list.
- **Non-GET returns 404 and never burns.** HEAD, POST, PUT, DELETE and OPTIONS get the generic 404 before the DO, so a
  preflight (an accidental `Authorization` header) fails loudly and does not burn the link.
- **A CORS or `ALLOWED_ORIGINS` misconfiguration burns links** (the Worker serves, the browser hides). A CSP block does not.
  Surface "link failed, request a new one" in the UI, and test `ALLOWED_ORIGINS` per deploy.
- **CSP violation events carry the full link.** For `connect-src` and `img-src` blocks `securitypolicyviolation.blockedURI`
  holds the whole `/media/<jti>?exp=...&sig=...` URL. The recruiter template has no `report-uri`/`report-to`; if one is
  ever added, or if any handler forwards these events to Sentry, scrub `/media/` (extends R3-6).
- **DO pattern:** one DO per `jti` (`idFromName(jti)`, only reachable after the HMAC check, so random jtis create no DOs);
  the burn is one `UPDATE ... WHERE state='open' AND exp >= ? RETURNING` in a method with no `await` between read and write.
  `alarm()` at `exp + 60 s` calls `deleteAll()`; the instance can outlive that, so every method runs
  `create table if not exists` first. After the alarm a replay is still 404.
- **wrangler/workerd:** the Worker's main module may export only `default` and DO classes. Exporting a helper or a
  constant (for example `TTL_SECONDS`) makes `wrangler dev` fail with "Incorrect type for map entry ... not of type
  'function or ExportedHandler'" while `@cloudflare/vitest-pool-workers` accepts it. Keep helpers in another module and
  re-export only the handler and DO class from the entry (`index.ts` here). Relevant to the `services/api` entry that
  will also export `MediaLinkDO`.
- **Windows:** stopping `wrangler dev` needs `taskkill /pid <pid> /T /F` (it spawns workerd); bind it with
  `--ip 127.0.0.1`. Boot took 1.4 to 7.3 s across runs (R2, DO and persisted state local under `.out/wrangler-state`).
- **Link bounds:** exp window, strict query keys (`exp`, `sig` once each), canonical base64url `sig` (43 chars), canonical
  integer `exp`, lowercase v4 `jti`: all cheap and all covered by the tamper test.

Not covered by the spike: the real Postgres grant (`media_link_grant`/`media_view_grant`), per-viewer rate limit (R3-7),
HTTPS origins and a deployed Worker, real R2 on staging (DC-D1), `Range` requests.

## DC-D6 Playwright on Windows 11 (local half, run 2026-10-16)

Windows_NT 10.0.26300 x64, Node v22.23.3, `@playwright/test` 1.63.0, Chromium 153.0.8010.12 (`chromium-1243`,
`chromium_headless_shell-1243`, `ffmpeg-1011` from the shared cache, nothing downloaded by the spike). Two flavours run:
`chromium-headless-shell` (Playwright's default `headless: true`) and `chromium-new-headless` (`channel: 'chromium'`).
Config: `args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']`, permissions `camera`,
`clipboard-read`, `clipboard-write`, `video: 'on'`. Page served from `http://localhost:8812/d6` (a secure context).

| Sub-check | Result | Evidence |
| --- | --- | --- |
| `getUserMedia` returns a fake video track | PASS (both) | `kind: video`, `label: fake_device_0`, `readyState: live`, 640x480 at 20 fps; frames flow (`videoWidth` 640, 11 to 13 distinct colours sampled from a canvas); `permissions.query` = `granted`; a fake audio track (`Fake Default Audio Input`) also live; `enumerateDevices` lists one `videoinput` |
| real paste via the keyboard fires `paste` with `isTrusted=true` | PASS (both) | `navigator.clipboard.writeText`, click the input, `keyboard.press('ControlOrMeta+V')`: `paste` `isTrusted: true`, `clipboardData` text equal, following `input` event `inputType: insertFromPaste` `isTrusted: true`, `keydown` (`key: 'V'`) trusted; `clipboard.readText()` works under `clipboard-read` |
| `dispatchEvent(new KeyboardEvent(...))` gives `isTrusted=false` | PASS (both) | synthetic `keydown`, `keyup`, a `ClipboardEvent('paste')` with a forged `DataTransfer` and Playwright's `locator.dispatchEvent('keydown')` all `isTrusted: false` (the forged paste inserted nothing); a real `keyboard.press('b')` stays `isTrusted: true` |
| video recording (`video: 'on'`) non-empty | PASS (both) | WebM, 14,064 bytes (shell) and 12,960 bytes (new headless) after about 2 s, EBML magic `1a45dfa3`; read the path after `page.close()` (the file is final then) |

Timings (ms, last full run; first run after the cache install was slower, for example 3.7 s for the whole launch test):

| Step | headless shell | new headless |
| --- | --- | --- |
| `chromium.launch` | 113 | 299 |
| `newContext` (with permissions) | 70 | 63 |
| `newPage` | 74 | 198 |
| `goto` local page | 39 | 104 |
| `browser.close` | 336 | 191 |
| `getUserMedia` (video + audio, to live track) | 475 | 2345 (639 in an earlier run) |
| `clipboard.writeText` / `readText` | 8 / 2 | 18 / 9 |
| keyboard paste to value visible | 26 | 45 |
| video finalise (`page.close`) | 48 | 117 |

Whole `npx playwright test`: 28 passed in 24.9 to 33.1 s (global setup including `wrangler dev` boot 1.4 to 7.3 s).

Notes: only headless runs were done (a headed run would open a window on the desktop; NOT run). The new-headless
project may use the OS clipboard; its test writes only the synthetic string `synthetic paste text` and the point was not
checked (reading the clipboard would read the developer's data). The Linux CI half of DC-D6 (cache, xvfb or headless
shell, the same flags) is NOT RUN. Mismatch worth knowing: the headless-shell UA reports `HeadlessChrome/153.0.8010.12`,
new headless `HeadlessChrome/153.0.0.0`.

## Versions

DC-D5/D6 additions (2026-10-16): `@playwright/test` 1.63.0 (exact, the only new dependency), Chromium 153.0.8010.12
(`chromium-1243`), wrangler 4.149.0 with miniflare 5.20260815.0-alpha and workerd 1.20260815.1 (the vitest pool brings
its own nested wrangler 4.124.0), vitest 4.1.11, `compatibility_date` 2026-08-15. Windows 11 10.0.26300, Node v22.23.3.

Node v22.23.3, npm 10.9.9, wrangler 4.149.0, @cloudflare/vitest-pool-workers 0.23.0 (workerd 1.20260815.x),
vitest 4.1.11, postgres 3.4.9 (2026-04-05), pg 8.23.0 (2026-08-08; 8.23.1 is exactly 14 days old, so not
used), `compatibility_date` 2026-08-15 (the same as `workers/edge/wrangler.jsonc`).

## Findings that touch the spec

- **Drivers (DC-D7):** `postgres` works with only `nodejs_compat` (on by default from compatibility_date
  2026-08-04; the D1 Workers set `nodejs_compat_do_not_populate_process_env`, which the spike did not
  combine, so re-check it with that flag). It needs `fetch_types: false` (no extra type-lookup query) and
  `ssl: false` for local; staging needs `ssl: 'require'` or the pooler's TLS, untested here. Prefer
  `postgres` (smaller, tagged templates, `sql.begin` gives BEGIN/ROLLBACK). ADR-031 can name it.
- **Workers Free plan:** Queues and SQLite DOs ran locally without restriction; whether Queues exist on the
  Free plan is a staging fact (DC-D2 staging half NOT RUN).
- **Queues retry count:** with `max_retries: 5` the consumer saw 6 deliveries (`attempt=1..6`) before the DLQ.
  Specs that say "retries 5 times and reaches the DLQ" should state 1 + 5 attempts.
- **Multi-worker dev:** only the first `-c` config is bound to the port; the others are reachable only by
  service binding (which matches the "RPC not on the public URL" goal). The edge DO, queue producer and
  the jobs consumer shared one local queue broker.
- **DC-D4:** `crypto.subtle.sign` returns the raw 64-byte IEEE P1363 `r||s` in both runtimes, so no DER
  conversion is needed for the JWT form. `crypto.subtle.timingSafeEqual` exists in workerd but not in Node;
  use the hand-written `constantTimeEqual` (identical in both) or `subtle.verify('HMAC', ...)`, which is
  itself constant-time.
- **Tooling:** the spike folder needs its own `tsconfig.json` (the repo's parent tsconfig extends
  `@trace/config`, which Vite cannot resolve outside the workspace), and `npm install` needs
  `legacy-peer-deps` with this wrangler/pool set. `@cloudflare/vitest-pool-workers` 0.23.0 prints a
  deprecation notice: it is renamed `@cloudflare/vitest-plugin`; the catalog pin should be reviewed.

## DC-D8 CPU time per invocation on staging (run 2026-10-22)

Measured during dispatch 39787385654 (`d1/integration` @ `f9ba70d`, e2e-staging steps 1-10 all ok): `wrangler tail
<worker> --format json` on `trace-api-staging`, `trace-edge-staging` and `trace-jobs-staging` while the slice ran,
then `node scripts/dc-d8-cpu.mjs tail-*.jsonl` (prints aggregates only: no logs, headers, bodies or query strings;
the tail files stay outside the repo). `cpuTime` is Cloudflare's own per-invocation figure; TLS to Postgres goes
through Hyperdrive (ADR-031 amendment 1).

| Worker / model / entry point | n | CPU p50 ms | CPU p95 ms | CPU max ms | n > 10 ms |
| --- | --- | --- | --- | --- | --- |
| jobs / queue `trace-session-mirror-staging` (batch 2) | 1 | 99 | 99 | 99 | 1 |
| jobs / queue `trace-session-mirror-staging` (batch 1) | 2 | 50 | 83 | 83 | 2 |
| jobs / scheduled (sweep, every minute) | 10 | 21 | 42 | 42 | 10 |
| api / rpc `messagingSend` | 5 | 15 | 30 | 30 | 4 |
| api / rpc `inviteResolve` | 6 | 13 | 19 | 19 | 5 |
| api / GET results list | 97 | 5 | 7 | 19 | 2 |
| api / rpc `consentRecord` | 4 | 16 | 18 | 18 | 4 |
| api / rpc `sessionGrant` | 4 | 11 | 16 | 16 | 3 |
| edge / SessionDO rpc `start` | 4 | 8 | 16 | 16 | 2 |
| api / rpc `lobbyMint` | 5 | 10 | 15 | 15 | 2 |
| api / rpc `sessionStarted` | 4 | 7 | 14 | 14 | 1 |
| api / POST start-photo-link | 1 | 14 | 14 | 14 | 1 |
| api / rpc `noticeGet` | 4 | 11 | 13 | 13 | 3 |
| edge / SessionDO rpc `submit` | 4 | 7 | 13 | 13 | 1 |
| api / rpc `ageDeclare` | 5 | 10 | 12 | 12 | 2 |
| edge / POST `/v1/session/start` | 4 | 7 | 11 | 11 | 1 |
| every other entry point (44 rows: edge lobby and session routes, report reads, OPTIONS) | | | | ≤ 10 | 0 |

**Result: the Workers Free 10 ms limit is exceeded.** The mirror consumer (which runs the quality and integrity
stages) takes 50-99 ms, the sweep up to 42 ms and eight api RPC methods 12-30 ms. The candidate-facing edge HTTP
routes stay at or under 11 ms, but the `SessionDO` RPCs behind them reach 13 ms (`submit`) and 16 ms (`start`), and two
api HTTP routes exceed 10 ms too (GET results list max 19 ms, POST start-photo-link 14 ms). The consumer figures were
measured before `48f6e8d`/`f226950`: one batch invocation now runs up to three sessions side by side, so its CPU per
invocation can only be higher than the 99 ms recorded; the conclusion is unchanged. All invocations ended `ok` on this account today except 3 of 5 `messagingSend` calls, which ended
`canceled` (Cloudflare's outcome when the caller stops waiting; the slice's step 4 still found one demo-outbox link
per invitation, so the cause is not yet known and is a follow-up). Nothing failed, but the Free limit gives no
headroom. Per FOUNDER-QUEUE row 2026-10-14 ("Queues and Workers Paid") and OPEN-8a this is the founder's decision:
**Workers Paid (USD 5/month)**. Queues exist and ran on the current plan (DC-D2 staging half).
