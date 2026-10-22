// Pure planning for scripts/verify-clean-clone.mjs (spec specs/m0-foundations.md §13 AT-1a-local,
// AT-1b, §12). Nothing here touches the disk, git, pnpm or Docker.
import path from 'node:path';

/**
 * node:22.23.3, pinned by its multi-arch image index digest. Source: `docker buildx imagetools
 * inspect node:22.23.3` on 2026-10-11 (MediaType application/vnd.oci.image.index.v1+json).
 */
export const NODE_IMAGE =
  'node:22.23.3@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8';

/**
 * gitleaks 8.30.1 linux_x64. Source of the sha256: the release's checksums file,
 * https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_checksums.txt
 * (fetched 2026-10-11).
 */
export const GITLEAKS = Object.freeze({
  version: '8.30.1',
  asset: 'gitleaks_8.30.1_linux_x64.tar.gz',
  sha256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
  url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz',
});

const SHA = /^[0-9a-f]{40}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

export const USAGE = `Usage: node scripts/verify-clean-clone.mjs [--linux] [--keep]

Clones HEAD into a temp folder next to the main checkout (a path with spaces), creates main from
origin/main, then:
  (default)  AT-1b: pnpm install --frozen-lockfile && pnpm verify on this machine.
  --linux    AT-1a-local: install, typecheck, lint, test and build in ${NODE_IMAGE.split('@')[0]}
             (pinned by digest) with gitleaks ${GITLEAKS.version} checksum-verified; then, once the
             test:rls script exists, test:rls on the host (it needs the host Docker engine).
  --keep     keep the clone afterwards (a failed run always keeps it).
Uncommitted changes are not part of the clone.`;

/** Parses CLI arguments. Throws on anything unknown. */
export function parseArgs(argv) {
  const opts = { linux: false, keep: false, help: false };
  for (const arg of argv) {
    if (arg === '--linux') opts.linux = true;
    else if (arg === '--keep') opts.keep = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
  }
  return opts;
}

/** The folder that holds the main checkout, given the absolute shared `.git` dir (spec §12). */
export function cloneParentDir(gitCommonDir) {
  return path.dirname(path.dirname(gitCommonDir));
}

/** Git steps that make a clean clone of the source's HEAD, detached at `headSha`. */
export function cloneSteps({ source, dir, headSha }) {
  if (!SHA.test(headSha)) throw new Error(`HEAD must be a full sha, got: ${headSha}`);
  return [
    { cmd: 'git', args: ['clone', '--quiet', '--no-checkout', source, dir] },
    // The source may be a linked worktree whose HEAD is detached; fetch it explicitly.
    { cmd: 'git', args: ['-C', dir, 'fetch', '--quiet', source, 'HEAD'] },
    { cmd: 'git', args: ['-C', dir, 'checkout', '--quiet', '--detach', headSha] },
  ];
}

/** `git branch main origin/main` when the source has main and the clone does not (spec §15). */
export function mainBranchStep({ dir, sourceHasMain, cloneHasMain }) {
  if (!sourceHasMain || cloneHasMain) return null;
  return { cmd: 'git', args: ['-C', dir, 'branch', 'main', 'origin/main'] };
}

/** AT-1b: the full `pnpm verify` in the host clone. */
export function hostSteps() {
  return [
    { cmd: 'pnpm', args: ['install', '--frozen-lockfile'] },
    { cmd: 'pnpm', args: ['verify'] },
  ];
}

/** AT-1a-local: what still runs on the host after the container (test:rls needs host Docker). */
export function linuxHostSteps(rootScripts) {
  if (!rootScripts || typeof rootScripts['test:rls'] !== 'string') return [];
  return [
    { cmd: 'pnpm', args: ['install', '--frozen-lockfile'] },
    { cmd: 'pnpm', args: ['test:rls'] },
  ];
}

/** The exact pnpm version from the root package.json `packageManager` field. */
export function pnpmVersionFrom(pkg) {
  const m = /^pnpm@(\d+\.\d+\.\d+)(\+.*)?$/.exec(pkg?.packageManager ?? '');
  if (!m || /[^\w.+@-]/.test(pkg.packageManager)) {
    throw new Error(
      `root package.json packageManager must be pnpm@<x.y.z>, got: ${pkg?.packageManager}`,
    );
  }
  return m[1];
}

/** The bash script the container runs. Every interpolated value is validated first. */
export function containerScript({ headSha, pnpmVersion }) {
  if (!SHA.test(headSha)) throw new Error(`HEAD must be a full sha, got: ${headSha}`);
  if (!SEMVER.test(pnpmVersion)) throw new Error(`bad pnpm version: ${pnpmVersion}`);
  return [
    'set -euo pipefail',
    'if [ "$(uname -m)" != "x86_64" ]; then echo "clean clone: the pinned gitleaks asset is linux_x64 but this container is $(uname -m)" >&2; exit 1; fi',
    'echo "clean clone: node $(node --version) in the pinned image"',
    // gitleaks, checksum-verified before it is extracted (same as CI's shared setup, spec §4).
    'cd /tmp',
    `curl -fsSL --retry 3 -o gitleaks.tar.gz ${GITLEAKS.url}`,
    `echo "${GITLEAKS.sha256}  gitleaks.tar.gz" | sha256sum -c -`,
    'tar -xzf gitleaks.tar.gz -C /usr/local/bin gitleaks',
    'gitleaks version',
    // A Linux-native checkout (LF endings, case-sensitive) of the read-only host clone.
    "git config --global --add safe.directory '*'",
    'git clone --quiet --no-checkout /src /work',
    'cd /work',
    `git checkout --quiet --detach ${headSha}`,
    'if git show-ref --verify --quiet refs/remotes/origin/main && ! git show-ref --verify --quiet refs/heads/main; then git branch main origin/main; fi',
    `npm install -g pnpm@${pnpmVersion} --no-fund --no-audit`,
    'pnpm install --frozen-lockfile',
    'pnpm typecheck',
    'pnpm lint',
    'pnpm test',
    'pnpm build',
    'echo "clean clone (linux): install, typecheck, lint, test and build passed"',
  ].join('\n');
}

/** `docker run` arguments: read-only bind mount of the host clone, pinned platform and image. */
export function dockerRunArgs({ cloneDir, script }) {
  if (cloneDir.includes(',')) {
    throw new Error(
      `the clone path contains a comma, which docker --mount cannot take: ${cloneDir}`,
    );
  }
  return [
    'run',
    '--rm',
    '--platform',
    'linux/amd64',
    '--mount',
    `type=bind,source=${cloneDir},target=/src,readonly`,
    NODE_IMAGE,
    'bash',
    '-c',
    script,
  ];
}
