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
