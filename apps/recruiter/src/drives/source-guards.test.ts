// Raw-source guards for the M2 drive screens (specs/m2-scheduling-invites.md M2-7, R5-20, R5-59; CLAUDE.md "no PII in
// logs"): the invite file is CSV only, so the XLSX/zip reader is never reached from here; nothing from the file goes to
// the console, browser storage or the address bar; no row is sent anywhere but through the api client.
import { describe, expect, it } from 'vitest';

const all = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const sources = Object.entries(all).filter(
  ([file]) => !/\.test\.tsx?$/.test(file) && !/\.test-helpers\.tsx?$/.test(file),
);
const where = (pattern: RegExp, from = sources): string[] =>
  from.filter(([, text]) => pattern.test(text)).map(([file]) => file);

describe('the M2 drive sources', () => {
  it('reads the real sources (the guards cannot pass on an empty glob)', () => {
    expect(sources.length).toBeGreaterThan(15);
    expect(sources.map(([file]) => file)).toContain('./upload/UploadRoute.tsx');
  });

  it('never reach the XLSX or zip reader (CSV only, R5-20)', () => {
    expect(
      where(/from\s+'[^']*(?:fflate|bank\/import|zip-core|xlsx|import\.worker)[^']*'/i),
    ).toEqual([]);
  });

  it('write nothing to the console or to browser storage', () => {
    expect(where(/\bconsole\s*\./)).toEqual([]);
    expect(where(/\b(?:localStorage|sessionStorage|indexedDB)\b/)).toEqual([]);
  });

  it('put nothing from the upload into the address bar, a cookie or a beacon', () => {
    const upload = sources.filter(([file]) => file.startsWith('./upload/'));
    expect(upload.length).toBeGreaterThan(5);
    expect(
      where(
        /\b(?:location|history)\s*\.|URLSearchParams|document\s*\.\s*cookie|sendBeacon/,
        upload,
      ),
    ).toEqual([]);
  });

  it('send requests only through the api client (no raw network call)', () => {
    expect(where(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/)).toEqual([]);
  });

  it('keep no list of people: the screens hold rows only for the length of an upload', () => {
    // The parsed rows are in a ref and in the run object, never in a module-level variable.
    expect(where(/^(?:export\s+)?(?:let|var)\s/m)).toEqual([]);
  });
});
