// scripts/ops/create-org.mjs (specs/m0b-tenancy.md §2.6, §4.4). Fakes only: no database, no network,
// no process is started. Synthetic values only; the "URL" below is a made-up string.
import { describe, expect, it } from 'vitest';
import { main } from '../ops/create-org.mjs';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const GENERATED_ID = '44444444-4444-4444-8444-444444444444';
// Built at run time on purpose: shaped like a DB URL with a password, so a leak is easy to spot.
const FAKE_PASSWORD = ['p', 'w', Math.abs(0x5eed).toString(36), 'zz'].join('-');
const REMOTE_URL = `postgresql://postgres:${FAKE_PASSWORD}@db.example.test:5432/postgres`;
const LOCAL_URL = `postgresql://postgres:${FAKE_PASSWORD}@127.0.0.1:54322/postgres`;

const GOOD = [
  '--name',
  'Acme Hiring',
  '--slug',
  'acme-hiring',
  '--kind',
  'customer',
  '--owner-user-id',
  OWNER_ID,
  '--display-name',
  'Acme owner',
  '--request-id',
  REQUEST_ID,
];

/** A deps object whose spawnSync is scripted; every call is recorded. */
function harness({
  env = {},
  hasPsql = true,
  psql = { status: 0, stdout: `${ORG_ID}\n`, stderr: '' },
  stack = `DB_URL="${LOCAL_URL}"\nAPI_URL="http://127.0.0.1:54321"\n`,
} = {}) {
  const calls = [];
  const out = [];
  const err = [];
  const deps = {
    env,
    platform: 'linux',
    randomUUID: () => GENERATED_ID,
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
    spawnSync(cmd, args, opts) {
      calls.push({ cmd, args, opts });
      if (cmd === 'pnpm' || cmd.startsWith('pnpm '))
        return stack === null ? { status: 1, stdout: '' } : { status: 0, stdout: stack };
      if (cmd === 'psql' && args[0] === '--version') {
        return hasPsql
          ? { status: 0, stdout: 'psql (PostgreSQL) 17.0\n' }
          : { error: new Error('x') };
      }
      return psql;
    },
  };
  const sqlCalls = () => calls.filter((c) => c.cmd !== 'pnpm' && c.args[0] !== '--version');
  return { deps, calls, sqlCalls, stdout: () => out.join(''), stderr: () => err.join('') };
}

const varsOf = (args) => {
  const vars = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-v') {
      const [k, ...rest] = args[i + 1].split('=');
      vars[k] = rest.join('=');
    }
  }
  return vars;
};

describe('create-org', () => {
  it('prints only the new org id and exits 0', () => {
    const h = harness({ env: { TRACE_OPERATOR_DB_URL: REMOTE_URL } });
    expect(main({ argv: GOOD, deps: h.deps })).toBe(0);
    expect(h.stdout()).toBe(`${ORG_ID}\n`);
    expect(h.stderr()).toBe('');
  });

  it('passes every argument as a psql -v variable and none inside the SQL', () => {
    const h = harness({ env: { TRACE_OPERATOR_DB_URL: REMOTE_URL } });
    main({ argv: GOOD, deps: h.deps });
    const [call] = h.sqlCalls();
    expect(call.cmd).toBe('psql');
    expect(call.opts.shell).toBe(false);
    expect(call.args.slice(-2)).toEqual(['-f', '-']);
    expect(varsOf(call.args)).toMatchObject({
      ON_ERROR_STOP: '1',
      p_name: 'Acme Hiring',
      p_slug: 'acme-hiring',
      p_kind: 'customer',
      p_owner: OWNER_ID,
      p_display: 'Acme owner',
      p_rid: REQUEST_ID,
    });
    // argv holds only flags and -v pairs
    const nonVar = call.args.filter((a, i) => call.args[i - 1] !== '-v');
    expect(nonVar.every((a) => a === '-v' || a.startsWith('-'))).toBe(true);
    // the SQL is on stdin, refers to the variables, and contains no value
    expect(call.opts.input).toContain("private.create_org(:'p_name'");
    expect(call.opts.input).toContain(":'p_kind'::public.org_kind");
    for (const value of [
      'Acme Hiring',
      'acme-hiring',
      'customer',
      OWNER_ID,
      'Acme owner',
      REQUEST_ID,
    ]) {
      expect(call.opts.input).not.toContain(value);
    }
  });

  it('hands a quote-bearing value to psql as a variable, not as SQL', () => {
    const h = harness({ env: { TRACE_OPERATOR_DB_URL: REMOTE_URL } });
    const argv = GOOD.map((a) => (a === 'Acme Hiring' ? "O'Brien; drop table x" : a));
    expect(main({ argv, deps: h.deps })).toBe(0);
    const [call] = h.sqlCalls();
    expect(varsOf(call.args).p_name).toBe("O'Brien; drop table x");
    expect(call.opts.input).not.toContain('drop table');
  });

  it('generates a request id when none is given', () => {
    const h = harness({ env: { TRACE_OPERATOR_DB_URL: REMOTE_URL } });
    const argv = GOOD.slice(0, -2);
    expect(main({ argv, deps: h.deps })).toBe(0);
    expect(varsOf(h.sqlCalls()[0].args).p_rid).toBe(GENERATED_ID);
  });

  it('gives the URL to psql through PGDATABASE only', () => {
    const h = harness({ env: { TRACE_OPERATOR_DB_URL: REMOTE_URL, KEEP: 'yes' } });
    main({ argv: GOOD, deps: h.deps });
    const [call] = h.sqlCalls();
    expect(call.opts.env.PGDATABASE).toBe(REMOTE_URL);
    expect(call.opts.env.TRACE_OPERATOR_DB_URL).toBeUndefined();
    expect(call.opts.env.KEEP).toBe('yes');
    expect(call.args.join(' ')).not.toContain(FAKE_PASSWORD);
    expect(call.args.join(' ')).not.toContain('db.example.test');
  });

  it("uses the local stack's DB_URL when TRACE_OPERATOR_DB_URL is unset, and never prints it", () => {
    const h = harness();
    expect(main({ argv: GOOD, deps: h.deps })).toBe(0);
    expect(h.calls[0].cmd).toBe('pnpm');
    expect(h.sqlCalls()[0].opts.env.PGDATABASE).toBe(LOCAL_URL);
    expect(h.stdout() + h.stderr()).not.toContain(FAKE_PASSWORD);
  });

  it('uses a shell for the constant pnpm command line on Windows only', () => {
    const h = harness();
    h.deps.platform = 'win32';
    main({ argv: GOOD, deps: h.deps });
    expect(h.calls[0].cmd).toBe('pnpm exec supabase status -o env');
    expect(h.calls[0].opts.shell).toBe(true);
  });

  it('fails (exit 1) when there is no URL and the local stack is not running', () => {
    const h = harness({ stack: null });
    expect(main({ argv: GOOD, deps: h.deps })).toBe(1);
    expect(h.sqlCalls()).toHaveLength(0);
    expect(h.stdout()).toBe('');
    expect(h.stderr()).toContain('TRACE_OPERATOR_DB_URL');
  });

  describe('validation (exit 2; the field is named, the value is not printed)', () => {
    const swap = (flag, value) => {
      const argv = [...GOOD];
      argv[argv.indexOf(flag) + 1] = value;
      return argv;
    };
    it.each([
      ['--slug', 'Bad Slug!!', 'slug'],
      ['--kind', 'enterprise', 'kind'],
      ['--owner-user-id', 'not-a-uuid', 'ownerUserId'],
      ['--request-id', 'also-not-a-uuid', 'requestId'],
      ['--name', '', 'name'],
      ['--display-name', 'x'.repeat(121), 'displayName'],
    ])('%s', (flag, value, field) => {
      const h = harness({ env: { TRACE_OPERATOR_DB_URL: REMOTE_URL } });
      expect(main({ argv: swap(flag, value), deps: h.deps })).toBe(2);
      expect(h.stderr()).toContain(field);
      if (value.length > 0) expect(h.stderr()).not.toContain(value);
      expect(h.stdout()).toBe('');
      expect(h.calls).toHaveLength(0);
    });

    it('names every missing field', () => {
      const h = harness();
      expect(main({ argv: ['--name', 'Acme'], deps: h.deps })).toBe(2);
      for (const f of ['slug', 'kind', 'ownerUserId', 'displayName']) {
        expect(h.stderr()).toContain(f);
      }
      expect(h.calls).toHaveLength(0);
    });

    it('rejects an unknown flag without echoing it', () => {
      const h = harness();
      expect(main({ argv: [...GOOD, '--secret-thing', 'zzz'], deps: h.deps })).toBe(2);
      expect(h.stderr()).not.toContain('secret-thing');
      expect(h.calls).toHaveLength(0);
    });
  });

  describe('failures', () => {
    it('prints a fixed message and the SQLSTATE, never the URL-bearing stderr', () => {
      const h = harness({
        env: { TRACE_OPERATOR_DB_URL: REMOTE_URL },
        psql: {
          status: 3,
          stdout: '',
          stderr: `psql: error: connection to ${REMOTE_URL} failed\nERROR:  23505\n`,
        },
      });
      expect(main({ argv: GOOD, deps: h.deps })).toBe(1);
      expect(h.stdout()).toBe('');
      expect(h.stderr()).toContain('SQLSTATE 23505');
      expect(h.stderr()).not.toContain(FAKE_PASSWORD);
      expect(h.stderr()).not.toContain('db.example.test');
    });

    it('handles a failure without a SQLSTATE', () => {
      const h = harness({
        env: { TRACE_OPERATOR_DB_URL: REMOTE_URL },
        psql: { status: 2, stdout: '', stderr: `could not connect ${REMOTE_URL}` },
      });
      expect(main({ argv: GOOD, deps: h.deps })).toBe(1);
      expect(h.stderr()).toContain('no SQLSTATE');
      expect(h.stderr()).not.toContain(FAKE_PASSWORD);
    });

    it('prints nothing from stdout that is not a uuid', () => {
      const h = harness({
        env: { TRACE_OPERATOR_DB_URL: REMOTE_URL },
        psql: { status: 0, stdout: 'surprise\n', stderr: '' },
      });
      expect(main({ argv: GOOD, deps: h.deps })).toBe(1);
      expect(h.stdout()).toBe('');
      expect(h.stderr()).not.toContain('surprise');
    });
  });

  describe('docker fallback (no psql binary)', () => {
    it('runs psql in the local stack container, with no URL anywhere', () => {
      const h = harness({ env: { TRACE_OPERATOR_DB_URL: LOCAL_URL }, hasPsql: false });
      expect(main({ argv: GOOD, deps: h.deps })).toBe(0);
      expect(h.stdout()).toBe(`${ORG_ID}\n`);
      const [call] = h.sqlCalls();
      expect(call.cmd).toBe('docker');
      expect(call.opts.shell).toBe(false);
      expect(call.args.slice(0, 5)).toEqual(['exec', '-i', 'supabase_db_trace', 'psql', '-U']);
      expect(call.args).toContain('postgres');
      expect(call.args.join(' ')).not.toContain(FAKE_PASSWORD);
      expect(call.opts.env.PGDATABASE).toBeUndefined();
      expect(call.opts.env.TRACE_OPERATOR_DB_URL).toBeUndefined();
      expect(varsOf(call.args).p_slug).toBe('acme-hiring');
      expect(call.args.slice(-2)).toEqual(['-f', '-']);
      expect(call.opts.input).toContain('private.create_org');
    });

    it('also works for localhost and the default local URL', () => {
      for (const env of [
        { TRACE_OPERATOR_DB_URL: LOCAL_URL.replace('127.0.0.1', 'localhost') },
        {},
      ]) {
        const h = harness({ env, hasPsql: false });
        expect(main({ argv: GOOD, deps: h.deps })).toBe(0);
        expect(h.sqlCalls()[0].cmd).toBe('docker');
      }
    });

    it('refuses to fall back for a non-local URL', () => {
      const h = harness({ env: { TRACE_OPERATOR_DB_URL: REMOTE_URL }, hasPsql: false });
      expect(main({ argv: GOOD, deps: h.deps })).toBe(1);
      expect(h.sqlCalls()).toHaveLength(0);
      expect(h.stdout()).toBe('');
      expect(h.stderr()).not.toContain('db.example.test');
    });

    it('does not treat a lookalike host as local', () => {
      const h = harness({
        env: {
          TRACE_OPERATOR_DB_URL: REMOTE_URL.replace('db.example.test', '127.0.0.1.example.test'),
        },
        hasPsql: false,
      });
      expect(main({ argv: GOOD, deps: h.deps })).toBe(1);
      expect(h.sqlCalls()).toHaveLength(0);
    });
  });
});
