// Test helpers for the SessionDO and the session routes: a synthetic test package (one MCQ and two written items, no
// answer key exists in the schema), a harness whose api grants and records `sessionStarted` like services/api does
// (set-once `startedAt`), a login-to-start flow, and a bare SessionCore on fakes for the logic tests. Synthetic data
// only; tokens and keys are made at run time.
import {
  SessionViewV2,
  type ClientEvent,
  type SessionView,
  type TestPackage,
  type TestPackageV2,
} from '@trace/shared/contracts/candidate';
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

// ---- package v2 (M1 §4.6, §6.5; R5-9, R5-19, R5-20) --------------------------------------------------------------
//
// Three sections, in position order:
//   S1 `POOL`    mcq, pool: draws 3 of 6, free navigation, items and options shuffled; item 1 has 2 variants; every
//                item has one png image stored under the library org's prefix (a library copy keeps it, SEC-M1-5).
//   S2 `FORWARD` written, pool: draws 2 of 3, forward-only, paste allowed and logged.
//   S3 `INLINE`  mcq, inline (no draw): both items in package order, free; item 1 has a jpg under the session's org.
// Candidate positions follow the sections: S1 1-3, S2 4-5, S3 6-7. Timed: 400 s each (sum = DURATION_SECONDS).

export const POOL = 'cccccccc-cccc-4ccc-8ccc-000000000001';
export const FORWARD = 'cccccccc-cccc-4ccc-8ccc-000000000002';
export const INLINE = 'cccccccc-cccc-4ccc-8ccc-000000000003';
export const LIBRARY_ORG = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const SECTION_SECONDS = 400;
/** The candidate positions of each section of makePackageV2. */
export const POSITIONS = { [POOL]: [1, 2, 3], [FORWARD]: [4, 5], [INLINE]: [6, 7] } as const;

type PackageV2Item = TestPackageV2['items'][number];

export const v2ItemVersion = (section: number, n: number): string =>
  `eeeeeeee-eeee-4eee-8eee-${String(section * 1000 + n).padStart(12, '0')}`;
const v2ItemId = (section: number, n: number): string =>
  `ffffffff-ffff-4fff-8fff-${String(section * 1000 + n).padStart(12, '0')}`;
export const v2Variant = (n: number): string =>
  `12121212-1212-4121-8121-${String(n).padStart(12, '0')}`;
/** A synthetic image content hash (64 lower-case hex). */
export const mediaHash = (n: number): string =>
  `${'ab'.repeat(30)}${n.toString(16).padStart(4, '0')}`;
export const mediaPath = (org: string, hash: string, ext: 'png' | 'jpg' | 'webp'): string =>
  `item-media/${org}/${hash}.${ext}`;

const mcqOptions = (tag: string, ids = ['a', 'b', 'c', 'd']) =>
  ids.map((id) => ({ id, label: `[synthetic] ${tag} option ${id}` }));

export const makePackageV2 = (
  options: { timed?: boolean } = {},
  overrides: Partial<TestPackageV2> = {},
): TestPackageV2 => {
  const timed = options.timed === true ? { timeLimitSeconds: SECTION_SECONDS } : {};
  const pool: PackageV2Item[] = Array.from({ length: 6 }, (_, k) => {
    const n = k + 1;
    const hash = mediaHash(n);
    const base: PackageV2Item = {
      sectionId: POOL,
      itemVersionId: v2ItemVersion(1, n),
      itemId: v2ItemId(1, n),
      kind: 'mcq',
      prompt: `[synthetic] pool question ${n}?`,
      options: mcqOptions(`pool ${n}`),
      media: [
        {
          hash,
          ext: 'png',
          alt: `[synthetic] figure ${n}`,
          objectPath: mediaPath(LIBRARY_ORG, hash, 'png'),
        },
      ],
      skillKey: 'verbal',
      difficultyBand: 2,
      exposureAtPublish: k % 3,
    };
    if (n !== 1) return base;
    return {
      ...base,
      variants: [1, 2].map((v) => ({
        variantId: v2Variant(v),
        prompt: `[synthetic] pool question 1, variant ${v}?`,
        options: mcqOptions(`variant ${v}`),
      })),
    };
  });
  const forward: PackageV2Item[] = [1, 2, 3].map((n) => ({
    sectionId: FORWARD,
    itemVersionId: v2ItemVersion(2, n),
    itemId: v2ItemId(2, n),
    kind: 'written',
    prompt: `[synthetic] written prompt ${n}.`,
    maxChars: 500,
    skillKey: 'written_communication',
    difficultyBand: 1,
    exposureAtPublish: 0,
  }));
  const inlineHash = mediaHash(100);
  const inline: PackageV2Item[] = [1, 2].map((n) => ({
    sectionId: INLINE,
    itemVersionId: v2ItemVersion(3, n),
    itemId: v2ItemId(3, n),
    kind: 'mcq',
    prompt: `[synthetic] inline question ${n}?`,
    options: mcqOptions(`inline ${n}`, ['x', 'y']),
    ...(n === 1
      ? {
          media: [
            {
              hash: inlineHash,
              ext: 'jpg' as const,
              alt: '[synthetic] inline figure',
              objectPath: mediaPath(ORG, inlineHash, 'jpg'),
            },
          ],
        }
      : {}),
    skillKey: 'reading',
    difficultyBand: 3,
    exposureAtPublish: 0,
  }));
  return {
    v: 2,
    testVersionId: TEST_VERSION,
    rulesetVersionId: RULESET,
    title: '[synthetic] Assessment v2',
    language: 'en',
    durationSeconds: DURATION_SECONDS,
    heartbeatSeconds: 10,
    signalCatalogVersion: 'd1-signals-v1',
    captureSignals: ['paste', 'drop', 'untrusted_input', 'tab_hidden', 'fullscreen_exit'],
    sections: [
      {
        id: POOL,
        title: '[synthetic] Verbal',
        position: 1,
        format: 'mcq',
        ...timed,
        navigation: 'free',
        shuffleItems: true,
        shuffleOptions: true,
        draw: { count: 3, strata: [] },
      },
      {
        id: FORWARD,
        title: '[synthetic] Writing',
        position: 2,
        format: 'written',
        ...timed,
        navigation: 'forward_only',
        shuffleItems: false,
        shuffleOptions: false,
        pasteRule: 'allowed_logged',
        draw: { count: 2, strata: [] },
      },
      {
        id: INLINE,
        title: '[synthetic] Reading',
        position: 3,
        format: 'mcq',
        ...timed,
        navigation: 'free',
        shuffleItems: false,
        shuffleOptions: false,
        draw: null,
      },
    ],
    items: [...pool, ...forward, ...inline],
    ...overrides,
  };
};

/**
 * A package v2 near the 5 MB R2 limit (R5-9: ≤ 5,000 eligible items): one mcq pool section of 4,999 items with
 * ~700-character prompts, plus one item with 200 variants of ~7,000 characters each (about 1.4 M characters, so the
 * item alone cannot be stored as one value next to the rest), and a draw of 100. Synthetic text only.
 */
export const makeLargePackageV2 = (): TestPackageV2 => {
  const filler = (n: number, length: number) =>
    `[synthetic] ${n} ${'lorem ipsum dolor '.repeat(Math.ceil(length / 18))}`.slice(0, length);
  const options = (n: number, length: number) =>
    ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, label: filler(n, length) }));
  const items: PackageV2Item[] = Array.from({ length: 5000 }, (_, k) => ({
    sectionId: POOL,
    itemVersionId: v2ItemVersion(9, k + 1),
    itemId: v2ItemId(9, k + 1),
    kind: 'mcq',
    prompt: filler(k, k === 0 ? 4000 : 300),
    options: k === 0 ? options(k, 500) : mcqOptions(`large ${k}`, ['a', 'b']),
    skillKey: 'verbal',
    difficultyBand: 2,
    exposureAtPublish: k % 5,
    ...(k === 0
      ? {
          variants: Array.from({ length: 200 }, (_, v) => ({
            variantId: v2Variant(10_000 + v),
            prompt: filler(v, 4000),
            options: options(v, 500),
          })),
        }
      : {}),
  }));
  return makePackageV2(
    {},
    {
      sections: [
        {
          id: POOL,
          title: '[synthetic] Large pool',
          position: 1,
          format: 'mcq',
          navigation: 'free',
          shuffleItems: true,
          shuffleOptions: true,
          draw: { count: 100, strata: [] },
        },
      ],
      items,
    },
  );
};

/** Starts the bare core on a v2 package and returns the v2 view (throws on a refusal). */
export const startCoreV2 = async (
  h: CoreHarness,
  overrides: Partial<StartInput> = {},
): Promise<{ view: SessionViewV2; startedAt: string }> => {
  const out = await h.core.start(startInput(h.sha256, overrides));
  if (!out.ok || out.kind !== 'live') throw new Error(`start refused: ${JSON.stringify(out)}`);
  const view = SessionViewV2.parse(out.view);
  return { view, startedAt: out.startedAt };
};

export const finish = (seq: number, sectionId: string, t = seq * 100) =>
  ({ seq, t, kind: 'section.finish', sectionId }) as ClientEvent;

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
