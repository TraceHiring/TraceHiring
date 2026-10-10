// Import boundaries between workspaces (spec §10.1, eslint-plugin-boundaries 7.2.0).
import { describe, expect, it } from 'vitest';
import { ruleMessages } from './helpers.js';

const RULE = 'boundaries/dependencies';

type Case = readonly [from: string, source: string];

const importOf = (source: string): string => `import { x } from '${source}';\nexport { x };\n`;

function violations(from: string, code: string): number {
  return ruleMessages(from, code, RULE).length;
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
  // tooling files may import the shared config
  ['apps/candidate/vitest.config.ts', '@trace/config/vitest'],
  ['workers/edge/vitest.config.ts', '@trace/config/vitest'],
  ['packages/shared/vitest.config.ts', '@trace/config/vitest'],
  ['eslint.config.js', '@trace/config/eslint'],
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
  // config imports no other workspace
  ['packages/config/eslint/index.js', '@trace/shared'],
  // only tooling files may import config
  ['packages/shared/src/index.ts', '@trace/config/vitest'],
  // a workspace missing from the package map fails closed
  ['apps/candidate/src/main.tsx', '@trace/not-yet-mapped'],
  ['workers/edge/src/index.ts', '@trace/not-yet-mapped/sub/path'],
];

describe('boundaries: allowed imports', () => {
  it.each(allowed)('%s may import %s', (from, source) => {
    expect(violations(from, importOf(source))).toBe(0);
  });
});

describe('boundaries: denied imports', () => {
  it.each(denied)('%s may not import %s', (from, source) => {
    expect(violations(from, importOf(source))).toBe(1);
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
    expect(violations(from, code)).toBe(1);
  });
});
