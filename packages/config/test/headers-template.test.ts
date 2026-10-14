// Vite plugin that writes dist/_headers from an app's _headers.template, filling connect-src with the
// Supabase origin of VITE_SUPABASE_URL or dropping the token when it is unset (specs/m0b-tenancy.md §2.7).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
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
