# M0a S1.4 Lows N8 and N9: security re-review

- Date: 2026-10-11, fresh `security-reviewer` agent, read-only (throwaway worktree, removed afterwards; probe files with run-time keys deleted).
- Scope: N9 `a2d9dc8` (`scripts/check-workflows.mjs`) and N8 `64bd4e3` (`scripts/scan-dist.mjs`), both on `m0a/s14-lows`, against `docs/reviews/M0a-S1.4-security-rereview.md` rows N8/N9, spec AT-12, AT-16, §10.2, §15 and CLAUDE.md.

## Verdict: PASS WITH FINDINGS (4 Lows; nothing Medium or above)
- **N9: PARTLY FIXED.** `SHELLOPTS`, `BASHOPTS`, `BASH_ENV` and `ENV` are rejected at workflow, job, step and composite-action-step level in any case; expression keys and `container:`/`services:` on required jobs are rejected. Other env-only routes still pass (N10).
- **N8: FIXED.** All four N8 repros now fail the scan (a `%PDF` or tar-sniffing file sorting first, a NUL-containing svg, a key after `\0asm`, gzip bytes in `data.dat`); the walk is sorted. Three new gaps: N11–N13.
- **Regression tests are real:** the 7 new N9 "rejects" tests fail on `6188d53`; the 14 new N8 tests fail on `a2d9dc8`. Mutants: a one-line header fails 2 tests; restoring the NUL filter fails 3; removing the magic-byte check fails 8. At `64bd4e3`, 227/227 pass.

| # | Sev | file:line (at 64bd4e3) | Problem and repro | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| N10 | Low | `scripts/check-workflows.mjs:663` (deny-list of 4 names), `:667` | Added to the workflow `env:` of the real `ci.yml`, each still gives OK: `BASH_FUNC_pnpm%%: "() { :; }"`, `NODE_OPTIONS: --import=data:text/javascript,process.exit(0)`, `pnpm_config_script_shell: "true"`, `LD_PRELOAD`, `PATH`, `ACTIONS_ALLOW_UNSECURE_COMMANDS`. Locally (bash 5.2, `--noprofile --norc -eo pipefail`) the first three make `pnpm verify`/`node` steps exit 0 without running. A whole-env expression on a step (`env: ${{ fromJSON('{"SHELLOPTS":"noexec"}') }}`) also gives OK | Fail closed: only `^[A-Z][A-Z0-9_]*$` names from an explicit allow-list; reject an `env:` that is not a mapping | Each name at every level, plus the whole-env expression |
| N11 | Low | `scripts/scan-dist.mjs:178` | gitleaks `stdin` cuts long lines, so a key straddling a cut is missed (a 400 KB single-line file with the key at stream offset ~153,650; 3,000 single-line ~1.2 KB files: 4 keys missed with `\n`, 0 with `\n\n`). Linux cut offsets differ | Join files with `\n\n`; second pass with a longer header for files with a line over 20 KB | A key across each cut of the first pass is found |
| N12 | Low | `scripts/scan-dist.mjs:119`, `:177-178` | Symlinks/junctions are skipped by the scan and by `gitleaks dir`, but wrangler's asset and Pages walks `fs.stat` and upload the target (wrangler 4.124.0 `cli.js:156444`, `:415590`) | Fail on any dist entry that is neither a regular file nor a directory | A symlink/junction in dist fails the scan |
| N13 | Low | `scripts/scan-dist.mjs:142-150`, `:178` | Unreadable content passes: a UTF-16LE `assets/config.json` (with or without BOM) holding a key; zlib bytes in `assets/data.bin`; no zlib, lz4, `.Z`, lzip or offset-zip magic; brotli only by `.br` name | Add a UTF-8 copy of UTF-16 files; extend the magic list (zlib with header checksum) or fail non-UTF-8 files that are not a known binary type | A UTF-16 key is found; zlib under a neutral name fails |

## Checked
- check-workflows: YAML anchors, aliases, merge keys and tags fail closed; flow-mapping `env:` is checked; name case variants caught; `defaults.run.shell` still held to bash (N3); a local reusable workflow is reported as a missing local action; the real `ci.yml` passes.
- scan-dist with real gitleaks 8.30.1 (keys built at run time): MZ, ISO `CD001` at 32769, 200 KB random bytes or an empty file sorting first do not hide a later key; a key at byte 0 of the first file is found; the 128,000-byte header exceeds gitleaks' 100 KB first read; extensionless files are scanned; spawn error or ENOBUFS exits 1.

## Not checked
Live GitHub behaviour (`%` in env keys, a whole `env:` expression, NODE_OPTIONS on hosted runners); Linux stdin cut offsets; Windows file symlinks (EPERM); whether Vite copies symlinks from `public/`; `GITHUB_ENV` writes from `run:` steps; a repo-root `.gitleaksignore` applying to the stdin scan (earlier open item).

## Disposition (lead)
`m0a/s14-lows` (`64bd4e3`) merged into `m0a/integration` (`008515d`; 227/227, `check-workflows: OK`). N10–N13 assigned to a writer on a branch from `64bd4e3`, test-first, one commit each; owed before S3 (they guard CI and deploy).
