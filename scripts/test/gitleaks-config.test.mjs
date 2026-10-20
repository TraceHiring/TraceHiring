// The repository gitleaks config extends a vendored copy of gitleaks 8.30.1's default config in which one
// global allowlist regex is anchored (S1.4 N10-N13 security re-review). Real gitleaks, required on every
// machine and in CI; these tests fail, never skip, if it is missing.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO_ROOT,
  extendPath,
  genericApiKeyStopwords,
  randomAlnum,
  tokenWith,
  upstreamAllowlistVictims,
} from './fixtures/gitleaks-config.mjs';

const VENDORED_REL = 'config/gitleaks-8.30.1/gitleaks.toml';
const VENDORED = join(REPO_ROOT, ...VENDORED_REL.split('/'));
// sha256 of upstream config/gitleaks.toml at tag v8.30.1 (97,731 bytes), taken before the one line
// changed: https://raw.githubusercontent.com/gitleaks/gitleaks/v8.30.1/config/gitleaks.toml
const UPSTREAM_SHA256 = 'e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf';
const UPSTREAM_LINE = "    '''(?i)^true|false|null$''',";
const FIXED_LINE = "    '''(?i)^(?:true|false|null)$''',";

describe('.gitleaks.toml', () => {
  it('extends the vendored default config by path, not the built-in default', () => {
    const live = readFileSync(join(REPO_ROOT, '.gitleaks.toml'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(live).not.toMatch(/useDefault/);
    expect(extendPath()).toBe(VENDORED_REL);
    expect(existsSync(VENDORED)).toBe(true);
  });

  it('keeps the supabase-secret-key rule', () => {
    expect(readFileSync(join(REPO_ROOT, '.gitleaks.toml'), 'utf8')).toContain(
      'id = "supabase-secret-key"',
    );
  });
});

describe('vendored gitleaks 8.30.1 default config', () => {
  const text = () => readFileSync(VENDORED, 'latin1'); // byte-exact round trip

  it('is upstream v8.30.1 with the allowlist regex line as the only change', () => {
    const t = text();
    expect(t.split('\n').filter((l) => l === FIXED_LINE)).toHaveLength(1);
    expect(t).not.toContain(UPSTREAM_LINE);
    // A function replacement: UPSTREAM_LINE holds `$'`, a special pattern in a replacement string.
    const upstream = t.replace(FIXED_LINE, () => UPSTREAM_LINE);
    expect(createHash('sha256').update(upstream, 'latin1').digest('hex')).toBe(UPSTREAM_SHA256);
    expect(t).not.toContain('\r'); // LF only (.gitattributes eol=lf; check-boundaries fails CRLF)
  });

  it('allows only the whole words true, false and null, in any case', () => {
    const [line, ...rest] = text()
      .split('\n')
      .filter((l) => l.includes('true|false|null'));
    expect(rest).toEqual([]);
    expect(line).toBe(FIXED_LINE);
    const re = new RegExp(
      line
        .trim()
        .replace(/^'''|''',$/g, '')
        .replace('(?i)', ''),
      'i',
    );
    for (const word of ['true', 'false', 'null', 'TRUE', 'False', 'NuLl']) {
      expect(re.test(word), word).toBe(true);
    }
    for (const other of ['xtrue', 'true1', 'falsey', 'ghp_abcFalseXyz', 'abcnull', 'nulls']) {
      expect(re.test(other), other).toBe(false);
    }
  });
});

describe('real gitleaks with the repository config (run at the repository root)', () => {
  /** `gitleaks stdin` over one line; output is redacted. */
  const scan = (line) => {
    const r = spawnSync(
      'gitleaks',
      [
        'stdin',
        '--no-banner',
        '--no-color',
        '--redact',
        '--config',
        join(REPO_ROOT, '.gitleaks.toml'),
      ],
      { cwd: REPO_ROOT, input: `${line}\n`, encoding: 'utf8' },
    );
    expect(r.error).toBeUndefined();
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
  };

  it('loads the config and still finds a plain key (control)', () => {
    const r = scan(`const t = "${tokenWith()}";`);
    expect(r.out).not.toMatch(/Failed to load config/);
    expect(r.out).toMatch(/leaks found: 1/);
    expect(r.status).toBe(1);
    const sb = scan(`const t = "${['sb', 'secret', randomAlnum(40)].join('_')}";`);
    expect(sb.out).toMatch(/leaks found: 1/);
  });

  it('passes a line without any secret (control)', () => {
    const r = scan('const enabled = false; const value = null; const on = true;');
    expect(r.out).toMatch(/no leaks found/);
    expect(r.status).toBe(0);
  });

  // Chat E staging dispatch: the staging recruiter bundle inlines the public publishable key (H10) as
  // VITE_SUPABASE_PUBLISHABLE_KEY:`sb_publishable_…`, which generic-api-key flagged. Only that exact
  // key shape is allowed, and only for generic-api-key.
  // Random bodies avoid generic-api-key's stopwords: gitleaks drops a match whose secret holds one, so
  // an unlucky body would make these cases pass or fail by chance (security review SEC-GL-1).
  const STOPWORDS = genericApiKeyStopwords().map((w) => w.toLowerCase());
  const body = (n) => {
    for (;;) {
      const s = randomAlnum(n);
      const lower = `sb_publishable_${s}`.toLowerCase();
      if (!STOPWORDS.some((w) => lower.includes(w))) return s;
    }
  };
  const NAME = 'VITE_SUPABASE_PUBLISHABLE_KEY';
  /** `gitleaks stdin -v` over one line; the rule ids it reports (output redacted). */
  const rules = (line) => {
    const r = spawnSync(
      'gitleaks',
      [
        'stdin',
        '--no-banner',
        '--no-color',
        '--redact',
        '-v',
        '--config',
        join(REPO_ROOT, '.gitleaks.toml'),
      ],
      { cwd: REPO_ROOT, input: `${line}\n`, encoding: 'utf8' },
    );
    expect(r.error).toBeUndefined();
    return [...`${r.stdout}\n${r.stderr}`.matchAll(/RuleID:\s*(\S+)/g)].map((m) => m[1]);
  };

  it('passes the publishable key as the staging recruiter bundle inlines it', () => {
    const r = scan(`${NAME}:\`${['sb', 'publishable', body(32)].join('_')}\``);
    expect(r.out).not.toMatch(/Failed to load config/);
    expect(r.out).toMatch(/no leaks found/);
    expect(r.status).toBe(0);
  });

  it('still finds a secret key, or any other value, under the same name', () => {
    expect(rules(`${NAME}:\`${['sb', 'secret', body(32)].join('_')}\``)).toContain(
      'supabase-secret-key',
    );
    // generic-api-key itself (not github-pat): a plain high-entropy value, a prefixed one, and a
    // publishable-looking value with a `.` tail that the anchored character set refuses (SEC-GL-2).
    expect(rules(`${NAME}:\`${body(40)}\``)).toContain('generic-api-key');
    expect(rules(`${NAME}:\`x${['sb', 'publishable', body(32)].join('_')}\``)).toContain(
      'generic-api-key',
    );
    expect(rules(`${NAME}:\`${['sb', 'publishable', body(24)].join('_')}.${body(16)}\``)).toContain(
      'generic-api-key',
    );
  });

  it.each(upstreamAllowlistVictims().map((v) => [v.label, v]))('finds %s', (_label, v) => {
    const r = scan(v.line);
    expect(r.out).not.toMatch(/Failed to load config/);
    expect(r.out).toMatch(/leaks found: 1/);
    expect(r.status).toBe(1);
  });
});

describe('upstreamAllowlistVictims (test-data hygiene)', () => {
  // generic-api-key drops a match whose secret contains one of its stopwords (case-insensitive), so a
  // random value that happens to contain "ajax", "akka", "amqp"... made the scan-dist case flaky.
  it('reads the generic-api-key stopwords from the vendored config', () => {
    const words = genericApiKeyStopwords();
    expect(words.length).toBeGreaterThan(1000);
    expect(words).toEqual(expect.arrayContaining(['ajax', 'akka', 'amqp']));
  });

  it('never builds an api_key victim that contains a stopword', () => {
    const words = genericApiKeyStopwords();
    for (let i = 0; i < 500; i += 1) {
      const v = upstreamAllowlistVictims().find((x) => x.label.startsWith('an api_key value'));
      const lower = v.secret.toLowerCase();
      expect(words.find((w) => lower.includes(w))).toBeUndefined();
      expect(v.secret.startsWith('true')).toBe(true);
    }
  });
});
