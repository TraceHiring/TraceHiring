// e2e/playwright.config.ts (specs/d1-demo-slice.md §7.2, §7.3; review D1-SEC-3 (b), SEC-W5-1): a staging run keeps no
// trace, turns off Playwright's copy-prompt snapshot (which would write input values into error-context.md) and runs
// the slice spec only. Fakes only: the config is re-evaluated under an in-memory environment; no browser starts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEYS = ['E2E_STAGING', 'E2E_LOCAL', 'E2E_RECORD', 'E2E_TRACE', 'PLAYWRIGHT_NO_COPY_PROMPT'];

describe('e2e/playwright.config.ts', () => {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    for (const key of KEYS) delete process.env[key];
    vi.resetModules();
  });
  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.resetModules();
  });

  /** Re-evaluates the config module under the current environment. */
  const load = async () => (await import('../../e2e/playwright.config.ts')).default;

  it('staging: one project, no trace, the slice spec only, copy prompt off', async () => {
    process.env['E2E_STAGING'] = '1';
    process.env['E2E_TRACE'] = '1'; // a staging run ignores it
    const config = await load();
    expect(process.env['PLAYWRIGHT_NO_COPY_PROMPT']).toBe('1');
    expect(config.projects).toHaveLength(1);
    const [project] = config.projects;
    expect(project.name).toBe('staging');
    expect(project.use.trace).toBe('off');
    expect(project.testMatch).toBeInstanceOf(RegExp);
    expect(project.testMatch.test('/repo/e2e/tests/d1-slice.spec.ts')).toBe(true);
    for (const other of [
      'candidate-ui.spec.ts',
      'candidate-store.spec.ts',
      'dc-d6.spec.ts',
      'smoke.spec.ts',
      'stack.spec.ts',
    ]) {
      expect(project.testMatch.test(`/repo/e2e/tests/${other}`), other).toBe(false);
    }
  });

  it('local: one project named local, and the copy prompt switch is left alone', async () => {
    process.env['E2E_LOCAL'] = '1';
    const config = await load();
    expect(config.projects).toHaveLength(1);
    expect(config.projects[0].name).toBe('local');
    expect(config.projects[0].use.trace).toBe('off');
    expect(process.env['PLAYWRIGHT_NO_COPY_PROMPT']).toBeUndefined();
  });

  // e2e-staging run 39762460219: a candidate request from the US runner to the Mumbai database takes 5-9 s, so the
  // default 5 s assertion timeout failed steps 5-6 with no server fault. Only the staging project waits longer.
  it('staging: assertions wait at least 30 s (the candidate app request timeout)', async () => {
    process.env['E2E_STAGING'] = '1';
    const config = await load();
    expect(config.projects[0].expect?.timeout).toBeGreaterThanOrEqual(30_000);
    expect(config.expect?.timeout).toBeUndefined();
  });

  it('local: the assertion timeout stays at the Playwright default', async () => {
    process.env['E2E_LOCAL'] = '1';
    const config = await load();
    expect(config.projects[0].expect?.timeout).toBeUndefined();
    expect(config.expect?.timeout).toBeUndefined();
  });

  it('unset: the local project (the default for a developer run)', async () => {
    const config = await load();
    expect(config.projects.map((p) => p.name)).toEqual(['local']);
  });

  it('refuses staging and local together', async () => {
    process.env['E2E_STAGING'] = '1';
    process.env['E2E_LOCAL'] = '1';
    await expect(load()).rejects.toThrow('not both');
  });
});
