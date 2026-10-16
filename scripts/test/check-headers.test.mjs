// AT-22-local: scripts/check-headers.mjs asserts the §10.3 headers in each app's dist/_headers.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkCsp, checkHeadersFile, parseHeadersFile, runChecks } from '../check-headers.mjs';
import { cleanupTempDirs, makeTempDir, writeFiles } from './fixtures/checks/temp-repo.mjs';

afterEach(cleanupTempDirs);

const fixture = (name) =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/checks/headers/${name}._headers`, import.meta.url)),
    'utf8',
  );
const CANDIDATE = fixture('candidate');
const RECRUITER = fixture('recruiter');
const RECRUITER_STAGING = fixture('recruiter-staging');
const SCRIPT = fileURLToPath(new URL('../check-headers.mjs', import.meta.url));
const joined = (a) => a.join('\n');

/** Replaces one header line's value in a fixture. */
const withHeader = (text, name, value) => {
  const re = new RegExp(`^(  ${name}:).*$`, 'm');
  expect(re.test(text)).toBe(true);
  return text.replace(re, `$1 ${value}`);
};
const cspOf = (text) => /Content-Security-Policy: (.*)$/m.exec(text)[1];

describe('parseHeadersFile', () => {
  it('reads rules, headers, detaches and comments', () => {
    const { rules, errors } = parseHeadersFile(
      '# c\n/*\n  X-A: 1\n  # indented comment\n/assets/*\n  ! X-A\n  Cache-Control: max-age=60\n',
    );
    expect(errors).toEqual([]);
    expect(rules).toEqual([
      { pattern: '/*', line: 2, headers: [{ name: 'x-a', value: '1', line: 3 }], detach: [] },
      {
        pattern: '/assets/*',
        line: 5,
        headers: [{ name: 'cache-control', value: 'max-age=60', line: 7 }],
        detach: [{ name: 'x-a', line: 6 }],
      },
    ]);
  });

  it('reports a header before any URL, a line without a colon and an over-long line', () => {
    const { errors } = parseHeadersFile(`  X-A: 1\n/*\n  nonsense\n/${'a'.repeat(2001)}\n`);
    expect(joined(errors)).toMatch(/line 1: header line before any URL/);
    expect(joined(errors)).toMatch(/line 3: expected "Name: value"/);
    expect(joined(errors)).toMatch(/line 4: longer than 2000/);
  });
});

describe('checkHeadersFile', () => {
  it('passes both fixture files', () => {
    expect(checkHeadersFile('candidate', CANDIDATE)).toEqual([]);
    expect(checkHeadersFile('recruiter', RECRUITER)).toEqual([]);
  });

  it('passes the recruiter staging output: the Supabase, api and Sentry origins together (d1 §7.1)', () => {
    expect(checkHeadersFile('recruiter', RECRUITER_STAGING)).toEqual([]);
  });

  it('passes the candidate with connect-src self only (edge origin not yet known, H4)', () => {
    const t = withHeader(
      CANDIDATE,
      'Content-Security-Policy',
      cspOf(CANDIDATE).replace(/ https:\/\/trace-edge-staging[^\s;]+/, ''),
    );
    expect(checkHeadersFile('candidate', t)).toEqual([]);
  });

  it('accepts CRLF line endings, any header-name case and reordered values', () => {
    const t = withHeader(
      RECRUITER,
      'Permissions-Policy',
      'geolocation=(), camera=(), microphone=()',
    )
      .replace('X-Content-Type-Options', 'x-content-type-options')
      .replace(/\n/g, '\r\n');
    expect(checkHeadersFile('recruiter', t)).toEqual([]);
  });

  it.each([
    ['Content-Security-Policy'],
    ['Strict-Transport-Security'],
    ['X-Content-Type-Options'],
    ['Referrer-Policy'],
    ['Permissions-Policy'],
  ])('fails when %s is missing', (name) => {
    const t = CANDIDATE.replace(new RegExp(`^  ${name}:.*\\n`, 'm'), '');
    expect(t).not.toBe(CANDIDATE);
    expect(joined(checkHeadersFile('candidate', t))).toMatch(
      new RegExp(`missing ${name.toLowerCase()}`),
    );
  });

  it.each([
    ['Strict-Transport-Security', 'max-age=300'],
    ['X-Content-Type-Options', 'sniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ])('fails on a weaker %s', (name, value) => {
    expect(joined(checkHeadersFile('recruiter', withHeader(RECRUITER, name, value)))).toMatch(
      new RegExp(`${name.toLowerCase()} must be`),
    );
  });

  it('fails when an app gets the other app’s Permissions-Policy', () => {
    const swapped = withHeader(
      RECRUITER,
      'Permissions-Policy',
      'camera=(self), microphone=(self), geolocation=()',
    );
    expect(joined(checkHeadersFile('recruiter', swapped))).toMatch(/permissions-policy must be/);
    const geo = withHeader(
      CANDIDATE,
      'Permissions-Policy',
      'camera=(self), microphone=(self), geolocation=(self)',
    );
    expect(joined(checkHeadersFile('candidate', geo))).toMatch(/permissions-policy must be/);
  });

  it('fails on a duplicated header, a second /* rule, or no /* rule', () => {
    const dup = CANDIDATE.replace(
      '  Referrer-Policy: no-referrer',
      '  Referrer-Policy: no-referrer\n  Referrer-Policy: no-referrer',
    );
    expect(joined(checkHeadersFile('candidate', dup))).toMatch(/sets referrer-policy 2 times/);
    expect(joined(checkHeadersFile('candidate', `${CANDIDATE}/*\n  X-A: 1\n`))).toMatch(
      /exactly one \/\* rule \(found 2\)/,
    );
    expect(joined(checkHeadersFile('candidate', CANDIDATE.replace('/*', '/app/*')))).toMatch(
      /found 0/,
    );
  });

  it('fails when another rule sets or detaches a managed header', () => {
    const set = `${RECRUITER}/embed/*\n  Content-Security-Policy: frame-ancestors *\n`;
    expect(joined(checkHeadersFile('recruiter', set))).toMatch(
      /rule \/embed\/\* sets content-security-policy/,
    );
    const detach = `${RECRUITER}/legacy/*\n  ! X-Content-Type-Options\n`;
    expect(joined(checkHeadersFile('recruiter', detach))).toMatch(
      /rule \/legacy\/\* detaches x-content-type-options/,
    );
    const other = `${RECRUITER}/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`;
    expect(checkHeadersFile('recruiter', other)).toEqual([]);
  });
});

describe('checkCsp', () => {
  const base = cspOf(RECRUITER);

  it.each([
    [
      'script-src with unsafe-inline',
      base.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    ],
    ['a wildcard default-src', base.replace("default-src 'self'", 'default-src *')],
    ['frame-ancestors self', base.replace("frame-ancestors 'none'", "frame-ancestors 'self'")],
    ['img-src without data:', base.replace("img-src 'self' data:", "img-src 'self'")],
    ['a missing object-src', base.replace("; object-src 'none'", '')],
    ['an extra directive', `${base}; worker-src blob:`],
    ['a duplicated directive', `${base}; script-src 'self' https://cdn.example.invalid`],
  ])('fails on %s', (_label, csp) => {
    expect(checkCsp('recruiter', csp).length).toBeGreaterThan(0);
  });

  it.each([
    ['candidate', 'https://trace-edge-staging.sub.workers.dev', true],
    ['candidate', 'https://*.workers.dev', false],
    ['candidate', 'http://trace-edge-staging.sub.workers.dev', false],
    ['candidate', 'https://trace-edge-staging.sub.workers.dev/path', false],
    ['candidate', 'https:', false],
    ['candidate', 'https://abcdefghijklmnopqrst.supabase.co', false],
    ['recruiter', 'https://abcdefghijklmnopqrst.supabase.co', true],
    ['recruiter', 'https://*.supabase.co', false],
    ['recruiter', 'wss://abcdefghijklmnopqrst.supabase.co', false],
    ['recruiter', 'https://trace-edge-staging.sub.workers.dev', false],
    // d1 AT-D22 / L-24: the Sentry ingest origin (EU and US hosts), recruiter only.
    ['recruiter', 'https://o1.ingest.de.sentry.io', true],
    ['recruiter', 'https://o42.ingest.sentry.io', true],
    ['recruiter', 'https://*.ingest.sentry.io', false],
    ['recruiter', 'https://sentry.io', false],
    ['recruiter', 'https://o1.ingest.de.sentry.io.example.test', false],
    ['candidate', 'https://o1.ingest.de.sentry.io', false],
    // d1 §7.1: the staging api Worker, recruiter only (the candidate reaches the api through the edge).
    ['recruiter', 'https://trace-api-staging.abhayraj.workers.dev', true],
    ['recruiter', 'https://trace-api-staging.fixture-sub.workers.dev', true],
    ['recruiter', 'https://trace-api-prod.abhayraj.workers.dev', false],
    ['recruiter', 'https://trace-api-production.abhayraj.workers.dev', false],
    ['recruiter', 'https://trace-api-dev.abhayraj.workers.dev', false],
    ['recruiter', 'https://trace-api.abhayraj.workers.dev', false],
    ['recruiter', 'https://trace-jobs-staging.abhayraj.workers.dev', false],
    ['recruiter', 'http://trace-api-staging.abhayraj.workers.dev', false],
    ['recruiter', 'wss://trace-api-staging.abhayraj.workers.dev', false],
    ['recruiter', 'https://trace-api-staging.abhayraj.workers.dev/', false],
    ['recruiter', 'https://trace-api-staging.abhayraj.workers.dev/media', false],
    ['recruiter', 'https://trace-api-staging.abhayraj.workers.dev:8443', false],
    ['recruiter', 'https://trace-api-staging.abhayraj.workers.dev.example.test', false],
    ['recruiter', 'https://trace-api-staging.evil.abhayraj.workers.dev', false],
    ['recruiter', 'https://trace-api-staging.abhayraj.pages.dev', false],
    ['recruiter', 'https://trace-api-staging.*.workers.dev', false],
    ['recruiter', 'https://*.abhayraj.workers.dev', false],
    ['recruiter', 'https://*.workers.dev', false],
    ['recruiter', '*.workers.dev', false],
    ['recruiter', 'https://user@trace-api-staging.abhayraj.workers.dev', false],
    ['candidate', 'https://trace-api-staging.abhayraj.workers.dev', false],
  ])('connect-src for %s with %s: allowed=%s', (app, origin, allowed) => {
    const csp = base.replace("connect-src 'self'", `connect-src 'self' ${origin}`);
    expect(checkCsp(app, csp)).toEqual(
      allowed ? [] : [expect.stringMatching(/not on the .* allow-list/)],
    );
  });

  it('allows the Supabase and the Sentry origin together (one per entry)', () => {
    const both = 'https://abcdefghijklmnopqrst.supabase.co https://o1.ingest.de.sentry.io';
    const csp = base.replace("connect-src 'self'", "connect-src 'self' " + both);
    expect(checkCsp('recruiter', csp)).toEqual([]);
  });

  it('allows the Supabase, api and Sentry origins together (one per entry, any order)', () => {
    const supabase = 'https://abcdefghijklmnopqrst.supabase.co';
    const api = 'https://trace-api-staging.abhayraj.workers.dev';
    const sentry = 'https://o1.ingest.de.sentry.io';
    for (const order of [
      [supabase, api, sentry],
      [api, sentry, supabase],
      [sentry, supabase, api],
    ]) {
      const csp = base.replace("connect-src 'self'", `connect-src 'self' ${order.join(' ')}`);
      expect(checkCsp('recruiter', csp)).toEqual([]);
    }
  });

  it('fails when connect-src names two origins for one allow-list entry (m0b AT-B12)', () => {
    const two = 'https://abcdefghijklmnopqrst.supabase.co https://bcdefghijklmnopqrstu.supabase.co';
    const csp = base.replace("connect-src 'self'", `connect-src 'self' ${two}`);
    expect(joined(checkCsp('recruiter', csp))).toMatch(/at most one connect-src origin/);
  });

  it('fails when connect-src names two api origins, or the api origin twice (d1 §7.1)', () => {
    const a = 'https://trace-api-staging.abhayraj.workers.dev';
    const b = 'https://trace-api-staging.other-sub.workers.dev';
    for (const sources of [`${a} ${b}`, `${b} ${a}`]) {
      const csp = base.replace("connect-src 'self'", `connect-src 'self' ${sources}`);
      expect(joined(checkCsp('recruiter', csp))).toMatch(/at most one connect-src origin/);
    }
    const repeated = base.replace("connect-src 'self'", `connect-src 'self' ${a} ${a}`);
    expect(joined(checkCsp('recruiter', repeated))).toMatch(/repeats a source/);
  });

  it('fails when one entry holds two origins glued into one source (d1 §7.1)', () => {
    // A comma or a missing space does not make a second allowed origin: each source is matched whole.
    for (const glued of [
      'https://trace-api-staging.abhayraj.workers.dev,https://trace-api-staging.other-sub.workers.dev',
      'https://trace-api-staging.abhayraj.workers.devhttps://trace-api-staging.other-sub.workers.dev',
    ]) {
      const csp = base.replace("connect-src 'self'", `connect-src 'self' ${glued}`);
      expect(checkCsp('recruiter', csp)).toEqual([
        expect.stringMatching(/not on the recruiter allow-list/),
      ]);
    }
  });

  it("fails when connect-src drops 'self'", () => {
    expect(
      joined(checkCsp('recruiter', base.replace("connect-src 'self'", 'connect-src'))),
    ).toMatch(/must include 'self'/);
  });
});

describe('runChecks and the CLI over a fixture repository', () => {
  const repo = (files) => {
    const root = makeTempDir();
    writeFiles(root, files);
    return root;
  };
  const good = () =>
    repo({
      'apps/candidate/dist/_headers': CANDIDATE,
      'apps/recruiter/dist/_headers': RECRUITER,
    });
  const run = (root) => spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });

  it('passes good dist output, and the CLI exits 0', () => {
    const root = good();
    expect(runChecks(root)).toEqual([]);
    const r = run(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/check-headers: OK/);
  });

  it('passes a recruiter staging build with all three origins, and the CLI exits 0', () => {
    const root = repo({
      'apps/candidate/dist/_headers': CANDIDATE,
      'apps/recruiter/dist/_headers': RECRUITER_STAGING,
    });
    expect(runChecks(root)).toEqual([]);
    expect(run(root).status).toBe(0);
  });

  it('fails a recruiter build whose api origin is a production host, and the CLI exits 1', () => {
    const prod = RECRUITER_STAGING.replace('trace-api-staging', 'trace-api-prod');
    expect(prod).not.toBe(RECRUITER_STAGING);
    const root = repo({
      'apps/candidate/dist/_headers': CANDIDATE,
      'apps/recruiter/dist/_headers': prod,
    });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(
      /apps\/recruiter\/dist\/_headers: CSP connect-src source .*trace-api-prod/,
    );
  });

  it('fails when an app has no dist/_headers (not built, or public/_headers not copied)', () => {
    const root = repo({ 'apps/candidate/dist/_headers': CANDIDATE });
    expect(runChecks(root)).toEqual([
      expect.objectContaining({
        file: 'apps/recruiter/dist/_headers',
        message: expect.stringMatching(/missing/),
      }),
    ]);
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/apps\/recruiter\/dist\/_headers: missing/);
  });

  it('checks each app against its own rules, and the CLI exits 1', () => {
    const root = repo({
      'apps/candidate/dist/_headers': RECRUITER,
      'apps/recruiter/dist/_headers': RECRUITER,
    });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/apps\/candidate\/dist\/_headers: permissions-policy must be/);
    expect(r.stderr).toMatch(/1 violation/);
  });
});
