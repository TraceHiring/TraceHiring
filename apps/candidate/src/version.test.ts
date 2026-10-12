// The shell's version is VITE_APP_VERSION when it is a commit SHA, else "dev" (spec §9.3). The
// pattern is repeated in src/version.ts (the candidate bundle may not import @trace/shared's
// contracts, which pull in zod); this test keeps it in step with `Version` (spec §9.4).
import { Version } from '@trace/shared/contracts';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, resolveAppVersion } from './version';

const SAMPLES: unknown[] = [
  'dev',
  'DEV',
  'Dev',
  'abcdef1',
  'abcdef',
  'ABCDEF1',
  'abcdeg1',
  '0123456789abcdef0123456789abcdef01234567',
  '0123456789abcdef0123456789abcdef012345678',
  'abcdef1\n',
  ' abcdef1',
  'abcdef1 ',
  'v1.2.3',
  '0.0.0',
  '',
  undefined,
  null,
  7,
  {},
  ['abcdef1'],
];

describe('resolveAppVersion', () => {
  it.each(SAMPLES.map((s) => [JSON.stringify(s) ?? 'undefined', s] as const))(
    'agrees with the Version contract for %s',
    (_name, sample) => {
      const parsed = Version.safeParse(sample);
      expect(resolveAppVersion(sample)).toBe(parsed.success ? parsed.data : 'dev');
    },
  );

  it('APP_VERSION is a valid Version, and "dev" when the build sets none', () => {
    expect(Version.safeParse(APP_VERSION).success).toBe(true);
    expect(APP_VERSION).toBe(resolveAppVersion(import.meta.env.VITE_APP_VERSION));
  });
});
