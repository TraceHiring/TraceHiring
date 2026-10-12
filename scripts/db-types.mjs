#!/usr/bin/env node
// Regenerates packages/db-types/src/database.ts (`pnpm db:types`; spec specs/m0-foundations.md
// §8.2 "Creating migrations", §8.3 step 6). Whoever changes a migration runs this and commits the
// result in the same commit.
//   node scripts/db-types.mjs
// It writes the output of `supabase gen types typescript --local --schema public` unformatted,
// byte for byte (the file is in .prettierignore), so the harness's drift check compares exactly.
// The local stack is shared by every checkout, so it first takes the same lock as test-rls,
// starts the stack and resets the database from THIS checkout's migrations: the types then match
// what `pnpm test:rls` generates right after its own reset. The lock is released on exit, on
// failure and on a signal. A failed or empty generation never touches the tracked file. The CLI's
// stderr is never printed (it can hold a connection URL).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './lib/cli.mjs';
import { DB_TYPES_FILE, defaultDeps, generateTypes, redact, withLocalStack } from './test-rls.mjs';

export const DOCKER_MESSAGE =
  'Docker is not running — db types cannot be generated from the local stack. Start Docker Desktop.';
const USAGE = 'usage: node scripts/db-types.mjs (no arguments)';

/** CLI body; resolves to the exit code. */
export async function main(options) {
  const deps = { ...defaultDeps(options), tool: 'db-types' };
  const { argv = [], root, run, log, error } = deps;
  if (argv.length > 0) {
    error(USAGE);
    return 2;
  }
  const target = path.join(root, ...DB_TYPES_FILE.split('/'));
  let outcome = null;
  const result = await withLocalStack(deps, { stop: false }, async () => {
    log('db-types: running supabase gen types typescript --local --schema public');
    const { bytes, problems } = await generateTypes(run, root);
    if (!bytes) return problems;
    const before = existsSync(target) ? readFileSync(target) : null;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    outcome = { bytes: bytes.length, changed: !(before && before.equals(bytes)) };
    return [];
  });

  if (!result.docker) {
    error(DOCKER_MESSAGE);
    return 1;
  }
  if (result.problems.length > 0) {
    for (const p of result.problems) error(p.startsWith('  | ') ? p : `db-types: ${p}`);
    error(`db-types: FAILED; ${DB_TYPES_FILE} was not changed`);
    return 1;
  }
  log(
    `db-types: wrote ${DB_TYPES_FILE} (${outcome.bytes} bytes, ${outcome.changed ? 'changed: commit it with the migration' : 'unchanged'})`,
  );
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  main({ argv: process.argv.slice(2), root }).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`db-types: ${redact(String(e?.message ?? e))}`);
      process.exitCode = 1;
    },
  );
}
