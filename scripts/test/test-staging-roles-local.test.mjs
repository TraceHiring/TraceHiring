// scripts/test-staging-roles-local.mjs (spec review SR-E-5). Pure parts and main with a scripted spawn: no Docker, no
// database. The real run against the local stack is the script itself (scripts/test-rls.mjs, after pgTAP).
import { describe, expect, it } from 'vitest';
import { LOGIN_ROLES } from '../lib/e2e-local-secrets.mjs';
import { generateValues, stagingLoginRolesSql } from '../ops/staging-worker-secrets.mjs';
import {
  applyScenarioSql,
  checkNames,
  extraMembershipScenarioSql,
  innerSql,
  main,
  missingRoleScenarioSql,
  parseChecks,
  sqlstateOf,
  verifiersOf,
} from '../test-staging-roles-local.mjs';

let n = 0;
const rand = (size) => Buffer.alloc(size, (n = (n + 7) % 251) + 1);
const roleSql = () => stagingLoginRolesSql(generateValues(rand));

describe('innerSql', () => {
  it('drops exactly the outer begin and commit and keeps the rest verbatim', () => {
    const full = roleSql();
    const inner = innerSql(full);
    expect(`begin;\n${inner}\ncommit;\n`).toBe(full);
    expect(inner).not.toMatch(/^(begin|commit|rollback);/m);
  });

  it('refuses text that is not one begin … commit', () => {
    expect(() => innerSql('select 1;')).toThrow();
    expect(() => innerSql('begin;\ncommit;\nselect 1;\ncommit;\n')).toThrow();
  });
});

describe('scenario SQL', () => {
  const first = roleSql();
  const second = roleSql();

  it('apply: two real runs, checks after each, and always a rollback, never a commit', () => {
    const sql = applyScenarioSql(first, second);
    expect(sql.startsWith('begin;\n')).toBe(true);
    expect(sql.trimEnd().endsWith('rollback;')).toBe(true);
    expect(sql).not.toMatch(/\bcommit\b/);
    expect(sql).toContain(innerSql(first));
    expect(sql).toContain(innerSql(second));
    for (const v of [...Object.values(verifiersOf(first)), ...Object.values(verifiersOf(second))]) {
      expect(sql).toContain(`rolpassword = '${v}'`);
    }
    expect(sql.indexOf(innerSql(second))).toBeGreaterThan(sql.indexOf("'create:scram:"));
  });

  it('the guard scenarios set up inside the transaction and roll back', () => {
    const tr1 = missingRoleScenarioSql(first, '0a1b2c3d');
    expect(tr1).toMatch(/^begin;\nalter role trace_integrity_worker rename to /);
    const tr2 = extraMembershipScenarioSql(first);
    expect(tr2.startsWith('begin;\n')).toBe(true);
    expect(tr2).toContain('grant trace_worker to jobs_quality_login');
    for (const sql of [tr1, tr2]) {
      expect(sql.trimEnd().endsWith('rollback;')).toBe(true);
      expect(sql).not.toMatch(/\bcommit\b/);
    }
    expect(() => missingRoleScenarioSql(first, "x'; drop")).toThrow();
  });

  it('verifiersOf finds one verifier per login', () => {
    expect(Object.keys(verifiersOf(first)).sort()).toEqual(LOGIN_ROLES.map((r) => r.login).sort());
  });

  it('checks the M1 logins too (R5-11): each holds only its own trace_* role', () => {
    const sql = applyScenarioSql(first, second);
    for (const [login, role] of [
      ['jobs_authoring_login', 'trace_authoring_worker'],
      ['jobs_admin_login', 'trace_admin_worker'],
    ]) {
      expect(checkNames('create')).toContain(`create:grant:${login}`);
      expect(sql).toContain(`bool_and(r.rolname = '${role}'`);
      expect(sql).toContain(`where l.rolname = '${login}'`);
    }
  });
});

describe('parseChecks and sqlstateOf', () => {
  const names = checkNames('create');

  it('passes only when every expected check printed t', () => {
    expect(parseChecks(names.map((x) => `${x}|t`).join('\n'), names).ok).toBe(true);
    const oneF = names.map((x, i) => `${x}|${i === 3 ? 'f' : 't'}`).join('\n');
    expect(parseChecks(oneF, names)).toEqual({ ok: false, failed: names[3] });
    const missing = names
      .slice(1)
      .map((x) => `${x}|t`)
      .join('\n');
    expect(parseChecks(missing, names).ok).toBe(false);
    expect(parseChecks('', names).ok).toBe(false);
  });

  it('reads the SQLSTATE of a terse psql error', () => {
    expect(sqlstateOf('psql:<stdin>:12: ERROR:  TR001')).toBe('TR001');
    expect(sqlstateOf('nothing')).toBeNull();
  });
});

describe('main (scripted spawn)', () => {
  const allTrue = (sql) => {
    const expected = /'alter:/.test(sql) ? [...checkNames('create'), ...checkNames('alter')] : [];
    return { status: 0, stdout: expected.map((x) => `${x}|t`).join('\n'), stderr: '' };
  };
  const run = (answer) => {
    const out = [];
    const calls = [];
    const code = main({
      deps: {
        randomBytes: rand,
        stdout: { write: (s) => out.push(s) },
        spawnSync: (cmd, args, opts) => {
          calls.push({ cmd, args, opts });
          return answer(opts.input);
        },
      },
    });
    return { code, out: out.join(''), calls };
  };

  it('runs three docker psql sessions as postgres with the SQL on stdin and passes', () => {
    const r = run((sql) => {
      if (sql.includes('rename to')) return { status: 3, stdout: '', stderr: 'ERROR:  TR001' };
      if (sql.includes('grant trace_worker to jobs_quality_login')) {
        return { status: 3, stdout: '', stderr: 'ERROR:  TR002' };
      }
      return allTrue(sql);
    });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(3);
    for (const c of r.calls) {
      expect(c.cmd).toBe('docker');
      expect(c.args).toEqual(expect.arrayContaining(['exec', '-i', 'supabase_db_trace', 'psql']));
      expect(c.args).toEqual(
        expect.arrayContaining(['-U', 'postgres', 'ON_ERROR_STOP=1', '-f', '-']),
      );
      expect(c.args.join(' ')).not.toMatch(/SCRAM|create role/);
    }
    // Four checks per login and run, six logins (M1 R5-11), two runs.
    expect(r.out).toMatch(/apply OK \(create path and alter path, 48 checks, rolled back\)/);
    expect(r.out).toMatch(/TR001 guard OK/);
    expect(r.out).toMatch(/TR002 guard OK/);
    expect(r.out).not.toMatch(/SCRAM-SHA-256/);
  });

  it('fails when a guard does not fire or a check prints f, without echoing server output', () => {
    const r = run((sql) => {
      if (sql.includes('rename to')) return { status: 0, stdout: '', stderr: '' };
      if (sql.includes('grant trace_worker to')) {
        return { status: 3, stdout: '', stderr: 'ERROR:  42501 server-detail-marker' };
      }
      return { status: 0, stdout: 'create:attrs:api_login|f', stderr: '' };
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/apply FAILED/);
    expect(r.out).toMatch(/TR001 guard FAILED/);
    expect(r.out).toMatch(/TR002 guard FAILED .*42501/);
    expect(r.out).not.toContain('server-detail-marker');
  });
});
