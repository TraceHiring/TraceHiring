// The session token, the stream id and a view snapshot live in sessionStorage (specs/d1-demo-slice.md §4.7), so a
// reload in the same tab can `attach` (RT-4, AT-D36). The link token and the lobby token never go here (memory
// only). Every access is wrapped: a browser that refuses storage simply loses the reload path.
import type { SessionView } from '@trace/shared/contracts/candidate';
import { isSessionView } from './api';

export const SESSION_KEY = 'trace.candidate.session';

export interface StoredSession {
  sessionToken: string;
  streamId: string;
  view: SessionView;
}

const JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const storage = (): Storage | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};

/**
 * Stores the token, the stream id and the view without its answers (SEC-2): answer text never sits in
 * sessionStorage, mid-test or after submit. A reload reads the answers back from the edge through `attach`.
 */
export const saveSession = (session: StoredSession): void => {
  try {
    const view: SessionView = { ...session.view, answers: [] };
    storage()?.setItem(SESSION_KEY, JSON.stringify({ ...session, view }));
  } catch {
    // storage full or refused: the reload path is lost, nothing else
  }
};

export const loadSession = (): StoredSession | null => {
  try {
    const raw = storage()?.getItem(SESSION_KEY);
    if (raw === null || raw === undefined) return null;
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null) return null;
    const { sessionToken, streamId, view } = value as Record<string, unknown>;
    if (typeof sessionToken !== 'string' || sessionToken.length > 2048 || !JWS.test(sessionToken))
      return null;
    if (typeof streamId !== 'string' || !isSessionView(view)) return null;
    return { sessionToken, streamId, view };
  } catch {
    return null;
  }
};

export const clearSession = (): void => {
  try {
    storage()?.removeItem(SESSION_KEY);
  } catch {
    // nothing to do
  }
};
