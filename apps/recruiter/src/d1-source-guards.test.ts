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
      /import\.meta\.env\.VITE_DEMO_OUTBOX\s*===\s*'1'\s*&&\s*\(\s*import\.meta\.env\.VITE_TRACE_ENV\s*===\s*'dev'\s*\|\|\s*import\.meta\.env\.VITE_TRACE_ENV\s*===\s*'staging'\s*\)\s*\?\s*demoOutboxExtras\s*:\s*null/,
    );
  });

  it('uses the flag and the environment nowhere else', () => {
    expect(where(/VITE_DEMO_OUTBOX/).sort()).toEqual(['./routes.tsx', './vite-env.d.ts']);
    expect(where(/VITE_TRACE_ENV/).sort()).toEqual([
      './main.tsx',
      './routes.tsx',
      './vite-env.d.ts',
    ]);
  });

  // M1 AT-M1-27 (B2-SEC-1, security review AUTH-1): main.tsx hands the build environment to the auth
  // config readers, so plain http to the local stack works only in a dev build, for Supabase and the api.
  it('main.tsx passes the build environment to the Supabase and api origin readers', () => {
    const main = all['./main.tsx'] ?? '';
    expect(main).toContain('traceEnv: import.meta.env.VITE_TRACE_ENV');
    expect(main).toMatch(/createRecruiterSupabase\(\s*\{[^}]*\btraceEnv\b[^}]*\}/);
    expect(main).toMatch(
      /readApiOrigin\(\s*\{[^}]*VITE_API_ORIGIN:\s*import\.meta\.env\.VITE_API_ORIGIN[^}]*\btraceEnv\b/,
    );
    expect(main).not.toContain('VITE_API_ORIGIN?.trim()');
  });
});

// R4 re-review note 1: a bare `import.meta.env` is replaced by an object holding every VITE_* key of the build, so
// passing it on would name VITE_DEMO_OUTBOX in a flagged build's entry chunk. Only member reads are allowed; Vite
// inlines each value and nothing else reaches the bundle.
describe('no whole-environment object (AT-D18 hardening)', () => {
  const BARE_ENV = /import\s*\.\s*meta\s*\.\s*env(?!\s*\.\s*[A-Za-z_$])/;
  const inApp = sources.filter(([file]) => file !== './vite-env.d.ts');

  it('uses import.meta.env only as import.meta.env.<NAME>', () => {
    expect(where(BARE_ENV, inApp)).toEqual([]);
  });

  it('the pattern catches the whole-object forms and lets member reads through', () => {
    for (const bad of [
      'f(import.meta.env)',
      'const e = import.meta.env;',
      'import.meta.env[name]',
      'const { MODE } = import.meta.env',
      'import.meta.env ?? {}',
    ]) {
      expect(BARE_ENV.test(bad), bad).toBe(true);
    }
    for (const good of [
      'import.meta.env.VITE_API_ORIGIN?.trim()',
      "import.meta.env.VITE_DEMO_OUTBOX === '1'",
    ]) {
      expect(BARE_ENV.test(good), good).toBe(false);
    }
  });

  it('main.tsx reads the fields its callees need, each as a member read', () => {
    const main = all['./main.tsx'] ?? '';
    for (const name of [
      'VITE_SENTRY_DSN',
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      'VITE_API_ORIGIN',
    ]) {
      expect(main).toContain(`import.meta.env.${name}`);
    }
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
