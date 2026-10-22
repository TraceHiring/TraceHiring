// Unit tests for scripts/lib/sh.mjs: finding `sh` on PATH, else Git for Windows' usr/bin (AT-24, AT-6).
import { describe, expect, it } from 'vitest';
import { findSh, findShIn } from '../lib/sh.mjs';

const exists = (set) => (p) => set.has(p.replace(/\\/g, '/'));

describe('findShIn()', () => {
  it('uses sh from PATH on POSIX', () => {
    const sh = findShIn({
      platform: 'linux',
      pathEnv: '/usr/local/bin:/bin',
      exists: exists(new Set(['/bin/sh'])),
      gitExecPath: null,
    });
    expect(sh).toBe('/bin/sh');
  });

  it('uses sh.exe from PATH on Windows', () => {
    const sh = findShIn({
      platform: 'win32',
      pathEnv: 'C:/Windows;C:/Program Files/Git/usr/bin',
      exists: exists(new Set(['C:/Program Files/Git/usr/bin/sh.exe'])),
      gitExecPath: null,
    });
    expect(sh.replace(/\\/g, '/')).toBe('C:/Program Files/Git/usr/bin/sh.exe');
  });

  it("falls back to Git for Windows' usr/bin, found from git --exec-path", () => {
    const sh = findShIn({
      platform: 'win32',
      pathEnv: 'C:/Windows;C:/Program Files/Git/cmd',
      exists: exists(new Set(['C:/Program Files/Git/usr/bin/sh.exe'])),
      gitExecPath: 'C:/Program Files/Git/mingw64/libexec/git-core',
    });
    expect(sh.replace(/\\/g, '/')).toBe('C:/Program Files/Git/usr/bin/sh.exe');
  });

  it('returns null when sh is nowhere, so callers fail instead of skipping', () => {
    expect(
      findShIn({
        platform: 'win32',
        pathEnv: 'C:/Windows',
        exists: () => false,
        gitExecPath: null,
      }),
    ).toBeNull();
  });
});

describe('findSh()', () => {
  it('finds sh on this machine', () => {
    expect(findSh(), 'sh is required (PATH or Git for Windows usr/bin)').toBeTruthy();
  });
});
