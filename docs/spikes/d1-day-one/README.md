# D1 day-one spike: DC-D2, DC-D3, DC-D4, DC-D7

Throwaway, standalone npm project (not in the pnpm workspace). Run locally on 2026-10-14 for
`specs/d1-demo-slice.md` section 8. Synthetic data only; keys are generated at run time and never printed.
DC-D1, D5, D6, D8 and D9 are out of scope for this spike (NOT RUN).

## How to run

```sh
cd docs/spikes/d1-day-one
npm install                     # .npmrc sets legacy-peer-deps (npm 10 arborist crash without it)

# DC-D4
npm run d4:node                 # Node 22
npx vitest run --reporter=verbose --silent=false   # workerd, @cloudflare/vitest-pool-workers

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

## Versions

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
