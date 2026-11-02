// e2e/support (specs/d1-demo-slice.md §7.2; review D1-SEC-1, D1-SEC-3): the rule 7 on-screen text pattern
// (support/report.ts) and the staging origin pin (support/slice-env.ts). Fakes only: an in-memory environment,
// no network, no browser. Synthetic values only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NEVER_BUILD_TEXT } from '../../e2e/support/report.ts';
import { readSliceEnv, STAGING_ORIGINS } from '../../e2e/support/slice-env.ts';

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

// D1-SPEC-3 (AT-D11(b), spec §7.2 step 10): with A's token, B's stream id is refused 400 by A's own object. That
// check must run while A's session is still running: once A has submitted, A's object answers `closed` (410) to any
// events batch before it looks at the stream id (workers/edge/src/session-core.ts `events`), so a request after the
// submit would prove nothing about the stream id. The slice spec therefore sends it from A's own flow, before submit.
describe('e2e/tests/d1-slice.spec.ts sends B’s stream id with A’s token (D1-SPEC-3)', () => {
  const source = readFileSync(path.join(REPO, 'e2e/tests/d1-slice.spec.ts'), 'utf8');
  const refusal =
    /expectRefusal\(\s*await edge\.sessionPost\(\s*`\/v1\/session\/events[^`]*`,\s*a\.sessionToken,\s*\{\s*streamId: b\.view\.streamId,[\s\S]*?\),\s*400,\s*'bad_request',/;

  it('posts events with A’s token and B’s streamId and expects 400 bad_request', () => {
    expect(source).toMatch(refusal);
  });

  it('does so in a candidate flow step that runs before that candidate submits (a submitted session answers 410)', () => {
    // The request sits in an `extra` step, which the flow runs after the reload and before 'submits and sees the receipt only'.
    expect(source).toMatch(
      /extra: \{\s*\/\/[^\n]*\n\s*name: [^\n]*stream id[^\n]*\n\s*body: async \(\) => \{[\s\S]*?streamId: b\.view\.streamId/,
    );
    const runs = source.indexOf('await cstep(key, extra.name');
    expect(runs).toBeGreaterThan(-1);
    expect(source.indexOf("'submits and sees the receipt only'", runs)).toBeGreaterThan(runs);
  });
});

// D1-SEC-3 (a): the staging run reaches only the five pinned origins (SEC-W5-6), so it can never touch production.
describe('readSliceEnv under E2E_STAGING=1 (the five-origin pin, D1-SEC-3)', () => {
  const enc = (s) => Buffer.from(s).toString('base64url');
  // Key-shaped values are built at run time (the pre-commit gitleaks hook rejects secret-shaped literals).
  const staging = () => ({
    E2E_STAGING: '1',
    ...STAGING_ORIGINS,
    E2E_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${enc('synthetic-publishable-key-value')}`,
    E2E_RECRUITER_EMAIL: 'recruiter@example.test',
    E2E_RECRUITER_PASSWORD: `${enc('synthetic-recruiter-password')}-Aa1`,
    E2E_RECRUITER_TOTP_SECRET: 'ABCDEFGH'.repeat(2),
    E2E_REVIEWER_EMAIL: 'reviewer@example.test',
    E2E_REVIEWER_PASSWORD: `${enc('synthetic-reviewer-password')}-Aa1`,
    E2E_REVIEWER_TOTP_SECRET: 'STUVWXYZ'.repeat(2),
    E2E_SHA: 'c'.repeat(40),
  });
  const ORIGIN_NAMES = [
    'E2E_CANDIDATE_URL',
    'E2E_RECRUITER_URL',
    'E2E_API_URL',
    'E2E_EDGE_URL',
    'E2E_SUPABASE_URL',
  ];
  /** A near miss for each pinned origin: right in spirit, wrong as a host. */
  const NEAR_MISS = {
    E2E_CANDIDATE_URL: 'https://trace-candidate-staging.pages.dev.evil.test',
    E2E_RECRUITER_URL: 'https://trace-recruiter.pages.dev',
    E2E_API_URL: 'https://trace-api.abhayraj.workers.dev',
    E2E_EDGE_URL: 'https://trace-edge-staging.abhayraj.workers.dev.evil.test',
    E2E_SUPABASE_URL: `https://${'a'.repeat(20)}.supabase.co`,
  };

  let saved;
  beforeEach(() => {
    saved = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('E2E_')) delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  });

  const failure = (over) => {
    Object.assign(process.env, staging(), over);
    try {
      readSliceEnv();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return null;
  };

  it('pins five origins and the exact set is accepted', () => {
    expect(Object.keys(STAGING_ORIGINS).sort()).toEqual([...ORIGIN_NAMES].sort());
    Object.assign(process.env, staging());
    const read = readSliceEnv();
    expect(read.mode).toBe('staging');
    expect(read.api).toBe(STAGING_ORIGINS.E2E_API_URL);
    expect(read.edge).toBe(STAGING_ORIGINS.E2E_EDGE_URL);
    expect(read.supabaseUrl).toBe(STAGING_ORIGINS.E2E_SUPABASE_URL);
  });

  it('the pinned Supabase origin is a 20-character project ref', () => {
    expect(STAGING_ORIGINS.E2E_SUPABASE_URL).toMatch(/^https:\/\/[a-z]{20}\.supabase\.co$/);
  });

  it.each(ORIGIN_NAMES)(
    '%s: a near miss is refused, naming the variable and not the value',
    (name) => {
      const bad = NEAR_MISS[name];
      const message = failure({ [name]: bad });
      expect(message).toBe(`${name} is not the staging origin`);
      expect(message).not.toContain(new URL(bad).hostname);
    },
  );

  it.each(ORIGIN_NAMES)('%s: a local address is refused in staging mode', (name) => {
    expect(failure({ [name]: 'http://127.0.0.1:8788' })).toBe(`${name} is not the staging origin`);
  });
});
