// Unit tests for scripts/lib/clean-clone.mjs, the pure planning half of verify-clean-clone.mjs
// (AT-1a-local with --linux, AT-1b on the host). No clone, install or container runs here.
import { describe, expect, it } from 'vitest';
import {
  GITLEAKS,
  NODE_IMAGE,
  cloneParentDir,
  cloneSteps,
  containerScript,
  dockerRunArgs,
  hostSteps,
  linuxHostSteps,
  mainBranchStep,
  parseArgs,
  pnpmVersionFrom,
} from '../lib/clean-clone.mjs';

describe('parseArgs()', () => {
  it('defaults to a host run that removes the clone', () => {
    expect(parseArgs([])).toEqual({ linux: false, keep: false, help: false });
  });

  it('reads --linux, --keep and --help', () => {
    expect(parseArgs(['--linux', '--keep'])).toEqual({ linux: true, keep: true, help: false });
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--fast'])).toThrow(/--fast/);
  });
});

describe('pins', () => {
  it('pins the node image by version and sha256 digest', () => {
    expect(NODE_IMAGE).toMatch(/^node:22\.23\.3@sha256:[0-9a-f]{64}$/);
  });

  it('pins gitleaks 8.30.1 linux_x64 by sha256', () => {
    expect(GITLEAKS.version).toBe('8.30.1');
    expect(GITLEAKS.asset).toBe('gitleaks_8.30.1_linux_x64.tar.gz');
    expect(GITLEAKS.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(GITLEAKS.url).toBe(
      'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz',
    );
  });
});

describe('cloneParentDir()', () => {
  it("is the folder that holds the main checkout, from a worktree's common dir", () => {
    expect(cloneParentDir('C:/Users/a/Trace data/TraceHiring/.git').replace(/\\/g, '/')).toBe(
      'C:/Users/a/Trace data',
    );
  });
});

describe('cloneSteps()', () => {
  it('clones without checkout, fetches the source HEAD and detaches at it', () => {
    const steps = cloneSteps({
      source: 'C:/src dir/wt',
      dir: 'C:/tmp/clean 1',
      headSha: 'a'.repeat(40),
    });
    expect(steps).toEqual([
      {
        cmd: 'git',
        args: ['clone', '--quiet', '--no-checkout', 'C:/src dir/wt', 'C:/tmp/clean 1'],
      },
      { cmd: 'git', args: ['-C', 'C:/tmp/clean 1', 'fetch', '--quiet', 'C:/src dir/wt', 'HEAD'] },
      {
        cmd: 'git',
        args: ['-C', 'C:/tmp/clean 1', 'checkout', '--quiet', '--detach', 'a'.repeat(40)],
      },
    ]);
  });

  it('rejects a HEAD that is not a full sha', () => {
    expect(() => cloneSteps({ source: 's', dir: 'd', headSha: 'main' })).toThrow(/sha/);
  });
});

describe('mainBranchStep()', () => {
  it('creates main from origin/main when the source has main and the clone does not', () => {
    expect(mainBranchStep({ dir: 'd', sourceHasMain: true, cloneHasMain: false })).toEqual({
      cmd: 'git',
      args: ['-C', 'd', 'branch', 'main', 'origin/main'],
    });
  });

  it('does nothing when the clone already has main or the source has none', () => {
    expect(mainBranchStep({ dir: 'd', sourceHasMain: true, cloneHasMain: true })).toBeNull();
    expect(mainBranchStep({ dir: 'd', sourceHasMain: false, cloneHasMain: false })).toBeNull();
  });
});

describe('hostSteps() (AT-1b)', () => {
  it('installs from the lockfile, then runs the full pnpm verify', () => {
    expect(hostSteps()).toEqual([
      { cmd: 'pnpm', args: ['install', '--frozen-lockfile'] },
      { cmd: 'pnpm', args: ['verify'] },
    ]);
  });
});

describe('linuxHostSteps() (AT-1a-local: test:rls stays on the host Docker engine)', () => {
  it('runs test:rls on the host once the script exists', () => {
    expect(linuxHostSteps({ 'test:rls': 'node scripts/test-rls.mjs' })).toEqual([
      { cmd: 'pnpm', args: ['install', '--frozen-lockfile'] },
      { cmd: 'pnpm', args: ['test:rls'] },
    ]);
  });

  it('has nothing to run on the host before test:rls exists', () => {
    expect(linuxHostSteps({ verify: 'x' })).toEqual([]);
  });
});

describe('pnpmVersionFrom()', () => {
  it('reads an exact pnpm version from packageManager', () => {
    expect(pnpmVersionFrom({ packageManager: 'pnpm@12.11.2' })).toBe('12.11.2');
    expect(pnpmVersionFrom({ packageManager: 'pnpm@12.11.2+sha512.abc' })).toBe('12.11.2');
  });

  it('rejects anything else', () => {
    expect(() => pnpmVersionFrom({})).toThrow(/packageManager/);
    expect(() => pnpmVersionFrom({ packageManager: 'npm@10.0.0' })).toThrow(/packageManager/);
    expect(() => pnpmVersionFrom({ packageManager: 'pnpm@latest; rm -rf /' })).toThrow();
  });
});

describe('containerScript()', () => {
  const script = containerScript({ headSha: 'b'.repeat(40), pnpmVersion: '12.11.2' });

  it('downloads gitleaks and verifies its checksum before extracting it', () => {
    const download = script.indexOf(GITLEAKS.url);
    const check = script.indexOf(`${GITLEAKS.sha256}  gitleaks.tar.gz" | sha256sum -c -`);
    const extract = script.indexOf('tar -xzf gitleaks.tar.gz');
    expect(download).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(download);
    expect(extract).toBeGreaterThan(check);
  });

  it('fails fast and refuses a non-x86_64 container', () => {
    expect(script.startsWith('set -euo pipefail\n')).toBe(true);
    expect(script).toContain('uname -m');
  });

  it('makes a Linux-native clone of the host clone, detached at HEAD, with main', () => {
    expect(script).toContain('git clone --quiet --no-checkout /src /work');
    expect(script).toContain(`git checkout --quiet --detach ${'b'.repeat(40)}`);
    expect(script).toContain('git branch main origin/main');
  });

  it('installs the pinned pnpm, then runs install, typecheck, lint, test and build in order', () => {
    const order = [
      'npm install -g pnpm@12.11.2',
      'pnpm install --frozen-lockfile',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
      'pnpm build',
    ].map((s) => script.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(script).not.toContain('test:rls');
  });

  it('rejects inputs that would be interpolated unsafely', () => {
    expect(() => containerScript({ headSha: 'x; rm -rf /', pnpmVersion: '12.11.2' })).toThrow();
    expect(() => containerScript({ headSha: 'b'.repeat(40), pnpmVersion: '1;x' })).toThrow();
  });
});

describe('dockerRunArgs()', () => {
  it('bind-mounts the host clone read-only, pins the platform and image, and runs the script', () => {
    const args = dockerRunArgs({ cloneDir: 'C:/Trace data/clean 1', script: 'echo hi' });
    expect(args).toEqual([
      'run',
      '--rm',
      '--platform',
      'linux/amd64',
      '--mount',
      'type=bind,source=C:/Trace data/clean 1,target=/src,readonly',
      NODE_IMAGE,
      'bash',
      '-c',
      'echo hi',
    ]);
  });

  it('rejects a clone path that would break the --mount value', () => {
    expect(() => dockerRunArgs({ cloneDir: 'C:/a,b', script: 'x' })).toThrow(/comma/);
  });
});
