// A bound parameter is never cast straight to json/jsonb in the api's SQL (static, on the real production sources).
// postgres.js describes a statement first and serialises a parameter the server reports as json/jsonb with
// JSON.stringify, even with `fetch_types: false`: a value the code already JSON-encoded is then encoded twice and
// reaches Postgres as a JSON string (`cannot extract elements from a scalar`). That broke every library reference read
// (templates, presets, browse) on the local stack and staging (M1 BUILD 4, Linux CI run 40344843041). The pattern is
// `$n::text::jsonb`: a text parameter, so no driver re-encodes it (as workers/jobs/src/{integrity,quality}/store.ts).
import { describe, expect, it } from 'vitest';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>;
  }
}

const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true });
const production = Object.entries(sources).filter(
  ([path]) => !/\.test(-helpers)?\.ts$/.test(path) && !path.endsWith('.d.ts'),
);

/** `$3::jsonb`, `$1 :: json` and the like: a parameter cast to json without passing through text. */
const DIRECT_JSON_CAST = /\$\d+\s*::\s*jsonb?\b/;

describe('SQL parameters (postgres.js double JSON encoding)', () => {
  it('scans the api sources', () => {
    expect(production.length).toBeGreaterThan(50);
  });

  it('no production SQL casts a bound parameter straight to json or jsonb', () => {
    const hits = production.flatMap(([path, text]) =>
      text
        .split(/\r?\n/)
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => DIRECT_JSON_CAST.test(line))
        .map(({ i }) => `${path}:${String(i + 1)}`),
    );
    expect(hits).toEqual([]);
  });

  it('the guard catches the broken form and lets the text form through', () => {
    expect(DIRECT_JSON_CAST.test('jsonb_array_elements_text($3::jsonb)')).toBe(true);
    expect(DIRECT_JSON_CAST.test('select $1 :: json')).toBe(true);
    expect(DIRECT_JSON_CAST.test('jsonb_array_elements_text($3::text::jsonb)')).toBe(false);
  });
});
