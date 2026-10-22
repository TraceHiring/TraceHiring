import { describe, expect, it } from 'vitest';
import { AppVersionFile, HealthResponse, LogLine, Version } from './contracts.js';
import { healthBody } from './health.js';
import { resolveVersion } from './version.js';

describe('Version', () => {
  it.each(['dev', 'abcdef0', 'a'.repeat(40)])('accepts %s', (v) => {
    expect(Version.parse(v)).toBe(v);
  });
  it.each(['', 'ABCDEF0', 'abc', 'a'.repeat(41), 'v1.0.0'])('rejects "%s"', (v) => {
    expect(Version.safeParse(v).success).toBe(false);
  });
  it('resolves a missing or invalid build version to dev', () => {
    expect(resolveVersion(undefined)).toBe('dev');
    expect(resolveVersion('not a sha')).toBe('dev');
    expect(resolveVersion('abcdef0')).toBe('abcdef0');
  });
});

describe('HealthResponse', () => {
  it('validates the producer output', () => {
    const body = healthBody('edge', 'abcdef0', new Date('2026-10-11T00:00:00.000Z'));
    expect(HealthResponse.parse(body)).toEqual({
      status: 'ok',
      service: 'edge',
      version: 'abcdef0',
      time: '2026-10-11T00:00:00.000Z',
    });
  });
  it('rejects unknown keys and unknown services', () => {
    const ok = { status: 'ok', service: 'api', version: 'dev', time: '2026-10-11T00:00:00Z' };
    expect(HealthResponse.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(HealthResponse.safeParse({ ...ok, service: 'web' }).success).toBe(false);
  });
});

describe('AppVersionFile and LogLine', () => {
  it('are strict', () => {
    expect(AppVersionFile.safeParse({ app: 'candidate', version: 'dev' }).success).toBe(true);
    expect(AppVersionFile.safeParse({ app: 'candidate', version: 'dev', x: 1 }).success).toBe(
      false,
    );
    const line = { ts: '2026-10-11T00:00:00Z', level: 'info', service: 's', version: 'dev' };
    expect(LogLine.safeParse({ ...line, event: 'a.b_c' }).success).toBe(true);
    expect(LogLine.safeParse({ ...line, event: 'A b' }).success).toBe(false);
    expect(LogLine.safeParse({ ...line, event: 'a', extra: 1 }).success).toBe(false);
  });
});
