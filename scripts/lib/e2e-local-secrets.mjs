// The local-only values scripts/e2e-local.mjs hands the three Workers (specs/d1-demo-slice.md §4.2 bindings, §4.3
// candidate-token keys, §7.2 "Local stack"; spec review r3a #1). Everything is generated at run time for one run of
// the local stack, never written into the repository and never printed: the login-role passwords, the ES256 key pair
// and the media-link HMAC key. Pure functions; the caller runs the SQL, writes the files and removes them.
// No function puts a value into an error message.

/** The operator-created login roles and the one trace_* role each may SET (spec §3, L-29, MT-14). */
export const LOGIN_ROLES = Object.freeze([
  Object.freeze({ login: 'api_login', role: 'trace_api' }),
  Object.freeze({ login: 'jobs_mirror_login', role: 'trace_worker' }),
  Object.freeze({ login: 'jobs_quality_login', role: 'trace_quality_worker' }),
  Object.freeze({ login: 'jobs_integrity_login', role: 'trace_integrity_worker' }),
  // M1 R5-11 (specs/m1-test-authoring.md DC-M1-6): the AI drafting job and the member provisioning job. Their
  // NOLOGIN roles come from migration M1-a; the logins are generated here, never by a migration.
  Object.freeze({ login: 'jobs_authoring_login', role: 'trace_authoring_worker' }),
  Object.freeze({ login: 'jobs_admin_login', role: 'trace_admin_worker' }),
  // M2 R5-9 (specs/m2-scheduling-invites.md): the messaging worker (cron claim stage and trace-messages consumer).
  // Its NOLOGIN role comes from migration M2-a.
  Object.freeze({ login: 'jobs_messaging_login', role: 'trace_messaging_worker' }),
]);

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** Hex only, so a password can sit inside the SQL text (DDL takes no bind parameter, as the jobs db-test harness). */
const PASSWORD = /^[0-9a-f]{32,128}$/;
/** A login-role password as both operator steps generate it: 32-128 lower-case hex characters (shared with ops). */
export const isLoginPassword = (pw) => typeof pw === 'string' && PASSWORD.test(pw);
const KID = /^d1-\d{4}-(?:0[1-9]|1[0-2])$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * The SQL that (re)creates the six login roles with the given passwords, run as `postgres` on the local stack
 * (roles are cluster-global and survive `db reset`, so an earlier run's roles are dropped first). The text goes to
 * psql on stdin, never on a command line. Throws (naming the login only) on a password that is not plain hex.
 */
export function loginRolesSql(passwords) {
  const lines = ['begin;'];
  for (const { login, role } of LOGIN_ROLES) {
    const pw = passwords?.[login];
    if (!isLoginPassword(pw)) {
      throw new Error(
        `e2e-local: the generated password for ${login} is not 32-128 hex characters`,
      );
    }
    lines.push(
      `drop role if exists ${login};`,
      `create role ${login} login noinherit password '${pw}';`,
      `grant ${role} to ${login} with inherit false, set true;`,
    );
  }
  lines.push('commit;', '');
  return lines.join('\n');
}

/** The SQL that removes the six login roles again at the end of a run. */
export function dropLoginRolesSql() {
  return [
    'begin;',
    ...LOGIN_ROLES.map(({ login }) => `drop role if exists ${login};`),
    'commit;',
    '',
  ].join('\n');
}

/**
 * The connection URL of a login role on the local stack: the stack's own URL (`supabase status` DB_URL) with the
 * user and password swapped. No query parameter is added: the Workers take a URL secret only on a loopback host with no
 * query (localDbUrlAllowed, ADR-031 amendment 1) and connect over plain TCP.
 */
export function loginUrl(stackDbUrl, login, password) {
  let u;
  try {
    u = new URL(stackDbUrl);
  } catch {
    throw new Error('e2e-local: the local stack database URL cannot be parsed');
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    throw new Error('e2e-local: the local stack database URL is not a postgres URL');
  }
  if (!LOCAL_HOSTS.has(u.hostname.toLowerCase())) {
    throw new Error('e2e-local: the stack database URL is not local');
  }
  u.username = encodeURIComponent(login);
  u.password = encodeURIComponent(password);
  u.search = '';
  u.hash = '';
  return u.toString();
}

/** The candidate-token key id for a time: `d1-YYYY-MM` in UTC (spec §4.3). */
export const kidFor = (ms) => {
  const d = new Date(ms);
  return `d1-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * A fresh ES256 (P-256) key pair as the api and edge parse it (services/api candidate/token.ts, workers/edge
 * token.ts): `privateJwk` for CANDIDATE_TOKEN_PRIVATE_JWK and `publicJwkList`, the one JSON-array shape of
 * CANDIDATE_TOKEN_PUBLIC_JWK (the signing key first). Same member set as scripts/ops/candidate-token-key.mjs, kept
 * in memory only.
 */
export async function candidateTokenKeys(subtle, kid) {
  if (!KID.test(String(kid)))
    throw new Error('e2e-local: the candidate-token kid must be d1-YYYY-MM');
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const priv = await subtle.exportKey('jwk', pair.privateKey);
  const pub = { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, kid, alg: 'ES256', use: 'sig' };
  return {
    kid,
    privateJwk: JSON.stringify({ ...pub, d: priv.d }),
    publicJwkList: JSON.stringify([pub]),
  };
}

/**
 * The values per Worker (spec §4.2 bindings table; each Worker's Env): api gets its database login, the signing key,
 * the verify list, the media-link key and the local Supabase URL and publishable key; edge gets only the public key
 * list (it holds no secret and no database credential); jobs gets its five logins (the three D1 stages, then the
 * M1 drafting and member provisioning jobs, R5-11).
 */
export function workerSecrets({ stack, passwords, keys, hmacKey }) {
  if (typeof hmacKey !== 'string' || hmacKey.length < 32) {
    throw new Error('e2e-local: MEDIA_LINK_HMAC_KEY must be at least 32 characters');
  }
  const url = (login) => loginUrl(stack.dbUrl, login, passwords[login]);
  return {
    api: {
      API_DB_URL: url('api_login'),
      CANDIDATE_TOKEN_PRIVATE_JWK: keys.privateJwk,
      CANDIDATE_TOKEN_KID: keys.kid,
      CANDIDATE_TOKEN_PUBLIC_JWK: keys.publicJwkList,
      MEDIA_LINK_HMAC_KEY: hmacKey,
      SUPABASE_URL: stack.apiUrl,
      SUPABASE_PUBLISHABLE_KEY: stack.publishableKey,
    },
    edge: { CANDIDATE_TOKEN_PUBLIC_JWK: keys.publicJwkList },
    jobs: {
      JOBS_MIRROR_DB_URL: url('jobs_mirror_login'),
      JOBS_QUALITY_DB_URL: url('jobs_quality_login'),
      JOBS_INTEGRITY_DB_URL: url('jobs_integrity_login'),
      JOBS_AUTHORING_DB_URL: url('jobs_authoring_login'),
      JOBS_ADMIN_DB_URL: url('jobs_admin_login'),
      JOBS_MESSAGING_DB_URL: url('jobs_messaging_login'),
    },
  };
}

/**
 * The text of a wrangler `--env-file` / `.dev.vars` file: one `NAME='value'` line each. Single quotes keep dotenv
 * from reading escapes; a value with a quote, `$` (dotenv-expand), a line break or nothing at all is refused, so
 * wrangler reads back exactly the generated value. The error names the variable only.
 */
export function dotenvText(vars) {
  return Object.entries(vars)
    .map(([name, value]) => {
      if (!ENV_NAME.test(name)) throw new Error('e2e-local: an env-file name is not UPPER_SNAKE');
      if (typeof value !== 'string' || value === '' || /['$\r\n\\]/.test(value)) {
        throw new Error(`e2e-local: the value of ${name} cannot be written to an env file`);
      }
      return `${name}='${value}'\n`;
    })
    .join('');
}

const JOBS_MAIN = /"main"\s*:\s*"src\/index\.ts"/g;

/**
 * workers/jobs/wrangler.jsonc with `main` made absolute, for a copy inside the run's state folder. The jobs Worker
 * runs as the second config of the edge session, and wrangler 4 hands `--env-file` and `--var` only to a session's
 * first Worker; the second reads `.dev.vars` next to its config. The copy lets that file live in the temporary
 * folder instead of the repository. Throws if `main` is not exactly the one known entry.
 */
export function jobsDevConfig(text, mainAbsolute) {
  const hits = String(text).match(JOBS_MAIN) ?? [];
  if (hits.length !== 1) {
    throw new Error('e2e-local: workers/jobs/wrangler.jsonc must name "main": "src/index.ts" once');
  }
  const main = String(mainAbsolute).split('\\').join('/');
  return String(text).replace(JOBS_MAIN, `"main": ${JSON.stringify(main)}`);
}
