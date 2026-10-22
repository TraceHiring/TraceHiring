// AT-7 (spec specs/m0-foundations.md §6, §13): commitlint, with the repo's real
// commitlint.config.js, rejects `update stuff` and accepts `feat(api): x` and `wip(api): x`.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// @commitlint/load and @commitlint/lint are what the installed @commitlint/cli runs, so the
// test resolves them through the CLI package rather than adding root dependencies.
async function importFromCli(name) {
  const rootRequire = createRequire(resolve(repoRoot, 'package.json'));
  const cliRequire = createRequire(rootRequire.resolve('@commitlint/cli/package.json'));
  const mod = await import(pathToFileURL(cliRequire.resolve(name)).href);
  return mod.default;
}

describe('commitlint (AT-7)', () => {
  let lintMessage;

  beforeAll(async () => {
    const load = await importFromCli('@commitlint/load');
    const lint = await importFromCli('@commitlint/lint');
    const config = await load({}, { cwd: repoRoot });
    const parserOpts = config.parserPreset?.parserOpts;
    lintMessage = (message) =>
      lint(message, config.rules, parserOpts === undefined ? {} : { parserOpts });
    // A cold first import of the commitlint chain took over 10 s on Windows; warm runs take < 1 s.
  }, 60_000);

  it('rejects a message without a conventional type', async () => {
    const result = await lintMessage('update stuff');
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.name)).toEqual(
      expect.arrayContaining(['type-empty', 'subject-empty']),
    );
  });

  it('accepts a conventional feat commit', async () => {
    const result = await lintMessage('feat(api): x');
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts wip, which the repo config adds to config-conventional', async () => {
    const result = await lintMessage('wip(api): x');
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('still rejects a type that is not on the list', async () => {
    const result = await lintMessage('stuff(api): x');
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.name)).toContain('type-enum');
  });
});
