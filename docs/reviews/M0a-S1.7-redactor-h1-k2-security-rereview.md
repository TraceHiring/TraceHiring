# M0a S1.7 redactor H1 and K2: security re-review of `72f8f1f` and `2b81ac4`

- Date: 2026-10-11, read-only `security-reviewer` (Sonnet; small re-review). Judged against the founder's
  backstop-scope decision (honest mistakes in scope, crafted log text out of scope).
- Scope: `git diff 26855cb 2b81ac4 -- packages/shared/src/log`: `redact.ts` (+6/−1: the `Bearer|Basic` step at
  `:407`, the `Token` step at `:412`), `redact.test.ts` (+36).
- Ran: `redact.ts` at `26855cb`, `72f8f1f`, `2b81ac4` bundled with esbuild (synthetic values at run time); 28 H1/K2/
  control shapes on all three; a product fuzz of 908,544 strings (14 prefixes × 13 words × 13 whitespace runs × 12
  separators × 8 gaps × 4 quote forms; tabs, newlines, NBSP, U+3000); random-alphabet fuzz 400K (seed 12345) + 600K
  (seed 777); timing of 11 scheme shapes at 100–800 KB; `@trace/shared` test (613 passed), typecheck, lint.

## Verdict: PASS WITH FINDINGS
- **H1 fixed**: `token = v`, `my token = v`, `token = "v"`, `Token  :  v`, `auth.token = v, retries=3` leak at
  `26855cb` and are redacted at `2b81ac4`, second pass unchanged; `Token v`, `Bearer v`, `Basic v`,
  `Authorization: Basic v` still fully redacted.
- **K2 fixed**: `Bearer =v`, `Basic =v`, `Bearer :v`, `Basic :v` redacted (leaked at `72f8f1f`); the Bearer/Basic regex
  is character-identical to `26855cb`.
- One Low regression vs `26855cb` (J1); no other differential leak on an honest shape. Linear time unchanged (~2× per
  doubling; no `< 50 ms` guard changed).

| # | Sev | file:line | Repro | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| J1 | Low (regression vs `26855cb`; rare honest shape: aligned dumps with no space after the separator) | `packages/shared/src/log/redact.ts:412` (`Token` step; key-rule gaps `\s{0,3}` at `:167`, `:232`) | `'Token' + ' '.repeat(n) + '=' + v` (or `':'`), n = 4..8 (tabs/newlines too): redacted at `26855cb`, leaks at `72f8f1f`/`2b81ac4` (the look-ahead hands it to the key rule, whose gap is `\s{0,3}`); 966 of 908,544 fuzz strings. Side effect (no leak): `Token` + 4–8 spaces + `::` + x is not idempotent (IPv6 step takes `::`; 685 strings, 0 at `26855cb`). Pre-existing: `Token    = v` leaks at all three | Add after `:412`: `sub(/\b(Token\s{4,8}[=:]\s{0,3})[^\s"',;]+/gi, keepPrefix),` (scratch-checked: J1 shapes and `Token    = v` redacted; non-idempotent 685 → 0 in the product fuzz, 258 → 173 in the 400K fuzz = `26855cb`; nothing new leaks; not run against the suite) | `Token`+4 spaces+`=`+v; `Token`+8 spaces+`:`+v; `Token`+4 tabs+`:`+v; `Token    = `+v redacted, second pass unchanged; `Token    ::`+v second pass unchanged |

Other differential strings vs `26855cb` (not findings): 2,306 `Authorization:`/`Cookie:` + `Token` + line break +
separator (the old scheme step ran across the line break; unchanged by the J1 fix); 128 random-fuzz strings, all
crafted (`token  :&v`, `=>`/`==`/`:=` before `)`, `&` inside a value, `password:Token :v`, `Bearer Basic <v>`).
Improvements: 68,820 product and 66 random strings now redacted that `26855cb` leaked.

## Reviewer checklist (out of scope, no fix asked)
- `Bearer = v`, `Basic : v` (space after the separator) leak `v`; same at all three SHAs; not an honest shape.
- Any key with a 4+ whitespace gap before `=`/`:` (`password    =v`) leaks (key-rule gap `\s{0,3}`); pre-existing.

## Not checked
`pnpm verify`, `test:rls`, the database, other packages; the J1 fix against the repo suite; browser/Workers runtimes
(Node 22.23.3 only); object values and the logger wrapper beyond existing tests; non-ASCII separators beyond U+3000/NBSP.

## Disposition (lead)
PASS WITH FINDINGS accepted (H1, K2 closed). **J1** (Low) → lead, first step next session: test-first with the
reviewer's tests, then the suggested step, `@trace/shared` suite, and a one-line note in this file. Stopped at 86%
usage (founder rule), so not fixed this session.
