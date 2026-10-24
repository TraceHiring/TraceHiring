// AT-M1-27 (specs/m1-test-authoring.md §1.5, §12): the carried recruiter auth items.
// (a) M0b B2-SEC-1: plain http (loopback included) is refused unless the build is exactly `dev`.
// (b) M0b B2-SEC-4: the flow watches supabase-js auth events while any view is mounted, and an ended
//     session (SIGNED_OUT, or TOKEN_REFRESHED without a session) routes to sign-in.
// (c) FOUNDER-QUEUE 2026-10-13 (answered 10-15, "hide it"): the email-code step reads the same whether
//     or not the address has an account. Synthetic data only; no network.
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { routes } from '../routes';
import { AuthFlowContext } from './auth-context';
import { AuthPanel, AuthView, CODE_SENT_MESSAGE, type AuthActions } from './AuthPanel';
import { AuthFlow, ORG_CHOICE_KEY } from './flow';
import {
  createRecruiterSupabase,
  readApiOrigin,
  readSupabaseConfig,
  type ClientStorage,
} from './supabase-client';
import {
  FakeSupabase,
  MemoryStorage,
  ORG_A,
  ORG_B,
  VALID_OTP,
  membership,
  org,
  type FakeOptions,
} from './testing/fake-supabase';

/** A key-shaped string built at run time, so no literal key sits in the repo (gitleaks). */
const publishableKey = (): string => ['sb', 'publishable', 'synthetic', 'value'].join('_');
const HOSTED_URL = `https://${'abcdefghij'}${'klmnopqrst'}.supabase.co`;
const LOCAL_SUPABASE = 'http://127.0.0.1:54321';
const LOCAL_API = 'http://localhost:8788';
const STAGING_API = 'https://trace-api-staging.fixture-sub.workers.dev';
const EMAIL = 'recruiter.carried@example.test';
const NOT_DEV = [undefined, '', 'production', 'staging', 'Dev', ' dev', 'dev ', 'development'];

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

describe('(a) plain http only in a dev build (B2-SEC-1)', () => {
  it('accepts the local stack over http only when the build environment is exactly dev', () => {
    const key = publishableKey();
    for (const url of [LOCAL_SUPABASE, 'http://localhost:54321']) {
      expect(
        readSupabaseConfig({
          VITE_SUPABASE_URL: url,
          VITE_SUPABASE_PUBLISHABLE_KEY: key,
          traceEnv: 'dev',
        }),
      ).toEqual({ url, publishableKey: key });
      for (const traceEnv of NOT_DEV)
        expect(
          readSupabaseConfig({
            VITE_SUPABASE_URL: url,
            VITE_SUPABASE_PUBLISHABLE_KEY: key,
            traceEnv,
          }),
          `${url} with ${JSON.stringify(traceEnv)}`,
        ).toBeNull();
    }
  });

  it('still refuses http to a non-loopback host in a dev build, and accepts https in every build', () => {
    const key = publishableKey();
    expect(
      readSupabaseConfig({
        VITE_SUPABASE_URL: 'http://abcdefghijklmnopqrst.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: key,
        traceEnv: 'dev',
      }),
    ).toBeNull();
    for (const traceEnv of ['dev', ...NOT_DEV])
      expect(
        readSupabaseConfig({
          VITE_SUPABASE_URL: HOSTED_URL,
          VITE_SUPABASE_PUBLISHABLE_KEY: key,
          traceEnv,
        }),
      ).toEqual({ url: HOSTED_URL, publishableKey: key });
  });

  it('creates no client for a loopback http URL outside a dev build', () => {
    const factory = vi.fn();
    const storage: ClientStorage = new MemoryStorage();
    for (const traceEnv of NOT_DEV)
      expect(
        createRecruiterSupabase(
          {
            VITE_SUPABASE_URL: LOCAL_SUPABASE,
            VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey(),
            traceEnv,
          },
          storage,
          factory,
        ),
      ).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('applies the same rule to the api origin', () => {
    expect(readApiOrigin({ VITE_API_ORIGIN: STAGING_API })).toBe(STAGING_API);
    expect(readApiOrigin({ VITE_API_ORIGIN: ` ${STAGING_API} ` })).toBe(STAGING_API);
    expect(readApiOrigin({ VITE_API_ORIGIN: LOCAL_API, traceEnv: 'dev' })).toBe(LOCAL_API);
    for (const traceEnv of NOT_DEV)
      expect(readApiOrigin({ VITE_API_ORIGIN: LOCAL_API, traceEnv })).toBeNull();
    for (const bad of [
      undefined,
      '',
      '  ',
      'not a url',
      'http://trace-api.example.test',
      'ftp://127.0.0.1',
      'javascript:alert(1)',
    ])
      expect(readApiOrigin({ VITE_API_ORIGIN: bad, traceEnv: 'dev' }), String(bad)).toBeNull();
  });
});

const RECRUITER_ROWS: FakeOptions = {
  memberships: [membership(ORG_A, ['recruiter'])],
  orgs: [org(ORG_A, 'Acme')],
};
const RECRUITER_IN_A: FakeOptions = {
  ...RECRUITER_ROWS,
  session: { methods: ['otp'], aal: 'aal1' },
};

function signedInFlow(options: FakeOptions = RECRUITER_IN_A) {
  const fake = new FakeSupabase(options);
  const storage = new MemoryStorage();
  const flow = new AuthFlow(fake.client, storage);
  return { fake, storage, flow };
}

describe('(b) auth events end the signed-in UI (B2-SEC-4)', () => {
  it('watches auth events only while a view is subscribed, once, and stops on the last unmount', () => {
    const { fake, flow } = signedInFlow();
    expect(fake.authListenerCount).toBe(0);
    const first = flow.subscribe(() => undefined);
    const second = flow.subscribe(() => undefined);
    expect(fake.authListenerCount).toBe(1);
    first();
    expect(fake.authListenerCount).toBe(1);
    second();
    expect(fake.authListenerCount).toBe(0);
    // A remount (React StrictMode mounts twice) watches again.
    const again = flow.subscribe(() => undefined);
    expect(fake.authListenerCount).toBe(1);
    again();
    expect(fake.authListenerCount).toBe(0);
  });

  it('SIGNED_OUT while signed in → signed_out, storage cleared, and the panel shows sign-in', async () => {
    const { fake, storage, flow } = signedInFlow({
      ...RECRUITER_IN_A,
      memberships: [membership(ORG_A, ['recruiter']), membership(ORG_B, ['recruiter'])],
      orgs: [org(ORG_A, 'Acme'), org(ORG_B, 'Beta')],
    });
    const unsubscribe = flow.subscribe(() => undefined);
    await flow.start();
    await flow.pickOrg(ORG_A);
    expect(flow.getSnapshot().state.kind).toBe('signed_in');
    expect(storage.getItem(ORG_CHOICE_KEY)).toBe(ORG_A);

    fake.emit('SIGNED_OUT', null);
    expect(flow.getSnapshot()).toEqual({ state: { kind: 'signed_out' }, busy: false });
    expect(storage.getItem(ORG_CHOICE_KEY)).toBeNull();
    const html = renderToString(
      <AuthFlowContext value={flow}>
        <AuthPanel />
      </AuthFlowContext>,
    );
    expect(text(html)).toContain('Email me a code');
    unsubscribe();
  });

  it('a data page routes to sign-in once the session ends', async () => {
    const { fake, flow } = signedInFlow();
    const unsubscribe = flow.subscribe(() => undefined);
    await flow.start();
    expect(flow.getSnapshot().state.kind).toBe('signed_in');
    const renderTests = () =>
      text(
        renderToString(
          <AuthFlowContext value={flow}>
            <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/tests'] })} />
          </AuthFlowContext>,
        ),
      );
    expect(renderTests()).not.toContain('Sign in to continue');
    fake.emit('SIGNED_OUT', null);
    expect(renderTests()).toContain('Sign in to continue');
    unsubscribe();
  });

  it('a failed refresh (TOKEN_REFRESHED without a session) also routes to sign-in', async () => {
    const { fake, flow } = signedInFlow();
    const unsubscribe = flow.subscribe(() => undefined);
    await flow.start();
    fake.emit('TOKEN_REFRESHED', { user: { id: 'refreshed' } });
    expect(flow.getSnapshot().state.kind).toBe('signed_in');
    fake.emit('TOKEN_REFRESHED', null);
    expect(flow.getSnapshot().state).toEqual({ kind: 'signed_out' });
    unsubscribe();
  });

  it('ignores the events that do not end a session', async () => {
    const { fake, flow } = signedInFlow();
    const unsubscribe = flow.subscribe(() => undefined);
    await flow.start();
    const before = flow.getSnapshot();
    for (const event of ['INITIAL_SESSION', 'SIGNED_IN', 'USER_UPDATED', 'MFA_CHALLENGE_VERIFIED'])
      fake.emit(event, { user: { id: 'synthetic' } });
    fake.emit('INITIAL_SESSION', null);
    expect(flow.getSnapshot()).toBe(before);
    unsubscribe();
  });

  it('does not throw a person out of the email-code step when a late session is discarded', async () => {
    const { fake, flow } = signedInFlow({});
    const unsubscribe = flow.subscribe(() => undefined);
    await flow.start();
    await flow.submitEmail(EMAIL);
    expect(flow.getSnapshot().state.kind).toBe('code_sent');
    fake.emit('SIGNED_OUT', null);
    expect(flow.getSnapshot().state).toEqual({ kind: 'code_sent', email: EMAIL });
    unsubscribe();
  });

  it('a resolution still running when the session ends never brings the signed-in UI back', async () => {
    const { fake, flow } = signedInFlow(RECRUITER_ROWS);
    const unsubscribe = flow.subscribe(() => undefined);
    await flow.start();
    await flow.submitEmail(EMAIL);
    const release = fake.hold('select:orgs');
    const signingIn = flow.submitOtp(VALID_OTP);
    await vi.waitFor(() => expect(fake.callsOf('select:orgs')).toHaveLength(1));
    fake.emit('SIGNED_OUT', null);
    expect(flow.getSnapshot().state).toEqual({ kind: 'signed_out' });
    release();
    await signingIn;
    expect(flow.getSnapshot()).toEqual({ state: { kind: 'signed_out' }, busy: false });
    unsubscribe();
  });

  it('an unconfigured build watches nothing', () => {
    const flow = new AuthFlow(null, new MemoryStorage());
    const unsubscribe = flow.subscribe(() => undefined);
    expect(flow.getSnapshot().state.kind).toBe('unconfigured');
    unsubscribe();
  });
});

const noActions: AuthActions = {
  submitEmail: () => undefined,
  submitOtp: () => undefined,
  submitPassword: () => undefined,
  submitTotp: () => undefined,
  pickOrg: () => undefined,
  retry: () => undefined,
  signOut: () => undefined,
};

describe('(c) the email-code step never reveals whether an account exists', () => {
  it('uses exactly the founder sentence', () => {
    expect(CODE_SENT_MESSAGE).toBe('If this address has an account, a code is on its way');
    const html = renderToString(
      <AuthView
        snapshot={{ state: { kind: 'code_sent', email: EMAIL }, busy: false }}
        actions={noActions}
      />,
    );
    expect(text(html)).toContain(CODE_SENT_MESSAGE);
    expect(text(html)).not.toMatch(/We sent/);
  });

  it('an address with no account (the send fails) reaches the same state and markup as one with an account', async () => {
    const outcomes = [];
    for (const fail of [undefined, 'error', 'throw'] as const) {
      const fake = new FakeSupabase(fail === undefined ? {} : { fail: { signInWithOtp: fail } });
      const flow = new AuthFlow(fake.client, new MemoryStorage());
      await flow.start();
      await flow.submitEmail(EMAIL);
      expect(fake.callsOf('signInWithOtp')).toHaveLength(1);
      expect(flow.getSnapshot(), String(fail)).toEqual({
        state: { kind: 'code_sent', email: EMAIL },
        busy: false,
      });
      outcomes.push(
        renderToString(
          <AuthFlowContext value={flow}>
            <AuthPanel />
          </AuthFlowContext>,
        ),
      );
    }
    expect(new Set(outcomes).size).toBe(1);
    expect(text(outcomes[0] ?? '')).toContain(CODE_SENT_MESSAGE);
  });

  it('still checks the address shape before any call', async () => {
    const fake = new FakeSupabase();
    const flow = new AuthFlow(fake.client, new MemoryStorage());
    await flow.start();
    await flow.submitEmail('not-an-email');
    expect(flow.getSnapshot().state).toEqual({ kind: 'signed_out', error: 'invalid_email' });
    expect(fake.callsOf('signInWithOtp')).toEqual([]);
  });
});
