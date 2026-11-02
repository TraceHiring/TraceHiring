// psql as `postgres` in the local stack's database container (docker exec, no URL, no password), for the
// local-only E2E checks of database state. Values travel only as `-v name=value` psql variables and must be uuids;
// the SQL text goes on stdin. Reads run inside a read-only transaction that is rolled back. Failures carry the
// SQLSTATE only, never SQL output, so nothing from the database reaches the CI log.
import { spawnSync } from 'node:child_process';
import { env } from './http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME = /^[a-z][a-z0-9_]{0,30}$/;

/** Runs `sql` and returns its non-empty output lines (`-At`: unaligned, `|` between columns). */
export const psql = (sql: string, vars: Record<string, string>, what: string): string[] => {
  const varArgs: string[] = [];
  for (const [name, value] of Object.entries(vars)) {
    if (!NAME.test(name) || !UUID.test(value))
      throw new Error(`${what}: a psql variable is not a uuid`);
    varArgs.push('-v', `${name}=${value}`);
  }
  const r = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      env('E2E_DB_CONTAINER'),
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-X',
      '-q',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=sqlstate',
      ...varArgs,
      '-f',
      '-',
    ],
    { input: sql, encoding: 'utf8', timeout: 30_000, windowsHide: true },
  );
  if (r.error || r.status !== 0) {
    const m = /ERROR:\s+([0-9A-Z]{5})\b/.exec(String(r.stderr ?? ''));
    throw new Error(`${what}: psql failed${m ? ` (SQLSTATE ${m[1]})` : ''}`);
  }
  return String(r.stdout ?? '')
    .split(/\r?\n/)
    .filter((line) => line !== '');
};

/** A read: one read-only transaction, rolled back. */
export const readDb = (sql: string, vars: Record<string, string>, what: string): string[] =>
  psql(`begin transaction read only;\n${sql.trim()}\nrollback;\n`, vars, what);
