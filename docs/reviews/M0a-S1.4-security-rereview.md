Verdict: BLOCK

# M0a S1.4 security re-review: check-workflows, scan-dist, check-bundle-size, check-boundaries, .gitleaks.toml

- **Scope:** `git diff 0d8b511~4..0d8b511 -- scripts .gitleaks.toml`. That covers commits 8ceb906, 11efe17, f96007e and 0d8b511, with 401117e for context.
- **Branch:** content of `claude/trace-autopilot-continue-8d4785` at da5c5ca (now the integration branch `claude/trace-autopilot-production-87e5e2`).
- **Reviewer:** fresh `security-reviewer` subagent, read-only, 2026-10-11. Saved verbatim by the lead session.
- **Test run:** `pnpm exec vitest run --root scripts` passed 15 files and 449 tests. `node scripts/check-boundaries.mjs` printed OK.
- **Probes:** throwaway fixtures were run from a scratch directory against the real checkers and gitleaks 8.30.1. Any secret-shaped key was generated at run time and never printed. No repository file was changed.

**Why BLOCK:** two new Medium findings are open, N1 and N2 below. Both are further instances of the same holes that H1 and M4 were meant to close.

## Per-finding verdicts

| ID | Finding (from the commit messages) | Verdict | Fix in code | Pinning tests |
|---|---|---|---|---|
| H1 | The secret scan missed `SECRETS.X`, `GitHub['Token']`, `toJSON(github)`, computed or bare `secrets`, and `}}` inside a string | **PARTIAL** (see N2) | `scripts/check-workflows.mjs:565-611`: `expressionBodies` reads each expression both ways, and `secretRefs` matches case-insensitively and upper-cases names | `scripts/test/check-workflows.test.mjs`: :497 `finds %s` (10 cases); :506 `finds %s in an if: value, which is an expression without ${{ }}`; :519 `rejects %s outside deploy-staging and at job level`; :530 `rejects a mixed-case secret in an if: on a deploy-staging step` |
| H2 | A flow key or scalar starting with a YAML indicator was read literally | FIXED | `check-workflows.mjs:385-386, 418, 427-430, 439, 478-482` | :161 `a flow token starting with %s` (9 indicators x 5 positions); :185 `rejects an empty key in a flow mapping`; :189 `ends a flow plain scalar at a " #" comment, as YAML does` |
| M3 | Local actions used by other local actions were not checked, and their installs were not inherited | FIXED (Low residual N4) | `check-workflows.mjs:938-975`: existence under `.github/actions`, transitive install, cycle detection | :699 describe `nested local actions (S1.4 review MED 3)`, 5 tests |
| M4 | A required check could be emptied (step `if:`, a renamed job, a second job using the same check name) | **PARTIAL** (see N1) | `check-workflows.mjs:751-773, 989-1027` | :376, :394, :406, :670 |
| M5 | A `.gitleaksignore` or inline allow marker inside `dist/` hid findings | FIXED (Low residual N5) | `scripts/scan-dist.mjs:78-114, 149` | `scripts/test/scan-dist.test.mjs`: :117 (5 cases); :123 |
| M6 | gitleaks' default rules miss `sb_secret_` keys, and the redact.ts exemption was the bare prefix | FIXED (doc nit N6) | `.gitleaks.toml:9-15`; `scripts/check-boundaries.mjs:39-41, 76-81` | `scan-dist.test.mjs`: :137, :151. `check-boundaries.test.mjs`: :77, :83, :104 |
| L7 | A bare CR, U+0085, U+2028 or U+2029 split lines differently from this parser | FIXED | `check-workflows.mjs:510-521` | :200 (4 cases); `still accepts CRLF line endings` |
| L8 | Imports from inline module scripts were not counted in the bundle budget | FIXED (Low residual N7) | `scripts/check-bundle-size.mjs:95` | `check-bundle-size.test.mjs`: :113, :132, :145 |

**The redact.ts exemption is correct.** Only the exact, case-sensitive text `sb_secret_[\w-]*` is cut out, and only in `packages/shared/src/log/redact.ts`. The cut text is replaced with a space, so it cannot join neighbouring text into a new match, and it cannot overlap a real key literal. A key literal, the bare prefix, another case or another regex form in that file still fails.

## New findings

| # | Severity | Area | file:line | Problem | Failure scenario | Fix |
|---|---|---|---|---|---|---|
| N1 | **Medium** | AT-12 required checks | `scripts/check-workflows.mjs:746-773` (no `needs:` rule for required jobs) | A required job may `needs:` a job that is not required. When that dependency is skipped or fails, the required job is skipped by the implicit `success()` condition, and GitHub reports a skipped job as success to branch protection. | Add `changes: { if: github.event_name == 'push', ... }` and `static: { needs: changes, ... }`. On every pull request `static` is skipped, shows green, and the PR merges with no typecheck, lint, test or build. Verified: check-workflows prints OK on this fixture. | A required job's `needs:` must be absent or list only other required jobs. Add allowed and denied tests. |
| N2 | **Medium** | §7.2/§7.3 secret placement (H1 class) | `scripts/check-workflows.mjs:602-608` (`walk` scans values only, never mapping keys) | An expression used as a mapping key is never scanned. GitHub's template reader accepts an expression key in mappings that allow contexts (`env`, `with`) and evaluates it at run time. | `env: { ${{ github.token }}: x }` or `"${{ SECRETS.ANY }}": y` on a `static` step. The parse yields the key unscanned, `secretRefs` returns `[]`, and check-workflows prints OK. | Reject any mapping key containing `${{` in `parseYaml`, block and flow (fail closed), or scan keys with `expressionBodies`. Tests for block and flow keys at workflow, job and step level. |
| N3 | Low | Required checks | `check-workflows.mjs` (no `shell:` rule; `defaults:` at :705-712, steps at :633-648) | `defaults.run.shell` or a step `shell:` can be a custom template. | `defaults: { run: { shell: 'true {0}' } }` makes every `run:` step in every required job exit 0. | `shell` (defaults, steps, local-action steps) must be exactly `bash`. |
| N4 | Low | M3 residual | `check-workflows.mjs:941-949` | With both `action.yml` and `action.yaml` in one directory, the Map keeps whichever `readdirSync` returns last; GitHub prefers `action.yml`. | Install inheritance can be computed from a decoy `action.yaml`. | Fail when a directory has both manifests; sort `listFiles` output. |
| N5 | Low | AT-16 (M5 residual) | `.gitleaks.toml:6-7` (`useDefault = true` inherits gitleaks' global path allowlist); `scripts/scan-dist.mjs:78` | gitleaks silently skips some `dist/` paths: `node_modules/`, `*.svg`, archives such as `*.js.gz`, lockfile names, any path containing `gitleaks.toml`. | A synthetic key in `apps/candidate/dist/{node_modules/pkg/index.js, logo.svg, assets/index.js.gz, pnpm-lock.yaml, assets/gitleaks.toml-abc.js}` gives scan-dist OK. No current build writes these paths. | In `findHiders`, fail on any dist path matching the inherited allowlist path patterns, or list accepted image/font types explicitly. A test per path. |
| N6 | Low (docs) | §10.2 exemption text | `specs/m0-foundations.md:757` | The spec gives `sb_secret_[w-]*`; the backslash is missing. The code is correct. | Fails closed if someone "aligns" the code. | Write `sb_secret_[\w-]*` in the spec. |
| N7 | Low | D3 budget (L8 residual) | `scripts/check-bundle-size.mjs:60-66, 95` | `staticImports` sees only `./`, `../` and `/` specifiers; a cross-origin `import "https://…"` is neither counted nor reported. | Measures as 56 B with no error; CSP `script-src 'self'` blocks it at run time. | Report any `import`/`export … from` whose specifier has a scheme or starts with `//`. |

## Acknowledged open, not re-reviewed (from HANDOFF "Security review, still open")
- Install/build denylist for deploy-staging (fix before S3); e.g. `INSTALL_RE` at `check-workflows.mjs:545` misses `pnpm --frozen-lockfile install` and `pnpm -r install`.
- `if:` on steps inside composite actions that required jobs use.
- Required jobs that call a reusable workflow (looks fail-safe by reading; not verified on GitHub).

## Checked and clean
- `expressionBodies` matches GitHub's `}}` scan; linear time. Double-quoted escapes decoded before the scan. Multi-line `${{ }}` scanned.
- Non-ASCII whitespace the parser trims only produces keys GitHub rejects (fails closed).
- Check-name claimants: an expression `name:` always differs from the job id, so it is flagged.
- gitleaks config: `--config` always passed; `GITLEAKS_CONFIG*` env stripped. Allow-marker scan lowercases files first. `sb_secret_` rule detects a runtime-built key; default rules still active.

## Not checked
- Live GitHub behaviour for N1 and N2 (taken from GitHub docs and the template-reader source).
- Upper-case workflow extensions: the filter `/\.ya?ml$/` at `check-workflows.mjs:980` is case-sensitive; whether GitHub loads `.YML`/`.YAML` was not verified (a `pull_request_target` + `write-all` fixture in `evil.YML` printed OK).
- Symlinks inside `dist/`; `.github/dependabot.yml`; the S1.7 redactor diff (separate review).

## Resolution
To be filled in by the fix stream: commits per finding, regression tests, and the follow-up re-review verdict.
