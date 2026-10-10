#!/usr/bin/env node
// Clean-clone check (spec specs/m0-foundations.md §13 AT-1a-local and AT-1b, §12).
//   node scripts/verify-clean-clone.mjs           AT-1b: host clone, pnpm i --frozen-lockfile, pnpm verify
//   node scripts/verify-clean-clone.mjs --linux   AT-1a-local: the same in a digest-pinned node container
// The clone goes in a temp folder next to the main checkout, so the run also uses a path with spaces.
// The planning is pure and unit-tested in scripts/test/lib-clean-clone.test.mjs.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  USAGE,
  cloneParentDir,
  cloneSteps,
  containerScript,
  dockerRunArgs,
  hostSteps,
  linuxHostSteps,
  mainBranchStep,
  parseArgs,
  pnpmVersionFrom,
} from './lib/clean-clone.mjs';
import { isEntryPoint } from './lib/cli.mjs';
import { commonDir, git, gitOut, refExists, repoTop } from './lib/git.mjs';
import { shellCommandLine } from './verify-fast.mjs';

function log(msg) {
  process.stdout.write(`clean clone: ${msg}\n`);
}

/** Runs one step with inherited output; throws on failure. pnpm needs a shell on Windows. */
function run(step, cwd) {
  const useShell = step.cmd === 'pnpm' && process.platform === 'win32';
  const shown = `${step.cmd} ${step.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
  log(`$ ${shown.length > 300 ? `${shown.slice(0, 300)}...` : shown}`);
  const res = useShell
    ? spawnSync(shellCommandLine(step.cmd, step.args), { cwd, stdio: 'inherit', shell: true })
    : spawnSync(step.cmd, step.args, { cwd, stdio: 'inherit' });
  if (res.error) throw new Error(`could not start ${step.cmd}: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`${step.cmd} ${step.args[0]} exited ${res.status}`);
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const source = repoTop(process.cwd());
  if (!source) throw new Error('not inside a git repository');
  const headSha = gitOut(source, ['rev-parse', 'HEAD']);
  if (gitOut(source, ['status', '--porcelain']) !== '') {
    log('WARNING: the working tree has uncommitted changes; only committed HEAD is checked.');
  }
  const parent = cloneParentDir(commonDir(source));
  const dir = mkdtempSync(join(parent, 'trace-clean-clone-'));
  log(`cloning ${headSha} into ${dir}`);
  let ok = false;
  try {
    for (const step of cloneSteps({ source, dir, headSha })) run(step, source);
    const branch = mainBranchStep({
      dir,
      sourceHasMain: refExists(source, 'refs/heads/main'),
      cloneHasMain: git(dir, ['show-ref', '--verify', '--quiet', 'refs/heads/main']).code === 0,
    });
    if (branch) run(branch, dir);

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (opts.linux) {
      const script = containerScript({ headSha, pnpmVersion: pnpmVersionFrom(pkg) });
      run({ cmd: 'docker', args: dockerRunArgs({ cloneDir: dir, script }) }, dir);
      const after = linuxHostSteps(pkg.scripts);
      if (after.length === 0) log('no test:rls script yet; nothing else runs on the host.');
      for (const step of after) run(step, dir);
      log('PASSED (linux container, plus host test:rls when present)');
    } else {
      for (const step of hostSteps()) run(step, dir);
      log('PASSED (host: pnpm install --frozen-lockfile && pnpm verify)');
    }
    ok = true;
    return 0;
  } finally {
    if (ok && !opts.keep) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      log(`removed ${dir}`);
    } else {
      log(`kept ${dir}${ok ? '' : ' for inspection (the run failed)'}`);
    }
  }
}

if (isEntryPoint(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`clean clone: FAILED: ${err.message}\n`);
    process.exitCode = 1;
  }
}
