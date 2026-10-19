// Recruiter sign-in for the API-level E2E specs, straight through the local GoTrue (prior art:
// scripts/test-auth-local.mjs): password grant (aal1), TOTP enrol + challenge + verify (aal2). The TOTP secret and
// the tokens stay in this process; nothing here prints one.
import type { APIRequestContext } from '@playwright/test';
import { jsonOf } from './http.js';
import { totp } from './totp.js';

export interface Claims {
  sub?: string;
  aal?: string;
  role?: string;
  amr?: { method?: string }[];
}

/** The payload of a JWT that came straight from GoTrue (no signature check; the api verifies it). */
export const claimsOf = (jwt: string): Claims => {
  const part = jwt.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Claims;
};

/** The sorted, de-duplicated amr methods. */
export const amrOf = (claims: Claims): string[] =>
  [...new Set((claims.amr ?? []).map((a) => a.method ?? ''))].sort();

export interface SignIn {
  supabaseUrl: string;
  publishableKey: string;
  email: string;
  password: string;
}

/** Signs in with the password, enrols a TOTP factor and verifies it; returns the aal2 access token. */
export const signInWithTotp = async (request: APIRequestContext, who: SignIn): Promise<string> => {
  const auth = `${who.supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  const apikey = { apikey: who.publishableKey };
  const pw = await jsonOf<{ access_token?: string }>(
    await request.post(`${auth}/token?grant_type=password`, {
      headers: apikey,
      data: { email: who.email, password: who.password },
    }),
    200,
    'password sign-in',
  );
  const t1 = pw.access_token;
  if (typeof t1 !== 'string') throw new Error('password sign-in: no access token');
  if (claimsOf(t1).aal !== 'aal1') throw new Error('password sign-in: not aal1');
  const authed = { ...apikey, Authorization: `Bearer ${t1}` };
  const factor = await jsonOf<{ id?: string; totp?: { secret?: string } }>(
    await request.post(`${auth}/factors`, { headers: authed, data: { factor_type: 'totp' } }),
    200,
    'TOTP enrolment',
  );
  const factorId = factor.id;
  const secret = factor.totp?.secret;
  if (typeof factorId !== 'string' || typeof secret !== 'string') {
    throw new Error('TOTP enrolment: no factor id or secret');
  }
  const challenge = await jsonOf<{ id?: string }>(
    await request.post(`${auth}/factors/${factorId}/challenge`, { headers: authed, data: {} }),
    200,
    'TOTP challenge',
  );
  if (typeof challenge.id !== 'string') throw new Error('TOTP challenge: no challenge id');
  const verified = await jsonOf<{ access_token?: string }>(
    await request.post(`${auth}/factors/${factorId}/verify`, {
      headers: authed,
      data: { challenge_id: challenge.id, code: totp(secret) },
    }),
    200,
    'TOTP verification',
  );
  const t2 = verified.access_token;
  if (typeof t2 !== 'string') throw new Error('TOTP verification: no access token');
  return t2;
};
