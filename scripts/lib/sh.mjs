// Finds a POSIX `sh` for tests and scripts that run sh code (backup.sh, lefthook commands).
// Looks on PATH first; on Windows falls back to Git for Windows' usr/bin, located from
// `git --exec-path`. Returns null when there is none, so callers can fail loudly (never skip).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Pure lookup, for tests: every input is passed in. */
export function findShIn({ platform, pathEnv, exists, gitExecPath }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const exe = platform === 'win32' ? 'sh.exe' : 'sh';
  const sep = platform === 'win32' ? ';' : ':';
  for (const dir of (pathEnv ?? '').split(sep)) {
    if (!dir) continue;
    const candidate = p.join(dir, exe);
    if (exists(candidate)) return candidate;
  }
  if (platform === 'win32' && gitExecPath) {
    // <git>/mingw64/libexec/git-core → <git>/usr/bin/sh.exe
    const candidate = p.join(gitExecPath, '..', '..', '..', 'usr', 'bin', 'sh.exe');
    if (exists(candidate)) return candidate;
  }
  return null;
}

function gitExecPath() {
  const res = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : null;
}

/** The path of `sh` on this machine, or null. */
export function findSh() {
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH');
  return findShIn({
    platform: process.platform,
    pathEnv: pathKey ? process.env[pathKey] : '',
    exists: existsSync,
    gitExecPath: process.platform === 'win32' ? gitExecPath() : null,
  });
}
