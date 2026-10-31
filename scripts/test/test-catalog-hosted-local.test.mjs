// scripts/test-catalog-hosted-local.mjs (d1 revision 4m). Pure parts and main with a scripted spawn: no Docker, no
// database. The real run against the local stack is the script itself (scripts/test-rls.mjs step 5e).
import { describe, expect, it } from 'vitest';
import {
  HOSTED,
  SCENARIOS,
  SIMULATE_HOSTED,
  checkNames,
  checkText,
  main,
  parseChecks,
  scenarioSql,
} from '../test-catalog-hosted-local.mjs';

const checks = { mt9: 'select 9 as x', mt7: 'select 7 as x' };

describe('checkText', () => {
  it('drops one trailing semicolon and refuses a second statement', () => {
    expect(checkText('select 1;\r\n')).toBe('select 1');
    expect(() => checkText('select 1; select 2')).toThrow();
  });
});

describe('scenario SQL', () => {
  it('simulates as the superuser, then acts and checks as postgres, and always rolls back', () => {
    for (const s of SCENARIOS) {
      const sql = scenarioSql(s, checks);
      const lines = sql.trimEnd().split('\n');
      expect(lines[0]).toBe('begin;');
      expect(lines.at(-1)).toBe('rollback;');
      expect(sql).not.toMatch(/^\s*commit\b/im);
      const sim = sql.indexOf(SIMULATE_HOSTED);
      const role = sql.indexOf('set local role postgres;');
      expect(sim).toBeGreaterThan(0);
      expect(role).toBeGreaterThan(sim);
      for (const a of s.act) expect(sql.indexOf(a)).toBeGreaterThan(role);
      expect(sql).not.toContain('{MT9}');
      expect(sql).not.toContain('{MT7}');
    }
  });

  it('re-owns exactly the three hosted extensions', () => {
    expect(HOSTED).toEqual(['pg_stat_statements', 'uuid-ossp', 'pgcrypto']);
    expect(SIMULATE_HOSTED).toContain("'pg_stat_statements', 'uuid-ossp', 'pgcrypto'");
  });

  it('covers the clean case and every attack the reviews named', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      'hosted_clean',
      'added_function',
      'replaced_function',
      'definer_function',
      'set_function',
      'replaced_view',
      'moved_extension',
      'other_member',
      'index_name_table',
    ]);
  });
});

describe('parseChecks', () => {
  it('accepts exactly the expected names, all true', () => {
    expect(parseChecks('a:b|t\nc:d|t\n', ['a:b', 'c:d'])).toEqual({ ok: true });
    expect(parseChecks('a:b|t\nc:d|f\n', ['a:b', 'c:d'])).toEqual({ ok: false, failed: 'c:d' });
    expect(parseChecks('a:b|t\n', ['a:b', 'c:d']).ok).toBe(false);
    expect(parseChecks('ERROR\n', ['a:b']).ok).toBe(false);
  });
});

describe('main', () => {
  const sink = () => {
    const out = [];
    return { out, stdout: { write: (t) => out.push(t) } };
  };

  it('passes when every scenario prints all its checks true', () => {
    const { out, stdout } = sink();
    let i = 0;
    const spawnSync = () => {
      const s = SCENARIOS[i++];
      return {
        status: 0,
        stdout: checkNames(s)
          .map((n) => `${n}|t`)
          .join('\n'),
        stderr: '',
      };
    };
    expect(main({ deps: { spawnSync, readCheck: () => 'select 1', stdout } })).toBe(0);
    expect(out).toHaveLength(SCENARIOS.length);
    expect(out.every((l) => / OK \(/.test(l))).toBe(true);
  });

  it('fails on a false check or a psql error, and never prints stderr', () => {
    const { out, stdout } = sink();
    let i = 0;
    const spawnSync = () => {
      const s = SCENARIOS[i++];
      if (i === 1) return { status: 0, stdout: `${checkNames(s)[0]}|f`, stderr: '' };
      return { status: 3, stdout: '', stderr: 'ERROR:  42501 secret-ish server text' };
    };
    expect(main({ deps: { spawnSync, readCheck: () => 'select 1', stdout } })).toBe(1);
    expect(out[0]).toMatch(/hosted_clean FAILED \(hosted_clean:simulated\)/);
    expect(out[1]).toMatch(/SQLSTATE 42501/);
    expect(out.join('')).not.toContain('secret-ish');
  });
});
