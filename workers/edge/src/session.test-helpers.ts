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
  type ApiImpl,
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

/**
 * GETs positions on the bare core (default: every item of makePackage), so answers to them are accepted: the DO
 * refuses an answer at a position it has not served (R5-59 b). Throws on a refusal.
 */
export const serveCore = async (
  h: CoreHarness,
  positions: readonly number[] = [MCQ, WRITTEN, SHORT],
  auth: { nonce: string; orgId: string } = AUTH,
): Promise<void> => {
  for (const position of positions) {
    const out = await h.core.item(auth, position);
    if (!out.ok) throw new Error(`item ${position} refused: ${out.error}`);
  }
};

/** The same through the routes (GET /v1/session/items/:pos); throws unless each answers 200. */
export const serveHttp = async (
  h: Harness,
  token: string,
  positions: readonly number[] = [MCQ, WRITTEN, SHORT],
): Promise<void> => {
  for (const position of positions) {
    const res = await h.request('GET', `/v1/session/items/${position}`, { token });
    if (res.status !== 200) throw new Error(`item ${position} answered ${res.status}`);
  }
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

/** A drive row's start window as api returns it in a first-start grant (M2 R5-63): ISO times. */
export interface StartWindowFake {
  nb: string;
  na: string;
}

/**
 * The fake api's state. `window` makes the row a drive row (M2 R5-63, R5-66 c, as stream B2 builds it): a grant that is
 * not a resume (no stored start and `sessionLive` not true) is refused `outside_start_window` unless api's clock is in
 * `[nb, na]` (unless `checkWindow` is false, to let the SessionDO's own check be seen), and carries `sw`; a resume
 * carries none. Without `window` the row is a D1 row (no `sw`, no window check).
 */
export interface FakeApiState {
  startedAt: string | null;
  grants: number;
  window: StartWindowFake | null;
  checkWindow: boolean;
}

export interface SessionRouteHarness extends Harness {
  /** The api's set-once started_at (as services/api stores it) and the drive row's window. */
  api: FakeApiState;
  packageSha: string;
  /** OTP login, then POST /v1/session/start with a skipped photo; returns the session token and view. */
  startSession: (photo?: unknown) => Promise<{ token: string; view: SessionView; res: Response }>;
}

export const sessionHarness = async (
  options: { pkg?: unknown; sessionStarted?: () => Promise<unknown>; overrides?: ApiImpl } = {},
): Promise<SessionRouteHarness> => {
  const api: FakeApiState = { startedAt: null, grants: 0, window: null, checkWindow: true };
  const ref: { h?: Harness } = {};
  let nonceN = 0;
  const h = await createHarness({
    sessionGrant: async (input) => {
      const harness = ref.h;
      if (harness === undefined) throw new Error('unavailable');
      // R5-66 c: a live DO session makes a drive row's grant a resume; D1 rows ignore `sessionLive`.
      const resume = api.startedAt !== null || (api.window !== null && input.sessionLive === true);
      const window = resume ? null : api.window;
      if (window !== null && api.checkWindow) {
        const now = harness.clock.ms;
        if (now < Date.parse(window.nb) || now > Date.parse(window.na)) {
          throw new Error('outside_start_window');
        }
      }
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
        resume,
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
        ...(window === null ? {} : { sw: { nb: window.nb, na: window.na } }),
      };
    },
    sessionStarted:
      options.sessionStarted ??
      (async (input) => {
        api.startedAt ??= String(input.startedAt);
        return { startedAt: api.startedAt };
      }),
    ...options.overrides,
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

// ---- the drive-row harness (M2: specs/m2-scheduling-invites.md R5-19, R5-23, R5-53, R5-63, R5-64, R5-66) ----------

/** The lobby verifier cap (R5-66 f) and D1's lobby lifetime, as api mints them. */
export const LOBBY_DRIVE_CAP_SECONDS = 5460;
export const LOBBY_D1_SECONDS = 1800;
const NOT_STARTED = ['created', 'sent', 'otp_verified'];

/**
 * One scheduled drive invitation as the fake api holds it (stream B2's behaviour, which these fakes stand for):
 * `slotStartsAt`, the lobby opening `lobbyOpensMinutes` before it and the start window of `windowMinutes` after it.
 * `sessionGrantExp` (ms) bounds a started row's lobby OTP (R5-53). `failStarted` makes `sessionStarted` fail.
 */
export interface DriveRow {
  state: string;
  mode: 'scheduled' | 'open_window';
  slotStartsAt: number;
  /** Where `portalReschedule` moves the row (the one self-reschedule, M2-11). */
  nextSlotStartsAt: number;
  lobbyOpensMinutes: number;
  windowMinutes: number;
  sessionGrantExp: number | null;
  failStarted: boolean;
}

export interface DriveHarness extends SessionRouteHarness {
  drive: DriveRow;
  /** The window `[nb, na]` of the current slot, in ms. */
  nb: () => number;
  na: () => number;
  lobbyOpensAt: () => number;
}

/**
 * A session harness over a drive row (scheduled): api's `inviteResolve` answers `schedule` with the phase by api's
 * clock (only for `created|sent|otp_verified`, R5-64 b); `messagingSend` (purpose `lobby`) and `lobbyMint` refuse
 * `lobby_closed` outside the lobby window for a row not started unless `sessionLive` is true (R5-19, R5-66 c), and
 * after `sessionGrantExp` for a started row (R5-53); `lobbyMint` mints a not-started row's lobby token to
 * `min(iat + 5,460 s, na + 60 s)` and a resume's to 1,800 s (R5-63, R5-66 f); `sessionGrant` refuses a first start
 * outside `[nb, na]` and returns `sw` (R5-63); `sessionStarted` marks the row started.
 */
export const driveHarness = async (
  row: Partial<DriveRow> = {},
  pkg: unknown = makePackage(),
): Promise<DriveHarness> => {
  const drive: DriveRow = {
    state: 'sent',
    mode: 'scheduled',
    slotStartsAt: NOW_MS + 60 * 60_000,
    nextSlotStartsAt: NOW_MS + 24 * 60 * 60_000,
    lobbyOpensMinutes: 30,
    windowMinutes: 15,
    sessionGrantExp: null,
    failStarted: false,
    ...row,
  };
  const ref: { h?: SessionRouteHarness } = {};
  const clock = () => ref.h?.clock.ms ?? NOW_MS;
  const lobbyOpensAt = () => drive.slotStartsAt - drive.lobbyOpensMinutes * 60_000;
  const nb = () => drive.slotStartsAt;
  const na = () => drive.slotStartsAt + drive.windowMinutes * 60_000;
  const notStarted = () => NOT_STARTED.includes(drive.state);
  const phase = () => {
    const now = clock();
    if (now < lobbyOpensAt()) return 'wait_lobby';
    if (now <= na()) return 'lobby_open';
    return 'window_missed';
  };
  const iso = (ms: number) => new Date(ms).toISOString();
  /** The lobby OTP refusal of R5-19 / R5-53 / R5-66 c, as api applies it. */
  const lobbyRefused = (sessionLive: unknown) => {
    if (sessionLive === true) return false;
    if (notStarted()) return phase() !== 'lobby_open';
    if (drive.state === 'started') {
      return drive.sessionGrantExp !== null && clock() > drive.sessionGrantExp;
    }
    return false;
  };
  const h = await sessionHarness({
    pkg,
    overrides: {
      inviteResolve: async () => ({
        invitationId: INVITATION,
        orgId: ORG,
        candidateId: CANDIDATE,
        state: drive.state,
        title: 'Demo assessment',
        durationMinutes: DURATION_SECONDS / 60,
        schedule: notStarted()
          ? {
              mode: drive.mode,
              phase: phase(),
              slotStartsAt: iso(drive.slotStartsAt),
              lobbyOpensAt: iso(lobbyOpensAt()),
              startWindowEndsAt: iso(na()),
            }
          : null,
      }),
      messagingSend: async (input) => {
        if ((input.purpose ?? 'lobby') === 'lobby' && lobbyRefused(input.sessionLive)) {
          throw new Error('lobby_closed');
        }
        return { ok: true };
      },
      lobbyMint: async (input) => {
        const harness = ref.h;
        if (harness === undefined) throw new Error('unavailable');
        if (lobbyRefused(input.sessionLive)) throw new Error('lobby_closed');
        if (drive.state === 'sent' || drive.state === 'created') drive.state = 'otp_verified';
        const iat = Math.floor(harness.clock.ms / 1000);
        const exp =
          notStarted() && input.sessionLive !== true
            ? Math.min(iat + LOBBY_DRIVE_CAP_SECONDS, Math.floor(na() / 1000) + 60)
            : iat + LOBBY_D1_SECONDS;
        const lobbyToken = await signToken(harness.key, {
          sub: CANDIDATE,
          candidate_id: CANDIDATE,
          invitation_id: input.invitationId,
          org_id: input.orgId,
          typ: 'lobby',
          nonce: input.nonce,
          iat,
          exp,
        });
        return { lobbyToken, expiresAt: iso(exp * 1000), next: 'age' };
      },
      portalReschedule: async () => {
        if (!notStarted()) throw new Error('closed');
        drive.slotStartsAt = drive.nextSlotStartsAt;
        return { ok: true, slotStartsAt: iso(drive.slotStartsAt) };
      },
      sessionStarted: async (input) => {
        const harness = ref.h;
        if (harness === undefined || drive.failStarted) throw new Error('unavailable');
        harness.api.startedAt ??= String(input.startedAt);
        drive.state = 'started';
        return { startedAt: harness.api.startedAt };
      },
    },
  });
  ref.h = h;
  const harness: DriveHarness = { ...h, drive, nb, na, lobbyOpensAt };
  // The window follows the row's current slot (a reschedule moves it, R5-63).
  Object.defineProperty(h.api, 'window', {
    get: () => ({ nb: iso(nb()), na: iso(na()) }),
    set: () => undefined,
    enumerable: true,
  });
  return harness;
};

/** POST /v1/session/events. */
export const postEvents = (
  h: Harness,
  token: string,
  streamId: string,
  events: ClientEvent[],
): Promise<Response> =>
  h.request('POST', '/v1/session/events', { token, json: { streamId, events } });
