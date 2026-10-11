#!/usr/bin/env node
// verify:fast — the Stop-hook check (spec specs/m0-foundations.md §5 "verify:fast algorithm").
//  1. base = `git merge-base HEAD main`; if that fails, everything counts as changed (no remote
//     fallback: a remote-tracking ref may be stale).
//  2. changed = `git diff --name-only <base>` (working tree vs base) + untracked, non-ignored files.
//  3. Any global file → typecheck, lint and test for the whole repo.
//  4. Docs only → Prettier on those files only.
//  5. Otherwise → typecheck, lint and test for the changed packages and their dependents
//     (`pnpm --filter "...<pkg>"`), then Prettier on the changed files.
//  6. No Docker, no build, no network. Exits non-zero on any failure; prints the last 60 lines.
// The decision logic is the pure planVerifyFast(); computePlan() adds git and the workspace map.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { isEntryPoint } from './lib/cli.mjs';
import { changedFiles, mergeBase, repoTop } from './lib/git.mjs';
import { dependentsClosure, loadWorkspaces, packageForFile } from './lib/workspace.mjs';

export const GLOBAL_ROOT_FILES = Object.freeze([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'eslint.config.js',
  '.prettierrc.json',
]);
export const GLOBAL_DIRS = Object.freeze(['packages/config/', 'scripts/']);
/**
 * Files outside a workspace that a workspace builds from: a change selects that workspace (and its
 * dependents) instead of counting as docs. `@trace/ui` generates its token files from
 * docs/design/tokens.json (spec §11); S2 review follow-up 2.
 */
export const PACKAGE_INPUTS = Object.freeze({ 'docs/design/tokens.json': 'packages/ui' });
export const TAIL_LINES = 60;
const BASE_REF = 'main';
const PRETTIER_ARGS = ['--check', '--ignore-unknown'];

/** docs/**, specs/** and any Markdown file. */
export function isDocsPath(file) {
  return file.startsWith('docs/') || file.startsWith('specs/') || /\.md$/i.test(file);
}

/**
 * `{ kind: 'global' }`, `{ kind: 'docs' }` or `{ kind: 'package', pkg }` for one repo-relative path.
 * Order matters: the global list wins (so packages/config/README.md is global), then PACKAGE_INPUTS,
 * then docs, then the owning workspace; a path outside every workspace that is not docs is global.
 */
export function classifyFile(file, workspaces) {
  if (GLOBAL_ROOT_FILES.includes(file)) return { kind: 'global' };
  if (GLOBAL_DIRS.some((d) => file.startsWith(d))) return { kind: 'global' };
  if (Object.hasOwn(PACKAGE_INPUTS, file)) {
    const owner = workspaces.find((w) => w.dir === PACKAGE_INPUTS[file]);
    return owner ? { kind: 'package', pkg: owner.name } : { kind: 'global' };
  }
  if (isDocsPath(file)) return { kind: 'docs' };
  const pkg = packageForFile(workspaces, file);
  return pkg ? { kind: 'package', pkg: pkg.name } : { kind: 'global' };
}

const FULL_STEPS = ['typecheck', 'lint', 'test'].map((s) => ({
  label: s,
  tool: 'pnpm',
  args: [s],
}));

function listSome(items, max = 5) {
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}

/**
 * Pure decision: what verify:fast runs.
 * @param {{ base: string | null, changed: string[], workspaces: {dir: string, name: string, deps: string[]}[],
 *           isPresent?: (file: string) => boolean }} input  `isPresent` filters deleted files out of
 *   Prettier's arguments; a deleted file still selects its package.
 */
export function planVerifyFast({ base, changed, workspaces, isPresent = () => true }) {
  const allNames = workspaces.map((w) => w.name).sort();
  const full = (reason) => ({
    mode: 'full',
    reason,
    packages: [],
    affected: allNames,
    steps: FULL_STEPS.map((s) => ({ ...s, args: [...s.args] })),
  });
  if (base === null) {
    return full('no merge-base between HEAD and main (missing local main?): running everything');
  }
  const files = [...new Set(changed)].sort();
  if (files.length === 0) {
    return {
      mode: 'none',
      reason: 'nothing changed since the base',
      packages: [],
      affected: [],
      steps: [],
    };
  }
  const classified = files.map((f) => ({ file: f, ...classifyFile(f, workspaces) }));
  const globals = classified.filter((c) => c.kind === 'global').map((c) => c.file);
  if (globals.length > 0) return full(`global file changed: ${listSome(globals)}`);

  const present = files.filter(isPresent);
  const prettier = present.length
    ? [{ label: 'prettier', tool: 'prettier', args: [...PRETTIER_ARGS, ...present] }]
    : [];
  const packages = [
    ...new Set(classified.filter((c) => c.kind === 'package').map((c) => c.pkg)),
  ].sort();
  if (packages.length === 0) {
    return {
      mode: 'docs',
      reason: 'docs-only change: Prettier on the changed files only',
      packages: [],
      affected: [],
      steps: prettier,
    };
  }
  const filter = packages.flatMap((p) => ['--filter', `...${p}`]);
  return {
    mode: 'packages',
    reason: `changed packages: ${packages.join(', ')}`,
    packages,
    affected: dependentsClosure(workspaces, packages),
    steps: [
      ...['typecheck', 'lint', 'test'].map((s) => ({
        label: s,
        tool: 'pnpm',
        args: [...filter, '--if-present', 'run', s],
      })),
      ...prettier,
    ],
  };
}

/** Base, changed files and plan for the repository at `root`. */
export function computePlan(root, { baseRef = BASE_REF } = {}) {
  const base = mergeBase(root, 'HEAD', baseRef);
  const workspaces = loadWorkspaces(root);
  const changed = base ? changedFiles(root, base) : [];
  const plan = planVerifyFast({
    base,
    changed,
    workspaces,
    isPresent: (f) => existsSync(join(root, f)),
  });
  return { base, changed, plan };
}

/**
 * A command line for a shell (Windows needs one to run pnpm.cmd). Only plain arguments are
 * allowed, so nothing can be reinterpreted by cmd.exe or sh; file paths never go through a shell.
 */
export function shellCommandLine(cmd, args) {
  for (const a of [cmd, ...args]) {
    if (!/^[\w@./:=+-]+$/.test(a))
      throw new Error(`unsafe argument for a shell command line: ${a}`);
  }
  return [cmd, ...args].join(' ');
}

/** The last `n` lines of `text` (a trailing newline does not count as a line). */
export function tailLines(text, n) {
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
  return lines.slice(-n).join('\n');
}

function prettierBin() {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('prettier/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prettier;
  return join(dirname(pkgPath), bin);
}

/** Splits files into batches that keep a Windows command line well under its 32 767-char limit. */
function batches(files, maxChars = 8000) {
  const out = [];
  let cur = [];
  let len = 0;
  for (const f of files) {
    if (cur.length && len + f.length + 3 > maxChars) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(f);
    len += f.length + 3;
  }
  if (cur.length) out.push(cur);
  return out;
}

function runProcess(command, args, { cwd, shell }, log) {
  return new Promise((done) => {
    const child = spawn(command, args, {
      cwd,
      shell,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (d) => log.push(d.toString()));
    child.stderr.on('data', (d) => log.push(d.toString()));
    child.on('error', (err) => {
      log.push(`\nfailed to start ${command}: ${err.message}\n`);
      done(127);
    });
    child.on('close', (code) => done(code ?? 1));
  });
}

async function runStep(step, root, log) {
  if (step.tool === 'prettier') {
    const [flags, files] = [
      step.args.slice(0, PRETTIER_ARGS.length),
      step.args.slice(PRETTIER_ARGS.length),
    ];
    const bin = prettierBin();
    for (const batch of batches(files)) {
      const code = await runProcess(
        process.execPath,
        [bin, ...flags, ...batch],
        { cwd: root, shell: false },
        log,
      );
      if (code !== 0) return code;
    }
    return 0;
  }
  if (process.platform === 'win32') {
    return runProcess(shellCommandLine('pnpm', step.args), [], { cwd: root, shell: true }, log);
  }
  return runProcess('pnpm', step.args, { cwd: root, shell: false }, log);
}

function describeStep(step) {
  if (step.tool === 'prettier') {
    const n = step.args.length - PRETTIER_ARGS.length;
    return `prettier ${PRETTIER_ARGS.join(' ')} <${n} changed file${n === 1 ? '' : 's'}>`;
  }
  return `pnpm ${step.args.join(' ')}`;
}

async function main() {
  const started = Date.now();
  const root = repoTop(process.cwd());
  if (!root) {
    process.stderr.write(
      'verify:fast: not inside a git repository; run it from the Trace checkout.\n',
    );
    return 2;
  }
  const log = [];
  const say = (line) => log.push(`${line}\n`);
  let result;
  try {
    result = computePlan(root);
  } catch (err) {
    process.stderr.write(`verify:fast: could not work out what changed: ${err.message}\n`);
    return 1;
  }
  const { base, changed, plan } = result;
  say(`verify:fast: base ${base ?? '(none)'}; ${changed.length} changed file(s)`);
  say(`verify:fast: mode ${plan.mode} (${plan.reason})`);
  if (plan.mode === 'packages') say(`verify:fast: with dependents: ${plan.affected.join(', ')}`);

  let failed = null;
  for (const step of plan.steps) {
    say(`\n$ ${describeStep(step)}`);
    const code = await runStep(step, root, log);
    if (code !== 0) {
      failed = { step, code };
      break;
    }
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (failed) {
    say(`\nverify:fast: FAILED at ${failed.step.label} (exit ${failed.code}) after ${secs}s`);
  } else if (plan.steps.length === 0) {
    say(`\nverify:fast: passed, nothing to check (${plan.reason}) in ${secs}s`);
  } else {
    say(`\nverify:fast: passed (${plan.steps.map((s) => s.label).join(', ')}) in ${secs}s`);
  }
  process.stdout.write(`${tailLines(log.join(''), TAIL_LINES)}\n`);
  return failed ? 1 : 0;
}

if (isEntryPoint(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`verify:fast: ${err.stack ?? err}\n`);
      process.exit(1);
    },
  );
}
