// AT-D32, api half (specs/d1-demo-slice.md §9, L-23; CLAUDE.md "no PII in logs"): no event payload, label, link,
// token or code reaches a log line or an error report. Two kinds of check:
//  - static, on the real production sources: nothing calls `console` directly, and every log call names a literal
//    event from LOG_EVENTS, so a new log line is a reviewed change to this file;
//  - dynamic: synthetic PII, tokens, links and codes are planted in the failing paths (the thrown error's message,
//    the bearer token, the query string, the RPC input) and none of them appears in the captured lines or reports.
// Synthetic values are built at run time (no literal PII-shaped fixture sits in the repo).
import type { SerializedError } from '@trace/shared/log';
import { createLogger, type ErrorReporter } from '@trace/shared/log';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { runCandidateMethod } from './modules/candidate/candidate-rpc.js';
import { OrgError, type OrgDeps } from './modules/tests/org-context.js';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>;
  }
}

/** Every event name a production log call may use (method `debug|info|warn|error`, first argument). */
const LOG_EVENTS = ['candidate_rpc.failed'];

const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true });
const production = Object.entries(sources).filter(
  ([path]) => !/\.test(-helpers)?\.ts$/.test(path) && !path.endsWith('.d.ts'),
);

const LOG_CALL = /\b(?:log|logger)\s*\.\s*(?:debug|info|warn|error)\s*\(\s*([^,)]*)/g;

// ---- synthetic values ---------------------------------------------------------------------------------------------
const letters = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => String.fromCharCode(97 + ((seed * 7 + i * 5) % 26))).join('');
const digits = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => String((seed * 3 + i * 7) % 10)).join('');
const SECRETS = {
  email: `${letters(7, 1)}.${letters(5, 2)}@${letters(6, 3)}.example`,
  mobile: `9${digits(9, 4)}`,
  label: `Candidate ${letters(6, 5)}`,
  jwt: ['eyJ' + letters(18, 6), 'eyJ' + letters(22, 7), letters(30, 8)].join('.'),
  inviteToken: letters(43, 9),
  inviteUrl: `https://candidate.example/i#${letters(43, 10)}`,
  otp: digits(6, 11),
  mediaSig: letters(43, 12),
};
const planted = Object.values(SECRETS);

const capture = () => {
  const lines: string[] = [];
  const reports: SerializedError[] = [];
  const reporter: ErrorReporter = { capture: (err) => void reports.push(err) };
  return { lines, reports, reporter, sink: (line: string) => void lines.push(line) };
};

const expectClean = (texts: readonly string[]) => {
  const all = texts.join('\n');
  for (const value of planted) expect(all).not.toContain(value);
};

const ENV = { VERSION: 'dev', TRACE_ENV: 'dev' } as unknown as Env;
const ORG = '11111111-1111-4111-8111-111111111111';
const TEST = '44444444-4444-4444-8444-444444444444';
const REPORT = 'aaaaaaaa-0000-4000-8000-000000000001';

const failingOrg = (err: Error): OrgDeps => ({
  context: () => Promise.reject(err),
});

const requestWithSecrets = (path: string) =>
  new Request(`https://api.test${path}?t=${SECRETS.inviteToken}&sig=${SECRETS.mediaSig}`, {
    headers: {
      authorization: `Bearer ${SECRETS.jwt}`,
      'x-contact': SECRETS.email,
    },
  });

const ORG_PATHS = [
  `/v1/orgs/${ORG}/tests/${TEST}/results`,
  `/v1/orgs/${ORG}/reports/${REPORT}`,
  `/v1/orgs/${ORG}/reports/${REPORT}/quality`,
  `/v1/orgs/${ORG}/reports/${REPORT}/integrity`,
  `/v1/orgs/${ORG}/review/reports`,
];

describe('api log hygiene, static (AT-D32)', () => {
  it('found the production sources', () => {
    expect(production.length).toBeGreaterThan(10);
    expect(production.map(([p]) => p)).toContain('./app.ts');
  });

  it('never calls console directly', () => {
    for (const [path, src] of production) expect(src, path).not.toMatch(/\bconsole\s*\./);
  });

  it('logs only allow-listed literal events', () => {
    const seen = new Set<string>();
    for (const [path, src] of production) {
      for (const m of src.matchAll(LOG_CALL)) {
        const arg = (m[1] ?? '').trim();
        expect(arg, path).toMatch(/^'[a-z_]+\.[a-z_]+'$/);
        seen.add(arg.slice(1, -1));
      }
    }
    for (const event of seen) expect(LOG_EVENTS).toContain(event);
  });

  it('the leak check catches each planted value (guard self-test)', () => {
    for (const value of planted) expect(() => expectClean([`x ${value} y`])).toThrow();
  });

  it('the log-call pattern sees a call (guard self-test)', () => {
    const src = "log.warn('candidate_rpc.failed', { method });";
    expect([...src.matchAll(LOG_CALL)].map((m) => m[1])).toEqual(["'candidate_rpc.failed'"]);
  });
});

describe('api log hygiene, org routes (AT-D32)', () => {
  it('a bug inside an org route logs and reports none of the request or error contents', async () => {
    for (const path of ORG_PATHS) {
      const c = capture();
      const app = createApp({
        reporter: c.reporter,
        sink: c.sink,
        org: failingOrg(new Error(`failed for ${planted.join(' ')}`)),
      });
      const res = await app.fetch(requestWithSecrets(path), ENV);
      expect(res.status, path).toBe(500);
      const body = await res.text();
      expect(c.lines.length, path).toBe(1);
      expect(c.reports.length, path).toBe(1);
      expectClean([body, ...c.lines, ...c.reports.map((r) => JSON.stringify(r))]);
    }
  });

  it('an org refusal answers a constant code and logs nothing', async () => {
    for (const path of ORG_PATHS) {
      const c = capture();
      const app = createApp({
        reporter: c.reporter,
        sink: c.sink,
        org: failingOrg(new OrgError('unauthorized')),
      });
      const res = await app.fetch(requestWithSecrets(path), ENV);
      expect(res.status, path).toBe(401);
      expect(c.lines, path).toEqual([]);
      expect(c.reports, path).toEqual([]);
      expectClean([await res.text()]);
    }
  });
});

describe('api log hygiene, CandidateRpc (AT-D32)', () => {
  it('a failing method logs only its name and a SQLSTATE, never the input or the error text', async () => {
    const c = capture();
    const log = createLogger({ service: 'api', version: 'dev', sink: c.sink });
    const err = Object.assign(new Error(`db said ${planted.join(' ')}`), { code: '23505' });
    await expect(
      runCandidateMethod(
        'inviteResolve',
        { token: SECRETS.inviteToken },
        () => {
          throw err;
        },
        log,
      ),
    ).rejects.toThrow('unavailable');
    expect(c.lines).toHaveLength(1);
    const line = JSON.parse(c.lines[0] ?? '{}') as Record<string, unknown>;
    expect(line).toMatchObject({ event: 'candidate_rpc.failed' });
    expectClean(c.lines);
    expect(c.lines[0]).toContain('23505');
  });

  it('a non-SQLSTATE code is dropped, not logged', async () => {
    const c = capture();
    const log = createLogger({ service: 'api', version: 'dev', sink: c.sink });
    const err = Object.assign(new Error('x'), { code: SECRETS.otp });
    await expect(
      runCandidateMethod(
        'inviteResolve',
        { token: SECRETS.inviteToken },
        () => {
          throw err;
        },
        log,
      ),
    ).rejects.toThrow('unavailable');
    expectClean(c.lines);
  });
});
