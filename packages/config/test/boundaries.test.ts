// Import boundaries between workspaces (spec §10.1, eslint-plugin-boundaries 7.2.0).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boundaryMessages } from './helpers.js';

type Case = readonly [from: string, source: string];

const importOf = (source: string): string => `import { x } from '${source}';\nexport { x };\n`;

function violations(from: string, code: string, root?: string): number {
  return boundaryMessages(from, code, root).length;
}

const allowed: Case[] = [
  // apps → ui, shared, db-types
  ['apps/candidate/src/main.tsx', '@trace/ui'],
  ['apps/candidate/src/main.tsx', '@trace/shared'],
  ['apps/recruiter/src/routes/home.tsx', '@trace/db-types'],
  // edge, jobs, api → shared, vendors, db-types
  ['workers/edge/src/index.ts', '@trace/shared'],
  ['workers/edge/src/index.ts', '@trace/vendors'],
  ['workers/edge/src/index.ts', '@trace/db-types'],
  ['workers/jobs/src/index.ts', '@trace/shared'],
  ['workers/jobs/src/index.ts', '@trace/vendors'],
  ['workers/jobs/src/index.ts', '@trace/db-types'],
  ['services/api/src/index.ts', '@trace/shared'],
  ['services/api/src/index.ts', '@trace/vendors'],
  ['services/api/src/index.ts', '@trace/db-types'],
  // edge, jobs, api → workers-http; workers-http → shared (specs/m0b-tenancy.md §1.1 item 9b)
  ['workers/edge/src/app.ts', '@trace/workers-http'],
  ['workers/jobs/src/app.ts', '@trace/workers-http'],
  ['services/api/src/app.ts', '@trace/workers-http'],
  ['packages/workers-http/src/index.ts', '@trace/shared'],
  ['packages/workers-http/src/index.ts', '@trace/shared/log'],
  ['packages/workers-http/src/index.ts', 'hono'],
  ['packages/workers-http/src/index.ts', './errors'],
  ['packages/workers-http/vitest.config.ts', '@trace/config/vitest'],
  // band-engine: services/api and the recruiter app may import it (integrity files in jobs: rule1 tests)
  ['services/api/src/modules/reports/report-meta.ts', '@trace/band-engine'],
  ['services/api/src/modules/reports/report-meta.ts', '@trace/band-engine/rules/d1-v1.json'],
  ['apps/recruiter/src/reports/RuleTable.tsx', '@trace/band-engine'],
  // M1 pure packages (specs/m1-test-authoring.md §11.3 A1, §6.3, §6.5): they import only @trace/shared;
  // the api generates variants; the edge (SessionDO) and the api draw sections.
  ['packages/item-variants/src/index.ts', '@trace/shared'],
  ['packages/item-variants/src/index.ts', '@trace/shared/contracts/m1'],
  ['packages/item-variants/src/generate.ts', './parse'],
  ['packages/item-variants/vitest.config.ts', '@trace/config/vitest'],
  ['packages/item-delivery/src/index.ts', '@trace/shared'],
  ['packages/item-delivery/src/draw.ts', './prng'],
  ['packages/item-delivery/vitest.config.ts', '@trace/config/vitest'],
  ['services/api/src/modules/bank/variants.ts', '@trace/item-variants'],
  ['workers/edge/src/session-core.ts', '@trace/item-delivery'],
  ['services/api/src/modules/tests/publish.ts', '@trace/item-delivery'],
  // band-engine and e2e files may import their own files
  ['packages/band-engine/src/index.ts', './types'],
  ['packages/band-engine/src/rules/parse.ts', '../types'],
  ['packages/band-engine/vitest.config.ts', '@trace/config/vitest'],
  ['e2e/tests/d1-slice.spec.ts', '../support/auth'],
  ['e2e/tests/d1-slice.spec.ts', '@playwright/test'],
  // ui → shared; vendors → shared
  ['packages/ui/src/index.ts', '@trace/shared'],
  ['packages/vendors/src/index.ts', '@trace/shared'],
  // subpath imports resolve to the same element
  ['apps/candidate/src/main.tsx', '@trace/shared/log'],
  // files inside one element may import each other
  ['apps/candidate/src/main.tsx', './App'],
  ['packages/shared/src/index.ts', './log/logger'],
  ['services/api/src/modules/billing/index.ts', '../../lib/http'],
  // third-party packages and Node built-ins are not boundaries
  ['apps/candidate/src/main.tsx', 'react'],
  ['workers/edge/src/index.ts', 'hono'],
  ['packages/shared/src/index.ts', 'zod'],
  ['packages/config/eslint/index.js', 'node:path'],
  ['apps/candidate/src/main.tsx', 'zod'],
  ['apps/candidate/src/main.tsx', 'node:fs'],
  // scripts and supabase may import their own files
  ['scripts/check-boundaries.mjs', './lib/git.mjs'],
  ['supabase/tests/helpers.ts', './fixtures/data'],
  // tooling files may import the shared config
  ['apps/candidate/vitest.config.ts', '@trace/config/vitest'],
  ['workers/edge/vitest.config.ts', '@trace/config/vitest'],
  ['packages/shared/vitest.config.ts', '@trace/config/vitest'],
  ['eslint.config.js', '@trace/config/eslint'],
  ['apps/candidate/vite.config.ts', '@trace/config/vite'],
  ['apps/candidate/vitest.config.mts', '@trace/config/vitest'],
  ['apps/recruiter/vite.config.mts', '@trace/config/vite'],
  // a workspace's vitest config may extend its own vite config
  ['apps/candidate/vitest.config.ts', './vite.config'],
];

const denied: Case[] = [
  // apps may not reach vendors, config or any deployable
  ['apps/candidate/src/main.tsx', '@trace/vendors'],
  ['apps/candidate/src/main.tsx', '@trace/config/vitest'],
  ['apps/candidate/src/main.tsx', '@trace/recruiter'],
  ['apps/candidate/src/main.tsx', '../../recruiter/src/main'],
  ['apps/recruiter/src/main.tsx', '@trace/edge'],
  ['apps/recruiter/src/main.tsx', '@trace/jobs'],
  ['apps/recruiter/src/main.tsx', '@trace/api'],
  // Workers and the service may not import ui, an app, each other or config
  ['workers/edge/src/index.ts', '@trace/ui'],
  ['workers/edge/src/index.ts', '@trace/jobs'],
  ['workers/edge/src/index.ts', '@trace/api'],
  ['workers/edge/src/index.ts', '@trace/candidate'],
  ['workers/jobs/src/index.ts', '@trace/edge'],
  ['workers/jobs/src/index.ts', '@trace/api'],
  ['workers/jobs/src/index.ts', '../../../services/api/src/index'],
  ['services/api/src/index.ts', '@trace/jobs'],
  ['services/api/src/index.ts', '@trace/ui'],
  ['services/api/src/index.ts', '@trace/recruiter'],
  ['services/api/src/index.ts', '@trace/config/eslint'],
  // ui → shared only
  ['packages/ui/src/index.ts', '@trace/vendors'],
  ['packages/ui/src/index.ts', '@trace/db-types'],
  ['packages/ui/src/index.ts', '@trace/candidate'],
  // vendors → shared only
  ['packages/vendors/src/index.ts', '@trace/ui'],
  ['packages/vendors/src/index.ts', '@trace/db-types'],
  ['packages/vendors/src/index.ts', '@trace/edge'],
  // shared and db-types import no other workspace
  ['packages/shared/src/index.ts', '@trace/ui'],
  ['packages/shared/src/index.ts', '@trace/vendors'],
  ['packages/shared/src/index.ts', '@trace/db-types'],
  ['packages/shared/src/index.ts', '../../ui/src/index'],
  ['packages/db-types/src/index.ts', '@trace/shared'],
  // workers-http is for Workers only: apps and packages may not import it, and it imports only shared
  ['apps/recruiter/src/main.tsx', '@trace/workers-http'],
  ['apps/candidate/src/main.tsx', '@trace/workers-http'],
  ['packages/shared/src/index.ts', '@trace/workers-http'],
  ['packages/ui/src/index.ts', '@trace/workers-http'],
  ['packages/vendors/src/index.ts', '@trace/workers-http'],
  ['packages/db-types/src/index.ts', '@trace/workers-http'],
  ['packages/workers-http/src/index.ts', '@trace/vendors'],
  ['packages/workers-http/src/index.ts', '@trace/db-types'],
  ['packages/workers-http/src/index.ts', '@trace/ui'],
  ['packages/workers-http/src/index.ts', '@trace/edge'],
  ['packages/workers-http/src/index.ts', '@trace/api'],
  ['packages/workers-http/src/index.ts', '../../../workers/edge/src/app'],
  ['packages/workers-http/src/index.ts', '@trace/config/vitest'],
  // M1 pure packages import nothing but @trace/shared, and only the api / edge import them; the
  // candidate app never draws (the server holds the truth), jobs and the other packages never import them
  ['packages/item-variants/src/index.ts', '@trace/vendors'],
  ['packages/item-variants/src/index.ts', '@trace/db-types'],
  ['packages/item-variants/src/index.ts', '@trace/band-engine'],
  ['packages/item-variants/src/index.ts', '@trace/item-delivery'],
  ['packages/item-variants/src/index.ts', '@trace/workers-http'],
  ['packages/item-delivery/src/index.ts', '@trace/vendors'],
  ['packages/item-delivery/src/index.ts', '@trace/db-types'],
  ['packages/item-delivery/src/index.ts', '@trace/item-variants'],
  ['packages/item-delivery/src/index.ts', '@trace/band-engine'],
  ['apps/candidate/src/main.tsx', '@trace/item-delivery'],
  ['apps/candidate/src/main.tsx', '@trace/item-variants'],
  ['apps/recruiter/src/main.tsx', '@trace/item-delivery'],
  ['workers/jobs/src/index.ts', '@trace/item-delivery'],
  ['workers/jobs/src/index.ts', '@trace/item-variants'],
  ['workers/edge/src/index.ts', '@trace/item-variants'],
  ['packages/shared/src/index.ts', '@trace/item-variants'],
  ['packages/vendors/src/index.ts', '@trace/item-delivery'],
  // band-engine imports nothing internal (pure TypeScript, specs/d1-demo-slice.md §5.2)
  ['packages/band-engine/src/index.ts', '@trace/shared'],
  ['packages/band-engine/src/index.ts', '@trace/shared/canonical-json'],
  ['packages/band-engine/src/index.ts', '@trace/vendors'],
  ['packages/band-engine/src/index.ts', '@trace/db-types'],
  ['packages/band-engine/src/index.ts', '@trace/api'],
  ['packages/band-engine/src/index.ts', '../../shared/src/index'],
  ['packages/band-engine/src/index.ts', '@trace/config/vitest'],
  // only integrity files, services/api and the recruiter app may import band-engine
  ['apps/candidate/src/main.tsx', '@trace/band-engine'],
  ['workers/edge/src/index.ts', '@trace/band-engine'],
  ['workers/jobs/src/index.ts', '@trace/band-engine'],
  ['packages/shared/src/index.ts', '@trace/band-engine'],
  ['packages/ui/src/index.ts', '@trace/band-engine'],
  ['packages/vendors/src/index.ts', '@trace/band-engine'],
  ['packages/workers-http/src/index.ts', '@trace/band-engine'],
  ['scripts/check-boundaries.mjs', '@trace/band-engine'],
  ['scripts/check-boundaries.mjs', '../packages/band-engine/src/index.ts'],
  ['e2e/tests/d1-slice.spec.ts', '@trace/band-engine'],
  // e2e imports no workspace code, and nothing imports e2e
  ['e2e/support/totp.ts', '@trace/shared'],
  ['e2e/support/totp.ts', '@trace/recruiter'],
  ['e2e/support/totp.ts', '../../packages/shared/src/index'],
  ['e2e/playwright.config.ts', '@trace/config/vitest'],
  ['apps/recruiter/src/main.tsx', '@trace/e2e'],
  ['apps/recruiter/src/main.tsx', '../../../e2e/support/auth'],
  ['services/api/src/index.ts', '@trace/e2e'],
  ['workers/jobs/src/integrity/band.ts', '@trace/e2e'],
  ['packages/band-engine/src/index.ts', '@trace/e2e'],
  // config imports no other workspace
  ['packages/config/eslint/index.js', '@trace/shared'],
  ['packages/config/eslint/index.js', '@trace/band-engine'],
  // only tooling files may import config
  ['packages/shared/src/index.ts', '@trace/config/vitest'],
  // a workspace missing from the package map fails closed
  ['apps/candidate/src/main.tsx', '@trace/not-yet-mapped'],
  ['workers/edge/src/index.ts', '@trace/not-yet-mapped/sub/path'],
  // unclassified targets fail closed
  ['apps/candidate/src/main.tsx', '../../../packages/vendors'],
  ['apps/candidate/src/main.tsx', '../../../packages/vendors/'],
  ['apps/candidate/src/main.tsx', '../../../scripts/x.ts'],
  ['apps/candidate/src/main.tsx', '../../../eslint.config.js'],
  ['apps/candidate/src/main.tsx', '../../../vite.config.ts'],
  ['apps/candidate/src/main.tsx', '../../../docs/notes'],
  ['apps/candidate/src/main.tsx', '../../../../outside-the-repo/x'],
  ['apps/candidate/src/main.tsx', '#vendors'],
  ['apps/candidate/src/main.tsx', '#internal/server'],
  ['apps/candidate/src/main.tsx', '../../../node_modules/@trace/vendors/src/index'],
  ['apps/candidate/src/main.tsx', '../node_modules/@trace/shared/src/index'],
  // scripts, supabase and root tooling import no workspace code
  ['scripts/check-boundaries.mjs', '@trace/shared'],
  ['scripts/check-boundaries.mjs', '../packages/shared/src/index.ts'],
  ['scripts/check-boundaries.mjs', '../apps/candidate/src/main'],
  ['supabase/tests/helpers.ts', '@trace/db-types'],
  ['supabase/tests/helpers.ts', '../../scripts/lib/git.mjs'],
  ['vite.config.ts', '@trace/shared'],
  ['eslint.config.js', './scripts/lib/git.mjs'],
  // tooling configs may import only @trace/config (and their own workspace's tooling files)
  ['apps/candidate/vite.config.ts', '@trace/ui'],
  ['apps/candidate/vite.config.ts', '@trace/shared'],
  ['apps/candidate/vite.config.ts', './src/main'],
  ['apps/candidate/vitest.config.ts', '../recruiter/vite.config'],
];

describe('boundaries: allowed imports', () => {
  it.each(allowed)('%s may import %s', (from, source) => {
    expect(violations(from, importOf(source))).toBe(0);
  });
});

describe('boundaries: denied imports', () => {
  it.each(denied)('%s may not import %s', (from, source) => {
    expect(violations(from, importOf(source))).toBeGreaterThan(0);
  });
});

describe('boundaries: every file must be classified', () => {
  it.each(['docs/tool.ts', 'random.ts', 'tools/x.mjs'])('%s is reported', (file) => {
    expect(violations(file, 'export const x = 1;\n')).toBeGreaterThan(0);
  });

  it.each(['scripts/a.mjs', 'supabase/tests/a.ts', 'eslint.config.js', 'commitlint.config.js'])(
    '%s is classified',
    (file) => {
      expect(violations(file, 'export const x = 1;\n')).toBe(0);
    },
  );
});

describe('boundaries: bare specifiers that resolve into the repo', () => {
  // A temp repo with node_modules/linked-vendors -> packages/vendors (a directory junction),
  // the shape a `link:` dependency or a hoisted workspace symlink would have.
  let root = '';
  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trace-boundaries-')));
    const vendors = path.join(root, 'packages', 'vendors', 'src');
    fs.mkdirSync(vendors, { recursive: true });
    fs.writeFileSync(path.join(vendors, 'index.ts'), 'export const x = 1;\n');
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.symlinkSync(
      path.join(root, 'packages', 'vendors'),
      path.join(root, 'node_modules', 'linked-vendors'),
      'junction',
    );
  });
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('an unknown bare name that lands in the repo is denied', () => {
    expect(
      violations('apps/candidate/src/main.tsx', importOf('linked-vendors'), root),
    ).toBeGreaterThan(0);
  });

  it('a bare name that is not installed stays external', () => {
    expect(violations('apps/candidate/src/main.tsx', importOf('react'), root)).toBe(0);
  });
});

describe('boundaries: every import form is checked', () => {
  const from = 'apps/candidate/src/main.tsx';
  it.each([
    ['type-only import', "import type { X } from '@trace/api';\nexport type { X };\n"],
    ['re-export', "export { x } from '@trace/api';\n"],
    ['export all', "export * from '@trace/api';\n"],
    ['dynamic import', "export const m = import('@trace/api');\n"],
    ['side-effect import', "import '@trace/api';\n"],
  ])('%s of a service is denied', (_label, code) => {
    expect(violations(from, code)).toBeGreaterThan(0);
  });
});
