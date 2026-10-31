// A fake `RecruiterSupabase` for the AT-B11 tests (specs/m0b-tenancy.md §7). No network: it keeps
// one session in memory, records every call, and answers PostgREST reads with the rows a test
// gives it (the rows RLS would return). Failures carry `ERROR_MARKER` in their text so tests can
// prove server error text is never rendered or logged. Synthetic data only.
import type {
  AuthEventListener,
  ClientStorage,
  EnrolData,
  Outcome,
  RecruiterSupabase,
  RowSelect,
} from '../supabase-client';

/** Text placed in every fake error; it must never reach the DOM, the state or the console. */
export const ERROR_MARKER = 'srv-marker-7f3a9c';

export const VALID_OTP = '246810';
export const VALID_TOTP = '135791';
/** A synthetic password that passes the `Password` contract (12–128 characters). */
export const VALID_PASSWORD = ['synthetic', 'pass', 'phrase'].join('-');

export const USER_ID = '00000000-0000-4000-8000-0000000000a1';
export const OTHER_USER_ID = '00000000-0000-4000-8000-0000000000b2';
export const FACTOR_ID = '00000000-0000-4000-8000-0000000000f1';
export const NEW_FACTOR_ID = '00000000-0000-4000-8000-0000000000f2';
export const QR_DATA_URL = 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"/>';
export const TOTP_SECRET = ['JBSW', 'Y3DP', 'EHPK', '3PXP'].join('');

export type FakeCall =
  | 'signInWithOtp'
  | 'verifyOtp'
  | 'signInWithPassword'
  | 'getSession'
  | 'signOut'
  | 'getAuthenticatorAssuranceLevel'
  | 'listFactors'
  | 'enroll'
  | 'challengeAndVerify'
  | 'select:memberships'
  | 'select:orgs';

export interface RecordedCall {
  call: FakeCall;
  args: unknown[];
}

export interface FakeOptions {
  /** A session already in storage when the app starts (a reload). */
  session?: { methods: string[]; aal: 'aal1' | 'aal2' };
  /** Verified TOTP factor ids. */
  verifiedFactors?: string[];
  /** Rows `memberships` returns (what RLS lets the user read: their own rows). */
  memberships?: unknown[];
  /** Rows `orgs` returns before the `in('id', …)` filter (what RLS lets the user read). */
  orgs?: unknown[];
  /** Calls that fail, with an error object or by throwing. */
  fail?: Partial<Record<FakeCall, 'error' | 'throw'>>;
  /** amr shape: entries `{ method }` (default) or bare strings, both typed by supabase-js. */
  amrAsStrings?: boolean;
}

const markerError = (call: FakeCall) => ({
  name: 'AuthApiError',
  message: `${ERROR_MARKER}: ${call} failed for someone@example.test`,
  status: 400,
  code: 'synthetic_failure',
});

export class FakeSupabase {
  readonly calls: RecordedCall[] = [];
  private session: { methods: string[]; aal: 'aal1' | 'aal2' } | null;
  private options: FakeOptions;
  private readonly gates = new Map<FakeCall, Promise<void>>();
  private readonly authListeners = new Set<AuthEventListener>();

  constructor(options: FakeOptions = {}) {
    this.options = options;
    this.session = options.session ?? null;
  }

  callsOf(call: FakeCall): unknown[][] {
    return this.calls.filter((c) => c.call === call).map((c) => c.args);
  }

  /** Makes every later call succeed (for retry tests). */
  heal(): void {
    this.options = { ...this.options, fail: {} };
  }

  /** Holds the next answers to `call` until the returned function is called. */
  hold(call: FakeCall): () => void {
    let release = (): void => undefined;
    this.gates.set(
      call,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return () => release();
  }

  /** How many `onAuthStateChange` subscriptions are live (M1 AT-M1-27). */
  get authListenerCount(): number {
    return this.authListeners.size;
  }

  /** Delivers a supabase-js auth event to every live subscription, as supabase-js would. */
  emit(event: string, session: { user: { id: string } } | null): void {
    for (const listener of [...this.authListeners]) listener(event, session);
  }

  get signedIn(): boolean {
    return this.session !== null;
  }

  /** Records the call, then fails it if the test asked for that. */
  private async run<T>(call: FakeCall, args: unknown[], ok: () => Outcome<T>): Promise<Outcome<T>> {
    this.calls.push({ call, args });
    await Promise.resolve();
    await this.gates.get(call);
    const mode = this.options.fail?.[call];
    if (mode === 'throw') throw new Error(markerError(call).message);
    if (mode === 'error') return { data: null as T, error: markerError(call) };
    return ok();
  }

  private codeError<T>(call: FakeCall): Outcome<T> {
    return { data: null as T, error: markerError(call) };
  }

  private rows(table: 'memberships' | 'orgs', columns: string): RowSelect {
    const call: FakeCall = table === 'memberships' ? 'select:memberships' : 'select:orgs';
    const all = (table === 'memberships' ? this.options.memberships : this.options.orgs) ?? [];
    return {
      eq: (column, value) =>
        this.run(call, [columns, 'eq', column, value], () => ({ data: [...all], error: null })),
      in: (column, values) =>
        this.run(call, [columns, 'in', column, [...values]], () => ({
          data: all.filter((row) => {
            const id = (row as { [key: string]: unknown })[column];
            return typeof id === 'string' && values.includes(id);
          }),
          error: null,
        })),
    };
  }

  readonly client: RecruiterSupabase = {
    auth: {
      signInWithOtp: (params) =>
        this.run('signInWithOtp', [params], () => ({ data: {}, error: null })),
      verifyOtp: (params) =>
        this.run('verifyOtp', [params], () => {
          if (params.token !== VALID_OTP) return this.codeError('verifyOtp');
          this.session = { methods: ['otp'], aal: 'aal1' };
          return { data: {}, error: null };
        }),
      signInWithPassword: (params) =>
        this.run('signInWithPassword', [params], () => {
          if (params.password !== VALID_PASSWORD) return this.codeError('signInWithPassword');
          this.session = { methods: ['password'], aal: 'aal1' };
          return { data: {}, error: null };
        }),
      getSession: () =>
        this.run('getSession', [], () => ({
          data: { session: this.session === null ? null : { user: { id: USER_ID } } },
          error: null,
        })),
      signOut: async () => {
        this.calls.push({ call: 'signOut', args: [] });
        await Promise.resolve();
        this.session = null;
        // supabase-js removes the local session and emits SIGNED_OUT even when the server call fails.
        this.emit('SIGNED_OUT', null);
        const mode = this.options.fail?.signOut;
        if (mode === 'throw') throw new Error(markerError('signOut').message);
        return { error: mode === 'error' ? markerError('signOut') : null };
      },
      onAuthStateChange: (callback) => {
        this.authListeners.add(callback);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                this.authListeners.delete(callback);
              },
            },
          },
        };
      },
      mfa: {
        getAuthenticatorAssuranceLevel: () =>
          this.run('getAuthenticatorAssuranceLevel', [], () => {
            if (this.session === null) return { data: null, error: markerError('getSession') };
            const methods = this.session.methods;
            return {
              data: {
                currentLevel: this.session.aal,
                currentAuthenticationMethods: this.options.amrAsStrings
                  ? [...methods]
                  : methods.map((method) => ({ method })),
              },
              error: null,
            };
          }),
        listFactors: () =>
          this.run('listFactors', [], () => ({
            data: { totp: (this.options.verifiedFactors ?? []).map((id) => ({ id })) },
            error: null,
          })),
        enroll: (params) =>
          this.run<EnrolData | null>('enroll', [params], () => ({
            data: { id: NEW_FACTOR_ID, totp: { qr_code: QR_DATA_URL, secret: TOTP_SECRET } },
            error: null,
          })),
        challengeAndVerify: (params) =>
          this.run('challengeAndVerify', [params], () => {
            if (params.code !== VALID_TOTP || this.session === null)
              return this.codeError('challengeAndVerify');
            this.session = { methods: [...this.session.methods, 'totp'], aal: 'aal2' };
            return { data: {}, error: null };
          }),
      },
    },
    from: (table) => ({ select: (columns) => this.rows(table, columns) }),
  };
}

/** An in-memory `sessionStorage`. */
export class MemoryStorage implements ClientStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

export const ORG_A = '00000000-0000-4000-8000-00000000000a';
export const ORG_B = '00000000-0000-4000-8000-00000000000b';
export const ORG_C = '00000000-0000-4000-8000-00000000000c';

/** A membership row with exactly the §4.5 columns. */
export function membership(
  orgId: string,
  roles: string[],
  status = 'active',
  overrides: { [key: string]: unknown } = {},
): { [key: string]: unknown } {
  const suffix = orgId.slice(-1);
  return {
    id: `00000000-0000-4000-8000-0000000001${suffix}0`,
    org_id: orgId,
    user_id: USER_ID,
    roles,
    workspace_id: null,
    team_id: null,
    display_name: `Synthetic member ${suffix}`,
    status,
    ...overrides,
  };
}

/** An org row with exactly the §4.5 columns. */
export function org(
  id: string,
  name: string,
  status = 'active',
  overrides: { [key: string]: unknown } = {},
): { [key: string]: unknown } {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    kind: 'customer',
    status,
    ...overrides,
  };
}
