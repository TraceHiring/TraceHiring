// Vite plugin that writes dist/_headers from an app's _headers.template, filling connect-src with the
// Supabase origin of VITE_SUPABASE_URL or dropping the token when it is unset (specs/m0b-tenancy.md §2.7).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
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
