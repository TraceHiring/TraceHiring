// Test helpers for the SessionDO and the session routes: a synthetic test package (one MCQ and two written items, no
// answer key exists in the schema), a harness whose api grants and records `sessionStarted` like services/api does
// (set-once `startedAt`), a login-to-start flow, and a bare SessionCore on fakes for the logic tests. Synthetic data
// only; tokens and keys are made at run time.
import type { ClientEvent, SessionView, TestPackage } from '@trace/shared/contracts/candidate';
import { sha256HexBytes } from './encoding.js';
import {
  createHarness,
  fakeBucket,
  fakeQueue,
  fakeSession,
  NOW_MS,
  type Clock,
  type Harness,
} from './edge.test-helpers.js';
import type { StartInput } from './session-core.js';
import { CANDIDATE, INVITATION, ORG, SESSION, signToken } from './token.test-helpers.js';

export const TEST_VERSION = '77777777-7777-4777-8777-777777777777';
export const RULESET = '88888888-8888-4888-8888-888888888888';
export const CONSENT = '99999999-9999-4999-8999-999999999999';
export const SECTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemVersion = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;

export const DURATION_SECONDS = 1200;
export const PACKAGE_KEY = `packages/${TEST_VERSION}.json`;
/** Item 1 is an MCQ (options a, b); items 2 and 3 are written (item 3 capped at 40 characters). */
export const MCQ = 1;
export const WRITTEN = 2;
export const SHORT = 3;
export const SHORT_MAX = 40;

export const makePackage = (overrides: Partial<TestPackage> = {}): TestPackage => ({
  v: 1,
  testVersionId: TEST_VERSION,
  rulesetVersionId: RULESET,
  title: 'Demo assessment',
  language: 'en',
  durationSeconds: DURATION_SECONDS,
  pasteBlocked: true,
  heartbeatSeconds: 10,
  signalCatalogVersion: 'd1-signals-v1',
  sections: [{ id: SECTION, title: 'Section one', position: 1 }],
  items: [
    {
      position: MCQ,
      sectionId: SECTION,
      itemVersionId: itemVersion(1),
      kind: 'mcq',
      prompt: 'Synthetic question one?',
      options: [
        { id: 'a', label: 'Option A' },
        { id: 'b', label: 'Option B' },
      ],
    },
    {
      position: WRITTEN,
      sectionId: SECTION,
      itemVersionId: itemVersion(2),
      kind: 'written',
      prompt: 'Synthetic question two.',
      maxChars: 10_000,
    },
    {
      position: SHORT,
      sectionId: SECTION,
      itemVersionId: itemVersion(3),
      kind: 'written',
      prompt: 'Synthetic question three.',
      maxChars: SHORT_MAX,
    },
  ],
  ...overrides,
});

/** Stores the package bytes under its key; returns their sha256. */
export const installPackage = async (
  packages: ReturnType<typeof fakeBucket>,
  pkg: unknown = makePackage(),
  key = PACKAGE_KEY,
): Promise<string> => {
  const bytes = new TextEncoder().encode(typeof pkg === 'string' ? pkg : JSON.stringify(pkg));
  await packages.bucket.put(key, bytes);
  return sha256HexBytes(bytes);
};

/** A grant input as the route builds it, for the bare-core tests. */
export const startInput = (sha256: string, overrides: Partial<StartInput> = {}): StartInput => ({
  sessionId: SESSION,
  orgId: ORG,
  invitationId: INVITATION,
  testVersionId: TEST_VERSION,
  rulesetVersionId: RULESET,
  consentId: CONSENT,
  durationSeconds: DURATION_SECONDS,
  grantStartedAt: null,
  packageKey: PACKAGE_KEY,
  packageSha256: sha256,
  nonce: 'session-nonce-0001-abcdef',
  adultConfirmed: true,
  photo: null,
  photoSkippedReason: 'declined',
  ...overrides,
});

export const AUTH = { nonce: 'session-nonce-0001-abcdef', orgId: ORG };

/** A bare SessionCore on fakes, on its own clock. */
export const coreHarness = async (pkg: unknown = makePackage()) => {
  const clock: Clock = { ms: NOW_MS };
  const ops: string[] = [];
  const lines: string[] = [];
  const evidence = fakeBucket(ops);
  const packages = fakeBucket();
  const queue = fakeQueue(ops);
  const session = fakeSession({ clock, evidence, packages, queue, sink: (l) => lines.push(l) });
  const sha256 = await installPackage(packages, pkg);
  return { clock, ops, lines, evidence, packages, queue, sha256, ...session };
};

export type CoreHarness = Awaited<ReturnType<typeof coreHarness>>;

/** Starts the bare core and returns the view (throws on a refusal). */
export const startCore = async (
  h: CoreHarness,
  overrides: Partial<StartInput> = {},
): Promise<{ view: SessionView; startedAt: string }> => {
  const out = await h.core.start(startInput(h.sha256, overrides));
  if (!out.ok || out.kind !== 'live') throw new Error(`start refused: ${JSON.stringify(out)}`);
  return { view: out.view as SessionView, startedAt: out.startedAt };
};

// ---- event builders (seq and t set by the caller) --------------------------------------------------------------

export const text = (seq: number, item: number, p: number, d: number, i: string, t = seq * 100) =>
  ({ seq, t, kind: 'answer.text', item, p, d, i }) as ClientEvent;
export const choice = (seq: number, item: number, option: string | null, t = seq * 100) =>
  ({ seq, t, kind: 'answer.choice', item, option }) as ClientEvent;
export const heartbeat = (seq: number, t = seq * 100) =>
  ({ seq, t, kind: 'heartbeat' }) as ClientEvent;
export const paste = (seq: number, item: number | null, len: number, t = seq * 100) =>
  ({ seq, t, kind: 'signal', sig: 'paste', item, len }) as ClientEvent;
export const tabHidden = (seq: number, item: number | null, ms: number, t = seq * 100) =>
  ({ seq, t, kind: 'signal', sig: 'tab_hidden', item, ms }) as ClientEvent;

// ---- the route harness --------------------------------------------------------------------------------------------

export interface SessionRouteHarness extends Harness {
  /** The api's set-once started_at (as services/api stores it). */
  api: { startedAt: string | null; grants: number };
  packageSha: string;
  /** OTP login, then POST /v1/session/start with a skipped photo; returns the session token and view. */
  startSession: (photo?: unknown) => Promise<{ token: string; view: SessionView; res: Response }>;
}

export const sessionHarness = async (
  options: { pkg?: unknown; sessionStarted?: () => Promise<unknown> } = {},
): Promise<SessionRouteHarness> => {
  const api = { startedAt: null as string | null, grants: 0 };
  const ref: { h?: Harness } = {};
  let nonceN = 0;
  const h = await createHarness({
    sessionGrant: async () => {
      const harness = ref.h;
      if (harness === undefined) throw new Error('unavailable');
      api.grants += 1;
      nonceN += 1;
      const nonce = `session-nonce-${String(nonceN).padStart(4, '0')}-abcdef`;
      const iat = Math.floor(harness.clock.ms / 1000);
      const sessionToken = await signToken(harness.key, {
        sub: CANDIDATE,
        candidate_id: CANDIDATE,
        invitation_id: INVITATION,
        org_id: ORG,
        typ: 'session',
        nonce,
        iat,
        exp: iat + DURATION_SECONDS + 3600,
      });
      return {
        resume: api.startedAt !== null,
        startedAt: api.startedAt,
        durationSeconds: DURATION_SECONDS,
        sessionToken,
        nonce,
        packageKey: PACKAGE_KEY,
        packageSha256: packageSha,
        testVersionId: TEST_VERSION,
        rulesetVersionId: RULESET,
        consentId: CONSENT,
        adultConfirmed: true,
        sessionId: SESSION,
      };
    },
    sessionStarted:
      options.sessionStarted ??
      (async (input) => {
        api.startedAt ??= String(input.startedAt);
        return { startedAt: api.startedAt };
      }),
  });
  ref.h = h;
  const packageSha = await installPackage(h.packages, options.pkg ?? makePackage());

  const startSession: SessionRouteHarness['startSession'] = async (
    photo = { skippedReason: 'declined' },
  ) => {
    const lobby = await h.login();
    const res = await h.request('POST', '/v1/session/start', {
      token: lobby,
      json: { rulesAcknowledged: true, photo },
    });
    if (res.status !== 200) throw new Error(`session start ${res.status}`);
    const body = (await res.clone().json()) as { sessionToken: string; view: SessionView };
    return { token: body.sessionToken, view: body.view, res };
  };

  return { ...h, api, packageSha, startSession };
};

/** POST /v1/session/events. */
export const postEvents = (
  h: Harness,
  token: string,
  streamId: string,
  events: ClientEvent[],
): Promise<Response> =>
  h.request('POST', '/v1/session/events', { token, json: { streamId, events } });
