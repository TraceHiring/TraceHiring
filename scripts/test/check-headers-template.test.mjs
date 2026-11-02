// d1 spec §7.1: the recruiter's `_headers.template` gets `__API_ORIGIN__` the way m0b added
// `__SUPABASE_ORIGIN__`. The headers-template Vite plugin (packages/config/vite/headers-template.js)
// fills it from VITE_API_ORIGIN, or drops it when the variable is unset, and `check-headers` then checks
// the emitted file. This file runs the real template through the real plugin into the real checker, so
// the three cannot drift apart. The plugin's own unit tests for the Supabase and Sentry tokens stay in
// packages/config/test/headers-template.test.ts.
// Every host, project ref and DSN below is synthetic.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  API_ORIGIN_TOKEN,
  SENTRY_ORIGIN_TOKEN,
  SUPABASE_ORIGIN_TOKEN,
  headersTemplatePlugin,
  renderHeaders,
} from '../../packages/config/vite/headers-template.js';
import { checkHeadersFile } from '../check-headers.mjs';

const RECRUITER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'apps',
  'recruiter',
);
const TEMPLATE = readFileSync(path.join(RECRUITER, '_headers.template'), 'utf8');

const API = 'https://trace-api-staging.fixture-sub.workers.dev';
const SUPABASE = 'https://abcdefghijklmnopqrst.supabase.co';
const INGEST = 'https://o1.ingest.de.sentry.io';
const DSN = `https://${'ab12'.repeat(8)}@o1.ingest.de.sentry.io/42`;

/** The connect-src sources of the Content-Security-Policy line (not the template's comment). */
const connectSrc = (headers) =>
  /^\s+Content-Security-Policy:.*?\bconnect-src ([^;]*);/m.exec(headers)?.[1];

/** Runs the real template through the plugin hooks the way Vite does, with `env` as the resolved env. */
function build(env, root = RECRUITER) {
  const plugin = headersTemplatePlugin();
  const emitted = [];
  plugin.configResolved({ root, env });
  plugin.generateBundle.call({ emitFile: (file) => emitted.push(file) });
  return emitted;
}

describe('the recruiter template', () => {
  it('holds the API token once, in connect-src after the Supabase token', () => {
    expect(API_ORIGIN_TOKEN).toBe('__API_ORIGIN__');
    expect(TEMPLATE.split(API_ORIGIN_TOKEN)).toHaveLength(2);
    expect(connectSrc(TEMPLATE)?.split(' ')).toEqual([
      "'self'",
      SUPABASE_ORIGIN_TOKEN,
      API_ORIGIN_TOKEN,
      SENTRY_ORIGIN_TOKEN,
    ]);
  });
});

describe('VITE_API_ORIGIN fills the API token (d1 §7.1)', () => {
  it('puts the origin between the Supabase and Sentry origins', () => {
    const out = renderHeaders(TEMPLATE, SUPABASE, DSN, API);
    expect(connectSrc(out)).toBe(`'self' ${SUPABASE} ${API} ${INGEST}`);
    expect(out).not.toContain('__');
    expect(checkHeadersFile('recruiter', out)).toEqual([]);
  });

  it('writes the API origin alone as connect-src self plus that one origin', () => {
    const out = renderHeaders(TEMPLATE, undefined, undefined, API);
    expect(connectSrc(out)).toBe(`'self' ${API}`);
    expect(checkHeadersFile('recruiter', out)).toEqual([]);
  });

  it.each([
    ['no variable', []],
    ['the Supabase URL', ['supabase']],
    ['the Sentry DSN', ['sentry']],
    ['the API origin', ['api']],
    ['Supabase and Sentry', ['supabase', 'sentry']],
    ['Supabase and the API', ['supabase', 'api']],
    ['the API and Sentry', ['api', 'sentry']],
    ['all three', ['supabase', 'api', 'sentry']],
  ])('check-headers accepts the real template filled with %s', (_label, set) => {
    const out = renderHeaders(
      TEMPLATE,
      set.includes('supabase') ? SUPABASE : undefined,
      set.includes('sentry') ? DSN : undefined,
      set.includes('api') ? API : undefined,
    );
    expect(out).not.toContain('__');
    expect(checkHeadersFile('recruiter', out)).toEqual([]);
  });

  it('normalises to the origin: one trailing slash is dropped', () => {
    for (const value of [API, `${API}/`]) {
      expect(connectSrc(renderHeaders(TEMPLATE, undefined, undefined, value))).toBe(
        `'self' ${API}`,
      );
    }
  });

  it("drops the token and its leading space when the variable is unset or empty (local and CI builds keep connect-src 'self')", () => {
    for (const value of [undefined, null, '']) {
      const out = renderHeaders(TEMPLATE, undefined, undefined, value);
      expect(connectSrc(out)).toBe("'self'");
      expect(out).not.toContain(API_ORIGIN_TOKEN);
      expect(out).toContain("connect-src 'self'; frame-ancestors");
    }
    expect(connectSrc(renderHeaders(TEMPLATE, SUPABASE, DSN))).toBe(`'self' ${SUPABASE} ${INGEST}`);
  });

  it.each([
    ['http, not https', API.replace('https', 'http')],
    ['a plain-text websocket scheme', API.replace('https', 'wss')],
    ['a path', `${API}/v1`],
    ['a path after two slashes', `${API}//`],
    ['a query', `${API}?x=1`],
    ['a fragment', `${API}#x`],
    ['a port', `${API}:8443`],
    ['credentials', API.replace('://', '://user:pw@')],
    ['a wildcard host', 'https://*.workers.dev'],
    ['a wildcard subdomain', 'https://trace-api-staging.*.workers.dev'],
    ['a wildcard label', 'https://*-staging.fixture-sub.workers.dev'],
    ['a production host', 'https://trace-api-prod.fixture-sub.workers.dev'],
    ['a dev host', 'https://trace-api-dev.fixture-sub.workers.dev'],
    ['the bare api name', 'https://trace-api.fixture-sub.workers.dev'],
    ['the edge Worker', 'https://trace-edge-staging.fixture-sub.workers.dev'],
    ['the jobs Worker', 'https://trace-jobs-staging.fixture-sub.workers.dev'],
    ['a pages.dev host', 'https://trace-api-staging.pages.dev'],
    ['a dotted subdomain', 'https://trace-api-staging.evil.fixture-sub.workers.dev'],
    ['another domain after it', `${API}.example.test`],
    ['an upper-case host', API.toUpperCase().replace('HTTPS', 'https')],
    ['the Supabase URL', SUPABASE],
    ['a local URL', 'http://127.0.0.1:8787'],
    ['two origins separated by a space', `${API} ${API.replace('fixture-sub', 'other-sub')}`],
    ['two origins separated by a comma', `${API},${API.replace('fixture-sub', 'other-sub')}`],
    ['leading space', ` ${API}`],
    ['a trailing newline', `${API}\n`],
    ['a CSP injection', `${API}; script-src *`],
    ['not a URL', 'not a url'],
    ['a number', 42],
    ['an object', { origin: API }],
    ['true', true],
  ])('fails the build for %s, without echoing the value', (_label, value) => {
    expect(() => renderHeaders(TEMPLATE, undefined, undefined, value)).toThrow(/VITE_API_ORIGIN/);
    expect(() => renderHeaders(TEMPLATE, undefined, undefined, value)).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('fixture-sub') }),
    );
  });

  it('does not echo a rejected value, whatever it holds', () => {
    const marker = `${API}/secret-marker`;
    expect(() => renderHeaders(TEMPLATE, undefined, undefined, marker)).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secret-marker') }),
    );
  });

  it('fails when the variable is set but the template has no API token, or when it has two', () => {
    const without = TEMPLATE.replace(` ${API_ORIGIN_TOKEN}`, '');
    expect(without).not.toBe(TEMPLATE);
    expect(() => renderHeaders(without, SUPABASE, DSN, API)).toThrow(
      /__API_ORIGIN__.*exactly once/,
    );
    const twice = `${TEMPLATE}# ${API_ORIGIN_TOKEN}\n`;
    expect(() => renderHeaders(twice, SUPABASE, DSN, API)).toThrow(/__API_ORIGIN__.*exactly once/);
    // A second token is wrong even when the variable is unset, so a stray token cannot reach dist/.
    expect(() => renderHeaders(twice, SUPABASE, DSN)).toThrow(/__API_ORIGIN__.*exactly once/);
  });

  it('keeps the Supabase token required exactly once', () => {
    expect(() =>
      renderHeaders(TEMPLATE.replace(SUPABASE_ORIGIN_TOKEN, ''), undefined, undefined, API),
    ).toThrow(/__SUPABASE_ORIGIN__.*exactly once/);
  });
});

describe('the plugin reads VITE_API_ORIGIN (d1 §7.1)', () => {
  it('emits dist/_headers with the API origin filled in, and check-headers accepts it', () => {
    const [file, ...rest] = build({
      VITE_SUPABASE_URL: SUPABASE,
      VITE_SENTRY_DSN: DSN,
      VITE_API_ORIGIN: API,
    });
    expect(rest).toEqual([]);
    expect(file).toMatchObject({ type: 'asset', fileName: '_headers' });
    expect(connectSrc(file.source)).toBe(`'self' ${SUPABASE} ${API} ${INGEST}`);
    expect(checkHeadersFile('recruiter', file.source)).toEqual([]);
  });

  it('emits connect-src self alone for a local or CI build with none of the variables set', () => {
    const [file] = build({});
    expect(connectSrc(file.source)).toBe("'self'");
    expect(checkHeadersFile('recruiter', file.source)).toEqual([]);
  });

  it('reads only VITE_API_ORIGIN: other names for the same value are ignored', () => {
    for (const name of ['VITE_API_URL', 'API_ORIGIN', 'VITE_API_BASE_URL', 'VITE_EDGE_ORIGIN']) {
      const [file] = build({ [name]: API });
      expect(connectSrc(file.source), name).toBe("'self'");
    }
    // ...and a bad value under another name does not fail the build either.
    expect(() => build({ VITE_API_URL: 'http://127.0.0.1:8787' })).not.toThrow();
  });

  it('fails in configResolved for a bad origin, before anything is built', () => {
    const plugin = headersTemplatePlugin();
    for (const value of [
      'https://trace-api-prod.fixture-sub.workers.dev',
      `${API}/v1`,
      'https://*.workers.dev',
      API.replace('https', 'http'),
    ]) {
      expect(() =>
        plugin.configResolved({ root: RECRUITER, env: { VITE_API_ORIGIN: value } }),
      ).toThrow(/VITE_API_ORIGIN/);
    }
  });
});

// d1 spec rev 4i: an explicitly local build (VITE_TRACE_ENV=dev, e2e-local) may name the local stack's
// loopback origins, but a shipped _headers may not: check-headers refuses an http origin whatever built it.
// CI never builds with VITE_TRACE_ENV=dev.
describe('a local build and check-headers (d1 rev 4i)', () => {
  const LOCAL_SUPABASE = 'http://127.0.0.1:54321';
  const LOCAL_API = 'http://localhost:8788';

  it('the plugin fills both loopback origins for VITE_TRACE_ENV=dev', () => {
    const [file] = build({
      VITE_TRACE_ENV: 'dev',
      VITE_SUPABASE_URL: LOCAL_SUPABASE,
      VITE_API_ORIGIN: LOCAL_API,
    });
    expect(connectSrc(file.source)).toBe(`'self' ${LOCAL_SUPABASE} ${LOCAL_API}`);
  });

  it('check-headers still refuses that _headers (an http origin is never shippable)', () => {
    const [file] = build({
      VITE_TRACE_ENV: 'dev',
      VITE_SUPABASE_URL: LOCAL_SUPABASE,
      VITE_API_ORIGIN: LOCAL_API,
    });
    const problems = checkHeadersFile('recruiter', file.source);
    expect(problems).toHaveLength(2);
    for (const problem of problems) expect(problem).toMatch(/not on the recruiter allow-list/);
  });

  it('without VITE_TRACE_ENV=dev the same values fail the build', () => {
    for (const env of [{}, { VITE_TRACE_ENV: 'production' }, { VITE_TRACE_ENV: 'staging' }]) {
      expect(() => build({ ...env, VITE_SUPABASE_URL: LOCAL_SUPABASE })).toThrow(
        /VITE_SUPABASE_URL/,
      );
      expect(() => build({ ...env, VITE_API_ORIGIN: LOCAL_API })).toThrow(/VITE_API_ORIGIN/);
    }
  });
});
