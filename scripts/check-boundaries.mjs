#!/usr/bin/env node
// Boundary checks that ESLint cannot express (spec specs/m0-foundations.md §10.2, AT-14).
// Fails (exit 1) if any rule below is violated:
//   1. a credential name in code or wrangler config under apps/, packages/ or workers/edge/
//   2. a tracked (or untracked, not ignored) .dev.vars* or .env* file other than env.example
//   3. an app or bundled package referencing a VITE_* name that looks like a secret
//   4. supabase/config.toml exposing private, quality or integrity through the API
//      (a missing config.toml passes only while supabase/migrations/ is also missing, i.e. before S1.7)
//   5. a text file in the index with CRLF line endings
//   6. an eslint-disable comment that switches off a boundaries/ or trace/ rule, or names no rule
//      (S1.4 security review), in apps/, packages/, workers/ or services/ source
//   7. an error reporter or Sentry name (incl. @trace/shared/sentry) in non-test source of apps/candidate/ or workers/edge/
//      (spec §9.2: only the recruiter app, workers/jobs and services/api report errors; S3a review
//      S3A-3, plan risk 9)
//   8. a Worker's wrangler.jsonc (workers/*/, services/*/) whose top-level `observability` is not exactly
//      WORKERS_OBSERVABILITY, or an env block that overrides it (specs/m0b-tenancy.md §1.1 item 9 (c):
//      Workers Logs on, invocation logs and traces off, query strings redacted)
//   9. supabase/config.toml Auth settings other than REQUIRED_AUTH_CONFIG, or a magic-link template
//      without the {{ .Token }} code (specs/m0b-tenancy.md §4.1; checked only when config.toml exists)
//  10. an @supabase/* import in apps/candidate/, workers/edge/ or packages/shared/ (specs/m0b-tenancy.md §4.3)
//  11. a use of the PACKAGES or ITEM_MEDIA binding in workers/edge/ source other than .get/.head or a type
//      declaration (d1 §4.2; m1 R5-10)
//  12. `eval` or the `Function` constructor anywhere in packages/item-variants/ source (m1 R5-10, §11.2; the
//      parameterised-variant generator evaluates specs as data, never as code)
//  13. a `Mock*` class or `createMock*` / `mock*` factory in packages/vendors/src/ whose constructor (or body) does not
//      call an `assert*Env(` guard, or a file without such a guard that allow-lists ['dev', 'staging'] and throws
//      (as messaging.ts; m1 R5-10, §11.2). VENDOR_MOCK_GUARD_EXEMPTIONS lists the one D1 exception.
// Prints only paths and rule names, never file contents.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

export const CREDENTIAL_NAMES = [
  'service_role',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'sb_secret_',
  'JWT_SECRET',
  'SUPABASE_JWT',
  'postgres://',
  'postgresql://',
  'DB_URL',
  'DATABASE_URL',
  // services/api-only secrets (d1 §4.2): the edge verifies with the public JWK and holds no secret.
  'PRIVATE_JWK',
  'HMAC_KEY',
];

/**
 * The one place a credential name may appear in browser-reachable code: the log redactor must
 * match `sb_secret_…` values to redact them (spec §9.1), which rule 1 would otherwise forbid.
 * Exactly one exact text in exactly one file: the regex-literal form `sb_secret_[\w-]*` (S1.4
 * security review M6). Occurrences of that text are removed before the check, so any other
 * mention there (a key literal, the bare prefix, another case or form) still fails, and every
 * other name is still checked there.
 */
export const CREDENTIAL_PATTERN_EXEMPTIONS = Object.freeze({
  'packages/shared/src/log/redact.ts': Object.freeze([String.raw`sb_secret_[\w-]*`]),
});

/** Directories whose code must never mention a credential (rule 1). workers/jobs and services/api are server-side. */
export const CREDENTIAL_SCOPES = ['apps/', 'packages/', 'workers/edge/'];

/** Words a VITE_* name may not contain (rule 3); VITE_* values are public once bundled. */
export const FORBIDDEN_VITE_WORDS = ['SECRET', 'TOKEN', 'PASSWORD', 'PRIVATE', 'JWT', 'DB', 'KEY'];
/** VITE_SUPABASE_PUBLISHABLE_KEY is the public `sb_publishable_…` key (specs/m0b-tenancy.md §2.7). */
export const ALLOWED_VITE_NAMES = ['VITE_SENTRY_DSN', 'VITE_SUPABASE_PUBLISHABLE_KEY'];

/** Schemas that must never be reachable through PostgREST (rule 4, spec §8.1). */
export const PRIVATE_SCHEMAS = ['private', 'quality', 'integrity'];

/** Workspaces whose source is checked for eslint-disable comments (rule 6). */
export const SOURCE_SCOPES = ['apps/', 'packages/', 'workers/', 'services/'];
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;

/** Workspaces that must never report errors (rule 7): the candidate app and the edge Worker. */
export const NO_REPORTER_SCOPES = ['apps/candidate/', 'workers/edge/'];
// @trace/shared/sentry (the SDK-free adapter, d1 AT-D22) counts too: it has no SDK, but it is a reporter.
const REPORTER_NAMES =
  /\b(?:reportError|noopErrorReporter|ErrorReporter|createSentryReporter)\b|@sentry\/|@trace\/shared\/sentry/;
const isTestFile = (p) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(p);

/** Generated files, the same ones ESLint ignores (packages/config/eslint/index.js). */
function isGenerated(p) {
  return (
    path.posix.basename(p) === 'worker-configuration.d.ts' ||
    /(^|\/)src\/generated\//.test(p) ||
    p === 'packages/db-types/src/database.ts'
  );
}

const isMarkdown = (p) => /\.mdx?$/i.test(p);
const inScope = (p, scopes) => scopes.some((s) => p.startsWith(s));
const violation = (rule, p, message) => ({ rule, path: p, message });

// ---------- rule 1 ----------
/** @param {{path: string, content: string}[]} files repo-relative POSIX paths */
export function checkCredentialNames(files) {
  const out = [];
  for (const { path: p, content } of files) {
    if (!inScope(p, CREDENTIAL_SCOPES) || isMarkdown(p)) continue;
    const exempt = Object.hasOwn(CREDENTIAL_PATTERN_EXEMPTIONS, p)
      ? CREDENTIAL_PATTERN_EXEMPTIONS[p]
      : [];
    // Exempt texts match exactly (case-sensitive) and are cut out; the rest is checked as usual.
    const lower = exempt.reduce((text, form) => text.split(form).join(' '), content).toLowerCase();
    const hits = CREDENTIAL_NAMES.filter((n) => lower.includes(n.toLowerCase()));
    if (hits.length > 0) {
      out.push(
        violation(1, p, `mentions credential name(s) ${hits.join(', ')} (server-only, spec §10.2)`),
      );
    }
  }
  return out;
}

// ---------- rule 2 ----------
/** @param {string[]} paths files git tracks, plus untracked files that are not ignored */
export function checkTrackedEnvFiles(paths) {
  const out = [];
  for (const p of paths) {
    const base = path.posix.basename(p);
    if (base === 'env.example') continue;
    if (base.startsWith('.dev.vars') || base.startsWith('.env')) {
      out.push(violation(2, p, 'env/.dev.vars files must never be committed (only env.example)'));
    }
  }
  return out;
}

// ---------- rule 3 ----------
export function checkViteNames(files) {
  const out = [];
  for (const { path: p, content } of files) {
    if (!inScope(p, ['apps/', 'packages/']) || isMarkdown(p)) continue;
    const bad = new Set();
    for (const m of content.matchAll(/(?<![A-Za-z0-9_$])VITE_[A-Za-z0-9_]+/g)) {
      const name = m[0];
      if (ALLOWED_VITE_NAMES.includes(name)) continue;
      const upper = name.slice('VITE_'.length).toUpperCase();
      if (FORBIDDEN_VITE_WORDS.some((w) => upper.includes(w))) bad.add(name);
    }
    if (bad.size > 0) {
      out.push(
        violation(3, p, `VITE_* names are bundled into the browser: ${[...bad].join(', ')}`),
      );
    }
  }
  return out;
}

// ---------- rule 4 ----------
/** Strips a TOML comment that is outside a string. */
function stripTomlComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

/**
 * Minimal TOML reader for the one question rule 4 asks: which strings do `schemas` and
 * `extra_search_path` in the `api` table hold? Handles [table] headers, dotted keys and
 * multi-line arrays and inline tables; a quoted private schema name anywhere in an api.* value fails.
 */
export function checkSupabaseConfig({ configToml, migrationsDirExists }) {
  const where = 'supabase/config.toml';
  if (configToml == null) {
    return migrationsDirExists
      ? [
          violation(
            4,
            where,
            'supabase/config.toml is missing but supabase/migrations/ exists (allowed only before S1.7)',
          ),
        ]
      : [];
  }
  const out = [];
  for (const { fullKey, value } of readTomlEntries(configToml)) {
    const inApi = fullKey === 'api' || fullKey.startsWith('api.');
    if (!inApi) continue;
    const exposed = PRIVATE_SCHEMAS.filter((s) => new RegExp(`["']\\s*${s}\\s*["']`).test(value));
    if (exposed.length > 0) {
      out.push(
        violation(4, where, `${fullKey} exposes ${exposed.join(', ')} through the API (spec §8.1)`),
      );
    }
  }
  return out;
}

/**
 * Every `key = value` of a TOML text as `{ fullKey, value }` (table path + dotted key, raw value
 * text with comments stripped; a multi-line array is joined onto one line).
 */
export function readTomlEntries(configToml) {
  const entries = [];
  const lines = configToml.split(/\r?\n/).map(stripTomlComment);
  let table = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header) {
      table = header[1].replace(/\s+/g, '').replace(/["']/g, '');
      continue;
    }
    const kv = /^([A-Za-z0-9_.\-"' ]+?)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].replace(/\s+/g, '').replace(/["']/g, '');
    const fullKey = table ? `${table}.${key}` : key;
    let value = kv[2];
    // Join a multi-line array.
    if (value.startsWith('[')) {
      let depth = 0;
      const count = (s) => {
        for (const c of s.replace(/"[^"]*"|'[^']*'/g, '')) {
          if (c === '[') depth++;
          else if (c === ']') depth--;
        }
      };
      count(value);
      while (depth > 0 && i + 1 < lines.length) {
        i++;
        value += ' ' + lines[i].trim();
        count(lines[i]);
      }
    }
    entries.push({ fullKey, value: value.trim() });
  }
  return entries;
}

// ---------- rule 9 ----------
/**
 * Supabase Auth settings M0b requires (specs/m0b-tenancy.md §4.1), as raw TOML values. Staging
 * mirrors them by hand (H8); this pins the local copy against drift.
 */
export const REQUIRED_AUTH_CONFIG = Object.freeze({
  'auth.enable_signup': 'false',
  'auth.enable_anonymous_sign_ins': 'false',
  'auth.minimum_password_length': '12',
  'auth.password_requirements': '"letters_digits"',
  'auth.email.enable_signup': 'true', // the email provider switch on the CLI; sign-ups stay off via auth.enable_signup
  'auth.email.otp_length': '6',
  'auth.email.otp_expiry': '600',
  'auth.email.template.magic_link.content_path': '"./supabase/templates/magic_link.html"',
  'auth.mfa.totp.enroll_enabled': 'true',
  'auth.mfa.totp.verify_enabled': 'true',
});

/** @param {{ configToml: string, magicLinkTemplate: string | null }} input */
export function checkAuthConfig({ configToml, magicLinkTemplate }) {
  const where = 'supabase/config.toml';
  const values = new Map(readTomlEntries(configToml).map((e) => [e.fullKey, e.value]));
  const out = [];
  for (const [key, expected] of Object.entries(REQUIRED_AUTH_CONFIG)) {
    if (values.get(key) !== expected) {
      out.push(violation(9, where, `${key} must be ${expected} (specs/m0b-tenancy.md §4.1)`));
    }
  }
  if (magicLinkTemplate == null || !/\{\{\s*\.Token\s*\}\}/.test(magicLinkTemplate)) {
    out.push(
      violation(
        9,
        'supabase/templates/magic_link.html',
        'the sign-in email must carry the code {{ .Token }} (specs/m0b-tenancy.md §4.1)',
      ),
    );
  }
  return out;
}

// ---------- rule 10 ----------
/** Where @supabase/* may never be imported: candidates never call Supabase (Q6), nor does edge or shared. */
export const SUPABASE_JS_FORBIDDEN_SCOPES = [
  'apps/candidate/',
  'workers/edge/',
  'packages/shared/',
];

export function checkSupabaseJsScope(files) {
  const out = [];
  for (const { path: p, content } of files) {
    if (!inScope(p, SUPABASE_JS_FORBIDDEN_SCOPES) || isMarkdown(p)) continue;
    if (content.includes('@supabase/')) {
      out.push(
        violation(10, p, 'imports @supabase/* outside apps/recruiter (specs/m0b-tenancy.md §4.3)'),
      );
    }
  }
  return out;
}

// ---------- rule 11 ----------
// The edge may only read the published test packages (d1 §4.2: PACKAGES is read only for the edge; an R2 binding is
// always writable at the platform level, so the source is the guard; bindings security review F2) and the item
// images (m1 R5-10: ITEM_MEDIA, served by GET /v1/session/media/:hash). Every use of either name in edge source must
// be a `.get(` / `.head(` call or a type declaration (`PACKAGES: R2Bucket`); a put, delete, list, bracket access,
// alias or destructuring is flagged.
const PACKAGES_SCOPES = ['workers/edge/'];
/** The edge R2 bindings that are read only (get/head), with the source of the rule. */
export const EDGE_READ_ONLY_BUCKETS = Object.freeze(['PACKAGES', 'ITEM_MEDIA']);
const READ_ONLY_WHY = Object.freeze({ PACKAGES: 'd1 §4.2', ITEM_MEDIA: 'm1 R5-10' });
const readOnlyUse = (name) => new RegExp(`\\b${name}\\b`, 'g');
const readOnlyAllowed = (name) => new RegExp(`^${name}(?:\\??\\.(?:get|head)\\s*\\(|\\??\\s*:)`);
export function checkPackagesReadOnly(files) {
  const out = [];
  for (const { path: p, content } of files) {
    if (!inScope(p, PACKAGES_SCOPES) || !SOURCE_EXT.test(p)) continue;
    if (isGenerated(p) || isTestFile(p)) continue;
    for (const name of EDGE_READ_ONLY_BUCKETS) {
      const allowed = readOnlyAllowed(name);
      for (const m of content.matchAll(readOnlyUse(name))) {
        if (!allowed.test(content.slice(m.index))) {
          out.push(
            violation(
              11,
              p,
              `uses ${name} other than get/head (${READ_ONLY_WHY[name]}: read only for the edge)`,
            ),
          );
          break;
        }
      }
    }
  }
  return out;
}

// ---------- rule 12 ----------
// The parameterised-variant generator (packages/item-variants, stream A1) evaluates item specs as data: no string is
// ever run as code (m1 R5-10, §11.2). Any mention of `eval` or of the `Function` constructor in the package's source
// (tests included) is flagged; the package not existing yet passes.
const NO_DYNAMIC_CODE_SCOPES = ['packages/item-variants/'];
const DYNAMIC_CODE = /\beval\b|\bFunction\b/;
export function checkNoDynamicCode(files) {
  const out = [];
  for (const { path: p, content } of files) {
    if (!inScope(p, NO_DYNAMIC_CODE_SCOPES) || !SOURCE_EXT.test(p) || isGenerated(p)) continue;
    if (DYNAMIC_CODE.test(content)) {
      out.push(
        violation(12, p, 'uses eval or the Function constructor (m1 R5-10: specs are data)'),
      );
    }
  }
  return out;
}

// ---------- rule 13 ----------
// Every mock vendor adapter refuses production the way messaging.ts does (L-11; m1 R5-10, §11.2): each `Mock*` class's
// constructor, and each `createMock*` / `mock*` factory, calls an `assert…Env(` guard; the guard is imported, or
// defined in the file where it throws and allow-lists exactly ['dev', 'staging'] (any other value, 'production'
// included, is refused). D1's MockLlmGrader takes no env: its production guard is graderFor in
// workers/jobs/src/queue/wiring.ts (pinned by wiring.test.ts), so it is the one exemption.
const VENDOR_SCOPES = ['packages/vendors/src/'];
export const VENDOR_MOCK_GUARD_EXEMPTIONS = Object.freeze({
  'packages/vendors/src/llm-grader.ts': Object.freeze(['MockLlmGrader']),
});
const MOCK_CLASS = /\bclass\s+(Mock[A-Z]\w*)\b/g;
const MOCK_FUNCTION = /\bfunction\s+((?:createMock|mock)[A-Z]\w*)\s*[<(]/g;
const MOCK_CONST = /\b(?:const|let|var)\s+((?:createMock|mock)[A-Z]\w*)\b[^=;]*=/g;
const GUARD_CALL = /\bassert\w*Env\s*\(/;
const GUARD_IMPORT = /\bimport\s*\{[^}]*\bassert\w*Env\b[^}]*\}\s*from\b/;
const GUARD_DEFINED = /\bfunction\s+assert\w*Env\s*\(|\b(?:const|let)\s+assert\w*Env\b\s*=/g;
const DEV_STAGING_ALLOW_LIST = /\[\s*(['"])dev\1\s*,\s*(['"])staging\2\s*\]/;

/**
 * The index just past the block or statement that starts at `from`: for a `{…}` block (the first `{` at or after
 * `from`, when `block`), or up to the first top-level `;` (a statement). Skips strings, template literals and
 * comments. Returns content.length when it runs out.
 */
function endOf(content, from, block) {
  let depth = 0;
  let started = !block;
  for (let i = from; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];
    if (c === '/' && next === '/') {
      const nl = content.indexOf('\n', i);
      if (nl < 0) return content.length;
      i = nl;
    } else if (c === '/' && next === '*') {
      const end = content.indexOf('*/', i + 2);
      if (end < 0) return content.length;
      i = end + 1;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < content.length && content[j] !== c) j += content[j] === '\\' ? 2 : 1;
      i = j;
    } else if (c === '{' || c === '(' || c === '[') {
      if (c === '{') started = true;
      depth++;
    } else if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (block && started && depth === 0 && c === '}') return i + 1;
      if (!block && depth < 0) return i;
    } else if (!block && c === ';' && depth === 0) {
      return i + 1;
    }
  }
  return content.length;
}

/** The text of the `constructor(...) { … }` of a class body, or null. */
function constructorOf(classBody) {
  const m = /\bconstructor\s*\(/.exec(classBody);
  if (!m) return null;
  return classBody.slice(m.index, endOf(classBody, m.index, true));
}

export function checkVendorMockGuards(files) {
  const out = [];
  for (const { path: p, content } of files) {
    if (!inScope(p, VENDOR_SCOPES) || !SOURCE_EXT.test(p)) continue;
    if (isGenerated(p) || isTestFile(p)) continue;
    const exempt = Object.hasOwn(VENDOR_MOCK_GUARD_EXEMPTIONS, p)
      ? VENDOR_MOCK_GUARD_EXEMPTIONS[p]
      : [];
    const problems = [];
    let mocks = 0;
    for (const m of content.matchAll(MOCK_CLASS)) {
      if (exempt.includes(m[1])) continue;
      mocks++;
      const body = content.slice(m.index, endOf(content, m.index, true));
      const ctor = constructorOf(body);
      if (ctor === null || !GUARD_CALL.test(ctor)) {
        problems.push(`${m[1]}'s constructor does not call an assert…Env guard`);
      }
    }
    for (const re of [MOCK_FUNCTION, MOCK_CONST]) {
      for (const m of content.matchAll(re)) {
        mocks++;
        const body = content.slice(m.index, endOf(content, m.index, re === MOCK_FUNCTION));
        if (!GUARD_CALL.test(body)) problems.push(`${m[1]} does not call an assert…Env guard`);
      }
    }
    if (mocks > 0 && !GUARD_IMPORT.test(content)) {
      const defined = [...content.matchAll(GUARD_DEFINED)].map((g) =>
        content.slice(g.index, endOf(content, g.index, g[0].startsWith('function'))),
      );
      if (defined.length === 0) problems.push('no assert…Env guard is defined or imported');
      else if (!defined.some((text) => /\bthrow\b/.test(text))) {
        problems.push('the assert…Env guard never throws');
      } else if (!DEV_STAGING_ALLOW_LIST.test(content)) {
        problems.push("the guard does not allow-list exactly ['dev', 'staging']");
      }
    }
    if (problems.length > 0) {
      out.push(
        violation(13, p, `a mock vendor must refuse production: ${problems.join('; ')} (L-11)`),
      );
    }
  }
  return out;
}

// ---------- rule 5 ----------
/** @param {string} eolOutput output of `git ls-files --eol -z` */
export function checkCrlf(eolOutput) {
  const out = [];
  for (const entry of eolOutput.split('\0')) {
    if (entry === '') continue;
    const tab = entry.indexOf('\t');
    if (tab < 0) continue;
    const info = entry.slice(0, tab).trim().split(/\s+/);
    const p = entry.slice(tab + 1);
    const index = info.find((x) => x.startsWith('i/'));
    if (index === 'i/crlf' || index === 'i/mixed') {
      out.push(violation(5, p, `has CRLF line endings in the index (${index})`));
    }
  }
  return out;
}

// ---------- rule 6 ----------
const PROTECTED_RULE = /^@?(?:boundaries|trace)\//;

export function checkEslintDisables(files) {
  const out = [];
  for (const { path: p, content } of files) {
    if (!inScope(p, SOURCE_SCOPES) || !SOURCE_EXT.test(p) || isGenerated(p)) continue;
    const problems = [];
    for (const m of content.matchAll(/\/\*([\s\S]*?)\*\/|\/\/([^\n]*)/g)) {
      const body = (m[1] ?? m[2]).trim();
      const isBlock = m[1] !== undefined;
      const directive = /^eslint-disable(?:-next-line|-line)?(?=\s|$)/.exec(body);
      if (directive) {
        const rules = body
          .slice(directive[0].length)
          .split(/\s--\s|\s--$/)[0]
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean);
        if (rules.length === 0) problems.push(`bare "${directive[0]}" (name the rule)`);
        else {
          const hit = rules.filter((r) => PROTECTED_RULE.test(r));
          if (hit.length > 0) problems.push(`"${directive[0]}" switches off ${hit.join(', ')}`);
        }
        continue;
      }
      if (isBlock && /^eslint\s/.test(body) && /(^|[\s,])@?(?:boundaries|trace)\//.test(body)) {
        problems.push(
          'an inline "eslint" config comment reconfigures a boundaries/ or trace/ rule',
        );
      }
    }
    if (problems.length > 0) out.push(violation(6, p, problems.join('; ')));
  }
  return out;
}

// ---------- rule 7 ----------
/** @param {{path: string, content: string}[]} files repo-relative POSIX paths */
export function checkNoErrorReporter(files) {
  const out = [];
  for (const { path: p, content } of files) {
    if (!inScope(p, NO_REPORTER_SCOPES) || !SOURCE_EXT.test(p)) continue;
    if (isGenerated(p) || isTestFile(p)) continue;
    if (REPORTER_NAMES.test(content)) {
      out.push(violation(7, p, 'names an error reporter or Sentry (spec §9.2: not here)'));
    }
  }
  return out;
}

// ---------- rule 8 ----------
/**
 * Workers Logs settings every Worker must deploy with (specs/m0b-tenancy.md §1.1 item 9 (c), DC-7:
 * keys checked against wrangler 4.149.0's config-schema.json). Only the redacting logger's lines
 * are stored: no invocation logs (request URL, headers, client IP), no traces.
 */
export const WORKERS_OBSERVABILITY = Object.freeze({
  enabled: true,
  head_sampling_rate: 1,
  redact_query_string: true,
  logs: Object.freeze({ invocation_logs: false }),
  traces: Object.freeze({ enabled: false }),
});
const WORKER_WRANGLER = /^(?:workers|services)\/[^/]+\/wrangler\.jsonc$/;

/**
 * Parses JSONC as wrangler reads it: line and block comments and trailing commas are allowed.
 * Comment markers inside strings are kept. Throws on anything JSON.parse rejects afterwards.
 * @param {string} text
 */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated block comment');
      i = end + 2;
    } else {
      out += c;
      i++;
    }
  }
  // Trailing commas: a comma followed only by whitespace before } or ] (strings are intact here, so
  // drop them outside strings only).
  let clean = '';
  for (let k = 0; k < out.length; k++) {
    const c = out[k];
    if (c === '"') {
      let j = k + 1;
      while (j < out.length && out[j] !== '"') j += out[j] === '\\' ? 2 : 1;
      clean += out.slice(k, j + 1);
      k = j;
    } else if (c === ',' && /^\s*[}\]]/.test(out.slice(k + 1))) {
      continue;
    } else {
      clean += c;
    }
  }
  return JSON.parse(clean);
}

/** @param {{path: string, content: string}[]} files repo-relative POSIX paths */
export function checkWorkersObservability(files) {
  const out = [];
  for (const { path: p, content } of files) {
    if (!WORKER_WRANGLER.test(p)) continue;
    let config;
    try {
      config = parseJsonc(content);
    } catch {
      out.push(
        violation(8, p, 'cannot be parsed as JSONC, so its Workers Logs settings are unknown'),
      );
      continue;
    }
    const problems = [];
    if (!isDeepStrictEqual(config?.observability, WORKERS_OBSERVABILITY)) {
      problems.push('observability is not exactly the M0b Workers Logs block (spec §1.1 9c)');
    }
    for (const [name, env] of Object.entries(config?.env ?? {})) {
      if (env !== null && typeof env === 'object' && 'observability' in env) {
        problems.push(`env.${name} overrides observability`);
      }
    }
    if (problems.length > 0) out.push(violation(8, p, problems.join('; ')));
  }
  return out;
}

// ---------- repo walk ----------
function gitOut(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.error?.message ?? r.stderr.trim()}`);
  }
  return r.stdout;
}

function readText(abs) {
  try {
    if (!statSync(abs).isFile()) return null;
    const buf = readFileSync(abs);
    if (buf.includes(0)) return null; // binary
    return buf.toString('utf8');
  } catch {
    return null; // deleted in the working tree
  }
}

/** Runs every rule against the repository at `root`. Returns a list of violations. */
export function runChecks(root) {
  const listed = gitOut(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean);
  const paths = [...new Set(listed)];
  const files = [];
  for (const p of paths) {
    const needsContent =
      (inScope(p, CREDENTIAL_SCOPES) || inScope(p, SOURCE_SCOPES)) && !isMarkdown(p);
    if (!needsContent) continue;
    const content = readText(path.join(root, ...p.split('/')));
    if (content != null) files.push({ path: p, content });
  }
  const configPath = path.join(root, 'supabase', 'config.toml');
  return [
    ...checkCredentialNames(files),
    ...checkTrackedEnvFiles(paths),
    ...checkViteNames(files),
    ...checkSupabaseConfig({
      configToml: existsSync(configPath) ? readFileSync(configPath, 'utf8') : null,
      migrationsDirExists: existsSync(path.join(root, 'supabase', 'migrations')),
    }),
    ...checkCrlf(gitOut(root, ['ls-files', '--eol', '-z'])),
    ...checkEslintDisables(files),
    ...checkNoErrorReporter(files),
    ...checkWorkersObservability(files),
    ...(existsSync(configPath)
      ? checkAuthConfig({
          configToml: readFileSync(configPath, 'utf8'),
          magicLinkTemplate: readText(path.join(root, 'supabase', 'templates', 'magic_link.html')),
        })
      : []),
    ...checkSupabaseJsScope(files),
    ...checkPackagesReadOnly(files),
    ...checkNoDynamicCode(files),
    ...checkVendorMockGuards(files),
  ];
}

function isMain() {
  if (!process.argv[1]) return false;
  const a = path.resolve(process.argv[1]);
  const b = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isMain()) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let violations;
  try {
    violations = runChecks(root);
  } catch (err) {
    console.error(`check-boundaries: ${err.message}`);
    process.exit(1);
  }
  if (violations.length > 0) {
    for (const v of violations)
      console.error(`check-boundaries: rule ${v.rule}: ${v.path}: ${v.message}`);
    console.error(`check-boundaries: ${violations.length} violation(s) (spec §10.2)`);
    process.exit(1);
  }
  if (!existsSync(path.join(root, 'supabase', 'config.toml'))) {
    console.log(
      'check-boundaries: no supabase/ yet, so rule 4 has nothing to check (allowed before S1.7)',
    );
  }
  console.log('check-boundaries: OK');
}
