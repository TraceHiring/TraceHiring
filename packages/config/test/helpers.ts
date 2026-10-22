// Shared helpers for the ESLint rule fixture tests (spec specs/m0-foundations.md §10.1).
// Files are linted as virtual sources under a fixture repo root, so the tests never depend on the
// real apps, Workers or services existing on disk. Only test/fixtures/repo/packages/vendors/package.json
// exists, for the directory-import case.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { createTraceConfig } from '../eslint/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Fixture repository root. */
export const virtualRoot = path.join(here, 'fixtures', 'repo');

const configs = new Map<string, Linter.Config[]>();

function configFor(root: string): Linter.Config[] {
  let config = configs.get(root);
  if (!config) {
    config = createTraceConfig({ rootPath: root });
    configs.set(root, config);
  }
  return config;
}

/**
 * Lints `code` as if it lived at `relPath` under `root`.
 * Throws on fatal (parse) errors and on resolver errors, so a broken setup can never pass as "no findings".
 */
export function lintAt(root: string, relPath: string, code: string): Linter.LintMessage[] {
  const linter = new Linter({ cwd: root });
  const messages = linter.verify(code, configFor(root), { filename: path.join(root, relPath) });
  const broken = messages.filter((m) => m.fatal === true || m.ruleId === null);
  if (broken.length > 0) {
    throw new Error(`lint setup error in ${relPath}: ${broken.map((m) => m.message).join('; ')}`);
  }
  return messages;
}

/** Lints `code` as if it lived at `relPath` inside the fixture repo. */
export function lint(relPath: string, code: string): Linter.LintMessage[] {
  return lintAt(virtualRoot, relPath, code);
}

/** Messages reported by one rule. */
export function ruleMessages(relPath: string, code: string, ruleId: string): Linter.LintMessage[] {
  return lint(relPath, code).filter((m) => m.ruleId === ruleId);
}

/** Messages from any eslint-plugin-boundaries rule. */
export function boundaryMessages(
  relPath: string,
  code: string,
  root: string = virtualRoot,
): Linter.LintMessage[] {
  return lintAt(root, relPath, code).filter((m) => m.ruleId?.startsWith('boundaries/') === true);
}
