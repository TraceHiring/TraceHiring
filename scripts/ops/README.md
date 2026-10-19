# Operator scripts

Small scripts a person runs by hand, locally. Each prints a fixed message on failure and never prints a
password, a key or a URL with credentials. Exit codes: `0` ok, `1` the job failed, `2` bad arguments or a
refusal (nothing was changed).

| Script | What it does | Spec |
| --- | --- | --- |
| `create-org.mjs` | Creates an org through `private.create_org`; prints the org id | `specs/m0b-tenancy.md` §4.4 |
| `add-member.mjs` | Adds a member through `private.add_member`; prints the membership id | `specs/m0b-tenancy.md` §4.4 |
| `enrol-smoke-user.mjs` | Creates (local) or enrols (staging) the smoke user | `specs/m0b-tenancy.md` §4.4 |
| `candidate-token-key.mjs` | Generates the ES256 key pair that signs candidate tokens | `specs/d1-demo-slice.md` §4.3, ADR-030 |
| `staging-worker-secrets.mjs` | Creates the four staging database login roles and sets the staging Worker secrets that hold them | `specs/d1-demo-slice.md` §3, §7.1, ADR-031 |

## Candidate-token key pair (`candidate-token-key.mjs`)

Candidate tokens are signed with ES256 (ECDSA P-256, SHA-256). `services/api` signs with the private key
(a Worker secret). `workers/edge` and `services/api` verify with the public key (a plain variable, so the
edge holds no secret). The `kid` has the form `d1-YYYY-MM` (a real month); only the current `kid` signs.

You run this once, on your own computer, before the first staging deploy. The private key goes into
Cloudflare as a secret and then the file is deleted. It never goes into git, chat or CI.

### First time

1. Pick the `kid` for this month, for example `d1-2026-10`.
2. Pick a folder **outside this repository** that only you can read, for example `~/trace-keys`
   (PowerShell: `$HOME\trace-keys`). The script refuses any folder inside a git working tree, and it never
   overwrites a file. A folder that does not exist yet is created.
3. From the repository root:

   ```
   node scripts/ops/candidate-token-key.mjs --kid d1-2026-10 --out-dir ~/trace-keys
   ```

   It writes two files and prints the public value and the exact commands. It never prints the private key.

   | File | Holds | Where it goes |
   | --- | --- | --- |
   | `candidate-token-<kid>.public.json` | the public JWK, one line | the `staging` variable `CANDIDATE_TOKEN_PUBLIC_JWK` |
   | `candidate-token-<kid>.private.jwk.json` | the private JWK, one line, mode `0600` | the api secret `CANDIDATE_TOKEN_PRIVATE_JWK` |

4. Run the commands it printed, in this order (bash or Git Bash; the paths are the ones it printed):

   ```
   gh variable set CANDIDATE_TOKEN_KID --env staging --body d1-2026-10
   gh variable set CANDIDATE_TOKEN_PUBLIC_JWK --env staging < "<public file>"
   ```

   then, from `services/api`:

   ```
   pnpm exec wrangler secret put CANDIDATE_TOKEN_PRIVATE_JWK --env staging < "<private file>"
   ```

   Git Bash runs these unchanged. PowerShell has no `<` redirection; pipe the file instead (PowerShell
   adds a line break after the text, which JSON ignores):

   ```
   Get-Content -Raw "<public file>" | gh variable set CANDIDATE_TOKEN_PUBLIC_JWK --env staging
   Get-Content -Raw "<private file>" | pnpm exec wrangler secret put CANDIDATE_TOKEN_PRIVATE_JWK --env staging
   ```

5. **Delete the private file** once `secret put` has succeeded. It is the only copy. If it is lost, make a
   new pair with a new `kid` (the old public key then simply stops being needed).

On Windows the file mode bits do not apply. The private file keeps the permissions of its folder, which is
why the script refuses a folder outside your own user profile on Windows (security review S5).

### Rotating the key

The edge must still accept tokens signed by the old key until they expire. The longest token is a session
token, capped at 3 hours (10 800 s). So the variable holds both public keys for at least that long.

1. Make the new pair, pointing at the previous public file:

   ```
   node scripts/ops/candidate-token-key.mjs --kid d1-2026-11 --out-dir ~/trace-keys \
     --previous-public ~/trace-keys/candidate-token-d1-2026-10.public.json
   ```

   The new public file is then a two-element JSON list: the new key first, the previous key second. The script refuses
   a previous key that has a private member, a repeated `kid`, and a result of more than two keys.
2. **Phase 1, verify-only (security review S4):** set `CANDIDATE_TOKEN_PUBLIC_JWK` to the same two keys
   in the other order, `[<previous key>, <new key>]`, keep `CANDIDATE_TOKEN_KID` on the previous kid and
   do not touch the secret, then deploy. Every verifier now accepts the new key while the old one still
   signs.
3. **Phase 2, switch:** run the three commands the script printed (`CANDIDATE_TOKEN_KID` = the new kid,
   `CANDIDATE_TOKEN_PUBLIC_JWK` = the new file `[<new key>, <previous key>]`, then `secret put` of the new
   private key), then deploy. `secret put` makes the api sign with the new key at once; that is safe
   because the api takes the `kid` from the private JWK and phase 1 already deployed the new public key.
4. After at least 3 hours, drop the old key: set `CANDIDATE_TOKEN_PUBLIC_JWK` to a list holding only the
   first element (`[<new key>]`, which is public data), and deploy again.
5. Delete the new private file after `secret put`, as above.

### What the script guarantees

- The key is made with WebCrypto in Node 22; there is no dependency. Before anything is written it signs a
  test message with the private JWK and checks it with the public JWK, so a broken pair is never saved.
- The private JWK is `{kty, crv, x, y, d, kid, alg: "ES256", use: "sig"}`. The public JWK is the same without
  `d`. The public value is always a JSON list, the signing key first: `[new]`, or `[new, previous]` with
  `--previous-public` (one shape for the deploy check and the api/edge parsers). The staging deploy's
  variable check (`scripts/check-deploy-vars.mjs`) accepts exactly that list of one or two keys, requires
  `CANDIDATE_TOKEN_KID` to be the first key, and fails the deploy if any key holds a private member.
- Standard output has only the `kid`, the public value and the commands. Neither stream, nor any error
  message, ever contains the private key.

## Staging login roles and Worker secrets (`staging-worker-secrets.mjs`)

The api and jobs Workers reach Postgres through four login roles (spec §3). Each login may only switch to its
one `trace_*` role:

| Login | Switches to | Worker secret | Worker (folder) |
| --- | --- | --- | --- |
| `api_login` | `trace_api` | `API_DB_URL` | `trace-api-staging` (`services/api`) |
| `jobs_mirror_login` | `trace_worker` | `JOBS_MIRROR_DB_URL` | `trace-jobs-staging` (`workers/jobs`) |
| `jobs_quality_login` | `trace_quality_worker` | `JOBS_QUALITY_DB_URL` | `trace-jobs-staging` (`workers/jobs`) |
| `jobs_integrity_login` | `trace_integrity_worker` | `JOBS_INTEGRITY_DB_URL` | `trace-jobs-staging` (`workers/jobs`) |

It also sets `MEDIA_LINK_HMAC_KEY` (64 random hex characters) on the api Worker. It does **not** set
`CANDIDATE_TOKEN_PRIVATE_JWK` (see the key pair section above) and it never touches the edge Worker, which holds
no secret.

You run it once, on your own computer, **after the first staging deploy** and before the D1 staging smoke. It
makes new random passwords, gives them to Postgres, then puts each connection string into Cloudflare. It never
prints, logs or saves a password, a key or your database URL.

### Before you start

1. The first staging deploy has run, so the migrations are applied and the Workers `trace-api-staging` and
   `trace-jobs-staging` exist. The script checks this and stops if a Worker is missing (see "Why after the
   first deploy" below).
2. `psql` (the PostgreSQL client) is on your `PATH`: `psql --version` prints a version.
3. wrangler is signed in to the Trace Cloudflare account: from the repository root,
   `pnpm exec wrangler whoami` shows the account. If not, run `pnpm exec wrangler login` first.
4. You have the staging **Session pooler** string from the Supabase dashboard (project `trace-staging`,
   Connect, Session pooler, port **5432**), with the `postgres` password filled in and `?sslmode=require` at the
   end. It looks like `postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require`.
   The direct host (`db.<ref>.supabase.co`, user `postgres`) also works; ADR-031 prefers the pooler.

### Steps (bash or Git Bash)

From the repository root. `read -rs` keeps the URL off the screen and out of your shell history.

```
read -rs TRACE_OPERATOR_DB_URL && export TRACE_OPERATOR_DB_URL
export SUPABASE_STAGING_PROJECT_REF="$(gh variable get SUPABASE_STAGING_PROJECT_REF --env staging)"
node scripts/ops/staging-worker-secrets.mjs --env staging --dry-run
node scripts/ops/staging-worker-secrets.mjs --env staging --yes
unset TRACE_OPERATOR_DB_URL
```

### Steps (PowerShell)

```
$s = Read-Host -AsSecureString 'staging session pooler URL'
$env:TRACE_OPERATOR_DB_URL = [System.Net.NetworkCredential]::new('', $s).Password
$env:SUPABASE_STAGING_PROJECT_REF = gh variable get SUPABASE_STAGING_PROJECT_REF --env staging
node scripts/ops/staging-worker-secrets.mjs --env staging --dry-run
node scripts/ops/staging-worker-secrets.mjs --env staging --yes
Remove-Item Env:TRACE_OPERATOR_DB_URL; Remove-Variable s
```

`SUPABASE_STAGING_PROJECT_REF` is public (it is also in `docs/infra/environments.md`). The script refuses a URL
whose project is not this one.

- `--dry-run` runs the checks and prints the plan (role, secret and Worker names only). It changes nothing and
  does not call wrangler.
- Without `--dry-run` or `--yes` it prints the plan, changes nothing and exits `2`.
- `--yes` does the work and prints one line per secret it set. Then the next staging deploy's
  `check-staging-secrets` step confirms the names.

### What it does, in order

1. Checks the arguments (`--env staging` only), the URL and `psql`. It refuses: a missing URL, a URL on this
   computer (the local stack makes its own logins in `scripts/e2e-local.mjs`), a host that is not Supabase,
   the transaction pooler (port 6543), a missing or weak `sslmode`, a user other than `postgres`, another
   project, and anything that looks like production.
2. Runs `wrangler secret list` for both Workers. If one fails, it stops before the database.
3. Makes four new 32-byte hex passwords and the HMAC key, in memory only.
4. Runs one transaction as `postgres` (SQL on `psql`'s standard input, `ON_ERROR_STOP=1`):
   stops if a `trace_*` role is missing (migrations not applied); for each login, creates it
   (`login noinherit`) or sets its new password; grants its one `trace_*` role `with inherit false, set true`;
   then stops if any login holds another membership or a powerful attribute. It never drops or revokes
   anything. Postgres receives each password only as a SCRAM-SHA-256 verifier, so the plain password is never
   in a server log. Any error rolls the whole transaction back.
5. Puts the five secrets with `pnpm exec wrangler secret put <NAME> --env staging`, each value on standard
   input, in `services/api` then `workers/jobs`.

### Re-running and rotation

A re-run is the rotation: new passwords first (step 4), then new secrets (step 5). Between the two, for a few
seconds, the Workers still hold the old passwords, so api calls that need the database fail and jobs
messages fail and are retried (the Queue retries 5 times; the one-minute sweep re-enqueues what is left). Run it
when no candidate is in a test.

If a `secret put` fails, the script stops and names the secrets that are now stale. Fix the cause and run it
again with `--yes`; it makes a fresh set of passwords and sets every secret again.

### Why after the first deploy

wrangler 4 asks "There doesn't seem to be a Worker called ... Do you want to create a new Worker" when
`secret put` targets a missing Worker. With piped input it does not ask: it answers yes and creates an empty
draft Worker (wrangler 4.149 `createDraftWorker`, fallback value `true`). So the script first runs
`wrangler secret list`, which fails with "not found" for a missing Worker, and stops with "run this after the
first staging deploy" before anything changes. It never hangs on a prompt.

### If it fails

| Message says | What to do |
| --- | --- |
| `TRACE_OPERATOR_DB_URL ...` or `SUPABASE_STAGING_PROJECT_REF ...` | fix that variable (the message says which rule) |
| `psql is required` | install the PostgreSQL client and reopen the terminal |
| `does not exist yet` | run the staging deploy first |
| `wrangler cannot list the secrets` | `pnpm exec wrangler login`, then retry |
| `a trace_* role is missing` | the migrations are not on staging yet; run the staging deploy |
| `unexpected membership or attribute` | someone changed a login role by hand; look at it in the SQL editor, fix it, retry |
| `the database call failed (SQLSTATE ...)` | nothing changed; check the URL and the password |
| `setting <NAME> ... failed` | the listed secrets are stale; fix the cause and re-run with `--yes` |
