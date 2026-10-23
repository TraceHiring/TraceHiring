#!/usr/bin/env node
// Browser security headers in each app's build output (spec specs/m0-foundations.md §10.3, AT-22-local).
// Reads apps/<app>/dist/_headers (Cloudflare Pages format: copied from public/_headers by Vite, or for
// the recruiter written from _headers.template by @trace/config/vite/headers, m0b §2.7) for
// every app in APPS and fails (exit 1) unless:
//   - the file exists (run the app builds first) and parses: URL lines unindented, header lines
//     indented as `Name: value`, `! Name` detaches; no line over Cloudflare's 2,000-character limit
//   - the `/*` rule sets each managed header exactly once, with the §10.3 value:
//       Content-Security-Policy  the §10.3 directives exactly; connect-src is 'self' plus only the
//                                app's allowed origins (CONNECT_SRC_EXTRAS), at most one per entry
//       Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy  (both apps)
//       Permissions-Policy       per app
//   - no other rule sets or detaches a managed header (Pages would merge or drop it for some paths)
// No environment variables. Optional argument: the repository root (default: this script's repo).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APPS = ['candidate', 'recruiter'];

/** The §10.3 CSP for both apps. connect-src gets per-app extras (below). */
export const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  'object-src': ["'none'"],
};

/**
 * Directives one app adds to CSP_DIRECTIVES, with exact sources. recruiter: the item import Web Worker (ADR-033 §4,
 * specs/m1-test-authoring.md R5-48) is a same-origin module bundled by Vite; no blob: worker, no unsafe-eval.
 */
export const APP_CSP_DIRECTIVES = {
  candidate: {},
  recruiter: { 'worker-src': ["'self'"] },
};

/**
 * Origins an app may add to connect-src (§10.3): exact https origins only, never a wildcard.
 * candidate: the staging edge Worker. recruiter: the Supabase staging project (M0b) and, from D1, the
 * staging api Worker (d1 §7.1) and the Sentry ingest host (d1 AT-D22, L-24). Each entry is one regular
 * expression, and a CSP may hold at most one origin per entry (see checkCsp).
 */
export const CONNECT_SRC_EXTRAS = {
  candidate: [/^https:\/\/trace-edge-staging\.[a-z0-9-]+\.workers\.dev$/],
  recruiter: [
    /^https:\/\/[a-z0-9]{20}\.supabase\.co$/,
    // The staging api Worker (d1 §7.1): the recruiter's API calls and the start-photo fetch. Staging only: the
    // production api is a tracehiring.tech custom domain and needs its own entry (and a spec change).
    /^https:\/\/trace-api-staging\.[a-z0-9-]+\.workers\.dev$/,
    // The Sentry ingest origin of VITE_SENTRY_DSN (d1 AT-D22, L-24); EU (H6) or US host.
    /^https:\/\/o[0-9]+\.ingest(?:\.[a-z]{2})?\.sentry\.io$/,
  ],
};

export const COMMON_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export const PERMISSIONS_POLICY = {
  candidate: 'camera=(self), microphone=(self), geolocation=()',
  recruiter: 'camera=(), microphone=(), geolocation=()',
};

const CSP = 'content-security-policy';
const PP = 'permissions-policy';
export const MANAGED = [CSP, ...Object.keys(COMMON_HEADERS), PP];
export const MAX_LINE = 2000;

/**
 * Parses a Cloudflare Pages `_headers` file.
 * @returns {{ rules: { pattern: string, line: number, headers: { name: string, value: string, line: number }[], detach: { name: string, line: number }[] }[], errors: string[] }}
 */
export function parseHeadersFile(text) {
  const rules = [];
  const errors = [];
  text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .forEach((raw, idx) => {
      const line = idx + 1;
      if (raw.length > MAX_LINE) errors.push(`line ${line}: longer than ${MAX_LINE} characters`);
      const t = raw.trim();
      if (t === '' || t.startsWith('#')) return;
      if (!/^\s/.test(raw)) {
        rules.push({ pattern: t, line, headers: [], detach: [] });
        return;
      }
      const rule = rules.at(-1);
      if (!rule) {
        errors.push(`line ${line}: header line before any URL pattern`);
        return;
      }
      if (t.startsWith('!')) {
        rule.detach.push({ name: t.slice(1).trim().toLowerCase(), line });
        return;
      }
      const colon = t.indexOf(':');
      if (colon <= 0) {
        errors.push(`line ${line}: expected "Name: value"`);
        return;
      }
      rule.headers.push({
        name: t.slice(0, colon).trim().toLowerCase(),
        value: t.slice(colon + 1).trim(),
        line,
      });
    });
  return { rules, errors };
}

/** Splits a CSP into { directive: sources[] }; duplicate directives are reported. */
export function parseCsp(value) {
  const directives = {};
  const duplicates = [];
  for (const part of value.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const name = tokens[0].toLowerCase();
    if (Object.hasOwn(directives, name)) duplicates.push(name);
    else directives[name] = tokens.slice(1);
  }
  return { directives, duplicates };
}

const sameSet = (a, b) =>
  a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ');
const norm = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Checks one CSP value for `app`. Returns violation messages. */
export function checkCsp(app, value) {
  const out = [];
  const { directives, duplicates } = parseCsp(value);
  for (const d of duplicates) out.push(`CSP directive ${d} appears more than once`);
  const wanted = { ...CSP_DIRECTIVES, ...(APP_CSP_DIRECTIVES[app] ?? {}) };
  for (const [name, expected] of Object.entries(wanted)) {
    const got = directives[name];
    if (!got) {
      out.push(`CSP is missing ${name}`);
      continue;
    }
    if (name === 'connect-src') {
      if (!got.includes("'self'")) out.push("CSP connect-src must include 'self'");
      const allowed = CONNECT_SRC_EXTRAS[app] ?? [];
      for (const src of got) {
        if (src === "'self'") continue;
        if (!allowed.some((re) => re.test(src)))
          out.push(`CSP connect-src source ${src} is not on the ${app} allow-list (§10.3)`);
      }
      if (new Set(got).size !== got.length) out.push('CSP connect-src repeats a source');
      for (const re of allowed) {
        if (got.filter((src) => re.test(src)).length > 1)
          out.push(`CSP connect-src allows at most one connect-src origin matching ${re} (§10.3)`);
      }
    } else if (!sameSet(got, expected)) {
      out.push(`CSP ${name} must be exactly "${expected.join(' ')}" (found "${got.join(' ')}")`);
    }
  }
  for (const name of Object.keys(directives)) {
    if (!Object.hasOwn(wanted, name)) out.push(`CSP has an unexpected directive ${name}`);
  }
  return out;
}

/** Splits a Permissions-Policy into sorted `feature=allowlist` entries. */
const ppEntries = (s) =>
  s
    .split(',')
    .map((x) => x.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .sort();

/** Checks one app's `_headers` text. Returns violation messages (no file contents beyond header names). */
export function checkHeadersFile(app, text) {
  const out = [];
  const { rules, errors } = parseHeadersFile(text);
  out.push(...errors);
  for (const rule of rules) {
    for (const d of rule.detach) {
      if (MANAGED.includes(d.name))
        out.push(`line ${d.line}: rule ${rule.pattern} detaches ${d.name}, a required header`);
    }
    if (rule.pattern === '/*') continue;
    for (const h of rule.headers) {
      if (MANAGED.includes(h.name))
        out.push(
          `line ${h.line}: rule ${rule.pattern} sets ${h.name}; set it only on /* (Pages merges duplicates)`,
        );
    }
  }
  const all = rules.filter((r) => r.pattern === '/*');
  if (all.length !== 1) {
    out.push(`expected exactly one /* rule (found ${all.length})`);
    if (all.length === 0) return out;
  }
  const headers = all.flatMap((r) => r.headers);
  const get = (name) => {
    const hs = headers.filter((h) => h.name === name);
    if (hs.length === 0) out.push(`/* is missing ${name}`);
    if (hs.length > 1) out.push(`/* sets ${name} ${hs.length} times`);
    return hs.length === 1 ? hs[0].value : null;
  };
  const csp = get(CSP);
  if (csp !== null) out.push(...checkCsp(app, csp));
  for (const [name, expected] of Object.entries(COMMON_HEADERS)) {
    const value = get(name);
    if (value !== null && norm(value) !== norm(expected))
      out.push(`${name} must be "${expected}" (found "${value}")`);
  }
  const pp = get(PP);
  const expectedPp = PERMISSIONS_POLICY[app];
  if (pp !== null && expectedPp && ppEntries(pp).join(',') !== ppEntries(expectedPp).join(','))
    out.push(`${PP} must be "${expectedPp}" (found "${pp}")`);
  return out;
}

/** Checks every app's dist/_headers under `root`. Returns `{ app, file, message }[]`. */
export function runChecks(root, apps = APPS) {
  const out = [];
  for (const app of apps) {
    const file = `apps/${app}/dist/_headers`;
    const abs = path.join(root, 'apps', app, 'dist', '_headers');
    if (!existsSync(abs)) {
      out.push({
        app,
        file,
        message: 'missing (build the app first; public/_headers must be copied)',
      });
      continue;
    }
    for (const message of checkHeadersFile(app, readFileSync(abs, 'utf8')))
      out.push({ app, file, message });
  }
  return out;
}

function isMain() {
  if (!process.argv[1]) return false;
  const a = path.resolve(process.argv[1]);
  const b = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isMain()) {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const violations = runChecks(root);
  for (const x of violations) console.error(`check-headers: ${x.file}: ${x.message}`);
  if (violations.length > 0) {
    console.error(`check-headers: ${violations.length} violation(s) (spec §10.3)`);
    process.exit(1);
  }
  console.log(`check-headers: OK (${APPS.join(', ')})`);
}
