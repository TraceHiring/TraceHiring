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

  it('treats "already exists" as success, so a re-run is idempotent', () => {
    const w = recorder(() => exists('The bucket you tried to create'));
    const { violations, report } = ensureResources({ run: w.run });
    expect(violations).toEqual([]);
    expect(report.join('\n')).toMatch(/already exists/);
    expect(report.join('\n')).not.toMatch(/created/);
  });

  it('accepts the queue "already exists" wording and code 11009', () => {
    const w = recorder(() => ({
      status: 1,
      stdout: '',
      stderr: 'Queue is a duplicate [code: 11009]',
    }));
    expect(ensureResources({ run: w.run }).violations).toEqual([]);
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
    for (const answer of [() => ok, () => exists('x'), () => fail]) {
      const w = recorder(answer);
      ensureResources({ run: w.run });
      for (const args of w.calls) {
        expect(args.join(' ')).not.toMatch(/delete|remove|purge|--force/i);
        expect(args[2] === 'r2' ? args[4] : args[3]).toBe('create');
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
