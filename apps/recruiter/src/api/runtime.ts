// What the signed-in screens need from the outside world, supplied once by main.tsx (and by tests):
// the api origin, `fetch`, a way to read the current access token, and the narrow supabase slice that the
// sign-in flow already uses (own memberships, the member directory). Without it the app shows "not configured".
import { createContext, useContext } from 'react';
import type { ApiClient, FetchLike } from './client';
import type { RecruiterSupabase } from '../auth/supabase-client';

export interface Runtime {
  /** VITE_API_ORIGIN. */
  origin: string;
  fetch: FetchLike;
  getAccessToken(): Promise<string | null>;
  supabase: RecruiterSupabase;
}

export const RuntimeContext = createContext<Runtime | null>(null);

/** The api client for the signed-in org, or null when the shell has not built one. */
export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient | null {
  return useContext(ApiContext);
}

/** The signed-in org and the caller's roles in it (UX gating only; the server decides). */
export interface OrgInfo {
  orgId: string;
  orgName: string;
  userId: string;
  roles: readonly string[];
}

export const OrgInfoContext = createContext<OrgInfo | null>(null);

export function useOrgInfo(): OrgInfo | null {
  return useContext(OrgInfoContext);
}

/** Reads `data.session.access_token` from a supabase-js `getSession()` result; null if absent. */
export function accessTokenOf(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null;
  const data = (result as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;
  const session = (data as { session?: unknown }).session;
  if (typeof session !== 'object' || session === null) return null;
  const token = (session as { access_token?: unknown }).access_token;
  return typeof token === 'string' && token !== '' ? token : null;
}
