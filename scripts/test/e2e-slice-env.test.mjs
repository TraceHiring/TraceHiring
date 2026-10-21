// e2e/support (specs/d1-demo-slice.md §7.2; review D1-SEC-1, D1-SEC-3): the rule 7 on-screen text pattern
// (support/report.ts) and the staging origin pin (support/slice-env.ts). Fakes only: an in-memory environment,
// no network, no browser. Synthetic values only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NEVER_BUILD_TEXT } from '../../e2e/support/report.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

describe('NEVER_BUILD_TEXT (rule 7 on screen, D1-SEC-1)', () => {
  it.each([
    'IP: 203.0.113.7',
    'IP-address',
    'IP address',
    'IP addresses',
    'ip_address',
    'Client IPv4',
    'Client IPv6',
    'Gaze direction',
    'ASN 64500',
    'seen from 203.0.113.7 today',
  ])('matches %j', (text) => {
    expect(NEVER_BUILD_TEXT.test(text)).toBe(true);
  });

  it.each([
    'The leadership addressed the outage',
    'The gazette was printed',
    'zip address',
    'Skip the tip',
    'Version 1.2 of 3 items',
  ])('does not match %j', (text) => {
    expect(NEVER_BUILD_TEXT.test(text)).toBe(false);
  });

  it('is the same pattern as the recruiter screen guard (apps/recruiter/src/d1-guards.test.tsx)', () => {
    const guard = readFileSync(path.join(REPO, 'apps/recruiter/src/d1-guards.test.tsx'), 'utf8');
    expect(guard.replace(/\s+/g, ' ')).toContain(`GAZE_ASN_IP = ${NEVER_BUILD_TEXT.toString()}`);
  });
});

// D1-SEC-2 (SEC-E4, SEC-W5-3, SEC-W5-4): a source-level check, because this spec runs only on CI e2e-local.
describe('e2e/tests/candidate-ui.spec.ts keeps secrets out of the call log', () => {
  const source = readFileSync(path.join(REPO, 'e2e/tests/candidate-ui.spec.ts'), 'utf8');

  it('refuses a non-local api, edge or Supabase in a beforeAll, like candidate-store.spec.ts', () => {
    expect(source).toMatch(/test\.beforeAll\(\s*\(\)\s*=>\s*\{\s*requireLocalHosts\(\{/);
    for (const name of ['E2E_API_URL', 'E2E_EDGE_URL', 'E2E_SUPABASE_URL']) {
      expect(source).toMatch(new RegExp(`requireLocalHosts\\(\\{[^}]*${name}:`));
    }
  });

  it('never puts the link token in a navigation URL (page.goto prints it)', () => {
    expect(source).not.toMatch(/\.goto\([^)]*#\$\{/);
    expect(source).not.toMatch(/\.goto\([^)]*token/i);
    expect(source).toMatch(/\.openLink\(/);
  });

  it('never fills the one-time code (a fill step title is the typed text)', () => {
    expect(source).not.toMatch(/\.fill\(\s*otp\b/);
    expect(source).toMatch(/typeQuietly\([^;]*otp\.code\)/);
  });
});
