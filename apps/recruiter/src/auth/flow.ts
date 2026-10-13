// The recruiter sign-in state machine (specs/m0b-tenancy.md §4.6), the flows of §4.2 and the
// assurance rules of §2.2. It holds no server text: every supabase-js result is reduced to
// "worked" or "did not work" in `attempt`, and errors become one of a few fixed kinds that the
// view maps to generic messages. Inputs are checked with the §4.5 contracts before any call, and
// rows are parsed with the strict §4.5 row contracts; a row that fails is "no organisation".
import {
  MembershipRow,
  OrgRow,
  OtpCode,
  Password,
  SignInEmail,
  TotpCode,
  type OrgRole,
} from '@trace/shared/contracts/tenancy';
import type { ClientStorage, Outcome, RecruiterSupabase } from './supabase-client';

/** Exactly the §4.5 `MembershipRow` columns (no `*`: finding B0-SP5). */
export const MEMBERSHIP_COLUMNS =
  'id,org_id,user_id,roles,workspace_id,team_id,display_name,status';
/** Exactly the §4.5 `OrgRow` columns. */
export const ORG_COLUMNS = 'id,name,slug,kind,status';
/** The org picked in the org picker; it only filters the UI (§2.1, S21). */
export const ORG_CHOICE_KEY = 'trace.recruiter.org_id';

/** §2.2: a membership holding any of these counts only at aal2. */
const PRIVILEGED_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>(['org_owner', 'admin', 'reviewer']);
/** §2.2: first factors that let a recruiter/hiring_manager membership count at aal1. */
const OTP_METHODS: ReadonlySet<string> = new Set(['otp', 'magiclink']);
/** supabase-js returns the enrolment QR as an SVG data URL; anything else is not shown. */
const SVG_DATA_URL = /^data:image\/svg\+xml[;,]/;

/** The only error information the UI ever gets. */
export type AuthErrorKind =
  'code' | 'generic' | 'invalid_email' | 'invalid_code' | 'invalid_password';

export type AuthState =
  | { kind: 'unconfigured' }
  | { kind: 'starting' }
  | { kind: 'signed_out'; error?: AuthErrorKind }
  | { kind: 'code_sent'; email: string; error?: AuthErrorKind }
  | { kind: 'session_aal1'; error?: AuthErrorKind }
  | {
      kind: 'totp_enrol';
      factorId: string;
      /** The QR as an SVG data URL, or null when Supabase returned anything else. */
      qrCode: string | null;
      secret: string;
      error?: AuthErrorKind;
    }
  | { kind: 'totp_challenge'; factorId: string; error?: AuthErrorKind }
  | { kind: 'session_aal2'; error?: AuthErrorKind }
  | { kind: 'no_org' }
  | { kind: 'org_picker'; orgs: OrgRow[] }
  | { kind: 'signed_in'; org: OrgRow };

export interface AuthSnapshot {
  readonly state: AuthState;
  /** A step is running: the view disables its buttons. */
  readonly busy: boolean;
}

type Show = (state: AuthState) => void;
/** True while the running step is still the latest one (no sign-out or newer step since). */
type Current = () => boolean;
/** What a stale step returns; `step` drops it, so the value never reaches the view. */
const STALE: AuthState = { kind: 'signed_out' };
type Stage = 'session_aal1' | 'session_aal2';

/** Runs one supabase-js call; the data when it worked, else null. Error text is never read. */
async function attempt<T>(call: () => PromiseLike<Outcome<T>>): Promise<{ data: T } | null> {
  try {
    const { data, error } = await call();
    return error === null || error === undefined ? { data } : null;
  } catch {
    return null;
  }
}

/** The part of a zod schema `parseRows` uses. */
interface RowSchema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

/** Every row parsed with `schema`, or null if the data is not an array or any row fails. */
function parseRows<T>(schema: RowSchema<T>, data: unknown): T[] | null {
  if (!Array.isArray(data)) return null;
  const rows: T[] = [];
  for (const row of data) {
    const parsed = schema.safeParse(row);
    if (!parsed.success) return null;
    rows.push(parsed.data);
  }
  return rows;
}

function clearError(state: AuthState): AuthState {
  if (!('error' in state)) return state;
  const copy: { error?: AuthErrorKind } = { ...state };
  delete copy.error;
  return copy as AuthState;
}

function methodNames(entries: readonly ({ method: string } | string)[]): string[] {
  return entries.map((entry) => (typeof entry === 'string' ? entry : entry.method));
}

export class AuthFlow {
  private readonly client: RecruiterSupabase | null;
  private readonly storage: ClientStorage;
  private readonly listeners = new Set<() => void>();
  private snapshot: AuthSnapshot;
  /** Bumped by every step and by sign-out, so a step that finishes late changes nothing. */
  private epoch = 0;

  constructor(client: RecruiterSupabase | null, storage: ClientStorage) {
    this.client = client;
    this.storage = storage;
    this.snapshot = {
      state: client === null ? { kind: 'unconfigured' } : { kind: 'starting' },
      busy: false,
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): AuthSnapshot => this.snapshot;

  private set(state: AuthState, busy: boolean): void {
    this.snapshot = { state, busy };
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * Runs `body` when the current state is one of `from` and nothing else is running. The state
   * stays (without its old error) while the step runs; `body` returns the next state.
   */
  private async step(
    from: readonly AuthState['kind'][],
    body: (client: RecruiterSupabase, show: Show, current: Current) => Promise<AuthState>,
  ): Promise<void> {
    const client = this.client;
    if (client === null || this.snapshot.busy || !from.includes(this.snapshot.state.kind)) return;
    const epoch = ++this.epoch;
    const current = () => epoch === this.epoch;
    this.set(clearError(this.snapshot.state), true);
    const show: Show = (state) => {
      if (current()) this.set(state, true);
    };
    const next = await body(client, show, current);
    if (current()) this.set(next, false);
    else await this.discardLateSession(client);
  }

  /**
   * A sign-in call that was still running when the person signed out may have stored a session
   * after sign-out cleared storage. Clear it again whenever the current state holds no session
   * (signed_out, code_sent, unconfigured), even if a newer step is already running: that step
   * is a pre-session one (an email code) or must create its own session anyway.
   */
  private async discardLateSession(client: RecruiterSupabase): Promise<void> {
    const kind = this.snapshot.state.kind;
    if (kind !== 'signed_out' && kind !== 'code_sent' && kind !== 'unconfigured') return;
    await attempt(async () => ({ data: null, ...(await client.auth.signOut()) }));
    this.clearStorage();
  }

  private clearStorage(): void {
    try {
      this.storage.clear();
    } catch {
      // Storage can be unavailable (private mode); there is then nothing to clear.
    }
  }

  /** Reads a stored session once at start-up; none → signed_out. */
  start(): Promise<void> {
    return this.step(['starting'], async (client, show, current) => {
      const stored = await attempt(() => client.auth.getSession());
      if (stored === null) return { kind: 'signed_out', error: 'generic' };
      if (!stored.data?.session) return { kind: 'signed_out' };
      show({ kind: 'session_aal1' });
      return this.resolve(client, show, current, 'session_aal1');
    });
  }

  /** Email OTP, part 1 (§4.2): send a code to an existing user only. */
  submitEmail(rawEmail: string): Promise<void> {
    return this.step(['signed_out'], async (client) => {
      const input = SignInEmail.safeParse({ email: rawEmail.trim() });
      if (!input.success) return { kind: 'signed_out', error: 'invalid_email' };
      const { email } = input.data;
      const sent = await attempt(() =>
        client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }),
      );
      return sent ? { kind: 'code_sent', email } : { kind: 'signed_out', error: 'generic' };
    });
  }

  /** Email OTP, part 2 (§4.2): verify the 6-digit code. */
  submitOtp(rawCode: string): Promise<void> {
    const state = this.snapshot.state;
    if (state.kind !== 'code_sent') return Promise.resolve();
    const { email } = state;
    return this.step(['code_sent'], async (client, show, current) => {
      const code = OtpCode.safeParse(rawCode.trim());
      if (!code.success) return { kind: 'code_sent', email, error: 'invalid_code' };
      const verified = await attempt(() =>
        client.auth.verifyOtp({ email, token: code.data, type: 'email' }),
      );
      if (!verified) return { kind: 'code_sent', email, error: 'code' };
      show({ kind: 'session_aal1' });
      return this.resolve(client, show, current, 'session_aal1');
    });
  }

  /** Password sign-in (§4.2); the resolution then always asks for TOTP (§2.2). */
  submitPassword(rawEmail: string, rawPassword: string): Promise<void> {
    return this.step(['signed_out'], async (client, show, current) => {
      const input = SignInEmail.safeParse({ email: rawEmail.trim() });
      if (!input.success) return { kind: 'signed_out', error: 'invalid_email' };
      const password = Password.safeParse(rawPassword);
      if (!password.success) return { kind: 'signed_out', error: 'invalid_password' };
      const signedIn = await attempt(() =>
        client.auth.signInWithPassword({ email: input.data.email, password: password.data }),
      );
      if (!signedIn) return { kind: 'signed_out', error: 'generic' };
      show({ kind: 'session_aal1' });
      return this.resolve(client, show, current, 'session_aal1');
    });
  }

  /** TOTP (§4.2): verify a code for the enrolled or the existing factor, then resolve at aal2. */
  submitTotp(rawCode: string): Promise<void> {
    const state = this.snapshot.state;
    if (state.kind !== 'totp_enrol' && state.kind !== 'totp_challenge') return Promise.resolve();
    const base = clearError(state);
    return this.step([state.kind], async (client, show, current) => {
      const code = TotpCode.safeParse(rawCode.trim());
      if (!code.success) return { ...base, error: 'invalid_code' } as AuthState;
      const verified = await attempt(() =>
        client.auth.mfa.challengeAndVerify({ factorId: state.factorId, code: code.data }),
      );
      if (!verified) return { ...base, error: 'code' } as AuthState;
      show({ kind: 'session_aal2' });
      return this.resolve(client, show, current, 'session_aal2');
    });
  }

  /** Org picker → signed_in; the choice is kept in sessionStorage for a reload. */
  pickOrg(orgId: string): Promise<void> {
    const state = this.snapshot.state;
    if (state.kind !== 'org_picker') return Promise.resolve();
    return this.step(['org_picker'], async () => {
      const org = state.orgs.find((candidate) => candidate.id === orgId);
      if (org === undefined) return state;
      try {
        this.storage.setItem(ORG_CHOICE_KEY, org.id);
      } catch {
        // Without storage the choice lasts until a reload; nothing else depends on it.
      }
      return { kind: 'signed_in', org };
    });
  }

  /** After a generic error during resolution, run it again. */
  retry(): Promise<void> {
    const state = this.snapshot.state;
    if (state.kind !== 'session_aal1' && state.kind !== 'session_aal2') return Promise.resolve();
    const stage = state.kind;
    return this.step([stage], (client, show, current) =>
      this.resolve(client, show, current, stage),
    );
  }

  /** Any state → signed_out (§4.6). sessionStorage is cleared even if the server call fails. */
  async signOut(): Promise<void> {
    const client = this.client;
    if (client === null) return;
    const epoch = ++this.epoch;
    this.set({ kind: 'signed_out' }, true);
    await attempt(async () => ({ data: null, ...(await client.auth.signOut()) }));
    this.clearStorage();
    if (epoch === this.epoch) this.set({ kind: 'signed_out' }, false);
  }

  /** From a session: own memberships → TOTP if §2.2 needs aal2 → the visible orgs (§4.6). */
  private async resolve(
    client: RecruiterSupabase,
    show: Show,
    current: Current,
    from: Stage,
  ): Promise<AuthState> {
    let stage: Stage = from;
    const failed = (): AuthState => ({ kind: stage, error: 'generic' });

    // Every network call below is preceded by this check: after sign-out (or a newer step) the
    // rest of the resolution must not run, or it could enrol a factor on a signed-out account.
    if (!current()) return STALE;
    const session = await attempt(() => client.auth.getSession());
    if (session === null) return failed();
    const userId = session.data?.session?.user.id;
    if (userId === undefined) return { kind: 'signed_out' };

    if (!current()) return STALE;
    const assurance = await attempt(() => client.auth.mfa.getAuthenticatorAssuranceLevel());
    if (!assurance?.data) return failed();
    const aal2 = assurance.data.currentLevel === 'aal2';
    const methods = methodNames(assurance.data.currentAuthenticationMethods);
    stage = aal2 ? 'session_aal2' : 'session_aal1';
    show({ kind: stage });

    // Own rows are readable at any aal (§2.2 exception), so "needs TOTP" differs from "no org".
    if (!current()) return STALE;
    const ownRows = await attempt(() =>
      client.from('memberships').select(MEMBERSHIP_COLUMNS).eq('user_id', userId),
    );
    if (ownRows === null) return failed();
    const memberships = parseRows(MembershipRow, ownRows.data);
    if (memberships === null) return { kind: 'no_org' };
    const active = memberships.filter((m) => m.status === 'active' && m.user_id === userId);
    if (active.length === 0) return { kind: 'no_org' };

    // Fails closed: an empty list or any method that is not a known OTP method needs TOTP.
    const otpOnly = methods.length > 0 && methods.every((m) => OTP_METHODS.has(m));
    const privileged = active.some((m) => m.roles.some((role) => PRIVILEGED_ROLES.has(role)));
    if (!current()) return STALE; // covers the factor calls and the orgs read below
    if (!aal2 && (privileged || !otpOnly)) return this.totp(client, current, failed);

    const orgIds = [...new Set(active.map((m) => m.org_id))];
    const orgRows = await attempt(() => client.from('orgs').select(ORG_COLUMNS).in('id', orgIds));
    if (orgRows === null) return failed();
    const orgs = parseRows(OrgRow, orgRows.data);
    if (orgs === null) return { kind: 'no_org' };
    const visible = [
      ...new Map(
        orgs
          .filter((o) => o.status === 'active' && orgIds.includes(o.id))
          .map((o) => [o.id, o] as const),
      ).values(),
    ].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

    const [only, ...rest] = visible;
    if (only === undefined) return { kind: 'no_org' };
    if (rest.length === 0) return { kind: 'signed_in', org: only };
    const chosen = visible.find((o) => o.id === this.storedChoice());
    return chosen ? { kind: 'signed_in', org: chosen } : { kind: 'org_picker', orgs: visible };
  }

  /** aal2 is needed: challenge an existing verified factor, or enrol a new one (§4.2). */
  private async totp(
    client: RecruiterSupabase,
    current: Current,
    failed: () => AuthState,
  ): Promise<AuthState> {
    const factors = await attempt(() => client.auth.mfa.listFactors());
    if (!factors?.data) return failed();
    const existing = factors.data.totp[0];
    if (existing !== undefined) return { kind: 'totp_challenge', factorId: existing.id };
    if (!current()) return STALE;
    const enrolled = await attempt(() => client.auth.mfa.enroll({ factorType: 'totp' }));
    if (!enrolled?.data) return failed();
    const { id, totp } = enrolled.data;
    return {
      kind: 'totp_enrol',
      factorId: id,
      qrCode: SVG_DATA_URL.test(totp.qr_code) ? totp.qr_code : null,
      secret: totp.secret,
    };
  }

  private storedChoice(): string | null {
    try {
      return this.storage.getItem(ORG_CHOICE_KEY);
    } catch {
      return null;
    }
  }
}
