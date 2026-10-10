// Shared helpers for the ESLint rule fixture tests (spec specs/m0-foundations.md §10.1).
// Files are linted as virtual sources under a virtual repo root, so the tests never depend on
// the real apps, Workers or services existing on disk.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { createTraceConfig } from '../eslint/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Virtual repository root. Nothing under it needs to exist. */
export const virtualRoot = path.join(here, 'fixtures', 'virtual-repo');

const config = createTraceConfig({ rootPath: virtualRoot });

/**
 * Lints `code` as if it lived at `relPath` inside the virtual repo.
 * Throws on fatal (parse) errors and on resolver errors, so a broken setup can never pass as "no findings".
 */
export function lint(relPath: string, code: string): Linter.LintMessage[] {
  const linter = new Linter({ cwd: virtualRoot });
  const messages = linter.verify(code, config, { filename: path.join(virtualRoot, relPath) });
  const broken = messages.filter((m) => m.fatal === true || m.ruleId === null);
  if (broken.length > 0) {
    throw new Error(`lint setup error in ${relPath}: ${broken.map((m) => m.message).join('; ')}`);
  }
  return messages;
}

/** Messages reported by one rule. */
export function ruleMessages(relPath: string, code: string, ruleId: string): Linter.LintMessage[] {
  return lint(relPath, code).filter((m) => m.ruleId === ruleId);
}
