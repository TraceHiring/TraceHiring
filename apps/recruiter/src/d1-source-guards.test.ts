// Raw-source guards for the D1 recruiter screens: the demo outbox is reachable only through the build flag (so a
// production build can drop it, AT-D18), nothing writes to the console or to browser storage (a media link or an
// invite link must never be logged or kept, rule 8, AT-D10), and api paths carry no decision verb (AT-D13).
import { describe, expect, it } from 'vitest';

const all = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const sources = Object.entries(all).filter(
  ([file]) =>
    !/\.test\.tsx?$/.test(file) &&
    !/\.test-helpers\.tsx?$/.test(file) &&
    !file.startsWith('./auth/testing/'),
);
const inD1 = sources.filter(([file]) => !file.startsWith('./auth/'));

/** The sources (file names) in which `pattern` occurs. */
const where = (pattern: RegExp, from = sources): string[] =>
  from.filter(([, text]) => pattern.test(text)).map(([file]) => file);

describe('demo outbox gating (AT-D18)', () => {
  it('reads the real sources (the guards cannot pass on an empty glob)', () => {
    expect(sources.length).toBeGreaterThan(30);
    expect(sources.map(([file]) => file)).toContain('./outbox/OutboxPage.tsx');
  });

  it('names the outbox path and screen only inside outbox/', () => {
    const hits = where(/demo-outbox/i).filter((file) => !file.startsWith('./outbox/'));
    expect(hits).toEqual([]);
  });

  it('imports the outbox module only from routes.tsx, and routes.tsx gates it on VITE_DEMO_OUTBOX', () => {
    const importers = where(/from\s+'(?:\.\.?\/)+outbox\//).filter(
      (file) => !file.startsWith('./outbox/'),
    );
    expect(importers).toEqual(['./routes.tsx']);
    const routes = all['./routes.tsx'] ?? '';
    expect(routes).toMatch(
      /import\.meta\.env\.VITE_DEMO_OUTBOX\s*===\s*'1'\s*&&\s*import\.meta\.env\.VITE_TRACE_ENV\s*!==\s*'production'\s*\?\s*demoOutboxExtras\s*:\s*null/,
    );
  });

  it('uses the flag and the environment nowhere else', () => {
    expect(where(/VITE_DEMO_OUTBOX/).sort()).toEqual(['./routes.tsx', './vite-env.d.ts']);
    expect(where(/VITE_TRACE_ENV/).sort()).toEqual(['./routes.tsx', './vite-env.d.ts']);
  });
});

describe('no logging, no browser storage (media and invite links)', () => {
  it('writes nothing to the console', () => {
    expect(where(/\bconsole\s*\./)).toEqual([]);
  });

  it('uses no browser storage outside auth/', () => {
    expect(where(/\b(?:localStorage|sessionStorage|indexedDB)\b/, inD1)).toEqual([]);
  });

  it('names the /media/ path only in the api client (the origin and path check)', () => {
    expect(where(/\/media\//).sort()).toEqual(['./api/client.ts']);
  });

  it('puts no URL into an Error or a thrown value', () => {
    expect(where(/throw\s+new\s+Error\([^)]*(?:url|link)/i)).toEqual([]);
  });
});

describe('api paths (AT-D13)', () => {
  it('no path string names a decision verb', () => {
    const verbs = /reject|decision|decide|confirm|overturn|appeal|notice|shortlist/i;
    for (const [file, text] of sources) {
      for (const m of text.matchAll(/path:\s*[`'"]([^`'"]*)[`'"]/g)) {
        expect(m[1] ?? '', file).not.toMatch(verbs);
      }
    }
  });

  it('every api call goes through ApiClient (no raw fetch outside the client and main.tsx)', () => {
    expect(where(/\bfetch\s*\(/).sort()).toEqual(['./main.tsx']);
  });
});
