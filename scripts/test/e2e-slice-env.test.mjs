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
