// Test helpers for the RLS harness tests (scripts/test/test-rls.test.mjs, db-types.test.mjs).
// Everything the harness touches is injected: a stub `run` that never starts Docker or the
// Supabase CLI, a fake clock and sleep, a lock directory under a fresh temp dir (never the real
// `<os.tmpdir()>/trace-supabase-*.lock`), a fake process for signals. Synthetic data only.
// Not a test file itself (Vitest only collects *.test.mjs).
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { makeTempDir, writeFiles } from '../checks/temp-repo.mjs';

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url));

/** Captured `supabase test db --debug` stdout (CLI 2.120.0): catalog_probe, 4 passing assertions. */
export const PROVE_PASS = read('prove-pass.stdout.txt').toString('utf8');
/** Captured stdout of a run where every assertion of `zz_mutation.test.sql` failed. */
export const PROVE_FAIL_4_OF_4 = read('prove-fail-4-of-4.stdout.txt').toString('utf8');
/**
 * Synthetic, modelled on a real catalog_meta run (lead, W3b finding): each `rollback to savepoint mt`
 * also rolls back pgTAP's own counters, so finish() prints a wrong "# Looks like you planned 67 tests
 * but ran 64" although all 67 `ok` lines match the plan. Must pass.
 */
export const PROVE_MISLEADING_PLAN_COMMENT = read(
  'prove-misleading-plan-comment.stdout.txt',
).toString('utf8');
/**
 * Synthetic: a `not ok` line that pgTAP's num_failed() did not count (rolled back with the savepoint),
 * so the trailing diagnostic claims no failure. Must fail.
 */
export const PROVE_UNCOUNTED_NOT_OK = read('prove-uncounted-not-ok.stdout.txt').toString('utf8');
/** Captured `supabase gen types typescript --local --schema public` output for an empty public schema. */
export const GEN_TYPES = read('gen-types-empty-public.ts.txt');

/** The prefix pg_prove prints before each test file in the captured outputs. */
export const PROVE_DIR = '/work/trace checkout/supabase/tests/';

/**
 * pg_prove verbose output, as `supabase test db --debug` prints it, for synthetic files.
 * @param {{ name: string, tap: string[] }[]} files TAP lines per file (plan included)
 */
export function proveOutput(files) {
  const out = [];
  let failed = false;
  for (const f of files) {
    out.push(`${PROVE_DIR}${f.name} .. `, ...f.tap);
    const bad = f.tap.some((l) => l.startsWith('not ok'));
    failed ||= bad;
    out.push(bad ? 'Failed 1/1 subtests ' : 'ok');
  }
  out.push(
    ...(failed
      ? ['', 'Test Summary Report', '-------------------', 'Result: FAIL']
      : ['All tests successful.', 'Result: PASS']),
  );
  return out.join('\n') + '\n';
}

/** TAP for `n` passing assertions with a matching plan. */
export function passingTap(n, label = 'synthetic assertion') {
  return [`1..${n}`, ...Array.from({ length: n }, (_, i) => `ok ${i + 1} - ${label} ${i + 1}`)];
}

/**
 * A fake checkout: supabase/config.toml, the test files, both floor files and the tracked
 * db-types file. Pass `null` to leave a file out.
 */
export function fakeRepo({
  projectId = 'trace',
  config,
  tests = { 'catalog_probe.test.sql': '-- synthetic test file\n' },
  catalogFloor = '4\n',
  rlsFloor = '0\n',
  dbTypes = GEN_TYPES,
} = {}) {
  const root = makeTempDir('trace-rls-repo-');
  const files = {};
  const toml =
    config === undefined
      ? `# synthetic config\nproject_id = "${projectId}"\n\n[api]\nenabled = true\n`
      : config;
  if (toml !== null) files['supabase/config.toml'] = toml;
  for (const [name, content] of Object.entries(tests)) files[`supabase/tests/${name}`] = content;
  if (catalogFloor !== null) files['supabase/tests/catalog-min-count'] = catalogFloor;
  if (rlsFloor !== null) files['supabase/tests/rls-min-count'] = rlsFloor;
  if (dbTypes !== null) files['packages/db-types/src/database.ts'] = dbTypes;
  writeFiles(root, files);
  return root;
}

/** Which stub response a command line gets. */
const KEYS = [
  ['docker', (l) => l === 'docker info'],
  ['start', (l) => l.startsWith('pnpm exec supabase start')],
  ['reset', (l) => l.startsWith('pnpm exec supabase db reset')],
  ['test', (l) => l.startsWith('pnpm exec supabase test db')],
  ['gen', (l) => l.startsWith('pnpm exec supabase gen types')],
  ['auth', (l) => l.startsWith('node scripts/test-auth-local.mjs')],
  ['concurrency', (l) => l.startsWith('node scripts/test-concurrency-local.mjs')],
  ['stagingroles', (l) => l.startsWith('node scripts/test-staging-roles-local.mjs')],
  ['cataloghosted', (l) => l.startsWith('node scripts/test-catalog-hosted-local.mjs')],
  ['jobsdb', (l) => l.startsWith('pnpm --filter @trace/jobs exec vitest')],
  ['stop', (l) => l.startsWith('pnpm exec supabase stop')],
];

/**
 * A stub for the injected async `run(cmd, args, opts)`. `responses[key]` is a partial result
 * `{ status, stdout, stderr, error }` or a function returning one (it may throw). Unlisted
 * keys succeed with empty output; an unknown command throws.
 */
export function stubRun(responses = {}) {
  const calls = [];
  const run = async (cmd, args, opts = {}) => {
    const line = [cmd, ...args].join(' ');
    const match = KEYS.find(([, test]) => test(line));
    if (!match) throw new Error(`stub run: unexpected command ${line}`);
    const [key] = match;
    calls.push({ key, line, cmd, args, opts });
    const resp = responses[key];
    const value = typeof resp === 'function' ? await resp({ key, line, cmd, args, opts }) : resp;
    return { status: 0, stdout: '', stderr: '', error: null, ...value };
  };
  return { run, calls, keys: () => calls.map((c) => c.key) };
}

/** A fake clock: `sleep(ms)` advances `now()` and calls `onSleep(totalMs)` afterwards. */
export function fakeClock({ start = 1_760_000_000_000, onSleep = () => {} } = {}) {
  let t = start;
  const sleeps = [];
  return {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
      await onSleep(t - start);
    },
    sleeps,
    elapsed: () => t - start,
  };
}

/** A fake process for signal and exit handlers, plus an `exit` stub that records codes. */
export function fakeProcess() {
  const proc = new EventEmitter();
  const exits = [];
  return { proc, exits, exit: (code) => exits.push(code) };
}

/** Collects output lines per stream. */
export function output() {
  const lines = { log: [], warn: [], error: [] };
  return {
    lines,
    log: (m) => lines.log.push(String(m)),
    warn: (m) => lines.warn.push(String(m)),
    error: (m) => lines.error.push(String(m)),
    all: () => [...lines.log, ...lines.warn, ...lines.error].join('\n'),
  };
}
