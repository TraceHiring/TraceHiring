// Scripts that CI runs with plain `node` (no bundler, no Vitest resolver) import these TypeScript files directly:
// scripts/smoke-staging.mjs reads contracts.ts (ci.yml deploy job) and scripts/ops/* read contracts-tenancy.ts.
// Node's type stripping does not map a './x.js' specifier to x.ts, so a relative import inside them breaks those
// scripts while every Vitest run stays green. This loads each file the way CI does.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));

describe('TypeScript files that plain-node scripts import', () => {
  it.each(['packages/shared/src/contracts.ts', 'packages/shared/src/contracts-tenancy.ts'])(
    'loads %s with plain node',
    (file) => {
      const r = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', `await import(${JSON.stringify(`./${file}`)});`],
        { cwd: root, encoding: 'utf8' },
      );
      expect(r.status, r.stderr.split('\n').slice(0, 3).join('\n')).toBe(0);
    },
  );
});
