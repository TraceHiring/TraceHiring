// scripts/ops/add-member.mjs (specs/m0b-tenancy.md §2.6, §4.4). Fakes only: no database, no network,
// no process is started. Synthetic values only; the "URL" below is a made-up string.
import { describe, expect, it } from 'vitest';
import { main } from '../ops/add-member.mjs';

const MEMBERSHIP_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const GENERATED_ID = '44444444-4444-4444-8444-444444444444';
// Built at run time on purpose: a DB URL with a password, so a leak is easy to spot.
const FAKE_PASSWORD = ['p', 'w', Math.abs(0x5eed).toString(36), 'zz'].join('-');
const REMOTE_URL = `postgresql://postgres:${FAKE_PASSWORD}@db.example.test:5432/postgres`;
const LOCAL_URL = `postgresql://postgres:${FAKE_PASSWORD}@127.0.0.1:54322/postgres`;

const GOOD = [
  '--org-id',
  ORG_ID,
  '--user-id',
  USER_ID,
  '--roles',
  'recruiter',
  '--display-name',
  'Synthetic recruiter',
  '--request-id',
  REQUEST_ID,
];

/** A deps object whose spawnSync is scripted; every call is recorded. */
function harness({
  env = {},
  hasPsql = true,
  psql = { status: 0, stdout: `${MEMBERSHIP_ID}\n`, stderr: '' },
  stack = `DB_URL="${LOCAL_URL}"\n`,
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
  const sqlCalls = () =>
    calls.filter(
      (c) => !(c.cmd === 'pnpm' || c.cmd.startsWith('pnpm ')) && c.args[0] !== '--version',
    );
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

const swap = (flag, value) => {
  const argv = [...GOOD];
  argv[argv.indexOf(flag) + 1] = value;
  return argv;
};

describe('add-member', () => {
  it('prints only the membership id and exits 0', () => {
    const h = harness({ env: { TRACE_OPERATOR_DB_URL: REMOTE_URL } });
    expect(main({ argv: GOOD, deps: h.deps })).toBe(0);
    expect(h.stdout()).toBe(`${MEMBERSHIP_ID}\n`);
    expect(h.stderr()).toBe('');
  });

  it('passes every argument as a psql -v variable and none inside the SQL', () => {
    const h = harness({ env: { TRACE_OPERATOR_DB_URL: REMOTE_URL } });
    main({ argv: swap('--roles', 'recruiter,reviewer'), deps: h.deps });
    const [call] = h.sqlCalls();
    expect(call.cmd).toBe('psql');
    expect(call.opts.shell).toBe(false);
    expect(call.args.slice(-2)).toEqual(['-f', '-']);
    expect(varsOf(call.args)).toMatchObject({
      ON_ERROR_STOP: '1',
      p_org: ORG_ID,
      p_user: USER_ID,
      p_roles: '{recruiter,reviewer}',
      p_display: 'Synthetic recruiter',
      p_rid: REQUEST_ID,
    });
    const nonVar = call.args.filter((a, i) => call.args[i - 1] !== '-v');
    expect(nonVar.every((a) => a.startsWith('-'))).toBe(true);
    expect(call.opts.input).toContain("private.add_member(:'p_org'::uuid");
    expect(call.opts.input).toContain(":'p_roles'::public.org_role[]");
    for (const value of [ORG_ID, USER_ID, 'recruiter', 'Synthetic recruiter', REQUEST_ID]) {
      expect(call.opts.input).not.toContain(value);
    }
  });

  it('generates a request id when none is given', () => {
    const h = harness({ env: { TRACE_OPERATOR_DB_URL: REMOTE_URL } });
    expect(main({ argv: GOOD.slice(0, -2), deps: h.deps })).toBe(0);
    expect(varsOf(h.sqlCalls()[0].args).p_rid).toBe(GENERATED_ID);
  });

  it('gives the URL to psql through PGDATABASE only', () => {
    const h = harness({ env: { TRACE_OPERATOR_DB_URL: REMOTE_URL } });
    main({ argv: GOOD, deps: h.deps });
    const [call] = h.sqlCalls();
    expect(call.opts.env.PGDATABASE).toBe(REMOTE_URL);
    expect(call.opts.env.TRACE_OPERATOR_DB_URL).toBeUndefined();
    expect(call.args.join(' ')).not.toContain(FAKE_PASSWORD);
  });

  it("uses the local stack's DB_URL when TRACE_OPERATOR_DB_URL is unset, and never prints it", () => {
    const h = harness();
    expect(main({ argv: GOOD, deps: h.deps })).toBe(0);
    expect(h.sqlCalls()[0].opts.env.PGDATABASE).toBe(LOCAL_URL);
    expect(h.stdout() + h.stderr()).not.toContain(FAKE_PASSWORD);
  });

  it('starts `supabase status` without the secrets of the parent environment (B0-SEC3)', () => {
    const h = harness({
      env: {
        SMOKE_PASSWORD: FAKE_PASSWORD,
        SUPABASE_STAGING_PUBLISHABLE_KEY: FAKE_PASSWORD,
        KEEP: 'x',
      },
    });
    expect(main({ argv: GOOD, deps: h.deps })).toBe(0);
    const status = h.calls.find((c) => c.cmd === 'pnpm' || c.cmd.startsWith('pnpm '));
    expect(status.opts.env.SMOKE_PASSWORD).toBeUndefined();
    expect(status.opts.env.SUPABASE_STAGING_PUBLISHABLE_KEY).toBeUndefined();
    expect(status.opts.env.KEEP).toBe('x');
  });

  it('fails (exit 1) when there is no URL and the local stack is not running', () => {
    const h = harness({ stack: null });
    expect(main({ argv: GOOD, deps: h.deps })).toBe(1);
    expect(h.sqlCalls()).toHaveLength(0);
    expect(h.stdout()).toBe('');
  });

  describe('validation (exit 2; the field is named, the value is not printed)', () => {
    it.each([
      ['--org-id', 'not-a-uuid', 'orgId'],
      ['--user-id', 'not-a-uuid', 'userId'],
      ['--request-id', 'not-a-uuid', 'requestId'],
      ['--roles', 'superuser', 'roles'],
      ['--roles', 'recruiter,recruiter', 'roles'],
      ['--roles', 'recruiter,reviewer,admin,org_owner,hiring_manager,recruiter', 'roles'],
      ['--roles', '', 'roles'],
      ['--display-name', 'x'.repeat(121), 'displayName'],
    ])('%s %s', (flag, value, field) => {
      const h = harness({ env: { TRACE_OPERATOR_DB_URL: REMOTE_URL } });
      expect(main({ argv: swap(flag, value), deps: h.deps })).toBe(2);
      expect(h.stderr()).toContain(field);
      if (value.length > 0) expect(h.stderr()).not.toContain(value);
      expect(h.stdout()).toBe('');
      expect(h.calls).toHaveLength(0);
    });

    it('names every missing field', () => {
      const h = harness();
      expect(main({ argv: [], deps: h.deps })).toBe(2);
      for (const f of ['orgId', 'userId', 'roles', 'displayName']) {
        expect(h.stderr()).toContain(f);
      }
      expect(h.calls).toHaveLength(0);
    });

    it('rejects a status flag (always active) without echoing it', () => {
      const h = harness();
      expect(main({ argv: [...GOOD, '--status', 'suspended'], deps: h.deps })).toBe(2);
      expect(h.stderr()).not.toContain('suspended');
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
          stderr: `psql: error: connection to ${REMOTE_URL} failed\nERROR:  23503\n`,
        },
      });
      expect(main({ argv: GOOD, deps: h.deps })).toBe(1);
      expect(h.stdout()).toBe('');
      expect(h.stderr()).toContain('SQLSTATE 23503');
      expect(h.stderr()).not.toContain(FAKE_PASSWORD);
      expect(h.stderr()).not.toContain('db.example.test');
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
      const h = harness({ hasPsql: false });
      expect(main({ argv: GOOD, deps: h.deps })).toBe(0);
      expect(h.stdout()).toBe(`${MEMBERSHIP_ID}\n`);
      const [call] = h.sqlCalls();
      expect(call.cmd).toBe('docker');
      expect(call.opts.shell).toBe(false);
      expect(call.args.slice(0, 4)).toEqual(['exec', '-i', 'supabase_db_trace', 'psql']);
      expect(call.args.join(' ')).not.toContain(FAKE_PASSWORD);
      expect(call.opts.env.PGDATABASE).toBeUndefined();
      expect(varsOf(call.args).p_user).toBe(USER_ID);
      expect(call.args.slice(-2)).toEqual(['-f', '-']);
      expect(call.opts.input).toContain('private.add_member');
    });

    it('refuses to fall back for a loopback TRACE_OPERATOR_DB_URL (it can be a tunnel, B0-SEC2)', () => {
      const h = harness({ env: { TRACE_OPERATOR_DB_URL: LOCAL_URL }, hasPsql: false });
      expect(main({ argv: GOOD, deps: h.deps })).toBe(1);
      expect(h.sqlCalls()).toHaveLength(0);
      expect(h.stdout()).toBe('');
      expect(h.stderr()).not.toContain(FAKE_PASSWORD);
    });

    it('refuses to fall back for a non-local URL', () => {
      const h = harness({ env: { TRACE_OPERATOR_DB_URL: REMOTE_URL }, hasPsql: false });
      expect(main({ argv: GOOD, deps: h.deps })).toBe(1);
      expect(h.sqlCalls()).toHaveLength(0);
      expect(h.stderr()).not.toContain('db.example.test');
    });
  });
});
