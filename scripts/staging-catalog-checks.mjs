#!/usr/bin/env node
// Catalog checks against staging (spec specs/m0-foundations.md §7.2 step 4, §8.5, AT-18).
//   node scripts/staging-catalog-checks.mjs          runs every check; needs SUPABASE_STAGING_DB_URL
//   node scripts/staging-catalog-checks.mjs --list   prints the plan; never connects
// Every supabase/catalog-checks/MT-*.sql runs through its own `psql -X -v ON_ERROR_STOP=1 -q -At`,
// with the check sent on stdin inside `begin; set transaction read only; … rollback;`. `-q` keeps
// psql from printing the BEGIN/SET/ROLLBACK command tags, so the only possible output is a
// violation row or an error. The positive-control fixtures (fixtures/) never run here.
// Fails (exit 1) when:
//   - the catalog does not validate (gen-catalog-tests' loadCatalog: manifest shape, one file per
//     manifest ID, nothing unlisted, README rule 1: one statement, so no ";" can end the read-only
//     transaction early), a check holds a psql meta-command (it would run on the runner), or the
//     number of MT-*.sql files differs from manifest.json (also re-asserted after the run)
//   - the connection string is missing (outside --list)
//   - any psql prints any line (stdout or stderr), exits non-zero, is killed or cannot start
// The connection string comes only from env SUPABASE_STAGING_DB_URL. It is passed to psql with -d,
// removed from psql's environment, and redacted (whole URL, password raw and decoded, any other
// postgres URL) from everything this script prints.
// Optional argument after the flags: the repository root (default: this script's repo).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_DIR, lexSql, loadCatalog } from './gen-catalog-tests.mjs';
import { isEntryPoint } from './lib/cli.mjs';

export const DB_URL_ENV = 'SUPABASE_STAGING_DB_URL';
/** §7.2 step 4 flags, plus -q so command tags never count as output. */
export const PSQL_ARGS = Object.freeze(['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-At']);
/** Per-check limit; a hung connection fails the deploy instead of holding it. */
export const PSQL_TIMEOUT_MS = 120_000;
/** Output lines shown per failing check (the rest are counted). */
const MAX_LINES_SHOWN = 20;

/** The check wrapped in a read-only transaction that always rolls back. */
export const wrapCheck = (sql) => `begin;\nset transaction read only;\n${sql}\n;\nrollback;\n`;

/**
 * The run plan for `root`.
 * @returns {{ plan: { id: string, file: string, input: string }[], problems: string[],
 *             manifestCount: number }}
 */
export function planChecks(root) {
  const { catalog, checks, problems } = loadCatalog(root);
  const manifestCount = checks ? checks.length : 0;
  const dir = path.join(root, ...CATALOG_DIR.split('/'));
  const onDisk = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter(
        (d) => d.isFile() && /^MT-.*\.sql$/.test(d.name),
      ).length
    : 0;
  if (checks && onDisk !== manifestCount) {
    problems.push(
      `${CATALOG_DIR}: ${onDisk} MT-*.sql file(s) but manifest.json lists ${manifestCount} (§7.2 step 4)`,
    );
  }
  const plan = [];
  for (const c of catalog ?? []) {
    const file = `${CATALOG_DIR}/${c.id}.sql`;
    if (lexSql(c.sql).metaCommand) {
      problems.push(`${file}: has a psql meta-command (a backslash outside quotes)`);
      continue;
    }
    plan.push({ id: c.id, file, input: wrapCheck(c.sql) });
  }
  return { plan: problems.length === 0 ? plan : [], problems, manifestCount };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A function that removes the connection string and its password from text. */
export function redactor(dbUrl) {
  const secrets = new Set();
  const url = (dbUrl ?? '').trim();
  if (url !== '') {
    secrets.add(url);
    const m = /^[a-z]+:\/\/[^:/@]*:([^@]*)@/i.exec(url);
    if (m && m[1].length > 0) {
      secrets.add(m[1]);
      try {
        secrets.add(decodeURIComponent(m[1]));
      } catch {
        // Not valid percent-encoding: the raw form is already listed.
      }
    }
  }
  const parts = [...secrets].sort((a, b) => b.length - a.length).map(escapeRe);
  const exact = parts.length > 0 ? new RegExp(parts.join('|'), 'g') : null;
  return (text) => {
    let s = String(text ?? '');
    if (exact) s = s.replace(exact, '[REDACTED]');
    return s.replace(/postgres(?:ql)?:\/\/\S+/gi, '[REDACTED]');
  };
}

const lines = (text) => (text ?? '').split(/\r?\n/).filter((l) => l.trim() !== '');

/**
 * Runs the plan. `run({ id, args, input })` returns a spawnSync-shaped result.
 * @returns {{ violations: string[], report: string[] }}
 */
export function runCatalogChecks({ root, dbUrl, run }) {
  const redact = redactor(dbUrl);
  const { plan, problems, manifestCount } = planChecks(root);
  if (problems.length > 0) return { violations: problems.map(redact), report: [] };
  const violations = [];
  const report = [];
  let ran = 0;
  for (const { id, input } of plan) {
    let result;
    try {
      result = run({ id, args: [...PSQL_ARGS, '-d', dbUrl], input });
    } catch (error) {
      result = { status: null, signal: null, stdout: '', stderr: '', error };
    }
    ran++;
    if (result.error || result.status !== 0) {
      const why = result.error
        ? result.error.message
        : result.status === null
          ? `signal ${result.signal ?? 'unknown'}`
          : `exit ${result.status}`;
      const detail = lines(result.stderr).slice(0, 3).join(' / ');
      violations.push(redact(`${id}: psql failed (${why})${detail ? `: ${detail}` : ''}`));
      continue;
    }
    const output = [...lines(result.stdout), ...lines(result.stderr)];
    if (output.length > 0) {
      violations.push(redact(`${id}: ${output.length} output line(s) (violations):`));
      for (const l of output.slice(0, MAX_LINES_SHOWN)) violations.push(redact(`  ${l}`));
      if (output.length > MAX_LINES_SHOWN)
        violations.push(`  … ${output.length - MAX_LINES_SHOWN} more`);
      continue;
    }
    report.push(`${id}: clean`);
  }
  if (ran !== manifestCount) {
    violations.push(`${ran} check(s) run but manifest.json lists ${manifestCount} (§7.2 step 4)`);
  } else if (violations.length === 0) {
    report.push(`${ran} check(s) run, ${manifestCount} in manifest.json, all clean`);
  }
  return { violations, report };
}

/** The real runner: psql on PATH, no shell, the check on stdin. */
export function psqlRunner({ spawn = spawnSync, env = process.env } = {}) {
  const childEnv = { ...env, PGCONNECT_TIMEOUT: '15' };
  delete childEnv[DB_URL_ENV];
  return ({ args, input }) =>
    spawn('psql', args, {
      input,
      encoding: 'utf8',
      shell: false,
      env: childEnv,
      timeout: PSQL_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
}

/** CLI body; returns the exit code. */
export function main({ argv, env, root, run, out = console.log, err = console.error }) {
  const tag = 'staging-catalog-checks';
  const list = argv.includes('--list');
  const unknown = argv.filter((a) => a !== '--list');
  if (unknown.length > 0) {
    err(`${tag}: unknown argument(s) ${unknown.join(' ')} (usage: [--list])`);
    return 1;
  }
  if (list) {
    const { plan, problems, manifestCount } = planChecks(root);
    for (const p of problems) err(`${tag}: ${p}`);
    if (problems.length > 0) return 1;
    out(
      `${tag}: ${plan.length} check(s), manifest.json lists ${manifestCount}; no connection made`,
    );
    for (const p of plan) {
      out(
        `${tag}: ${p.id}: psql ${PSQL_ARGS.join(' ')} -d "$${DB_URL_ENV}" < begin; set transaction read only; ${p.file}; rollback;`,
      );
    }
    return 0;
  }
  const dbUrl = (env[DB_URL_ENV] ?? '').trim();
  if (dbUrl === '') {
    err(`${tag}: ${DB_URL_ENV} is not set (the deploy-staging catalog step sets it)`);
    return 1;
  }
  const { violations, report } = runCatalogChecks({ root, dbUrl, run });
  for (const line of report) out(`${tag}: ${line}`);
  for (const line of violations) err(`${tag}: ${line}`);
  if (violations.length > 0) return 1;
  out(`${tag}: OK`);
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const positional = args.filter((a) => !a.startsWith('--'));
  const root = positional[0]
    ? path.resolve(positional[0])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(main({ argv: flags, env: process.env, root, run: psqlRunner() }));
}
