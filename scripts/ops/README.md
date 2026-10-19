# Operator scripts

Small scripts a person runs by hand, locally. Each prints a fixed message on failure and never prints a
password, a key or a URL with credentials. Exit codes: `0` ok, `1` the job failed, `2` bad arguments or a
refusal (nothing was changed).

| Script | What it does | Spec |
| --- | --- | --- |
| `create-org.mjs` | Creates an org through `private.create_org`; prints the org id | `specs/m0b-tenancy.md` §4.4 |
| `add-member.mjs` | Adds a member through `private.add_member`; prints the membership id | `specs/m0b-tenancy.md` §4.4 |
| `enrol-smoke-user.mjs` | Creates (local) or enrols (staging) a smoke user: the recruiter (default) or, with `--roles reviewer`, the D1 reviewer | `specs/m0b-tenancy.md` §4.4, `specs/d1-demo-slice.md` §11 |
| `candidate-token-key.mjs` | Generates the ES256 key pair that signs candidate tokens | `specs/d1-demo-slice.md` §4.3, ADR-030 |
| `staging-worker-secrets.mjs` | Creates the four staging database login roles and sets the staging Worker secrets that hold them | `specs/d1-demo-slice.md` §3, §7.1, ADR-031 |

## First staging deploy (do these in this order)

Both Worker-secret steps below run **after** the first deploy, because `wrangler secret put` on a Worker that
does not exist yet silently creates an empty draft Worker (see "Why after the first deploy" below). The CI
dispatch input `run_e2e` (boolean, default `true`, `.github/workflows/ci.yml`) turns the e2e jobs on; the first
dispatch runs without them, because nothing on staging is ready for them yet.

1. Make the candidate-token key pair and set its two **variables** (`CANDIDATE_TOKEN_KID`,
   `CANDIDATE_TOKEN_PUBLIC_JWK`): see the key pair section below. The deploy checks these variables, so they come
   first. Keep the private file for step 3.
2. First dispatch, without e2e (from the repository checkout, on the `d1/**` branch being deployed):

   ```
   gh workflow run ci.yml --ref <branch> -f run_e2e=false
   ```

   Wait until `deploy-staging` is green. It applies the migrations and creates `trace-api-staging`,
   `trace-jobs-staging` and `trace-edge-staging`. If only the "org sign-in" smoke step fails because a smoke
   user is missing, carry on; step 5 fixes it.
3. The api secret `CANDIDATE_TOKEN_PRIVATE_JWK` (`wrangler secret put`, from `services/api`), then delete the
   private file: see the key pair section below.
4. The login roles and the other api and jobs secrets: `staging-worker-secrets.mjs --yes` (section below).
5. The staging smoke users (recruiter and reviewer, `enrol-smoke-user.mjs`) and their GitHub secrets: see
   "Staging smoke users" below.
6. Dispatch again with e2e (`run_e2e` defaults to `true`):

   ```
   gh workflow run ci.yml --ref <branch>
   ```

   Its "Check Worker secrets" step confirms that both Workers hold only allowed secret names.

## Staging smoke users (`enrol-smoke-user.mjs`)

Two synthetic users sign in to staging from CI, each with a password and TOTP. Both live in the `smoke-staging`
org, which the credential-less owner `smoke-owner+staging@example.com` owns. Each has exactly one role.

| User | Role | Made by | GitHub `staging` secrets | Used by |
| --- | --- | --- | --- | --- |
| `smoke+staging@example.com` | `recruiter` | H9 (M0b), no `--roles` | `STAGING_SMOKE_EMAIL`, `STAGING_SMOKE_PASSWORD`, `STAGING_SMOKE_TOTP_SECRET` | the deploy's org sign-in smoke, and the `e2e-staging` recruiter |
| `smoke-reviewer+staging@example.com` | `reviewer` | `--roles reviewer` (D1) | `STAGING_REVIEWER_EMAIL`, `STAGING_REVIEWER_PASSWORD`, `STAGING_REVIEWER_TOTP_SECRET` | the `e2e-staging` reviewer only |

`--roles reviewer` needs the recruiter run first: it adds the user to the existing `smoke-staging` org and never
creates one. It looks the org up before it changes anything, so without that org it stops and changes nothing.
Run it once per user. It prints only the TOTP secret, once; if a later step fails, the secret is still on screen
(a re-run would enrol a second TOTP factor; remove the first one in the dashboard before re-running).

### The reviewer, step by step

1. Supabase dashboard, project `trace-staging`, Authentication, Add user: email
   `smoke-reviewer+staging@example.com`, a generated password (keep it for step 2 and step 4).
2. From the repository root, bash or Git Bash. `read -rs` keeps each value off the screen and out of your shell
   history; the database URL is the same staging `postgres` URL as for H9.

   ```
   read -rs TRACE_OPERATOR_DB_URL && export TRACE_OPERATOR_DB_URL
   read -rs SMOKE_PASSWORD && export SMOKE_PASSWORD
   export SUPABASE_STAGING_URL="$(gh variable get SUPABASE_STAGING_URL --env staging)"
   export SUPABASE_STAGING_PUBLISHABLE_KEY="$(gh variable get SUPABASE_STAGING_PUBLISHABLE_KEY --env staging)"
   node scripts/ops/enrol-smoke-user.mjs --env staging --email smoke-reviewer+staging@example.com \
     --owner-email smoke-owner+staging@example.com --roles reviewer
   unset TRACE_OPERATOR_DB_URL SMOKE_PASSWORD
   ```

   PowerShell:

   ```
   $s = Read-Host -AsSecureString 'staging DB URL'
   $env:TRACE_OPERATOR_DB_URL = [System.Net.NetworkCredential]::new('', $s).Password
   $p = Read-Host -AsSecureString 'reviewer password'
   $env:SMOKE_PASSWORD = [System.Net.NetworkCredential]::new('', $p).Password
   $env:SUPABASE_STAGING_URL = gh variable get SUPABASE_STAGING_URL --env staging
   $env:SUPABASE_STAGING_PUBLISHABLE_KEY = gh variable get SUPABASE_STAGING_PUBLISHABLE_KEY --env staging
   node scripts/ops/enrol-smoke-user.mjs --env staging --email smoke-reviewer+staging@example.com --owner-email smoke-owner+staging@example.com --roles reviewer
   Remove-Item Env:TRACE_OPERATOR_DB_URL, Env:SMOKE_PASSWORD; Remove-Variable s, p
   ```

3. Copy the one line it printed (the TOTP secret). Exit `0` means the user is a `reviewer` of `smoke-staging`.
4. Store the three secrets in the `staging` environment. `gh` asks for each value without echoing it; paste the
   password from step 1 and the secret from step 3.

   ```
   gh secret set STAGING_REVIEWER_EMAIL --env staging --body smoke-reviewer+staging@example.com
   gh secret set STAGING_REVIEWER_PASSWORD --env staging
   gh secret set STAGING_REVIEWER_TOTP_SECRET --env staging
   ```

CI hands these three only to the Playwright step of the `e2e-staging` job (as `E2E_REVIEWER_EMAIL`,
`E2E_REVIEWER_PASSWORD`, `E2E_REVIEWER_TOTP_SECRET`); `scripts/check-workflows.mjs` fails any other step, and any
`deploy-staging` step, that holds one.

## Candidate-token key pair (`candidate-token-key.mjs`)

Candidate tokens are signed with ES256 (ECDSA P-256, SHA-256). `services/api` signs with the private key
(a Worker secret). `workers/edge` and `services/api` verify with the public key (a plain variable, so the
edge holds no secret). The `kid` has the form `d1-YYYY-MM` (a real month); only the current `kid` signs.

You make the key pair once, on your own computer, **before** the first staging deploy (the deploy checks the
public variables), and you put the private key into Cloudflare **after** it (steps 1 and 3 of "First staging
deploy" above). Then the file is deleted. It never goes into git, chat or CI.

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

4. **Now, before the first deploy:** set the two variables it printed (bash or Git Bash; the paths are the
   ones it printed):

   ```
   gh variable set CANDIDATE_TOKEN_KID --env staging --body d1-2026-10
   gh variable set CANDIDATE_TOKEN_PUBLIC_JWK --env staging < "<public file>"
   ```

5. **After the first deploy has created `trace-api-staging`** (step 2 of "First staging deploy"): put the
   private key, from `services/api`. The script prints this command too; do not run it earlier. On a Worker
   that does not exist yet, `wrangler secret put` with piped input does not stop or ask: it creates an empty
   draft Worker and puts the secret there (wrangler 4.149 `createDraftWorker`).

   ```
   pnpm exec wrangler secret put CANDIDATE_TOKEN_PRIVATE_JWK --env staging < "<private file>"
   ```

   Git Bash runs these unchanged. PowerShell has no `<` redirection; pipe the file instead (PowerShell
   adds a line break after the text, which JSON ignores):

   ```
   Get-Content -Raw "<public file>" | gh variable set CANDIDATE_TOKEN_PUBLIC_JWK --env staging
   Get-Content -Raw "<private file>" | pnpm exec wrangler secret put CANDIDATE_TOKEN_PRIVATE_JWK --env staging
   ```

6. **Delete the private file** once `secret put` has succeeded. It is the only copy. If it is lost, make a
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

You run it once, on your own computer, **after the first staging deploy** and before the D1 staging smoke
(step 4 of "First staging deploy" above). It
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
node scripts/ops/staging-worker-secrets.mjs --env staging --dry-run
node scripts/ops/staging-worker-secrets.mjs --env staging --yes
unset TRACE_OPERATOR_DB_URL
```

### Steps (PowerShell)

```
$s = Read-Host -AsSecureString 'staging session pooler URL'
$env:TRACE_OPERATOR_DB_URL = [System.Net.NetworkCredential]::new('', $s).Password
node scripts/ops/staging-worker-secrets.mjs --env staging --dry-run
node scripts/ops/staging-worker-secrets.mjs --env staging --yes
Remove-Item Env:TRACE_OPERATOR_DB_URL; Remove-Variable s
```

The staging project ref (`vsugnnxeahjtgzmgmyfu`, public, from `docs/infra/environments.md`) is pinned in the
script, so you do not need to set anything else. The script refuses a URL whose project is not this one. If
`SUPABASE_STAGING_PROJECT_REF` happens to be set in your shell, it must hold the same value, or the script stops.

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
   in a server log. A SQL error rolls the whole transaction back. If the connection drops or `psql` times out
   instead, the script cannot know whether the commit ran, says so, and asks for a re-run with `--yes`.
5. Puts the five secrets with `pnpm exec wrangler secret put <NAME> --env staging`, each value on standard
   input, in `services/api` then `workers/jobs`.

### Re-running and rotation

A re-run is the rotation: new passwords first (step 4), then new secrets (step 5). Between the two, for tens of
seconds (five `secret put` calls in a row, and each one deploys a new Worker version), the Workers still hold
the old passwords. In that window api calls that need the database fail, and jobs messages fail and are retried
(the Queue retries 5 times; the one-minute sweep re-enqueues what is left). Run it when no candidate is in a test.

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
| `ended without a SQL error ... the outcome is unknown` | the connection dropped or `psql` timed out, so the passwords may have changed and all five secrets may be stale; re-run with `--yes` |
| `setting <NAME> ... failed` | the listed secrets are stale; fix the cause and re-run with `--yes` |
