// Vite plugin that writes dist/_headers from an app's _headers.template, filling connect-src with the
// Supabase origin of VITE_SUPABASE_URL or dropping the token when it is unset (specs/m0b-tenancy.md §2.7).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  API_ORIGIN_TOKEN,
  SENTRY_ORIGIN_TOKEN,
  SUPABASE_ORIGIN_TOKEN,
  headersTemplatePlugin,
  renderHeaders,
} from '../vite/headers-template.js';

// Synthetic 20-character project refs, not real projects.
const REF = 'abcdefghijklmnopqrst';
const URL_OK = `https://${REF}.supabase.co`;
const TEMPLATE = [
  '# comment',
  '/*',
  `  Content-Security-Policy: default-src 'self'; connect-src 'self' ${SUPABASE_ORIGIN_TOKEN}; object-src 'none'`,
  '  X-Content-Type-Options: nosniff',
  '',
].join('\n');

describe('renderHeaders', () => {
  it('replaces the token with the origin of the Supabase URL', () => {
    for (const url of [URL_OK, `${URL_OK}/`]) {
      expect(renderHeaders(TEMPLATE, url)).toContain(`connect-src 'self' ${URL_OK};`);
    }
  });

  it('drops the token (and its leading space) when the URL is unset or empty', () => {
    for (const url of [undefined, '']) {
      const out = renderHeaders(TEMPLATE, url);
      expect(out).toContain("connect-src 'self'; object-src");
      expect(out).not.toContain(SUPABASE_ORIGIN_TOKEN);
    }
  });

  it.each([
    ['http, not https', `http://${REF}.supabase.co`],
    ['a path', `${URL_OK}/rest/v1`],
    ['a query', `${URL_OK}?x=1`],
    ['a port', `https://${REF}.supabase.co:8443`],
    ['a short ref', 'https://abc.supabase.co'],
    ['an upper-case ref', `https://${REF.toUpperCase()}.supabase.co`],
    ['another domain', `https://${REF}.supabase.co.example.test`],
    ['a wildcard', 'https://*.supabase.co'],
    ['credentials', `https://user:pw@${REF}.supabase.co`],
    ['a local URL', 'http://127.0.0.1:54321'],
    ['not a URL', 'not a url'],
  ])('fails the build for %s', (_label, url) => {
    expect(() => renderHeaders(TEMPLATE, url)).toThrow(/VITE_SUPABASE_URL/);
  });

  it('does not echo the rejected value', () => {
    const marker = `https://${REF}.supabase.co/secret-marker`;
    expect(() => renderHeaders(TEMPLATE, marker)).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secret-marker') }),
    );
  });

  it('fails unless the template holds the token exactly once', () => {
    expect(() => renderHeaders(TEMPLATE.replace(SUPABASE_ORIGIN_TOKEN, ''), URL_OK)).toThrow(
      /exactly once/,
    );
    expect(() => renderHeaders(`${TEMPLATE}# ${SUPABASE_ORIGIN_TOKEN}\n`, URL_OK)).toThrow(
      /exactly once/,
    );
  });
});

// d1 AT-D22 / L-24: the recruiter's connect-src also gets the Sentry ingest origin of VITE_SENTRY_DSN. The DSN
// is built at run time, so no DSN-shaped literal sits in the repo.
describe('renderHeaders: the Sentry ingest origin', () => {
  const INGEST = 'https://o1.ingest.de.sentry.io';
  const dsn = (host = 'o1.ingest.de.sentry.io'): string => `https://${'ab12'.repeat(8)}@${host}/42`;
  const WITH_SENTRY = TEMPLATE.replace(
    `${SUPABASE_ORIGIN_TOKEN};`,
    `${SUPABASE_ORIGIN_TOKEN} ${SENTRY_ORIGIN_TOKEN};`,
  );

  it('replaces the Sentry token with the ingest origin of the DSN, never the key or project', () => {
    const out = renderHeaders(WITH_SENTRY, URL_OK, dsn());
    expect(out).toContain(`connect-src 'self' ${URL_OK} ${INGEST};`);
    expect(out).not.toContain('ab12');
    expect(out).not.toContain('/42');
  });

  it('accepts the US ingest host too', () => {
    expect(renderHeaders(WITH_SENTRY, URL_OK, dsn('o7.ingest.sentry.io'))).toContain(
      'https://o7.ingest.sentry.io;',
    );
  });

  it('drops the Sentry token when the DSN is unset or empty', () => {
    for (const value of [undefined, '']) {
      const out = renderHeaders(WITH_SENTRY, URL_OK, value);
      expect(out).toContain(`connect-src 'self' ${URL_OK}; object-src`);
      expect(out).not.toContain(SENTRY_ORIGIN_TOKEN);
    }
    expect(renderHeaders(WITH_SENTRY, undefined, undefined)).toContain(
      "connect-src 'self'; object-src",
    );
  });

  it.each([
    ['http', dsn().replace('https', 'http')],
    ['another host', dsn('o1.ingest.de.sentry.io.example.test')],
    ['a non-ingest Sentry host', dsn('sentry.io')],
    ['a query', `${dsn()}?x=1`],
    ['no public key', 'https://o1.ingest.de.sentry.io/42'],
    ['not a DSN', 'not a dsn'],
  ])('fails the build for %s, without echoing the value', (_label, value) => {
    expect(() => renderHeaders(WITH_SENTRY, URL_OK, value)).toThrow(/VITE_SENTRY_DSN/);
    expect(() => renderHeaders(WITH_SENTRY, URL_OK, value)).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('ab12') }),
    );
  });

  it('fails when a DSN is set but the template has no Sentry token, or has it twice', () => {
    expect(() => renderHeaders(TEMPLATE, URL_OK, dsn())).toThrow(/exactly once/);
    expect(() => renderHeaders(`${WITH_SENTRY}# ${SENTRY_ORIGIN_TOKEN}\n`, URL_OK, dsn())).toThrow(
      /exactly once/,
    );
  });
});

// Spec d1 rev 4i: a build that says VITE_TRACE_ENV=dev (e2e-local) may also name the local stack's loopback
// origins; every other build keeps the staging forms only. The values below are synthetic local origins.
describe('renderHeaders: loopback origins for an explicitly local build (VITE_TRACE_ENV=dev)', () => {
  const WITH_API = TEMPLATE.replace(
    `${SUPABASE_ORIGIN_TOKEN};`,
    `${SUPABASE_ORIGIN_TOKEN} ${API_ORIGIN_TOKEN};`,
  );
  const LOCAL_SUPABASE = 'http://127.0.0.1:54321';
  const LOCAL_API = 'http://localhost:8788';

  it('fills the Supabase and api origins with http://127.0.0.1:<port> and http://localhost:<port>', () => {
    const out = renderHeaders(WITH_API, LOCAL_SUPABASE, undefined, LOCAL_API, 'dev');
    expect(out).toContain(`connect-src 'self' ${LOCAL_SUPABASE} ${LOCAL_API};`);
    const swapped = renderHeaders(WITH_API, LOCAL_API, undefined, LOCAL_SUPABASE, 'dev');
    expect(swapped).toContain(`connect-src 'self' ${LOCAL_API} ${LOCAL_SUPABASE};`);
  });

  it('drops one trailing slash, and accepts the lowest and highest port', () => {
    expect(
      renderHeaders(TEMPLATE, 'http://127.0.0.1:54321/', undefined, undefined, 'dev'),
    ).toContain(`connect-src 'self' ${LOCAL_SUPABASE};`);
    for (const port of ['1', '65535']) {
      expect(
        renderHeaders(TEMPLATE, `http://localhost:${port}`, undefined, undefined, 'dev'),
      ).toContain(`connect-src 'self' http://localhost:${port};`);
    }
  });

  it('still accepts the staging forms in a dev build', () => {
    const out = renderHeaders(
      WITH_API,
      URL_OK,
      undefined,
      'https://trace-api-staging.fixture-sub.workers.dev',
      'dev',
    );
    expect(out).toContain(`${URL_OK} https://trace-api-staging.fixture-sub.workers.dev;`);
  });

  it.each(['production', 'staging', 'Dev', ' dev', 'dev ', '', undefined, null, 1])(
    'refuses a loopback origin unless VITE_TRACE_ENV is exactly dev (%j)',
    (traceEnv) => {
      expect(() => renderHeaders(WITH_API, LOCAL_SUPABASE, undefined, undefined, traceEnv)).toThrow(
        /VITE_SUPABASE_URL must be https:\/\/<20 lowercase letters or digits>\.supabase\.co/,
      );
      expect(() => renderHeaders(WITH_API, undefined, undefined, LOCAL_API, traceEnv)).toThrow(
        /VITE_API_ORIGIN must be https:\/\/trace-api-staging\./,
      );
    },
  );

  it.each([
    ['https', 'https://127.0.0.1:54321'],
    ['no port', 'http://127.0.0.1'],
    ['an empty port', 'http://127.0.0.1:'],
    ['port 0', 'http://127.0.0.1:0'],
    ['a port above 65535', 'http://127.0.0.1:65536'],
    ['a six-digit port', 'http://127.0.0.1:123456'],
    ['a leading-zero port', 'http://127.0.0.1:08788'],
    ['a signed port', 'http://127.0.0.1:+8788'],
    ['a path', 'http://127.0.0.1:54321/rest/v1'],
    ['two trailing slashes', 'http://127.0.0.1:54321//'],
    ['a query', 'http://127.0.0.1:54321?x=1'],
    ['a fragment', 'http://127.0.0.1:54321#x'],
    ['userinfo', 'http://user@127.0.0.1:54321'],
    ['userinfo that looks like the host', 'http://127.0.0.1:54321@evil.example.test'],
    ['another loopback address', 'http://127.0.0.2:54321'],
    ['an IPv6 loopback', 'http://[::1]:54321'],
    ['0.0.0.0', 'http://0.0.0.0:54321'],
    ['a subdomain of localhost', 'http://app.localhost:54321'],
    ['a longer host', 'http://localhost.example.test:54321'],
    ['an upper-case host', 'http://LOCALHOST:54321'],
    ['a private network address', 'http://192.168.1.10:54321'],
    ['a wildcard', 'http://*:54321'],
    ['ws', 'ws://127.0.0.1:54321'],
    ['a space', 'http://127.0.0.1:54321 https://x.example.test'],
    ['a newline', 'http://127.0.0.1:54321\nx'],
  ])('fails a dev build for %s, without echoing the value', (_label, value) => {
    for (const run of [
      () => renderHeaders(WITH_API, value, undefined, undefined, 'dev'),
      () => renderHeaders(WITH_API, undefined, undefined, value, 'dev'),
    ]) {
      expect(run).toThrow(/VITE_(SUPABASE_URL|API_ORIGIN) must be/);
      expect(run).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('127.0.0.1') }),
      );
    }
  });

  it('keeps the Sentry rule: a loopback DSN is refused in a dev build', () => {
    const withSentry = WITH_API.replace(
      `${API_ORIGIN_TOKEN};`,
      `${API_ORIGIN_TOKEN} ${SENTRY_ORIGIN_TOKEN};`,
    );
    const dsn = `http://${'ab12'.repeat(8)}@127.0.0.1:9000/42`;
    expect(() => renderHeaders(withSentry, undefined, dsn, undefined, 'dev')).toThrow(
      /VITE_SENTRY_DSN/,
    );
  });
});

describe('headersTemplatePlugin', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  const run = (env: Record<string, unknown>) => {
    dir = mkdtempSync(path.join(tmpdir(), 'trace-headers-'));
    writeFileSync(path.join(dir, '_headers.template'), TEMPLATE);
    const plugin = headersTemplatePlugin();
    const emitted: { type: string; fileName: string; source: string }[] = [];
    plugin.configResolved({ root: dir, env });
    plugin.generateBundle.call({ emitFile: (f) => emitted.push(f) });
    return emitted;
  };

  it('emits dist/_headers with the origin filled in', () => {
    const [file] = run({ VITE_SUPABASE_URL: URL_OK });
    expect(file).toMatchObject({ type: 'asset', fileName: '_headers' });
    expect(file?.source).toContain(`connect-src 'self' ${URL_OK};`);
  });

  it("emits connect-src 'self' alone when the variable is unset", () => {
    const [file] = run({});
    expect(file?.source).toContain("connect-src 'self'; object-src");
  });

  it('fails the build when the publishable-key variable is not an sb_publishable_ key (B4-SEC-3)', () => {
    const plugin = headersTemplatePlugin();
    const secretShaped = ['sb', 'secret', 'x'.repeat(30)].join('_');
    const jwtShaped = ['eyJhbGciOiJIUzI1NiJ9', 'eyJyb2xlIjoic2VydmljZV9yb2xlIn0', 'sig'].join('.');
    for (const value of [secretShaped, jwtShaped, 'sb_publishable_short']) {
      let message = '';
      try {
        plugin.configResolved({ root: tmpdir(), env: { VITE_SUPABASE_PUBLISHABLE_KEY: value } });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/VITE_SUPABASE_PUBLISHABLE_KEY/);
      expect(message).not.toContain(value);
    }
    const ok = ['sb', 'publishable', 'a'.repeat(30)].join('_');
    expect(() =>
      plugin.configResolved({ root: tmpdir(), env: { VITE_SUPABASE_PUBLISHABLE_KEY: ok } }),
    ).not.toThrow();
  });

  it('reads VITE_TRACE_ENV from the resolved env: dev accepts a loopback Supabase URL, anything else fails in configResolved', () => {
    const local = 'http://127.0.0.1:54321';
    const [file] = run({ VITE_SUPABASE_URL: local, VITE_TRACE_ENV: 'dev' });
    expect(file?.source).toContain(`connect-src 'self' ${local};`);
    const plugin = headersTemplatePlugin();
    for (const env of [{}, { VITE_TRACE_ENV: 'production' }, { VITE_TRACE_ENV: 'staging' }]) {
      expect(() =>
        plugin.configResolved({ root: tmpdir(), env: { VITE_SUPABASE_URL: local, ...env } }),
      ).toThrow(/VITE_SUPABASE_URL/);
    }
    expect(() =>
      plugin.configResolved({
        root: tmpdir(),
        env: { VITE_API_ORIGIN: 'http://localhost:8788', VITE_TRACE_ENV: 'dev' },
      }),
    ).not.toThrow();
    expect(() =>
      plugin.configResolved({
        root: tmpdir(),
        env: { VITE_API_ORIGIN: 'http://localhost:8788', VITE_TRACE_ENV: 'production' },
      }),
    ).toThrow(/VITE_API_ORIGIN/);
  });

  it('fails in configResolved for a bad URL, before anything is built', () => {
    const plugin = headersTemplatePlugin();
    expect(() =>
      plugin.configResolved({
        root: tmpdir(),
        env: { VITE_SUPABASE_URL: 'https://x.example.test' },
      }),
    ).toThrow(/VITE_SUPABASE_URL/);
  });
});
