# M0a S1.7 security review: W1 redactor follow-ups

- Date: 2026-10-11, fresh `security-reviewer` agent, read-only. Diff: `git diff da5c5ca..bcb6d54 -- packages/shared` (branch `worktree-agent-ae15fb7cd05478040`, `packages/shared/src/log/`).
- Method: probes run against both the new code and the baseline (da5c5ca) under Node 22.23.3, a 200K-case differential fuzz, and all 275 `redact.test.ts` tests from a scratch copy. `pnpm verify` was not run by the reviewer.

## Verdict: PASS, with 2 Mediums to fix before merge (AUTOPILOT §2: fix every Blocking/High/Medium)
Nothing Blocking or High. The diff is a clear net improvement and implements all nine follow-ups. Only #1 and parts of #2 and #3 are regressions this diff introduced; the rest also exist at da5c5ca.

| # | Severity | file:line (at bcb6d54, `packages/shared/src/log/`) | Problem |
| --- | --- | --- | --- |
| 1 | **Medium** (regression) | `redact.ts:305-309, 343, 353-370`; `serialize-error.ts:17, 20-21, 43` | Under a stack-like key, message lines shaped like a frame survive, and stack strings over 2,000 chars are no longer truncated |
| 2 | **Medium** (pre-existing; the dash case is new) | `redact.ts:198, 90, 115` | A UPI ID followed by `.`, `-`, or (new) an em/en dash or U+2212 is not redacted |
| 3 | Low (regression) | `redact.ts:60, 112` | Dropping an ignorable (U+3164, U+FE0F, …) joins a PAN/IFSC/passport/IPv6 to the following letters, so the pattern no longer matches |
| 4 | Low | `redact.ts:125, 132-143, 193` | Secrets in JSON nested three levels deep leak (separator allows at most one backslash) |
| 5 | Low | `redact.ts:180, 193` | Free text: Authorization schemes other than Bearer/Basic/Token, and Cookie pairs after the first, leak (header objects are safe) |
| 6 | Low | `redact.ts:216-224` | IPv6 after a chained (`a:b:`), `_`-led, digit-led or >32-char prefix leaks |
| 7 | Low | `redact.test.ts:416-423` (also 250-257, 733-740) | Single-sample 50 ms wall-clock budgets flake under load |
| 8 | Low | `redact.ts:125, 193, 185` | `user[password]=`, quoted keys with spaces (`"Address Line 1"`), keys over 64 chars, and `/`, `?`, `#` inside URL passwords leak |

### 1. Medium: frame-shaped lines and the 2,000-char cap
`redactStack` calls `stackFrames(text)` = `framesOf(stack, '')`. With an empty message, the `message.includes(line)` guard never applies, so any line matching `FRAME = /^at \S[^\n]*:\d+:\d+\)?$/` is kept and only pattern-shaped PII is removed from it.
- Over the cap: `['Error: x', 'at <synthetic phrase>:1:1', ...80 × '    at f (file:///app/a.js:1:2)'].join('\n')` (2,615 chars). Baseline gives `{"stack":"[TRUNCATED]"}`; new keeps the phrase line, so text from an over-cap string reaches the log, against §9.1.
- Under the cap: `'Error: slot\nat 12:30:45 <synthetic phrase> booked:1:1'` keeps the phrase line.
- Commit 439a833 and the test at `redact.test.ts:688` claim "no message text survives"; not true for frame-shaped lines.
- **Fix:** tighten the frame shape used by `isStackFrame` and `stackFrames`: one location token with no spaces, one identifier token for the function, e.g. `/^at (?:(?:async |new )?[^\s()]+(?: \[as [^\s\]]+\])? \()?[^\s()]+:\d+:\d+\)?$/`. Real V8 and Workers frames pass; Windows paths with spaces are dropped (fails safe); linear since lines are capped at 300 chars. Also restore truncation of over-cap strings under stack keys.
- **Tests:** both repros give `{ stack: ['at f (file:///app/a.js:1:2)'] }` (or `[TRUNCATED]` over the cap); `serializeError` on an Error whose message changed after capture; positives `at Object.<anonymous> (file:///a.js:1:2)`, `at new Foo (/a.js:1:2)`, `at Foo.bar [as baz] (/a.js:1:2)`, `at node:internal/x:1:2`.

### 2. Medium: UPI ID before `.` or a dash
The UPI lookahead `(?![\w.@-])` rejects a trailing `.` or `-`, and `canonical()` now maps every Pd dash and U+2212 to `-`. `refund to <upi>.` leaks in old and new; `paid <upi>\u2014thanks` was redacted before and leaks now. (The JWT rule's `(?<![\w-])` has the same dash effect; real 32+-char segments are still caught by the base64 rule.)
- **Fix:** `(?![\w@]|\.[a-z0-9])` on the UPI rule (the email rule runs first).
- **Tests:** UPI followed by `.`, `-x`, `\u2014x`, `\u2212x` is redacted; `a.b@c.example` still redacts as an email.

### Lows: suggested fixes
- #3: drop an ignorable only when both neighbours are digits or both letters, else replace with a space. Tests: `<pan>\u3164ok`, `<ifsc>\ufe0fbranch`, `<mobile>\u3164x`.
- #4: allow `\\*["']` in the separator and opener; close at the first quote preceded by the opener's backslash count.
- #5: keyword-anchored rules `/\b((?:proxy-)?authorization\s{0,3}[=:]\s{0,3})[^\r\n"',;]+/gi` and `/\b((?:set-)?cookie\s{0,3}[=:]\s{0,3})[^\r\n"']+/gi` with `keepPrefix`.
- #6: match maximal `[\w:-]` tokens with ≥2 colons and redact the longest suffix that passes a strict IPv6 check (length ≤128).
- #7: the 107 ms is load noise, not ReDoS: every shape scales ~4× per 4× input (100K/400K/1.6M chars), idle worst case 11-19 ms at 100 KB, a genuinely quadratic regex takes 5.5 s. Use the minimum of 3-5 runs with a ~250-500 ms budget, or assert `t(4n)/t(n) < 8`.
- #8: allow `[name]` segments after a key; accept quoted keys `"([^"\\]{1,64})"\s{0,3}:`; userinfo `[^\s"'<>]{0,256}?@`.

## Checked and clean
Object path (key normalisation, STEM alternation, Map/Set/TypedArray → UNSUPPORTED, Error message/cause/AggregateError dropped, cycles → CIRCULAR, own `__proto__` dropped, no caller objects in output); hostile objects (wrapped primitives, spoofed/throwing `toStringTag`, own `slice`/`map`, species, proxies, revoked proxies, throwing getters fail closed); `redact()`, `logger.write`, `reportError` never throw; `KEY_THEN_QUOTE.lastIndex` reset; all new regexes linear (4 MB keys 12-24 ms, 2000 × U+FDFA NFKC 1 ms, 1.6 MB stack 3 ms); digit folding correct on Node 22.23.3; no secret- or PII-shaped literals added.

## Not checked
`pnpm verify` on the branch; consumer call sites; other engines' Unicode tables (Workers runtime, browsers); checklist areas outside `packages/shared/src/log`.

## Plan
Fix #1 and #2 test-first, one commit each, on the W1 stream (continue from `bcb6d54`), then merge W1 into the integration branch. Lows #3-#8 go into the M0a summary's deferred list unless cheap (#7 should be fixed with #1, since it flakes `pnpm verify`).
