// The environment contract of the D1 slice spec (tests/d1-slice.spec.ts; specs/d1-demo-slice.md §7.2). Every value
// is read once, checked, and kept in memory; a missing or malformed value fails fast with the variable's NAME only,
// never its value. The CI job maps its secrets to exactly these names (stream W6).
//
// Common:  E2E_CANDIDATE_URL, E2E_RECRUITER_URL, E2E_API_URL, E2E_EDGE_URL, E2E_SUPABASE_URL,
//          E2E_SUPABASE_PUBLISHABLE_KEY
// Local:   E2E_LOCAL=1, E2E_RECRUITER_EMAIL, E2E_REVIEWER_EMAIL, E2E_USER_PASSWORD, E2E_ORG_ID
//          (users not yet TOTP-enrolled: the app's own enrolment screen; E2E_DB_CONTAINER optional, extra db checks)
// Staging: E2E_STAGING=1, E2E_RECRUITER_EMAIL, E2E_RECRUITER_PASSWORD, E2E_RECRUITER_TOTP_SECRET,
//          E2E_REVIEWER_EMAIL, E2E_REVIEWER_PASSWORD, E2E_REVIEWER_TOTP_SECRET (users already enrolled: the
//          challenge screen); the org id is read from the recruiter's own memberships, not from a variable.
// Optional: E2E_SHA (manifest), E2E_RECORD=1 (record mode).
import { requireLocalHosts } from './http.js';

export type SliceMode = 'local' | 'staging';

export interface UiUser {
  email: string;
  password: string;
  /** The base32 TOTP secret of an enrolled user (staging), or null to enrol through the app's screen (local). */
  totpSecret: string | null;
}

export interface SliceEnv {
  mode: SliceMode;
  candidateUrl: string;
  recruiterUrl: string;
  api: string;
  edge: string;
  supabaseUrl: string;
  publishableKey: string;
  recruiter: UiUser;
  reviewer: UiUser;
  /** Local only: the org e2e-local created (cross-checked against the recruiter's memberships). */
  orgId: string | null;
  /** Local only: the database container for the optional psql checks (support/db.ts). */
  dbContainer: string | null;
}

export const sliceMode = (): SliceMode | null =>
  process.env['E2E_STAGING'] === '1'
    ? 'staging'
    : process.env['E2E_LOCAL'] === '1'
      ? 'local'
      : null;

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name} is not set`);
  return value.trim();
};
/** A password: used exactly as given (no trimming). */
const needRaw = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};
const optional = (name: string): string | null => {
  const value = process.env[name]?.trim();
  return value === undefined || value === '' ? null : value;
};

/** An origin without a trailing slash; the error names the variable only. */
const origin = (name: string): string => {
  const raw = need(name);
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
    return url.origin;
  } catch {
    throw new Error(`${name} is not an http(s) URL`);
  }
};

const BASE32 = /^[A-Z2-7]{16,128}=*$/i;

/**
 * Staging guard (never production): every origin is https, and the four Trace origins name a staging host. The error
 * names the variable, never the value.
 */
const requireStagingHosts = (origins: Record<string, string>, traceHosts: readonly string[]) => {
  for (const [name, value] of Object.entries(origins)) {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error(`${name} must be an https URL on staging`);
    if (traceHosts.includes(name) && !url.hostname.toLowerCase().includes('staging')) {
      throw new Error(`${name} must be a staging host`);
    }
  }
};

export const readSliceEnv = (): SliceEnv => {
  const mode = sliceMode();
  if (mode === null) throw new Error('set E2E_LOCAL=1 or E2E_STAGING=1');
  const origins = {
    E2E_CANDIDATE_URL: origin('E2E_CANDIDATE_URL'),
    E2E_RECRUITER_URL: origin('E2E_RECRUITER_URL'),
    E2E_API_URL: origin('E2E_API_URL'),
    E2E_EDGE_URL: origin('E2E_EDGE_URL'),
    E2E_SUPABASE_URL: origin('E2E_SUPABASE_URL'),
  };
  const publishableKey = need('E2E_SUPABASE_PUBLISHABLE_KEY');
  let recruiter: UiUser;
  let reviewer: UiUser;
  if (mode === 'local') {
    requireLocalHosts(origins);
    const password = needRaw('E2E_USER_PASSWORD');
    recruiter = { email: need('E2E_RECRUITER_EMAIL'), password, totpSecret: null };
    reviewer = { email: need('E2E_REVIEWER_EMAIL'), password, totpSecret: null };
  } else {
    requireStagingHosts(origins, [
      'E2E_CANDIDATE_URL',
      'E2E_RECRUITER_URL',
      'E2E_API_URL',
      'E2E_EDGE_URL',
    ]);
    const secret = (name: string) => {
      const value = need(name).replace(/\s/g, '');
      if (!BASE32.test(value)) throw new Error(`${name} is not a base32 TOTP secret`);
      return value;
    };
    recruiter = {
      email: need('E2E_RECRUITER_EMAIL'),
      password: needRaw('E2E_RECRUITER_PASSWORD'),
      totpSecret: secret('E2E_RECRUITER_TOTP_SECRET'),
    };
    reviewer = {
      email: need('E2E_REVIEWER_EMAIL'),
      password: needRaw('E2E_REVIEWER_PASSWORD'),
      totpSecret: secret('E2E_REVIEWER_TOTP_SECRET'),
    };
  }
  if (recruiter.email.toLowerCase() === reviewer.email.toLowerCase()) {
    throw new Error('E2E_RECRUITER_EMAIL and E2E_REVIEWER_EMAIL must name different users');
  }
  return {
    mode,
    candidateUrl: origins.E2E_CANDIDATE_URL,
    recruiterUrl: origins.E2E_RECRUITER_URL,
    api: origins.E2E_API_URL,
    edge: origins.E2E_EDGE_URL,
    supabaseUrl: origins.E2E_SUPABASE_URL,
    publishableKey,
    recruiter,
    reviewer,
    orgId: mode === 'local' ? need('E2E_ORG_ID') : null,
    dbContainer: mode === 'local' ? optional('E2E_DB_CONTAINER') : null,
  };
};
