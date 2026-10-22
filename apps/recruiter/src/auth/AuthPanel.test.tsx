// AT-B11 (specs/m0b-tenancy.md §7), the rendered side: what each §4.6 state shows, that errors
// show only fixed generic messages, that server error text never reaches the markup, and that the
// shell's home route shows the unconfigured message when no client exists.
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../routes';
import { AuthFlowContext } from './auth-context';
import {
  AuthPanel,
  AuthView,
  ERROR_MESSAGES,
  UNCONFIGURED_MESSAGE,
  type AuthActions,
} from './AuthPanel';
import { AuthFlow, type AuthErrorKind, type AuthState } from './flow';
import {
  ERROR_MARKER,
  FACTOR_ID,
  FakeSupabase,
  MemoryStorage,
  NEW_FACTOR_ID,
  ORG_A,
  ORG_B,
  QR_DATA_URL,
  TOTP_SECRET,
  VALID_OTP,
  VALID_PASSWORD,
  VALID_TOTP,
  membership,
  org,
  type FakeCall,
} from './testing/fake-supabase';
import type { OrgRow } from '@trace/shared/contracts/tenancy';

const EMAIL = 'recruiter.two@example.test';
const ACME = org(ORG_A, 'Acme Hiring') as OrgRow;
const BETA = org(ORG_B, 'Beta & Sons <Ltd>') as OrgRow;

const noActions: AuthActions = {
  submitEmail: () => undefined,
  submitOtp: () => undefined,
  submitPassword: () => undefined,
  submitTotp: () => undefined,
  pickOrg: () => undefined,
  retry: () => undefined,
  signOut: () => undefined,
};

const render = (state: AuthState, busy = false): string =>
  renderToString(<AuthView snapshot={{ state, busy }} actions={noActions} />);

/** Visible text: tags removed, entities decoded (enough for these assertions). */
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const ALL_STATES: AuthState[] = [
  { kind: 'unconfigured' },
  { kind: 'starting' },
  { kind: 'signed_out' },
  { kind: 'code_sent', email: EMAIL },
  { kind: 'session_aal1' },
  { kind: 'session_aal1', error: 'generic' },
  { kind: 'totp_enrol', factorId: NEW_FACTOR_ID, qrCode: QR_DATA_URL, secret: TOTP_SECRET },
  { kind: 'totp_challenge', factorId: FACTOR_ID },
  { kind: 'session_aal2' },
  { kind: 'no_org' },
  { kind: 'org_picker', orgs: [ACME, BETA] },
  { kind: 'signed_in', org: ACME },
];

describe('AuthView per state (§4.6)', () => {
  it('unconfigured shows exactly the not-configured message and no form', () => {
    const html = render({ kind: 'unconfigured' });
    expect(UNCONFIGURED_MESSAGE).toBe('Sign-in is not configured for this build');
    expect(text(html)).toBe(UNCONFIGURED_MESSAGE);
    expect(html).not.toMatch(/<form|<input|<button/);
  });

  it('signed_out offers an email code and a password sign-in, with labelled fields', () => {
    const html = render({ kind: 'signed_out' });
    expect(html.match(/<form/g)).toHaveLength(2);
    expect(html).toMatch(/<input[^>]*type="email"[^>]*name="email"/);
    expect(html).toMatch(/<input[^>]*type="password"[^>]*name="password"/);
    expect(html).toMatch(/autoComplete="current-password"|autocomplete="current-password"/);
    expect(text(html)).toContain('Email me a code');
    expect(text(html)).toContain('Sign in with password');
    for (const id of [...html.matchAll(/<input[^>]*id="([^"]+)"/g)].map((m) => m[1]))
      expect(html).toContain(`for="${id}"`);
    expect(html).not.toContain('role="alert"');
  });

  it('code_sent names the address and asks for the 6-digit one-time code', () => {
    const html = render({ kind: 'code_sent', email: EMAIL });
    expect(text(html)).toContain(EMAIL);
    expect(html).toMatch(/<input[^>]*name="code"/);
    expect(html).toMatch(/inputMode="numeric"|inputmode="numeric"/);
    expect(html).toMatch(/autoComplete="one-time-code"|autocomplete="one-time-code"/);
    expect(text(html)).toContain('Start again');
  });

  it('totp_enrol shows the Supabase QR SVG as an <img> and the secret for manual entry', () => {
    const html = render({
      kind: 'totp_enrol',
      factorId: NEW_FACTOR_ID,
      qrCode: QR_DATA_URL,
      secret: TOTP_SECRET,
    });
    const img = /<img[^>]*>/.exec(html)?.[0] ?? '';
    expect(img).toContain('src="data:image/svg+xml;utf-8,');
    expect(img).toMatch(/alt="[^"]+"/);
    expect(html).not.toContain('<svg');
    expect(text(html)).toContain(TOTP_SECRET);
    expect(html).toMatch(/<input[^>]*name="code"/);
    expect(text(html)).toContain('Sign out');
  });

  it('totp_enrol without a usable QR still shows the secret, and no <img>', () => {
    const html = render({
      kind: 'totp_enrol',
      factorId: NEW_FACTOR_ID,
      qrCode: null,
      secret: TOTP_SECRET,
    });
    expect(html).not.toContain('<img');
    expect(text(html)).toContain(TOTP_SECRET);
  });

  it('totp_challenge asks for the authenticator code without enrolment details', () => {
    const html = render({ kind: 'totp_challenge', factorId: FACTOR_ID });
    expect(html).toMatch(/<input[^>]*name="code"/);
    expect(html).not.toContain('<img');
    expect(html).not.toContain(FACTOR_ID);
  });

  it('org_picker lists each org as a button (names escaped), plus sign-out', () => {
    const html = render({ kind: 'org_picker', orgs: [ACME, BETA] });
    expect(text(html)).toContain('Acme Hiring');
    expect(text(html)).toContain('Beta & Sons <Ltd>');
    expect(html).not.toContain('<Ltd>');
    expect(html.match(/<button/g)).toHaveLength(3);
  });

  it('signed_in names the org and offers sign-out', () => {
    const t = text(render({ kind: 'signed_in', org: ACME }));
    expect(t).toContain('Acme Hiring');
    expect(t).toContain('Sign out');
  });

  it('no_org says there is no organisation and offers sign-out', () => {
    const t = text(render({ kind: 'no_org' }));
    expect(t).toMatch(/organisation/);
    expect(t).toContain('Sign out');
  });

  it('session states show progress, and after an error a retry and sign-out', () => {
    expect(render({ kind: 'session_aal1' })).toContain('role="status"');
    const html = render({ kind: 'session_aal2', error: 'generic' });
    expect(text(html)).toContain(ERROR_MESSAGES.generic);
    expect(text(html)).toContain('Try again');
    expect(text(html)).toContain('Sign out');
  });

  it('disables every button while a step runs', () => {
    for (const state of ALL_STATES) {
      const html = render(state, true);
      for (const button of html.match(/<button[^>]*>/g) ?? [])
        expect(button, state.kind).toContain('disabled');
    }
  });

  it('never uses an inline style (CSP style-src self)', () => {
    for (const state of ALL_STATES) expect(render(state), state.kind).not.toMatch(/\sstyle=/);
  });
});

describe('errors show only the fixed messages (§4.2)', () => {
  it('the code error is the spec sentence', () => {
    expect(ERROR_MESSAGES.code).toBe("That code didn't work. Try again.");
  });

  const cases: [AuthState, AuthErrorKind][] = [
    [{ kind: 'signed_out', error: 'generic' }, 'generic'],
    [{ kind: 'signed_out', error: 'invalid_email' }, 'invalid_email'],
    [{ kind: 'signed_out', error: 'invalid_password' }, 'invalid_password'],
    [{ kind: 'code_sent', email: EMAIL, error: 'code' }, 'code'],
    [{ kind: 'code_sent', email: EMAIL, error: 'invalid_code' }, 'invalid_code'],
    [{ kind: 'totp_challenge', factorId: FACTOR_ID, error: 'code' }, 'code'],
    [
      {
        kind: 'totp_enrol',
        factorId: NEW_FACTOR_ID,
        qrCode: QR_DATA_URL,
        secret: TOTP_SECRET,
        error: 'invalid_code',
      },
      'invalid_code',
    ],
    [{ kind: 'session_aal1', error: 'generic' }, 'generic'],
  ];
  for (const [state, error] of cases)
    it(`${state.kind} + ${error}`, () => {
      const html = render(state);
      expect(html).toContain('role="alert"');
      const alert = /<p[^>]*role="alert"[^>]*>([^<]*)<\/p>/.exec(html)?.[1];
      expect(text(alert ?? '')).toBe(ERROR_MESSAGES[error]);
    });
});

describe('server error text never reaches the markup or the console', () => {
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  beforeEach(() => {
    for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const)
      spies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
  });
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it('renders every state reached after each failing call without the marker', async () => {
    const calls: FakeCall[] = [
      'signInWithOtp',
      'verifyOtp',
      'signInWithPassword',
      'getSession',
      'getAuthenticatorAssuranceLevel',
      'listFactors',
      'enroll',
      'challengeAndVerify',
      'select:memberships',
      'select:orgs',
      'signOut',
    ];
    let rendered = 0;
    for (const mode of ['error', 'throw'] as const)
      for (const call of calls) {
        const fake = new FakeSupabase({
          memberships: [membership(ORG_A, ['admin'])],
          orgs: [org(ORG_A, 'Acme Hiring')],
          fail: { [call]: mode },
        });
        const flow = new AuthFlow(fake.client, new MemoryStorage());
        const check = () => {
          const html = renderToString(<AuthView snapshot={flow.getSnapshot()} actions={flow} />);
          expect(html).not.toContain(ERROR_MARKER);
          rendered += 1;
        };
        flow.subscribe(check);
        await flow.start();
        await flow.submitEmail(EMAIL);
        await flow.submitOtp(VALID_OTP);
        await flow.submitTotp(VALID_TOTP);
        await flow.signOut();
        await flow.submitPassword(EMAIL, VALID_PASSWORD);
        await flow.submitTotp(VALID_TOTP);
        await flow.signOut();
      }
    expect(rendered).toBeGreaterThan(100);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('AuthPanel wiring', () => {
  it('the home route shows the shell and the not-configured message without a client', () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toContain('Recruiter workspace');
    expect(text(html)).toContain(UNCONFIGURED_MESSAGE);
    expect(html).not.toContain('<form');
  });

  it('renders the flow it is given through the context', async () => {
    const fake = new FakeSupabase();
    const flow = new AuthFlow(fake.client, new MemoryStorage());
    await flow.start();
    const html = renderToString(
      <AuthFlowContext value={flow}>
        <AuthPanel />
      </AuthFlowContext>,
    );
    expect(text(html)).toContain('Email me a code');
    expect(text(html)).not.toContain(UNCONFIGURED_MESSAGE);
  });
});
