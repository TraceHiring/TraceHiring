// AT-B11 (specs/m0b-tenancy.md §7): every edge of the recruiter sign-in state machine (§4.6), the
// flows of §4.2, the §4.5 contracts on inputs and rows, and the assurance rules of §2.2, against a
// fake supabase client. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthFlow, MEMBERSHIP_COLUMNS, ORG_COLUMNS, ORG_CHOICE_KEY, type AuthState } from './flow';
import {
  ERROR_MARKER,
  FACTOR_ID,
  FakeSupabase,
  MemoryStorage,
  NEW_FACTOR_ID,
  ORG_A,
  ORG_B,
  ORG_C,
  OTHER_USER_ID,
  QR_DATA_URL,
  TOTP_SECRET,
  USER_ID,
  VALID_OTP,
  VALID_PASSWORD,
  VALID_TOTP,
  membership,
  org,
  type FakeCall,
  type FakeOptions,
} from './testing/fake-supabase';

const EMAIL = 'recruiter.one@example.test';

function setup(options: FakeOptions = {}) {
  const fake = new FakeSupabase(options);
  const storage = new MemoryStorage();
  const flow = new AuthFlow(fake.client, storage);
  return { fake, storage, flow };
}

const kind = (flow: AuthFlow): AuthState['kind'] => flow.getSnapshot().state.kind;

/** Signs in with an email code from a fresh start. */
async function otpSignIn(flow: AuthFlow): Promise<void> {
  await flow.start();
  await flow.submitEmail(EMAIL);
  await flow.submitOtp(VALID_OTP);
}

/** Signs in with a password from a fresh start. */
async function passwordSignIn(flow: AuthFlow): Promise<void> {
  await flow.start();
  await flow.submitPassword(EMAIL, VALID_PASSWORD);
}

const RECRUITER_IN_A = {
  memberships: [membership(ORG_A, ['recruiter'])],
  orgs: [org(ORG_A, 'Acme')],
};

describe('unconfigured build', () => {
  it('starts and stays unconfigured with no client, whatever is submitted', async () => {
    const storage = new MemoryStorage();
    const flow = new AuthFlow(null, storage);
    expect(kind(flow)).toBe('unconfigured');
    await flow.start();
    await flow.submitEmail(EMAIL);
    await flow.submitPassword(EMAIL, VALID_PASSWORD);
    await flow.signOut();
    expect(kind(flow)).toBe('unconfigured');
  });
});

describe('start', () => {
  it('goes to signed_out when no session is stored', async () => {
    const { flow, fake } = setup();
    expect(kind(flow)).toBe('starting');
    await flow.start();
    expect(kind(flow)).toBe('signed_out');
    expect(fake.callsOf('select:memberships')).toEqual([]);
  });

  it('resumes a stored session (a reload) through the same resolution', async () => {
    const { flow } = setup({ session: { methods: ['otp'], aal: 'aal1' }, ...RECRUITER_IN_A });
    await flow.start();
    expect(flow.getSnapshot().state).toEqual({ kind: 'signed_in', org: org(ORG_A, 'Acme') });
  });

  it('goes to signed_out with the generic error when the stored session cannot be read', async () => {
    for (const mode of ['error', 'throw'] as const) {
      const { flow } = setup({ fail: { getSession: mode } });
      await flow.start();
      expect(flow.getSnapshot().state).toEqual({ kind: 'signed_out', error: 'generic' });
    }
  });
});

describe('email OTP path (§4.2)', () => {
  it('sends the code with shouldCreateUser false, then verifies it as type email', async () => {
    const { flow, fake } = setup(RECRUITER_IN_A);
    await flow.start();
    await flow.submitEmail(`  ${EMAIL} `);
    expect(flow.getSnapshot().state).toEqual({ kind: 'code_sent', email: EMAIL });
    expect(fake.callsOf('signInWithOtp')).toEqual([
      [{ email: EMAIL, options: { shouldCreateUser: false } }],
    ]);
    await flow.submitOtp(VALID_OTP);
    expect(fake.callsOf('verifyOtp')).toEqual([
      [{ email: EMAIL, token: VALID_OTP, type: 'email' }],
    ]);
  });

  it('lets a recruiter-only OTP session in at aal1 without TOTP (§2.2)', async () => {
    const { flow, fake } = setup(RECRUITER_IN_A);
    await otpSignIn(flow);
    expect(flow.getSnapshot().state).toEqual({ kind: 'signed_in', org: org(ORG_A, 'Acme') });
    expect(fake.callsOf('listFactors')).toEqual([]);
    expect(fake.callsOf('enroll')).toEqual([]);
  });

  it('lets a hiring_manager OTP session in at aal1 (amr given as bare strings)', async () => {
    const { flow, fake } = setup({
      memberships: [membership(ORG_A, ['hiring_manager', 'recruiter'])],
      orgs: [org(ORG_A, 'Acme')],
      amrAsStrings: true,
    });
    await otpSignIn(flow);
    expect(kind(flow)).toBe('signed_in');
    expect(fake.callsOf('listFactors')).toEqual([]);
  });

  for (const role of ['org_owner', 'admin', 'reviewer']) {
    it(`sends an OTP session holding ${role} to TOTP before any org read`, async () => {
      const { flow, fake } = setup({
        memberships: [membership(ORG_A, [role])],
        orgs: [org(ORG_A, 'Acme')],
        verifiedFactors: [FACTOR_ID],
      });
      await otpSignIn(flow);
      expect(flow.getSnapshot().state).toEqual({ kind: 'totp_challenge', factorId: FACTOR_ID });
      expect(fake.callsOf('select:orgs')).toEqual([]);
    });
  }

  it('needs TOTP when the session used a password at all, even next to an OTP method', async () => {
    const { flow } = setup({
      ...RECRUITER_IN_A,
      session: { methods: ['otp', 'password'], aal: 'aal1' },
      verifiedFactors: [FACTOR_ID],
    });
    await flow.start();
    expect(kind(flow)).toBe('totp_challenge');
  });

  it('needs TOTP when no OTP method is present (an unknown first factor)', async () => {
    const { flow } = setup({
      ...RECRUITER_IN_A,
      session: { methods: ['oauth'], aal: 'aal1' },
      verifiedFactors: [FACTOR_ID],
    });
    await flow.start();
    expect(kind(flow)).toBe('totp_challenge');
  });

  it('a magiclink first factor counts like OTP (§2.2)', async () => {
    const { flow } = setup({ ...RECRUITER_IN_A, session: { methods: ['magiclink'], aal: 'aal1' } });
    await flow.start();
    expect(kind(flow)).toBe('signed_in');
  });

  it('needs TOTP when any one membership is privileged', async () => {
    const { flow } = setup({
      memberships: [membership(ORG_A, ['recruiter']), membership(ORG_B, ['reviewer'])],
      orgs: [org(ORG_A, 'Acme'), org(ORG_B, 'Beta')],
      verifiedFactors: [FACTOR_ID],
    });
    await otpSignIn(flow);
    expect(kind(flow)).toBe('totp_challenge');
  });
});

describe('password → TOTP (§4.2: a password sign-in always continues to TOTP)', () => {
  it('enrols when there is no factor: QR data URL and secret, then challengeAndVerify', async () => {
    const { flow, fake } = setup(RECRUITER_IN_A);
    await passwordSignIn(flow);
    expect(fake.callsOf('signInWithPassword')).toEqual([
      [{ email: EMAIL, password: VALID_PASSWORD }],
    ]);
    expect(fake.callsOf('enroll')).toEqual([[{ factorType: 'totp' }]]);
    expect(flow.getSnapshot().state).toEqual({
      kind: 'totp_enrol',
      factorId: NEW_FACTOR_ID,
      qrCode: QR_DATA_URL,
      secret: TOTP_SECRET,
    });
    expect(fake.callsOf('select:orgs')).toEqual([]);
    await flow.submitTotp(VALID_TOTP);
    expect(fake.callsOf('challengeAndVerify')).toEqual([
      [{ factorId: NEW_FACTOR_ID, code: VALID_TOTP }],
    ]);
    expect(flow.getSnapshot().state).toEqual({ kind: 'signed_in', org: org(ORG_A, 'Acme') });
  });

  it('challenges an existing factor without enrolling', async () => {
    const { flow, fake } = setup({ ...RECRUITER_IN_A, verifiedFactors: [FACTOR_ID] });
    await passwordSignIn(flow);
    expect(flow.getSnapshot().state).toEqual({ kind: 'totp_challenge', factorId: FACTOR_ID });
    expect(fake.callsOf('enroll')).toEqual([]);
    await flow.submitTotp(VALID_TOTP);
    expect(fake.callsOf('challengeAndVerify')).toEqual([
      [{ factorId: FACTOR_ID, code: VALID_TOTP }],
    ]);
    expect(kind(flow)).toBe('signed_in');
  });

  it('a stored aal2 session goes straight to the org', async () => {
    const { flow, fake } = setup({
      session: { methods: ['password', 'totp'], aal: 'aal2' },
      memberships: [membership(ORG_A, ['org_owner', 'admin'])],
      orgs: [org(ORG_A, 'Acme')],
    });
    await flow.start();
    expect(kind(flow)).toBe('signed_in');
    expect(fake.callsOf('listFactors')).toEqual([]);
  });

  it('does not show a QR image that is not an SVG data URL (the secret is still shown)', async () => {
    const fake = new FakeSupabase(RECRUITER_IN_A);
    const enroll = fake.client.auth.mfa.enroll;
    fake.client.auth.mfa.enroll = async (params) => {
      const result = await enroll(params);
      return {
        ...result,
        data: {
          id: NEW_FACTOR_ID,
          totp: { qr_code: 'https://qr.example.test/a.svg', secret: TOTP_SECRET },
        },
      };
    };
    const flow = new AuthFlow(fake.client, new MemoryStorage());
    await passwordSignIn(flow);
    expect(flow.getSnapshot().state).toEqual({
      kind: 'totp_enrol',
      factorId: NEW_FACTOR_ID,
      qrCode: null,
      secret: TOTP_SECRET,
    });
  });
});

describe('org resolution', () => {
  it('reads exactly the §4.5 columns: own memberships by user_id, orgs by id', async () => {
    const { flow, fake } = setup(RECRUITER_IN_A);
    await otpSignIn(flow);
    expect(MEMBERSHIP_COLUMNS).toBe(
      'id,org_id,user_id,roles,workspace_id,team_id,display_name,status',
    );
    expect(ORG_COLUMNS).toBe('id,name,slug,kind,status');
    expect(fake.callsOf('select:memberships')).toEqual([
      [MEMBERSHIP_COLUMNS, 'eq', 'user_id', USER_ID],
    ]);
    expect(fake.callsOf('select:orgs')).toEqual([[ORG_COLUMNS, 'in', 'id', [ORG_A]]]);
  });

  it('several visible orgs → org_picker (sorted by name) → signed_in, choice kept in storage', async () => {
    const { flow, storage } = setup({
      memberships: [membership(ORG_B, ['recruiter']), membership(ORG_A, ['recruiter'])],
      orgs: [org(ORG_B, 'Zeta Hiring'), org(ORG_A, 'Acme')],
    });
    await otpSignIn(flow);
    expect(flow.getSnapshot().state).toEqual({
      kind: 'org_picker',
      orgs: [org(ORG_A, 'Acme'), org(ORG_B, 'Zeta Hiring')],
    });
    await flow.pickOrg(ORG_B);
    expect(flow.getSnapshot().state).toEqual({ kind: 'signed_in', org: org(ORG_B, 'Zeta Hiring') });
    expect(storage.getItem(ORG_CHOICE_KEY)).toBe(ORG_B);
  });

  it('ignores a pick that is not one of the listed orgs', async () => {
    const { flow } = setup({
      memberships: [membership(ORG_A, ['recruiter']), membership(ORG_B, ['recruiter'])],
      orgs: [org(ORG_A, 'Acme'), org(ORG_B, 'Beta')],
    });
    await otpSignIn(flow);
    await flow.pickOrg(ORG_C);
    expect(kind(flow)).toBe('org_picker');
  });

  it('a reload with a stored choice that is still visible skips the picker', async () => {
    const fake = new FakeSupabase({
      session: { methods: ['otp'], aal: 'aal1' },
      memberships: [membership(ORG_A, ['recruiter']), membership(ORG_B, ['recruiter'])],
      orgs: [org(ORG_A, 'Acme'), org(ORG_B, 'Beta')],
    });
    const storage = new MemoryStorage();
    storage.setItem(ORG_CHOICE_KEY, ORG_B);
    const flow = new AuthFlow(fake.client, storage);
    await flow.start();
    expect(flow.getSnapshot().state).toEqual({ kind: 'signed_in', org: org(ORG_B, 'Beta') });
  });

  it('a stored choice that is no longer visible shows the picker again', async () => {
    const fake = new FakeSupabase({
      session: { methods: ['otp'], aal: 'aal1' },
      memberships: [membership(ORG_A, ['recruiter']), membership(ORG_B, ['recruiter'])],
      orgs: [org(ORG_A, 'Acme'), org(ORG_B, 'Beta')],
    });
    const storage = new MemoryStorage();
    storage.setItem(ORG_CHOICE_KEY, ORG_C);
    const flow = new AuthFlow(fake.client, storage);
    await flow.start();
    expect(kind(flow)).toBe('org_picker');
  });
});

describe('no_org (§4.6, §10, N6)', () => {
  it('no memberships at all', async () => {
    const { flow, fake } = setup({ memberships: [], orgs: [] });
    await otpSignIn(flow);
    expect(flow.getSnapshot().state).toEqual({ kind: 'no_org' });
    expect(fake.callsOf('listFactors')).toEqual([]);
    expect(fake.callsOf('select:orgs')).toEqual([]);
  });

  it('a suspended org: the member still reads their own row, but RLS returns no org row', async () => {
    const { flow } = setup({ memberships: [membership(ORG_A, ['recruiter'])], orgs: [] });
    await otpSignIn(flow);
    expect(kind(flow)).toBe('no_org');
  });

  it('a suspended org row, if one were returned, is not visible either', async () => {
    const { flow } = setup({
      memberships: [membership(ORG_A, ['recruiter'])],
      orgs: [org(ORG_A, 'Acme', 'suspended')],
    });
    await otpSignIn(flow);
    expect(kind(flow)).toBe('no_org');
  });

  it('a suspended org after TOTP (privileged member) ends in no_org', async () => {
    const { flow } = setup({
      memberships: [membership(ORG_A, ['org_owner', 'admin'])],
      orgs: [],
      verifiedFactors: [FACTOR_ID],
    });
    await passwordSignIn(flow);
    await flow.submitTotp(VALID_TOTP);
    expect(kind(flow)).toBe('no_org');
  });

  it('only non-active memberships (invited, suspended, removed): no TOTP and no org read', async () => {
    const { flow, fake } = setup({
      memberships: [
        membership(ORG_A, ['admin'], 'invited'),
        membership(ORG_B, ['recruiter'], 'suspended'),
        membership(ORG_C, ['org_owner'], 'removed'),
      ],
      orgs: [org(ORG_A, 'Acme'), org(ORG_B, 'Beta'), org(ORG_C, 'Gamma')],
    });
    await passwordSignIn(flow);
    expect(kind(flow)).toBe('no_org');
    expect(fake.callsOf('listFactors')).toEqual([]);
    expect(fake.callsOf('select:orgs')).toEqual([]);
  });

  it('an org is visible only through an active membership', async () => {
    const { flow, fake } = setup({
      memberships: [
        membership(ORG_A, ['recruiter']),
        membership(ORG_B, ['recruiter'], 'suspended'),
      ],
      orgs: [org(ORG_A, 'Acme'), org(ORG_B, 'Beta')],
    });
    await otpSignIn(flow);
    expect(flow.getSnapshot().state).toEqual({ kind: 'signed_in', org: org(ORG_A, 'Acme') });
    expect(fake.callsOf('select:orgs')).toEqual([[ORG_COLUMNS, 'in', 'id', [ORG_A]]]);
  });

  it("another person's membership row never counts", async () => {
    const { flow } = setup({
      memberships: [membership(ORG_A, ['recruiter'], 'active', { user_id: OTHER_USER_ID })],
      orgs: [org(ORG_A, 'Acme')],
    });
    await otpSignIn(flow);
    expect(kind(flow)).toBe('no_org');
  });

  it('a membership row that fails the MembershipRow contract → no_org', async () => {
    for (const bad of [
      membership(ORG_A, ['recruiter'], 'active', { org_id: 'not-a-uuid' }),
      membership(ORG_A, ['superuser']),
      membership(ORG_A, []),
      membership(ORG_A, ['recruiter'], 'archived'),
      null,
      'row',
    ]) {
      const { flow } = setup({
        memberships: [membership(ORG_B, ['recruiter']), bad],
        orgs: [org(ORG_A, 'Acme'), org(ORG_B, 'Beta')],
      });
      await otpSignIn(flow);
      expect(kind(flow), JSON.stringify(bad)).toBe('no_org');
    }
  });

  it('an org row that fails the OrgRow contract → no_org', async () => {
    for (const bad of [
      org(ORG_A, 'Acme', 'active', { kind: 'partner' }),
      org(ORG_A, 'Acme', 'deleted'),
      org(ORG_A, 'Acme', 'active', { name: 42 }),
    ]) {
      const { flow } = setup({ memberships: [membership(ORG_A, ['recruiter'])], orgs: [bad] });
      await otpSignIn(flow);
      expect(kind(flow), JSON.stringify(bad)).toBe('no_org');
    }
  });

  // Finding B0-SP5: the select names the §4.5 columns, AND the contracts are strict, so a row with
  // an unexpected column (a widened select, a view change) fails the parse and the app fails
  // closed to no_org instead of silently ignoring the extra data.
  it('a row with an extra column fails the strict parse → no_org (membership and org)', async () => {
    const extraMembership = setup({
      memberships: [membership(ORG_A, ['recruiter'], 'active', { created_by: USER_ID })],
      orgs: [org(ORG_A, 'Acme')],
    });
    await otpSignIn(extraMembership.flow);
    expect(kind(extraMembership.flow)).toBe('no_org');
    expect(extraMembership.fake.callsOf('select:memberships')[0]?.[0]).toBe(MEMBERSHIP_COLUMNS);

    const extraOrg = setup({
      memberships: [membership(ORG_A, ['recruiter'])],
      orgs: [org(ORG_A, 'Acme', 'active', { data_residency: 'in' })],
    });
    await otpSignIn(extraOrg.flow);
    expect(kind(extraOrg.flow)).toBe('no_org');
    expect(extraOrg.fake.callsOf('select:orgs')[0]?.[0]).toBe(ORG_COLUMNS);
  });
});

describe('errors keep the state and show only the generic message (§4.2)', () => {
  it('a wrong email code keeps code_sent with the code error, then a right one works', async () => {
    const { flow } = setup(RECRUITER_IN_A);
    await flow.start();
    await flow.submitEmail(EMAIL);
    await flow.submitOtp('000000');
    expect(flow.getSnapshot().state).toEqual({ kind: 'code_sent', email: EMAIL, error: 'code' });
    await flow.submitOtp(VALID_OTP);
    expect(kind(flow)).toBe('signed_in');
  });

  it('a wrong TOTP code keeps totp_enrol (QR and secret kept) and totp_challenge', async () => {
    const enrol = setup(RECRUITER_IN_A);
    await passwordSignIn(enrol.flow);
    await enrol.flow.submitTotp('000000');
    expect(enrol.flow.getSnapshot().state).toEqual({
      kind: 'totp_enrol',
      factorId: NEW_FACTOR_ID,
      qrCode: QR_DATA_URL,
      secret: TOTP_SECRET,
      error: 'code',
    });

    const challenge = setup({ ...RECRUITER_IN_A, verifiedFactors: [FACTOR_ID] });
    await passwordSignIn(challenge.flow);
    await challenge.flow.submitTotp('000000');
    expect(challenge.flow.getSnapshot().state).toEqual({
      kind: 'totp_challenge',
      factorId: FACTOR_ID,
      error: 'code',
    });
    await challenge.flow.submitTotp(VALID_TOTP);
    expect(kind(challenge.flow)).toBe('signed_in');
  });

  it('a wrong password keeps signed_out with the generic error', async () => {
    const { flow } = setup(RECRUITER_IN_A);
    await flow.start();
    await flow.submitPassword(EMAIL, 'wrong-password-123');
    expect(flow.getSnapshot().state).toEqual({ kind: 'signed_out', error: 'generic' });
  });

  const failing: [FakeCall, (flow: AuthFlow) => Promise<void>, AuthState][] = [
    [
      'signInWithOtp',
      (f) => f.start().then(() => f.submitEmail(EMAIL)),
      { kind: 'signed_out', error: 'generic' },
    ],
    ['verifyOtp', otpSignIn, { kind: 'code_sent', email: EMAIL, error: 'code' }],
    ['signInWithPassword', passwordSignIn, { kind: 'signed_out', error: 'generic' }],
    ['getAuthenticatorAssuranceLevel', otpSignIn, { kind: 'session_aal1', error: 'generic' }],
    ['select:memberships', otpSignIn, { kind: 'session_aal1', error: 'generic' }],
    ['listFactors', passwordSignIn, { kind: 'session_aal1', error: 'generic' }],
    ['enroll', passwordSignIn, { kind: 'session_aal1', error: 'generic' }],
    ['select:orgs', otpSignIn, { kind: 'session_aal1', error: 'generic' }],
  ];
  for (const mode of ['error', 'throw'] as const)
    for (const [call, run, expected] of failing)
      it(`${call} (${mode}) → ${expected.kind} with the ${'error' in expected ? expected.error : ''} error`, async () => {
        const { flow } = setup({ ...RECRUITER_IN_A, fail: { [call]: mode } });
        await run(flow);
        expect(flow.getSnapshot().state).toEqual(expected);
        expect(flow.getSnapshot().busy).toBe(false);
      });

  it('a failed TOTP verify after enrolment, raised as a throw, keeps totp_enrol', async () => {
    const { flow } = setup({ ...RECRUITER_IN_A, fail: { challengeAndVerify: 'throw' } });
    await passwordSignIn(flow);
    await flow.submitTotp(VALID_TOTP);
    expect(flow.getSnapshot().state).toMatchObject({ kind: 'totp_enrol', error: 'code' });
  });

  it('retry from session_aal1 runs the resolution again', async () => {
    const { flow, fake } = setup({ ...RECRUITER_IN_A, fail: { 'select:orgs': 'error' } });
    await otpSignIn(flow);
    expect(flow.getSnapshot().state).toEqual({ kind: 'session_aal1', error: 'generic' });
    fake.heal();
    await flow.retry();
    expect(flow.getSnapshot().state).toEqual({ kind: 'signed_in', org: org(ORG_A, 'Acme') });
    expect(fake.callsOf('select:orgs')).toHaveLength(2);
  });
});

describe('server error text is never kept, rendered or logged', () => {
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  beforeEach(() => {
    for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const)
      spies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
  });
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it('no state reached after any failure contains the marker, and nothing is logged', async () => {
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
    for (const mode of ['error', 'throw'] as const)
      for (const call of calls) {
        const seen: string[] = [];
        const { flow } = setup({ ...RECRUITER_IN_A, fail: { [call]: mode } });
        flow.subscribe(() => seen.push(JSON.stringify(flow.getSnapshot())));
        await flow.start();
        await flow.submitEmail(EMAIL);
        await flow.submitOtp(VALID_OTP);
        await flow.signOut();
        await flow.start();
        await flow.submitPassword(EMAIL, VALID_PASSWORD);
        await flow.submitTotp(VALID_TOTP);
        await flow.signOut();
        expect(seen.length).toBeGreaterThan(0);
        for (const snapshot of seen) expect(snapshot).not.toContain(ERROR_MARKER);
      }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('sign-out (§4.6: any state → signed_out, clears sessionStorage)', () => {
  const reach: [string, FakeOptions, (flow: AuthFlow) => Promise<void>][] = [
    ['signed_out', {}, (f) => f.start()],
    ['code_sent', {}, (f) => f.start().then(() => f.submitEmail(EMAIL))],
    ['session_aal1', { ...RECRUITER_IN_A, fail: { listFactors: 'error' } }, passwordSignIn],
    ['totp_enrol', RECRUITER_IN_A, passwordSignIn],
    ['totp_challenge', { ...RECRUITER_IN_A, verifiedFactors: [FACTOR_ID] }, passwordSignIn],
    ['no_org', { memberships: [] }, otpSignIn],
    [
      'org_picker',
      {
        memberships: [membership(ORG_A, ['recruiter']), membership(ORG_B, ['recruiter'])],
        orgs: [org(ORG_A, 'Acme'), org(ORG_B, 'Beta')],
      },
      otpSignIn,
    ],
    ['signed_in', RECRUITER_IN_A, otpSignIn],
  ];
  for (const [state, options, run] of reach)
    it(`from ${state}`, async () => {
      const { flow, fake, storage } = setup(options);
      await run(flow);
      expect(kind(flow)).toBe(state);
      storage.setItem('sb-synthetic-auth-token', '{}');
      storage.setItem(ORG_CHOICE_KEY, ORG_A);
      await flow.signOut();
      expect(flow.getSnapshot().state).toEqual({ kind: 'signed_out' });
      expect(fake.callsOf('signOut')).toHaveLength(1);
      expect(fake.signedIn).toBe(false);
      expect(storage.map.size).toBe(0);
    });

  for (const mode of ['error', 'throw'] as const)
    it(`clears sessionStorage even when the server sign-out fails (${mode})`, async () => {
      const { flow, storage } = setup({ ...RECRUITER_IN_A, fail: { signOut: mode } });
      await otpSignIn(flow);
      storage.setItem('sb-synthetic-auth-token', '{}');
      await flow.signOut();
      expect(flow.getSnapshot().state).toEqual({ kind: 'signed_out' });
      expect(storage.map.size).toBe(0);
    });

  it('a sign-in that lands after sign-out is discarded (state, storage and session)', async () => {
    const { flow, fake, storage } = setup(RECRUITER_IN_A);
    await flow.start();
    await flow.submitEmail(EMAIL);
    const release = fake.hold('verifyOtp');
    const pending = flow.submitOtp(VALID_OTP);
    await flow.signOut();
    expect(flow.getSnapshot()).toEqual({ state: { kind: 'signed_out' }, busy: false });
    release();
    storage.setItem('sb-synthetic-auth-token', '{}');
    await pending;
    expect(flow.getSnapshot()).toEqual({ state: { kind: 'signed_out' }, busy: false });
    expect(fake.signedIn).toBe(false);
    expect(storage.map.size).toBe(0);
  });

  it('works while another step is still running', async () => {
    const { flow, storage } = setup(RECRUITER_IN_A);
    await flow.start();
    const pending = flow.submitEmail(EMAIL);
    await flow.signOut();
    await pending;
    expect(flow.getSnapshot().state).toEqual({ kind: 'signed_out' });
    expect(storage.map.size).toBe(0);
  });
});

describe('inputs the §4.5 contracts reject never reach the client', () => {
  it('emails', async () => {
    const { flow, fake } = setup();
    await flow.start();
    for (const email of ['', 'not-an-email', 'a@', `${'x'.repeat(250)}@example.test`]) {
      await flow.submitEmail(email);
      expect(flow.getSnapshot().state).toEqual({ kind: 'signed_out', error: 'invalid_email' });
      await flow.submitPassword(email, VALID_PASSWORD);
      expect(flow.getSnapshot().state).toEqual({ kind: 'signed_out', error: 'invalid_email' });
    }
    expect(fake.callsOf('signInWithOtp')).toEqual([]);
    expect(fake.callsOf('signInWithPassword')).toEqual([]);
  });

  it('passwords shorter than 12 or longer than 128 characters', async () => {
    const { flow, fake } = setup();
    await flow.start();
    for (const password of ['', 'short-11-ch', 'p'.repeat(129)]) {
      await flow.submitPassword(EMAIL, password);
      expect(flow.getSnapshot().state).toEqual({ kind: 'signed_out', error: 'invalid_password' });
    }
    expect(fake.callsOf('signInWithPassword')).toEqual([]);
  });

  const badCodes = ['', '12345', '1234567', 'abcdef', '12 345', '١٢٣٤٥٦'];

  it('email codes that are not 6 digits', async () => {
    const { flow, fake } = setup();
    await flow.start();
    await flow.submitEmail(EMAIL);
    for (const code of badCodes) {
      await flow.submitOtp(code);
      expect(flow.getSnapshot().state).toEqual({
        kind: 'code_sent',
        email: EMAIL,
        error: 'invalid_code',
      });
    }
    expect(fake.callsOf('verifyOtp')).toEqual([]);
  });

  it('TOTP codes that are not 6 digits', async () => {
    const { flow, fake } = setup({ ...RECRUITER_IN_A, verifiedFactors: [FACTOR_ID] });
    await passwordSignIn(flow);
    for (const code of badCodes) {
      await flow.submitTotp(code);
      expect(flow.getSnapshot().state).toEqual({
        kind: 'totp_challenge',
        factorId: FACTOR_ID,
        error: 'invalid_code',
      });
    }
    expect(fake.callsOf('challengeAndVerify')).toEqual([]);
  });
});

describe('steps only run from their own state, one at a time', () => {
  it('ignores submissions that do not belong to the current state', async () => {
    const { flow, fake } = setup(RECRUITER_IN_A);
    await flow.start();
    await flow.submitOtp(VALID_OTP);
    await flow.submitTotp(VALID_TOTP);
    await flow.pickOrg(ORG_A);
    expect(flow.getSnapshot().state).toEqual({ kind: 'signed_out' });
    expect(fake.callsOf('verifyOtp')).toEqual([]);
    expect(fake.callsOf('challengeAndVerify')).toEqual([]);
  });

  it('a double submit sends one request', async () => {
    const { flow, fake } = setup();
    await flow.start();
    const first = flow.submitEmail(EMAIL);
    expect(flow.getSnapshot().busy).toBe(true);
    const second = flow.submitEmail(EMAIL);
    await Promise.all([first, second]);
    expect(fake.callsOf('signInWithOtp')).toHaveLength(1);
    expect(flow.getSnapshot().busy).toBe(false);
  });

  it('notifies subscribers and stops after unsubscribe', async () => {
    const { flow } = setup();
    const listener = vi.fn();
    const unsubscribe = flow.subscribe(listener);
    await flow.start();
    const count = listener.mock.calls.length;
    expect(count).toBeGreaterThan(0);
    unsubscribe();
    await flow.submitEmail(EMAIL);
    expect(listener).toHaveBeenCalledTimes(count);
  });
});

describe('a step that finishes after sign-out makes no further network call (B2-SP3)', () => {
  const NONE = {
    enroll: [],
    listFactors: [],
    'select:memberships': [],
    'select:orgs': [],
  } as const;

  function expectNoFurtherCalls(fake: FakeSupabase, calls: readonly FakeCall[]): void {
    for (const call of calls) expect(fake.callsOf(call)).toEqual([]);
  }

  it('a password sign-in that lands after sign-out never enrols, lists factors or reads rows', async () => {
    const { flow, fake } = setup(RECRUITER_IN_A);
    await flow.start();
    const release = fake.hold('signInWithPassword');
    const pending = flow.submitPassword(EMAIL, VALID_PASSWORD);
    await flow.signOut();
    release();
    await pending;
    expectNoFurtherCalls(fake, Object.keys(NONE) as FakeCall[]);
    expect(fake.callsOf('getSession')).toHaveLength(1); // the one from start()
    expect(flow.getSnapshot()).toEqual({ state: { kind: 'signed_out' }, busy: false });
    expect(fake.signedIn).toBe(false);
  });

  /** Sign out while the `held` call of a password sign-in is pending, then let it finish. */
  async function signOutDuring(held: FakeCall, options: FakeOptions) {
    const { flow, fake } = setup(options);
    await flow.start();
    const release = fake.hold(held);
    const pending = flow.submitPassword(EMAIL, VALID_PASSWORD);
    await vi.waitFor(() => expect(fake.callsOf(held)).toHaveLength(1));
    await flow.signOut();
    release();
    await pending;
    expect(flow.getSnapshot()).toEqual({ state: { kind: 'signed_out' }, busy: false });
    return fake;
  }

  it('sign-out while the assurance level is read stops before the memberships read', async () => {
    const fake = await signOutDuring('getAuthenticatorAssuranceLevel', RECRUITER_IN_A);
    expectNoFurtherCalls(fake, ['select:memberships', 'select:orgs', 'listFactors', 'enroll']);
  });

  it('sign-out while the memberships are read stops before factors, enrolment and orgs', async () => {
    const fake = await signOutDuring('select:memberships', RECRUITER_IN_A);
    expectNoFurtherCalls(fake, ['select:orgs', 'listFactors', 'enroll']);
  });

  it('sign-out while the factors are listed stops before enrolment', async () => {
    const fake = await signOutDuring('listFactors', RECRUITER_IN_A);
    expectNoFurtherCalls(fake, ['enroll', 'select:orgs']);
  });

  it('sign-out while TOTP is accepted stops before the org read', async () => {
    const { flow, fake } = setup(RECRUITER_IN_A);
    await passwordSignIn(flow);
    expect(kind(flow)).toBe('totp_enrol');
    const release = fake.hold('select:memberships');
    const pending = flow.submitTotp(VALID_TOTP);
    await vi.waitFor(() => expect(fake.callsOf('select:memberships')).toHaveLength(2));
    await flow.signOut();
    release();
    await pending;
    expectNoFurtherCalls(fake, ['select:orgs']);
    expect(flow.getSnapshot()).toEqual({ state: { kind: 'signed_out' }, busy: false });
  });
});

describe('the aal2 stage (§4.6: session_aal2 is shown while the org is resolved after TOTP)', () => {
  /** Every state kind the flow shows, in order, without repeats of the same kind in a row. */
  function recordKinds(flow: AuthFlow): AuthState['kind'][] {
    const seen: AuthState['kind'][] = [];
    flow.subscribe(() => {
      const next = kind(flow);
      if (seen[seen.length - 1] !== next) seen.push(next);
    });
    return seen;
  }

  it('shows session_aal2 after a successful TOTP, before signed_in', async () => {
    const { flow } = setup(RECRUITER_IN_A);
    await passwordSignIn(flow);
    const seen = recordKinds(flow);
    await flow.submitTotp(VALID_TOTP);
    expect(seen).toContain('session_aal2');
    expect(seen.slice(seen.indexOf('session_aal2'))).toEqual(['session_aal2', 'signed_in']);
  });

  it('an org read that fails after TOTP stays at session_aal2 (generic error); retry works', async () => {
    const { flow, fake } = setup({ ...RECRUITER_IN_A, fail: { 'select:orgs': 'error' } });
    await passwordSignIn(flow);
    expect(kind(flow)).toBe('totp_enrol');
    await flow.submitTotp(VALID_TOTP);
    expect(flow.getSnapshot().state).toEqual({ kind: 'session_aal2', error: 'generic' });
    fake.heal();
    await flow.retry();
    expect(flow.getSnapshot().state).toEqual({ kind: 'signed_in', org: org(ORG_A, 'Acme') });
  });
});
