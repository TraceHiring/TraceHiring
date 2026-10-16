// D1 staging resources (specs/d1-demo-slice.md §7.1; docs/reviews/D1-security-review-bindings.md
// F5): scripts/ensure-staging-resources.mjs creates the staging R2 buckets and Queues before the
// Workers deploy, only if missing, and never deletes. wrangler is replaced by a fake `run`; no
// Cloudflare call is made.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUCKETS,
  QUEUES,
  ensureResources,
  main,
  wranglerRunner,
} from '../ensure-staging-resources.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ok = { status: 0, stdout: '', stderr: '' };
const exists = (what) => ({
  status: 1,
  stdout: '',
  stderr: `✘ [ERROR] A request to the Cloudflare API failed.\n  ${what} already exists. [code: 10004]\n`,
});
const fail = { status: 1, stdout: '', stderr: '✘ [ERROR] Authentication error [code: 10000]\n' };
const queueExists = {
  status: 1,
  stdout: '',
  stderr:
    '✘ [ERROR] A request to the Cloudflare API failed.\n  Queue is a duplicate [code: 11009]\n',
};
/** What `wrangler r2 bucket info <name> --json` prints (wrangler 4.149 r2BucketInfoCommand). */
const bucketInfo = (name, location = 'APAC') => ({
  status: 0,
  stdout: `${JSON.stringify({ name, created: '2026-10-16T00:00:00.000Z', location, default_storage_class: 'Standard', object_count: '0', bucket_size: '0 B' })}\n`,
  stderr: '',
});
/** What `wrangler queues info <name>` prints (wrangler 4.149 queuesInfoCommand). */
const queueInfo = (name) => ({
  status: 0,
  stdout: `Queue Name: ${name}\nQueue ID: q-id\nCreated On: 2026-10-16\nNumber of Producers: 0\nNumber of Consumers: 0\n`,
  stderr: '',
});
/** The verb of a fake wrangler call: `r2 bucket <verb>` or `queues <verb>`. */
const verbOf = (args) => (args[2] === 'r2' ? args[4] : args[3]);
/** Every create says "already exists"; every info confirms the resource as asked. */
const existing =
  ({ location = 'APAC', bucketAs, queueAs } = {}) =>
  (args) => {
    if (verbOf(args) === 'create')
      return args[2] === 'r2' ? exists('The bucket you tried to create') : queueExists;
    if (args[2] === 'r2') return bucketInfo(bucketAs ?? args[5], location);
    return queueInfo(queueAs ?? args[4]);
  };

/** A fake wrangler that records each call and answers with `answer(args)`. */
const recorder = (answer = () => ok) => {
  const calls = [];
  return {
    calls,
    run: (args) => {
      calls.push(args);
      return answer(args);
    },
  };
};

describe('the resource names', () => {
  it('are exactly the staging buckets and queues of spec §7.1', () => {
    expect([...BUCKETS]).toEqual(['trace-packages-staging', 'trace-evidence-staging']);
    // The DLQ first: the main queue's consumer config names it.
    expect([...QUEUES]).toEqual([
      'trace-session-mirror-dlq-staging',
      'trace-session-mirror-staging',
    ]);
  });

  it('are exactly the -staging names in the three wrangler.jsonc files', () => {
    const found = new Set();
    for (const dir of ['workers/edge', 'workers/jobs', 'services/api']) {
      const text = readFileSync(path.join(REPO, dir, 'wrangler.jsonc'), 'utf8');
      for (const m of text.matchAll(/"(?:bucket_name|queue|dead_letter_queue)":\s*"([^"]+)"/g)) {
        if (m[1].endsWith('-staging')) found.add(m[1]);
      }
    }
    expect([...found].sort()).toEqual([...BUCKETS, ...QUEUES].sort());
  });

  it('are frozen', () => {
    expect(Object.isFrozen(BUCKETS)).toBe(true);
    expect(Object.isFrozen(QUEUES)).toBe(true);
  });
});

describe('ensureResources', () => {
  it('creates buckets, then the DLQ, then the queue, with the plan location for buckets', () => {
    const w = recorder();
    const { violations, report } = ensureResources({ run: w.run });
    expect(violations).toEqual([]);
    expect(w.calls).toEqual([
      [
        'exec',
        'wrangler',
        'r2',
        'bucket',
        'create',
        'trace-packages-staging',
        '--location',
        'apac',
      ],
      [
        'exec',
        'wrangler',
        'r2',
        'bucket',
        'create',
        'trace-evidence-staging',
        '--location',
        'apac',
      ],
      ['exec', 'wrangler', 'queues', 'create', 'trace-session-mirror-dlq-staging'],
      ['exec', 'wrangler', 'queues', 'create', 'trace-session-mirror-staging'],
    ]);
    expect(report).toHaveLength(4);
    expect(report.join('\n')).toMatch(/created/);
  });

  it('treats a confirmed "already exists" as success, so a re-run is idempotent', () => {
    const w = recorder(existing());
    const { violations, report } = ensureResources({ run: w.run });
    expect(violations).toEqual([]);
    expect(report).toHaveLength(4);
    expect(report.join('\n')).toMatch(/already exists \(confirmed\)/);
    expect(report.join('\n')).not.toMatch(/created/);
  });

  // Security review S6 (docs/reviews/D1-security-review-wave0-rest.md): an "exists" answer is
  // confirmed with `wrangler r2 bucket info --json` (name and APAC location) or `wrangler queues
  // info` (its Queue Name line) before it counts as success.
  it('confirms each "exists" answer with exactly one info call per resource', () => {
    const w = recorder(existing());
    ensureResources({ run: w.run });
    expect(w.calls.filter((a) => verbOf(a) === 'info')).toEqual([
      ['exec', 'wrangler', 'r2', 'bucket', 'info', 'trace-packages-staging', '--json'],
      ['exec', 'wrangler', 'r2', 'bucket', 'info', 'trace-evidence-staging', '--json'],
      ['exec', 'wrangler', 'queues', 'info', 'trace-session-mirror-dlq-staging'],
      ['exec', 'wrangler', 'queues', 'info', 'trace-session-mirror-staging'],
    ]);
  });

  it('makes no info call for a resource it created', () => {
    const w = recorder();
    ensureResources({ run: w.run });
    expect(w.calls.some((a) => verbOf(a) === 'info')).toBe(false);
  });

  it('accepts the location in any case (the API has returned both)', () => {
    expect(
      ensureResources({ run: recorder(existing({ location: 'apac' })).run }).violations,
    ).toEqual([]);
  });

  it('fails an existing bucket in another location (a location cannot change later)', () => {
    const { violations } = ensureResources({ run: recorder(existing({ location: 'ENAM' })).run });
    expect(violations).toHaveLength(2);
    expect(violations[0]).toMatch(/trace-packages-staging.*location ENAM.*apac/);
  });

  it('fails an existing bucket whose location is missing or unknown', () => {
    for (const location of ['(unknown)', '', undefined]) {
      const run = recorder((args) =>
        verbOf(args) === 'info' && args[2] === 'r2'
          ? {
              status: 0,
              stdout: JSON.stringify({
                name: args[5],
                ...(location === undefined ? {} : { location }),
              }),
              stderr: '',
            }
          : existing()(args),
      ).run;
      expect(ensureResources({ run }).violations, String(location)).toHaveLength(2);
    }
  });

  it('fails when the info call fails, is killed, throws or prints something else', () => {
    const answers = [
      {
        status: 1,
        stdout: '',
        stderr: '✘ [ERROR] The specified bucket does not exist. [code: 10006]\n',
      },
      { status: null, signal: 'SIGKILL', stdout: '', stderr: '' },
      { status: 0, stdout: 'not json\n', stderr: '' },
      { status: 0, stdout: '', stderr: '' },
      { status: 0, stdout: '[]', stderr: '' },
    ];
    for (const answer of answers) {
      const run = recorder((args) => (verbOf(args) === 'info' ? answer : existing()(args))).run;
      const { violations } = ensureResources({ run });
      expect(violations, JSON.stringify(answer)).toHaveLength(4);
      expect(violations[0]).toMatch(/already exists.*could not be confirmed/);
    }
    const throws = recorder((args) => {
      if (verbOf(args) === 'info') throw new Error('boom');
      return existing()(args);
    });
    expect(ensureResources({ run: throws.run }).violations).toHaveLength(4);
  });

  it('fails when the info answer names another bucket or queue', () => {
    expect(
      ensureResources({ run: recorder(existing({ bucketAs: 'someone-else' })).run }).violations,
    ).toHaveLength(2);
    expect(
      ensureResources({ run: recorder(existing({ queueAs: 'trace-session-mirror' })).run })
        .violations,
    ).toHaveLength(2);
    // The name line must be exactly the queue's, not a longer name that starts with it.
    const longer = recorder((args) =>
      verbOf(args) === 'info' && args[2] === 'queues'
        ? queueInfo(`${args[4]}-old`)
        : existing()(args),
    );
    expect(ensureResources({ run: longer.run }).violations).toHaveLength(2);
  });

  it('matches "exists" only in wrangler\'s error block on stderr, with the code of its kind', () => {
    const notExists = [
      // the wording on stdout only
      { status: 1, stdout: 'already exists [code: 10004]\n', stderr: '✘ [ERROR] Something else\n' },
      // the wording before the error line (a warning, a banner, an echoed name)
      {
        status: 1,
        stdout: '',
        stderr:
          '▲ [WARNING] trace-packages-staging already exists?\n✘ [ERROR] Authentication error [code: 10000]\n',
      },
      // no error line at all
      { status: 1, stdout: '', stderr: 'already exists [code: 10004]\n' },
      // the queue code on a bucket
      { status: 1, stdout: '', stderr: '✘ [ERROR] Request failed.\n  duplicate [code: 11009]\n' },
    ];
    for (const answer of notExists) {
      const w = recorder((args) =>
        args[2] === 'r2' && verbOf(args) === 'create' ? answer : existing()(args),
      );
      const { violations } = ensureResources({ run: w.run });
      expect(violations, JSON.stringify(answer)).toHaveLength(2);
      expect(violations[0]).toMatch(/create failed/);
      // No confirmation is attempted for an answer that is not an "exists" answer.
      expect(w.calls.filter((a) => a[2] === 'r2' && verbOf(a) === 'info')).toEqual([]);
    }
    // The bucket code on a queue is not a queue "exists" answer either.
    const w = recorder((args) =>
      args[2] === 'queues' && verbOf(args) === 'create'
        ? { status: 1, stdout: '', stderr: '✘ [ERROR] Request failed.\n  [code: 10004]\n' }
        : existing()(args),
    );
    expect(ensureResources({ run: w.run }).violations).toHaveLength(2);
  });

  it('accepts the queue "exists" answer by code 11009 and by wording', () => {
    expect(ensureResources({ run: recorder(existing()).run }).violations).toEqual([]);
    const worded = recorder((args) =>
      args[2] === 'queues' && verbOf(args) === 'create'
        ? {
            status: 1,
            stdout: '',
            stderr:
              '✘ [ERROR] A request to the Cloudflare API failed.\n  The queue already exists.\n',
          }
        : existing()(args),
    );
    expect(ensureResources({ run: worded.run }).violations).toEqual([]);
  });

  it('fails on any other error, names the resource and keeps going so every problem shows', () => {
    const w = recorder((args) => (args.includes('trace-evidence-staging') ? fail : ok));
    const { violations } = ensureResources({ run: w.run });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/trace-evidence-staging/);
    expect(violations[0]).toMatch(/Authentication error/);
    expect(w.calls).toHaveLength(4);
  });

  it('fails when wrangler cannot be started or is killed, and when run throws', () => {
    const spawnError = recorder(() => ({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('ENOENT'),
    }));
    expect(ensureResources({ run: spawnError.run }).violations).toHaveLength(4);
    const killed = recorder(() => ({ status: null, signal: 'SIGKILL', stdout: '', stderr: '' }));
    expect(ensureResources({ run: killed.run }).violations).toHaveLength(4);
    const throws = ensureResources({
      run: () => {
        throw new Error('boom');
      },
    });
    expect(throws.violations).toHaveLength(4);
  });

  it('never deletes, whatever wrangler answers', () => {
    for (const answer of [() => ok, () => exists('x'), () => fail, existing()]) {
      const w = recorder(answer);
      ensureResources({ run: w.run });
      for (const args of w.calls) {
        expect(args.join(' ')).not.toMatch(/delete|remove|purge|--force/i);
        expect(['create', 'info']).toContain(verbOf(args));
      }
    }
  });
});

describe('wranglerRunner', () => {
  it('runs pnpm without a shell, in the repository root, and returns its result', () => {
    const seen = [];
    const spawn = (cmd, args, options) => {
      seen.push({ cmd, args, options });
      return ok;
    };
    expect(wranglerRunner('/repo', spawn)(['exec', 'wrangler', 'queues', 'create', 'q'])).toBe(ok);
    expect(seen).toEqual([
      {
        cmd: 'pnpm',
        args: ['exec', 'wrangler', 'queues', 'create', 'q'],
        options: { cwd: '/repo', encoding: 'utf8', shell: false },
      },
    ]);
  });
});

describe('main', () => {
  it('exits 0 and prints OK when every resource exists or is created', () => {
    const outs = [];
    expect(main({ run: recorder().run, out: (l) => outs.push(l), err: () => {} })).toBe(0);
    expect(outs.join('\n')).toMatch(/OK/);
  });

  it('exits 1 on a violation', () => {
    const errs = [];
    expect(main({ run: recorder(() => fail).run, out: () => {}, err: (l) => errs.push(l) })).toBe(
      1,
    );
    expect(errs.length).toBeGreaterThan(0);
  });
});
