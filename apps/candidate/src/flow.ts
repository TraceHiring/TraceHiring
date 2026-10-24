// The candidate step machine (specs/d1-demo-slice.md §4.1 step order, §4.7): a pure reducer, no router. Steps:
// resolving, unavailable, otp, age, blocked, consent, photo, rules, test, submitted, error. The link and lobby tokens
// live in this state (memory only). The order is a convenience: the edge and api re-check every step.
import type {
  InviteResolveRes,
  LobbyNext,
  Receipt,
  SessionStartReq,
} from '@trace/shared/contracts/candidate';
import type { AnyView } from './api';
import type { Boot } from './boot';

export type PhotoChoice = SessionStartReq['photo'];

export type UnavailableWhy =
  'no_link' | 'invalid' | 'expired' | 'revoked' | 'submitted' | 'closed' | 'config';

export type ErrorWhy = 'superseded' | 'invalid' | 'network' | 'step' | 'generic' | 'rate_limited';

export type Step =
  | { name: 'resolving' }
  | { name: 'unavailable'; why: UnavailableWhy }
  | { name: 'otp'; title?: string; durationMinutes?: number }
  | { name: 'age' }
  | { name: 'blocked' }
  | { name: 'consent' }
  | { name: 'photo' }
  | { name: 'rules'; photo: PhotoChoice }
  | { name: 'test'; sessionToken: string; view: AnyView; offsetMs: number }
  | { name: 'submitted'; receipt: Receipt }
  /** `waitSeconds`: with `rate_limited`, how long "Try again" stays disabled (the edge's Retry-After). */
  | { name: 'error'; why: ErrorWhy; retry: boolean; waitSeconds?: number };

export type StepName = Step['name'];

export interface FlowState {
  step: Step;
  lobbyToken: string | null;
}

export type Action =
  | { type: 'resolving' }
  | { type: 'resolved'; res: InviteResolveRes }
  | { type: 'lobby'; lobbyToken: string; next: LobbyNext }
  | { type: 'adult' }
  | { type: 'blocked' }
  | { type: 'consented' }
  | { type: 'photo'; photo: PhotoChoice }
  | { type: 'session'; sessionToken: string; view: AnyView; offsetMs: number }
  | { type: 'receipt'; receipt: Receipt }
  | { type: 'unavailable'; why: UnavailableWhy }
  | { type: 'error'; why: ErrorWhy; retry?: boolean; waitSeconds?: number };

/**
 * The photo choice sent on a resume through a new login (`next: 'start'`, the session already began and this tab has
 * no stored session): the SessionDO stores the photo once, at creation, and ignores this on a resume (§4.5).
 */
export const RESUME_PHOTO: PhotoChoice = { skippedReason: 'declined' };

export const initialState = (boot: Boot): FlowState => {
  const lobbyToken = null;
  if (boot.origin === null) return { step: { name: 'unavailable', why: 'config' }, lobbyToken };
  if (boot.stored !== null || boot.linkToken !== null)
    return { step: { name: 'resolving' }, lobbyToken };
  return { step: { name: 'unavailable', why: boot.badLink ? 'invalid' : 'no_link' }, lobbyToken };
};

const afterResolve = (res: InviteResolveRes): Step => {
  switch (res.state) {
    case 'created':
    case 'sent':
    case 'otp_verified':
    case 'started':
      return {
        name: 'otp',
        ...(res.title === undefined ? {} : { title: res.title }),
        ...(res.durationMinutes === undefined ? {} : { durationMinutes: res.durationMinutes }),
      };
    case 'submitted':
      return { name: 'unavailable', why: 'submitted' };
    case 'expired':
      return { name: 'unavailable', why: 'expired' };
    case 'revoked':
      return { name: 'unavailable', why: 'revoked' };
    case 'blocked_age':
      return { name: 'blocked' };
  }
};

const afterLogin = (next: LobbyNext): Step => {
  switch (next) {
    case 'age':
      return { name: 'age' };
    case 'consent':
      return { name: 'consent' };
    case 'photo':
      return { name: 'photo' };
    case 'start':
      return { name: 'rules', photo: RESUME_PHOTO };
  }
};

export const reducer = (state: FlowState, action: Action): FlowState => {
  // A blocked candidate stays blocked (rule 9): no later action can move past it.
  if (state.step.name === 'blocked') return state;
  switch (action.type) {
    case 'resolving':
      return { ...state, step: { name: 'resolving' } };
    case 'resolved':
      return { ...state, step: afterResolve(action.res) };
    case 'lobby':
      return { lobbyToken: action.lobbyToken, step: afterLogin(action.next) };
    case 'adult':
      return { ...state, step: { name: 'consent' } };
    case 'blocked':
      // Nothing else is created: the lobby token is dropped too.
      return { lobbyToken: null, step: { name: 'blocked' } };
    case 'consented':
      return { ...state, step: { name: 'photo' } };
    case 'photo':
      return { ...state, step: { name: 'rules', photo: action.photo } };
    case 'session':
      if (action.view.receipt !== undefined) {
        return { lobbyToken: null, step: { name: 'submitted', receipt: action.view.receipt } };
      }
      return {
        lobbyToken: null,
        step: {
          name: 'test',
          sessionToken: action.sessionToken,
          view: action.view,
          offsetMs: action.offsetMs,
        },
      };
    case 'receipt':
      return { lobbyToken: null, step: { name: 'submitted', receipt: action.receipt } };
    case 'unavailable':
      return { lobbyToken: null, step: { name: 'unavailable', why: action.why } };
    case 'error':
      return {
        ...state,
        step: {
          name: 'error',
          why: action.why,
          retry: action.retry ?? false,
          ...(action.waitSeconds === undefined ? {} : { waitSeconds: action.waitSeconds }),
        },
      };
  }
};

/** `serverNow − midpoint(send, receive)` (§4.7): add to Date.now() to read the server clock. */
export const offsetOf = (serverNow: string, sentAt: number, receivedAt: number): number =>
  Math.round(Date.parse(serverNow) - (sentAt + receivedAt) / 2);
