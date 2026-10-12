# M0a S1.4 Lows N10–N13: security re-review of `m0a/n10-n13`

- Date: 2026-10-11, fresh read-only `security-reviewer`. Scope: `git diff 6aa191b 0d6b65e` (`scripts/check-workflows.mjs`,
  `scripts/scan-dist.mjs` and their tests).
- Ran: scripts suite 780 passed + 1 skipped; `check-workflows` OK; `scan-dist` OK on the 5 existing dist/ folders;
  probes against real gitleaks 8.30.1 with run-time keys, writing stdin in timed segments to force read ends (the
  harness reproduces the original N11 miss on a raw long line: 2 of 3 offsets).

## Verdict: PASS WITH FINDINGS (3 Lows; nothing Medium or above; N1–N9 not regressed)
- **N10 fixed**: every repro name fails at every level in any case (also a trailing-space key and a `\x4e`-escaped key);
  a whole-env expression fails. The allow-list is exactly the names `ci.yml` and the setup action use plus the 3 §7.3
  names pre-listed for S3 (harmless: secret references stay limited to deploy-staging steps). A step-level
  `MIGRATIONS_BASE` override is not a bypass (the migrations job passes `--base origin/main`). `GITHUB_ENV` writes are
  `run:` code; `with:` inputs only become `INPUT_*`. No env route left on required jobs; the rest is on deploy-staging (P2).
- **N11 partly**: 0 misses under 6 read-end patterns (48 keys straddling every piece edge of a 300 KB line with no
  newline; 60 keys in a CRLF file with blank CRLF lines; 3,000 single-line ~1.2 KB files; a 5 KB file with no newline;
  an empty file). A key that itself contains a blank line is still cut (P1); keys over 8,192 bytes are the declared
  limit (a 9.4 KB PEM missed at 2 of 12 offsets).
- **N12 fixed** (`lstat` on dist/ and every entry; hard links are regular files and get scanned; a junction above dist/
  resolves the same for scan and deploy; the only skip is the Windows EPERM case).
- **N13 fixed**: UTF-16LE/BE (BOM or not), UTF-32LE/BE, UTF-16 at an odd offset inside a binary, zlib/gzip under a
  neutral name, a zip end record appended to a PNG all fail. Residuals (accept; record in spec §15): raw deflate, brotli
  under a neutral name, lzma-alone, encrypted blobs, compressed streams inside a container. No false positive on 60
  Windows TTFs, 150 PNGs, 2 JPGs, 3 wasm files.

| # | Sev | file:line (at 0d6b65e) | Repro | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| P1 | Low | `scripts/scan-dist.mjs:274-277` (claim "never inside a piece"), `:305-318`, `:344` | gitleaks also cuts at blank lines inside a piece: a PGP armoured private key (blank line after its armour header) in `dist/assets/logo.png` (skipped by `gitleaks dir` by path) → `scanDist` OK at 6/6 offsets; in `assets/app.js` it fails. Stream of 12 such keys: stdin found 1 (12 without the blank line). Encrypted PEM (blank line after `DEK-Info`) the same | **Fix now.** In `distText` make the separators the only blank lines: for every piece (and wideText pieces), latin1 `replace(/\n(?=[\t\r ]*\n)/g, '\n.')`; correct the comments | Unit: no piece matches `/\n[\t\r ]*\n/`; e2e: a PGP key in `dist/assets/logo.png` fails the scan |
| P2 | Low | `scripts/check-workflows.mjs:874-880` | deploy-staging with `container:` (image digest, `env: {NODE_OPTIONS: --import=data:…exit(0)}`, `options: --env BASH_ENV=/x`) plus `services.s.env.LD_PRELOAD` → `checkWorkflow` returns `[]` | **Defer → W-S3b**: apply the `container:`/`services:` ban to deploy-staging (or all jobs) | deploy-staging with `container:` or `services:` fails |
| P3 | Low (pre-existing) | `scripts/check-workflows.mjs:648-653` | `ref: refs/heads/main` on the checkout in `static` → OK; on a PR the required check then tests main | **Defer → lead**, next check-workflows pass: reject `ref:`/`repository:` in `actions/checkout` `with:` in required jobs | Each key fails in each required job |

## gitleaks allowlist (confirmed)
With real 8.30.1 and the repo's `.gitleaks.toml` (`useDefault = true`), the inherited global regex
`(?i)^true|false|null$` (alternation precedence) drops true positives in `gitleaks stdin` and `dir`: `ghp_` keys
containing `false`/`FaLsE`; `sb_secret_` keys (the repo's own rule) containing `false` or ending in `null`; generic
`api_key = "…"` values starting with `true`, containing `false` or ending in `null`. ~1e-6 for random keys, but wrong.
Allowlists merge on extend, so the entry cannot be removed while `useDefault = true` stays. Fix: (1) vendor
`config/gitleaks.toml` from the v8.30.1 tag (e.g. `config/gitleaks-default-8.30.1.toml`) changing only that regex to
`'''(?i)^(?:true|false|null)$'''` (confirm the exact upstream line); (2) `.gitleaks.toml`: `useDefault = true` →
`path = "config/gitleaks-default-8.30.1.toml"` (resolved from the invocation dir; all callers run at the repo root,
scan-dist sets `cwd: root`); (3) tests that copy only `.gitleaks.toml` into a temp root must copy the vendored file too
(`scripts/test/scan-dist.test.mjs:656-661`, `scripts/test/hooks.test.mjs:72`); (4) `scripts/scan-dist.mjs:45-46`
fallback config inherits the regex; (5) test: run-time `ghp_…false…` and `sb_secret_…null` keys found by
`gitleaks stdin --config .gitleaks.toml` and by `scanDist`.

## Not checked
`gitleaks git` (would need a committed key-shaped value; same detector/allowlist code); Linux pipe read sizes; live
GitHub behaviour of `container.env` and checkout `ref:`; `pnpm build` not re-run; git state of the target worktree.

## Disposition (lead)
PASS WITH FINDINGS: `m0a/n10-n13` merges into integration. P1 fix-now (next session, lead or writer, before the S1.7
gate); P2 → W-S3b; P3 → lead's next check-workflows pass (before S3); gitleaks allowlist → lead, before M0a CLOSE
(needs the upstream v8.30.1 default config vendored; verify the exact line first).
