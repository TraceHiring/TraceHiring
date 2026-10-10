#!/usr/bin/env node
// Secret scan of every build output (spec specs/m0-foundations.md §5 `build`, §7.2 step 2, AT-16 local).
// Runs `gitleaks dir --redact --no-banner` over the dist/ of every app, Worker and service
// (apps/*, workers/*, services/*). Fails (exit 1) when:
//   - gitleaks reports a finding (or fails) for any dist/
//   - no dist/ exists at all (the scan never passes vacuously)
//   - a workspace there has a `build` script but no dist/ (a partial build)
//   - gitleaks is not installed (prints an install hint; never skips)
//   - a dist/ holds, at any depth, a .gitleaksignore, .gitleaks.toml or .gitleaksbaseline (any
//     case), or a file containing gitleaks' inline allow marker: `gitleaks dir` honours an ignore
//     file in the scanned directory and skips marked lines, so either could hide a finding
// The repository's .gitleaks.toml is always passed with --config (a built-in default config when
// it is missing), and GITLEAKS_CONFIG / GITLEAKS_CONFIG_TOML are dropped from gitleaks' environment,
// so a config that a build copies into dist/ can never change the rules.
// Output is redacted; this script prints only paths and gitleaks' own redacted summary.
// No environment variables. Optional argument: the repository root (default: this script's repo).
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKSPACE_DIRS = ['apps', 'workers', 'services'];
export const GITLEAKS_ARGS = ['dir', '--redact', '--no-banner'];
export const INSTALL_HINT =
  'gitleaks is not installed, so the build-output secret scan cannot run. Install gitleaks 8.30.1 (Windows: winget install Gitleaks.Gitleaks; CI: the checksum-verified binary in the shared setup), then build again.';
const DEFAULT_CONFIG =
  '# scan-dist fallback: the repository has no .gitleaks.toml.\n[extend]\nuseDefault = true\n';

/** Colour codes in gitleaks' log lines. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const posix = (p) => p.split(path.sep).join('/');

/**
 * The dist/ directories to scan and the workspaces that should have one.
 * @returns {{ dists: string[], missing: string[] }} repo-relative POSIX paths
 */
export function findDists(root) {
  const dists = [];
  const missing = [];
  for (const top of WORKSPACE_DIRS) {
    const base = path.join(root, top);
    if (!isDir(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const ws = path.join(base, name);
      if (!isDir(ws)) continue;
      const rel = posix(path.join(top, name));
      if (isDir(path.join(ws, 'dist'))) {
        dists.push(`${rel}/dist`);
        continue;
      }
      const pkg = path.join(ws, 'package.json');
      if (!existsSync(pkg)) continue;
      let build = false;
      try {
        build = typeof JSON.parse(readFileSync(pkg, 'utf8'))?.scripts?.build === 'string';
      } catch {
        missing.push(`${rel} (package.json does not parse)`);
        continue;
      }
      if (build) missing.push(rel);
    }
  }
  return { dists, missing };
}

/** File names gitleaks reads to skip findings or change rules (compared case-insensitively). */
export const HIDER_NAMES = ['.gitleaksignore', '.gitleaks.toml', '.gitleaksbaseline'];
/** gitleaks skips any line holding this marker (built here so this file holds no marker). */
const ALLOW_MARKER = ['gitleaks', 'allow'].join(':');

/**
 * Anything in a dist/ that could make gitleaks skip a finding there (S1.4 security review M5):
 * an ignore, config or baseline file at any depth, or a file containing the inline allow marker
 * (in any case). Symlinks are not followed; a symlink with a hider's name still counts.
 * @param {string} root repository root
 * @param {string} rel repo-relative POSIX path of the dist/ directory
 * @returns {string[]} problems
 */
export function findHiders(root, rel) {
  const problems = [];
  const walk = (abs, relPath) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, e.name);
      const childRel = `${relPath}/${e.name}`;
      if (HIDER_NAMES.includes(e.name.toLowerCase())) {
        problems.push(
          `${childRel}: gitleaks ignore/config/baseline file in build output (it could hide findings)`,
        );
        continue;
      }
      if (e.isDirectory()) walk(childAbs, childRel);
      else if (e.isFile()) {
        const text = readFileSync(childAbs).toString('latin1').toLowerCase();
        if (text.includes(ALLOW_MARKER))
          problems.push(
            `${childRel}: contains the inline allow marker, which makes gitleaks skip that line`,
          );
      }
    }
  };
  walk(path.join(root, ...rel.split('/')), rel);
  return problems;
}

/** gitleaks' environment: the caller's, minus anything that could swap its config. */
function gitleaksEnv(env) {
  const out = { ...env };
  for (const k of Object.keys(out)) if (/^GITLEAKS_CONFIG(_TOML)?$/i.test(k)) delete out[k];
  return out;
}

/**
 * Scans every dist/ under `root`.
 * @param {{ root: string, gitleaks?: string, env?: NodeJS.ProcessEnv }} opts
 * @returns {{ ok: boolean, problems: string[], scanned: string[] }}
 */
export function scanDist({ root, gitleaks = 'gitleaks', env = process.env }) {
  const problems = [];
  const { dists, missing } = findDists(root);
  for (const m of missing) problems.push(`${m}: has a build script but no dist/ (build it first)`);
  if (dists.length === 0) {
    problems.push(
      `no dist/ found under ${WORKSPACE_DIRS.join('/, ')}/ (run the builds first; the scan never passes vacuously)`,
    );
    return { ok: false, problems, scanned: [] };
  }
  const rootConfig = path.join(root, '.gitleaks.toml');
  let tmp = null;
  let config = rootConfig;
  if (!existsSync(rootConfig)) {
    tmp = mkdtempSync(path.join(tmpdir(), 'trace-scan-dist-'));
    config = path.join(tmp, 'gitleaks.toml');
    writeFileSync(config, DEFAULT_CONFIG);
  }
  const scanned = [];
  try {
    for (const rel of dists) {
      problems.push(...findHiders(root, rel));
      const r = spawnSync(
        gitleaks,
        [...GITLEAKS_ARGS, '--config', config, path.join(root, ...rel.split('/'))],
        { cwd: root, env: gitleaksEnv(env), encoding: 'utf8' },
      );
      if (r.error) {
        if (r.error.code === 'ENOENT') {
          problems.push(INSTALL_HINT);
          return { ok: false, problems, scanned };
        }
        throw r.error;
      }
      scanned.push(rel);
      if (r.status !== 0) {
        const summary = `${r.stdout ?? ''}${r.stderr ?? ''}`
          .split(/\r?\n/)
          .map((l) => l.replace(ANSI, '').trim())
          .filter(Boolean)
          .slice(-3)
          .join(' | ');
        problems.push(
          `${rel}: gitleaks found a secret or failed (exit ${r.status}): ${summary}. ` +
            `See where with: gitleaks dir --redact --no-banner -v --config .gitleaks.toml ${rel}`,
        );
      }
    }
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
  return { ok: problems.length === 0, problems, scanned };
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
  try {
    const { ok, problems, scanned } = scanDist({ root });
    for (const p of problems) console.error(`scan-dist: ${p}`);
    if (!ok) {
      console.error(`scan-dist: FAILED (spec §5, AT-16)`);
      process.exit(1);
    }
    console.log(`scan-dist: OK, no secrets in ${scanned.length} dist/ (${scanned.join(', ')})`);
  } catch (err) {
    console.error(`scan-dist: ${err.message}`);
    process.exit(1);
  }
}
