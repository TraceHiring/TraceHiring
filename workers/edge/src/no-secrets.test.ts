// AT-D31, edge part (specs/d1-demo-slice.md §4.2, §9, L-10, L-11; CLAUDE.md "service-role keys never in Durable Objects
// that serve candidates"): the edge holds no secret and names no database credential, never reads TRACE_ENV or
// process.env, imports no database client, and only reads PACKAGES (`get`/`head`). The wrangler blocks are pinned by
// scripts/check-boundaries.mjs (rules 1 and 11) and scripts/test/wrangler-bindings.test.mjs; this file checks the
// Worker's own source and its runtime env. Every scan has a synthetic case first, so an empty or broken scan fails.
// check-boundaries rule 1 scans this file too, so the credential names below are built at run time from fragments.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

declare global {
  interface ImportMeta {
    glob(
      patterns: string[],
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>;
  }
}

type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;

/** No Env key looks like a secret, a database credential or the server-only environment name (L-10, L-11). */
type SecretShapedKey = Extract<
  keyof Env,
  | `${string}SECRET${string}`
  | `${string}PRIVATE${string}`
  | `${string}PASSWORD${string}`
  | `${string}TOKEN_KEY${string}`
  | `${string}_KEY`
  | `${string}DATABASE${string}`
  | `${string}DB_${string}`
  | `${string}SERVICE${string}ROLE${string}`
  | `${string}HMAC${string}`
  | `${string}SUPABASE${string}`
  | `${string}DSN${string}`
  | 'TRACE_ENV'
>;
export type EnvHasNoSecretShapedKey = Assert<IsNever<SecretShapedKey>>;

const join = (...parts: string[]) => parts.join('');

/** The credential names of scripts/check-boundaries.mjs rule 1, built at run time. */
const CREDENTIAL_NAMES = [
  join('service', '_role'),
  join('SUPABASE_SERVICE', '_ROLE_KEY'),
  join('SUPABASE_SECRET', '_KEY'),
  join('sb_sec', 'ret_'),
  join('JWT', '_SECRET'),
  join('SUPABASE', '_JWT'),
  join('postgres', '://'),
  join('postgresql', '://'),
  join('DB', '_URL'),
  join('DATABASE', '_URL'),
  join('PRIVATE', '_JWK'),
  join('HMAC', '_KEY'),
];

/** Server-only names the edge must never read (L-11: no TRACE_ENV on the edge; no process.env, compat flag). */
const SERVER_ONLY = [
  /\bTRACE_ENV\b/,
  /\bprocess\s*\.\s*env\b/,
  /\bprocess\s*\[\s*['"]env['"]\s*\]/,
];

/** Database or Supabase clients: the edge reaches Postgres only through api's CandidateRpc (§4.2). */
const DB_CLIENT_IMPORT =
  /\bfrom\s+['"](?:postgres|pg|@supabase\/[^'"]*|@neondatabase\/[^'"]*)['"]|\bimport\s*\(\s*['"](?:postgres|pg|@supabase\/)/;

/** The same rule as check-boundaries rule 11: every PACKAGES use is `.get(`, `.head(` or a type declaration. */
const PACKAGES_USE = /\bPACKAGES\b/g;
const PACKAGES_ALLOWED = /^PACKAGES(?:\??\.(?:get|head)\s*\(|\??\s*:)/;

type Finding = { path: string; problem: string };

const scan = (sources: Record<string, string>): Finding[] => {
  const out: Finding[] = [];
  for (const [path, text] of Object.entries(sources)) {
    const lower = text.toLowerCase();
    for (const name of CREDENTIAL_NAMES) {
      if (lower.includes(name.toLowerCase())) out.push({ path, problem: 'credential name' });
    }
    for (const re of SERVER_ONLY)
      if (re.test(text)) out.push({ path, problem: 'server-only name' });
    if (DB_CLIENT_IMPORT.test(text)) out.push({ path, problem: 'database client import' });
    for (const m of text.matchAll(PACKAGES_USE)) {
      if (!PACKAGES_ALLOWED.test(text.slice(m.index))) {
        out.push({ path, problem: 'PACKAGES write or alias' });
        break;
      }
    }
  }
  return out;
};

const allSources = import.meta.glob(['./**/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const production: Record<string, string> = Object.fromEntries(
  Object.entries(allSources).filter(
    ([path]) => !/\.test(?:-helpers)?\.ts$/.test(path) && !path.endsWith('.d.ts'),
  ),
);

describe('the edge holds no secret (AT-D31, edge part)', () => {
  it('finds every kind of violation in synthetic sources, so the scan can fail', () => {
    const synthetic: Record<string, string> = {
      './clean.ts': 'export const read = (b: R2Bucket) => b.head("k");',
      './cred-lower.ts': `const k = env.${join('supabase_service', '_role_key')};`,
      './cred-url.ts': `const u = '${join('postgres', '://')}u@h/db';`,
      './jwk.ts': `const j = env.CANDIDATE_TOKEN_${join('PRIVATE', '_JWK')};`,
      './trace-env.ts': 'if (env.TRACE_ENV === "dev") {}',
      './process.ts': 'const v = process.env.VERSION;',
      './process-bracket.ts': "const v = process['env'];",
      './pg.ts': "import postgres from 'postgres';",
      // Built at run time: check-boundaries rule 10 scans this file for the import text itself.
      './supabase.ts': `import { createClient } from '${join('@supa', 'base/supabase-js')}';`,
      './put.ts': 'await env.PACKAGES.put("k", body);',
      './delete.ts': 'await env.PACKAGES.delete("k");',
      './list.ts': 'await env.PACKAGES.list();',
      './alias.ts': 'const p = env.PACKAGES; await p.put("k", b);',
      './destructure.ts': 'const { PACKAGES } = env;',
      './bracket.ts': 'await env.PACKAGES["put"]("k", b);',
    };
    const found = scan(synthetic);
    const paths = [...new Set(found.map((f) => f.path))].sort();
    expect(paths).toEqual(
      Object.keys(synthetic)
        .filter((p) => p !== './clean.ts')
        .sort(),
    );
    expect(
      scan({
        './ok.ts': 'await env.PACKAGES.get(k); await env.PACKAGES?.head(k); PACKAGES: R2Bucket;',
      }),
    ).toEqual([]);
  });

  it('scans the real production sources (not tests), and none of them breaks a rule', () => {
    // Guards the glob: an empty scan, or one that includes test files, would pass for the wrong reason.
    expect(Object.keys(production)).toEqual(
      expect.arrayContaining([
        './app.ts',
        './index.ts',
        './token.ts',
        './otp-do.ts',
        './routes-photo.ts',
      ]),
    );
    expect(Object.keys(production).some((p) => p.includes('.test'))).toBe(false);

    expect(scan(production)).toEqual([]);
  });

  it('the token verifier is given only the public key var', () => {
    // The edge verifies with the public JWK (§4.3); it has no signing key to read.
    const token = production['./token.ts'] ?? '';
    expect(token).toContain('CANDIDATE_TOKEN_PUBLIC_JWK');
    expect(/env\s*\.\s*CANDIDATE_TOKEN_(?!PUBLIC_JWK\b)\w+/.test(token)).toBe(false);
  });

  it('the test runtime env holds no secret-shaped binding and no TRACE_ENV', () => {
    const names = Object.keys(env).filter((n) => !n.startsWith('__VITEST_POOL_WORKERS_'));
    expect(names).not.toContain('TRACE_ENV');
    const lowerNames = names.map((n) => n.toLowerCase());
    for (const cred of CREDENTIAL_NAMES) {
      expect(lowerNames.some((n) => n.includes(cred.toLowerCase()))).toBe(false);
    }
    expect(names.filter((n) => /SECRET|PRIVATE|PASSWORD|DATABASE/.test(n))).toEqual([]);
  });
});
