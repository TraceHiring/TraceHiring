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
// Prints only paths and rule names, never file contents.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
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
export const ALLOWED_VITE_NAMES = ['VITE_SENTRY_DSN'];

/** Schemas that must never be reachable through PostgREST (rule 4, spec §8.1). */
export const PRIVATE_SCHEMAS = ['private', 'quality', 'integrity'];

/** Workspaces whose source is checked for eslint-disable comments (rule 6). */
export const SOURCE_SCOPES = ['apps/', 'packages/', 'workers/', 'services/'];
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;

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
