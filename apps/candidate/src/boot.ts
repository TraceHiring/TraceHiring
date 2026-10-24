// What the app starts from (specs/d1-demo-slice.md §4.3, §4.7), read once before the first render: the link token
// from the URL fragment (`/i#<token>`), which is cleared with history.replaceState at once so it stays in memory
// only (never in history, a referrer or storage), a stored session for a reload, and the edge origin of this build.
import { EDGE_ORIGIN } from './config';
import { loadSession, type StoredSession } from './session-store';

export interface Boot {
  /** The raw link token, or null. */
  linkToken: string | null;
  /** True when the URL had a fragment that is not a link token. */
  badLink: boolean;
  stored: StoredSession | null;
  /** The edge origin, or null: the app then fails closed. */
  origin: string | null;
}

export const LINK_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** No link, no session, no origin: the "unavailable" screen. */
export const EMPTY_BOOT: Boot = { linkToken: null, badLink: false, stored: null, origin: null };

/** Reads and clears the fragment, and reads the stored session. Call once, outside React. */
export const readBoot = (): Boot => {
  const hash = globalThis.location?.hash ?? '';
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (hash !== '') {
    try {
      const { pathname, search } = globalThis.location;
      globalThis.history.replaceState(null, '', `${pathname}${search}`);
    } catch {
      // keep going: the token is still only in memory from here on
    }
  }
  const linkToken = LINK_TOKEN.test(fragment) ? fragment : null;
  return {
    linkToken,
    badLink: fragment !== '' && linkToken === null,
    stored: loadSession(),
    origin: EDGE_ORIGIN,
  };
};
